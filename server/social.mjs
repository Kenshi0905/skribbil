import { randomBytes } from 'node:crypto';
import { hash, requireValue, isUuid, textField } from './security.mjs';

const one = async (db, sql, values = []) => (await db.query(sql, values)).rows[0];
const rows = async (db, sql, values = []) => (await db.query(sql, values)).rows;

// Account-targeted invitations only. This service never sends email or messages
// to an external service, and the private token digest is never returned.
export class Social {
  constructor(platform) { this.platform = platform; this.db = platform.db; }

  async account(db, user, lock = false) {
    requireValue(user && isUuid(user.id), 'Sign in first.', 401);
    const account = await one(db, `SELECT id,username,status FROM skribbil.users WHERE id=$1${lock ? ' FOR NO KEY UPDATE' : ''}`, [user.id]);
    requireValue(account && account.status === 'active', 'Account unavailable.', 403);
    return account;
  }

  async view(db, userId) {
    const party = await one(db, `SELECT p.id,p.leader_id FROM skribbil.parties p
      JOIN skribbil.party_members m ON m.party_id=p.id
      WHERE m.user_id=$1 AND m.left_at IS NULL AND p.closed_at IS NULL`, [userId]);
    let current = null;
    if (party) {
      const members = await rows(db, `SELECT u.id,u.username FROM skribbil.party_members m
        JOIN skribbil.users u ON u.id=m.user_id WHERE m.party_id=$1 AND m.left_at IS NULL
        ORDER BY (m.user_id=$2) DESC,m.joined_at,u.id`, [party.id,party.leader_id]);
      current = { id: party.id, leaderId: party.leader_id, members };
    }
    const invitations = await rows(db, `SELECT i.id,i.party_id,u.username AS sender,i.expires_at
      FROM skribbil.party_invites i JOIN skribbil.parties p ON p.id=i.party_id
      JOIN skribbil.users u ON u.id=i.inviter_id
      JOIN skribbil.party_members m ON m.party_id=p.id AND m.user_id=i.inviter_id
      WHERE i.invitee_id=$1 AND i.accepted_at IS NULL AND i.revoked_at IS NULL AND i.expires_at>now()
        AND p.closed_at IS NULL AND m.left_at IS NULL AND u.status='active'
        AND EXISTS(SELECT 1 FROM skribbil.friendships f WHERE f.user_low=least(i.inviter_id,i.invitee_id)
          AND f.user_high=greatest(i.inviter_id,i.invitee_id) AND f.status='accepted')
      ORDER BY i.created_at,i.id`, [userId]);
    return { party: current, invites: invitations.map(i => ({ id:i.id,partyId:i.party_id,from:i.sender,expiresAt:i.expires_at })) };
  }

  async getParty(user) {
    const account = await this.account(this.db,user);
    return this.view(this.db,account.id);
  }

  async createParty(user) {
    return this.db.transaction(async db => {
      // Serialize every membership mutation for this account, including accepts
      // for different parties. The partial unique index is the final safeguard.
      const account = await this.account(db,user,true);
      const existing = await one(db, 'SELECT party_id FROM skribbil.party_members WHERE user_id=$1 AND left_at IS NULL', [account.id]);
      if (existing) return this.view(db,account.id);
      const party = await one(db, 'INSERT INTO skribbil.parties(leader_id,maximum_members) VALUES($1,8) RETURNING id', [account.id]);
      await db.query('INSERT INTO skribbil.party_members(party_id,user_id) VALUES($1,$2)',[party.id,account.id]);
      return this.view(db,account.id);
    });
  }

  async invite(user, partyId, body) {
    requireValue(isUuid(partyId),'Invalid party.');
    const username = textField(body?.username,3,24,'Username');
    return this.db.transaction(async db => {
      const account = await this.account(db,user,true);
      const party = await one(db,'SELECT * FROM skribbil.parties WHERE id=$1 FOR UPDATE',[partyId]);
      requireValue(party && party.closed_at === null && party.leader_id === account.id,'Only the active party leader can invite friends.',403);
      requireValue(await one(db,'SELECT user_id FROM skribbil.party_members WHERE party_id=$1 AND user_id=$2 AND left_at IS NULL',[partyId,account.id]),'You are not an active member of this party.',403);
      const target = await one(db,"SELECT id,username FROM skribbil.users WHERE lower(username)=lower($1) AND status='active'",[username]);
      requireValue(target && target.id!==account.id,'Choose an active friend to invite.',404);
      const pair = [account.id,target.id].sort();
      requireValue(await one(db,"SELECT user_low FROM skribbil.friendships WHERE user_low=$1 AND user_high=$2 AND status='accepted'",pair),'Only accepted friends can be invited.',403);
      requireValue(!await one(db,'SELECT user_id FROM skribbil.party_members WHERE party_id=$1 AND user_id=$2 AND left_at IS NULL',[partyId,target.id]),'This friend is already in your party.',409);
      const count = await one(db,'SELECT count(*)::int AS n FROM skribbil.party_members WHERE party_id=$1 AND left_at IS NULL',[partyId]);
      requireValue(count.n<Math.min(8,party.maximum_members),'The party is full.',409);
      const existing = await one(db,`SELECT id,expires_at FROM skribbil.party_invites WHERE party_id=$1 AND invitee_id=$2
        AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at>now() ORDER BY created_at LIMIT 1`,[partyId,target.id]);
      const invite = existing || await one(db,`INSERT INTO skribbil.party_invites(party_id,inviter_id,invitee_id,token_hash,expires_at)
        VALUES($1,$2,$3,$4,now()+interval '24 hours') RETURNING id,expires_at`,[partyId,account.id,target.id,hash(randomBytes(32))]);
      return {id:invite.id,partyId,from:account.username,expiresAt:invite.expires_at};
    });
  }

