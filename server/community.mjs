import { randomBytes } from 'node:crypto';
import { hash, requireValue, isUuid, textField } from './security.mjs';

const one=async(db,sql,values=[]) => (await db.query(sql,values)).rows[0];
const rows=async(db,sql,values=[]) => (await db.query(sql,values)).rows;
const validId=(id,label) => requireValue(isUuid(id),`Invalid ${label}.`);
const teamRow=(t,userId) => ({id:t.id,name:t.name,tag:t.tag,logoUrl:t.logo_url,captainId:t.captain_id,
  myRole:t.captain_id===userId?'captain':t.role||null});
const disputeRow=d => ({id:d.id,matchId:d.match_id,submittedBy:{id:d.submitted_by,username:d.username},
  reason:d.reason,status:d.status,resolution:d.resolution,createdAt:d.created_at,resolvedAt:d.resolved_at});

export class Community {
  constructor(platform){this.platform=platform;this.db=platform.db;}
  async account(db,user,lock=false){
    requireValue(user&&isUuid(user.id),'Sign in first.',401);
    const account=await one(db,`SELECT id,username,status FROM skribbil.users WHERE id=$1${lock?' FOR NO KEY UPDATE':''}`,[user.id]);
    requireValue(account&&account.status==='active','Account unavailable.',403);return account;
  }
  async member(db,userId,communityId){
    return one(db,`SELECT m.user_id FROM skribbil.community_members m JOIN skribbil.users u ON u.id=m.user_id
      WHERE m.community_id=$1 AND m.user_id=$2 AND m.status='active' AND u.status='active'
        AND NOT EXISTS(SELECT 1 FROM skribbil.moderation_bans b WHERE b.user_id=m.user_id AND b.revoked_at IS NULL
          AND b.starts_at<=now() AND (b.ends_at IS NULL OR b.ends_at>now()) AND b.game_id IS NULL
          AND (b.community_id IS NULL OR b.community_id=m.community_id))`,[communityId,userId]);
  }
  async audit(db,user,action,type,id,reason,before,after){
    return this.platform.audit(db,user,action,type,id,reason,before,after);
  }
  async captainOrOfficer(db,team,userId){
    if(!await this.member(db,userId,team.community_id))return false;
    const membership=await one(db,'SELECT role FROM skribbil.team_members WHERE team_id=$1 AND user_id=$2 AND left_at IS NULL',[team.id,userId]);
    return !!membership&&(team.captain_id===userId||membership.role==='officer');
  }
  async getMyTeams(user){
    const account=await this.account(this.db,user);
    const teams=await rows(this.db,`SELECT t.*,m.role FROM skribbil.teams t JOIN skribbil.team_members m ON m.team_id=t.id
      WHERE m.user_id=$1 AND m.left_at IS NULL AND t.archived_at IS NULL ORDER BY t.name,t.id`,[account.id]);
    const invitations=await rows(this.db,`SELECT i.id,i.team_id,t.name AS team_name,u.username AS sender,i.expires_at
      FROM skribbil.team_invitations i JOIN skribbil.teams t ON t.id=i.team_id JOIN skribbil.users u ON u.id=i.inviter_id
      JOIN skribbil.team_members m ON m.team_id=i.team_id AND m.user_id=i.inviter_id
      WHERE i.invitee_id=$1 AND i.accepted_at IS NULL AND i.revoked_at IS NULL AND i.expires_at>now()
        AND t.archived_at IS NULL AND m.left_at IS NULL AND u.status='active'
        AND (t.captain_id=i.inviter_id OR m.role='officer') ORDER BY i.created_at,i.id`,[account.id]);
    return {teams:teams.map(t=>teamRow(t,account.id)),invites:invitations.map(i=>({id:i.id,teamId:i.team_id,teamName:i.team_name,from:i.sender,expiresAt:i.expires_at}))};
  }
  async getTeam(user,id){
    validId(id,'team');const account=await this.account(this.db,user);
    const t=await one(this.db,'SELECT * FROM skribbil.teams WHERE id=$1',[id]);requireValue(t,'Team not found.',404);
    requireValue(await this.member(this.db,account.id,t.community_id),'Join this community to view its team roster.',403);
    const members=await rows(this.db,`SELECT u.id,u.username,m.role FROM skribbil.team_members m
      JOIN skribbil.users u ON u.id=m.user_id WHERE m.team_id=$1 AND m.left_at IS NULL
      ORDER BY (m.user_id=$2) DESC,m.joined_at,u.id`,[id,t.captain_id]);
    const own=members.find(m=>m.id===account.id);
    return {team:{...teamRow({...t,role:own?.role},own?account.id:null),archived:!!t.archived_at,
      members:members.map(m=>({...m,role:m.id===t.captain_id?'captain':m.role}))}};
  }
  async inviteTeam(user,id,body){
    validId(id,'team');const username=textField(body?.username,3,24,'Username');
    return this.db.transaction(async db=>{
      const account=await this.account(db,user,true);
      const t=await one(db,'SELECT * FROM skribbil.teams WHERE id=$1 FOR UPDATE',[id]);
      requireValue(t&&!t.archived_at&&await this.captainOrOfficer(db,t,account.id),'Only the active captain or an officer can invite team members.',403);
      const target=await one(db,"SELECT id,username FROM skribbil.users WHERE lower(username)=lower($1) AND status='active'",[username]);
      requireValue(target&&target.id!==account.id&&await this.member(db,target.id,t.community_id),'Choose an eligible account in this community.',404);
      requireValue(!await one(db,'SELECT user_id FROM skribbil.team_members WHERE team_id=$1 AND user_id=$2 AND left_at IS NULL',[id,target.id]),'This account is already on the team.',409);
      requireValue((await one(db,'SELECT count(*)::int AS n FROM skribbil.team_members WHERE team_id=$1 AND left_at IS NULL',[id])).n<32,'This team already has 32 members.',409);
      await db.query('UPDATE skribbil.team_invitations SET revoked_at=now() WHERE team_id=$1 AND invitee_id=$2 AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at<=now()',[id,target.id]);
      let invite=await one(db,'SELECT * FROM skribbil.team_invitations WHERE team_id=$1 AND invitee_id=$2 AND accepted_at IS NULL AND revoked_at IS NULL',[id,target.id]);
      if(invite&&!await this.captainOrOfficer(db,t,invite.inviter_id)){
        await db.query('UPDATE skribbil.team_invitations SET revoked_at=now() WHERE id=$1',[invite.id]);invite=null;
      }
      if(!invite){
        invite=await one(db,`INSERT INTO skribbil.team_invitations(team_id,community_id,inviter_id,invitee_id,token_hash,expires_at)
          VALUES($1,$2,$3,$4,$5,now()+interval '7 days') RETURNING *`,[id,t.community_id,account.id,target.id,hash(randomBytes(32))]);
        await this.audit(db,account,'team.invited','team',id,'Team officer invited an eligible community account.',null,{inviteId:invite.id,inviteeId:target.id});
      }
      const sender=invite.inviter_id===account.id?account:await one(db,'SELECT username FROM skribbil.users WHERE id=$1',[invite.inviter_id]);
      return {id:invite.id,teamId:id,teamName:t.name,from:sender.username,expiresAt:invite.expires_at};
    });
  }
  async acceptTeamInvite(user,id){
    validId(id,'invitation');return this.db.transaction(async db=>{
      const account=await this.account(db,user,true);
      const original=await one(db,'SELECT * FROM skribbil.team_invitations WHERE id=$1',[id]);
      requireValue(original&&original.invitee_id===account.id,'This invitation is not addressed to you.',403);
      const t=await one(db,'SELECT * FROM skribbil.teams WHERE id=$1 FOR UPDATE',[original.team_id]);
      const invite=await one(db,'SELECT * FROM skribbil.team_invitations WHERE id=$1 FOR UPDATE',[id]);
      if(invite.accepted_at)return {teamId:t.id,accepted:true,alreadyAccepted:true};
      requireValue(!t.archived_at&&!invite.revoked_at&&new Date(invite.expires_at)>new Date(),'The team invitation has expired or closed.',409);
      requireValue(await this.member(db,account.id,t.community_id)&&await this.captainOrOfficer(db,t,invite.inviter_id),'The recipient or inviting officer is no longer eligible.',403);
      const membership=await one(db,'SELECT * FROM skribbil.team_members WHERE team_id=$1 AND user_id=$2',[t.id,account.id]);
      if(!membership||membership.left_at){
        requireValue((await one(db,'SELECT count(*)::int AS n FROM skribbil.team_members WHERE team_id=$1 AND left_at IS NULL',[t.id])).n<32,'This team already has 32 members.',409);
        await db.query(`INSERT INTO skribbil.team_members(team_id,community_id,user_id,role) VALUES($1,$2,$3,'member')
          ON CONFLICT(team_id,user_id) DO UPDATE SET role='member',joined_at=now(),left_at=NULL`,[t.id,t.community_id,account.id]);
      }
      await db.query('UPDATE skribbil.team_invitations SET accepted_at=now() WHERE id=$1',[id]);
      await this.audit(db,account,'team.joined','team',t.id,'The intended account accepted its team invitation.',null,{userId:account.id,inviteId:id});
      return {teamId:t.id,accepted:true,alreadyAccepted:false};
    });
  }
  async leaveTeam(user,id){
    validId(id,'team');return this.db.transaction(async db=>{
      const account=await this.account(db,user,true);
      const t=await one(db,'SELECT * FROM skribbil.teams WHERE id=$1 FOR UPDATE',[id]);requireValue(t,'Team not found.',404);
      const membership=await one(db,'SELECT * FROM skribbil.team_members WHERE team_id=$1 AND user_id=$2',[id,account.id]);
      requireValue(membership,'You are not a team member.',403);
      if(membership.left_at)return {left:true,archived:!!t.archived_at};
      let archived=!!t.archived_at;
      if(t.captain_id===account.id){
        requireValue(!await one(db,'SELECT user_id FROM skribbil.team_members WHERE team_id=$1 AND user_id<>$2 AND left_at IS NULL LIMIT 1',[id,account.id]),'Transfer captaincy to a teammate before leaving.',409);
        await db.query('UPDATE skribbil.teams SET archived_at=coalesce(archived_at,now()) WHERE id=$1',[id]);archived=true;
      }
      await db.query('UPDATE skribbil.team_members SET left_at=now() WHERE team_id=$1 AND user_id=$2',[id,account.id]);
      await db.query(`UPDATE skribbil.team_invitations SET revoked_at=now() WHERE team_id=$1
        AND ($3::boolean OR inviter_id=$2) AND accepted_at IS NULL AND revoked_at IS NULL`,[id,account.id,archived]);
      await this.audit(db,account,'team.left','team',id,archived?'The sole captain left and archived the team.':'A team member left the current roster.',{userId:account.id,role:membership.role},{left:true,archived});
      return {left:true,archived};
    });
  }
  async transferCaptain(user,id,body){
    validId(id,'team');validId(body?.userId,'new captain');return this.db.transaction(async db=>{
      const account=await this.account(db,user,true);
      const t=await one(db,'SELECT * FROM skribbil.teams WHERE id=$1 FOR UPDATE',[id]);
      requireValue(t&&!t.archived_at&&t.captain_id===account.id&&await this.captainOrOfficer(db,t,account.id),'Only the current captain may transfer captaincy.',403);
      requireValue(body.userId!==account.id,'Choose another active teammate.');
      requireValue(await this.member(db,body.userId,t.community_id)&&await one(db,'SELECT user_id FROM skribbil.team_members WHERE team_id=$1 AND user_id=$2 AND left_at IS NULL',[id,body.userId]),'The new captain must be an eligible current teammate.',409);
      await db.query("UPDATE skribbil.team_members SET role='member' WHERE team_id=$1 AND role='captain'",[id]);
      await db.query("UPDATE skribbil.team_members SET role='captain' WHERE team_id=$1 AND user_id=$2",[id,body.userId]);
      await db.query('UPDATE skribbil.teams SET captain_id=$2 WHERE id=$1',[id,body.userId]);
      // A former captain loses invite authority unless later appointed an officer.
      await db.query('UPDATE skribbil.team_invitations SET revoked_at=now() WHERE team_id=$1 AND inviter_id=$2 AND accepted_at IS NULL AND revoked_at IS NULL',[id,account.id]);
      await this.audit(db,account,'team.captain_transferred','team',id,'The current captain transferred leadership to an active teammate.',{captainId:account.id},{captainId:body.userId});
      return {teamId:id,captainId:body.userId};
    });
  }

