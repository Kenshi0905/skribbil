import { randomUUID } from 'node:crypto';
import { requireValue, textField, isUuid } from './security.mjs';

const one = async (db, sql, values = []) => (await db.query(sql, values)).rows[0];
const rows = async (db, sql, values = []) => (await db.query(sql, values)).rows;
const validId = (value, label = 'identifier') => requireValue(isUuid(value), `Invalid ${label}.`);
const reasonFor = body => textField(body.reason, 3, 1000, 'Reason');
const dateFor = (value, label) => {
  const date = new Date(value);
  requireValue(value && Number.isFinite(date.valueOf()), `Invalid ${label}.`);
  return date.toISOString();
};

// Shared competition service. HTTP routing and session resolution belong to the caller.
export class Competition {
  constructor(platform) { this.platform = platform; this.db = platform.db; }
  async admin(user) {
    requireValue(user?.id, 'Sign in first.', 401);
    await this.platform.admin(user);
    requireValue(await one(this.db, "SELECT id FROM skribbil.users WHERE id=$1 AND status='active'", [user.id]), 'Account unavailable.', 403);
  }
  audit(db, user, action, type, id, reason, before, after) {
    return this.platform.audit(db, user, action, type, id, reason, before, after);
  }

  async createLeague(user, body) {
    await this.admin(user);
    const name = textField(body.name, 3, 80, 'League name'), reason = reasonFor(body);
    return this.db.transaction(async db => {
      const context = await this.platform.context(db);
      const league = await one(db, `INSERT INTO skribbil.leagues(community_id,name,slug)
        VALUES($1,$2,$3) RETURNING *`, [context.community_id,name,`league-${randomUUID()}`]);
      await this.audit(db,user,'league.created','league',league.id,reason,null,league);
      return league;
    });
  }

  async createSeason(user, body) {
    await this.admin(user);
    validId(body.leagueId, 'league');
    const name = textField(body.name, 3, 80, 'Season name'), reason = reasonFor(body);
    const starts = dateFor(body.startsAt, 'start date'), ends = dateFor(body.endsAt, 'end date');
    requireValue(ends > starts, 'The season must end after it starts.');
    requireValue(Array.isArray(body.games) && body.games.length > 0 && body.games.length <= 20, 'Choose 1–20 game modules.');
    return this.db.transaction(async db => {
      const league = await one(db, 'SELECT * FROM skribbil.leagues WHERE id=$1 FOR UPDATE', [body.leagueId]);
      requireValue(league, 'League not found.', 404);
      const seen = new Set();
      for (const game of body.games) {
        validId(game.gameId, 'game'); validId(game.ruleSetId, 'rule set');
        requireValue(!seen.has(game.gameId), 'A game can only appear once.'); seen.add(game.gameId);
        requireValue(await one(db, 'SELECT id FROM skribbil.rule_sets WHERE id=$1 AND game_id=$2 AND competitive', [game.ruleSetId, game.gameId]), 'Choose competitive rules for each game.');
        const config = game.scoringConfig;
        requireValue(config && config.method === 'placement' && config.points && typeof config.points === 'object' && !Array.isArray(config.points), 'Use a placement scoring configuration.');
        requireValue(Object.entries(config.points).length <= 128 && Object.entries(config.points).every(([k,v]) => /^[1-9][0-9]*$/.test(k) && Number.isInteger(v) && v >= 0 && v <= 100000), 'Placement points must be nonnegative integers.');
        requireValue(Number.isInteger(config.participation) && config.participation >= 0 && config.participation <= 100000, 'Choose nonnegative participation points.');
      }
      const season = await one(db, `INSERT INTO skribbil.seasons(league_id,community_id,name,starts_at,ends_at,status)
        VALUES($1,$2,$3,$4,$5,'scheduled') RETURNING *`, [league.id, league.community_id, name, starts, ends]);
      for (const game of body.games) await db.query(`INSERT INTO skribbil.season_games(season_id,game_id,rule_set_id,scoring_version,scoring_config)
        VALUES($1,$2,$3,1,$4)`, [season.id,game.gameId,game.ruleSetId,JSON.stringify(game.scoringConfig)]);
      await this.audit(db,user,'season.created','season',season.id,reason,null,season);
      return season;
    });
  }

