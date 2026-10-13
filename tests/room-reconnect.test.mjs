import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../engine/internal/frontend/lobby.js', import.meta.url), 'utf8');
const start = source.indexOf('const connectToWebsocket = () => {');
const connection = source.slice(start, source.indexOf('\n};', start) + 3);
const heartbeatStart = source.indexOf('window.setInterval(() => {', start);
const heartbeat = source.slice(heartbeatStart, source.indexOf('}, 5000);', heartbeatStart) + 9);

function setup() {
  const sockets = [], notices = [];
  let tick;
  class Socket {
    static OPEN = 1;
    constructor() { this.readyState = 0; this.sent = []; sockets.push(this); }
    send(message) {
      assert.equal(this.readyState, Socket.OPEN, 'closed sockets must not send');
      this.sent.push(JSON.parse(message));
    }
  }
  const context = vm.createContext({
    WebSocket: Socket, location: { hostname: 'localhost', port: '3000', protocol: 'http:' },
    console: { log() {} }, rootPath: '/engine', reconnectDialogId: 'reconnect-dialog',
    closeDialog() {}, showTextDialog: (...args) => notices.push(args),
    showReconnectDialogIfNotShown() {}, handleEvent() {},
    window: { setInterval(fn) { tick = fn; } },
  });
  vm.runInContext(`let socket; let socketIsConnecting = false; let hasSocketEverConnected = false;
    ${connection}\n${heartbeat}\nconnectToWebsocket();`, context);
  const socket = sockets[0]; socket.readyState = Socket.OPEN; socket.onopen();
  return { sockets, notices, tick, socket };
}

test('a replaced room tab stops reconnecting instead of stealing back the new connection', () => {
  const f = setup();
  f.socket.readyState = 3;
  f.socket.onclose({ code: 4001 });
  assert.equal(f.sockets.length, 1);
  assert.match(f.notices[0][2], /another tab/);
  f.tick();
  assert.equal(f.socket.sent.length, 0);
});

test('network loss still reconnects and heartbeats only use open sockets', () => {
  const f = setup(); f.tick();
  assert.equal(f.socket.sent[0].type, 'keep-alive');
  f.socket.readyState = 3; f.socket.onclose({ code: 1006 });
  assert.equal(f.sockets.length, 2);
  f.tick();
  assert.equal(f.sockets[1].sent.length, 0);
  f.sockets[1].readyState = 1; f.sockets[1].onopen(); f.tick();
  assert.equal(f.sockets[1].sent[0].type, 'keep-alive');
});
