import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {openDatabase} from '../server/db.mjs';
import {createApp} from '../server/index.mjs';

test('remember preference controls cookies, survives password rotation, and never bypasses expiry/revocation',{timeout:60000},async()=>{
  const db=await openDatabase({url:'',dataDir:':memory:'});
  const app=await createApp({db,config:{secret:randomBytes(32).toString('hex'),origin:'',engineUrl:'http://127.0.0.1:1',secure:true,ranked:false}});
  await new Promise(r=>app.server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${app.server.address().port}`;app.config.origin=base;
  const password=randomBytes(24).toString('hex');
  const call=async(path,input,cookie)=>{const r=await fetch(base+path,{method:input?'POST':'GET',headers:{Origin:base,'X-Requested-With':'Skribbil','Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},body:input?JSON.stringify(input):undefined});return {status:r.status,data:await r.json(),header:r.headers.get('set-cookie'),cookie:r.headers.get('set-cookie')?.split(';')[0]};};
  try{
    for(const rememberMe of [false,true]){
      const username='remember_'+rememberMe;
      const reg=await call('/api/auth/register',{username,email:username+'@example.invalid',password,rememberMe});assert.equal(reg.status,200);
      const login=await call('/api/auth/login',{email:username,password,rememberMe});assert.equal(login.status,200);assert.notEqual(login.cookie,reg.cookie);
      for(const result of [reg,login]){assert.match(result.header,/HttpOnly; SameSite=Lax/);assert.match(result.header,/; Secure/);if(rememberMe)assert.match(result.header,/Max-Age=604800/);else assert.doesNotMatch(result.header,/Max-Age|Expires/i);}
      const replacement=randomBytes(24).toString('hex');const changed=await call('/api/auth/password',{currentPassword:password,newPassword:replacement},login.cookie);assert.equal(changed.status,200);
      if(rememberMe)assert.match(changed.header,/Max-Age=604800/);else assert.doesNotMatch(changed.header,/Max-Age|Expires/i);
      assert.equal((await call('/api/me',null,login.cookie)).data.user,null);assert.equal((await call('/api/me',null,reg.cookie)).data.user,null);
      const sessions=(await db.query('SELECT expires_at,remember_me,revoked_at FROM skribbil.auth_sessions WHERE user_id=$1',[reg.data.user.id])).rows;assert.ok(sessions.every(s=>new Date(s.expires_at)>new Date()));assert.ok(sessions.every(s=>s.remember_me===rememberMe));
      if(!rememberMe){await db.query(`UPDATE skribbil.auth_sessions SET created_at=now()-interval '8 days',expires_at=now()-interval '1 day' WHERE user_id=$1`,[reg.data.user.id]);assert.equal((await call('/api/me',null,changed.cookie)).data.user,null,'browser-session cookies still obey server expiry');}
      const logout=await call('/api/auth/logout',{},changed.cookie);assert.match(logout.header,/Max-Age=0/);assert.equal((await call('/api/me',null,changed.cookie)).data.user,null);
    }
    for(const value of ['true',1,null,[],{}])for(const method of ['register','login'])await assert.rejects(app.platform[method]({rememberMe:value}),e=>e.status===400&&/true or false/.test(e.message));
    assert.equal((await call('/api/auth/login',{email:'remember_false',password,rememberMe:'false'})).status,400);
  }finally{await app.close();}
});

test('only admins assign existing titles; ordinary profile/equip requests preserve titles and unrelated fields',{timeout:60000},async()=>{
  const db=await openDatabase({url:'',dataDir:':memory:'});const app=await createApp({db,config:{secret:randomBytes(32).toString('hex'),origin:'',secure:false}});
  await new Promise(r=>app.server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${app.server.address().port}`;app.config.origin=base;
  const p=app.platform,a=await p.register({username:'title_admin',email:'titleadmin@example.invalid',password:randomBytes(24).toString('hex')}),u=await p.register({username:'title_member',email:'titlemember@example.invalid',password:randomBytes(24).toString('hex')});
  const titleId='00000000-0000-4000-8000-000000000061';
  const post=async(token,input)=>{const r=await fetch(base+`/api/admin/users/${u.user.id}/title`,{method:'POST',headers:{Cookie:`skribbil_session=${token}`,Origin:base,'X-Requested-With':'Skribbil','Content-Type':'application/json'},body:JSON.stringify(input)});return {status:r.status,data:await r.json()};};
  try{
    assert.equal((await post(u.token,{titleId,reason:'Community award'})).status,403);
    const forged=await fetch(base+'/api/profile',{method:'PATCH',headers:{Cookie:`skribbil_session=${u.token}`,Origin:base,'X-Requested-With':'Skribbil','Content-Type':'application/json'},body:JSON.stringify({title:'Rookie',displayName:'Forged profile change'})});assert.equal(forged.status,400);
    await db.query(`INSERT INTO skribbil.platform_roles(user_id,role) VALUES($1,'administrator')`,[a.user.id]);
    const before=await p.profile(u.user);assert.equal((await post(a.token,{titleId,reason:'Community award',displayName:'Unrelated change'})).status,200);
    assert.equal((await p.profile(u.user)).title,'Inkcredible');assert.equal((await p.profile(u.user)).displayName,before.displayName);
    assert.equal((await p.profile(a.user)).title,'Rookie');
    for(const title of ['Rookie','Inkcredible','',null])await assert.rejects(p.updateProfile(u.user,{title}),e=>e.status===400);
    await assert.rejects(p.updateProfile(u.user,{cosmeticId:titleId}),e=>e.status===403);
    await p.updateProfile(u.user,{bio:'Ordinary profile edit'});assert.equal((await p.profile(u.user)).title,'Inkcredible');
    assert.equal((await post(a.token,{titleId:'00000000-0000-4000-8000-000000000099',reason:'Invalid title'})).status,400);
    assert.equal((await post(a.token,{titleId:null,reason:'Restore default'})).status,200);assert.equal((await p.profile(u.user)).title,'Rookie');
    const audit=(await db.query(`SELECT before_state,after_state FROM skribbil.admin_audit_log WHERE action='profile.title.assigned' AND entity_id=$1 ORDER BY created_at`,[u.user.id])).rows;assert.equal(audit.length,2);assert.equal(audit[0].after_state.titleId,titleId);
    const dashboard=await (await fetch(base+'/api/admin',{headers:{Cookie:`skribbil_session=${a.token}`}})).json();assert.ok(dashboard.audit[0].createdAt);assert.equal(dashboard.audit[0].targetUsername,u.user.username);assert.equal(dashboard.audit[0].username,a.user.username);
    await db.query(`DELETE FROM skribbil.platform_roles WHERE user_id=$1`,[a.user.id]);assert.equal((await post(a.token,{titleId,reason:'Revoked admin'})).status,403);
  }finally{await app.close();}
});
