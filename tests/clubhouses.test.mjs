import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { openDatabase } from '../server/db.mjs';
import { Platform } from '../server/platform.mjs';
import { Clubhouses } from '../server/clubhouses.mjs';

let db,clubhouses;
const one=async(sql,args=[]) => (await db.query(sql,args)).rows[0];
async function user({admin=false}={}){
  const id=randomUUID(),username=`u_${id.replaceAll('-','').slice(0,20)}`;
  await db.query('INSERT INTO skribbil.users(id,username,display_name) VALUES($1,$2,$2)',[id,username]);
  if(admin)await db.query("INSERT INTO skribbil.platform_roles(user_id,role,granted_by) VALUES($1,'administrator',$1)",[id]);
  return{id,username};
}
const data=()=>({name:`Test Club ${randomUUID().slice(0,8)}`,description:'A synthetic invite-only test group.'});
async function create(owner,admin){return(await clubhouses.create(admin??await user({admin:true}),{...data(),ownerId:owner.id})).clubhouse;}
async function join(owner,club,member){
  const invitation=await clubhouses.invite(owner,club.id,{username:member.username});
  await clubhouses.acceptInvite(member,invitation.id);return invitation;
}
before(async()=>{db=await openDatabase({url:null,dataDir:':memory:'});clubhouses=new Clubhouses(new Platform(db));});
after(async()=>{if(db)await db.close();});

test('ordinary accounts request approval instead of creating arbitrary clubhouses',async()=>{
  const requester=await user(),unrelated=await user(),admin=await user({admin:true}),body=data();
  await assert.rejects(clubhouses.create(requester,body),/Administrator access/);
  const requested=await Promise.all([clubhouses.request(requester,body),clubhouses.request(requester,body)]);
  assert.equal(requested[0].request.id,requested[1].request.id);assert.equal(requested[0].request.status,'pending');
  await assert.rejects(clubhouses.request(requester,data()),/already have a pending/);
  assert.equal((await clubhouses.list(requester)).requests.length,1);
  assert.equal((await clubhouses.list(unrelated)).requests.length,0);
  assert.equal((await clubhouses.list(requester)).clubhouses.length,0);
  await assert.rejects(clubhouses.listRequests(requester),/Administrator access/);
  assert.equal((await clubhouses.listRequests(admin)).requests.find(r=>r.id===requested[0].request.id).requester.id,requester.id);
});

test('concurrent approvals create exactly one clubhouse owned by the requester and preserve immutable decisions',async()=>{
  const requester=await user(),a=await user({admin:true}),b=await user({admin:true});
  const {request}=await clubhouses.request(requester,data());
  const decision={status:'approved',reason:'Approved for this synthetic friend group.'};
  const approvals=await Promise.all([clubhouses.decideRequest(a,request.id,decision),clubhouses.decideRequest(b,request.id,decision)]);
  assert.equal(approvals[0].clubhouseId,approvals[1].clubhouseId);
  const club=(await clubhouses.detail(requester,approvals[0].clubhouseId)).clubhouse;
  assert.equal(club.ownerId,requester.id);assert.equal(club.myRole,'owner');assert.deepEqual(club.members.map(m=>m.id),[requester.id]);
  assert.equal((await clubhouses.list(requester)).clubhouses.length,1);
  assert.equal(Number((await one("SELECT count(*) AS n FROM skribbil.admin_audit_log WHERE entity_id=$1 AND action='clubhouse.request_decided'",[request.id])).n),1);
  await assert.rejects(clubhouses.decideRequest(a,request.id,{status:'rejected',reason:'A different decision after approval.'}),/immutable decision/);
  await assert.rejects(db.query('UPDATE skribbil.clubhouse_requests SET decision_reason=$2 WHERE id=$1',[request.id,'Tampering with a completed decision']),/immutable/);
  await assert.rejects(db.query('DELETE FROM skribbil.clubhouse_requests WHERE id=$1',[request.id]),/retained for audit/);
  await assert.rejects(clubhouses.requireMember(a,club.id),/only to current clubhouse members/);
  assert.equal((await clubhouses.detail(a,club.id)).clubhouse.myRole,null);
});

test('rejection creates no clubhouse and suspended owners cannot be approved',async()=>{
  const requester=await user(),admin=await user({admin:true});
  const {request}=await clubhouses.request(requester,data());
  const decision={status:'rejected',reason:'The request lacks the required group context.'};
  const rejected=await clubhouses.decideRequest(admin,request.id,decision);
  assert.equal(rejected.clubhouseId,null);assert.equal(rejected.request.status,'rejected');
  assert.equal((await clubhouses.list(requester)).clubhouses.length,0);
  const next=(await clubhouses.request(requester,data())).request;
  await db.query("UPDATE skribbil.users SET status='suspended' WHERE id=$1",[requester.id]);
  await assert.rejects(clubhouses.decideRequest(admin,next.id,{status:'approved',reason:'A valid reason for approval.'}),/active clubhouse owner/);
  assert.equal((await one('SELECT status FROM skribbil.clubhouse_requests WHERE id=$1',[next.id])).status,'pending');
  await assert.rejects(clubhouses.request(requester,data()),/Account unavailable/);
});