  async acceptInvite(user, inviteId) {
    requireValue(isUuid(inviteId),'Invalid invitation.');
    return this.db.transaction(async db => {
      const account = await this.account(db,user,true);
      const original = await one(db,'SELECT * FROM skribbil.party_invites WHERE id=$1',[inviteId]);
      requireValue(original && original.invitee_id===account.id,'This invitation is not addressed to you.',403);
      const party = await one(db,'SELECT * FROM skribbil.parties WHERE id=$1 FOR UPDATE',[original.party_id]);
      const invite = await one(db,'SELECT * FROM skribbil.party_invites WHERE id=$1 FOR UPDATE',[inviteId]);
      // An already-consumed invitation never becomes a new join capability after
      // the recipient leaves or the leader closes the party.
      if (invite.accepted_at) return this.view(db,account.id);
      requireValue(party && !party.closed_at && !invite.revoked_at && new Date(invite.expires_at)>new Date(),'This invitation has expired or the party has closed.',409);
      requireValue(party.leader_id===invite.inviter_id && await one(db,`SELECT m.user_id FROM skribbil.party_members m JOIN skribbil.users u ON u.id=m.user_id
        WHERE m.party_id=$1 AND m.user_id=$2 AND m.left_at IS NULL AND u.status='active'`,[party.id,invite.inviter_id]),'The inviting leader is no longer available.',409);
      const pair = [account.id,invite.inviter_id].sort();
      requireValue(await one(db,"SELECT user_low FROM skribbil.friendships WHERE user_low=$1 AND user_high=$2 AND status='accepted'",pair),'The friendship must still be accepted.',403);
      const existing = await one(db,'SELECT party_id FROM skribbil.party_members WHERE user_id=$1 AND left_at IS NULL',[account.id]);
      requireValue(!existing || existing.party_id===party.id,'Leave your current party before accepting another invitation.',409);
      if (!existing) {
        const count = await one(db,'SELECT count(*)::int AS n FROM skribbil.party_members WHERE party_id=$1 AND left_at IS NULL',[party.id]);
        requireValue(count.n<Math.min(8,party.maximum_members),'The party is full.',409);
        await db.query(`INSERT INTO skribbil.party_members(party_id,user_id) VALUES($1,$2)
          ON CONFLICT(party_id,user_id) DO UPDATE SET joined_at=now(),left_at=NULL`,[party.id,account.id]);
      }
      await db.query('UPDATE skribbil.party_invites SET accepted_at=now() WHERE id=$1',[inviteId]);
      return this.view(db,account.id);
    });
  }

  async leaveParty(user) {
    return this.db.transaction(async db => {
      const account = await this.account(db,user,true);
      const membership = await one(db,'SELECT party_id FROM skribbil.party_members WHERE user_id=$1 AND left_at IS NULL',[account.id]);
      if (!membership) return this.view(db,account.id);
      const party = await one(db,'SELECT * FROM skribbil.parties WHERE id=$1 FOR UPDATE',[membership.party_id]);
      if (party.leader_id===account.id) {
        await db.query('UPDATE skribbil.parties SET closed_at=coalesce(closed_at,now()) WHERE id=$1',[party.id]);
        await db.query('UPDATE skribbil.party_members SET left_at=now() WHERE party_id=$1 AND left_at IS NULL',[party.id]);
        await db.query('UPDATE skribbil.party_invites SET revoked_at=now() WHERE party_id=$1 AND accepted_at IS NULL AND revoked_at IS NULL',[party.id]);
      } else {
        await db.query('UPDATE skribbil.party_members SET left_at=now() WHERE party_id=$1 AND user_id=$2 AND left_at IS NULL',[party.id,account.id]);
      }
      return this.view(db,account.id);
    });
  }
}
