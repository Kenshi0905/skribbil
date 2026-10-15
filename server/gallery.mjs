import { requireValue, isUuid } from './security.mjs';

const one = async (db, sql, args = []) => (await db.query(sql, args)).rows[0];
function setting(env, key, fallback, min, max) {
  const value = Number(env[key] ?? fallback);
  if (!Number.isInteger(value) || value < min || value > max) throw new Error(`Invalid ${key}`);
  return value;
}
export function galleryPolicy(env = process.env) {
  return {
    seconds: setting(env, 'GALLERY_VOTE_SECONDS', 60, 10, 300),
    minimum: setting(env, 'GALLERY_MIN_VOTERS', 3, 2, 24),
    percent: setting(env, 'GALLERY_MAJORITY_PERCENT', 67, 51, 100),
  };
}
export function galleryDecision(fame, shame, minimum, percent) {
  const total = fame + shame;
  if (total < minimum || fame === shame) return 'no-decision';
  if (fame * 100 >= total * percent) return 'fame';
  if (shame * 100 >= total * percent) return 'shame';
  return 'no-decision';
}

export class GalleryVotes {
  constructor(platform) { galleryPolicy(); this.db = platform.db; }
  async room(user, code) {
    const match = await one(this.db, `SELECT m.id FROM skribbil.matches m
      JOIN skribbil.match_players p ON p.match_id=m.id AND p.user_id=$2
      WHERE m.engine_room_id=$1 AND (m.clubhouse_id IS NULL OR EXISTS(
        SELECT 1 FROM skribbil.clubhouse_members cm JOIN skribbil.clubhouses c ON c.id=cm.clubhouse_id
        WHERE cm.clubhouse_id=m.clubhouse_id AND cm.user_id=$2 AND cm.left_at IS NULL AND c.archived_at IS NULL))`, [code, user.id]);
    requireValue(match, 'Only room participants can view gallery voting.', 403);
    const turns = (await this.db.query(`SELECT t.id AS "turnId",d.id AS "drawingId",t.word AS prompt,
      u.display_name AS artist,w.closes_at AS "closesAt",w.closes_at>clock_timestamp() AS open,
      w.minimum_voters AS minimum,w.majority_percent AS percent,
      EXISTS(SELECT 1 FROM skribbil.turn_eligible_voters e WHERE e.turn_id=t.id AND e.voter_id=$2) AS eligible,
      (SELECT choice FROM skribbil.gallery_votes v WHERE v.turn_id=t.id AND v.voter_id=$2) AS choice,
      (SELECT count(*)::int FROM skribbil.gallery_votes v WHERE v.turn_id=t.id AND choice='fame') AS fame,
      (SELECT count(*)::int FROM skribbil.gallery_votes v WHERE v.turn_id=t.id AND choice='shame') AS shame
      FROM skribbil.gallery_vote_windows w JOIN skribbil.drawing_turns t ON t.id=w.turn_id
      JOIN skribbil.drawings d ON d.turn_id=t.id JOIN skribbil.users u ON u.id=t.artist_id
      WHERE t.match_id=$1 ORDER BY t.turn_number DESC LIMIT 3`, [match.id, user.id])).rows;
    return { turns: turns.map(t => ({ ...t, decision: galleryDecision(t.fame, t.shame, t.minimum, t.percent) })) };
  }
  async vote(user, turnId, choice) {
    requireValue(isUuid(turnId) && ['fame', 'shame'].includes(choice), 'Choose Fame or Shame.');
    return this.db.transaction(async db => {
      // Lock first, then check real wall time. Waiting on another vote cannot
      // admit a request past the deadline (transaction now() would be stale).
      const window = await one(db, `SELECT w.* FROM skribbil.gallery_vote_windows w WHERE turn_id=$1 FOR UPDATE`, [turnId]);
      requireValue(window, 'Voting is unavailable.', 404);
      const eligible = await one(db, `SELECT 1 FROM skribbil.turn_eligible_voters e
        JOIN skribbil.matches m ON m.id=e.match_id WHERE e.turn_id=$1 AND e.voter_id=$2
        AND (m.clubhouse_id IS NULL OR EXISTS(SELECT 1 FROM skribbil.clubhouse_members cm
          JOIN skribbil.clubhouses c ON c.id=cm.clubhouse_id WHERE cm.clubhouse_id=m.clubhouse_id
          AND cm.user_id=$2 AND cm.left_at IS NULL AND c.archived_at IS NULL))`, [turnId, user.id]);
      requireValue(eligible, 'Artists and spectators cannot vote on this drawing.', 403);
      const previous = await one(db, `SELECT choice FROM skribbil.gallery_votes WHERE turn_id=$1 AND voter_id=$2`, [turnId, user.id]);
      if (previous) {
        requireValue(previous.choice === choice, 'Your vote is already recorded.', 409);
        return { ok: true, duplicate: true }; // Safe lost-response retry, even after close.
      }
      requireValue((await one(db, 'SELECT $1::timestamptz>clock_timestamp() AS open', [window.closes_at])).open, 'Voting has closed.', 409);
      await db.query(`INSERT INTO skribbil.gallery_votes(turn_id,voter_id,choice) VALUES($1,$2,$3)`, [turnId, user.id, choice]);
      return { ok: true };
    });
  }
}
