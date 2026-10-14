import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../engine/internal/frontend/lobby.js', import.meta.url), 'utf8');
const reactions = source.slice(source.indexOf('let leagueDislikes = null;'), source.indexOf('const handleEvent = (parsed) => {'));
function client() {
  const nodes = new Map(), sent = [];
  const node = id => {
    if (!nodes.has(id)) nodes.set(id, {disabled:true, hidden:true, setAttribute(name,value) { this[name]=value; }, addEventListener(type,callback) { this[type]=callback; }});
    return nodes.get(id);
  };
  const context = vm.createContext({document:{getElementById:node}, ownID:'guesser', WebSocket:{OPEN:1}, socket:{readyState:1, send:data=>sent.push(JSON.parse(data))}});
  vm.runInContext(`${reactions}\nglobalThis.update=renderLeagueDislikes;`,context);
  return {update:context.update,node,sent};
}
const turn = {active:true,turnId:5,eligible:['guesser','other'],voters:[],likers:[],votes:0,likes:0};

test('compact reactions send the current turn and reflect confirmed votes', () => {
  const ui=client(); ui.update(turn);
  assert.equal(ui.node('drawing-reactions').hidden,false);
  ui.node('league-like-button').click();
  assert.deepEqual(ui.sent,[{type:'like-drawing',data:{turnId:5}}]);
  ui.update({...turn,likers:['guesser'],likes:1});
  assert.equal(ui.node('league-like-count').textContent,1);
  assert.equal(ui.node('league-like-button')['aria-pressed'],'true');
  assert.equal(ui.node('league-like-button').disabled,true);
  assert.equal(ui.node('league-dislike-button').disabled,false);
  ui.node('league-dislike-button').click();
  assert.deepEqual(ui.sent[1],{type:'dislike-drawing',data:{turnId:5}});
  ui.update({...turn,voters:['guesser'],votes:1});
  assert.equal(ui.node('league-dislike-button')['aria-pressed'],'true');
  assert.equal(ui.node('league-like-button')['aria-pressed'],'false');
  ui.node('league-dislike-button').click(); ui.node('league-like-button').click();
  assert.equal(ui.sent.length,2);
});

test('artists, spectators, inactive turns and applied penalties cannot react', () => {
  const ui=client();
  for (const state of [{...turn,eligible:['other']},{...turn,active:false},{...turn,applied:true},{...turn,turnId:0}]) {
    ui.update(state);
    assert.equal(ui.node('league-like-button').disabled,true);
    assert.equal(ui.node('league-dislike-button').disabled,true);
    ui.node('league-like-button').click(); ui.node('league-dislike-button').click();
  }
  assert.equal(ui.sent.length,0);
  ui.update({...turn,active:false});
  assert.equal(ui.node('drawing-reactions').hidden,true);
});
