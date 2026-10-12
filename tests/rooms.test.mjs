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
  const config={secret:'test-secret-long-enough-for-room-control',engineUrl:await listen(engine),origin:'',ranked:false,secure:false};
  const app=await createApp({db,config}),base=await listen(app.server);config.origin=base;
  let cookie;
  const api=async(path,body)=>{
    const r=await fetch(base+path,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json','X-Requested-With':'Skribbil',...(cookie?{Cookie:cookie}:{})},body:body===undefined?undefined:JSON.stringify(body)});
    if(r.headers.get('set-cookie'))cookie=r.headers.get('set-cookie').split(';')[0];
    return {status:r.status,data:await r.json()};
  };
  try{
    assert.equal((await api('/api/auth/register',{username:'room_racer',email:'rooms@example.test',password:'a-strong-test-password'})).status,200);
    const race=await Promise.all([api('/api/rooms',{mode:'private'}),api('/api/rooms',{mode:'private'})]);
    assert.deepEqual(race.map(r=>r.status).sort(),[409,503]);assert.equal(requested.length,1);
    const own=(await api('/api/bootstrap')).data.ownRooms;assert.equal(own.length,1);
    const id=own[0].id;assert.equal((await api(`/api/rooms/${id}/join`,{})).status,200);
    assert.equal(requested[0].matchId,requested[1].matchId);
    assert.equal((await api(`/api/rooms/${id}/cancel`,{})).status,200);
    assert.equal((await api(`/api/rooms/${id}/join`,{})).status,409);
    const created=await api('/api/rooms',{mode:'private'});assert.equal(created.status,201);assert.notEqual(created.data.matchId,id);
    const ownerCookie=cookie;
    assert.equal((await api('/api/auth/register',{username:'room_guest',email:'guest@example.test',password:'a-strong-test-password'})).status,200);
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