  async getDisputes(user,{admin=false}={}){
    const account=await this.account(this.db,user);if(admin)await this.platform.admin(account);
    const disputes=await rows(this.db,`SELECT d.*,u.username FROM skribbil.disputes d JOIN skribbil.users u ON u.id=d.submitted_by
      WHERE ($1::boolean OR d.submitted_by=$2) ORDER BY (d.status IN ('open','reviewing')) DESC,d.created_at DESC,d.id LIMIT 200`,[admin,account.id]);
    return {disputes:disputes.map(disputeRow)};
  }
  async submitDispute(user,body){
    validId(body?.matchId,'match');const reason=textField(body?.reason,10,2000,'Dispute reason');
    return this.db.transaction(async db=>{
      const account=await this.account(db,user,true);
      const match=await one(db,'SELECT * FROM skribbil.matches WHERE id=$1 FOR UPDATE',[body.matchId]);
      requireValue(match&&await one(db,'SELECT user_id FROM skribbil.match_players WHERE match_id=$1 AND user_id=$2',[body.matchId,account.id]),'Only a participant can dispute this match.',403);
      requireValue(match.status==='completed'&&match.accepted_result_id,'A completed match result is required.',409);
      requireValue(await one(db,'SELECT 1 FROM skribbil.match_result_players WHERE result_id=$1 AND user_id=$2',[match.accepted_result_id,account.id]),'Only a participant in the completed result can dispute it.',403);
      let dispute=await one(db,"SELECT * FROM skribbil.disputes WHERE match_id=$1 AND submitted_by=$2 AND status IN ('open','reviewing')",[match.id,account.id]);
      if(!dispute){
        dispute=await one(db,'INSERT INTO skribbil.disputes(match_id,submitted_by,reason) VALUES($1,$2,$3) RETURNING *',[match.id,account.id,reason]);
        await this.audit(db,account,'dispute.submitted','dispute',dispute.id,'A participant submitted a match result dispute.',null,{matchId:match.id,resultId:match.accepted_result_id,status:'open'});
      }
      return {dispute:disputeRow({...dispute,username:account.username})};
    });
  }
  async resolveDispute(user,id,body){
    validId(id,'dispute');const account=await this.account(this.db,user);await this.platform.admin(account);
    requireValue(['resolved','rejected'].includes(body?.status),'Choose resolved or rejected.');
    const resolution=textField(body?.resolution,10,2000,'Resolution');
    return this.db.transaction(async db=>{
      const dispute=await one(db,'SELECT * FROM skribbil.disputes WHERE id=$1 FOR UPDATE',[id]);requireValue(dispute,'Dispute not found.',404);
      const owner=await one(db,'SELECT username FROM skribbil.users WHERE id=$1',[dispute.submitted_by]);
      if(['resolved','rejected'].includes(dispute.status)){
        requireValue(dispute.status===body.status&&dispute.resolution===resolution,'This dispute is already closed; its resolution cannot be overwritten.',409);
        return {dispute:disputeRow({...dispute,username:owner.username})};
      }
      const updated=await one(db,`UPDATE skribbil.disputes SET status=$2,resolution=$3,assigned_to=$4,resolved_by=$4,resolved_at=now()
        WHERE id=$1 RETURNING *`,[id,body.status,resolution,account.id]);
      await this.audit(db,account,'dispute.resolved','dispute',id,resolution,{status:dispute.status,resolution:dispute.resolution},{status:updated.status,resolution:updated.resolution});
      return {dispute:disputeRow({...updated,username:owner.username})};
    });
  }
}
