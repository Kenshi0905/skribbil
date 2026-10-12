import { randomUUID } from 'node:crypto';
import { requireValue, isUuid } from './security.mjs';

const one = async (db, sql, args = []) => (await db.query(sql, args)).rows[0];
const active = match => match && ['lobby', 'running'].includes(match.status);

// The engine's authenticated create endpoint is idempotent by matchId. The DB
// reservation is durable before any network call, so even separate API workers
// or a lost HTTP response provision the same target. No network runs in a DB
// transaction and the normal admission callback remains the ticket authority.
export class Rematch {
  constructor({ db, provision, admit, rankedEnabled = () => false }) {
    this.db = db;
    this.provision = provision;
    this.admit = admit;
    this.rankedEnabled = rankedEnabled;
    this.pending = new Map();
  }

  settings(source) {
    requireValue(source.game_slug === 'skribbil', 'Rematches are not enabled for this game yet.', 409);
    requireValue(source.mode !== 'tournament', 'Tournament rematches must be scheduled by the organizer.', 409);
    const ranked = source.mode === 'ranked';
    if (ranked) {
      requireValue(this.rankedEnabled(), 'Ranked play opens after deployment reliability checks. Private play is available.', 503);
      // Never silently downgrade a ranked result or pretend a future ruleset is
      // supported by this adapter. Its enforced standard currently has version 1.
      requireValue(source.rule_version === 1 && source.rules.rounds === 3 && source.rules.drawingTime === 80 && source.rules.maxPlayers === 8,
        'This ranked ruleset cannot be rematched by the current game server.', 409);
      return { mode: 'ranked', rounds: 3, drawTime: 80, maxPlayers: 8 };
    }
    const rules = source.custom_rules;
    const rounds = Number(rules.rounds ?? source.rules.rounds);
    const drawTime = Number(rules.drawTime ?? rules.drawingTime ?? source.rules.drawingTime);
    const maxPlayers = Number(rules.maxPlayers ?? source.rules.maxPlayers);
    requireValue(Number.isInteger(rounds) && rounds >= 1 && rounds <= 20 && Number.isInteger(drawTime) && drawTime >= 60 && drawTime <= 300 && Number.isInteger(maxPlayers) && maxPlayers >= 2 && maxPlayers <= 24,
      'The previous room settings are no longer supported.', 409);
    return { mode: 'private', rounds, drawTime, maxPlayers };
  }

