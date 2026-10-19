import test from 'node:test';
import assert from 'node:assert/strict';
import { createRoomLook, roomRules, roomDisplayName } from '../web/room-look.js';
import { avatarUrl, defaultAvatar } from '../web/avatar.js';
import {avatarV2Options,avatarV2Keys,avatarVibes} from '../web/avatar.js';

function fixture(role='member') {
  const doc={activeElement:null,createElement(tag){return new Element(tag);}};
  class Element {
    constructor(tag){this.tag=tag;this.children=[];this.events={};this.attrs={};this.hidden=false;this.disabled=false;this.textContent='';}
    setAttribute(k,v){this.attrs[k]=v;}
    append(...nodes){for(const n of nodes){n.parent=this;this.children.push(n);}}
    replaceChildren(...nodes){this.children=[];this.append(...nodes);}
    addEventListener(k,fn){this.events[k]=fn;}
    remove(){this.parent.children=this.parent.children.filter(c=>c!==this);}
    contains(el){return this===el||this.children.some(c=>c.contains(el));}
    focus(){doc.activeElement=this;}
    click(){if(!this.disabled)this.events.click?.({preventDefault(){}});}
    fire(type){this.events[type]?.({preventDefault(){}});}
  }
  globalThis.document=doc;
  const root=new Element('section'),sent=[];let connected=true,focusedAfter=false,settingsOpened=0;
  const ui=createRoomLook(root,{send:e=>sent.push(e),isConnected:()=>connected,focusAfterStart:()=>{focusedAfter=true;},editSettings:()=>{settingsOpened++;}});
  const profile={displayName:'Permanent name',avatarUrl:'/api/media/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'};
  const players=[{id:'host',name:'Host',state:'standby',connected:true},{id:'member',name:profile.displayName,avatarUrl:profile.avatarUrl,state:'standby',connected:true},{id:'spec',name:'Viewer',state:'spectating',connected:true}];
  const snapshot={ownID:role==='member'?'member':role==='host'?'host':'spec',ownerID:'host',players,profileIdentity:profile,gameState:'unstarted'};
  ui.update(snapshot);
  const all=(el=root)=>[el,...el.children.flatMap(c=>all(c))];
  const find=(tag,text)=>all().find(el=>el.tag===tag&&(el.textContent===text||el.id===text));
  const isShown=el=>el&&!el.hidden&&(!el.parent||isShown(el.parent));
  return {ui,root,doc,sent,players,profile,snapshot,find,all,isShown,disconnect(){connected=false;ui.disconnect();},reconnect(){connected=true;ui.update(snapshot);},focusedAfter:()=>focusedAfter,settingsOpened:()=>settingsOpened};
}
test('host has customization and gated Start, guests Ready, spectators read-only; transfer recalculates',()=>{
  const f=fixture('host');assert.ok(f.isShown(f.find('button','Edit room look')));assert.ok(f.isShown(f.find('button','Start game')));assert.equal(f.isShown(f.find('input','room-ready')),false);
  assert.equal(f.find('button','Start game').disabled,true);f.players[1].state='ready';f.ui.update(f.snapshot);assert.equal(f.find('button','Start game').disabled,false);
  f.ui.update({...f.snapshot,ownerID:'member'});assert.equal(f.isShown(f.find('button','Start game')),false);assert.ok(f.isShown(f.find('input','room-ready')));
  const member=fixture();assert.equal(member.isShown(member.find('button','Start game')),false);assert.ok(member.isShown(member.find('input','room-ready')));
  const spec=fixture('spectator');assert.equal(spec.isShown(spec.find('button','Edit room look')),false);assert.equal(spec.isShown(spec.find('input','room-ready')),false);assert.equal(spec.isShown(spec.find('button','Start game')),false);
  assert.ok(spec.all().some(n=>n.textContent==='Spectating'));
});
test('room customization drafts, cancel, restore, error and retry never call a profile API',()=>{
  const f=fixture();f.find('button','Edit room look').click();const name=f.find('input','room-display-name');assert.equal(f.doc.activeElement,name);
  name.value='<img src=x onerror=evil()> ';name.fire('input');assert.ok(f.all().some(n=>n.tag==='strong'&&n.textContent===name.value.trim()));assert.equal(f.sent.length,0);
  f.find('select','room-hair').value='7';f.find('select','room-hair').fire('change');
  f.find('button','Cancel').click();assert.equal(f.sent.length,0);assert.equal(f.doc.activeElement,f.find('button','Edit room look'));
  f.find('button','Edit room look').click();assert.equal(name.value,'Permanent name');
  name.value='New room name';name.fire('input');f.find('button','⚄ Surprise me').click();f.find('button','Use my profile look').click();assert.equal(name.value,f.profile.displayName);
  name.value='Draft for retry';name.fire('input');f.find('form','').fire('submit');assert.deepEqual(f.sent[0],{type:'room-identity-change',data:{displayName:'Draft for retry',avatarUrl:f.profile.avatarUrl}});
  assert.equal(f.root.attrs['aria-busy'],'true');f.find('form','').fire('submit');assert.equal(f.sent.length,1);
  f.ui.result({action:'room-identity-change',error:'Please choose a valid look.'});assert.equal(name.value,'Draft for retry');assert.ok(f.isShown(f.find('p','Please choose a valid look.')));
  f.find('form','').fire('submit');assert.equal(f.sent.length,2);
  f.players[1].name='Draft for retry';f.ui.update(f.snapshot);f.ui.result({action:'room-identity-change'});assert.equal(f.find('form','').hidden,true);assert.equal(f.doc.activeElement,f.find('button','Edit room look'));
});
test('empty names, disconnects and late callbacks preserve boundaries and initials fallback',()=>{
  const f=fixture();f.find('button','Edit room look').click();const name=f.find('input','room-display-name');name.value='  ';name.fire('input');f.find('form','').fire('submit');assert.equal(f.sent.length,0);
  name.value='Keep this';name.fire('input');f.find('form','').fire('submit');f.disconnect();assert.equal(name.value,'Keep this');assert.equal(name.disabled,true);f.reconnect();assert.equal(name.disabled,false);
  const img=f.all().find(n=>n.tag==='img');const holder=img.parent;img.fire('error');assert.ok(!holder.children.includes(img));assert.ok(holder.textContent.length>0);
  name.focus();f.ui.update({...f.snapshot,gameState:'ongoing'});assert.ok(f.root.hidden);assert.ok(f.focusedAfter());f.find('form','').fire('submit');assert.equal(f.sent.length,1);
  f.ui.result({action:'room-identity-change'});assert.ok(f.root.hidden);
});
test('readiness excludes host, spectators and offline seats',()=>{
  const rules=roomRules({ownID:'h',ownerID:'h',gameState:'unstarted',players:[{id:'h',state:'standby',connected:true},{id:'g',state:'ready',connected:true},{id:'s',state:'spectating',connected:true},{id:'off',state:'standby',connected:false}]});
  assert.equal(rules.canStart,true);assert.equal(rules.needed,1);assert.equal(rules.ready,1);
});

