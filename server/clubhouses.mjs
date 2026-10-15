import { randomBytes } from 'node:crypto';
import { hash, requireValue, isUuid, textField } from './security.mjs';

const one=async(db,sql,args=[]) => (await db.query(sql,args)).rows[0];
const rows=async(db,sql,args=[]) => (await db.query(sql,args)).rows;
const id=(value,label) => requireValue(isUuid(value),`Invalid ${label}.`);
const fields=body => ({name:textField(body?.name,2,48,'Clubhouse name'),description:textField(body?.description??'',0,500,'Description')});
const requestRow=r => ({id:r.id,name:r.name,description:r.description,status:r.status,reason:r.decision_reason,
  clubhouseId:r.clubhouse_id,createdAt:r.created_at,decidedAt:r.decided_at});
const inviteRow=i => ({id:i.id,clubhouseId:i.clubhouse_id,clubhouseName:i.clubhouse_name,from:i.sender,expiresAt:i.expires_at});
const clubhouseRow=c => ({id:c.id,name:c.name,description:c.description,ownerId:c.owner_id,myRole:c.my_role??null,memberCount:Number(c.member_count??0)});

export class Clubhouses {
  constructor(platform){this.platform=platform;this.db=platform.db;}
  async account(db,user,lock=false){
    requireValue(user&&isUuid(user.id),'Sign in first.',401);
    // Serialize this account's mutations without conflicting with foreign-key
    // references when two administrators approve each other's requests.
    const account=await one(db,`SELECT id,username,display_name AS "displayName",status FROM skribbil.users WHERE id=$1${lock?' FOR NO KEY UPDATE':''}`,[user.id]);
    requireValue(account?.status==='active','Account unavailable.',403);return account;
  }
  async administrator(db,userId){
    return !!await one(db,"SELECT 1 FROM skribbil.platform_roles WHERE user_id=$1 AND role='administrator'",[userId]);
  }
  async admin(db,user){requireValue(await this.administrator(db,user.id),'Administrator access required.',403);}
  async audit(db,user,action,type,entityId,reason,before,after){
    return this.platform.audit(db,user,action,type,entityId,reason,before,after);
  }
  async membership(db,clubhouseId,userId){
    return one(db,`SELECT m.* FROM skribbil.clubhouse_members m JOIN skribbil.users u ON u.id=m.user_id
      WHERE m.clubhouse_id=$1 AND m.user_id=$2 AND m.left_at IS NULL AND u.status='active'`,[clubhouseId,userId]);
  }
  async manager(db,clubhouse,userId){
    if(!await one(db,"SELECT 1 FROM skribbil.users WHERE id=$1 AND status='active'",[userId]))return false;
    if(await this.administrator(db,userId))return true;
    const member=await this.membership(db,clubhouse.id,userId);
    return !!member&&(clubhouse.owner_id===userId||member.role==='admin');
  }
  async access(db,user,clubhouseId,lock=false){
    const clubhouse=await one(db,`SELECT * FROM skribbil.clubhouses WHERE id=$1${lock?' FOR UPDATE':''}`,[clubhouseId]);
    const platformAdmin=await this.administrator(db,user.id);
    const membership=clubhouse?await this.membership(db,clubhouseId,user.id):null;
    requireValue(clubhouse&&!clubhouse.archived_at&&(membership||platformAdmin),'Clubhouse not found.',404);
    return {clubhouse,membership,platformAdmin};
  }
  // Room admission deliberately has no platform-admin override.
  async requireMember(user,clubhouseId,db=this.db,{lock=true}={}){
    id(clubhouseId,'clubhouse');await this.account(db,user);
    // Lock first, then read membership with a fresh READ COMMITTED snapshot.
    // Joining membership in the locking statement can retain a stale member
    // row if a concurrent removal holds only the clubhouse lock while we wait.
    if(lock)await db.query('SELECT id FROM skribbil.clubhouses WHERE id=$1 FOR UPDATE',[clubhouseId]);
    const found=await one(db,`SELECT c.id FROM skribbil.clubhouses c JOIN skribbil.clubhouse_members m ON m.clubhouse_id=c.id
      WHERE c.id=$1 AND m.user_id=$2 AND c.archived_at IS NULL AND m.left_at IS NULL`,[clubhouseId,user.id]);
    requireValue(found,'This private room is available only to current clubhouse members.',403);return true;
  }
  async list(user){
    const account=await this.account(this.db,user);
    const clubhouses=await rows(this.db,`SELECT c.*,CASE WHEN c.owner_id=$1 THEN 'owner' ELSE m.role END AS my_role,
      (SELECT count(*) FROM skribbil.clubhouse_members x WHERE x.clubhouse_id=c.id AND x.left_at IS NULL) AS member_count
      FROM skribbil.clubhouses c JOIN skribbil.clubhouse_members m ON m.clubhouse_id=c.id
      WHERE m.user_id=$1 AND m.left_at IS NULL AND c.archived_at IS NULL ORDER BY c.name,c.id`,[account.id]);
    const potential=await rows(this.db,`SELECT i.*,c.name AS clubhouse_name,u.display_name AS sender FROM skribbil.clubhouse_invitations i
      JOIN skribbil.clubhouses c ON c.id=i.clubhouse_id JOIN skribbil.users u ON u.id=i.inviter_id
      WHERE i.invitee_id=$1 AND i.accepted_at IS NULL AND i.revoked_at IS NULL AND i.expires_at>now() AND c.archived_at IS NULL
      ORDER BY i.created_at,i.id`,[account.id]);
    const invites=[];
    for(const invite of potential){
      const c=await one(this.db,'SELECT id,owner_id FROM skribbil.clubhouses WHERE id=$1',[invite.clubhouse_id]);
      if(await this.manager(this.db,c,invite.inviter_id))invites.push(inviteRow(invite));
    }
    const requests=await rows(this.db,"SELECT * FROM skribbil.clubhouse_requests WHERE requested_by=$1 ORDER BY (status='pending') DESC,created_at DESC LIMIT 100",[account.id]);
    return {clubhouses:clubhouses.map(clubhouseRow),invites,requests:requests.map(requestRow)};
  }
  async detail(user,clubhouseId){
    id(clubhouseId,'clubhouse');const account=await this.account(this.db,user);
    const {clubhouse:c,membership}=await this.access(this.db,account,clubhouseId);
    const members=await rows(this.db,`SELECT u.id,u.username,u.display_name AS "displayName",CASE WHEN u.id=$2 THEN 'owner' ELSE m.role END AS role
      FROM skribbil.clubhouse_members m JOIN skribbil.users u ON u.id=m.user_id WHERE m.clubhouse_id=$1 AND m.left_at IS NULL
      ORDER BY (u.id=$2) DESC,m.joined_at,u.id`,[clubhouseId,c.owner_id]);
    const rooms=membership?await rows(this.db,`SELECT m.id,m.engine_room_id AS code,m.mode,m.status,(m.created_by=$2) AS owner,
      (SELECT count(*)::int FROM skribbil.match_players p JOIN skribbil.clubhouse_members member ON member.user_id=p.user_id AND member.clubhouse_id=$1
        WHERE p.match_id=m.id AND p.left_at IS NULL AND NOT p.disqualified AND member.left_at IS NULL) AS players
      FROM skribbil.matches m WHERE m.clubhouse_id=$1 AND m.status IN ('lobby','running') AND m.engine_room_id NOT LIKE 'pending-%'
        AND EXISTS(SELECT 1 FROM skribbil.clubhouse_members own WHERE own.clubhouse_id=$1 AND own.user_id=$2 AND own.left_at IS NULL)
      ORDER BY m.created_at DESC,m.id LIMIT 20`,[clubhouseId,account.id]):[];
    return {clubhouse:{...clubhouseRow({...c,my_role:membership?(c.owner_id===account.id?'owner':membership.role):null,member_count:members.length}),archived:false,members,rooms:rooms.map(r=>({...r,owner:!!r.owner}))}};
  }
  async request(user,body){
    const data=fields(body);
    return this.db.transaction(async db=>{
      const account=await this.account(db,user,true);
      let request=await one(db,"SELECT * FROM skribbil.clubhouse_requests WHERE requested_by=$1 AND status='pending'",[account.id]);
      if(request){requireValue(request.name===data.name&&request.description===data.description,'You already have a pending clubhouse request.',409);}
      else {
        request=await one(db,'INSERT INTO skribbil.clubhouse_requests(requested_by,name,description) VALUES($1,$2,$3) RETURNING *',[account.id,data.name,data.description]);
        await this.audit(db,account,'clubhouse.requested','clubhouse_request',request.id,'A player requested an invite-only clubhouse.',null,{name:data.name,status:'pending'});
      }
      return {request:requestRow(request)};
    });
  }
  async listRequests(user){
    const account=await this.account(this.db,user);await this.admin(this.db,account);
    const requests=await rows(this.db,`SELECT r.*,u.username AS requester_name,u.display_name AS requester_display_name,a.username AS decider_name,a.display_name AS decider_display_name
      FROM skribbil.clubhouse_requests r JOIN skribbil.users u ON u.id=r.requested_by LEFT JOIN skribbil.users a ON a.id=r.decided_by
      ORDER BY (r.status='pending') DESC,r.created_at DESC,r.id LIMIT 200`);
    return {requests:requests.map(r=>({...requestRow(r),requester:{id:r.requested_by,username:r.requester_name,displayName:r.requester_display_name},
      decidedBy:r.decided_by?{id:r.decided_by,username:r.decider_name,displayName:r.decider_display_name}:null}))};
  }
  async insert(db,actor,data,ownerId){
    const owner=await one(db,"SELECT id FROM skribbil.users WHERE id=$1 AND status='active'",[ownerId]);
    requireValue(owner,'Choose an active clubhouse owner.',409);
    const clubhouse=await one(db,'INSERT INTO skribbil.clubhouses(name,description,owner_id,created_by) VALUES($1,$2,$3,$4) RETURNING *',[data.name,data.description,ownerId,actor.id]);
    await db.query("INSERT INTO skribbil.clubhouse_members(clubhouse_id,user_id,role) VALUES($1,$2,'owner')",[clubhouse.id,ownerId]);
    await this.audit(db,actor,'clubhouse.created','clubhouse',clubhouse.id,'An administrator created an invite-only clubhouse.',null,{ownerId,name:data.name});
    return clubhouse;
  }
  async create(user,body){
    const data=fields(body);if(body?.ownerId)id(body.ownerId,'owner');
    const clubhouse=await this.db.transaction(async db=>{
      const account=await this.account(db,user,true);await this.admin(db,account);
      return this.insert(db,account,data,body?.ownerId||account.id);
    });
    return this.detail(user,clubhouse.id);
  }
  async decideRequest(user,requestId,body){
    id(requestId,'request');requireValue(['approved','rejected'].includes(body?.status),'Choose approved or rejected.');
    const reason=textField(body?.reason,5,2000,'Decision reason');
    return this.db.transaction(async db=>{
      const account=await this.account(db,user,true);await this.admin(db,account);
      const request=await one(db,'SELECT * FROM skribbil.clubhouse_requests WHERE id=$1 FOR UPDATE',[requestId]);
      requireValue(request,'Clubhouse request not found.',404);
      if(request.status!=='pending'){
        requireValue(request.status===body.status&&request.decision_reason===reason,'This request already has an immutable decision.',409);
        return {request:requestRow(request),clubhouseId:request.clubhouse_id};
      }
      const clubhouse=body.status==='approved'?await this.insert(db,account,request,request.requested_by):null;
      const updated=await one(db,`UPDATE skribbil.clubhouse_requests SET status=$2,clubhouse_id=$3,decided_by=$4,decided_at=now(),decision_reason=$5
        WHERE id=$1 RETURNING *`,[requestId,body.status,clubhouse?.id??null,account.id,reason]);
      await this.audit(db,account,'clubhouse.request_decided','clubhouse_request',requestId,reason,{status:'pending'},
        {status:body.status,clubhouseId:clubhouse?.id??null,ownerId:request.requested_by});
      return {request:requestRow(updated),clubhouseId:updated.clubhouse_id};
    });
  }
  async invite(user,clubhouseId,body){
    id(clubhouseId,'clubhouse');const username=textField(body?.username,3,24,'Username');
    return this.db.transaction(async db=>{
      const account=await this.account(db,user,true);
      const {clubhouse:c}=await this.access(db,account,clubhouseId,true);
      requireValue(await this.manager(db,c,account.id),'Only clubhouse owners or admins can invite members.',403);
      const target=await one(db,"SELECT id FROM skribbil.users WHERE lower(username)=lower($1) AND status='active'",[username]);
      requireValue(target&&target.id!==account.id,'Choose another active account.',404);
      requireValue(!await this.membership(db,clubhouseId,target.id),'This account is already a clubhouse member.',409);
      requireValue((await one(db,'SELECT count(*)::int AS n FROM skribbil.clubhouse_members WHERE clubhouse_id=$1 AND left_at IS NULL',[clubhouseId])).n<64,'This clubhouse already has 64 members.',409);
      await db.query('UPDATE skribbil.clubhouse_invitations SET revoked_at=now() WHERE clubhouse_id=$1 AND invitee_id=$2 AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at<=now()',[clubhouseId,target.id]);
      let invite=await one(db,'SELECT * FROM skribbil.clubhouse_invitations WHERE clubhouse_id=$1 AND invitee_id=$2 AND accepted_at IS NULL AND revoked_at IS NULL',[clubhouseId,target.id]);
      if(invite&&!await this.manager(db,c,invite.inviter_id)){
        await db.query('UPDATE skribbil.clubhouse_invitations SET revoked_at=now() WHERE id=$1',[invite.id]);invite=null;
      }
      if(!invite){
        invite=await one(db,`INSERT INTO skribbil.clubhouse_invitations(clubhouse_id,inviter_id,invitee_id,token_hash,expires_at)
          VALUES($1,$2,$3,$4,now()+interval '7 days') RETURNING *`,[clubhouseId,account.id,target.id,hash(randomBytes(32))]);
        await this.audit(db,account,'clubhouse.invited','clubhouse',clubhouseId,'An authorized manager invited a specific account.',null,{inviteId:invite.id,inviteeId:target.id});
      }
      const sender=await one(db,'SELECT username,display_name AS "displayName" FROM skribbil.users WHERE id=$1',[invite.inviter_id]);
      return inviteRow({...invite,clubhouse_name:c.name,sender:sender.displayName});
    });
  }
  async acceptInvite(user,inviteId){
    id(inviteId,'invitation');return this.db.transaction(async db=>{
      const account=await this.account(db,user,true);
      const original=await one(db,'SELECT * FROM skribbil.clubhouse_invitations WHERE id=$1',[inviteId]);
      requireValue(original&&original.invitee_id===account.id,'This invitation is not addressed to you.',403);
      const c=await one(db,'SELECT * FROM skribbil.clubhouses WHERE id=$1 FOR UPDATE',[original.clubhouse_id]);
      const invite=await one(db,'SELECT * FROM skribbil.clubhouse_invitations WHERE id=$1 FOR UPDATE',[inviteId]);
      if(invite.accepted_at)return {clubhouseId:c.id,accepted:true,alreadyAccepted:true};
      requireValue(!c.archived_at&&!invite.revoked_at&&new Date(invite.expires_at)>new Date(),'This clubhouse invitation has expired or closed.',409);
      requireValue(await this.manager(db,c,invite.inviter_id),'The inviting manager is no longer authorized.',403);
      if(!await this.membership(db,c.id,account.id)){
        requireValue((await one(db,'SELECT count(*)::int AS n FROM skribbil.clubhouse_members WHERE clubhouse_id=$1 AND left_at IS NULL',[c.id])).n<64,'This clubhouse already has 64 members.',409);
        await db.query(`INSERT INTO skribbil.clubhouse_members(clubhouse_id,user_id) VALUES($1,$2)
          ON CONFLICT(clubhouse_id,user_id) DO UPDATE SET role='member',joined_at=now(),left_at=NULL`,[c.id,account.id]);
      }
      await db.query('UPDATE skribbil.clubhouse_invitations SET accepted_at=now() WHERE id=$1',[inviteId]);
      await this.audit(db,account,'clubhouse.joined','clubhouse',c.id,'The intended account accepted its invitation.',null,{userId:account.id,inviteId});
      return {clubhouseId:c.id,accepted:true,alreadyAccepted:false};
    });
  }
  async leave(user,clubhouseId){
    id(clubhouseId,'clubhouse');return this.db.transaction(async db=>{
      const account=await this.account(db,user,true);
      const c=await one(db,'SELECT * FROM skribbil.clubhouses WHERE id=$1 FOR UPDATE',[clubhouseId]);
      const membership=await one(db,'SELECT * FROM skribbil.clubhouse_members WHERE clubhouse_id=$1 AND user_id=$2',[clubhouseId,account.id]);
      requireValue(c&&membership,'Clubhouse not found.',404);
      if(membership.left_at)return {left:true,archived:!!c.archived_at,clubhouseId,userId:account.id};
      let archived=!!c.archived_at;
      if(c.owner_id===account.id){
        requireValue(!await one(db,'SELECT 1 FROM skribbil.clubhouse_members WHERE clubhouse_id=$1 AND user_id<>$2 AND left_at IS NULL LIMIT 1',[clubhouseId,account.id]),'Transfer ownership to a member before leaving.',409);
        await db.query('UPDATE skribbil.clubhouses SET archived_at=coalesce(archived_at,now()) WHERE id=$1',[clubhouseId]);archived=true;
      }
      await db.query('UPDATE skribbil.clubhouse_members SET left_at=now() WHERE clubhouse_id=$1 AND user_id=$2',[clubhouseId,account.id]);
      await db.query('UPDATE skribbil.clubhouse_invitations SET revoked_at=now() WHERE clubhouse_id=$1 AND ($3::boolean OR inviter_id=$2) AND accepted_at IS NULL AND revoked_at IS NULL',[clubhouseId,account.id,archived]);
      await this.audit(db,account,'clubhouse.left','clubhouse',clubhouseId,'A member left the clubhouse.',{userId:account.id},{left:true,archived});
      return {left:true,archived,clubhouseId,userId:account.id};
    });
  }
  async removeMember(user,clubhouseId,userId){
    id(clubhouseId,'clubhouse');id(userId,'member');return this.db.transaction(async db=>{
      const account=await this.account(db,user,true);
      const {clubhouse:c,platformAdmin,membership}=await this.access(db,account,clubhouseId,true);
      requireValue(await this.manager(db,c,account.id),'Only clubhouse owners or admins may remove members.',403);
      requireValue(userId!==c.owner_id,'Transfer ownership before removing the owner.',409);
      requireValue(userId!==account.id,'Use leave to remove your own membership.');
      const target=await one(db,'SELECT * FROM skribbil.clubhouse_members WHERE clubhouse_id=$1 AND user_id=$2',[clubhouseId,userId]);
      requireValue(target,'Member not found.',404);
      requireValue(platformAdmin||c.owner_id===account.id||(membership?.role==='admin'&&target.role==='member'),'Clubhouse admins can remove ordinary members only.',403);
      if(!target.left_at){
        await db.query('UPDATE skribbil.clubhouse_members SET left_at=now() WHERE clubhouse_id=$1 AND user_id=$2',[clubhouseId,userId]);
        await db.query('UPDATE skribbil.clubhouse_invitations SET revoked_at=now() WHERE clubhouse_id=$1 AND (inviter_id=$2 OR invitee_id=$2) AND accepted_at IS NULL AND revoked_at IS NULL',[clubhouseId,userId]);
        await this.audit(db,account,'clubhouse.member_removed','clubhouse',clubhouseId,'An authorized manager removed a member.',{userId,role:target.role},{removed:true});
      }
      return {removed:true,clubhouseId,userId};
    });
  }
  async setRole(user,clubhouseId,body){
    id(clubhouseId,'clubhouse');id(body?.userId,'member');requireValue(['admin','member'].includes(body?.role),'Choose admin or member.');
    return this.db.transaction(async db=>{
      const account=await this.account(db,user,true);
      const {clubhouse:c,platformAdmin}=await this.access(db,account,clubhouseId,true);
      requireValue(platformAdmin||c.owner_id===account.id,'Only the owner or a platform administrator can assign roles.',403);
      requireValue(body.userId!==c.owner_id,'Transfer ownership to change the owner role.',409);
      const member=await this.membership(db,clubhouseId,body.userId);requireValue(member,'Choose an active clubhouse member.',404);
      if(member.role!==body.role){
        await db.query('UPDATE skribbil.clubhouse_members SET role=$3 WHERE clubhouse_id=$1 AND user_id=$2',[clubhouseId,body.userId,body.role]);
        if(body.role==='member')await db.query('UPDATE skribbil.clubhouse_invitations SET revoked_at=now() WHERE clubhouse_id=$1 AND inviter_id=$2 AND accepted_at IS NULL AND revoked_at IS NULL',[clubhouseId,body.userId]);
        await this.audit(db,account,'clubhouse.role_changed','clubhouse',clubhouseId,'The owner or a platform administrator changed a member role.',{userId:body.userId,role:member.role},{userId:body.userId,role:body.role});
      }
      return {userId:body.userId,role:body.role};
    });
  }
  async transferOwner(user,clubhouseId,body){
    id(clubhouseId,'clubhouse');id(body?.userId,'new owner');return this.db.transaction(async db=>{
      const account=await this.account(db,user,true);
      // Match admission locks this account before the clubhouse. Take the
      // foreign-key reference lock in that same order before changing owner_id.
      await db.query('SELECT id FROM skribbil.users WHERE id=$1 FOR KEY SHARE',[body.userId]);
      const {clubhouse:c,platformAdmin}=await this.access(db,account,clubhouseId,true);
      requireValue(platformAdmin||c.owner_id===account.id,'Only the owner or a platform administrator can transfer ownership.',403);
      requireValue(body.userId!==c.owner_id,'Choose another active member.');
      requireValue(await this.membership(db,clubhouseId,body.userId),'The new owner must be an active clubhouse member.',409);
      await db.query("UPDATE skribbil.clubhouse_members SET role='member' WHERE clubhouse_id=$1 AND role='owner'",[clubhouseId]);
      await db.query("UPDATE skribbil.clubhouse_members SET role='owner' WHERE clubhouse_id=$1 AND user_id=$2",[clubhouseId,body.userId]);
      await db.query('UPDATE skribbil.clubhouses SET owner_id=$2 WHERE id=$1',[clubhouseId,body.userId]);
      await db.query('UPDATE skribbil.clubhouse_invitations SET revoked_at=now() WHERE clubhouse_id=$1 AND inviter_id=$2 AND accepted_at IS NULL AND revoked_at IS NULL',[clubhouseId,c.owner_id]);
      await this.audit(db,account,'clubhouse.owner_transferred','clubhouse',clubhouseId,'Ownership transferred to an active clubhouse member.',{ownerId:c.owner_id},{ownerId:body.userId});
      return {clubhouseId,ownerId:body.userId};
    });
  }
}
