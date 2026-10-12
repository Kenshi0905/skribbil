import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { openDatabase } from '../server/db.mjs';
import { Platform } from '../server/platform.mjs';
import { Community } from '../server/community.mjs';

const communityId='00000000-0000-4000-8000-000000000010';
let db,community;
const one=async(sql,args=[]) => (await db.query(sql,args)).rows[0];
async function user(join=true){
  const id=randomUUID(),username=`u_${id.replaceAll('-','').slice(0,20)}`;
  await db.query('INSERT INTO skribbil.users(id,username,display_name) VALUES($1,$2,$2)',[id,username]);
  if(join)await db.query('INSERT INTO skribbil.community_members(community_id,user_id) VALUES($1,$2)',[communityId,id]);
  return{id,username};
}
async function team(captain){
  const id=randomUUID();
  await db.query('INSERT INTO skribbil.teams(id,community_id,name,tag,captain_id,logo_url) VALUES($1,$2,$3,$4,$5,$6)',[id,communityId,`Team ${id}`,id.slice(0,8),captain.id,'/api/media/example.png']);
  await addMember(id,captain,'captain');return{id};
}
async function addMember(teamId,member,role='member'){
  await db.query('INSERT INTO skribbil.team_members(team_id,community_id,user_id,role) VALUES($1,$2,$3,$4)',[teamId,communityId,member.id,role]);
}
async function invite(captain,t,member){return community.inviteTeam(captain,t.id,{username:member.username});}
async function match(participants,{complete=true}={}){
  const id=randomUUID(),resultId=randomUUID();
  await db.query(`INSERT INTO skribbil.matches(id,game_id,rule_set_id,community_id,engine_instance_id,engine_room_id,status)
    VALUES($1::uuid,'00000000-0000-4000-8000-000000000020','00000000-0000-4000-8000-000000000030',$2,'test',$1::text,$3)`,[id,communityId,complete?'completed':'running']);
  for(const p of participants)await db.query('INSERT INTO skribbil.match_players(match_id,user_id,engine_player_id,display_name_snapshot) VALUES($1,$2::uuid,$2::text,$3)',[id,p.id,p.username]);
  if(complete){
    await db.query(`INSERT INTO skribbil.match_results(id,match_id,version,source,engine_revision,payload_sha256,idempotency_key)
      VALUES($1::uuid,$2,1,'engine','test',$3,$1::text)`,[resultId,id,'0'.repeat(64)]);
    for(let i=0;i<participants.length;i++)await db.query('INSERT INTO skribbil.match_result_players(result_id,match_id,user_id,score,placement,won) VALUES($1,$2,$3,$4,$5,$6)',[resultId,id,participants[i].id,100-i*10,i+1,i===0]);
    await db.query('UPDATE skribbil.matches SET accepted_result_id=$2 WHERE id=$1',[id,resultId]);
  }
  return{id,resultId};
}
before(async()=>{db=await openDatabase({url:null,dataDir:':memory:'});community=new Community(new Platform(db));});
after(async()=>{if(db)await db.close();});

test('team invites require captain/officer authority and an eligible community account',async()=>{
  const captain=await user(),officer=await user(),member=await user(),outsider=await user(),unjoined=await user(false),target=await user(),t=await team(captain);
  await addMember(t.id,officer,'officer');await addMember(t.id,member);
  await assert.rejects(invite(member,t,target),/captain or an officer/);
  await assert.rejects(invite(outsider,t,target),/captain or an officer/);
  await assert.rejects(invite(captain,t,unjoined),/eligible account/);
  await assert.rejects(community.getTeam(unjoined,t.id),/Join this community/);
  const invitation=await invite(officer,t,target);
  const repeated=await community.inviteTeam(captain,t.id,{username:target.username.toUpperCase()});
  assert.equal(repeated.id,invitation.id);assert.equal(repeated.from,officer.username);
  assert.deepEqual(Object.keys(invitation).sort(),['expiresAt','from','id','teamId','teamName']);
  assert.equal((await community.getMyTeams(target)).invites.length,1);
  assert.equal((await community.getMyTeams(outsider)).invites.length,0);
  assert.equal((await community.getMyTeams(captain)).teams[0].logoUrl,'/api/media/example.png');
  const view=(await community.getTeam(captain,t.id)).team;
  assert.equal(view.myRole,'captain');assert.equal(view.logoUrl,'/api/media/example.png');
  assert.equal((await community.getTeam(outsider,t.id)).team.myRole,null);
  assert.equal(view.members.length,3);assert.ok(view.members.every(m=>!('email' in m)));
});

