import test from 'node:test';
import assert from 'node:assert/strict';
import {createApp} from '../server/index.mjs';
import {randomBytes,randomUUID} from 'node:crypto';
import {openDatabase} from '../server/db.mjs';
import {Platform} from '../server/platform.mjs';
import {GalleryVotes,galleryDecision,galleryPolicy} from '../server/gallery.mjs';
import {acceptEngineEvent} from '../server/events.mjs';
import {expireAssets} from '../server/retention.mjs';

const one=async(db,sql,args=[]) => (await db.query(sql,args)).rows[0];
test('gallery policy requires a real majority, minimum voters and explicit no-decision',()=>{
 assert.equal(galleryDecision(2,0,3,67),'no-decision');assert.equal(galleryDecision(2,2,3,67),'no-decision');
 assert.equal(galleryDecision(3,1,3,67),'fame');assert.equal(galleryDecision(1,3,3,67),'shame');assert.equal(galleryDecision(3,2,3,67),'no-decision');
 assert.throws(()=>galleryPolicy({GALLERY_MAJORITY_PERCENT:'50'}));assert.throws(()=>galleryPolicy({GALLERY_VOTE_SECONDS:'0'}));
});
test('authoritative turn votes: concurrency, retries, roles, reconnect, thresholds and bounded storage',{timeout:120000},async t=>{
 const db=await openDatabase({url:'',dataDir:':memory:'}); const platform=new Platform(db),gallery=new GalleryVotes(platform);
 let app;
 try {
  const c=await platform.context(),matchId=randomUUID(),turnId=randomUUID(),players=[];
  for(let i=0;i<6;i++){const id=randomUUID();players.push(await one(db,'INSERT INTO skribbil.users(id,username,display_name) VALUES($1,$2,$3) RETURNING *',[id,`gallery_${id.slice(0,8)}`,`Player ${i}`]));}
  await db.query(`INSERT INTO skribbil.matches(id,game_id,rule_set_id,community_id,mode,engine_room_id,engine_instance_id,private,created_by) VALUES($1,$2,$3,$4,'casual',$5,'test',true,$6)`,[matchId,c.game_id,c.private_rules,c.community_id,`votes-${matchId}`,players[0].id]);
  for(const p of players.slice(0,5))await db.query(`INSERT INTO skribbil.match_players(match_id,user_id,engine_player_id,display_name_snapshot) VALUES($1,$2::uuid,$2::text,$3)`,[matchId,p.id,p.display_name]);
  let archives=0; const store={archive:async()=>{archives++;return Object.fromEntries(['image','replay'].map(kind=>[kind,{backend:'local',bucket:'private',key:`votes/${turnId}.${kind}`,mediaType:kind==='image'?'image/png':'application/json',bytes:kind==='image'?16384:4096,sha256:'a'.repeat(64)}]));}};
  const event={eventId:randomUUID(),matchId,lobbyId:`votes-${matchId}`,sequence:1,type:'turn.completed',occurredAt:new Date().toISOString(),payload:{turnId,artistId:players[0].id,turnNumber:1,round:1,drawing:[],word:'original test',eligibleVoterIds:players.slice(1,5).map(p=>p.id),voterIds:[],penaltyApplied:false,hardWord:false}};
  await acceptEngineEvent(platform,store,event,JSON.stringify(event));
  const before=await one(db,'SELECT count(*)::int AS count,sum(bytes)::int AS bytes FROM skribbil.object_assets');
  const expires=await one(db,'SELECT expires_at FROM skribbil.object_assets ORDER BY object_key LIMIT 1');
  await t.test('self, spectators and nonparticipants cannot cast or inspect private votes',async()=>{
   await assert.rejects(gallery.vote(players[0],turnId,'shame'),e=>e.status===403);
   await assert.rejects(gallery.vote(players[5],turnId,'fame'),e=>e.status===403);
   await assert.rejects(gallery.room(players[5],`votes-${matchId}`),e=>e.status===403);
   await assert.rejects(gallery.vote(players[1],turnId,'dislike'));
  });
  await t.test('simultaneous duplicate requests create only one vote; opposing retry is rejected',async()=>{
   const result=await Promise.all(Array.from({length:8},()=>gallery.vote(players[1],turnId,'fame')));
   assert.equal(result.filter(r=>!r.duplicate).length,1);await assert.rejects(gallery.vote(players[1],turnId,'shame'),e=>e.status===409);
   await Promise.all([gallery.vote(players[2],turnId,'fame'),gallery.vote(players[3],turnId,'fame'),gallery.vote(players[4],turnId,'shame')]);
  });
  await t.test('a new service instance reconstructs votes after disconnect/reconnect',async()=>{
   const view=await new GalleryVotes(platform).room(players[1],`votes-${matchId}`),turn=view.turns[0];
   assert.equal(turn.choice,'fame');assert.equal(turn.fame,3);assert.equal(turn.shame,1);assert.equal(turn.decision,'fame');assert.equal(turn.eligible,true);
   assert.equal((await gallery.room(players[0],`votes-${matchId}`)).turns[0].eligible,false);
  });
  await t.test('deadline freezes nominations and expired delivery never opens a fresh window',async()=>{
   await db.query("UPDATE skribbil.gallery_vote_windows SET closes_at=now()-interval '1 minute' WHERE turn_id=$1",[turnId]);
   assert.equal((await one(db,'SELECT candidate FROM skribbil.gallery_vote_totals WHERE turn_id=$1',[turnId])).candidate,'fame');
   assert.equal((await gallery.vote(players[1],turnId,'fame')).duplicate,true);
   await db.query('DELETE FROM skribbil.gallery_votes WHERE turn_id=$1 AND voter_id=$2',[turnId,players[4].id]);
   await assert.rejects(gallery.vote(players[4],turnId,'shame'),e=>e.status===409);
   await db.query("UPDATE skribbil.gallery_votes SET choice='shame' WHERE turn_id=$1 AND voter_id=$2",[turnId,players[3].id]);
   await db.query("UPDATE skribbil.gallery_vote_windows SET minimum_voters=2 WHERE turn_id=$1",[turnId]);
   await db.query('DELETE FROM skribbil.gallery_votes WHERE turn_id=$1 AND voter_id=$2',[turnId,players[2].id]);
   assert.equal((await one(db,'SELECT candidate FROM skribbil.gallery_vote_totals WHERE turn_id=$1',[turnId])).candidate,'no-decision');
  });
  await t.test('artist withdrawal requires fresh moderation; takedown cannot be bypassed by votes',async()=>{
   app=await createApp({db,config:{secret:randomBytes(32).toString('hex'),origin:'',secure:false}});
   await new Promise(r=>app.server.listen(0,'127.0.0.1',r));const origin=`http://127.0.0.1:${app.server.address().port}`;app.config.origin=origin;
   await db.query(`INSERT INTO skribbil.platform_roles(user_id,role) VALUES($1,'administrator')`,[players[1].id]);
   const artistToken=await platform.session(db,players[0].id),adminToken=await platform.session(db,players[1].id);
   const drawing=await one(db,'SELECT id FROM skribbil.drawings WHERE turn_id=$1',[turnId]);
   const post=async(token,path,payload)=>{const response=await fetch(origin+path,{method:'POST',headers:{Cookie:`skribbil_session=${token}`,Origin:origin,'X-Requested-With':'Skribbil','Content-Type':'application/json'},body:JSON.stringify(payload)});return {status:response.status,body:await response.json()};};
   const consent=allow=>post(artistToken,`/api/drawings/${drawing.id}/consent`,{allow});
   const curate=hall=>post(adminToken,`/api/admin/drawings/${drawing.id}`,{hall});
   assert.equal((await curate('fame')).status,409);assert.equal((await consent(true)).status,200);
   assert.equal((await curate('fame')).status,200);assert.equal((await platform.bootstrap(null,{})).drawings.length,1);
   assert.equal((await consent(false)).status,200);assert.equal((await platform.bootstrap(null,{})).drawings.length,0);
   assert.equal((await consent(true)).status,200);assert.equal((await platform.bootstrap(null,{})).drawings.length,0,'renewed consent must not resurrect withdrawn curation');
   assert.equal((await curate('shame')).status,200);assert.equal((await curate(null)).status,200);
   assert.equal((await platform.bootstrap(null,{})).drawings.length,0);
  });
  await t.test('votes add metadata only, never archives, score events or object retention',async()=>{
   const after=await one(db,'SELECT count(*)::int AS count,sum(bytes)::int AS bytes FROM skribbil.object_assets');assert.deepEqual(after,before);assert.equal(archives,1);
   assert.ok(new Date((await one(db,'SELECT expires_at FROM skribbil.object_assets ORDER BY object_key LIMIT 1')).expires_at)<=new Date(Date.now()+30*86400000+1000));
   assert.equal((await one(db,'SELECT count(*)::int AS n FROM skribbil.score_events WHERE match_id=$1',[matchId])).n,0);
   const metadata=await one(db,'SELECT sum(pg_column_size(v))::int AS bytes FROM skribbil.gallery_votes v WHERE turn_id=$1',[turnId]);
   assert.ok(metadata.bytes<1024);t.diagnostic(`Measured ${metadata.bytes} bytes for 2 vote tuples (indexes excluded); blob delta 0 bytes / 0 objects.`);
   await db.query("UPDATE skribbil.object_assets SET created_at=now()-interval '2 days',expires_at=now()-interval '1 day' WHERE object_key LIKE 'votes/%'");
   const removed=[];await expireAssets(db,{remove:async key=>removed.push(key)});assert.equal(removed.length,2);
   assert.equal((await one(db,'SELECT count(*)::int AS n FROM skribbil.gallery_votes WHERE turn_id=$1',[turnId])).n,2);
   assert.equal((await platform.bootstrap(null,{})).drawings.length,0);
  });
 }finally{if(app)await app.close();else await db.close();}
});
