import { randomUUID } from 'node:crypto';
import { hash, requireValue, isUuid } from './security.mjs';

const one=async(db,sql,args=[]) => (await db.query(sql,args)).rows[0];
export async function acceptEngineEvent(platform,assets,event,raw) {
  requireValue(isUuid(event.eventId)&&isUuid(event.matchId)&&Number.isSafeInteger(event.sequence)&&event.sequence>0,'Malformed engine event.');
  requireValue(['turn.completed','match.completed','drawing.penalized','hard-word.consumed'].includes(event.type),'Unknown engine event.');
  requireValue(event.payload&&typeof event.payload==='object'&&!Array.isArray(event.payload),'Invalid event payload.');
  requireValue(Number.isFinite(Date.parse(event.occurredAt)),'Invalid event timestamp.');
  const fingerprint=hash(raw);
  const existing=await one(platform.db,`SELECT payload_sha256 FROM skribbil.engine_receipts WHERE event_id=$1`,[event.eventId]);
  if(existing) {requireValue(existing.payload_sha256===fingerprint,'Event ID reused with different contents.',409);return {duplicate:true};}
  const known=await one(platform.db,`SELECT * FROM skribbil.matches WHERE id=$1 AND engine_room_id=$2`,[event.matchId,event.lobbyId]);
  requireValue(known,'Unknown match/room.',404);
  const p=event.payload;
  let archived;
  if(event.type==='turn.completed') {
    requireValue(isUuid(p.turnId)&&isUuid(p.artistId)&&Number.isInteger(p.turnNumber)&&p.turnNumber>0&&Number.isInteger(p.round)&&p.round>0,'Invalid drawing turn.');
    requireValue(Array.isArray(p.drawing)&&p.drawing.length<=20000,'Drawing operation limit exceeded.');
    requireValue(Array.isArray(p.eligibleVoterIds)&&Array.isArray(p.voterIds)&&p.voterIds.every(id=>p.eligibleVoterIds.includes(id)&&id!==p.artistId),'Invalid voter snapshot.');
    requireValue(p.voterIds.length===new Set(p.voterIds).size&&p.eligibleVoterIds.length===new Set(p.eligibleVoterIds).size,'Duplicate voters.');
    requireValue(!p.penaltyApplied||(p.eligibleVoterIds.length>0&&p.voterIds.length===p.eligibleVoterIds.length),'Penalty requires unanimity.');
    archived=await assets.archive(p.turnId,p.drawing);
  }
  return platform.db.transaction(async db=>{
    const match=await one(db,`SELECT * FROM skribbil.matches WHERE id=$1 FOR UPDATE`,[event.matchId]);
    const duplicate=await one(db,`SELECT payload_sha256 FROM skribbil.engine_receipts WHERE event_id=$1`,[event.eventId]);
    if(duplicate){requireValue(duplicate.payload_sha256===fingerprint,'Conflicting event.',409);return {duplicate:true};}
    const metadata={...p};delete metadata.drawing;
    await db.query(`INSERT INTO skribbil.engine_events(id,match_id,engine_instance_id,sequence,event_type,payload,occurred_at,processed_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,now())`,[event.eventId,event.matchId,match.engine_instance_id,event.sequence,event.type,JSON.stringify(metadata),event.occurredAt]);
    await db.query(`INSERT INTO skribbil.engine_receipts(event_id,payload_sha256) VALUES($1,$2)`,[event.eventId,fingerprint]);
    const participant=async(userId,username,engineId=userId)=>{
      requireValue(isUuid(userId),'Invalid account ID.');
      // Only accounts admitted by the platform have a match_players row.
      const admitted=await one(db,`SELECT user_id FROM skribbil.match_players WHERE match_id=$1 AND user_id=$2`,[event.matchId,userId]);
      requireValue(admitted,'Account was not admitted to this match.',409);
      await db.query(`UPDATE skribbil.match_players SET engine_player_id=$3 WHERE match_id=$1 AND user_id=$2`,[event.matchId,userId,engineId]);
    };
    if(event.type==='drawing.penalized'||event.type==='hard-word.consumed') {
      await participant(p.userId);
      await db.query(`INSERT INTO skribbil.user_game_penalty_state(user_id,game_id,pending,occurred_at,source_event_id) VALUES($1,$2,$3,$4,$5)
        ON CONFLICT(user_id,game_id) DO UPDATE SET pending=excluded.pending,occurred_at=excluded.occurred_at,source_event_id=excluded.source_event_id
        WHERE skribbil.user_game_penalty_state.occurred_at<=excluded.occurred_at`,[p.userId,match.game_id,event.type==='drawing.penalized',event.occurredAt,event.eventId]);
    } else if(event.type==='turn.completed') {
      await participant(p.artistId,p.artistUsername);
      for(const voter of p.eligibleVoterIds)await participant(voter);
      await db.query(`UPDATE skribbil.matches SET status='running',started_at=coalesce(started_at,$2) WHERE id=$1 AND status='lobby'`,[match.id,event.occurredAt]);
      await db.query(`INSERT INTO skribbil.drawing_turns(id,match_id,artist_id,turn_number,round_number,status,word,difficulty,ended_at,electorate_size)
        VALUES($1,$2,$3,$4,$5,'ended',$6,$7,$8,$9)`,[p.turnId,match.id,p.artistId,p.turnNumber,p.round,p.word,p.hardWord?'hard':'normal',event.occurredAt,p.eligibleVoterIds.length]);
      for(const id of p.eligibleVoterIds)await db.query(`INSERT INTO skribbil.turn_eligible_voters(turn_id,match_id,artist_id,voter_id) VALUES($1,$2,$3,$4)`,[p.turnId,match.id,p.artistId,id]);
      for(const id of p.voterIds)await db.query(`INSERT INTO skribbil.drawing_dislikes(turn_id,voter_id) VALUES($1,$2)`,[p.turnId,id]);
      if(p.penaltyApplied) {
        const score=await one(db,`INSERT INTO skribbil.score_events(match_id,user_id,kind,delta,idempotency_key,engine_event_id)
          VALUES($1,$2,'dislike_penalty',-100,$3,$4) RETURNING id`,[match.id,p.artistId,`penalty:${p.turnId}`,event.eventId]);
        await db.query(`INSERT INTO skribbil.drawing_penalties(turn_id,match_id,artist_id,score_event_id) VALUES($1,$2,$3,$4)`,[p.turnId,match.id,p.artistId,score.id]);
        await db.query(`INSERT INTO skribbil.hard_word_obligations(source_turn_id,match_id,artist_id) VALUES($1,$2,$3)`,[p.turnId,match.id,p.artistId]);
      }
      if(p.hardWord) await db.query(`UPDATE skribbil.hard_word_obligations SET consumed_turn_id=$3,consumed_at=$4 WHERE match_id=$1 AND artist_id=$2 AND consumed_turn_id IS NULL AND source_turn_id<>$3`,[match.id,p.artistId,p.turnId,event.occurredAt]);
      const ids={};
      for(const [kind,asset]of Object.entries(archived)) {
        ids[kind]=randomUUID();
        await db.query(`INSERT INTO skribbil.object_assets(id,owner_id,policy_id,storage_backend,bucket,object_key,media_type,bytes,sha256,state,expires_at)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'ready',now()+$10::interval)`,[ids[kind],p.artistId,kind==='image'?'drawing-original':'drawing-replay',asset.backend,asset.bucket,asset.key,asset.mediaType,asset.bytes,asset.sha256,kind==='image'?'30 days':'7 days']);
      }
      await db.query(`INSERT INTO skribbil.drawings(turn_id,match_id,artist_id,image_asset_id,replay_asset_id,prompt_snapshot,dislike_count)
        VALUES($1,$2,$3,$4,$5,$6,$7)`,[p.turnId,match.id,p.artistId,ids.image,ids.replay,String(p.word).slice(0,500),p.voterIds.length]);
    } else if(event.type==='match.completed') {
      requireValue(!match.accepted_result_id,'Match already finalized.',409);
      requireValue(match.status!=='cancelled','Cancelled match cannot award results.',409);
      requireValue(Array.isArray(p.participants)&&p.participants.length>=2&&p.participants.length<=24,'Invalid result roster.');
      requireValue(new Set(p.participants.map(v=>v.userId)).size===p.participants.length,'Duplicate result player.');
      if(p.deliveryFailed) {await db.query(`UPDATE skribbil.matches SET status='cancelled' WHERE id=$1`,[match.id]);return {cancelled:true,reason:'Engine reported incomplete event delivery.'};}
      let finalRules=match.custom_rules;
      // Older engine versions may omit this snapshot. New private completions
      // preserve the owner's final native settings for the next rematch. The
      // allowlist deliberately cannot change privacy, game or competitive mode.
      if(p.settings!==undefined) {
        const s=p.settings;
        requireValue(s&&typeof s==='object'&&!Array.isArray(s)&&Number.isInteger(s.rounds)&&s.rounds>=1&&s.rounds<=20&&
          Number.isInteger(s.drawTime)&&s.drawTime>=60&&s.drawTime<=300&&Number.isInteger(s.maxPlayers)&&s.maxPlayers>=2&&s.maxPlayers<=24,'Invalid final room settings.');
        if(match.mode==='casual')finalRules={...match.custom_rules,rounds:s.rounds,drawTime:s.drawTime,maxPlayers:s.maxPlayers};
        else {
          const ruleSet=await one(db,`SELECT rules FROM skribbil.rule_sets WHERE id=$1`,[match.rule_set_id]);
          requireValue(s.rounds===ruleSet.rules.rounds&&s.drawTime===ruleSet.rules.drawingTime&&s.maxPlayers===ruleSet.rules.maxPlayers,
            'Competitive result settings differ from the locked rules.',409);
        }
      }
      const game=await one(db,`SELECT engine_revision FROM skribbil.games WHERE id=$1`,[match.game_id]);
      const result=await one(db,`INSERT INTO skribbil.match_results(match_id,version,source,engine_revision,payload_sha256,idempotency_key)
        VALUES($1,1,'engine',$2,$3,$4) RETURNING id`,[match.id,game.engine_revision,fingerprint,`engine:${event.eventId}`]);
      for(const v of p.participants) {
        requireValue(Number.isSafeInteger(v.score)&&Math.abs(v.score)<=1000000,'Invalid score.');
        await participant(v.userId,v.username,v.playerId);
        const rank=1+p.participants.filter(other=>other.score>v.score).length;
        const correctGuesses=v.correctGuesses??0,fastestGuessMs=v.fastestGuessMs??null;
        requireValue(Number.isInteger(correctGuesses)&&correctGuesses>=0&&(fastestGuessMs===null||(Number.isSafeInteger(fastestGuessMs)&&fastestGuessMs>=0)),'Invalid guess telemetry.');
        await db.query(`INSERT INTO skribbil.match_result_players(result_id,match_id,user_id,score,placement,won,correct_guesses,fastest_guess_ms,game_stats) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,[result.id,match.id,v.userId,v.score,rank,rank===1,correctGuesses,fastestGuessMs,JSON.stringify({comebackWin:v.comebackWin===true})]);
        const achievements=[];
        if(correctGuesses>0&&fastestGuessMs!==null&&fastestGuessMs<=5000)achievements.push('mind-reader');
        if(v.comebackWin===true&&rank===1)achievements.push('comeback-kid');
        for(const slug of achievements)await db.query(`INSERT INTO skribbil.user_achievements(user_id,achievement_id,match_id,evidence)
          SELECT $1,id,$2,$3 FROM skribbil.achievement_definitions WHERE slug=$4 AND criterion_version=1 ON CONFLICT DO NOTHING`,[v.userId,match.id,JSON.stringify({engineEvent:event.eventId,correctGuesses,fastestGuessMs,comebackWin:v.comebackWin===true}),slug]);
        const sum=await one(db,`SELECT coalesce(sum(delta),0)::int AS total FROM skribbil.score_events WHERE match_id=$1 AND user_id=$2`,[match.id,v.userId]);
        await db.query(`INSERT INTO skribbil.score_events(match_id,user_id,kind,delta,idempotency_key,engine_event_id) VALUES($1,$2,'bonus',$3,$4,$5)`,[match.id,v.userId,v.score-sum.total,`final:${match.id}:${v.userId}`,event.eventId]);
        if(match.season_id)await platform.leaguePoints(db,match,result.id,v.userId,rank);
        await db.query(`INSERT INTO skribbil.xp_events(user_id,game_id,match_id,amount,reason,idempotency_key) VALUES($1,$2,$3,$4,'match completed',$5)`,[v.userId,match.game_id,match.id,rank===1?50:25,`match:${match.id}:${v.userId}`]);
        await db.query(`INSERT INTO skribbil.challenge_progress(window_id,user_id,progress,completed_at)
          SELECT w.id,$1,1,CASE WHEN w.target=1 THEN now() END FROM skribbil.challenge_windows w
          WHERE w.starts_at<=$2 AND w.ends_at>$2 AND (w.metric='matches_completed' OR (w.metric='matches_won' AND $3))
          ON CONFLICT(window_id,user_id) DO UPDATE SET progress=skribbil.challenge_progress.progress+1,
          completed_at=CASE WHEN skribbil.challenge_progress.progress+1 >= (SELECT target FROM skribbil.challenge_windows WHERE id=excluded.window_id) THEN now() ELSE NULL END`,[v.userId,event.occurredAt,rank===1]);
        await platform.grantLevelRewards(db,v.userId);
      }
      await db.query(`UPDATE skribbil.matches SET status='completed',accepted_result_id=$2,started_at=coalesce(started_at,created_at),ended_at=$3,custom_rules=$4 WHERE id=$1`,[match.id,result.id,event.occurredAt,JSON.stringify(finalRules)]);
    }
    return {accepted:true};
  });
}
