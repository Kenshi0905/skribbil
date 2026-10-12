import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { openDatabase } from '../server/db.mjs';
import { Platform } from '../server/platform.mjs';
import { Competition } from '../server/competition.mjs';

let db, service, admin, outsider;
const community='00000000-0000-4000-8000-000000000010';
const game='00000000-0000-4000-8000-000000000020';
const rules='00000000-0000-4000-8000-000000000031';
const league='00000000-0000-4000-8000-000000000040';
const reason='Verified community competition setup';
const one=async(sql,args=[]) => (await db.query(sql,args)).rows[0];
async function user() {
  const id=randomUUID();
  await db.query('INSERT INTO skribbil.users(id,username,display_name) VALUES($1,$2,$3)',[id,`u_${id.replaceAll('-','').slice(0,20)}`,`Player ${id.slice(0,6)}`]);
  await db.query('INSERT INTO skribbil.community_members(community_id,user_id) VALUES($1,$2)',[community,id]);
  return {id};
}
async function tournament(format='knockout',entryType='individual',extra={}) {
  return service.createTournament(admin,{communityId:community,gameId:game,ruleSetId:rules,name:`Cup ${randomUUID().slice(0,8)}`,
    format,entryType,maxEntries:32,registrationClosesAt:new Date(Date.now()+3600000).toISOString(),
    startsAt:new Date(Date.now()+7200000).toISOString(),reason,...extra});
}
async function entrants(t,n) {
  const result=[];
  for(let i=0;i<n;i++) {
    const p=await user();
    result.push(await one(`INSERT INTO skribbil.tournament_entries(tournament_id,community_id,entry_type,user_id,seed)
      VALUES($1,$2,'individual',$3,$4) RETURNING *`,[t.id,community,p.id,i+1]));
  }
  return result;
}
async function finish(t) {
  for(let limit=0;limit<128;limit++) {
    const state=await service.getTournament(t.id);
    const ready=state.fixtures.find(f=>!f.winner_entry_id&&f.entries.length===2);
    if(!ready)return state;
    await service.recordFixture(admin,ready.id,{winnerEntryId:ready.entries[0].entry_id,reason});
  }
  throw new Error('Bracket did not terminate');
}
before(async()=>{
  db=await openDatabase({url:null,dataDir:':memory:'});
  service=new Competition(new Platform(db));admin=await user();outsider=await user();
  await db.query("INSERT INTO skribbil.platform_roles(user_id,role) VALUES($1,'administrator')",[admin.id]);
});
after(async()=>{if(db)await db.close();});

test('competition mutations reject a regular user and suspended administrator',async()=>{
  await assert.rejects(service.generateFixtures(outsider,randomUUID(),{reason}),/Administrator/);
  await db.query("UPDATE skribbil.users SET status='suspended' WHERE id=$1",[admin.id]);
  await assert.rejects(service.generateFixtures(admin,randomUUID(),{reason}),/unavailable/);
  await db.query("UPDATE skribbil.users SET status='active' WHERE id=$1",[admin.id]);
});

test('five entrants produce a valid bracket with three byes and immutable recorded winners',async()=>{
  const t=await tournament();const entries=await entrants(t,5);
  const state=await service.generateFixtures(admin,t.id,{reason});
  assert.equal(state.fixtures.length,7);
  assert.equal(state.fixtures.filter(f=>f.winner_entry_id).length,3);
  const final=state.fixtures.find(f=>f.stage==='final');
  await assert.rejects(service.recordFixture(admin,final.id,{winnerEntryId:entries[0].id,reason}),/two fixture entrants/);
  const completed=await finish(t);
  assert.equal(completed.status,'completed');
  const decided=completed.fixtures.find(f=>f.stage==='final');
  await service.recordFixture(admin,decided.id,{winnerEntryId:decided.winner_entry_id,reason});
  const loser=decided.entries.find(e=>e.entry_id!==decided.winner_entry_id).entry_id;
  await assert.rejects(service.recordFixture(admin,decided.id,{winnerEntryId:loser,reason}),/cannot be overwritten/);
  assert.equal(Number((await one('SELECT count(*) AS n FROM skribbil.trophies WHERE tournament_id=$1',[t.id])).n),2);
  await assert.rejects(service.generateFixtures(admin,t.id,{reason}),/cannot be seeded/);
});

