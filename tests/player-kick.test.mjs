import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../engine/internal/frontend/lobby.js', import.meta.url), 'utf8');
const controls = source.slice(source.indexOf('let kickTargetID = null;'), source.indexOf('function showNameChangeDialog()'));
const vote = source.slice(source.indexOf('function onVotekickPlayer('), source.indexOf('//This automatically scrolls down'));
function client({spectating=false,mode='private'}={}) {
  const nodes = new Map(), sent = [], listeners = {};
  const element = tag => ({tag, children:[], style:{}, classList:{add(){}}, setAttribute(name,value){this[name]=value;}, addEventListener(){}, appendChild(child){this.children.push(child);}, focus(){this.focused=true;}});
  const node = id => { if (!nodes.has(id)) nodes.set(id,element('div')); return nodes.get(id); };
  const players = [{id:'self',name:'You',connected:true},{id:'target',name:'<img src=x onerror=alert(1)>',connected:true},{id:'other',name:'Other player',connected:true}];
  const context=vm.createContext({
    ownID:'self',spectating,WebSocket:{OPEN:1},socket:{readyState:1,send:data=>sent.push(JSON.parse(data))},
    document:{body:{dataset:{leagueMode:mode}},createElement:element,getElementById:node,addEventListener:(type,handler)=>{listeners[type]=handler;}},
    kickDialog:node('kick-dialog'),kickDialogPlayers:node('kick-dialog-players'),hideMenu(){},getCachedPlayer:id=>players.find(p=>p.id===id),
  });
  vm.runInContext(`${controls}\n${vote}\nglobalThis.ui={createPlayerName,showKickDialog,hideKickDialog};`,context);
  return {...context.ui,players,sent,node,listeners};
}

test('a player name opens one targeted vote action and uses the existing kick protocol',()=>{
  const ui=client();
  const name=ui.createPlayerName(ui.players[1]);
  assert.equal(name.tag,'button');
  assert.equal(name['aria-haspopup'],'dialog');
  assert.equal(name.innerText,ui.players[1].name);
  name.onclick();
  assert.equal(ui.sent.length,0,'opening player actions must not cast a vote');
  const [label,action]=ui.node('kick-dialog-players').children;
  assert.equal(label.innerText,ui.players[1].name);
  assert.equal(action.focused,true);
  action.onclick();
  assert.deepEqual(ui.sent,[{type:'kick-vote',data:'target'}]);
  assert.equal(ui.node('kick-dialog').style.visibility,'hidden');
  assert.equal(ui.node('playername-target').focused,true);
});

test('self, disconnected players and managed spectators cannot open kick actions',()=>{
  const ui=client();
  assert.equal(ui.createPlayerName(ui.players[0]).tag,'span');
  ui.showKickDialog('self'); ui.showKickDialog('missing');
  ui.players[1].connected=false;
  ui.showKickDialog('target');
  assert.equal(ui.node('kick-dialog-players').children.length,0);
  const spectator=client({spectating:true});
  assert.equal(spectator.createPlayerName(spectator.players[1]).tag,'span');
  spectator.showKickDialog('target');
  assert.equal(spectator.node('kick-dialog-players').children.length,0);
});

test('confirmation rechecks connection state and Escape closes without voting',()=>{
  const ui=client();
  ui.showKickDialog('target');
  ui.players[1].connected=false;
  ui.node('kick-dialog-players').children[1].onclick();
  assert.equal(ui.sent.length,0);
  ui.showKickDialog('other');
  ui.listeners.keydown({key:'Escape'});
  assert.equal(ui.node('kick-dialog').style.visibility,'hidden');
  assert.equal(ui.sent.length,0);
});
