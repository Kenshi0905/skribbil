import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { avatarV2Options as avatarOptions, defaultAvatarV2 as defaultAvatar, editableAvatar, avatarVibes, avatarFromUrl, avatarUrl, renderAvatar, randomAvatar } from '../web/avatar.js';
import {defaultAvatar as legacyDefault} from '../web/avatar-v1.js';

const source=readFileSync(new URL('../web/app.js',import.meta.url),'utf8').replace(/^import .* from '\.\/avatar\.js';\r?\n/m,'');
const beforeListeners=source.slice(0,source.indexOf("document.addEventListener('click'"));
function setup(saved=null,failSave=false) {
  const nodes=new Map(),calls=[],focused=[];
  const element=selector=>{
    if (!nodes.has(selector)) nodes.set(selector,{innerHTML:'',style:{},classList:{remove(){}},querySelector:element,setAttribute(){},focus(){focused.push(selector);}});
    return nodes.get(selector);
  };
  const person={id:'avatar-ui-account',username:'avatar_test',displayName:'Test scribbler',avatarUrl:typeof saved==='string'?saved:saved?avatarUrl(saved):null};
  const context=vm.createContext({
    avatarOptions,defaultAvatar,editableAvatar,avatarVibes,avatarFromUrl,renderAvatar,randomAvatar,
    document:{querySelector:element,body:{style:{}}},location:{hash:'#/profile',search:'',origin:'http://localhost'},
    window:{matchMedia:()=>({matches:false})},requestAnimationFrame:fn=>fn(),URL,URLSearchParams,Intl,
    FormData:class { *[Symbol.iterator]() {} },AbortController,setTimeout,clearTimeout,
    fetch:async(path,options)=>{
      calls.push({path,options});
      if (path==='/api/profile' && failSave) return {ok:false,status:503,json:async()=>({error:'Please retry saving your look.'})};
      if (path==='/api/profile') person.avatarUrl=avatarUrl(JSON.parse(options.body).avatarPreset);
      return {ok:true,status:200,json:async()=>path==='/api/bootstrap'?{user:person}:{user:person}};
    },
  });
  vm.runInContext(`${beforeListeners}\ntoast=()=>{}; globalThis.ui={state,profilePage,avatarEditorModal,changeAvatar,openModal,closeModal,submitForm,resetAccountViews,handleAction,profileModal,topbar};`,context);
  context.ui.state.data={user:person};context.ui.state.route='profile';
  return {ui:context.ui,calls,focused,html:()=>element('#dialog-root').innerHTML};
}

test('profile editor previews choices without saving, keeps keyboard focus and cancels cleanly',()=>{
  const f=setup(); assert.match(f.ui.profilePage(),/data-action="avatar"/);assert.doesNotMatch(f.ui.profilePage(),/Customize avatar/);
  f.ui.openModal('avatar-editor');
  assert.match(f.html(),/Your avatar/); assert.match(f.html(),/Skin tone/);
  f.ui.changeAvatar('avatar-tab',{dataset:{key:'eyes'}});
  assert.match(f.html(),/aria-label="Eyes presets"/);
  f.ui.changeAvatar('avatar-choice',{dataset:{key:'eyes',value:'4'}});
  assert.equal(f.ui.state.avatarDraft.eyes,4); assert.match(f.html(),/Wink/);
  assert.match(f.focused.at(-1),/data-value="4"/);
  f.ui.changeAvatar('avatar-choice',{dataset:{key:'skin',value:'6'}});
  assert.equal(f.ui.state.avatarDraft.skin,6);
  assert.equal(f.calls.length,0);
  f.ui.closeModal(); assert.equal(f.ui.state.avatarDraft,null);
  f.ui.openModal('avatar-editor');assert.equal(f.ui.state.avatarDraft.eyes,defaultAvatar.eyes);
});

test('the Avatar section offers character or photo choices and opens on the current type',async()=>{
  const f=setup('/api/media/photo-test');await f.ui.handleAction('avatar',{dataset:{}});
  assert.equal(f.ui.state.avatarMode,'upload');
  assert.match(f.html(),/Build a character/);assert.match(f.html(),/Upload a photo/);
  assert.match(f.html(),/accept="image\/png,image\/jpeg,\.png,\.jpg,\.jpeg"/);
  assert.match(f.html(),/data-form="avatar"/);
  assert.doesNotMatch(f.ui.profileModal(),/data-form="avatar"/,'photo uploads belong in Avatar');
  await f.ui.handleAction('avatar-mode',{dataset:{mode:'preset'}});
  assert.match(f.html(),/data-form="avatar-preset"/);
  f.ui.changeAvatar('avatar-choice',{dataset:{key:'hair',value:'6'}});
  await f.ui.handleAction('avatar-mode',{dataset:{mode:'upload'}});
  await f.ui.handleAction('avatar-mode',{dataset:{mode:'preset'}});
  assert.equal(f.ui.state.avatarDraft.hair,6,'switching modes retains the character draft');
  assert.equal(f.calls.length,0,'choosing a mode does not replace the saved avatar');
});