  async activateSeason(user, id, body) {
    await this.admin(user); validId(id, 'season'); const reason = reasonFor(body);
    return this.db.transaction(async db => {
      const existing = await one(db, 'SELECT * FROM skribbil.seasons WHERE id=$1', [id]);
      requireValue(existing, 'Season not found.', 404);
      await db.query('SELECT id FROM skribbil.leagues WHERE id=$1 FOR UPDATE', [existing.league_id]);
      const season = await one(db, 'SELECT * FROM skribbil.seasons WHERE id=$1 FOR UPDATE', [id]);
      if (season.status === 'active') return season;
      requireValue(season.status === 'scheduled', 'Only scheduled seasons can be activated.', 409);
      requireValue(new Date(season.starts_at) <= new Date() && new Date(season.ends_at) > new Date(), 'Activation must fall within the season dates.', 409);
      requireValue(!await one(db, "SELECT id FROM skribbil.seasons WHERE league_id=$1 AND status='active'", [season.league_id]), 'Close the existing active season first.', 409);
      const updated = await one(db, "UPDATE skribbil.seasons SET status='active' WHERE id=$1 RETURNING *", [id]);
      await this.audit(db,user,'season.activated','season',id,reason,season,updated); return updated;
    });
  }

  async closeSeason(user, id, body) {
    await this.admin(user); validId(id, 'season'); const reason = reasonFor(body);
    return this.db.transaction(async db => {
      const season = await one(db, 'SELECT * FROM skribbil.seasons WHERE id=$1 FOR UPDATE', [id]);
      requireValue(season && season.status === 'active', 'Only active seasons can be closed.', 409);
      requireValue(!await one(db, "SELECT id FROM skribbil.matches WHERE season_id=$1 AND status IN ('lobby','running') LIMIT 1", [id]), 'Finish or cancel the season\'s live matches first.', 409);
      const updated = await one(db, "UPDATE skribbil.seasons SET status='closed' WHERE id=$1 RETURNING *", [id]);
      await this.audit(db,user,'season.closed','season',id,reason,season,updated); return updated;
    });
  }

