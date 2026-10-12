import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { openDatabase } from '../server/db.mjs';
import { createApp } from '../server/index.mjs';
import { passwordHash, passwordMatches } from '../server/security.mjs';

test('password change requires current credentials, rotates cookie and revokes other sessions',{timeout:60000},async()=>{
  const db=await openDatabase({url:'',dataDir:':memory:'});
  const app=await createApp({db,config:{secret:randomBytes(32).toString('hex'),origin:'',engineUrl:'http://127.0.0.1:1',secure:false,ranked:false}});
  await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
  const base=`http://127.0.0.1:${app.server.address().port}`;app.config.origin=base;
  const password=randomBytes(24).toString('base64url'),replacement=randomBytes(24).toString('base64url');
  const call=async(path,body,cookie,extra={})=>{
    const response=await fetch(base+path,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json','X-Requested-With':'Skribbil',Origin:base,...(cookie?{Cookie:cookie}:{}),...extra},body:body===undefined?undefined:JSON.stringify(body)});
    return {status:response.status,data:await response.json(),cookie:response.headers.getSetCookie()[0]?.split(';')[0]};
  };
  try{
    const registered=await call('/api/auth/register',{username:'password_tester',email:'password@example.test',password});
    assert.equal(registered.status,200);
    const other=await call('/api/auth/login',{email:'password_tester',password});assert.equal(other.status,200);
    const input={currentPassword:password,newPassword:replacement};
    assert.equal((await call('/api/auth/password',input)).status,401);
    assert.equal((await call('/api/auth/password',input,registered.cookie,{Origin:'https://untrusted.example'})).status,403);
    assert.equal((await call('/api/auth/password',{...input,currentPassword:randomBytes(24).toString('hex')},registered.cookie)).status,403);
    assert.equal((await call('/api/auth/password',{...input,newPassword:'short'},registered.cookie)).status,400);
    const changed=await call('/api/auth/password',input,registered.cookie);
    assert.equal(changed.status,200);assert.deepEqual(changed.data,{ok:true});assert.notEqual(changed.cookie,registered.cookie);
    assert.equal((await call('/api/me',undefined,registered.cookie)).data.user,null);
    assert.equal((await call('/api/me',undefined,other.cookie)).data.user,null);
    assert.equal((await call('/api/me',undefined,changed.cookie)).data.user.username,'password_tester');
    assert.equal((await call('/api/auth/login',{email:'password_tester',password})).status,401);
    assert.equal((await call('/api/auth/login',{email:'password_tester',password:replacement})).status,200);
    const stored=(await db.query('SELECT password_hash FROM skribbil.credentials WHERE user_id=$1',[registered.data.user.id])).rows[0].password_hash;
    assert.ok(await passwordMatches(replacement,stored));assert.ok(!stored.includes(replacement));
  }finally{app.server.closeAllConnections();await new Promise(resolve=>app.server.close(resolve));await db.close();}
});

// A burst must be bounded before allocating native scrypt memory.
test('password hashing rejects excess queued work and releases every worker',{timeout:60000},async()=>{
  const results=await Promise.allSettled(Array.from({length:20},()=>passwordHash(randomBytes(24).toString('hex'))));
  assert.equal(results.filter(x=>x.status==='fulfilled').length,18);
  assert.equal(results.filter(x=>x.status==='rejected'&&x.reason.status===429).length,2);
  assert.match(await passwordHash(randomBytes(24).toString('hex')),/^scrypt:/);
});