test('clubhouse details and invitations are private, recipient-bound and idempotent',async()=>{
  const owner=await user(),target=await user(),outsider=await user(),club=await create(owner);
  await assert.rejects(clubhouses.detail(outsider,club.id),/Clubhouse not found/);
  const invitation=await clubhouses.invite(owner,club.id,{username:target.username.toUpperCase()});
  assert.deepEqual(Object.keys(invitation).sort(),['clubhouseId','clubhouseName','expiresAt','from','id']);
  assert.equal((await clubhouses.invite(owner,club.id,{username:target.username})).id,invitation.id);
  assert.equal((await clubhouses.list(target)).invites.length,1);
  assert.equal((await clubhouses.list(outsider)).invites.length,0);
  await assert.rejects(clubhouses.detail(target,club.id),/Clubhouse not found/);
  await assert.rejects(clubhouses.acceptInvite(outsider,invitation.id),/not addressed/);
  assert.equal((await clubhouses.acceptInvite(target,invitation.id)).alreadyAccepted,false);
  assert.equal((await clubhouses.acceptInvite(target,invitation.id)).alreadyAccepted,true);
  assert.equal((await clubhouses.list(target)).invites.length,0);
  const detail=(await clubhouses.detail(target,club.id)).clubhouse;
  assert.equal(detail.myRole,'member');assert.equal(detail.memberCount,2);
  assert.ok(detail.members.every(m=>!('email' in m)&&!('password' in m)));
  assert.equal(await clubhouses.requireMember(target,club.id),true);
  assert.equal(Number((await one("SELECT count(*) AS n FROM skribbil.admin_audit_log WHERE entity_id=$1 AND action='clubhouse.joined'",[club.id])).n),1);
});

test('clubhouse admins manage ordinary members without escalating their own authority',async()=>{
  const owner=await user(),manager=await user(),peerAdmin=await user(),member=await user(),target=await user(),club=await create(owner);
  await join(owner,club,manager);await join(owner,club,peerAdmin);await join(owner,club,member);
  await assert.rejects(clubhouses.invite(member,club.id,{username:target.username}),/owners or admins/);
  await clubhouses.setRole(owner,club.id,{userId:manager.id,role:'admin'});
  await clubhouses.setRole(owner,club.id,{userId:peerAdmin.id,role:'admin'});
  await assert.rejects(clubhouses.setRole(manager,club.id,{userId:member.id,role:'admin'}),/owner or a platform administrator/);
  await assert.rejects(clubhouses.transferOwner(manager,club.id,{userId:manager.id}),/owner or a platform administrator/);
  await assert.rejects(clubhouses.removeMember(manager,club.id,owner.id),/Transfer ownership/);
  await assert.rejects(clubhouses.removeMember(manager,club.id,peerAdmin.id),/ordinary members only/);
  await assert.rejects(clubhouses.removeMember(member,club.id,manager.id),/owners or admins/);
  await join(manager,club,target);
  const removed=await clubhouses.removeMember(manager,club.id,member.id);
  assert.deepEqual(removed,{removed:true,clubhouseId:club.id,userId:member.id});
  await assert.rejects(clubhouses.requireMember(member,club.id),/only to current clubhouse members/);
  await assert.rejects(clubhouses.detail(member,club.id),/Clubhouse not found/);
  assert.equal((await clubhouses.list(member)).clubhouses.length,0);
  const outsider=await user(),otherClub=await create(outsider);
  await assert.rejects(clubhouses.setRole(owner,otherClub.id,{userId:outsider.id,role:'admin'}),/Clubhouse not found/);
});

test('expiration or manager demotion revokes invite authority without creating memberships',async()=>{
  const owner=await user(),manager=await user(),target=await user(),club=await create(owner);
  await join(owner,club,manager);await clubhouses.setRole(owner,club.id,{userId:manager.id,role:'admin'});
  const old=await clubhouses.invite(manager,club.id,{username:target.username});
  await db.query("UPDATE skribbil.clubhouse_invitations SET created_at=now()-interval '2 days',expires_at=now()-interval '1 day' WHERE id=$1",[old.id]);
  await assert.rejects(clubhouses.acceptInvite(target,old.id),/expired or closed/);
  const current=await clubhouses.invite(manager,club.id,{username:target.username});assert.notEqual(current.id,old.id);
  await clubhouses.setRole(owner,club.id,{userId:manager.id,role:'member'});
  assert.equal((await clubhouses.list(target)).invites.length,0);
  await assert.rejects(clubhouses.acceptInvite(target,current.id),/expired or closed/);
  const fresh=await clubhouses.invite(owner,club.id,{username:target.username});
  await clubhouses.acceptInvite(target,fresh.id);
  assert.equal((await clubhouses.detail(target,club.id)).clubhouse.myRole,'member');
});

