import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { openDatabase } from '../server/db.mjs';
import { Rematch } from '../server/rematch.mjs';
import { Platform } from '../server/platform.mjs';
import { Clubhouses } from '../server/clubhouses.mjs';
import { ApiError } from '../server/security.mjs';

const gameId = '00000000-0000-4000-8000-000000000020';
const communityId = '00000000-0000-4000-8000-000000000010';
const privateRules = '00000000-0000-4000-8000-000000000030';
const rankedRules = '00000000-0000-4000-8000-000000000031';
const one = async (db, sql, args = []) => (await db.query(sql, args)).rows[0];
const rejects = (promise, status, pattern) => assert.rejects(promise, error => error.status === status && (!pattern || pattern.test(error.message)));
const launch = async (user, match) => ({ matchId: match.id, url: `/test-launch/${match.engine_room_id}/${user.id}` });

test('quick rematches preserve authority and reuse a durable successor', { timeout: 120000 }, async t => {
  const db = await openDatabase({ url: '', dataDir: ':memory:' });
  await db.query(await readFile(new URL('../database/rematch.sql', import.meta.url), 'utf8'));
  const user = async () => {
    const id = randomUUID(), name = `player_${id.slice(0, 8)}`;
    return one(db, 'INSERT INTO skribbil.users(id,username,display_name) VALUES($1,$2,$2) RETURNING *', [id, name]);
  };
  const completed = async ({ mode = 'casual', rules = { rounds: 5, drawTime: 120, maxPlayers: 6 }, privateRoom = true, season = null, ruleSetId } = {}) => {
    const players = await Promise.all([user(), user()]);
    const id = randomUUID(), resultId = randomUUID();
    await db.transaction(async tx => {
      await tx.query(`INSERT INTO skribbil.matches(id,game_id,rule_set_id,community_id,season_id,mode,
        engine_room_id,engine_instance_id,custom_rules,private,created_by,started_at)
        VALUES($1,$2,$3,$4,$5,$6,$7,'test',$8,$9,$10,now()-interval '10 minutes')`,
      [id, gameId, ruleSetId || (mode === 'casual' ? privateRules : rankedRules), communityId, season, mode, `old-${id}`, JSON.stringify(mode === 'casual' ? rules : {}), privateRoom, players[0].id]);
      for (const p of players) await tx.query(`INSERT INTO skribbil.match_players(match_id,user_id,engine_player_id,display_name_snapshot) VALUES($1,$2::uuid,$2::text,$3)`, [id, p.id, p.display_name]);
      await tx.query(`INSERT INTO skribbil.match_results(id,match_id,version,source,engine_revision,payload_sha256,idempotency_key)
        VALUES($1,$2,1,'engine','test',$3,$4)`, [resultId, id, 'a'.repeat(64), randomUUID()]);
      for (const [i, p] of players.entries()) await tx.query(`INSERT INTO skribbil.match_result_players(result_id,match_id,user_id,score,placement,won) VALUES($1,$2,$3,$4,$5,$6)`, [resultId, id, p.id, 100 - i * 50, i + 1, i === 0]);
      await tx.query(`UPDATE skribbil.matches SET status='completed',ended_at=now(),accepted_result_id=$2 WHERE id=$1`, [id, resultId]);
    });
    return { id, players, resultId };
  };
  const target = async source => one(db, `SELECT m.* FROM skribbil.match_rematches r JOIN skribbil.matches m ON m.id=r.target_match_id WHERE r.source_match_id=$1`, [source.id]);
  try {
    await t.test('concurrent prior participants share one room with the previous private settings', async () => {
      const source = await completed({ privateRoom: false });
      const requests = [];
      const service = new Rematch({ db, admit: launch, provision: async payload => {
        requests.push(payload);
        await new Promise(resolve => setTimeout(resolve, 20));
        return { lobbyId: `rematch-${payload.matchId}` };
      } });
      const launches = await Promise.all(Array.from({ length: 12 }, (_, i) => service.join(source.players[i % 2], source.id)));
      assert.equal(new Set(launches.map(v => v.matchId)).size, 1);
      assert.equal(new Set(requests.map(v => v.matchId)).size, 1);
      const match = await target(source);
      assert.equal(launches[0].matchId, match.id);
      assert.deepEqual(requests[0], { matchId: match.id, mode: 'private', rounds: 5, drawTime: 120, maxPlayers: 6 });
      assert.deepEqual(match.custom_rules, { rounds: 5, drawTime: 120, maxPlayers: 6 });
      assert.equal(match.private, false); assert.equal(match.rule_set_id, privateRules);
      assert.equal(match.status, 'lobby'); assert.equal(match.accepted_result_id, null);
      assert.equal(match.season_id, null);
      assert.equal(Number((await one(db, 'SELECT count(*) AS n FROM skribbil.match_players WHERE match_id=$1', [match.id])).n), 2);
      assert.equal((await one(db, 'SELECT status FROM skribbil.matches WHERE id=$1', [source.id])).status, 'completed');
    });

    await t.test('spectators, ticket-only users, disqualified players and unfinished results cannot rematch', async () => {
      const source = await completed(), outsider = await user();
      let calls = 0;
      const service = new Rematch({ db, admit: launch, provision: async () => { calls++; return { lobbyId: 'unused' }; } });
      await rejects(service.join(outsider, source.id), 403);
      await db.query(`INSERT INTO skribbil.spectator_sessions(match_id,user_id) VALUES($1,$2)`, [source.id, outsider.id]);
      await rejects(service.join(outsider, source.id), 403);
      await db.query(`INSERT INTO skribbil.match_players(match_id,user_id,engine_player_id,display_name_snapshot) VALUES($1,$2::uuid,$2::text,$3)`, [source.id, outsider.id, outsider.display_name]);
      await rejects(service.join(outsider, source.id), 403);
      await db.query(`UPDATE skribbil.match_players SET disqualified=true WHERE match_id=$1 AND user_id=$2`, [source.id, source.players[0].id]);
      await rejects(service.join(source.players[0], source.id), 403);
      await db.query(`UPDATE skribbil.matches SET status='running',ended_at=NULL WHERE id=$1`, [source.id]);
      await rejects(service.join(source.players[1], source.id), 409, /completed match result/);
      await rejects(service.join(null, source.id), 401);
      await rejects(service.join(source.players[1], 'not-a-uuid'), 400);
      assert.equal(calls, 0); assert.equal(await target(source), undefined);
    });

    await t.test('a lost create response retries the same reservation after process restart', async () => {
      const source = await completed(), requests = [];
      const outage = new Rematch({ db, admit: launch, provision: async payload => { requests.push(payload); throw new ApiError(503, 'Temporary outage'); } });
      await rejects(outage.join(source.players[0], source.id), 503);
      const pending = await target(source);
      assert.equal(pending.status, 'lobby'); assert.equal(pending.engine_room_id, `pending-${pending.id}`);
      const restarted = new Rematch({ db, admit: launch, provision: async payload => { requests.push(payload); return { lobbyId: `stable-${payload.matchId}` }; } });
      const a = await restarted.join(source.players[1], source.id);
      const b = await restarted.join(source.players[0], source.id);
      assert.equal(a.matchId, pending.id); assert.equal(b.matchId, pending.id);
      assert.equal(requests.length, 2); assert.equal(requests[0].matchId, requests[1].matchId);
    });

    await t.test('separate API workers allocate one DB target and one logical engine room', async () => {
      const source = await completed(), engineRooms = new Map();
      const provision = async payload => {
        if (!engineRooms.has(payload.matchId)) engineRooms.set(payload.matchId, `engine-${payload.matchId}`);
        await new Promise(resolve => setTimeout(resolve, 10));
        return { lobbyId: engineRooms.get(payload.matchId) };
      };
      const a = new Rematch({ db, provision, admit: launch }), b = new Rematch({ db, provision, admit: launch });
      const results = await Promise.all([a.join(source.players[0], source.id), b.join(source.players[1], source.id)]);
      assert.equal(results[0].matchId, results[1].matchId); assert.equal(engineRooms.size, 1);
      assert.equal(Number((await one(db, 'SELECT count(*) AS n FROM skribbil.match_rematches WHERE source_match_id=$1', [source.id])).n), 1);
    });

    await t.test('an account already in another active room cannot allocate a second rematch', async () => {
      const source = await completed(), another = await completed();
      await db.query(`INSERT INTO skribbil.match_players(match_id,user_id,engine_player_id,display_name_snapshot) VALUES($1,$2::uuid,$2::text,$3)`, [another.id, source.players[0].id, source.players[0].display_name]);
      await db.query(`INSERT INTO skribbil.match_result_players(result_id,match_id,user_id,score,placement) VALUES($1,$2,$3,0,3)`, [another.resultId, another.id, source.players[0].id]);
      const service = new Rematch({ db, admit: launch, provision: async payload => ({ lobbyId: `room-${payload.matchId}` }) });
      await service.join(source.players[0], another.id);
      await rejects(service.join(source.players[0], source.id), 409, /current room/);
      assert.equal(await target(source), undefined);
    });

    await t.test('cancel during provisioning cannot resurrect a room; finished successors stay unique', async () => {
      const source = await completed();
      let admissions = 0;
      const service = new Rematch({ db, admit: async (...args) => { admissions++; return launch(...args); }, provision: async payload => {
        await db.query(`UPDATE skribbil.matches SET status='cancelled' WHERE id=$1`, [payload.matchId]);
        return { lobbyId: `late-${payload.matchId}` };
      } });
      await rejects(service.join(source.players[0], source.id), 409, /finished or was cancelled/);
      const cancelled = await target(source);
      await rejects(service.join(source.players[1], source.id), 409);
      assert.equal((await target(source)).id, cancelled.id); assert.equal(admissions, 0);
      const source2 = await completed();
      const normal = new Rematch({ db, admit: launch, provision: async payload => ({ lobbyId: `ok-${payload.matchId}` }) });
      const done = await normal.join(source2.players[0], source2.id);
      await db.query(`UPDATE skribbil.matches SET status='completed' WHERE id=$1`, [done.matchId]);
      await rejects(normal.join(source2.players[1], source2.id), 409, /latest completed game/);
      assert.equal((await target(source2)).id, done.matchId);
    });

    await t.test('ranked gates remain authoritative and do not revive an old season', async () => {
      const source = await completed({ mode: 'ranked', privateRoom: false, season: '00000000-0000-4000-8000-000000000050' });
      const requests = [], provision = async payload => { requests.push(payload); return { lobbyId: `ranked-${payload.matchId}` }; };
      const blocked = new Rematch({ db, provision, admit: launch });
      await rejects(blocked.join(source.players[0], source.id), 503);
      assert.equal(await target(source), undefined); assert.equal(requests.length, 0);
      let enabled = true;
      const allowed = new Rematch({ db, provision, admit: launch, rankedEnabled: () => enabled });
      const result = await allowed.join(source.players[0], source.id);
      const match = await target(source);
      assert.equal(match.mode, 'ranked'); assert.equal(match.competitive, true); assert.deepEqual(match.custom_rules, {});
      assert.equal(match.rule_set_id, rankedRules); assert.equal(match.season_id, null);
      assert.deepEqual(requests[0], { matchId: result.matchId, mode: 'ranked', rounds: 3, drawTime: 80, maxPlayers: 8 });
      enabled = false;
      await rejects(allowed.join(source.players[1], source.id), 503);
    });

    await t.test('current season stays in the original league; tournament and unknown competitive rules are refused', async () => {
      const source = await completed({ mode: 'ranked', privateRoom: false, season: '00000000-0000-4000-8000-000000000050' });
      const seasonId = randomUUID();
      await db.query(`INSERT INTO skribbil.seasons(id,league_id,community_id,name,starts_at,ends_at,status)
        VALUES($1,'00000000-0000-4000-8000-000000000040',$2,'Current test season',now()-interval '1 day',now()+interval '1 day','active')`, [seasonId, communityId]);
      await db.query(`INSERT INTO skribbil.season_games(season_id,game_id,rule_set_id,scoring_version,scoring_config) VALUES($1,$2,$3,1,'{}')`, [seasonId, gameId, rankedRules]);
      // A newer active season in a different league shares this community,
      // game and ruleset. It must not steal this league's rematch points.
      const otherLeague = randomUUID(), otherSeason = randomUUID();
      await db.query(`INSERT INTO skribbil.leagues(id,community_id,name,slug) VALUES($1,$2,'Another league','another-test-league')`, [otherLeague, communityId]);
      await db.query(`INSERT INTO skribbil.seasons(id,league_id,community_id,name,starts_at,ends_at,status)
        VALUES($1,$2,$3,'Newer unrelated season',now()-interval '1 hour',now()+interval '1 day','active')`, [otherSeason, otherLeague, communityId]);
      await db.query(`INSERT INTO skribbil.season_games(season_id,game_id,rule_set_id,scoring_version,scoring_config) VALUES($1,$2,$3,1,'{}')`, [otherSeason, gameId, rankedRules]);
      const service = new Rematch({ db, admit: launch, rankedEnabled: () => true, provision: async payload => ({ lobbyId: `room-${payload.matchId}` }) });
      await service.join(source.players[0], source.id);
      assert.equal((await target(source)).season_id, seasonId);
      const tournament = await completed({ mode: 'tournament' });
      await rejects(service.join(tournament.players[0], tournament.id), 409, /organizer/);
      const newRule = randomUUID();
      await db.query(`INSERT INTO skribbil.rule_sets(id,game_id,version,name,competitive,rules) VALUES($1,$2,2,'Future ranked',true,'{"rounds":3,"drawingTime":80,"maxPlayers":8}')`, [newRule, gameId]);
      const unknown = await completed({ mode: 'ranked', ruleSetId: newRule });
      await rejects(service.join(unknown.players[0], unknown.id), 409, /ruleset/);
      assert.equal(await target(tournament), undefined); assert.equal(await target(unknown), undefined);
    });
    await t.test('clubhouse rematches retain scope, reject removed members and release stale room reservations', async () => {
      const source=await completed(),admin=await user(),owner=source.players[0],member=source.players[1];
      await db.query("INSERT INTO skribbil.platform_roles(user_id,role,granted_by) VALUES($1,'administrator',$1)",[admin.id]);
      const clubs=new Clubhouses(new Platform(db));
      const club=(await clubs.create(admin,{name:'Synthetic rematch clubhouse',description:'Private integration fixture.',ownerId:owner.id})).clubhouse;
      const invitation=await clubs.invite(owner,club.id,{username:member.username});await clubs.acceptInvite(member,invitation.id);
      await db.query('UPDATE skribbil.matches SET clubhouse_id=$2 WHERE id=$1',[source.id,club.id]);
      const service=new Rematch({db,admit:launch,provision:async payload=>({lobbyId:`club-rematch-${payload.matchId}`})});
      const first=await service.join(owner,source.id),second=await service.join(member,source.id);
      assert.equal(first.matchId,second.matchId);
      const successor=await target(source);assert.equal(successor.clubhouse_id,club.id);assert.equal(successor.private,true);
      await clubs.removeMember(owner,club.id,member.id);
      await rejects(service.join(member,source.id),403,/current Clubhouse members/);
      assert.ok(await one(db,'SELECT 1 FROM skribbil.match_players WHERE match_id=$1 AND user_id=$2',[successor.id,member.id]));
      assert.equal((await target(source)).id,successor.id);

      // Historic participation remains, but removal must not trap this account
      // behind an active room it is no longer permitted to enter.
      const unrelated=await completed({privateRoom:false});
      await db.query('INSERT INTO skribbil.match_players(match_id,user_id,engine_player_id,display_name_snapshot) VALUES($1,$2::uuid,$2::text,$3)',[unrelated.id,member.id,member.display_name]);
      await db.query('INSERT INTO skribbil.match_result_players(result_id,match_id,user_id,score,placement) VALUES($1,$2,$3,0,3)',[unrelated.resultId,unrelated.id,member.id]);
      const next=await service.join(member,unrelated.id);
      assert.notEqual(next.matchId,successor.id);assert.equal((await target(unrelated)).clubhouse_id,null);

      await clubs.leave(owner,club.id);
      await rejects(service.join(owner,source.id),403,/current Clubhouse members/);
    });
  } finally { await db.close(); }
});
