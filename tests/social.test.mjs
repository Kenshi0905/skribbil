import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { openDatabase } from '../server/db.mjs';
import { Platform } from '../server/platform.mjs';
import { Social } from '../server/social.mjs';

let db,social;
const one=async(sql,args=[]) => (await db.query(sql,args)).rows[0];
async function user(){const id=randomUUID(),username=`u_${id.replaceAll('-','').slice(0,20)}`;
  await db.query('INSERT INTO skribbil.users(id,username,display_name) VALUES($1,$2,$3)',[id,username,username]);return{id,username};}
async function friends(a,b){const pair=[a.id,b.id].sort();await db.query("INSERT INTO skribbil.friendships(user_low,user_high,requested_by,status) VALUES($1,$2,$3,'accepted')",[...pair,a.id]);}
async function join(leader,party,target){await friends(leader,target);const invitation=await social.invite(leader,party.id,{username:target.username});await social.acceptInvite(target,invitation.id);return invitation;}
before(async()=>{db=await openDatabase({url:null,dataDir:':memory:'});social=new Social(new Platform(db));});
after(async()=>{if(db)await db.close();});

test('only the party leader can invite an accepted friend',async()=>{
  const leader=await user(),member=await user(),outsider=await user(),target=await user();
  const {party}=await social.createParty(leader);await join(leader,party,member);
  await assert.rejects(social.invite(outsider,party.id,{username:target.username}),/party leader/);
  await assert.rejects(social.invite(member,party.id,{username:target.username}),/party leader/);
  await assert.rejects(social.invite(leader,party.id,{username:target.username}),/accepted friends/);
  assert.equal((await social.createParty(leader)).party.id,party.id);
  assert.equal((await social.createParty(member)).party.id,party.id);
});

test('invites are recipient-bound, private and idempotent',async()=>{
  const leader=await user(),target=await user(),unrelated=await user();await friends(leader,target);
  const {party}=await social.createParty(leader);
  const invitation=await social.invite(leader,party.id,{username:target.username.toUpperCase()});
  assert.equal((await social.invite(leader,party.id,{username:target.username})).id,invitation.id);
  assert.deepEqual(Object.keys(invitation).sort(),['expiresAt','from','id','partyId']);
  assert.equal((await social.getParty(target)).invites.length,1);
  assert.equal((await social.getParty(unrelated)).invites.length,0);
  await assert.rejects(social.acceptInvite(unrelated,invitation.id),/not addressed/);
  const accepted=await social.acceptInvite(target,invitation.id);
  assert.equal(accepted.party.members.length,2);assert.equal(accepted.invites.length,0);
  assert.equal((await social.acceptInvite(target,invitation.id)).party.members.length,2);
  assert.equal((await one('SELECT token_hash FROM skribbil.party_invites WHERE id=$1',[invitation.id])).token_hash.length,64);
});

test('an expired or no-longer-friend invitation cannot join a party',async()=>{
  const leader=await user(),target=await user();await friends(leader,target);
  const {party}=await social.createParty(leader);const invitation=await social.invite(leader,party.id,{username:target.username});
  await db.query("UPDATE skribbil.party_invites SET created_at=now()-interval '2 days',expires_at=now()-interval '1 day' WHERE id=$1",[invitation.id]);
  await assert.rejects(social.acceptInvite(target,invitation.id),/expired/);
  const current=await social.invite(leader,party.id,{username:target.username});
  assert.notEqual(current.id,invitation.id);
  await db.query("UPDATE skribbil.friendships SET status='blocked' WHERE user_low=$1 AND user_high=$2",[leader.id,target.id].sort());
  assert.equal((await social.getParty(target)).invites.length,0);
  await assert.rejects(social.acceptInvite(target,current.id),/friendship/);
});

test('competing accepts for the last slot cannot exceed eight party members',async()=>{
  const leader=await user(),{party}=await social.createParty(leader);
  for(let i=0;i<6;i++)await join(leader,party,await user());
  const a=await user(),b=await user();await friends(leader,a);await friends(leader,b);
  const ia=await social.invite(leader,party.id,{username:a.username});const ib=await social.invite(leader,party.id,{username:b.username});
  const results=await Promise.allSettled([social.acceptInvite(a,ia.id),social.acceptInvite(b,ib.id)]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
  assert.match(results.find(r=>r.status==='rejected').reason.message,/full/);
  assert.equal((await social.getParty(leader)).party.members.length,8);
});

test('one account cannot join two parties and a consumed invite does not rejoin after leaving',async()=>{
  const a=await user(),b=await user(),target=await user();await friends(a,target);await friends(b,target);
  const pa=(await social.createParty(a)).party,pb=(await social.createParty(b)).party;
  const ia=await social.invite(a,pa.id,{username:target.username}),ib=await social.invite(b,pb.id,{username:target.username});
  await social.acceptInvite(target,ia.id);
  await assert.rejects(social.acceptInvite(target,ib.id),/Leave your current party/);
  assert.equal((await social.leaveParty(target)).party,null);
  assert.equal((await social.acceptInvite(target,ia.id)).party,null);
  assert.equal((await social.acceptInvite(target,ib.id)).party.id,pb.id);
});

test('leader leaving closes the party, releases every member and revokes invitations',async()=>{
  const leader=await user(),member=await user(),pending=await user();const {party}=await social.createParty(leader);
  await join(leader,party,member);await friends(leader,pending);
  const invitation=await social.invite(leader,party.id,{username:pending.username});
  assert.equal((await social.leaveParty(leader)).party,null);
  assert.equal((await social.getParty(member)).party,null);
  assert.equal((await social.getParty(pending)).invites.length,0);
  await assert.rejects(social.acceptInvite(pending,invitation.id),/closed/);
  assert.ok((await one('SELECT closed_at FROM skribbil.parties WHERE id=$1',[party.id])).closed_at);
  assert.equal(Number((await one('SELECT count(*) AS n FROM skribbil.party_members WHERE party_id=$1 AND left_at IS NULL',[party.id])).n),0);
  const next=await social.createParty(member);assert.equal(next.party.leaderId,member.id);assert.notEqual(next.party.id,party.id);
});