test('recipient-bound team acceptance is idempotent and cannot resurrect a left membership',async()=>{
  const captain=await user(),target=await user(),other=await user(),t=await team(captain),invitation=await invite(captain,t,target);
  await assert.rejects(community.acceptTeamInvite(other,invitation.id),/not addressed/);
  assert.deepEqual(await community.acceptTeamInvite(target,invitation.id),{teamId:t.id,accepted:true,alreadyAccepted:false});
  assert.equal((await community.acceptTeamInvite(target,invitation.id)).alreadyAccepted,true);
  assert.equal((await community.getTeam(target,t.id)).team.myRole,'member');
  assert.equal(Number((await one("SELECT count(*) AS n FROM skribbil.admin_audit_log WHERE action='team.joined' AND entity_id=$1",[t.id])).n),1);
  await community.leaveTeam(target,t.id);
  await community.acceptTeamInvite(target,invitation.id);
  assert.ok((await one('SELECT left_at FROM skribbil.team_members WHERE team_id=$1 AND user_id=$2',[t.id,target.id])).left_at);
  const renewed=await invite(captain,t,target);assert.notEqual(renewed.id,invitation.id);
  await community.acceptTeamInvite(target,renewed.id);
  assert.equal((await community.getTeam(target,t.id)).team.members.length,2);
});

test('captaincy transfers only to an active teammate and the final captain archives the team',async()=>{
  const captain=await user(),target=await user(),outsider=await user(),pending=await user(),t=await team(captain);
  await addMember(t.id,target);
  await assert.rejects(community.leaveTeam(captain,t.id),/Transfer captaincy/);
  await assert.rejects(community.transferCaptain(target,t.id,{userId:captain.id}),/current captain/);
  await assert.rejects(community.transferCaptain(captain,t.id,{userId:outsider.id}),/current teammate/);
  const invitation=await invite(captain,t,pending);
  assert.deepEqual(await community.transferCaptain(captain,t.id,{userId:target.id}),{teamId:t.id,captainId:target.id});
  assert.equal((await community.getTeam(captain,t.id)).team.myRole,'member');
  await assert.rejects(invite(captain,t,outsider),/captain or an officer/);
  await assert.rejects(community.acceptTeamInvite(pending,invitation.id),/expired or closed/);
  assert.deepEqual(await community.leaveTeam(captain,t.id),{left:true,archived:false});
  assert.deepEqual(await community.leaveTeam(target,t.id),{left:true,archived:true});
  assert.equal((await community.getMyTeams(target)).teams.length,0);
  assert.equal(Number((await one('SELECT count(*) AS n FROM skribbil.team_members WHERE team_id=$1',[t.id])).n),2);
  assert.equal((await community.getTeam(outsider,t.id)).team.archived,true);
});

test('expired invitations, lost officer authority and community bans cannot join',async()=>{
  const captain=await user(),officer=await user(),target=await user(),t=await team(captain);await addMember(t.id,officer,'officer');
  const old=await invite(officer,t,target);
  await db.query("UPDATE skribbil.team_invitations SET created_at=now()-interval '2 days',expires_at=now()-interval '1 day' WHERE id=$1",[old.id]);
  await assert.rejects(community.acceptTeamInvite(target,old.id),/expired/);
  const current=await invite(officer,t,target);assert.notEqual(current.id,old.id);
  await db.query("UPDATE skribbil.team_members SET role='member' WHERE team_id=$1 AND user_id=$2",[t.id,officer.id]);
  await assert.rejects(community.acceptTeamInvite(target,current.id),/no longer eligible/);
  const reissued=await invite(captain,t,target);assert.notEqual(reissued.id,current.id);
  assert.equal(reissued.from,captain.username);
  await assert.rejects(community.acceptTeamInvite(target,current.id),/expired or closed/);
  await db.query('INSERT INTO skribbil.moderation_bans(user_id,community_id,reason,issued_by) VALUES($1,$2,$3,$4)',[target.id,communityId,'Community test ban',captain.id]);
  await assert.rejects(community.acceptTeamInvite(target,reissued.id),/no longer eligible/);
});