test('room preview uses the same Unicode character limit and control stripping as the server',()=>{assert.equal(roomDisplayName('  '+ '界'.repeat(35)), '界'.repeat(30));assert.equal(roomDisplayName('\u202eMoon\n'), 'Moon');});

test('compact preview updates every feature and vibe locally, while roster stays authoritative',()=>{
  for(const role of ['host','member']){
    const f=fixture(role),preview=()=>f.all().find(n=>n.className==='room-look-preview');
    assert.match(preview().attrs['aria-label'],/Room look preview for/);
    assert.ok(f.all().some(n=>n.textContent==='ROOM LOOK PREVIEW'));
    f.find('button','Edit room look').click();
    for(const key of avatarV2Keys){const control=f.find('select','room-'+key);control.value=String(avatarV2Options[key].length-1);control.fire('change');assert.equal(f.sent.length,0);assert.ok(preview().children.some(n=>n.textContent==='Not applied yet'));}
    for(const v of avatarVibes){f.find('button',v).click();assert.equal(f.sent.length,0);}
    const name=f.find('input','room-display-name');name.value='<script>draft</script>';name.fire('input');assert.ok(preview().children.some(n=>n.textContent===name.value));
    assert.ok(!f.players.some(player=>player.name.includes('draft')),'drafts do not mutate the authoritative roster');
    f.find('button','Use my profile look').click();assert.equal(f.sent.length,0);
    f.find('button','Cancel').click();assert.ok(preview().children.some(n=>n.textContent===f.players.find(p=>p.id===f.snapshot.ownID).name));
    assert.ok(!preview().children.some(n=>n.textContent==='Not applied yet'));
  }
});


