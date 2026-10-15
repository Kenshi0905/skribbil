import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { randomBytes, randomUUID } from 'node:crypto';
import { createApp } from '../server/index.mjs';
import { openDatabase } from '../server/db.mjs';
import { newSession } from '../server/security.mjs';

const listen=server=>new Promise(resolve=>server.listen(0,'127.0.0.1',()=>resolve(`http://127.0.0.1:${server.address().port}`)));
const stop=server=>new Promise(resolve=>{server.closeAllConnections();server.close(resolve);});
const one=async(db,sql,args=[]) => (await db.query(sql,args)).rows[0];
// Preserve the literal HTTP request-target; fetch normalizes authority-like
// paths before sending them and would hide this gateway regression.
const rawRequest=(base,target,cookie,upgrade=false)=>new Promise((resolve,reject)=>{
  const url=new URL(base);
  const req=http.request({hostname:url.hostname,port:url.port,path:target,headers:{Cookie:cookie,Origin:base,
    ...(upgrade?{Connection:'Upgrade',Upgrade:'websocket','Sec-WebSocket-Version':'13','Sec-WebSocket-Key':randomBytes(16).toString('base64')}:{})}},res=>{
    res.resume();res.on('end',()=>resolve(res.statusCode));
  });
  req.on('upgrade',(_res,socket)=>{socket.destroy();resolve(101);});
  req.on('error',reject);req.setTimeout(5000,()=>req.destroy(new Error('Gateway request timed out.')));req.end();
});

