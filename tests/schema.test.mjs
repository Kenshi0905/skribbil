import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';

let db;
const community = '00000000-0000-4000-8000-000000000010';
const game = '00000000-0000-4000-8000-000000000020';
const casualRules = '00000000-0000-4000-8000-000000000030';
const rankedRules = '00000000-0000-4000-8000-000000000031';

before(async () => {
  db = new PGlite();
  await db.exec(await readFile(new URL('../database/schema.sql', import.meta.url), 'utf8'));
  await db.exec(await readFile(new URL('../database/seed.sql', import.meta.url), 'utf8'));
  await db.exec('SET search_path=skribbil,public');
});
after(async () => { if (db) await db.close(); });

async function transaction(action) {
  await db.exec('BEGIN');
  try { await action(); } finally { await db.exec('ROLLBACK'); }
}
async function rejected(sql, values = [], message = /violates|append-only|duplicate/i) {
  await db.exec('SAVEPOINT rejected_statement');
  await assert.rejects(db.query(sql, values), message);
  await db.exec('ROLLBACK TO SAVEPOINT rejected_statement');
}
async function account(name) {
  const id = randomUUID();
  await db.query('INSERT INTO users(id,username,display_name) VALUES ($1,$2,$2)', [id, name]);
  return id;
}
async function match(mode = 'casual', rules = casualRules) {
  const id = randomUUID();
  await db.query(`INSERT INTO matches(id,game_id,rule_set_id,mode,engine_room_id,engine_instance_id)
    VALUES($1,$2,$3,$4,$5,'test-engine')`, [id, game, rules, mode, id]);
  return id;
}
async function player(matchId, userId) {
  await db.query('INSERT INTO match_players(match_id,user_id,engine_player_id,display_name_snapshot) VALUES($1,$2,$3,$4)', [matchId,userId,userId,userId]);
}

test('baseline and configuration seed can initialize actual PostgreSQL and seed twice', async () => {
  await db.exec(await readFile(new URL('../database/seed.sql', import.meta.url), 'utf8'));
  assert.equal((await db.query('SELECT count(*)::int AS count FROM matches')).rows[0].count, 0);
  assert.equal((await db.query('SELECT count(*)::int AS count FROM games')).rows[0].count, 1);
  assert.equal((await db.query('SELECT count(*)::int AS count FROM credentials')).rows[0].count, 0);
  assert.equal((await db.query("SELECT count(*)::int AS count FROM users WHERE username<>'skribbil_system'")).rows[0].count, 0);
  for (const table of ['seasons','season_games','tournaments','auth_sessions','match_results','score_events','xp_events','drawings','challenge_progress']) {
    assert.equal((await db.query(`SELECT count(*)::int AS count FROM ${table}`)).rows[0].count, 0, `${table} must not contain fabricated activity or schedules`);
  }
  assert.equal((await db.query('SELECT count(*)::int AS count FROM leagues')).rows[0].count, 1);
  assert.equal((await db.query('SELECT count(*)::int AS count FROM challenge_definitions')).rows[0].count, 2);
});

test('usernames ignore case and equipment requires ownership', () => transaction(async () => {
  const id = await account('InkTester');
  await rejected("INSERT INTO users(username,display_name) VALUES ('inktester','Other')");
  await rejected(`INSERT INTO equipped_cosmetics(user_id,cosmetic_id,slot)
    VALUES($1,'00000000-0000-4000-8000-000000000060','title')`, [id]);
}));

test('ranked matches reject private rules and custom override payloads', () => transaction(async () => {
  await rejected(`INSERT INTO matches(game_id,rule_set_id,mode,engine_room_id,engine_instance_id)
    VALUES($1,$2,'ranked','ranked-test','test-engine')`, [game,casualRules]);
  const id = await match('ranked',rankedRules);
  await rejected(`UPDATE matches SET custom_rules='{"drawingTime":999}' WHERE id=$1`,[id]);
  await rejected('UPDATE rule_sets SET rules=\'{}\' WHERE id=$1',[rankedRules]);
}));