  async createTournament(user, body) {
    await this.admin(user);
    for (const [value,label] of [[body.communityId,'community'],[body.gameId,'game'],[body.ruleSetId,'rule set']]) validId(value,label);
    if (body.seasonId) validId(body.seasonId,'season');
    const name = textField(body.name,3,80,'Tournament name'), reason = reasonFor(body);
    requireValue(['knockout','round_robin','groups_knockout'].includes(body.format), 'Unsupported tournament format.');
    requireValue(['individual','team'].includes(body.entryType), 'Choose individual or team entries.');
    requireValue(Number.isInteger(body.maxEntries) && body.maxEntries >= 2 && body.maxEntries <= 128, 'Choose 2–128 entries.');
    const closes = dateFor(body.registrationClosesAt,'registration deadline'), starts = dateFor(body.startsAt,'start date');
    requireValue(new Date(closes) > new Date() && starts >= closes, 'Registration must close in the future and before the start.');
    const groupCount = body.format === 'round_robin' ? 1 : (body.groupCount ?? 2);
    const qualifiersPerGroup = body.qualifiersPerGroup ?? 2;
    requireValue(Number.isInteger(groupCount) && groupCount >= 1 && groupCount <= 16, 'Choose 1–16 groups.');
    requireValue(Number.isInteger(qualifiersPerGroup) && qualifiersPerGroup >= 1 && qualifiersPerGroup <= 8, 'Choose 1–8 qualifiers per group.');
    return this.db.transaction(async db => {
      requireValue(await one(db,'SELECT id FROM skribbil.rule_sets WHERE id=$1 AND game_id=$2 AND competitive',[body.ruleSetId,body.gameId]),'A tournament requires competitive rules.');
      if (body.seasonId) requireValue(await one(db,`SELECT s.id FROM skribbil.seasons s JOIN skribbil.season_games g ON g.season_id=s.id
        WHERE s.id=$1 AND s.community_id=$2 AND g.game_id=$3 AND g.rule_set_id=$4 AND s.status IN ('scheduled','active')`,[body.seasonId,body.communityId,body.gameId,body.ruleSetId]),'The season and its game rules must match.');
      const tournament = await one(db,`INSERT INTO skribbil.tournaments(community_id,season_id,game_id,rule_set_id,name,format,entry_type,maximum_entries,registration_closes_at,starts_at)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,[body.communityId,body.seasonId||null,body.gameId,body.ruleSetId,name,body.format,body.entryType,body.maxEntries,closes,starts]);
      // The immutable audit stores the announced group format before any result.
      await this.audit(db,user,'tournament.created','tournament',tournament.id,reason,null,{...tournament,groupCount,qualifiersPerGroup});
      return {...tournament,groupCount,qualifiersPerGroup};
    });
  }

  async registerTeam(user, tournamentId, teamId) {
    requireValue(user?.id,'Sign in first.',401); validId(tournamentId,'tournament');validId(teamId,'team');
    return this.db.transaction(async db => {
      const t = await one(db,'SELECT * FROM skribbil.tournaments WHERE id=$1 FOR UPDATE',[tournamentId]);
      requireValue(t && t.entry_type==='team' && t.status==='registration' && new Date(t.registration_closes_at)>new Date(),'Team registration is closed.',409);
      const team = await one(db,'SELECT * FROM skribbil.teams WHERE id=$1 AND community_id=$2 AND captain_id=$3 AND archived_at IS NULL',[teamId,t.community_id,user.id]);
      requireValue(team,'Only this community team\'s captain can register.',403);
      const existing = await one(db,'SELECT * FROM skribbil.tournament_entries WHERE tournament_id=$1 AND team_id=$2',[t.id,team.id]);
      if (existing) return existing;
      const count = await one(db,"SELECT count(*)::int AS n FROM skribbil.tournament_entries WHERE tournament_id=$1 AND status IN ('registered','checked_in')",[t.id]);
      requireValue(count.n<t.maximum_entries,'Tournament is full.',409);
      const members = await rows(db,`SELECT m.user_id FROM skribbil.team_members m JOIN skribbil.users u ON u.id=m.user_id
        JOIN skribbil.community_members c ON c.community_id=m.community_id AND c.user_id=m.user_id
        WHERE m.team_id=$1 AND m.left_at IS NULL AND u.status='active' AND c.status='active'
        AND NOT EXISTS(SELECT 1 FROM skribbil.moderation_bans b WHERE b.user_id=m.user_id AND b.revoked_at IS NULL AND b.starts_at<=now() AND (b.ends_at IS NULL OR b.ends_at>now())
          AND (b.community_id IS NULL OR b.community_id=$2) AND (b.game_id IS NULL OR b.game_id=$3))
        ORDER BY m.user_id`,[team.id,t.community_id,t.game_id]);
      const total = await one(db,'SELECT count(*)::int AS n FROM skribbil.team_members WHERE team_id=$1 AND left_at IS NULL',[team.id]);
      requireValue(members.length>=2 && members.length===total.n && members.some(m=>m.user_id===user.id),'All roster members must be eligible; at least two including the captain are required.',409);
      requireValue(!await one(db,`SELECT r.user_id FROM skribbil.tournament_rosters r JOIN skribbil.tournament_entries e ON e.id=r.entry_id
        WHERE e.tournament_id=$1 AND e.status IN ('registered','checked_in') AND r.user_id=ANY($2::uuid[]) LIMIT 1`,[t.id,members.map(m=>m.user_id)]),'A player is already on another registered roster.',409);
      const entry = await one(db,`INSERT INTO skribbil.tournament_entries(tournament_id,community_id,entry_type,team_id)
        VALUES($1,$2,'team',$3) RETURNING *`,[t.id,t.community_id,team.id]);
      for (const member of members) await db.query('INSERT INTO skribbil.tournament_rosters(entry_id,user_id,captain) VALUES($1,$2,$3)',[entry.id,member.user_id,member.user_id===user.id]);
      return entry;
    });
  }

  async getTournament(id) {
    validId(id,'tournament');
    const tournament = await one(this.db,'SELECT * FROM skribbil.tournaments WHERE id=$1',[id]);
    requireValue(tournament,'Tournament not found.',404);
    const entries = await rows(this.db,`SELECT e.*,coalesce(u.display_name,t.name) AS name FROM skribbil.tournament_entries e
      LEFT JOIN skribbil.users u ON u.id=e.user_id LEFT JOIN skribbil.teams t ON t.id=e.team_id
      WHERE e.tournament_id=$1 ORDER BY e.seed NULLS LAST,e.registered_at,e.id`,[id]);
    const fixtures = await rows(this.db,'SELECT * FROM skribbil.tournament_fixtures WHERE tournament_id=$1 ORDER BY stage,group_label,round_number,position',[id]);
    const slots = await rows(this.db,'SELECT * FROM skribbil.tournament_fixture_entries WHERE tournament_id=$1 ORDER BY fixture_id,slot',[id]);
    return {...tournament,entries,fixtures:fixtures.map(f=>({...f,entries:slots.filter(s=>s.fixture_id===f.id)}))};
  }

  async generateFixtures(user,id,body) {
    await this.admin(user);validId(id,'tournament');const reason=reasonFor(body);
    await this.db.transaction(async db=>{
      const t=await one(db,'SELECT * FROM skribbil.tournaments WHERE id=$1 FOR UPDATE',[id]);
      requireValue(t && ['registration','seeded','running'].includes(t.status),'Tournament cannot be seeded.',409);
      const prior=await rows(db,'SELECT * FROM skribbil.tournament_fixtures WHERE tournament_id=$1',[id]);
      const policy=await one(db,"SELECT after_state FROM skribbil.admin_audit_log WHERE action='tournament.created' AND entity_id=$1 ORDER BY created_at LIMIT 1",[id]);
      const groupCount=t.format==='round_robin'?1:(policy?.after_state?.groupCount??2);
      const qualifiers=policy?.after_state?.qualifiersPerGroup??2;
      let entries=await rows(db,"SELECT * FROM skribbil.tournament_entries WHERE tournament_id=$1 AND status IN ('registered','checked_in') ORDER BY seed NULLS LAST,registered_at,id",[id]);
      requireValue(entries.length>=2,'At least two entries are required.',409);
      if(prior.length) {
        requireValue(t.format==='groups_knockout' && prior.every(f=>f.stage==='group') && prior.every(f=>f.winner_entry_id),'Complete every group fixture before generating the knockout stage.',409);
        const standings=await this.groupStandings(db,t.id);
        const groups=[...new Set(standings.map(e=>e.group_label))].sort();
        const qualified=[];
        // Group winners are seeded ahead of all runners-up.
        for(let position=0;position<qualifiers;position++) for(const label of groups) {
          const entry=standings.filter(e=>e.group_label===label)[position];
          if(entry) qualified.push(entries.find(e=>e.id===entry.entry_id));
        }
        entries=qualified.filter(Boolean);requireValue(entries.length>=2,'At least two qualifiers are required.',409);
        await this.knockout(db,t,entries);
      } else {
        // Existing explicit seeds preserve their order; registration/id resolve unseeded ties.
        for(let i=0;i<entries.length;i++) if(entries[i].seed===null) {
          const used=new Set(entries.map(e=>e.seed).filter(Boolean));let seed=1;while(used.has(seed))seed++;
          entries[i].seed=seed;await db.query('UPDATE skribbil.tournament_entries SET seed=$2 WHERE id=$1',[entries[i].id,seed]);
        }
        entries.sort((a,b)=>a.seed-b.seed);
        if(t.format==='knockout') await this.knockout(db,t,entries);
        else {
          requireValue(entries.length>=groupCount*2,'Every group requires at least two entries.',409);
          requireValue(t.format==='round_robin'||qualifiers<=Math.floor(entries.length/groupCount),'Too many qualifiers for the smallest group.',409);
          const groups=Array.from({length:groupCount},()=>[]);
          entries.forEach((entry,index)=>{const cycle=Math.floor(index/groupCount),offset=index%groupCount;groups[cycle%2?groupCount-1-offset:offset].push(entry);});
          for(let i=0;i<groups.length;i++) await this.roundRobin(db,t,groups[i],String.fromCharCode(65+i));
        }
      }
      await db.query("UPDATE skribbil.tournaments SET status='running' WHERE id=$1",[id]);
      await this.audit(db,user,'tournament.fixtures_generated','tournament',id,reason,{fixtureCount:prior.length},{stage:prior.length?'knockout':t.format,entryIds:entries.map(e=>e.id),groupCount,qualifiersPerGroup:qualifiers});
    });
    return this.getTournament(id);
  }

  async roundRobin(db,t,entries,label) {
    const rotation=[...entries];if(rotation.length%2)rotation.push(null);
    for(let round=1;round<rotation.length;round++) {
      let position=0;
      for(let i=0;i<rotation.length/2;i++) {
        const a=rotation[i],b=rotation[rotation.length-1-i];if(!a||!b)continue;
        const f=await one(db,`INSERT INTO skribbil.tournament_fixtures(tournament_id,game_id,stage,group_label,round_number,position)
          VALUES($1,$2,'group',$3,$4,$5) RETURNING *`,[t.id,t.game_id,label,round,++position]);
        await this.slot(db,t.id,f.id,1,a.id);await this.slot(db,t.id,f.id,2,b.id);
      }
      rotation.splice(1,0,rotation.pop());
    }
  }

  async knockout(db,t,entries) {
    let size=2;while(size<entries.length)size*=2;
    let order=[1,2];while(order.length<size){const sum=order.length*2+1;order=order.flatMap(n=>[n,sum-n]);}
    const levels=[],roundCount=Math.log2(size);
    // Create all nodes before linking them; entrants are a locked registration roster.
    for(let round=1;round<=roundCount;round++) {
      const level=[];
      for(let p=1;p<=size/2**round;p++) level.push(await one(db,`INSERT INTO skribbil.tournament_fixtures(tournament_id,game_id,stage,round_number,position)
        VALUES($1,$2,$3,$4,$5) RETURNING *`,[t.id,t.game_id,round===roundCount?'final':'knockout',round,p]));
      levels.push(level);
    }
    for(let r=0;r<levels.length-1;r++) for(let p=0;p<levels[r].length;p++) {
      const f=levels[r][p];f.advances_to_id=levels[r+1][Math.floor(p/2)].id;f.advances_to_slot=p%2+1;
      await db.query('UPDATE skribbil.tournament_fixtures SET advances_to_id=$2,advances_to_slot=$3 WHERE id=$1',[f.id,f.advances_to_id,f.advances_to_slot]);
    }
    for(let p=0;p<levels[0].length;p++) {
      const f=levels[0][p],pair=[entries[order[p*2]-1],entries[order[p*2+1]-1]].filter(Boolean);
      for(let s=0;s<pair.length;s++)await this.slot(db,t.id,f.id,s+1,pair[s].id);
      if(pair.length===1)await this.settle(db,t,f,pair[0].id); // Initial-round bye only.
    }
  }
  async slot(db,tournamentId,fixtureId,slot,entryId) {
    const existing=await one(db,'SELECT entry_id FROM skribbil.tournament_fixture_entries WHERE fixture_id=$1 AND slot=$2',[fixtureId,slot]);
    requireValue(!existing||existing.entry_id===entryId,'Advancement slot is already occupied.',409);
    if(!existing)await db.query('INSERT INTO skribbil.tournament_fixture_entries(fixture_id,tournament_id,slot,entry_id) VALUES($1,$2,$3,$4)',[fixtureId,tournamentId,slot,entryId]);
  }
  async settle(db,t,f,winner) {
    await db.query('UPDATE skribbil.tournament_fixtures SET winner_entry_id=$2 WHERE id=$1',[f.id,winner]);
    if(f.advances_to_id)await this.slot(db,t.id,f.advances_to_id,f.advances_to_slot,winner);
    if(f.stage==='final') {
      const opponents=await rows(db,'SELECT entry_id FROM skribbil.tournament_fixture_entries WHERE fixture_id=$1',[f.id]);
      await this.award(db,t,winner,1);
      for(const opponent of opponents)if(opponent.entry_id!==winner)await this.award(db,t,opponent.entry_id,2);
      await db.query("UPDATE skribbil.tournaments SET status='completed' WHERE id=$1",[t.id]);
    }
  }
  async award(db,t,entryId,placement) {
    const e=await one(db,'SELECT * FROM skribbil.tournament_entries WHERE id=$1 AND tournament_id=$2',[entryId,t.id]);
    const title=`${t.name} · ${placement===1?'Champion':placement===2?'Runner-up':'Third place'}`;
    await db.query(`INSERT INTO skribbil.trophies(user_id,team_id,tournament_id,title,placement,award_key)
      VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(award_key) DO NOTHING`,[e.user_id,e.team_id,t.id,title,placement,`${t.id}:${entryId}:${placement}`]);
    if(e.team_id)for(const member of await rows(db,'SELECT user_id FROM skribbil.tournament_rosters WHERE entry_id=$1',[entryId])) {
      await db.query(`INSERT INTO skribbil.trophies(user_id,tournament_id,title,placement,award_key)
        VALUES($1,$2,$3,$4,$5) ON CONFLICT(award_key) DO NOTHING`,[member.user_id,t.id,title,placement,`${t.id}:${entryId}:${placement}:${member.user_id}`]);
    }
  }
  async groupStandings(db,id) {
    return rows(db,`SELECT f.group_label,e.entry_id,te.seed,count(*) FILTER(WHERE f.winner_entry_id=e.entry_id)::int AS wins
      FROM skribbil.tournament_fixtures f JOIN skribbil.tournament_fixture_entries e ON e.fixture_id=f.id
      JOIN skribbil.tournament_entries te ON te.id=e.entry_id
      WHERE f.tournament_id=$1 AND f.stage='group' GROUP BY f.group_label,e.entry_id,te.seed
      ORDER BY f.group_label,wins DESC,te.seed,e.entry_id`,[id]);
  }
  async recordFixture(user,id,body) {
    await this.admin(user);validId(id,'fixture');validId(body.winnerEntryId,'winner');const reason=reasonFor(body);
    if(body.matchId)validId(body.matchId,'match');
    return this.db.transaction(async db=>{
      const original=await one(db,'SELECT * FROM skribbil.tournament_fixtures WHERE id=$1',[id]);
      requireValue(original,'Fixture not found.',404);
      const t=await one(db,'SELECT * FROM skribbil.tournaments WHERE id=$1 FOR UPDATE',[original.tournament_id]);
      const f=await one(db,'SELECT * FROM skribbil.tournament_fixtures WHERE id=$1 FOR UPDATE',[id]);
      if(f.winner_entry_id){requireValue(f.winner_entry_id===body.winnerEntryId,'A recorded result cannot be overwritten; resolve its dispute first.',409);return f;}
      requireValue(t.status==='running','Tournament is not running.',409);
      const contestants=await rows(db,'SELECT entry_id FROM skribbil.tournament_fixture_entries WHERE fixture_id=$1',[id]);
      requireValue(contestants.length===2 && contestants.some(e=>e.entry_id===body.winnerEntryId),'Choose one of the two fixture entrants.',409);
      if(body.matchId) {
        requireValue(await one(db,`SELECT id FROM skribbil.matches WHERE id=$1 AND game_id=$2 AND rule_set_id=$3 AND community_id=$4
          AND status='completed' AND accepted_result_id IS NOT NULL AND ($5::uuid IS NULL OR season_id=$5)`,[body.matchId,t.game_id,t.rule_set_id,t.community_id,t.season_id]),'The completed match must use this competition\'s game, community and rules.',409);
        await db.query('UPDATE skribbil.tournament_fixtures SET match_id=$2 WHERE id=$1',[id,body.matchId]);
      }
      await this.settle(db,t,f,body.winnerEntryId);
      if(t.format==='round_robin' && !await one(db,'SELECT id FROM skribbil.tournament_fixtures WHERE tournament_id=$1 AND winner_entry_id IS NULL LIMIT 1',[t.id])) {
        const leaders=await this.groupStandings(db,t.id);
        for(let i=0;i<Math.min(3,leaders.length);i++)await this.award(db,t,leaders[i].entry_id,i+1);
        await db.query("UPDATE skribbil.tournaments SET status='completed' WHERE id=$1",[t.id]);
      }
      const updated=await one(db,'SELECT * FROM skribbil.tournament_fixtures WHERE id=$1',[id]);
      await this.audit(db,user,'tournament.fixture_recorded','fixture',id,reason,f,updated);return updated;
    });
  }
}
