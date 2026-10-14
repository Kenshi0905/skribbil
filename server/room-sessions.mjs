import { isUuid, requireValue } from './security.mjs';

const one = async (db, sql, args = []) => (await db.query(sql, args)).rows[0];

export class RoomSessions {
  constructor({db, rematch, admit, engineRequest}) {
    Object.assign(this, {db, rematch, admit, engineRequest});
    this.pending = new Set();
  }

  async control(user, sourceId, action) {
    requireValue(user?.id, 'Sign in to manage the room.', 401);
    requireValue(isUuid(sourceId), 'Invalid room.');
    requireValue(['rematch', 'close'].includes(action), 'Choose play again or delete room.');
    requireValue(!this.pending.has(sourceId), 'The room leader’s request is already in progress.', 409);
    this.pending.add(sourceId);
    try {
      const source = await one(this.db, 'SELECT * FROM skribbil.matches WHERE id=$1', [sourceId]);
      requireValue(source, 'Room not found.', 404);
      const request = {matchId:source.id, lobbyId:source.engine_room_id, accountId:user.id};
      // The engine checks the current connected leader and final state. The
      // original database creator may no longer be the room's leader.
      const {members} = await this.engineRequest('/engine/internal/rooms/session', {...request, action:'inspect'});
      if (action === 'close') {
        const pending = await one(this.db, `SELECT m.* FROM skribbil.match_rematches r
          JOIN skribbil.matches m ON m.id=r.target_match_id
          WHERE r.source_match_id=$1 AND m.status IN ('lobby','running')`, [sourceId]);
        const result = await this.engineRequest('/engine/internal/rooms/session', {...request, action:'close',
          ...(pending ? {targetMatchId:pending.id,targetLobbyId:pending.engine_room_id} : {})});
        if (pending && result.closedPending) await this.db.query("UPDATE skribbil.matches SET status='cancelled' WHERE id=$1 AND status IN ('lobby','running')", [pending.id]);
        return {closed:true};
      }
      requireValue(Array.isArray(members) && members.filter(p=>p.role==='player').length >= 2,
        'At least two players must stay for another game.', 409);
      const launch = await this.rematch.join(user, sourceId);
      const target = await one(this.db, 'SELECT * FROM skribbil.matches WHERE id=$1', [launch.matchId]);
      requireValue(target, 'The next game could not be found. Try again.', 503);
      const admitted = {};
      // Recheck normal account, active-room and Clubhouse admission for every
      // remaining player. Each browser requests its own fresh ticket on transfer.
      for (const member of members) {
        requireValue(isUuid(member.accountId) && ['player','spectator'].includes(member.role), 'Invalid room roster.', 503);
        const account = await one(this.db, 'SELECT * FROM skribbil.users WHERE id=$1', [member.accountId]);
        requireValue(account?.status === 'active', 'A player’s account is unavailable. They need to leave before you retry.', 409);
        if (account.id !== user.id) await this.admit(account, target, member.role);
        admitted[account.id] = member.role;
      }
      await this.engineRequest('/engine/internal/rooms/session', {...request, action:'transfer',
        targetMatchId:target.id, targetLobbyId:target.engine_room_id, admitted});
      return {matchId:target.id};
    } finally {
      this.pending.delete(sourceId);
    }
  }
}