test('saved choices reopen unchanged, reset stays a draft, and save sends the selected presets',async()=>{
  const saved={...defaultAvatar,hair:7,accessory:2};
  const f=setup(saved);f.ui.openModal('avatar-editor');
  assert.equal(f.ui.state.avatarDraft.hair,7);
  f.ui.changeAvatar('avatar-reset',{dataset:{}});assert.equal(f.ui.state.avatarDraft.hair,defaultAvatar.hair);
  f.ui.changeAvatar('avatar-choice',{dataset:{key:'hairColor',value:'8'}});
  const expected={...defaultAvatar,hairColor:8};
  f.ui.state.busy=true;f.ui.changeAvatar('avatar-choice',{dataset:{key:'eyes',value:'1'}});
  assert.equal(f.ui.state.avatarDraft.eyes,defaultAvatar.eyes);f.ui.state.busy=false;
  await f.ui.submitForm({dataset:{form:'avatar-preset'},querySelector(){return null;}});
  assert.equal(f.calls[0].path,'/api/profile');assert.equal(f.calls[0].options.method,'PATCH');
  assert.deepEqual(JSON.parse(f.calls[0].options.body),{avatarPreset:expected});
  assert.equal(f.ui.state.modal,null);assert.equal(f.ui.state.avatarDraft,null);
  f.ui.openModal('avatar-editor');assert.equal(f.ui.state.avatarDraft.hairColor,8);
});

test('randomization stays within the preset catalog and account changes discard the draft',()=>{
  const f=setup();f.ui.openModal('avatar-editor');f.ui.changeAvatar('avatar-random',{dataset:{}});
  assert.doesNotThrow(()=>avatarUrl(f.ui.state.avatarDraft));
  f.ui.changeAvatar('avatar-tab',{dataset:{key:'invalid'}});
  assert.equal(f.ui.state.avatarTab,'hair');
  f.ui.resetAccountViews();assert.equal(f.ui.state.avatarDraft,null);
});

test('a failed save keeps the chosen look available for retry',async()=>{
  const f=setup(null,true);f.ui.openModal('avatar-editor');
  f.ui.changeAvatar('avatar-choice',{dataset:{key:'hair',value:'6'}});
  const error={hidden:true,textContent:''};
  await f.ui.submitForm({dataset:{form:'avatar-preset'},querySelector(selector){return selector.includes('form-error')?error:null;}});
  assert.equal(f.ui.state.modal,'avatar-editor');assert.equal(f.ui.state.avatarDraft.hair,6);
  assert.equal(f.ui.state.busy,false);assert.equal(error.hidden,false);assert.match(error.textContent,/retry/);
  assert.equal(f.calls.length,1);
});


test('account and profile page use one settings window with profile, security and logout controls',async()=>{
  const f=setup(defaultAvatar);
  assert.match(f.ui.topbar(),/data-action="account-settings"/);
  const page=f.ui.profilePage();
  assert.match(page,/data-action="account-settings"/);
  assert.doesNotMatch(page,/Edit profile|data-action="edit-profile"/);
  await f.ui.handleAction('account-settings',{dataset:{}});
  assert.equal(f.ui.state.modal,'profile');
  const html=f.html();
  assert.match(html,/id="modal-title">Profile & settings/);
  assert.match(html,/data-form="profile"/);assert.match(html,/data-form="password"/);
  assert.match(html,/data-action="avatar"/);assert.match(html,/data-action="logout"/);
  assert.match(html,/data-action="go-profile"/);
});

test('settings floating window shows the saved preset or uploaded image immediately',()=>{
  for(const saved of [defaultAvatar,'/api/media/photo-test']){
    const f=setup(saved);
    const html=f.ui.profileModal();
    const url=typeof saved==='string'?saved:avatarUrl(saved);
    assert.ok(html.includes(`<img src="${url}" alt="" loading="eager"/>`));
    assert.match(html,/class="account-settings-heading"/);
    assert.match(html,/@avatar_test/);
  }
  const f=setup();assert.match(f.ui.profileModal(),/data-initial="TE"/);
});

test('opening legacy artwork preserves its preview and saving an edit migrates to v2',async()=>{
  const f=setup(legacyDefault);f.ui.openModal('avatar-editor');
  assert.ok(f.html().includes(renderAvatar(legacyDefault)));
  assert.equal(f.ui.state.avatarDraft.version,undefined);
  f.ui.changeAvatar('avatar-tab',{dataset:{key:'face'}});
  assert.equal(f.ui.state.avatarDraft.version,undefined,'a tab does not change the saved artwork');
  f.ui.changeAvatar('avatar-choice',{dataset:{key:'face',value:'5'}});
  assert.equal(f.ui.state.avatarDraft.version,2);assert.equal(f.ui.state.avatarDraft.face,5);
  await f.ui.submitForm({dataset:{form:'avatar-preset'},querySelector(){return null;}});
  f.ui.openModal('avatar-editor');assert.equal(f.ui.state.avatarDraft.face,5);
  f.ui.changeAvatar('avatar-vibe',{dataset:{value:'Anime'}});
  assert.equal(f.ui.state.avatarVibe,'Anime');assert.equal(f.ui.state.avatarDraft.version,2);
});