  async join(user, sourceId) {
    requireValue(isUuid(sourceId), 'Invalid match.');
    requireValue(user?.id, 'Sign in to rematch.', 401);
    const reservation = await this.db.transaction(async db => {
      // All room admission paths lock the account before a match. This both
      // prevents two active rooms for one account and fixes lock ordering.
      const account = await one(db, 'SELECT id,status,display_name FROM skribbil.users WHERE id=$1 FOR NO KEY UPDATE', [user.id]);
      requireValue(account?.status === 'active', 'This account cannot join a room.', 403);
      const source = await one(db, `SELECT m.*,g.slug AS game_slug,r.version AS rule_version,r.rules
        FROM skribbil.matches m JOIN skribbil.games g ON g.id=m.game_id
        JOIN skribbil.rule_sets r ON r.id=m.rule_set_id WHERE m.id=$1 FOR UPDATE OF m`, [sourceId]);
      requireValue(source, 'Match not found.', 404);
      requireValue(source.status === 'completed' && source.accepted_result_id, 'Wait for the completed match result before rematching.', 409);
      const participant = await one(db, `SELECT 1 FROM skribbil.match_result_players r
        JOIN skribbil.match_players p ON p.match_id=r.match_id AND p.user_id=r.user_id
        WHERE r.result_id=$1 AND r.user_id=$2 AND NOT p.disqualified`, [source.accepted_result_id, user.id]);
      requireValue(participant, 'Only players in this completed match can rematch it.', 403);
      const settings = this.settings(source);
      let match = await one(db, `SELECT m.* FROM skribbil.match_rematches r
        JOIN skribbil.matches m ON m.id=r.target_match_id WHERE r.source_match_id=$1 FOR UPDATE OF m`, [sourceId]);
      if (match) requireValue(active(match), 'This rematch has finished or was cancelled. Rematch your latest completed game instead.', 409);
      // Existing target rooms must be locked before their clubhouse, matching
      // ordinary admission; otherwise a reconnect can deadlock a rematch.
      if(source.clubhouse_id){
        await db.query('SELECT id FROM skribbil.clubhouses WHERE id=$1 FOR UPDATE',[source.clubhouse_id]);
        const member=await one(db,`SELECT c.id FROM skribbil.clubhouses c JOIN skribbil.clubhouse_members cm ON cm.clubhouse_id=c.id
          WHERE c.id=$1 AND cm.user_id=$2 AND cm.left_at IS NULL AND c.archived_at IS NULL`,[source.clubhouse_id,user.id]);
        requireValue(member,'This rematch is available only to current Clubhouse members.',403);
      }
      const other = await one(db, `SELECT m.id FROM skribbil.match_players p JOIN skribbil.matches m ON m.id=p.match_id
        WHERE p.user_id=$1 AND m.status IN ('lobby','running') AND ($2::uuid IS NULL OR m.id<>$2::uuid)
        AND (m.clubhouse_id IS NULL OR EXISTS(SELECT 1 FROM skribbil.clubhouse_members cm WHERE cm.clubhouse_id=m.clubhouse_id AND cm.user_id=$1 AND cm.left_at IS NULL)) LIMIT 1`, [user.id, match?.id ?? null]);
      requireValue(!other, 'Finish or cancel your current room before rematching.', 409);
      if (!match) {
        // A new match must not count toward an already closed season. A current
        // season is used only if it explicitly accepts this immutable ruleset.
        const season = source.mode === 'ranked' ? await one(db, `SELECT s.id FROM skribbil.seasons s
          JOIN skribbil.season_games g ON g.season_id=s.id WHERE s.community_id=$1 AND g.game_id=$2
          AND g.rule_set_id=$3 AND s.status='active' AND s.starts_at<=now() AND s.ends_at>now()
          AND ($4::uuid IS NULL OR s.league_id=(SELECT league_id FROM skribbil.seasons WHERE id=$4::uuid))
          ORDER BY s.starts_at DESC,s.id LIMIT 1`, [source.community_id, source.game_id, source.rule_set_id, source.season_id]) : null;
        const id = randomUUID();
        const customRules = source.mode === 'ranked' ? {} : { ...source.custom_rules, rounds: settings.rounds, drawTime: settings.drawTime, maxPlayers: settings.maxPlayers };
        match = await one(db, `INSERT INTO skribbil.matches(id,game_id,rule_set_id,community_id,season_id,mode,
          engine_room_id,engine_instance_id,custom_rules,private,access_code_hash,created_by,clubhouse_id)
          VALUES($1,$2,$3,$4,$5,$6,$7,'primary',$8,$9,$10,$11,$12) RETURNING *`,
        [id, source.game_id, source.rule_set_id, source.community_id, season?.id ?? null, source.mode,
          `pending-${id}`, JSON.stringify(customRules), source.private, source.access_code_hash, user.id,source.clubhouse_id]);
        await db.query(`INSERT INTO skribbil.match_rematches(source_match_id,target_match_id,requested_by) VALUES($1,$2,$3)`, [sourceId, id, user.id]);
      }
      await db.query(`INSERT INTO skribbil.match_players(match_id,user_id,engine_player_id,display_name_snapshot)
        VALUES($1,$2::uuid,$2::text,$3) ON CONFLICT(match_id,user_id) DO NOTHING`, [match.id, user.id, account.display_name]);
      return { match, settings };
    });

    let match = reservation.match;
    if (match.engine_room_id.startsWith('pending-')) {
      // Coalesce calls within this process; the engine provides the same
      // idempotency across processes. Retain reservations after an outage.
      let pending = this.pending.get(match.id);
      if (!pending) {
        pending = this.provisionMatch(match, reservation.settings);
        this.pending.set(match.id, pending);
      }
      try { match = await pending; }
      finally { if (this.pending.get(reservation.match.id) === pending) this.pending.delete(reservation.match.id); }
    }
    // A concurrent cancel or result may have changed the room while the engine
    // request was in flight. Admission also rechecks this under the user lock.
    match = await one(this.db, 'SELECT * FROM skribbil.matches WHERE id=$1', [match.id]);
    requireValue(active(match), 'This rematch has finished or was cancelled.', 409);
    return this.admit(user, match);
  }

  async provisionMatch(match, settings) {
    const room = await this.provision({ matchId: match.id, ...settings });
    requireValue(typeof room?.lobbyId === 'string' && room.lobbyId.length > 0 && room.lobbyId.length <= 200,
      'The game server returned an invalid room.', 503);
    const updated = await one(this.db, `UPDATE skribbil.matches SET engine_room_id=$2
      WHERE id=$1 AND engine_room_id=$3 AND status='lobby' RETURNING *`, [match.id, room.lobbyId, match.engine_room_id]);
    if (updated) return updated;
    const existing = await one(this.db, 'SELECT * FROM skribbil.matches WHERE id=$1', [match.id]);
    requireValue(active(existing) && existing.engine_room_id === room.lobbyId, 'This rematch has finished or was cancelled.', 409);
    return existing;
  }
}
