import { randomBytes } from 'node:crypto';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { openDatabase } from '../server/db.mjs';
import { Platform } from '../server/platform.mjs';
import { AssetStore } from '../server/assets.mjs';
import { Media, validatePng, normalizePng, validateImage, normalizeImage } from '../server/media.mjs';
import { defaultAvatar } from '../web/avatar.js';

function sample(format='image/png') {
  const canvas=createCanvas(40,20),ctx=canvas.getContext('2d');
  ctx.fillStyle='#ab23fe';ctx.fillRect(0,0,40,20);
  return canvas.toBuffer(format);
}
test('PNG uploads reject arbitrary content and excessive dimensions before decoding',async()=>{
  assert.throws(()=>validatePng(Buffer.from('<svg onload="evil()"/>').toString('base64')));
  const bomb=sample();bomb.writeUInt32BE(1000000,16);
  assert.throws(()=>validatePng(bomb.toString('base64')),/1024/);
  assert.throws(()=>validatePng(Buffer.concat([sample(),Buffer.from('trailing content')]).toString('base64')));
  const normalized=await normalizePng(sample().toString('base64'));
  const image=await loadImage(normalized);assert.equal(image.width,256);assert.equal(image.height,256);
});
test('JPEG uploads validate dimensions before decoding and normalize to a square PNG',async()=>{
  const jpeg=sample('image/jpeg');
  assert.deepEqual(validateImage(jpeg.toString('base64')),jpeg);
  const image=await loadImage(await normalizeImage(jpeg.toString('base64')));
  assert.equal(image.width,256);assert.equal(image.height,256);
  const badDimensions=Buffer.from(jpeg);
  let frame=-1;
  for(let i=0;i<badDimensions.length-10;i++)if(badDimensions[i]===255&&[0xc0,0xc2].includes(badDimensions[i+1])){frame=i;break;}
  assert.ok(frame>=0);badDimensions.writeUInt16BE(4000,frame+7);
  assert.throws(()=>validateImage(badDimensions.toString('base64')),/1024/);
  for(const bytes of [Buffer.from('<svg/>'),Buffer.from('GIF89a'),jpeg.subarray(0,-2),Buffer.concat([jpeg,Buffer.from('extra')])])assert.throws(()=>validateImage(bytes.toString('base64')));
});
test('avatars and team logos enforce ownership, invalidate old URLs and retain deletion metadata',{timeout:60000},async()=>{
  const db=await openDatabase({url:'',dataDir:':memory:'}),root=await mkdtemp(join(tmpdir(),'skribbil-media-'));
  const p=new Platform(db),media=new Media(p,new AssetStore({root,bucket:''}));
  try{
    const a=(await p.register({username:'avatar_owner',email:'avatar@example.test',password:randomBytes(24).toString('base64url')})).user;
    const b=(await p.register({username:'other_player',email:'other@example.test',password:randomBytes(24).toString('base64url')})).user;
    const input={png:sample().toString('base64')};
    const first=await media.upload(a,input);assert.match(first.url,/^\/api\/media\//);
    assert.ok((await media.read(first.url.split('/').at(-1))).body.length);
    const second=await media.upload(a,input);assert.notEqual(first.url,second.url);
    await assert.rejects(media.read(first.url.split('/').at(-1)),e=>e.status===404);
    assert.equal((await p.profile(a)).avatarUrl,second.url);
    await p.updateProfile(a,{avatarPreset:defaultAvatar});
    assert.deepEqual((await p.profile(a)).avatarPreset,defaultAvatar);
    await assert.rejects(media.read(second.url.split('/').at(-1)),e=>e.status===404);
    assert.ok((await db.query('SELECT expires_at FROM skribbil.object_assets WHERE id=$1',[second.url.split('/').at(-1)])).rows[0].expires_at);
    const replacement=await media.upload(a,{image:sample('image/jpeg').toString('base64')});
    assert.equal((await p.profile(a)).avatarPreset,null,'uploaded photos replace presets');
    assert.equal((await p.profile(a)).avatarUrl,replacement.url);
    const uploadedPhoto=await media.read(replacement.url.split('/').at(-1));
    const photo=await loadImage(uploadedPhoto.body);assert.equal(photo.width,256);assert.equal(photo.height,256);
    await media.remove(a);await assert.rejects(media.read(second.url.split('/').at(-1)),e=>e.status===404);
    const old=(await db.query(`SELECT expires_at FROM skribbil.object_assets WHERE id=$1`,[first.url.split('/').at(-1)])).rows[0];assert.ok(old.expires_at);
    const team=await p.createTeam(a,{name:'Image clan',tag:'IMG'});
    await assert.rejects(media.upload(b,input,team.id),e=>e.status===403);
    const logo=await media.upload(a,input,team.id);
    assert.ok((await media.read(logo.url.split('/').at(-1))).body.length);
    await assert.rejects(media.remove(b,team.id),e=>e.status===403);
    await media.remove(a,team.id);await assert.rejects(media.read(logo.url.split('/').at(-1)),e=>e.status===404);
    await db.query(`UPDATE skribbil.users SET status='suspended' WHERE id=$1`,[a.id]);
    await assert.rejects(media.upload(a,input),e=>e.status===403);
  }finally{await db.close();await rm(root,{recursive:true,force:true});}
});
