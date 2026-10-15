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
import {createApp} from '../server/index.mjs';

function sample(format='image/png') {
  const canvas=createCanvas(40,20),ctx=canvas.getContext('2d');
  ctx.fillStyle='#ab23fe';ctx.fillRect(0,0,40,20);
  return canvas.toBuffer(format);
}
test('private-storage profile photos are served inline to other players and public leaderboards',{timeout:60000},async()=>{
  const db=await openDatabase({url:'',dataDir:':memory:'});
  const assets=new AssetStore({bucket:'profile-photo-fixture'}),objects=new Map();
  // Exercise the production S3 byte-download path without external storage.
  assets.s3={async send(command){
    const {Key,Body}=command.input;
    if(command.constructor.name==='PutObjectCommand'){objects.set(Key,Buffer.from(Body));return {};}
    if(command.constructor.name==='GetObjectCommand')return {Body:{async transformToByteArray(){return objects.get(Key);}}};
    if(command.constructor.name==='DeleteObjectCommand'){objects.delete(Key);return {};}
    throw Error('Unexpected storage operation');
  }};
  const app=await createApp({db,assets,config:{secret:randomBytes(32).toString('hex'),origin:'',secure:false}});
  await new Promise(r=>app.server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${app.server.address().port}`;app.config.origin=base;
  try{
    const owner=await app.platform.register({username:'stored_photo_owner',email:'stored-photo@example.test',password:randomBytes(24).toString('hex')});
    const viewer=await app.platform.register({username:'stored_photo_viewer',email:'stored-viewer@example.test',password:randomBytes(24).toString('hex')});
    const media=new Media(app.platform,assets);
    const {url}=await media.upload(owner.user,{image:sample().toString('base64')});
    for(const token of [owner.token,viewer.token,null]){
      const response=await fetch(base+url,{redirect:'manual',headers:token?{Cookie:`skribbil_session=${token}`}:{}});
      assert.equal(response.status,200,'profile pictures must not redirect outside the page image policy');
      assert.equal(response.headers.get('location'),null);
      assert.equal(response.headers.get('content-type'),'image/png');
      assert.equal(response.headers.get('cache-control'),'no-store');
      const image=await loadImage(Buffer.from(await response.arrayBuffer()));
      assert.equal(image.width,512);assert.equal(image.height,512);
    }
    await media.remove(owner.user);
    assert.equal((await fetch(base+url)).status,404,'removed profile pictures stay unavailable');
  }finally{await app.close();}
});
test('PNG uploads reject arbitrary content and excessive dimensions before decoding',async()=>{
  assert.throws(()=>validatePng(Buffer.from('<svg onload="evil()"/>').toString('base64')));
  const bomb=sample();bomb.writeUInt32BE(1000000,16);
  assert.throws(()=>validatePng(bomb.toString('base64')),/corrupt/);
  assert.throws(()=>validatePng(Buffer.concat([sample(),Buffer.from('trailing content')]).toString('base64')));
  const normalized=await normalizePng(sample().toString('base64'));
  const image=await loadImage(normalized);assert.equal(image.width,512);assert.equal(image.height,512);
});

test('authenticated non-admin uploads validate real formats and cannot target another profile',{timeout:60000},async()=>{
  const db=await openDatabase({url:'',dataDir:':memory:'}),root=await mkdtemp(join(tmpdir(),'skribbil-http-photo-'));
  const app=await createApp({db,assets:new AssetStore({root,bucket:''}),config:{secret:randomBytes(32).toString('hex'),origin:'',secure:false}});
  await new Promise(r=>app.server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${app.server.address().port}`;app.config.origin=base;
  const a=await app.platform.register({username:'http_photo_owner',email:'http_photo@example.invalid',password:randomBytes(24).toString('hex')}),b=await app.platform.register({username:'http_other_photo',email:'http_other@example.invalid',password:randomBytes(24).toString('hex')});
  const upload=(image,token=a.token)=>fetch(base+'/api/profile/avatar',{method:'POST',headers:{Origin:base,'X-Requested-With':'Skribbil','Content-Type':'application/json',...(token?{Cookie:`skribbil_session=${token}`}:{})},body:JSON.stringify({image,userId:b.user.id})});
  try{
    assert.equal((await upload(sample().toString('base64'),null)).status,401);
    for(const format of ['image/png','image/jpeg','image/webp']){const response=await upload(sample(format).toString('base64'));assert.equal(response.status,200);const {url}=await response.json();assert.equal((await app.platform.profile(a.user)).avatarUrl,url);assert.equal((await app.platform.profile(b.user)).avatarUrl,null);}
    assert.equal((await upload(Buffer.from('<svg/>').toString('base64'))).status,400);
  }finally{await app.close();await rm(root,{recursive:true,force:true});}
});
test('JPEG uploads validate dimensions before decoding and normalize to a square PNG',async()=>{
  const jpeg=sample('image/jpeg');
  assert.deepEqual(validateImage(jpeg.toString('base64')),jpeg);
  const image=await loadImage(await normalizeImage(jpeg.toString('base64')));
  assert.equal(image.width,512);assert.equal(image.height,512);
  const badDimensions=Buffer.from(jpeg);
  let frame=-1;
  for(let i=0;i<badDimensions.length-10;i++)if(badDimensions[i]===255&&[0xc0,0xc2].includes(badDimensions[i+1])){frame=i;break;}
  assert.ok(frame>=0);badDimensions.writeUInt16BE(65535,frame+7);
  assert.throws(()=>validateImage(badDimensions.toString('base64')),/25 megapixels/);
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
    const photo=await loadImage(uploadedPhoto.body);assert.equal(photo.width,512);assert.equal(photo.height,512);
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