test('competing accepts cannot exceed the 32-member team cap',async()=>{
  const captain=await user(),t=await team(captain);
  for(let i=0;i<30;i++)await addMember(t.id,await user());
  const a=await user(),b=await user(),ia=await invite(captain,t,a),ib=await invite(captain,t,b);
  const result=await Promise.allSettled([community.acceptTeamInvite(a,ia.id),community.acceptTeamInvite(b,ib.id)]);
  assert.equal(result.filter(r=>r.status==='fulfilled').length,1);
  assert.match(result.find(r=>r.status==='rejected').reason.message,/32 members/);
  assert.equal((await community.getTeam(captain,t.id)).team.members.length,32);
});

test('only actual participants can privately submit one open dispute per completed match',async()=>{
  const player=await user(),opponent=await user(),outsider=await user(),m=await match([player,opponent]);
  await assert.rejects(community.submitDispute(outsider,{matchId:m.id,reason:'My result looks wrong.'}),/Only a participant/);
  const reason='My final result needs a scoring review.';
  const {dispute}=await community.submitDispute(player,{matchId:m.id,reason});
  const repeat=await community.submitDispute(player,{matchId:m.id,reason:'A repeated submission is not a duplicate.'});
  assert.equal(repeat.dispute.id,dispute.id);assert.equal(repeat.dispute.reason,reason);assert.equal(dispute.status,'open');
  assert.equal((await community.getDisputes(player)).disputes.length,1);
  assert.equal((await community.getDisputes(opponent)).disputes.length,0);
  await assert.rejects(community.getDisputes(outsider,{admin:true}),/Administrator access/);
  const running=await match([player],{complete:false});
  await assert.rejects(community.submitDispute(player,{matchId:running.id,reason}),/completed match result/);
});

test('admin resolution is audited and immutable without silently changing match scores',async()=>{
  const admin=await user(),player=await user(),m=await match([player]);
  await db.query("INSERT INTO skribbil.platform_roles(user_id,role,granted_by) VALUES($1,'administrator',$1)",[admin.id]);
  const {dispute}=await community.submitDispute(player,{matchId:m.id,reason:'Please review the result of this match.'});
  const body={status:'resolved',resolution:'Reviewed the immutable event log; the recorded result is correct.'};
  await assert.rejects(community.resolveDispute(player,dispute.id,body),/Administrator access/);
  const report=(await community.getDisputes(admin,{admin:true})).disputes.find(d=>d.id===dispute.id);assert.equal(report.submittedBy.id,player.id);
  const resolved=(await community.resolveDispute(admin,dispute.id,body)).dispute;
  assert.equal(resolved.status,'resolved');assert.ok(resolved.resolvedAt);
  await community.resolveDispute(admin,dispute.id,body);
  await assert.rejects(community.resolveDispute(admin,dispute.id,{status:'rejected',resolution:'A different resolution is not allowed.'}),/cannot be overwritten/);
  assert.equal(Number((await one("SELECT count(*) AS n FROM skribbil.admin_audit_log WHERE action='dispute.resolved' AND entity_id=$1",[dispute.id])).n),1);
  assert.equal((await one('SELECT accepted_result_id FROM skribbil.matches WHERE id=$1',[m.id])).accepted_result_id,m.resultId);
  assert.equal((await one('SELECT score FROM skribbil.match_result_players WHERE result_id=$1',[m.resultId])).score,100);
  await db.query("UPDATE skribbil.users SET status='suspended' WHERE id=$1",[admin.id]);
  await assert.rejects(community.getDisputes(admin,{admin:true}),/Account unavailable/);
});