test('concurrent accepts serialize the last membership slot',async()=>{
  const owner=await user(),club=await create(owner);
  for(let i=0;i<62;i++){
    const member=await user();
    await db.query('INSERT INTO skribbil.clubhouse_members(clubhouse_id,user_id) VALUES($1,$2)',[club.id,member.id]);
  }
  const a=await user(),b=await user();
  const ia=await clubhouses.invite(owner,club.id,{username:a.username}),ib=await clubhouses.invite(owner,club.id,{username:b.username});
  const outcomes=await Promise.allSettled([clubhouses.acceptInvite(a,ia.id),clubhouses.acceptInvite(b,ib.id)]);
  assert.equal(outcomes.filter(r=>r.status==='fulfilled').length,1);
  assert.match(outcomes.find(r=>r.status==='rejected').reason.message,/64 members/);
  assert.equal((await clubhouses.detail(owner,club.id)).clubhouse.memberCount,64);
});

test('leaving or removal cannot reuse an accepted invite, and owner transfer precedes archive',async()=>{
  const owner=await user(),member=await user(),pending=await user(),club=await create(owner);
  const invitation=await join(owner,club,member);
  await assert.rejects(clubhouses.leave(owner,club.id),/Transfer ownership/);
  await clubhouses.leave(member,club.id);
  await clubhouses.acceptInvite(member,invitation.id);
  await assert.rejects(clubhouses.requireMember(member,club.id),/only to current clubhouse members/);
  const renewed=await join(owner,club,member);assert.notEqual(renewed.id,invitation.id);
  await clubhouses.removeMember(owner,club.id,member.id);
  await clubhouses.acceptInvite(member,renewed.id);
  await assert.rejects(clubhouses.requireMember(member,club.id),/only to current clubhouse members/);
  await join(owner,club,member);
  const unused=await clubhouses.invite(owner,club.id,{username:pending.username});
  await clubhouses.transferOwner(owner,club.id,{userId:member.id});
  assert.equal((await clubhouses.detail(member,club.id)).clubhouse.myRole,'owner');
  assert.equal((await clubhouses.detail(owner,club.id)).clubhouse.myRole,'member');
  await clubhouses.leave(owner,club.id);
  const left=await clubhouses.leave(member,club.id);assert.equal(left.archived,true);
  await assert.rejects(clubhouses.acceptInvite(pending,unused.id),/expired or closed/);
  await assert.rejects(clubhouses.requireMember(member,club.id),/only to current clubhouse members/);
  assert.equal((await clubhouses.list(member)).clubhouses.length,0);
  assert.equal(Number((await one('SELECT count(*) AS n FROM skribbil.clubhouse_members WHERE clubhouse_id=$1',[club.id])).n),2);
});

test('clubhouse room metadata stays private and independent from the global league',async()=>{
  const owner=await user(),admin=await user({admin:true}),club=await create(owner,admin),matchId=randomUUID(),code=randomUUID();
  await assert.rejects(clubhouses.requireMember(admin,club.id),/only to current clubhouse members/);
  await db.query(`INSERT INTO skribbil.matches(id,game_id,rule_set_id,mode,private,engine_instance_id,engine_room_id,clubhouse_id,created_by)
    VALUES($1,'00000000-0000-4000-8000-000000000020','00000000-0000-4000-8000-000000000030','casual',true,'test',$2,$3,$4)`,[matchId,code,club.id,owner.id]);
  await db.query('INSERT INTO skribbil.match_players(match_id,user_id,engine_player_id,display_name_snapshot) VALUES($1,$2,$3,$4)',[matchId,owner.id,randomUUID(),owner.username]);
  assert.deepEqual((await clubhouses.detail(owner,club.id)).clubhouse.rooms,[{id:matchId,code,mode:'casual',status:'lobby',players:1,owner:true}]);
  assert.deepEqual((await clubhouses.detail(admin,club.id)).clubhouse.rooms,[]);
  const saved=await one('SELECT clubhouse_id,community_id,season_id FROM skribbil.matches WHERE id=$1',[matchId]);
  assert.equal(saved.clubhouse_id,club.id);assert.equal(saved.community_id,null);assert.equal(saved.season_id,null);
  await assert.rejects(db.query('UPDATE skribbil.matches SET private=false WHERE id=$1',[matchId]),/clubhouse_rooms_private/);
  await assert.rejects(db.query("UPDATE skribbil.matches SET mode='ranked',rule_set_id='00000000-0000-4000-8000-000000000031' WHERE id=$1",[matchId]),/clubhouse_rooms_private/);
  await db.transaction(async tx=>{assert.equal(await clubhouses.requireMember(owner,club.id,tx),true);});
  await db.query("UPDATE skribbil.matches SET status='completed' WHERE id=$1",[matchId]);
  assert.deepEqual((await clubhouses.detail(owner,club.id)).clubhouse.rooms,[]);
});
