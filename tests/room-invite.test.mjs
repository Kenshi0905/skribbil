import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../engine/internal/frontend/lobby.js', import.meta.url), 'utf8');
const copyInvite = source.slice(source.indexOf('const copyRoomInvite ='), source.indexOf('const dislikeButton ='));

function setup({ clipboardFails = false } = {}) {
  const timers = new Map(), copied = [];
  let nextTimer = 0;
  const button = { dataset: { roomId: 'room-123' }, addEventListener(type, fn) { this[type] = fn; } };
  const input = { hidden: true, focus() { this.focused = true; }, select() { this.selected = true; } };
  const status = { textContent: '' };
  const nodes = { 'copy-room-invite': button, 'room-invite-link': input, 'room-invite-status': status };
  vm.runInNewContext(copyInvite, {
    document: { getElementById: id => nodes[id] }, URL,
    location: { origin: 'https://skribbil.example' },
    navigator: { clipboard: { async writeText(value) { if (clipboardFails) throw Error('Denied'); copied.push(value); } } },
    setTimeout(fn, ms) { timers.set(++nextTimer, { fn, ms }); return nextTimer; },
    clearTimeout(id) { timers.delete(id); },
  });
  return { button, input, status, timers, copied };
}

test('copy confirmation disappears after three seconds and repeated copies restart the timer', async () => {
  const ui = setup();
  await ui.button.click();
  assert.deepEqual(ui.copied, ['https://skribbil.example/?join=room-123']);
  assert.match(ui.status.textContent, /copied/);
  const firstTimer = [...ui.timers.keys()][0];
  await ui.button.click();
  assert.equal(ui.timers.has(firstTimer), false);
  assert.equal(ui.timers.size, 1);
  const timer = [...ui.timers.values()][0];
  assert.equal(timer.ms, 3000);
  timer.fn();
  assert.equal(ui.status.textContent, '');
  assert.equal(ui.input.hidden, true);
});

test('clipboard failure keeps the manual copy link selected and instructions visible', async () => {
  const ui = setup({ clipboardFails: true });
  await ui.button.click();
  assert.equal(ui.input.hidden, false);
  assert.equal(ui.input.focused, true);
  assert.equal(ui.input.selected, true);
  assert.match(ui.status.textContent, /selected link/);
  assert.equal(ui.timers.size, 0);
});

test('confirmation timeout does not erase a later room error', async () => {
  const ui = setup();
  await ui.button.click();
  ui.status.textContent = 'Could not leave the room.';
  [...ui.timers.values()][0].fn();
  assert.equal(ui.status.textContent, 'Could not leave the room.');
});
