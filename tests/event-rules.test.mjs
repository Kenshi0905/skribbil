import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { openDatabase } from '../server/db.mjs';
import { Platform } from '../server/platform.mjs';
import { acceptEngineEvent } from '../server/events.mjs';

const one = async (db, sql, args = []) => (await db.query(sql, args)).rows[0];

test('authoritative final room settings are bounded, private-only snapshots', { timeout: 120000 }, async t => {
  const db = await openDatabase({ url: '', dataDir: ':memory:' });
  const platform = new Platform(db);
  const fixture = async (mode = 'casual') => {
    const context = await platform.context(), id = randomUUID();
    const players = [];
    for (let i = 0; i < 2; i++) {
      const userId = randomUUID();
      players.push(await one(db, 'INSERT INTO skribbil.users(id,username,display_name) VALUES($1,$2,$2) RETURNING *', [userId, `rules_${userId.slice(0, 8)}`]));
    }
    await db.query(`INSERT INTO skribbil.matches(id,game_id,rule_set_id,community_id,mode,engine_room_id,engine_instance_id,custom_rules,private,created_by)
      VALUES($1,$2,$3,$4,$5,$6,'test',$7,true,$8)`,
    [id, context.game_id, mode === 'casual' ? context.private_rules : context.ranked_rules, context.community_id, mode, `rules-${id}`, JSON.stringify(mode === 'casual' ? { rounds: 3, drawTime: 80, maxPlayers: 8 } : {}), players[0].id]);
    for (const p of players) await db.query(`INSERT INTO skribbil.match_players(match_id,user_id,engine_player_id,display_name_snapshot) VALUES($1,$2::uuid,$2::text,$3)`, [id, p.id, p.display_name]);
    return {
      id, players,
      event: { eventId: randomUUID(), matchId: id, lobbyId: `rules-${id}`, sequence: 1, type: 'match.completed', occurredAt: new Date().toISOString(),
        payload: { participants: players.map((p, i) => ({ userId: p.id, playerId: randomUUID(), username: p.display_name, score: 100 - i * 50, correctGuesses: 1, fastestGuessMs: 6000 })) } },
    };
  };
  const publish = event => acceptEngineEvent(platform, {}, event, JSON.stringify(event));
  try {
    await t.test('valid native edits persist for rematches without changing privacy or mode', async () => {
      const { event, id } = await fixture();
      event.payload.settings = { rounds: 7, drawTime: 140, maxPlayers: 12, private: false, mode: 'ranked', seasonId: randomUUID() };
      assert.deepEqual(await publish(event), { accepted: true });
      const match = await one(db, 'SELECT * FROM skribbil.matches WHERE id=$1', [id]);
      assert.deepEqual(match.custom_rules, { rounds: 7, drawTime: 140, maxPlayers: 12 });
      assert.equal(match.mode, 'casual'); assert.equal(match.private, true); assert.equal(match.season_id, null);
      assert.equal(match.status, 'completed'); assert.ok(match.accepted_result_id);
      assert.deepEqual(await publish(event), { duplicate: true });
    });

    await t.test('missing snapshots retain existing settings for older engine events', async () => {
      const { event, id } = await fixture();
      await publish(event);
      assert.deepEqual((await one(db, 'SELECT custom_rules FROM skribbil.matches WHERE id=$1', [id])).custom_rules, { rounds: 3, drawTime: 80, maxPlayers: 8 });
    });

    await t.test('invalid snapshots roll back both results and event receipts', async () => {
      const badSettings = [null, [], {}, { rounds: 0, drawTime: 80, maxPlayers: 8 }, { rounds: 21, drawTime: 80, maxPlayers: 8 },
        { rounds: 3, drawTime: 59, maxPlayers: 8 }, { rounds: 3, drawTime: 301, maxPlayers: 8 },
        { rounds: 3, drawTime: 80, maxPlayers: 1 }, { rounds: 3, drawTime: 80, maxPlayers: 25 },
        { rounds: '3', drawTime: 80, maxPlayers: 8 }];
      for (const settings of badSettings) {
        const { event, id } = await fixture(); event.payload.settings = settings;
        await assert.rejects(publish(event), error => error.status === 400 && /room settings/.test(error.message));
        const match = await one(db, 'SELECT status,accepted_result_id FROM skribbil.matches WHERE id=$1', [id]);
        assert.equal(match.status, 'lobby'); assert.equal(match.accepted_result_id, null);
        assert.equal(await one(db, 'SELECT event_id FROM skribbil.engine_receipts WHERE event_id=$1', [event.eventId]), undefined);
        assert.equal(await one(db, 'SELECT id FROM skribbil.xp_events WHERE match_id=$1', [id]), undefined);
      }
    });

    await t.test('ranked snapshots must match immutable rules and never create custom rules', async () => {
      const { event, id } = await fixture('ranked');
      event.payload.settings = { rounds: 4, drawTime: 80, maxPlayers: 8 };
      await assert.rejects(publish(event), error => error.status === 409 && /locked rules/.test(error.message));
      event.payload.settings.rounds = 3;
      await publish(event);
      const match = await one(db, 'SELECT custom_rules,mode,status FROM skribbil.matches WHERE id=$1', [id]);
      assert.deepEqual(match.custom_rules, {}); assert.equal(match.mode, 'ranked'); assert.equal(match.status, 'completed');
    });
  } finally { await db.close(); }
});
