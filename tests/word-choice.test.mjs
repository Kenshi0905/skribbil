import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../engine/internal/frontend/lobby.js', import.meta.url), 'utf8');
const start = source.indexOf('function promptWords(data)');
const prompt = source.slice(start, source.indexOf('\nfunction playWav(', start));
function client() {
  const summary = {dataset:{}}, preselected = {}, dialog = { style: {} }, container = { replaceChildren(...buttons) { this.buttons = buttons; } }, selections = [];
  const context = vm.createContext({ document: { getElementById: () => summary }, wordPreSelected: preselected, wordButtonContainer: container, wordDialog: dialog, createDialogButton: text => ({ text }), chooseWord: index => selections.push(index) });
  vm.runInContext(prompt, context);
  return { show: context.promptWords, summary, preselected, container, dialog, selections };
}

test('first turn renders every supplied word as a selectable button', () => {
  const ui = client();
  ui.show({ words: ['cat', 'dog', 'tree'], preSelectedWord: 1, hardWord: false });
  assert.equal(ui.summary.textContent, 'Choose one of these 3 words.');
  assert.equal(ui.summary.dataset.essential, 'false');
  assert.deepEqual(ui.container.buttons.map(b => b.text), ['cat', 'dog', 'tree']);
  assert.equal(ui.preselected.textContent, 'dog');
  ui.container.buttons.forEach(b => b.onclick());
  assert.deepEqual(ui.selections, [0, 1, 2]);
  assert.equal(ui.dialog.style.visibility, 'visible');
});

test('single words explain a carried penalty or a one-word room setting', () => {
  const ui = client();
  ui.show({ words: ['time travel'], preSelectedWord: 0, hardWord: true });
  assert.match(ui.summary.textContent, /Hard-word penalty.*one forced hard word/);
  assert.equal(ui.summary.dataset.essential, 'true');
  assert.equal(ui.container.buttons.length, 1);
  ui.show({ words: ['cat'], preSelectedWord: 0, hardWord: false });
  assert.match(ui.summary.textContent, /room is set to offer one word.*Edit settings/);
  ui.show({ words: ['cat', 'dog', 'tree'], preSelectedWord: 0, hardWord: false });
  assert.equal(ui.container.buttons.length, 3);
  assert.doesNotMatch(ui.summary.textContent, /penalty/);
});
