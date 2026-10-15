import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../engine/internal/frontend/lobby.js', import.meta.url), 'utf8');
const formatters = source.slice(source.indexOf('function drawingDislikeMessage('), source.indexOf('const handleEvent = (parsed) => {'));
const start = source.indexOf('const handleEvent = (parsed) => {');
const dispatcher = source.slice(start, source.indexOf('\n};', start) + 3);
function client() {
  const messages = [], alerts = [], document = { location: { href: '' } };
  const context = vm.createContext({ document, ownID: 'self', appendMessage: (...args) => messages.push(args), alert: message => alerts.push(message), renderLeagueDislikes() {} });
  vm.runInContext(`${formatters}\n${dispatcher}\nglobalThis.receive=handleEvent;`, context);
  return { receive: context.receive, messages, alerts, document };
}

test('chat names dislike voters and counts down to the actual penalty', () => {
  const ui = client();
  const data = { voterName: 'Alice', artistName: 'Bob', votes: 1, required: 3, applied: false };
  ui.receive({ type: 'drawing-disliked', data });
  assert.equal(ui.messages.at(-1)[2], "Alice disliked Bob's drawing (1/3). 2 more dislikes needed for a penalty.");
  ui.receive({ type: 'drawing-disliked', data: { ...data, voterName: 'Charlie', votes: 2 } });
  assert.match(ui.messages.at(-1)[2], /Charlie.*\(2\/3\).*1 more dislike needed/);
  ui.receive({ type: 'drawing-disliked', data: { ...data, voterName: 'Dana', votes: 3, applied: true } });
  assert.equal(ui.messages.at(-1)[2], "Dana disliked Bob's drawing (3/3). Bob loses 100 points and gets a hard word next turn.");
  ui.receive({ type: 'dislike-state', data: { votes: 3, required: 3, applied: true } });
  assert.equal(ui.messages.length, 3, 'state refreshes do not replay announcements');
});

test('kick announcements name voters, report votes left, and announce removal', () => {
  const ui = client();
  const data = { voterName: 'Alice', playerName: 'Bob', playerId: 'target', voteCount: 1, requiredVoteCount: 3 };
  ui.receive({ type: 'kick-vote', data });
  assert.equal(ui.messages.at(-1)[2], 'Alice voted to kick Bob (1/3). 2 more votes needed to kick.');
  ui.receive({ type: 'kick-vote', data: { ...data, voterName: 'Charlie', voteCount: 2 } });
  assert.match(ui.messages.at(-1)[2], /Charlie.*1 more vote needed to kick/);
  ui.receive({ type: 'kick-vote', data: { ...data, voterName: 'Dana', voteCount: 3 } });
  assert.equal(ui.messages.at(-1)[2], 'Dana voted to kick Bob (3/3). Bob was kicked.');
  assert.equal(ui.alerts.length, 0);
  ui.receive({ type: 'kick-vote', data: { ...data, playerId: 'self', voteCount: 3 } });
  assert.equal(ui.alerts.length, 1, 'the kicked player still receives their removal alert');
});
