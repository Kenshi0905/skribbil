import { randomBytes } from 'node:crypto';
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createApp } from '../server/index.mjs';
import { openDatabase } from '../server/db.mjs';

const listen=s=>new Promise(r=>s.listen(0,'127.0.0.1',()=>r(`http://127.0.0.1:${s.address().port}`)));
const stop=s=>new Promise(r=>{s.closeAllConnections();s.close(r);});
test('simultaneous creation reserves one room; uncertain provisioning resumes the same match',{timeout:60000},async()=>{
  const db=await openDatabase({url:'',dataDir:':memory:'});let fail=true,missing=false,generic404=false;const requested=[];
  const engine=http.createServer(async(req,res)=>{
    if(req.method==='GET'){res.end('ok');return;}
    const parts=[];for await(const c of req)parts.push(c);
    const data=JSON.parse(Buffer.concat(parts));requested.push(data);
    if(fail){fail=false;res.writeHead(503);res.end('retry');return;}
    if(generic404&&req.url.endsWith('/status')){res.writeHead(404);res.end('404 page not found');return;}
    if(missing&&req.url.endsWith('/status')){res.writeHead(404);res.end('match not found');return;}
    res.setHeader('Content-Type','application/json');res.end(JSON.stringify({lobbyId:`test-${data.matchId}`,cancelled:true,exists:true}));
  });
  const config={secret:randomBytes(32).toString('hex'),engineUrl:await listen(engine),origin:'',ranked:false,secure:false};
  const app=await createApp({db,config}),base=await listen(app.server);config.origin=base;
  let cookie;
  const api=async(path,body)=>{
    const r=await fetch(base+path,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json','X-Requested-With':'Skribbil',...(cookie?{Cookie:cookie}:{})},body:body===undefined?undefined:JSON.stringify(body)});
    if(r.headers.get('set-cookie'))cookie=r.headers.get('set-cookie').split(';')[0];
    return {status:r.status,data:await r.json()};
  };
  try{
    assert.equal((await api('/api/auth/register',{username:'room_racer',email:'rooms@example.test',password:randomBytes(24).toString('base64url')})).status,200);
    const race=await Promise.all([api('/api/rooms',{mode:'private'}),api('/api/rooms',{mode:'private'})]);
    assert.deepEqual(race.map(r=>r.status).sort(),[409,503]);assert.equal(requested.length,1);
    const own=(await api('/api/bootstrap')).data.ownRooms;assert.equal(own.length,1);
    const id=own[0].id;assert.equal((await api(`/api/rooms/${id}/join`,{})).status,200);
    assert.equal(requested[0].matchId,requested[1].matchId);
    assert.equal((await api(`/api/rooms/${id}/cancel`,{})).status,200);
    assert.equal((await api(`/api/rooms/${id}/join`,{})).status,409);
    const created=await api('/api/rooms',{mode:'private'});assert.equal(created.status,201);assert.notEqual(created.data.matchId,id);
    const ownerCookie=cookie;
    assert.equal((await api('/api/auth/register',{username:'room_guest',email:'guest@example.test',password:randomBytes(24).toString('base64url')})).status,200);
    assert.equal((await api(`/api/rooms/${created.data.matchId}/join`,{})).status,200);
    fail=true;assert.equal((await api(`/api/rooms/${created.data.matchId}/join`,{})).status,503);
    assert.equal((await api('/api/bootstrap')).data.ownRooms.length,1,'transport failure must preserve room admission');
    generic404=true;assert.equal((await api(`/api/rooms/${created.data.matchId}/join`,{})).status,404);
    assert.equal((await api('/api/bootstrap')).data.ownRooms.length,1,'an old engine or gateway 404 must not cancel a room');generic404=false;
    missing=true;assert.equal((await api(`/api/rooms/${created.data.matchId}/join`,{})).status,409);
    assert.equal((await api('/api/bootstrap')).data.ownRooms.length,0,'a non-owner can recover from a lost engine room');
    cookie=ownerCookie;assert.equal((await api('/api/bootstrap')).data.ownRooms.length,0);
  }finally{await stop(app.server);await stop(engine);await db.close();}
});

test('creating a replacement closes the old owned room; leaving and closing release admission',{timeout:60000},async()=>{
  const db=await openDatabase({url:'',dataDir:':memory:'});
  const live=new Set(),calls=[];let unavailable=false,generic404=false,completed=false,cancelDuringProvision=false;
  const engine=http.createServer(async(req,res)=>{
    if(req.method==='GET'){res.end('ok');return;}
    const parts=[];for await(const c of req)parts.push(c);
    const data=JSON.parse(Buffer.concat(parts));calls.push({path:req.url,...data});
    if(unavailable){res.writeHead(503);res.end('unavailable');return;}
    if(req.url.endsWith('/cancel')){
      if(generic404){res.writeHead(404);res.end('404 page not found');return;}
      if(!live.delete(data.matchId)){res.writeHead(404);res.end('match not found');return;}
      res.setHeader('Content-Type','application/json');res.end(JSON.stringify({cancelled:!completed,completed}));return;
    }
    if(req.url.endsWith('/status')&&!live.has(data.matchId)){res.writeHead(404);res.end('match not found');return;}
    if(cancelDuringProvision&&req.url==='/engine/internal/rooms'){
      cancelDuringProvision=false;
      await db.query("UPDATE skribbil.matches SET status='cancelled' WHERE id=$1",[data.matchId]);
    }
    live.add(data.matchId);
    res.setHeader('Content-Type','application/json');res.end(JSON.stringify({lobbyId:`test-${data.matchId}`,exists:true}));
  });
  const config={secret:randomBytes(32).toString('hex'),engineUrl:await listen(engine),origin:'',ranked:false,secure:false};
  const app=await createApp({db,config}),base=await listen(app.server);config.origin=base;
  const api=async(cookie,path,body)=>{
    const r=await fetch(base+path,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json','X-Requested-With':'Skribbil',...(cookie?{Cookie:cookie}:{})},body:body===undefined?undefined:JSON.stringify(body)});
    return {status:r.status,data:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]};
  };
  try{
    const owner=(await api(null,'/api/auth/register',{username:'replace_owner',email:'replace-owner@example.test',password:randomBytes(24).toString('base64url')})).cookie;
    const guest=(await api(null,'/api/auth/register',{username:'replace_guest',email:'replace-guest@example.test',password:randomBytes(24).toString('base64url')})).cookie;
    const first=await api(owner,'/api/rooms',{mode:'private',private:false});assert.equal(first.status,201);
    const initialJoin=await api(guest,`/api/rooms/${first.data.matchId}/join`,{});
    assert.equal(initialJoin.status,200);
    const admission=result=>JSON.parse(Buffer.from(new URL(result.data.url,base).searchParams.get('ticket').split('.')[0],'base64url').toString());
    assert.equal(admission(initialJoin).resetScore,false,'new player starts with a fresh seat');
    assert.equal((await api(guest,`/api/rooms/${first.data.matchId}/cancel`,{})).status,403,'guests cannot close someone else’s room');
    assert.equal((await api(guest,`/api/rooms/${first.data.matchId}/leave`,{})).status,200);
    assert.equal((await api(guest,'/api/bootstrap')).data.ownRooms.length,0,'leaving clears the active-room reservation');
    assert.equal(Number((await api(owner,'/api/bootstrap')).data.rooms.find(room=>room.id===first.data.matchId).players),1,'departed guests do not inflate the live room count');
    assert.ok(live.has(first.data.matchId),'guest departure preserves the host’s room');
    const rejoined=await api(guest,`/api/rooms/${first.data.matchId}/join`,{});
    assert.equal(rejoined.status,200,'rejoining restores admission');
    assert.equal(admission(rejoined).resetScore,true,'explicit departure resets points even while an old engine socket is closing');
    assert.equal(admission(rejoined).role,'player','returning invitation admits a player');
    const guestRoom=await api(guest,'/api/rooms',{mode:'private'});assert.equal(guestRoom.status,201);
    assert.ok(live.has(first.data.matchId),'creating as a guest does not delete the host’s room');
    assert.equal((await api(guest,`/api/rooms/${guestRoom.data.matchId}/leave`,{})).status,200);
    assert.ok(!live.has(guestRoom.data.matchId),'owner leaving closes their room');
    assert.equal((await api(guest,`/api/rooms/${guestRoom.data.matchId}/leave`,{})).status,200,'leave retries succeed');

    unavailable=true;
    assert.equal((await api(owner,'/api/rooms',{mode:'private'})).status,503);
    assert.equal((await api(owner,'/api/bootstrap')).data.ownRooms[0].id,first.data.matchId,'uncertain closure preserves the old reservation');
    unavailable=false;generic404=true;
    assert.equal((await api(owner,`/api/rooms/${first.data.matchId}/cancel`,{})).status,404);
    assert.equal((await api(owner,'/api/bootstrap')).data.ownRooms[0].id,first.data.matchId,'generic 404 is not evidence of deletion');
    generic404=false;
    const replacement=await api(owner,'/api/rooms',{mode:'private'});assert.equal(replacement.status,201);
    assert.ok(!live.has(first.data.matchId));assert.notEqual(replacement.data.matchId,first.data.matchId);
    assert.deepEqual((await api(owner,'/api/bootstrap')).data.ownRooms.map(r=>r.id),[replacement.data.matchId]);
    assert.equal((await api(owner,`/api/rooms/${first.data.matchId}/join`,{})).status,409,'old invitations stop working');
    await db.query("UPDATE skribbil.matches SET status='running' WHERE id=$1",[replacement.data.matchId]);
    assert.equal((await api(owner,`/api/rooms/${replacement.data.matchId}/cancel`,{})).status,200,'close button supports started casual rooms');
    assert.ok(calls.find(c=>c.path.endsWith('/cancel')&&c.matchId===replacement.data.matchId&&c.allowStarted===true));
    assert.equal((await api(owner,`/api/rooms/${replacement.data.matchId}/cancel`,{})).status,200,'close retries succeed');

    const final=await api(owner,'/api/rooms',{mode:'private'});assert.equal(final.status,201);
    completed=true;
    assert.equal((await api(owner,`/api/rooms/${final.data.matchId}/cancel`,{})).status,200);
    assert.equal((await db.query('SELECT status FROM skribbil.matches WHERE id=$1',[final.data.matchId])).rows[0].status,'completed','already queued results can still settle');
    assert.equal((await api(owner,'/api/bootstrap')).data.ownRooms.length,0);
    cancelDuringProvision=true;completed=false;
    const late=await api(owner,'/api/rooms',{mode:'private'});
    assert.equal(late.status,409,'a replaced reservation cannot finish launching');
    const lateId=calls.findLast(c=>c.path==='/engine/internal/rooms').matchId;
    assert.ok(!live.has(lateId),'late provisioning is cleaned up on the engine too');
  }finally{await stop(app.server);await stop(engine);await db.close();}
});
