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
import { Media, validatePng, normalizePng } from '../server/media.mjs';

function sample() {
  const canvas=createCanvas(40,20),ctx=canvas.getContext('2d');
  ctx.fillStyle='#ab23fe';ctx.fillRect(0,0,40,20);
  return canvas.toBuffer('image/png');
}
test('PNG uploads reject arbitrary content and excessive dimensions before decoding',async()=>{
  assert.throws(()=>validatePng(Buffer.from('<svg onload="evil()"/>').toString('base64')));
  const bomb=sample();bomb.writeUInt32BE(1000000,16);
  assert.throws(()=>validatePng(bomb.toString('base64')),/1024/);
  assert.throws(()=>validatePng(Buffer.concat([sample(),Buffer.from('trailing content')]).toString('base64')));
  const normalized=await normalizePng(sample().toString('base64'));
  const image=await loadImage(normalized);assert.equal(image.width,256);assert.equal(image.height,256);
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
