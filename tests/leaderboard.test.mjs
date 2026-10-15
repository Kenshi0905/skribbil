import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {openDatabase} from '../server/db.mjs';
import {Platform} from '../server/platform.mjs';
import {leaderboard} from '../server/leaderboard.mjs';

const game='00000000-0000-4000-8000-000000000020';
const rules='00000000-0000-4000-8000-000000000030';
test('community leaderboard ranks all saved games, filters periods and friends, and searches beyond the first page', {timeout:60000}, async t => {
  const db=await openDatabase({url:'',dataDir:':memory:'});
  t.after(()=>db.close());
  const platform=new Platform(db);
  const users=[];
  for(let i=0;i<30;i++) {
    const id=randomUUID(); users.push({id,username:`leader_${String(i).padStart(2,'0')}`});
    await db.query('INSERT INTO skribbil.users(id,username,display_name,avatar_url) VALUES($1,$2::text,$2::text,$3)',[id,users[i].username,`/api/media/${id}`]);
  }
  const save=async(endedAt, scores, status='completed')=>{
    const id=randomUUID(), result=randomUUID();
    await db.query(`INSERT INTO skribbil.matches(id,game_id,rule_set_id,engine_room_id,engine_instance_id,private,started_at,ended_at,status)
      VALUES($1,$2,$3,$1::uuid::text,'leaderboard-test',true,$4::timestamptz-interval '1 hour',$4,$5)`,[id,game,rules,endedAt,status]);
    await db.query(`INSERT INTO skribbil.match_results(id,match_id,version,source,engine_revision,payload_sha256,idempotency_key)
      VALUES($1,$2,1,'engine','test',$3,$1::uuid::text)`,[result,id,'a'.repeat(64)]);
    for(const [index,score] of scores) {
      await db.query('INSERT INTO skribbil.match_players(match_id,user_id,engine_player_id,display_name_snapshot) VALUES($1,$2,$2::uuid::text,$3)',[id,users[index].id,users[index].username]);
      await db.query(`INSERT INTO skribbil.match_result_players(result_id,match_id,user_id,score,placement,won) VALUES($1,$2,$3,$4,1,$5)`,[result,id,users[index].id,score,index===0]);
    }
    await db.query('UPDATE skribbil.matches SET accepted_result_id=$2 WHERE id=$1',[id,result]);
    return {id,result};
  };
  const dates=(await db.query(`SELECT now()-interval '1 minute' AS current,
    (date_trunc('week',now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')-interval '1 minute' AS oldweek,
    (date_trunc('month',now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')-interval '8 days' AS oldmonth`)).rows[0];
  const match=await save(dates.current,users.map((_,i)=>[i,300-i]));
  await save(dates.oldweek,[[0,100]]);
  await save(dates.oldmonth,[[1,1000]]);
  await save(dates.current,[[0,9000]],'cancelled');
  let board=await leaderboard(platform,null);
  assert.equal(board.total,30);assert.equal(board.players.length,25);
  assert.equal(board.players[0].id,users[1].id);assert.equal(Number(board.players[0].points),1299);
  assert.equal(board.players[0].avatarUrl,`/api/media/${users[1].id}`);
  assert.equal((await platform.bootstrap(null,{})).leaderboard[0].id,users[1].id,'home uses the same all-game standings');
  const profile=await platform.profile(users[0]);
  assert.equal(profile.points,400,'profile totals include casual accepted scores and exclude cancelled results');
  assert.equal(profile.gamesPlayed,2);assert.equal(profile.wins,2);
  assert.equal(Number(profile.levelStartXp),0);assert.equal(Number(profile.nextLevelXp),150);
  board=await leaderboard(platform,users[29],{page:'2'});
  assert.equal(board.players.length,5);assert.equal(Number(board.players.at(-1).rank),30);
  assert.equal(Number(board.me.rank),30);
  board=await leaderboard(platform,null,{search:'leader_29'});
  assert.equal(board.total,1);assert.equal(Number(board.players[0].rank),30,'search preserves rank');
  assert.equal((await leaderboard(platform,null,{search:'%'})).total,0,'wildcards are literal');
  board=await leaderboard(platform,null,{period:'weekly'});
  assert.equal(board.players[0].id,users[0].id);assert.equal(Number(board.players[0].points),300);
  board=await leaderboard(platform,null,{period:'monthly'});
  assert.ok(board.players.every(p=>Number(p.points)<1000),'previous calendar month excluded');
  assert.equal((await leaderboard(platform,null,{period:'season'})).total,0);
  for(const [index,status] of [[1,'accepted'],[2,'pending'],[3,'blocked']]) {
    const pair=[users[0].id,users[index].id].sort();
    await db.query('INSERT INTO skribbil.friendships(user_low,user_high,requested_by,status) VALUES($1,$2,$3,$4)',[...pair,users[0].id,status]);
  }
  board=await leaderboard(platform,users[0],{scope:'friends'});
  assert.equal(board.total,2);assert.equal(Number(board.me.rank),2);
  await assert.rejects(leaderboard(platform,null,{scope:'friends'}),/Sign in/);
  for(const options of [{period:'bad'},{scope:'bad'},{page:'-1'},{page:'1.5'},{search:'a'.repeat(81)}]) await assert.rejects(leaderboard(platform,null,options));
  // Replace, rather than add to, the currently accepted match result.
  const correction=randomUUID();
  await db.query(`INSERT INTO skribbil.match_results(id,match_id,version,source,previous_result_id,actor_id,reason,engine_revision,payload_sha256,idempotency_key)
    VALUES($1,$2,2,'admin_correction',$3,$4,'Correct scoring error','test',$5,$1::uuid::text)`,[correction,match.id,match.result,users[0].id,'b'.repeat(64)]);
  await db.query(`INSERT INTO skribbil.match_result_players(result_id,match_id,user_id,score,placement,won) SELECT $1,match_id,user_id,score-100,placement,won FROM skribbil.match_result_players WHERE result_id=$2`,[correction,match.result]);
  await db.query('UPDATE skribbil.matches SET accepted_result_id=$2 WHERE id=$1',[match.id,correction]);
  board=await leaderboard(platform,null,{period:'weekly'});
  assert.equal(Number(board.players[0].points),200);
  assert.equal((await platform.profile(users[0])).points,300,'profile totals follow result corrections without double-counting');
  await db.query("UPDATE skribbil.users SET status='erased' WHERE id=$1",[users[0].id]);
  assert.equal((await leaderboard(platform,null)).total,29);
  // Season standings use league points, not raw scores from community games.
  const community='00000000-0000-4000-8000-000000000010';
  const leagueId=randomUUID(),seasonId=randomUUID();
  await db.query("INSERT INTO skribbil.leagues(id,community_id,name,slug) VALUES($1,$2,'Test league','leaderboard-test')",[leagueId,community]);
  await db.query(`INSERT INTO skribbil.seasons(id,league_id,community_id,name,starts_at,ends_at,status)
    VALUES($1,$2,$3,'Test season',now()-interval '1 day',now()+interval '1 day','active')`,[seasonId,leagueId,community]);
  const rankedRules='00000000-0000-4000-8000-000000000031';
  await db.query(`INSERT INTO skribbil.season_games(season_id,game_id,rule_set_id,scoring_version,scoring_config)
    VALUES($1,$2,$3,1,'{"method":"placement","points":{"1":25},"participation":5}')`,[seasonId,game,rankedRules]);
  await db.query('INSERT INTO skribbil.community_members(community_id,user_id) VALUES($1,$2)',[community,users[1].id]);
  const ranked=await save(dates.current,[[1,999]]);
  const rankedMatch=(await db.query(`UPDATE skribbil.matches SET mode='ranked',rule_set_id=$2,season_id=$3,community_id=$4 WHERE id=$1 RETURNING *`,[ranked.id,rankedRules,seasonId,community])).rows[0];
  await platform.leaguePoints(db,rankedMatch,ranked.result,users[1].id,1);
  board=await leaderboard(platform,null,{period:'season'});
  assert.equal(board.total,1);assert.equal(board.players[0].id,users[1].id);assert.equal(Number(board.players[0].points),25);

});