test('Clubhouse HTTP routes enforce approval, invite-only room access and immediate revocation',{timeout:60000},async()=>{
  const db=await openDatabase({url:'',dataDir:':memory:'}),engineReads=[];
  const engine=http.createServer(async(req,res)=>{
    engineReads.push(req.url);
    if(req.method==='GET'){res.end('Synthetic engine response');return;}
    const chunks=[];for await(const chunk of req)chunks.push(chunk);
    const input=JSON.parse(Buffer.concat(chunks).toString());
    res.setHeader('Content-Type','application/json');
    res.end(JSON.stringify({lobbyId:`fixture-${input.matchId}`,exists:true,cancelled:true}));
  });
  const config={secret:randomBytes(32).toString('hex'),engineUrl:await listen(engine),origin:'',ranked:false,secure:false,production:false};
  const app=await createApp({db,config}),base=await listen(app.server);config.origin=base;
  // Synthetic sessions exist only in this in-memory test database. No account
  // secrets or personal account details are stored in source or fixtures.
  const account=async(admin=false)=>{
    const id=randomUUID(),username=`club_${randomBytes(6).toString('hex')}`,session=newSession();
    await db.query('INSERT INTO skribbil.users(id,username,display_name) VALUES($1,$2,$2)',[id,username]);
    await db.query("INSERT INTO skribbil.auth_sessions(user_id,token_hash,expires_at) VALUES($1,$2,now()+interval '1 hour')",[id,session.tokenHash]);
    if(admin)await db.query("INSERT INTO skribbil.platform_roles(user_id,role,granted_by) VALUES($1,'administrator',$1)",[id]);
    return{id,username,cookie:`skribbil_session=${session.token}`};
  };
  const request=async(user,path,data,{method,extraCookie}={})=>{
    const response=await fetch(base+path,{method:method??(data===undefined?'GET':'POST'),redirect:'manual',
      headers:{Cookie:user.cookie+(extraCookie?`; ${extraCookie}`:''),Origin:base,'X-Requested-With':'Skribbil',...(data===undefined?{}:{'Content-Type':'application/json'})},
      body:data===undefined?undefined:JSON.stringify(data)});
    const raw=await response.text();
    return{status:response.status,data:response.headers.get('content-type')?.includes('json')?JSON.parse(raw):raw};
  };
  try{
    const admin=await account(true),owner=await account(),member=await account(),outsider=await account();
    const authority=new URL(config.engineUrl).host,forwardedBefore=engineReads.length;
    const invalidTargets=[`//${authority}/engine/probe`,`${config.engineUrl}/engine/probe`,
      `/\\${authority}/engine/probe`,`/%2f${authority}/engine/probe`,`/%2F%2F${authority}/engine/probe`,
      `/%5c${authority}/engine/probe`,`/%5C%5c${authority}/engine/probe`];
    for(const upgrade of [false,true])for(const target of invalidTargets){
      assert.equal(await rawRequest(base,target,member.cookie,upgrade),400,`${upgrade?'WebSocket':'HTTP'} must reject authority-like request-target ${target}`);
    }
    assert.equal(engineReads.length,forwardedBefore,'invalid targets must never forward credentials or gateway headers');
    assert.equal((await request(owner,'/api/clubhouses',{name:'Unauthorized group'})).status,403);
    const submitted=await request(owner,'/api/clubhouse-requests',{name:'Synthetic friends',description:'A private HTTP integration fixture.'});
    assert.equal(submitted.status,201);assert.equal(submitted.data.request.status,'pending');
    assert.equal((await request(owner,'/api/clubhouse-requests')).status,403);
    const pending=await request(admin,'/api/clubhouse-requests');assert.equal(pending.status,200);
    assert.ok(pending.data.requests.some(r=>r.id===submitted.data.request.id&&r.requester.id===owner.id));
    const approved=await request(admin,`/api/clubhouse-requests/${submitted.data.request.id}`,{status:'approved',reason:'Approved for this isolated test.'});
    assert.equal(approved.status,200);const clubhouseId=approved.data.clubhouseId;
    assert.equal((await request(owner,`/api/clubhouses/${clubhouseId}`)).data.clubhouse.ownerId,owner.id);
    const direct=await request(admin,'/api/clubhouses',{name:'Synthetic admin group'});
    assert.equal(direct.status,201);assert.equal(direct.data.clubhouse.ownerId,admin.id);
    assert.ok((await request(owner,'/api/clubhouses')).data.clubhouses.some(c=>c.id===clubhouseId));
    assert.equal((await request(outsider,'/api/clubhouses')).data.clubhouses.length,0);
    assert.equal((await request(outsider,`/api/clubhouses/${clubhouseId}`)).status,404);

    const invited=await request(owner,`/api/clubhouses/${clubhouseId}/invites`,{username:member.username});
    assert.equal(invited.status,200);const invitationId=invited.data.id;
    assert.equal((await request(outsider,`/api/clubhouse-invites/${invitationId}/accept`,{})).status,403);
    assert.equal((await request(member,`/api/clubhouse-invites/${invitationId}/accept`,{})).status,200);
    const created=await request(member,'/api/rooms',{mode:'private',clubhouseId,private:false,rounds:1,drawTime:60,maxPlayers:4});
    assert.equal(created.status,201);
    const match=await one(db,'SELECT * FROM skribbil.matches WHERE id=$1',[created.data.matchId]);
    assert.equal(match.clubhouse_id,clubhouseId);assert.equal(match.private,true);assert.equal(match.mode,'casual');
    assert.equal((await request(owner,`/api/clubhouses/${clubhouseId}`)).data.clubhouse.rooms[0].id,match.id);
    assert.deepEqual((await request(admin,`/api/clubhouses/${clubhouseId}`)).data.clubhouse.rooms,[]);
    assert.equal((await request(outsider,`/api/rooms/${match.id}/join`,{})).status,403);
    assert.equal((await request(outsider,'/api/rooms/join-code',{code:match.id})).status,403,'a pasted code never bypasses Clubhouse membership');
    assert.equal((await request(outsider,`/api/rooms/${match.id}/join`,{role:'spectator'})).status,403);
    assert.equal((await request(admin,`/api/rooms/${match.id}/join`,{role:'spectator'})).status,403);
    assert.equal((await request(outsider,'/api/rooms',{mode:'private',clubhouseId})).status,403);
    assert.equal((await request(owner,`/api/rooms/${match.id}/join`,{role:'spectator'})).status,200);
    assert.equal((await request(owner,'/api/rooms/join-code',{code:match.id})).status,200);
    assert.equal((await request(member,created.data.url)).status,200);
    assert.equal((await request(member,`/engine/lobby/${match.engine_room_id}`)).status,200);

    const removed=await request(owner,`/api/clubhouses/${clubhouseId}/members/${member.id}/remove`,{});
    assert.equal(removed.status,200);
    const before=engineReads.length;
    assert.equal((await request(member,created.data.url)).status,403,'a previously issued admission ticket must stop working');
    assert.equal((await request(member,`/engine/lobby/${match.engine_room_id}`)).status,403,'native lobby URLs must recheck membership');
    assert.equal((await request(member,`/engine/v1/lobby/${match.engine_room_id}/ws`)).status,403);
    const legacyCookie=`lobby-id=${encodeURIComponent(match.engine_room_id)}`;
    assert.equal((await request(member,'/engine/v1/lobby/ws',undefined,{extraCookie:legacyCookie})).status,403,'legacy WebSocket URLs must resolve the lobby-id cookie');
    assert.equal((await request(member,'/engine/v1/lobby',{}, {method:'PATCH',extraCookie:legacyCookie})).status,403,'legacy settings updates must recheck membership');
    assert.equal((await request(member,'/engine/v1/lobby/%77s',undefined,{extraCookie:legacyCookie})).status,403,'encoded legacy paths must use the same authorization as their decoded Go route');
    assert.equal((await request(member,'/engine/v1/%6cobby',{}, {method:'PATCH',extraCookie:legacyCookie})).status,403);
    assert.equal((await request(member,created.data.url.replace('/league/','/%6ceague/'))).status,403,'encoded ticket paths cannot bypass current membership');
    assert.equal((await request(member,`/api/rooms/${match.id}/cancel`,{})).status,403,'a revoked member cannot cancel a room they previously created');
    assert.equal(engineReads.length,before,'revoked requests never reach the engine');
    assert.equal((await request(member,`/api/rooms/${match.id}/join`,{})).status,403);
    const bootstrap=await request(member,'/api/bootstrap');assert.equal(bootstrap.status,200);
    assert.ok(!bootstrap.data.ownRooms.some(r=>r.id===match.id));
    assert.ok(await one(db,'SELECT 1 FROM skribbil.match_players WHERE match_id=$1 AND user_id=$2',[match.id,member.id]),'historic match participation is retained');
    assert.equal((await request(member,`/api/clubhouse-invites/${invitationId}/accept`,{})).data.alreadyAccepted,true);
    assert.equal((await request(member,`/api/clubhouses/${clubhouseId}`)).status,404);
    const unrelated=await request(member,'/api/rooms',{mode:'private'});
    assert.equal(unrelated.status,201,'revoked room reservations must not trap the former member');
    assert.equal((await one(db,'SELECT clubhouse_id FROM skribbil.matches WHERE id=$1',[unrelated.data.matchId])).clubhouse_id,null);
  }finally{await stop(app.server);await stop(engine);await db.close();}
});
