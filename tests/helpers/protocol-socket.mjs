import assert from 'node:assert/strict';
import net from 'node:net';
import { EventEmitter } from 'node:events';
import { randomBytes } from 'node:crypto';

export const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
export async function until(check, label, timeout = 10000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { const value = await check(); if (value) return value; await delay(25); }
  throw new Error(`Timed out: ${label}`);
}
export class ProtocolSocket extends EventEmitter {
  constructor() { super(); this.pending = []; this.bytes = Buffer.alloc(0); this.fragments = []; this.upgraded = false; this.closed = false; }
  async connect(url, cookie, origin, userAgent) {
    this.socket = net.createConnection({ host: url.hostname, port: Number(url.port) });
    this.socket.on('data', chunk => this.receive(chunk));
    this.socket.on('error', error => { this.error = error; });
    this.socket.on('close', () => { this.closed = true; clearInterval(this.heartbeat); });
    this.socket.once('connect', () => this.socket.write([
      `GET ${url.pathname} HTTP/1.1`, `Host: ${url.host}`, `Origin: ${origin}`, `Cookie: ${cookie}`, `User-Agent: ${userAgent}`,
      'Upgrade: websocket', 'Connection: Upgrade', 'Sec-WebSocket-Version: 13',
      `Sec-WebSocket-Key: ${randomBytes(16).toString('base64')}`, '', '',
    ].join('\r\n')));
    await until(() => { if (this.error) throw this.error; return this.upgraded; }, 'authenticated websocket upgrade');
    this.heartbeat = setInterval(() => { if (!this.closed) this.send('keep-alive'); }, 5000);
    this.heartbeat.unref();
  }
  receive(chunk) {
    this.bytes = Buffer.concat([this.bytes, chunk]);
    if (!this.upgraded) {
      const end = this.bytes.indexOf('\r\n\r\n'); if (end < 0) return;
      const status = this.bytes.subarray(0, end).toString().split('\r\n')[0];
      if (!status.startsWith('HTTP/1.1 101 ')) { this.error = new Error(`Websocket rejected: ${status}`); return; }
      this.bytes = this.bytes.subarray(end + 4); this.upgraded = true;
    }
    while (this.bytes.length >= 2) {
      const final = !!(this.bytes[0] & 128), opcode = this.bytes[0] & 15;
      let length = this.bytes[1] & 127, offset = 2;
      if (length === 126) { if (this.bytes.length < 4) return; length = this.bytes.readUInt16BE(2); offset = 4; }
      // These are alternative header encodings. A 16-bit payload length of
      // 127 must not be reinterpreted as the marker for a 64-bit length.
      else if (length === 127) { if (this.bytes.length < 10) return; length = Number(this.bytes.readBigUInt64BE(2)); offset = 10; }
      assert.equal(this.bytes[1] & 128, 0, 'server frames are unmasked');
      if (this.bytes.length < offset + length) return;
      const payload = this.bytes.subarray(offset, offset + length); this.bytes = this.bytes.subarray(offset + length);
      if (opcode === 9) { this.sendFrame(payload, 10); continue; }
      if (opcode === 8) { this.closed = true; this.socket.end(); continue; }
      if (opcode !== 0 && opcode !== 1) continue;
      this.fragments.push(payload);
      if (final) {
        const message = JSON.parse(Buffer.concat(this.fragments).toString()); this.fragments = [];
        this.pending.push(message); this.emit('event', message);
      }
    }
  }
  sendFrame(payload, opcode = 1) {
    const mask = randomBytes(4), header = Buffer.alloc(payload.length < 126 ? 6 : 8);
    header[0] = 128 | opcode; header[1] = 128 | (payload.length < 126 ? payload.length : 126);
    if (payload.length >= 126) header.writeUInt16BE(payload.length, 2);
    mask.copy(header, header.length - 4);
    const bytes = Buffer.from(payload); for (let i = 0; i < bytes.length; i++) bytes[i] ^= mask[i % 4];
    this.socket.write(Buffer.concat([header, bytes]));
  }
  send(type, data) { this.sendFrame(Buffer.from(JSON.stringify({ type, data }))); }
  async wait(type, predicate = () => true, timeout = 10000) {
    return until(() => {
      if (this.error) throw this.error;
      const index = this.pending.findIndex(message => message.type === type && predicate(message.data));
      return index < 0 ? null : this.pending.splice(index, 1)[0];
    }, `event ${type}`, timeout);
  }
  close() { clearInterval(this.heartbeat); this.socket?.destroy(); }
}
