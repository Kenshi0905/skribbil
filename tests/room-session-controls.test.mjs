import test from 'node:test';
import assert from 'node:assert/strict';
import { createRoomSessionControls } from '../engine/internal/frontend/resources/room-session-controls.js';

const sourceId = '11111111-1111-4111-8111-111111111111';
const targetId = '22222222-2222-4222-8222-222222222222';
function fixture(reply = () => ({ok:true, data:{closed:true}})) {
  const note = {}, error = {hidden:true}, retry = {hidden:true};
  const buttons = ['rematch','close','leave','retry'].map(action => ({dataset:{sessionAction:action}, closest() {return this;}}));
  let click;
  const actions = {hidden:true, querySelectorAll: () => buttons.slice(0,2)};
  const root = {hidden:true, contains: button=>buttons.includes(button),
    querySelector: selector=>({'.results-owner-actions':actions,'.results-session-note':note,'.results-session-error':error,'[data-session-action="retry"]':retry}[selector]),
    addEventListener: (_,fn)=>{click=fn;}};
  const calls = [], navigations = [];
  const controls = createRoomSessionControls(root, {matchId:sourceId, origin:'https://skribbil.test', navigate:url=>navigations.push(url),
    fetch:async (url,options)=> {calls.push({url,options});const response=await reply(url,options);return {ok:response.ok,json:async()=>response.data};}});
  return {root,note,error,retry,buttons,actions,calls,navigations,controls,
    click:action=>click({target:buttons.find(button=>button.dataset.sessionAction===action)})};
}

test('players remain on results with a waiting message; only the leader sees replay and delete', async () => {
  const f = fixture();
  f.controls.update({finished:true,isLeader:false,leaderName:'Kenshi'});
  assert.equal(f.root.hidden,false);assert.equal(f.actions.hidden,true);
  assert.match(f.note.textContent,/Kenshi/);assert.equal(f.navigations.length,0);
  await f.click('rematch');await f.click('close');assert.equal(f.calls.length,0);
  f.controls.update({finished:true,isLeader:true});assert.equal(f.actions.hidden,false);
  f.controls.update({finished:false,isLeader:true});assert.equal(f.root.hidden,true);
  await f.click('rematch');assert.equal(f.calls.length,0);
});

test('leader deletion and voluntary leaving return to rooms; guests never issue delete requests', async () => {
  const host = fixture();host.controls.update({finished:true,isLeader:true});
  await host.click('close');assert.equal(host.calls[0].url,`/api/rooms/${sourceId}/session`);
  assert.equal(JSON.parse(host.calls[0].options.body).action,'close');
  assert.equal(host.calls[0].options.headers['X-Requested-With'],'Skribbil');
  assert.deepEqual(host.navigations,['/#/skribbil']);
  const guest = fixture();guest.controls.update({finished:true,isLeader:false});
  await guest.click('leave');assert.equal(guest.calls.length,0);assert.deepEqual(guest.navigations,['/#/skribbil']);
});

test('failed leader requests retain the podium, display the reason, and can be retried', async () => {
  const f=fixture(()=>({ok:false,data:{error:'Wait for the completed match result before rematching.'}}));
  f.controls.update({finished:true,isLeader:true});await f.click('rematch');
  assert.equal(f.root.hidden,false);assert.equal(f.error.hidden,false);assert.match(f.error.textContent,/completed match result/);
  assert.equal(f.navigations.length,0);assert.ok(f.buttons.slice(0,2).every(button=>!button.disabled));
  await f.click('rematch');assert.equal(f.calls.length,2);
});

test('room broadcasts transfer each browser using its own admission and preserve the spectator role', async () => {
  const f=fixture(()=>({ok:true,data:{url:'/engine/league/join?ticket=own-ticket'}}));
  await f.controls.transition({matchId:targetId,role:'spectator'});
  assert.equal(f.calls[0].url,`/api/rooms/${targetId}/join`);
  assert.deepEqual(JSON.parse(f.calls[0].options.body),{role:'spectator'});
  assert.equal(f.calls[0].options.credentials,'same-origin');
  assert.deepEqual(f.navigations,['/engine/league/join?ticket=own-ticket']);
  await f.controls.transition({matchId:targetId,role:'spectator'});
  assert.equal(f.calls.length,1,'duplicate transition does not navigate twice');
});

test('transfer failures offer retry without navigating or sending users to another origin', async () => {
  let external=true;
  const f=fixture(()=>({ok:true,data:{url:external?'https://elsewhere.test/engine/league/join':'/engine/league/join?ticket=fresh'}}));
  await f.controls.transition({matchId:targetId,role:'player'});
  assert.equal(f.navigations.length,0);assert.equal(f.retry.hidden,false);assert.equal(f.error.hidden,false);
  external=false;await f.click('retry');assert.deepEqual(f.navigations,['/engine/league/join?ticket=fresh']);
});

test('double-clicking Play again makes one leader request while it is pending', async () => {
  let finish;
  const f=fixture(()=>new Promise(resolve=>{finish=resolve;}));
  f.controls.update({finished:true,isLeader:true});
  const first=f.click('rematch');await f.click('rematch');
  assert.equal(f.calls.length,1);assert.ok(f.buttons.slice(0,2).every(button=>button.disabled));
  finish({ok:false,data:{error:'Retry'}});await first;
});
