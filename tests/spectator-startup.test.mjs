import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// Exercise the production event dispatcher and spectator UI together. The
// ready handler deliberately renders players immediately, as the real one does.
const source = readFileSync(new URL('../engine/internal/frontend/lobby.js', import.meta.url), 'utf8');
const spectateStart = source.indexOf('function setSpectateMode(');
const spectateFunction = source.slice(spectateStart, source.indexOf('\n}', spectateStart) + 2);
const eventStart = source.indexOf('const handleEvent = (parsed) => {');
const eventFunction = source.slice(eventStart, source.indexOf('\n};', eventStart) + 3);

function client(initialMode = '') {
  const controls = new Map();
  const element = id => {
    if (!controls.has(id)) controls.set(id, { disabled: false, placeholder: 'Guess or chat', setAttribute(name, value) { this[name] = value; } });
    return controls.get(id);
  };
  const notices = [];
  const context = vm.createContext({
    document: { body: { dataset: initialMode ? { leagueMode: initialMode } : {} }, getElementById: element },
    messageInput: element('message-input'),
    messageInputPlaceholder: 'Guess or chat',
    spectating: false,
    spectateRequested: false,
    showInfoDialog: (...args) => notices.push(args),
    renderLeagueDislikes: () => {},
    galleryVoting: null, refreshProfileIdentity: () => {},
  });
  vm.runInContext(`${spectateFunction}\nfunction handleReadyEvent(data) { setSpectateMode(false, data.spectator); }\n${eventFunction}\nglobalThis.receive = handleEvent;`, context);
  return { context, controls, notices };
}

test('first managed ready packet disables spectator controls and uses the managed notice', () => {
  const { context, controls, notices } = client();
  context.receive({ type: 'ready', data: { leagueMode: 'private', spectator: true } });
  for (const id of ['ready-state-start', 'ready-state-game-over', 'message-input', 'message-send']) assert.equal(controls.get(id).disabled, true, id);
  assert.equal(controls.get('message-input').placeholder, 'Spectating — chat disabled');
  assert.match(notices[0][1], /Spectators cannot draw, chat, guess or vote/);
  context.receive({ type: 'ready', data: { leagueMode: 'private', spectator: true } });
  assert.equal(notices.length, 1, 'repeated state does not duplicate the notice');
});

test('SSR mode applies to player rendering even before a mode-bearing socket packet', () => {
  const { context, controls, notices } = client('private');
  vm.runInContext('setSpectateMode(false, true)', context);
  assert.equal(controls.get('message-input').disabled, true);
  assert.match(notices[0][1], /Spectators cannot draw, chat, guess or vote/);
});

test('unmanaged spectator behavior and managed participant chat remain available', () => {
  const native = client();
  native.context.receive({ type: 'ready', data: { spectator: true } });
  assert.equal(native.controls.get('message-input').disabled, false);
  assert.match(native.notices[0][1], /now-spectating-text/);
  const player = client();
  player.context.receive({ type: 'ready', data: { leagueMode: 'private', spectator: false } });
  assert.equal(player.controls.get('message-input').disabled, false);
  assert.equal(player.controls.get('ready-state-start').disabled, false);
  assert.equal(player.notices.length, 0);
});