test('votes exclude the artist, are participant-bound and cannot be repeated', () => transaction(async () => {
  const room = await match();
  const artist = await account('ArtistTest');
  const voter = await account('VoterTest');
  const outsider = await account('OutsiderTest');
  await player(room, artist); await player(room, voter);
  const turn = randomUUID();
  await db.query(`INSERT INTO drawing_turns(id,match_id,artist_id,turn_number,round_number,status,electorate_size)
    VALUES($1,$2,$3,1,1,'drawing',1)`,[turn,room,artist]);
  await rejected('INSERT INTO turn_eligible_voters VALUES($1,$2,$3,$3)',[turn,room,artist]);
  await rejected('INSERT INTO turn_eligible_voters VALUES($1,$2,$3,$4)',[turn,room,artist,outsider]);
  await db.query('INSERT INTO turn_eligible_voters VALUES($1,$2,$3,$4)',[turn,room,artist,voter]);
  await db.query('INSERT INTO drawing_dislikes(turn_id,voter_id) VALUES($1,$2)',[turn,voter]);
  await rejected('INSERT INTO drawing_dislikes(turn_id,voter_id) VALUES($1,$2)',[turn,voter]);
}));

test('penalty deducts exactly 100 once and the archived ledger is immutable', () => transaction(async () => {
  const room = await match(); const artist = await account('PenaltyArtist'); await player(room,artist);
  const turn = randomUUID(); const event = randomUUID();
  await db.query(`INSERT INTO drawing_turns(id,match_id,artist_id,turn_number,round_number,status,electorate_size)
    VALUES($1,$2,$3,1,1,'drawing',1)`,[turn,room,artist]);
  await rejected(`INSERT INTO score_events(match_id,user_id,kind,delta,idempotency_key)
    VALUES($1,$2,'dislike_penalty',-99,'invalid-penalty')`,[room,artist]);
  await db.query(`INSERT INTO score_events(id,match_id,user_id,kind,delta,idempotency_key)
    VALUES($1,$2,$3,'dislike_penalty',-100,'penalty-once')`,[event,room,artist]);
  await db.query('INSERT INTO drawing_penalties(turn_id,match_id,artist_id,score_event_id) VALUES($1,$2,$3,$4)',[turn,room,artist,event]);
  await rejected('INSERT INTO drawing_penalties(turn_id,match_id,artist_id,score_event_id) VALUES($1,$2,$3,$4)',[turn,room,artist,event]);
  await rejected('UPDATE score_events SET delta=100 WHERE id=$1',[event]);
  assert.equal(Number((await db.query('SELECT score FROM current_match_scores WHERE match_id=$1',[room])).rows[0].score),-100);
}));

test('a result cannot be accepted by a different match', () => transaction(async () => {
  const a = await match(); const b = await match(); const result = randomUUID();
  await db.query(`INSERT INTO match_results(id,match_id,version,source,engine_revision,payload_sha256,idempotency_key)
    VALUES($1,$2,1,'engine','test',$3,'cross-match')`,[result,a,'0'.repeat(64)]);
  await db.exec('SET CONSTRAINTS ALL IMMEDIATE');
  await rejected('UPDATE matches SET accepted_result_id=$1 WHERE id=$2',[result,b]);
}));

test('private or revoked artwork cannot enter the public gallery projection', () => transaction(async () => {
  const room = await match(); const artist = await account('PrivateArtist'); await player(room,artist);
  const turn = randomUUID(); const asset = randomUUID(); const drawing = randomUUID();
  await db.query(`INSERT INTO drawing_turns(id,match_id,artist_id,turn_number,round_number,status,electorate_size)
    VALUES($1,$2,$3,1,1,'ended',1)`,[turn,room,artist]);
  await db.query(`INSERT INTO object_assets(id,owner_id,policy_id,storage_backend,bucket,object_key,media_type,bytes,sha256,state)
    VALUES($1,$2,'drawing-original','s3','private','test.png','image/png',100,$3,'ready')`,[asset,artist,'a'.repeat(64)]);
  await db.query(`INSERT INTO drawings(id,turn_id,match_id,artist_id,image_asset_id,prompt_snapshot)
    VALUES($1,$2,$3,$4,$5,'cat')`,[drawing,turn,room,artist,asset]);
  await db.query(`INSERT INTO gallery_entries(drawing_id,hall,title,curated_by,published_at)
    VALUES($1,'fame','Test',$2,now())`,[drawing,artist]);
  assert.equal((await db.query('SELECT count(*)::int AS count FROM public_gallery')).rows[0].count,0);
  await rejected("UPDATE drawings SET visibility='public' WHERE id=$1",[drawing]);
  await db.query("UPDATE drawings SET visibility='public',publication_consent_at=now() WHERE id=$1",[drawing]);
  assert.equal((await db.query('SELECT count(*)::int AS count FROM public_gallery')).rows[0].count,1);
  await db.query("UPDATE drawings SET visibility='private',consent_revoked_at=now() WHERE id=$1",[drawing]);
  assert.equal((await db.query('SELECT count(*)::int AS count FROM public_gallery')).rows[0].count,0);
}));
