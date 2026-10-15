import test from 'node:test';import assert from 'node:assert/strict';import {randomBytes} from 'node:crypto';
import {openDatabase} from '../server/db.mjs';import {createApp} from '../server/index.mjs';import {Social} from '../server/social.mjs';import {Community} from '../server/community.mjs';
test('display-name changes preserve handles and refresh profiles, friends, party and team rosters for another account',{timeout:60000},async()=>{
 const db=await openDatabase({url:'',dataDir:':memory:'});const app=await createApp({db,config:{secret:randomBytes(32).toString('hex'),origin:'',secure:false}});
 await new Promise(r=>app.server.listen(0,'127.0.0.1',r));const origin=`http://127.0.0.1:${app.server.address().port}`;app.config.origin=origin;
 try {
  const p=app.platform,records=[];
  for(const username of ['jos_identity','viewer_identity'])records.push(await p.register({username,email:username+'@example.invalid',password:randomBytes(20).toString('hex')}));
  const [a,b]=records;const account=async x=>(await db.query('SELECT * FROM skribbil.users WHERE id=$1',[x.user.id])).rows[0];
  await p.friend(await account(a),{username:b.user.username});await p.friend(await account(b),{username:a.user.username});
  const social=new Social(p),community=new Community(p);await social.createParty(await account(a));
  const team=await p.createTeam(await account(a),{name:'Identity team',tag:'IDENT'});
  const response=await fetch(origin+'/api/profile',{method:'PATCH',headers:{Cookie:`skribbil_session=${a.token}`,Origin:origin,'X-Requested-With':'Skribbil','Content-Type':'application/json'},body:JSON.stringify({displayName:'jane'})});
  assert.equal(response.status,200);const profile=(await response.json()).user;assert.equal(profile.displayName,'jane');assert.equal(profile.username,'jos_identity');
  const otherView=await p.bootstrap(await account(b),{});assert.equal(otherView.friends.find(f=>f.id===a.user.id).displayName,'jane');
  assert.equal((await social.getParty(await account(a))).party.members[0].displayName,'jane');
  assert.equal((await community.getTeam(await account(b),team.id)).team.members[0].displayName,'jane');
  const fresh=await fetch(origin+'/api/me',{headers:{Cookie:`skribbil_session=${a.token}`}});assert.equal((await fresh.json()).user.displayName,'jane');
 }finally{await app.close();}
});
