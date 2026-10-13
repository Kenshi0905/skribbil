import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { loadImage } from '@napi-rs/canvas';
import { avatarOptions, avatarKeys, defaultAvatar, validateAvatar, avatarUrl, avatarFromUrl, renderAvatar, randomAvatar } from '../web/avatar.js';
import { openDatabase } from '../server/db.mjs';
import { createApp } from '../server/index.mjs';

test('every preset renders a valid image and retains stable, canonical choices', async () => {
  for (const key of avatarKeys) {
    for (let index=0; index<avatarOptions[key].length; index++) {
      const preset={...defaultAvatar,[key]:index};
      assert.deepEqual(avatarFromUrl(avatarUrl(preset)),preset);
      const image=await loadImage(Buffer.from(renderAvatar(preset)));
      assert.equal(image.width,200); assert.equal(image.height,200);
    }
  }
  assert.deepEqual(randomAvatar(()=>0),Object.fromEntries(avatarKeys.map(key=>[key,0])));
  assert.deepEqual(randomAvatar(()=>.999),Object.fromEntries(avatarKeys.map(key=>[key,avatarOptions[key].length-1])));
  for (const value of [null,[],{}, {...defaultAvatar,hair:-1}, {...defaultAvatar,eyes:99}, {...defaultAvatar,skin:1.5}, {...defaultAvatar,hair:'2'}, {...defaultAvatar,svg:'<script/>'}]) assert.throws(()=>validateAvatar(value));
  assert.equal(avatarFromUrl(avatarUrl(defaultAvatar).replace('/2-','/02-')),null);
  assert.equal(avatarFromUrl('/api/media/uploaded-image'),null);
});

test('profile presets persist across sessions, reject forged choices and serve safe public images', {timeout:60000}, async () => {
  const db=await openDatabase({url:'',dataDir:':memory:'});
  const app=await createApp({db,config:{secret:randomBytes(32).toString('hex'),origin:'',engineUrl:'http://127.0.0.1:1',secure:false,ranked:false}});
  await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
  const base=`http://127.0.0.1:${app.server.address().port}`; app.config.origin=base;
  const registered=await app.platform.register({username:'preset_owner',email:'preset@example.invalid',password:randomBytes(24).toString('hex')});
  const other=await app.platform.register({username:'preset_other',email:'otherpreset@example.invalid',password:randomBytes(24).toString('hex')});
  const preset={...defaultAvatar,hair:7,eyes:4,skin:5,hairColor:7,accessory:1};
  const patch=(value,token=registered.token)=>fetch(base+'/api/profile',{method:'PATCH',headers:{'Content-Type':'application/json','X-Requested-With':'Skribbil',Origin:base,...(token?{Cookie:`skribbil_session=${token}`}:{})},body:JSON.stringify(value)});
  try {
    assert.equal((await patch({avatarPreset:preset},null)).status,401);
    const saved=await patch({avatarPreset:preset}); assert.equal(saved.status,200);
    assert.deepEqual((await saved.json()).user.avatarPreset,preset);
    const refreshed=await app.platform.authenticate(registered.token);
    assert.equal(refreshed.avatar_url,avatarUrl(preset));
    assert.deepEqual((await app.platform.profile(refreshed)).avatarPreset,preset);
    assert.equal((await app.platform.profile(other.user)).avatarPreset,null);
    const secondToken=await db.transaction(tx=>app.platform.session(tx,registered.user.id));
    assert.deepEqual((await app.platform.profile(await app.platform.authenticate(secondToken))).avatarPreset,preset);
    for (const forged of [{...preset,hair:100}, {...preset,background:'red" onload="evil()'}, {...preset,svg:'<script/>'}, null]) assert.equal((await patch({avatarPreset:forged})).status,400);
    assert.equal((await patch({avatarPreset:{...preset,hair:1},cosmeticId:'invalid'})).status,400);
    assert.equal((await app.platform.profile(refreshed)).avatarUrl,avatarUrl(preset));
    const image=await fetch(base+avatarUrl(preset)); assert.equal(image.status,200);
    assert.match(image.headers.get('content-type'),/image\/svg\+xml/);
    assert.equal(image.headers.get('x-content-type-options'),'nosniff');
    assert.match(image.headers.get('content-security-policy'),/sandbox/);
    const svg=await image.text(); assert.equal(svg,renderAvatar(preset));
    assert.doesNotMatch(svg,/<script|onload=|href=/);
    const head=await fetch(base+avatarUrl(preset),{method:'HEAD'});assert.equal(head.status,200);assert.equal(await head.text(),'');
    assert.equal((await fetch(base+'/api/avatar-presets/v1/99-0-0-0-0-0-0-0-0.svg')).status,404);
    assert.equal((await fetch(base+avatarUrl(preset),{method:'POST'})).status,405);
    await patch({displayName:'Fresh scribbler',bio:'A new bio'});
    assert.deepEqual((await app.platform.profile(refreshed)).avatarPreset,preset,'other profile edits keep the avatar');
    await app.platform.updateProfile(refreshed,{avatarPreset:defaultAvatar});
    const concurrentProfile=await app.platform.profile(refreshed);
    assert.equal(concurrentProfile.displayName,'Fresh scribbler','an avatar-only update cannot overwrite newer profile edits');
    assert.equal(concurrentProfile.bio,'A new bio');
  } finally { await app.close(); }
});
