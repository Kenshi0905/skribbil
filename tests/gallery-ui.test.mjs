import test from 'node:test';import assert from 'node:assert/strict';
import {createGalleryVoting} from '../web/gallery-votes.js';
function setup(turns){
 class Element {
  constructor(tag){this.tag=tag;this.children=[];this.events={};this.attrs={};this.hidden=false;this.disabled=false;this.textContent='';}
  append(...items){this.children.push(...items);}replaceChildren(...items){this.children=items;}setAttribute(k,v){this.attrs[k]=v;}
  addEventListener(k,fn){this.events[k]=fn;}querySelectorAll(tag){return this.children.flatMap(c=>[...((tag==='button[aria-pressed]'?c.tag==='button'&&c.attrs['aria-pressed']!==undefined:c.tag===tag)?[c]:[]),...c.querySelectorAll(tag)]);}
 }
 const root=new Element('aside');const doc={createElement:tag=>new Element(tag)};const requests=[];
 const fetcher=async(path,options)=>{requests.push({path,options});if(options.method==='POST'){const vote=JSON.parse(options.body);turns[0].choice=vote.choice;return {ok:true,json:async()=>({ok:true})};}return {ok:true,json:async()=>({turns})};};
 const ui=createGalleryVoting(root,{roomCode:'test-room',fetcher,document:doc,hidden:()=>false});
 return {root,ui,requests,settle:()=>new Promise(r=>setImmediate(r))};
}
const turn={turnId:'abc',artist:'<literal name>',prompt:'cat',fame:1,shame:0,minimum:3,percent:67,open:true,eligible:true,choice:null,decision:'no-decision'};
test('gallery controls submit one authenticated vote without emitting a game socket command',async()=>{
 const f=setup([{...turn}]);try{await f.settle();const buttons=f.root.querySelectorAll('button[aria-pressed]');assert.equal(buttons[0].disabled,false);assert.match(buttons[0].textContent,/Fame/);
 await buttons[0].events.click();await f.settle();const posts=f.requests.filter(r=>r.options.method==='POST');assert.equal(posts.length,1);assert.equal(posts[0].options.headers['X-Requested-With'],'Skribbil');assert.equal(JSON.parse(posts[0].options.body).choice,'fame');assert.ok(f.root.querySelectorAll('button[aria-pressed]').every(b=>b.disabled));
 }finally{f.ui.dispose();}
});

test('voting history never hides the compact slot and repeated clicks cannot send two choices',async()=>{
 const f=setup([{...turn}]);try{
  await f.settle();assert.equal(f.root.hidden,false);
  const buttons=f.root.querySelectorAll('button[aria-pressed]');
  await Promise.all([buttons[0].events.click(),buttons[1].events.click()]);await f.settle();
  assert.equal(f.requests.filter(r=>r.options.method==='POST').length,1);
 }finally{f.ui.dispose();}
 const empty=setup([]);try{await empty.settle();assert.equal(empty.root.hidden,false,'empty and completed histories retain the same layout slot');}finally{empty.ui.dispose();}
});
test('closed, self/spectator and already-voted snapshots are visibly disabled',async()=>{
 for(const patch of [{open:false},{eligible:false},{choice:'shame'}]){const f=setup([{...turn,...patch}]);try{await f.settle();assert.ok(f.root.querySelectorAll('button[aria-pressed]').every(b=>b.disabled));}finally{f.ui.dispose();}}
});

test('the phone history has a close action even when its summary is hidden',async()=>{
 const f=setup([{...turn}]);try{await f.settle();const history=f.root.children[1];history.open=true;
 const dismiss=f.root.querySelectorAll('button').find(b=>b.attrs['aria-label']==='Close drawing votes');
 assert.ok(dismiss);assert.equal(dismiss.disabled,false);dismiss.events.click();assert.equal(history.open,false);
 }finally{f.ui.dispose();}
});
