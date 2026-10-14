import test from 'node:test';
import assert from 'node:assert/strict';
import { renderGameResults } from '../engine/internal/frontend/resources/game-results.js';

function fixture() {
  const document = {createElement(tag) {
    return {tag, children: [], dataset: {}, attributes: {}, style: {setProperty() {}},
      className: '', classList: {values: [], add(value) {this.values.push(value);}},
      setAttribute(key, value) {this.attributes[key] = value;},
      appendChild(child) {this.children.push(child);},
      replaceChildren(...children) {this.children = children;}};
  }};
  const container = document.createElement('div');
  container.ownerDocument = document;
  return {container, options: {ownID: 'p6', random: () => .5, createAvatar: player => ({tag: 'avatar', id: player.id})}};
}
const player = (id, rank, extra = {}) => ({id, rank, name: id, score: 1000 - rank * 50, state: 'standby', connected: true, ...extra});

test('results show every participant with avatar and points, with a three-player podium', () => {
  const {container, options} = fixture();
  const players = Array.from({length: 10}, (_, i) => player(`p${i+1}`, i+1)).reverse();
  const originalOrder = players.map(p => p.id);
  const result = renderGameResults(container, players, options);
  const podium = container.children[2], rows = container.children[4].children;
  assert.equal(podium.children.length, 3);
  assert.deepEqual(rows.map(row => row.children[1].id), Array.from({length:10}, (_, i) => `p${i+1}`));
  assert.equal(rows[5].children[3].textContent, '700 points');
  assert.ok(rows[5].classList.values.includes('results-self'));
  assert.deepEqual(players.map(p => p.id), originalOrder);
  assert.equal(result.selfPlayer.id, 'p6');
  assert.equal(container.children[0].children.length, 48);
  renderGameResults(container, players, options);
  assert.equal(container.children.length, 5, 'a repeated ready event replaces the celebration');
});

test('ties keep server ranks and crown every winner; spectators and disconnected players cannot take the podium', () => {
  const {container, options} = fixture();
  const result = renderGameResults(container, [player('left', 1, {connected:false}), player('spectator', 1, {state:'spectating'}), player('<b>A</b>', 1), player('B', 1), player('C', 2)], options);
  assert.deepEqual(result.winners.map(p => p.id), ['<b>A</b>', 'B']);
  assert.equal(result.selfPlayer, undefined, 'a spectator has no personal finish');
  assert.equal(container.children[1].children[0].textContent, 'SHARED VICTORY');
  assert.equal(container.children[1].children[1].textContent, '<b>A</b> & B', 'names are inserted as text');
  const podium = container.children[2];
  assert.deepEqual(podium.children.map(place => place.children.at(-1).textContent), ['#1', '#1', '#2']);
  assert.ok(podium.children[0].classList.values.includes('results-champion'));
  assert.ok(podium.children[1].classList.values.includes('results-champion'));
  const rows = container.children[4].children;
  assert.equal(rows.length, 4);
  assert.equal(rows.at(-1).children[1].id, 'left');
  assert.equal(rows.at(-1).children[0].textContent, '—');
});

test('one-player and empty results render without assuming a full podium', () => {
  const {container, options} = fixture();
  renderGameResults(container, [player('solo', 1)], options);
  assert.equal(container.children[2].children.length, 1);
  renderGameResults(container, [], options);
  assert.equal(container.children[1].children[1].textContent, 'Great game!');
  assert.equal(container.children[4].children.length, 0);
});