test('waiting room exposes settings to the private leader and keeps shared summaries current',()=>{
  const f=fixture('host');
  const settings={drawingTime:80,rounds:3,maxPlayers:12,wordsPerTurn:3};
  f.ui.update({...f.snapshot,mode:'private',settings});
  const edit=f.find('button','Edit settings');
  assert.ok(f.isShown(edit));edit.click();assert.equal(f.settingsOpened(),1);
  assert.ok(f.all().some(n=>n.textContent==='80 sec'));
  assert.ok(f.all().some(n=>n.textContent==='2 / 12'));
  f.ui.update({...f.snapshot,mode:'private',settings:{...settings,drawingTime:90}});
  assert.ok(f.all().some(n=>n.textContent==='90 sec'));
  f.ui.update({...f.snapshot,mode:'ranked',settings});
  assert.equal(f.isShown(edit),false);edit.click();assert.equal(f.settingsOpened(),1);
  assert.ok(f.all().some(n=>n.textContent==='Ranked settings are locked.'));
  f.ui.update({...f.snapshot,mode:'private',ownerID:'member',settings});
  assert.equal(f.isShown(edit),false);edit.click();assert.equal(f.settingsOpened(),1);
  const guest=fixture();guest.find('button','Edit settings').click();assert.equal(guest.settingsOpened(),0);
  assert.equal(guest.isShown(guest.find('button','Edit settings')),false);
  const host=fixture('host');host.disconnect();assert.equal(host.find('button','Edit settings').disabled,true);
});

test('ready checkbox holds its intended state while waiting for an authoritative acknowledgement',()=>{
 const f=fixture();const ready=f.find('input','room-ready');ready.checked=true;ready.fire('change');
 assert.equal(ready.checked,true);assert.equal(ready.disabled,true);
 f.ui.result({action:'toggle-readiness',error:'Try again'});assert.equal(ready.checked,false);
 assert.equal(ready.disabled,false);
});

test('room editor tabs expose the complete original catalogs and thumbnail choices remain unapplied',()=>{
 const f=fixture();f.find('button','Edit room look').click();
 const groups={Face:['face','eyes','eyebrows','nose','mouth','ears'],Hair:['hair'],Colors:['skin','hairColor','shirtColor','background'],Extras:['accessory']};
 for(const [label,keys] of Object.entries(groups)){
  const tab=f.all().find(n=>n.attrs.role==='tab'&&n.textContent===label);tab.click();
  assert.equal(tab.attrs['aria-selected'],'true');
  for(const key of avatarV2Keys)assert.equal(f.find('select','room-'+key).parent.hidden,!keys.includes(key));
  const choices=f.all().filter(n=>n.className==='room-avatar-choice');
  assert.equal(choices.length,avatarV2Options[keys[0]].length);
  assert.ok(choices.every(c=>c.children[0].src.startsWith('/api/avatar-presets/v2/')));
  choices.at(-1).click();assert.equal(f.find('select','room-'+keys[0]).value,String(choices.length-1));
  assert.equal(f.sent.length,0);
 }
 f.find('button','Cancel').click();assert.equal(f.sent.length,0);
 f.find('button','Edit room look').click();assert.equal(f.find('input','room-display-name').value,f.profile.displayName);
});
