import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { EventEmitter } from 'node:events';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createApp } from '../server/index.mjs';
import { openDatabase } from '../server/db.mjs';

class LocalWebSocket extends EventEmitter {
  constructor() { super(); this.pending = []; this.bytes = Buffer.alloc(0); this.upgraded = false; }
  async connect(url, cookie, origin) {
    this.socket = net.createConnection({ host: url.hostname, port: Number(url.port) });
    this.socket.on('data', chunk => this.receive(chunk));
    this.socket.on('error', error => this.emit('failure', error));
    const upgraded = new Promise((resolve, reject) => { this.once('upgrade', resolve); this.once('failure', reject); });
    this.socket.once('connect', () => this.socket.write([
      `GET ${url.pathname} HTTP/1.1`, `Host: ${url.host}`, `Origin: ${origin}`, `Cookie: ${cookie}`,
      'Upgrade: websocket', 'Connection: Upgrade', 'Sec-WebSocket-Version: 13',
      `Sec-WebSocket-Key: ${randomBytes(16).toString('base64')}`, '', '',
    ].join('\r\n')));
    await Promise.race([upgraded, new Promise((_, reject) => { const timer = setTimeout(() => reject(new Error('Gateway WebSocket upgrade timed out')), 5000); timer.unref(); })]);
  }
  receive(chunk) {
    this.bytes = Buffer.concat([this.bytes, chunk]);
    if (!this.upgraded) {
      const end = this.bytes.indexOf('\r\n\r\n'); if (end < 0) return;
      const status = this.bytes.subarray(0, end).toString();
      if (!status.startsWith('HTTP/1.1 101 ')) { this.emit('failure', new Error(`Gateway rejected upgrade: ${status.split('\r\n')[0]}`)); return; }
      this.bytes = this.bytes.subarray(end + 4); this.upgraded = true; this.emit('upgrade');
    }
    while (this.bytes.length >= 2) {
      const opcode = this.bytes[0] & 15, masked = this.bytes[1] & 128;
      let length = this.bytes[1] & 127, offset = 2;
      if (length === 126) { if (this.bytes.length < 4) return; length = this.bytes.readUInt16BE(2); offset = 4; }
      if (length === 127) { if (this.bytes.length < 10) return; length = Number(this.bytes.readBigUInt64BE(2)); offset = 10; }
      assert.equal(masked, 0, 'server frames must not be masked');
      if (this.bytes.length < offset + length) return;
      const payload = this.bytes.subarray(offset, offset + length); this.bytes = this.bytes.subarray(offset + length);
      if (opcode === 1) { const message = JSON.parse(payload.toString()); this.pending.push(message); this.emit('message'); }
      if (opcode === 9) this.sendFrame(payload, 10);
    }
  }
  sendFrame(payload, opcode = 1) {
    const mask = randomBytes(4), header = Buffer.alloc(payload.length < 126 ? 6 : 8);
    header[0] = 128 | opcode; header[1] = 128 | (payload.length < 126 ? payload.length : 126);
    if (payload.length >= 126) header.writeUInt16BE(payload.length, 2);
    mask.copy(header, header.length - 4);
    const masked = Buffer.from(payload); for (let i = 0; i < masked.length; i++) masked[i] ^= mask[i % 4];
    this.socket.write(Buffer.concat([header, masked]));
  }
  send(value) { this.sendFrame(Buffer.from(JSON.stringify(value))); }
  waitFor(type) {
    return new Promise((resolve, reject) => {
      const check = () => { const index = this.pending.findIndex(message => message.type === type); if (index < 0) return; clearTimeout(timer); this.off('message', check); resolve(this.pending.splice(index, 1)[0]); };
      const timer = setTimeout(() => { this.off('message', check); reject(new Error(`Missing ${type} through gateway`)); }, 5000);
      this.on('message', check); check();
    });
  }
  close() { this.socket?.destroy(); }
}

test('real engine admission and original chat survive the platform WebSocket proxy', {
  skip: !process.env.SKRIBBIL_TEST_ENGINE_URL,
  timeout: 30000,
}, async () => {
  const secret = process.env.SKRIBBIL_ENGINE_SECRET || (await readFile(new URL('../.data/dev-secret', import.meta.url), 'utf8')).trim();
  const db = await openDatabase({ dataDir: ':memory:', url: '' });
  const config = { secret, engineUrl: process.env.SKRIBBIL_TEST_ENGINE_URL, origin: '', secure: false, ranked: false, production: false };
  const app = await createApp({ db, config });
  await new Promise(resolve => app.server.listen(Number(process.env.SKRIBBIL_TEST_GATEWAY_PORT || 0), '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${app.server.address().port}`; config.origin = base;
  const ws = new LocalWebSocket(); let cookie, matchId;
  const request = async (path, data, cookies = cookie) => fetch(base + path, {
    method: data === undefined ? 'GET' : 'POST', redirect: 'manual',
    headers: { Cookie: cookies || '', ...(data === undefined ? {} : { 'Content-Type': 'application/json', 'X-Requested-With': 'Skribbil', Origin: base }) },
    body: data === undefined ? undefined : JSON.stringify(data),
  });
  try {
    const name = `gateway_${randomBytes(4).toString('hex')}`;
    const registration = await request('/api/auth/register', { username: name, email: `${name}@example.test`, password: randomBytes(24).toString('base64url') });
    assert.equal(registration.status, 200); cookie = registration.headers.getSetCookie()[0].split(';')[0];
    const create = await request('/api/rooms', { mode: 'private', rounds: 1, drawTime: 60, maxPlayers: 2 });
    assert.equal(create.status, 201); const room = await create.json(); matchId = room.matchId;
    const admission = await request(room.url); assert.equal(admission.status, 303);
    const engineCookies = admission.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
    assert.match(engineCookies, /usersession=/);
    const lobbyId = new URL(admission.headers.get('location'), base).pathname.split('/').at(-1);
    await ws.connect(new URL(`/engine/v1/lobby/${lobbyId}/ws`, base.replace('http:', 'ws:')), `${cookie}; ${engineCookies}`, base);
    const ready = await ws.waitFor('ready'); assert.equal(ready.data.playerName, name); assert.equal(ready.data.leagueMode, 'private');
    ws.send({ type: 'message', data: 'Original chat through the real gateway' });
    const message = await ws.waitFor('message'); assert.equal(message.data.content, 'Original chat through the real gateway'); assert.equal(message.data.author, name);
  } finally {
    ws.close();
    // No game starts and no result events are produced. Cancel the temporary
    // unstarted room when supported; the native cleanup also removes it.
    if (matchId) await request(`/api/rooms/${matchId}/cancel`, {}).catch(() => {});
    app.server.closeAllConnections(); await new Promise(resolve => app.server.close(resolve)); await db.close();
  }
});
