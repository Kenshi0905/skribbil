import http from 'node:http';
import https from 'node:https';
import { readFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { openDatabase } from './db.mjs';
import { Platform } from './platform.mjs';
import { Competition } from './competition.mjs';
import { Social } from './social.mjs';
import { AssetStore } from './assets.mjs';
import { acceptEngineEvent } from './events.mjs';
import { loadConfig } from './config.mjs';
import { ApiError,requireValue,isUuid,textField,sessionToken,setSession,signedTicket,verifySignature } from './security.mjs';

const one=async(db,sql,args=[]) => (await db.query(sql,args)).rows[0];
const json=(res,status,value)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(value));};
async function body(req,limit=32768) {
  const chunks=[];let size=0;
  for await(const chunk of req){size+=chunk.length;if(size>limit)throw new ApiError(413,'Request is too large.');chunks.push(chunk);}
  return Buffer.concat(chunks);
}
const sameSecret=(a,b)=>typeof a==='string'&&typeof b==='string'&&Buffer.byteLength(a)===Buffer.byteLength(b)&&timingSafeEqual(Buffer.from(a),Buffer.from(b));

export async function createApp({db,config,assets}={}) {
  config ||= await loadConfig(); db ||= await openDatabase(); assets ||= new AssetStore();
  const platform=new Platform(db),connections=new Map(),limits=new Map();
  const competition=new Competition(platform);
  const social=new Social(platform);
  const webRoot=resolve('web');let engineCache={at:0,available:false};
  const engineStatus=async()=>{
    if(Date.now()-engineCache.at>5000){
      let available=false;try{available=(await fetch(`${config.engineUrl}/engine/`,{signal:AbortSignal.timeout(1000)})).ok;}catch{}
      engineCache={at:Date.now(),available};
    }
    return {available:engineCache.available,url:'/engine/',ranked:config.ranked};
  };
  function originGuard(req,path) {
    if(!config.originKey||path==='/api/health'||path==='/api/internal/engine-events')return;
    requireValue(sameSecret(req.headers['x-skribbil-origin-key'],config.originKey),'Use the public Skribbil website.',403);
  }
  function rateLimit(req,key,maximum=100) {
    const id=`${req.socket.remoteAddress}:${key}`,now=Date.now();
    let entry=limits.get(id);if(!entry||entry.until<now){entry={n:0,until:now+60000};limits.set(id,entry);}
    requireValue(++entry.n<=maximum,'Too many requests. Try again in a minute.',429);
  }
  async function engineRequest(path,data) {
    const response=await fetch(`${config.engineUrl}${path}`,{method:'POST',headers:{Authorization:`Bearer ${config.secret}`,'Content-Type':'application/json'},body:JSON.stringify(data),signal:AbortSignal.timeout(5000)}).catch(()=>{throw new ApiError(503,'The game server is waking up or unavailable. Try again shortly.');});
    if(!response.ok)throw new ApiError(response.status===503?503:response.status===404?404:409,(await response.text()).trim().slice(0,200));
    return response.json();
  }
  async function admit(user,match,role='player') {
    requireValue(['player','spectator'].includes(role),'Invalid role.');
    requireValue(['lobby','running'].includes(match.status),'This match has finished.',409);
    await db.transaction(async tx=>{
      await tx.query(`SELECT id FROM skribbil.users WHERE id=$1 FOR UPDATE`,[user.id]);
      if(role==='player') {
        const active=await one(tx,`SELECT m.id FROM skribbil.match_players p JOIN skribbil.matches m ON m.id=p.match_id
          WHERE p.user_id=$1 AND m.status IN ('lobby','running') AND m.id<>$2 LIMIT 1`,[user.id,match.id]);
        requireValue(!active,'Finish your current room before joining another.',409);
        await tx.query(`INSERT INTO skribbil.match_players(match_id,user_id,engine_player_id,display_name_snapshot) VALUES($1,$2::uuid,$2::text,$3) ON CONFLICT(match_id,user_id) DO NOTHING`,[match.id,user.id,user.display_name]);
      } else await tx.query(`INSERT INTO skribbil.spectator_sessions(match_id,user_id,delay_ms) VALUES($1,$2,0)`,[match.id,user.id]);
    });
    const debt=await one(db,`SELECT pending FROM skribbil.user_game_penalty_state WHERE user_id=$1 AND game_id=$2`,[user.id,match.game_id]);
    const token=signedTicket({userId:user.id,username:user.display_name,matchId:match.id,lobbyId:match.engine_room_id,expiresAt:Math.floor(Date.now()/1000)+120,role,hardWordPending:debt?.pending||false},config.secret);
    return {url:`/engine/league/join?ticket=${encodeURIComponent(token)}`,matchId:match.id};
  }
  async function newRoom(user,input) {
    const mode=input.mode==='ranked'?'ranked':'private';
    if(mode==='ranked')requireValue(config.ranked,'Ranked play opens after deployment reliability checks. Private play is available.',503);
    const rounds=mode==='ranked'?3:Number(input.rounds||3),drawTime=mode==='ranked'?80:Number(input.drawTime||80),maxPlayers=mode==='ranked'?8:Number(input.maxPlayers||8);
    requireValue(Number.isInteger(rounds)&&rounds>=1&&rounds<=20&&Number.isInteger(drawTime)&&drawTime>=60&&drawTime<=300&&Number.isInteger(maxPlayers)&&maxPlayers>=2&&maxPlayers<=24,'Use 1–20 rounds, 60–300 seconds, and 2–24 players.');
    const context=await platform.context(),id=randomUUID();
    // API checks admission before allocating engine resources.
    const active=await one(db,`SELECT m.id FROM skribbil.match_players p JOIN skribbil.matches m ON m.id=p.match_id WHERE p.user_id=$1 AND m.status IN ('lobby','running') LIMIT 1`,[user.id]);
    requireValue(!active,'Finish or cancel your current room before making another.',409);
    await db.query(`INSERT INTO skribbil.matches(id,game_id,rule_set_id,community_id,season_id,mode,engine_room_id,engine_instance_id,custom_rules,private,created_by)
      VALUES($1,$2,$3,$4,$5,$6,$7,'primary',$8,$9,$10)`,[id,context.game_id,mode==='ranked'?context.ranked_rules:context.private_rules,context.community_id,mode==='ranked'?context.season_id:null,mode==='ranked'?'ranked':'casual',`pending-${id}`,JSON.stringify(mode==='ranked'?{}:{rounds,drawTime,maxPlayers}),mode==='private'&&input.private!==false,user.id]);
    try {
      const room=await engineRequest('/engine/internal/rooms',{matchId:id,mode,rounds,drawTime,maxPlayers});
      const match=await one(db,`UPDATE skribbil.matches SET engine_room_id=$2 WHERE id=$1 RETURNING *`,[id,room.lobbyId]);
      return await admit(user,match);
    } catch(error) {await db.query(`UPDATE skribbil.matches SET status='cancelled' WHERE id=$1`,[id]);throw error;}
  }
  async function getDrawing(user,id,kind) {
    requireValue(isUuid(id),'Invalid drawing.');
    const d=await one(db,`SELECT d.*,a.object_key,a.media_type,a.state,a.expires_at FROM skribbil.drawings d
      JOIN skribbil.object_assets a ON a.id=CASE WHEN $2='replay' THEN d.replay_asset_id ELSE d.image_asset_id END WHERE d.id=$1`,[id,kind]);
    requireValue(d&&d.state==='ready'&&(!d.expires_at||new Date(d.expires_at)>new Date()),'Drawing has expired or is unavailable.',404);
    let allowed=d.visibility==='public'&&d.publication_consent_at&&!d.consent_revoked_at;
    if(user)allowed ||= user.id===d.artist_id || !!(await one(db,`SELECT 1 FROM skribbil.platform_roles WHERE user_id=$1`,[user.id]));
    if(user&&d.visibility==='match')allowed ||= !!(await one(db,`SELECT 1 FROM skribbil.match_players WHERE match_id=$1 AND user_id=$2`,[d.match_id,user.id]));
    requireValue(allowed,'This drawing is private.',403);
    return {...await assets.get(d.object_key),type:d.media_type};
  }
  const server=http.createServer(async(req,res)=>{
    res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');
    res.setHeader('X-Frame-Options','SAMEORIGIN');
    try {
      const url=new URL(req.url,'http://localhost'),path=url.pathname;
      originGuard(req,path);
      if(path==='/api/health')return json(res,200,{ok:true,service:'Skribbil',database:db.mode});
      if(path==='/api/internal/engine-events') {
        requireValue(req.method==='POST','Method not allowed.',405);
        const raw=await body(req,8*1024*1024);
        requireValue(verifySignature(raw,req.headers['x-skribbil-signature'],config.secret),'Invalid engine signature.',401);
        return json(res,200,await acceptEngineEvent(platform,assets,JSON.parse(raw.toString()),raw));
      }
      const token=sessionToken(req),user=await platform.authenticate(token);
      if(path.startsWith('/engine/')) {
        requireValue(user,'Sign in at the Skribbil clubhouse to play.',401);
        requireValue(!path.startsWith('/engine/internal/'),'Not found.',404);
        return proxy(req,res);
      }
      if(!path.startsWith('/api/')) {
        requireValue(req.method==='GET'||req.method==='HEAD','Method not allowed.',405);
        const filename=resolve(webRoot,'.'+decodeURIComponent(path==='/'?'/index.html':path));
        requireValue(filename.startsWith(webRoot+'\\')||filename.startsWith(webRoot+'/'),'Not found.',404);
        const ext=extname(filename),types={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.ico':'image/x-icon'};
        requireValue(types[ext]&&!filename.endsWith('_worker.js'),'Not found.',404);
        let file;try{file=await readFile(filename);}catch{throw new ApiError(404,'Not found.');}
        res.setHeader('Content-Type',types[ext]);res.setHeader('Cache-Control','no-cache');res.end(req.method==='HEAD'?undefined:file);return;
      }
      rateLimit(req,'api',200);
      let input={};
      if(!['GET','HEAD'].includes(req.method)) {
        requireValue(req.headers['x-requested-with']==='Skribbil','Invalid request origin.',403);
        requireValue(!req.headers.origin||req.headers.origin===config.origin,'Invalid request origin.',403);
        requireValue((req.headers['content-type']||'').startsWith('application/json'),'Send application/json.',415);
        const raw=await body(req);input=raw.length?JSON.parse(raw.toString()):{};
      }
      if(path==='/api/bootstrap'&&req.method==='GET')return json(res,200,await platform.bootstrap(user,await engineStatus()));
      if(path==='/api/me'&&req.method==='GET')return json(res,200,{user:await platform.profile(user)});
      const bracket=path.match(/^\/api\/tournaments\/([a-f0-9-]+)\/bracket$/);
      if(bracket&&req.method==='GET'){
        const value=await competition.getTournament(bracket[1]);const {entries,fixtures,...tournament}=value;
        return json(res,200,{tournament,entries,fixtures:fixtures.map(f=>({...f,roundNumber:f.round_number,groupName:f.group_label,
          homeEntryId:f.entries?.find(e=>e.slot===1)?.entry_id,awayEntryId:f.entries?.find(e=>e.slot===2)?.entry_id,winnerEntryId:f.winner_entry_id}))});
      }
      if((path==='/api/auth/register'||path==='/api/auth/login')&&req.method==='POST') {
        rateLimit(req,'auth',12);const result=await (path.endsWith('register')?platform.register(input):platform.login(input));
        setSession(res,result.token,config.secure);return json(res,200,{user:await platform.profile(result.user)});
      }
      if(path==='/api/auth/logout'&&req.method==='POST'){await platform.logout(token);setSession(res,'',config.secure);disconnect(user?.id);return json(res,200,{ok:true});}
      const drawingAsset=path.match(/^\/api\/drawings\/([a-f0-9-]+)\/(image|replay)$/);
      if(drawingAsset&&req.method==='GET'){
        const asset=await getDrawing(user,drawingAsset[1],drawingAsset[2]);
        if(asset.url){res.writeHead(302,{Location:asset.url,'Cache-Control':'no-store'});res.end();}
        else{res.writeHead(200,{'Content-Type':asset.type,'Cache-Control':'private, no-store'});res.end(asset.body);}return;
      }
      requireValue(user,'Sign in to continue.',401);
      if(path==='/api/party'&&req.method==='GET')return json(res,200,await social.getParty(user));
      if(path==='/api/party'&&req.method==='POST')return json(res,201,await social.createParty(user));
      if(path==='/api/party/leave'&&req.method==='POST')return json(res,200,await social.leaveParty(user));
      const partyInvite=path.match(/^\/api\/party\/([a-f0-9-]+)\/invites$/);
      if(partyInvite&&req.method==='POST')return json(res,201,await social.invite(user,partyInvite[1],input));
      const partyAccept=path.match(/^\/api\/party\/invites\/([a-f0-9-]+)\/accept$/);
      if(partyAccept&&req.method==='POST')return json(res,200,await social.acceptInvite(user,partyAccept[1]));
      if(path==='/api/profile'&&req.method==='PATCH'){await platform.updateProfile(user,input);return json(res,200,{user:await platform.profile(user)});}
      if(path==='/api/rooms'&&req.method==='POST'){rateLimit(req,'rooms',8);return json(res,201,await newRoom(user,input));}
      const roomJoin=path.match(/^\/api\/rooms\/([a-f0-9-]+)\/join$/);
      if(roomJoin&&req.method==='POST'){
        requireValue(isUuid(roomJoin[1]),'Invalid room.');const match=await one(db,`SELECT * FROM skribbil.matches WHERE id=$1`,[roomJoin[1]]);
        requireValue(match,'Room not found.',404);return json(res,200,await admit(user,match,input.role||'player'));
      }
      const cancel=path.match(/^\/api\/rooms\/([a-f0-9-]+)\/cancel$/);
      if(cancel&&req.method==='POST'){
        requireValue(isUuid(cancel[1]),'Invalid room.');
        const room=await one(db,`SELECT * FROM skribbil.matches WHERE id=$1 AND created_by=$2 AND status IN ('lobby','running')`,[cancel[1],user.id]);
        requireValue(room,'Only the owner can cancel an unstarted room.',409);
        try{await engineRequest('/engine/internal/rooms/cancel',{matchId:room.id,lobbyId:room.engine_room_id});}
        catch(error){if(error.status!==404)throw error;} // A disappeared in-memory room is abandoned, never finalized.
        const changed=await db.query(`UPDATE skribbil.matches SET status='cancelled' WHERE id=$1 AND created_by=$2 AND status IN ('lobby','running') RETURNING id`,[cancel[1],user.id]);
        requireValue(changed.rows.length,'Only the owner can cancel an unstarted room.',409);return json(res,200,{ok:true});
      }
      if(path==='/api/teams'&&req.method==='POST')return json(res,201,{team:await platform.createTeam(user,input)});
      if(path==='/api/friends'&&req.method==='POST'){await platform.friend(user,input);return json(res,200,{ok:true});}
      const tournament=path.match(/^\/api\/tournaments\/([a-f0-9-]+)\/register$/);
      if(tournament&&req.method==='POST'){await platform.registerTournament(user,tournament[1]);return json(res,200,{ok:true});}
      const claim=path.match(/^\/api\/challenges\/([a-f0-9-]+)\/claim$/);
      if(claim&&req.method==='POST'){await platform.claimChallenge(user,claim[1]);return json(res,200,{ok:true});}
      if(path==='/api/drawings/mine'&&req.method==='GET')return json(res,200,{drawings:(await db.query(`SELECT id,prompt_snapshot AS prompt,created_at AS date,visibility,(publication_consent_at IS NOT NULL AND consent_revoked_at IS NULL) AS consent,dislike_count AS dislikes,'/api/drawings/'||id||'/image' AS url,replay_asset_id IS NOT NULL AS "replayAvailable" FROM skribbil.drawings WHERE artist_id=$1 ORDER BY created_at DESC LIMIT 100`,[user.id])).rows});
      const consent=path.match(/^\/api\/drawings\/([a-f0-9-]+)\/consent$/);
      if(consent&&req.method==='POST'){
        requireValue(isUuid(consent[1])&&typeof input.allow==='boolean','Invalid consent.');
        await db.transaction(async tx=>{
          const result=await tx.query(`UPDATE skribbil.drawings SET publication_consent_at=CASE WHEN $3 THEN now() ELSE publication_consent_at END,
            consent_revoked_at=CASE WHEN $3 THEN NULL ELSE now() END,visibility=CASE WHEN $3 THEN visibility ELSE 'private' END WHERE id=$1 AND artist_id=$2 RETURNING image_asset_id`,[consent[1],user.id,input.allow]);
          requireValue(result.rows.length,'Drawing not found.',404);
          if(!input.allow)await tx.query(`UPDATE skribbil.object_assets SET policy_id='drawing-original',expires_at=now()+interval '30 days' WHERE id=$1 AND NOT legal_hold`,[result.rows[0].image_asset_id]);
        });return json(res,200,{ok:true});
      }
      const detail=path.match(/^\/api\/matches\/([a-f0-9-]+)(\/mvp)?$/);
      if(detail){
        requireValue(isUuid(detail[1]),'Invalid match.');const match=await one(db,`SELECT id,status,mode,ended_at FROM skribbil.matches WHERE id=$1`,[detail[1]]);
        requireValue(match,'Match not found.',404);
        requireValue(await one(db,`SELECT 1 FROM skribbil.match_players WHERE match_id=$1 AND user_id=$2`,[match.id,user.id]),'Only match participants can view this summary.',403);
        if(detail[2]&&req.method==='POST'){
          requireValue(match.status==='completed'&&new Date(match.ended_at).getTime()>Date.now()-86400000,'MVP voting is open for 24 hours after completion.',409);
          requireValue(isUuid(input.nomineeId)&&input.nomineeId!==user.id&&['best_drawing','fastest_guesser','community_mvp'].includes(input.category),'Choose another player and a valid award.');
          await db.query(`INSERT INTO skribbil.mvp_ballots(match_id,voter_id,nominee_id,category) VALUES($1,$2,$3,$4) ON CONFLICT(match_id,voter_id,category) DO NOTHING`,[match.id,user.id,input.nomineeId,input.category]);return json(res,200,{ok:true});
        }
        if(!detail[2]&&req.method==='GET')return json(res,200,{match,participants:(await db.query(`SELECT u.id,u.username,p.score,p.placement AS rank FROM skribbil.matches m JOIN skribbil.match_result_players p ON p.result_id=m.accepted_result_id JOIN skribbil.users u ON u.id=p.user_id WHERE m.id=$1 ORDER BY p.placement`,[match.id])).rows,
          drawings:(await db.query(`SELECT id,prompt_snapshot AS prompt,artist_id AS "artistId",visibility,'/api/drawings/'||id||'/image' AS url,replay_asset_id IS NOT NULL AS "replayAvailable" FROM skribbil.drawings WHERE match_id=$1 AND (artist_id=$2 OR visibility IN ('match','public'))`,[match.id,user.id])).rows,
          mvp:(await db.query(`SELECT nominee_id AS "nomineeId",category,count(*) AS votes FROM skribbil.mvp_ballots WHERE match_id=$1 GROUP BY nominee_id,category`,[match.id])).rows});
      }
      if(path.startsWith('/api/admin')){
        await platform.admin(user);
        const context=await platform.context();
        if(path==='/api/admin/seasons'&&req.method==='POST')return json(res,201,await competition.createSeason(user,{
          ...input,leagueId:'00000000-0000-4000-8000-000000000040',reason:input.reason||'Create community season',
          games:[{gameId:context.game_id,ruleSetId:context.ranked_rules,scoringConfig:{method:'placement',points:{'1':25,'2':18,'3':15,'4':12,'5':10,'6':8},participation:5}}]}));
        const activateSeason=path.match(/^\/api\/admin\/seasons\/([a-f0-9-]+)\/(activate|close)$/);
        if(activateSeason&&req.method==='POST')return json(res,200,await competition[activateSeason[2]==='activate'?'activateSeason':'closeSeason'](user,activateSeason[1],{reason:input.reason||'Update community season'}));
        if(path==='/api/admin/tournaments'&&req.method==='POST')return json(res,201,await competition.createTournament(user,{
          ...input,communityId:context.community_id,gameId:context.game_id,ruleSetId:context.ranked_rules,seasonId:context.season_id,reason:input.reason||'Create community tournament'}));
        const seedTournament=path.match(/^\/api\/admin\/tournaments\/([a-f0-9-]+)\/seed$/);
        if(seedTournament&&req.method==='POST')return json(res,200,await competition.generateFixtures(user,seedTournament[1],{...input,reason:input.reason||'Seed tournament fixtures'}));
        const fixtureResult=path.match(/^\/api\/admin\/fixtures\/([a-f0-9-]+)\/result$/);
        if(fixtureResult&&req.method==='POST')return json(res,200,await competition.recordFixture(user,fixtureResult[1],input));
        if(path==='/api/admin'&&req.method==='GET')return json(res,200,{audit:(await db.query(`SELECT a.*,u.username FROM skribbil.admin_audit_log a JOIN skribbil.users u ON u.id=a.actor_id ORDER BY a.created_at DESC LIMIT 100`)).rows,
          seasons:(await db.query(`SELECT id,name,status,starts_at AS "startsAt",ends_at AS "endsAt" FROM skribbil.seasons ORDER BY starts_at DESC`)).rows,
          users:(await db.query(`SELECT id,username,status FROM skribbil.users WHERE username<>'skribbil_system' ORDER BY created_at DESC LIMIT 100`)).rows,
          matches:(await db.query(`SELECT id,mode,status,ended_at FROM skribbil.matches ORDER BY created_at DESC LIMIT 100`)).rows,
          drawings:(await db.query(`SELECT id,prompt_snapshot AS prompt,publication_consent_at AS consent,visibility FROM skribbil.drawings ORDER BY created_at DESC LIMIT 100`)).rows});
        if(path==='/api/admin/adjustments'&&req.method==='POST')return json(res,200,await platform.adjust(user,input));
        if(path==='/api/admin/bans'&&req.method==='POST'){await platform.ban(user,input);disconnect(input.userId);return json(res,200,{ok:true});}
        const curate=path.match(/^\/api\/admin\/drawings\/([a-f0-9-]+)$/);
        if(curate&&req.method==='POST'){
          requireValue(isUuid(curate[1])&&['fame','shame',null].includes(input.hall),'Invalid gallery selection.');
          await db.transaction(async tx=>{
            const drawing=await one(tx,`SELECT * FROM skribbil.drawings WHERE id=$1 FOR UPDATE`,[curate[1]]);requireValue(drawing,'Drawing not found.',404);
            if(input.hall){
              requireValue(drawing.publication_consent_at&&!drawing.consent_revoked_at,'The artist must consent to publication.',409);
              await tx.query(`UPDATE skribbil.drawings SET visibility='public' WHERE id=$1`,[drawing.id]);
              await tx.query(`INSERT INTO skribbil.gallery_entries(drawing_id,hall,title,caption,curated_by,published_at) VALUES($1,$2,$3,$4,$5,now())
                ON CONFLICT(drawing_id,hall) DO UPDATE SET title=excluded.title,caption=excluded.caption,curated_by=excluded.curated_by,published_at=now(),unpublished_at=NULL`,[drawing.id,input.hall,textField(input.title||drawing.prompt_snapshot,1,100,'Title'),String(input.caption||'').slice(0,500),user.id]);
              await tx.query(`UPDATE skribbil.object_assets SET policy_id='curated-art',expires_at=NULL WHERE id=$1`,[drawing.image_asset_id]);
            }else{
              await tx.query(`UPDATE skribbil.gallery_entries SET unpublished_at=now() WHERE drawing_id=$1 AND published_at IS NOT NULL`,[drawing.id]);
              await tx.query(`UPDATE skribbil.drawings SET visibility='private' WHERE id=$1`,[drawing.id]);
              await tx.query(`UPDATE skribbil.object_assets SET policy_id='drawing-original',expires_at=now()+interval '30 days' WHERE id=$1`,[drawing.image_asset_id]);
            }
            await platform.audit(tx,user,'drawing.curated','drawing',drawing.id,'Gallery moderation',drawing,{hall:input.hall});
          });return json(res,200,{ok:true});
        }
      }
      throw new ApiError(404,'This endpoint does not exist.');
    }catch(error){
      const status=error.status||(error instanceof SyntaxError?400:error.code==='23505'?409:error.code==='23503'?400:500);
      if(status===500)console.error('Request failed:',error.message);
      if(!res.headersSent)json(res,status,{error:status===500?'Something went wrong. Please retry.':error.code==='23505'?'That record already exists.':error.code==='23503'?'The selected record is invalid.':error.message});else res.end();
    }
  });
  function proxy(req,res) {
    const target=new URL(req.url,config.engineUrl),transport=target.protocol==='https:'?https:http;
    const headers={...req.headers,host:new URL(config.origin).host};delete headers['x-skribbil-origin-key'];
    const upstream=transport.request(target,{method:req.method,headers},response=>{res.writeHead(response.statusCode,response.headers);response.pipe(res);});
    upstream.on('error',()=>{if(!res.headersSent)json(res,503,{error:'The game server is unavailable. Try again shortly.'});else res.end();});
    req.on('aborted',()=>upstream.destroy());req.pipe(upstream);
  }
  function disconnect(userId){for(const socket of connections.get(userId)||[])socket.destroy();connections.delete(userId);}
  server.on('upgrade',async(req,socket,head)=>{
    try{
      originGuard(req,req.url);
      requireValue(req.url.startsWith('/engine/')&&!req.url.startsWith('/engine/internal/'),'Not found.',404);
      requireValue(req.headers.origin===config.origin,'Invalid WebSocket origin.',403);
      const user=await platform.authenticate(sessionToken(req));requireValue(user,'Authentication required.',401);
      const target=new URL(req.url,config.engineUrl),transport=target.protocol==='https:'?https:http;
      const headers={...req.headers,host:new URL(config.origin).host};delete headers['x-skribbil-origin-key'];
      const upstream=transport.request(target,{headers});
      upstream.on('upgrade',(response,remote,remoteHead)=>{
        socket.write(`HTTP/1.1 101 Switching Protocols\r\n${Object.entries(response.headers).map(([k,v])=>`${k}: ${v}`).join('\r\n')}\r\n\r\n`);
        if(head.length)remote.write(head);if(remoteHead.length)socket.write(remoteHead);
        socket.pipe(remote);remote.pipe(socket);
        let peers=connections.get(user.id);if(!peers){peers=new Set();connections.set(user.id,peers);}peers.add(socket);
        socket.on('close',()=>{remote.destroy();peers.delete(socket);});remote.on('close',()=>socket.destroy());
        remote.on('error',()=>socket.destroy());socket.on('error',()=>remote.destroy());
      });
      upstream.on('response',response=>{socket.end(`HTTP/1.1 ${response.statusCode} Rejected\r\nConnection: close\r\n\r\n`);response.resume();});
      upstream.on('error',()=>socket.destroy());upstream.end();
    }catch(error){socket.end(`HTTP/1.1 ${error.status||500} Rejected\r\nConnection: close\r\n\r\n`);}
  });
  const cleanup=setInterval(async()=>{
    for(const [key,value]of limits)if(value.until<Date.now())limits.delete(key);
    try{
      const expired=(await db.query(`SELECT id,object_key FROM skribbil.object_assets WHERE state='ready' AND NOT legal_hold AND expires_at<now() LIMIT 20`)).rows;
      for(const a of expired){await assets.remove(a.object_key);await db.query(`UPDATE skribbil.object_assets SET state='deleted',deleted_at=now() WHERE id=$1`,[a.id]);}
    }catch(error){console.error('Retention retry scheduled:',error.message);}
  },60000);cleanup.unref();
  server.on('close',()=>{clearInterval(cleanup);for(const id of connections.keys())disconnect(id);});
  return {server,db,platform,config};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  const app=await createApp();
  app.server.listen(app.config.port,app.config.host,()=>console.log(`Skribbil is ready at http://localhost:${app.config.port} (${app.db.mode})`));
  const stop=()=>app.server.close(async()=>{await app.db.close();process.exit(0);});process.on('SIGINT',stop);process.on('SIGTERM',stop);
}