test('group stage qualifies its winners into a deterministic knockout final',async()=>{
  const t=await tournament('groups_knockout','individual',{groupCount:2,qualifiersPerGroup:1});
  await entrants(t,4);
  const groups=await service.generateFixtures(admin,t.id,{reason});
  assert.equal(groups.fixtures.length,2);
  await assert.rejects(service.generateFixtures(admin,t.id,{reason}),/Complete every group/);
  await finish(t);
  const bracket=await service.generateFixtures(admin,t.id,{reason,qualifiersPerGroup:2});
  // The attempted late change is ignored: creation policy, not submitted results, determines advancement.
  const final=bracket.fixtures.find(f=>f.stage==='final');
  assert.equal(final.entries.length,2);
  const groupWinners=bracket.fixtures.filter(f=>f.stage==='group').map(f=>f.winner_entry_id).sort();
  assert.deepEqual(final.entries.map(e=>e.entry_id).sort(),groupWinners);
  assert.equal((await finish(t)).status,'completed');
});

test('odd-sized round robin pairs every entrant exactly once and awards placements',async()=>{
  const t=await tournament('round_robin');await entrants(t,5);
  const state=await service.generateFixtures(admin,t.id,{reason});
  assert.equal(state.fixtures.length,10);
  const pairs=state.fixtures.map(f=>f.entries.map(e=>e.entry_id).sort().join(':'));
  assert.equal(new Set(pairs).size,10);
  assert.equal((await finish(t)).status,'completed');
  assert.equal(Number((await one('SELECT count(*) AS n FROM skribbil.trophies WHERE tournament_id=$1',[t.id])).n),3);
});

test('team registration freezes rosters, prevents duplicate players and awards roster trophies',async()=>{
  const t=await tournament('knockout','team');
  async function makeTeam(captain,other,tag) {
    const team=await one('INSERT INTO skribbil.teams(community_id,name,tag,captain_id) VALUES($1,$2,$3,$4) RETURNING *',[community,`Team ${randomUUID().slice(0,8)}`,tag,captain.id]);
    for(const p of [captain,other])await db.query('INSERT INTO skribbil.team_members(team_id,community_id,user_id) VALUES($1,$2,$3)',[team.id,community,p.id]);
    return team;
  }
  const a=await user(),b=await user(),c=await user(),d=await user();
  const first=await makeTeam(a,b,'TA'+randomUUID().slice(0,4));
  const second=await makeTeam(c,d,'TB'+randomUUID().slice(0,4));
  const duplicate=await makeTeam(c,b,'TC'+randomUUID().slice(0,4));
  const e=await service.registerTeam(a,t.id,first.id);
  assert.equal((await service.registerTeam(a,t.id,first.id)).id,e.id);
  await assert.rejects(service.registerTeam(c,t.id,duplicate.id),/another registered roster/);
  await service.registerTeam(c,t.id,second.id);
  await db.query('UPDATE skribbil.team_members SET left_at=now() WHERE team_id=$1 AND user_id=$2',[first.id,b.id]);
  await service.generateFixtures(admin,t.id,{reason});
  await finish(t);
  assert.equal(Number((await one('SELECT count(*) AS n FROM skribbil.trophies WHERE tournament_id=$1',[t.id])).n),6);
  assert.equal(Number((await one('SELECT count(*) AS n FROM skribbil.tournament_rosters WHERE entry_id=$1',[e.id])).n),2);
});

test('season activation prevents overlapping active seasons and closing preserves history',async()=>{
  async function makeSeason(){return service.createSeason(admin,{leagueId:league,name:`Season ${randomUUID().slice(0,8)}`,
    startsAt:new Date(Date.now()-3600000).toISOString(),endsAt:new Date(Date.now()+86400000).toISOString(),reason,
    games:[{gameId:game,ruleSetId:rules,scoringConfig:{method:'placement',points:{1:25,2:18},participation:5}}]});}
  const a=await makeSeason(),b=await makeSeason();
  assert.equal((await service.activateSeason(admin,a.id,{reason})).status,'active');
  await assert.rejects(service.activateSeason(admin,b.id,{reason}),/existing active season/);
  await service.closeSeason(admin,a.id,{reason});
  await service.activateSeason(admin,b.id,{reason});
  assert.equal((await one('SELECT status FROM skribbil.seasons WHERE id=$1',[a.id])).status,'closed');
  assert.equal(Number((await one("SELECT count(*) AS n FROM skribbil.admin_audit_log WHERE entity_id=$1 AND action LIKE 'season.%'",[a.id])).n),3);
});
