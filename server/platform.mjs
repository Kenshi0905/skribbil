import { randomUUID } from 'node:crypto';
import { leaderboard as communityLeaderboard } from './leaderboard.mjs';
import { avatarUrl, avatarFromUrl } from '../web/avatar.js';
import { ApiError, requireValue, textField, isUuid, hash, passwordHash, passwordMatches, newSession } from './security.mjs';

const one = async (db, sql, args = []) => (await db.query(sql, args)).rows[0];
export class Platform {
  constructor(db) { this.db = db; }
  async context(db = this.db) {
    return one(db, `SELECT g.id AS game_id, c.id AS community_id,
      (SELECT id FROM skribbil.rule_sets WHERE game_id=g.id AND competitive ORDER BY version DESC LIMIT 1) AS ranked_rules,
      (SELECT id FROM skribbil.rule_sets WHERE game_id=g.id AND NOT competitive ORDER BY version DESC LIMIT 1) AS private_rules,
      (SELECT id FROM skribbil.seasons WHERE community_id=c.id AND status='active' AND starts_at<=now() AND ends_at>now() LIMIT 1) AS season_id
      FROM skribbil.games g CROSS JOIN skribbil.communities c WHERE g.slug='skribbil' AND c.slug='skribbil'`);
  }
  async authenticate(token) {
    if (!token) return null;
    const row = await one(this.db, `SELECT u.* FROM skribbil.auth_sessions s JOIN skribbil.users u ON u.id=s.user_id
      WHERE s.token_hash=$1 AND s.revoked_at IS NULL AND s.expires_at>now() AND u.status='active'`, [hash(token)]);
    return row || null;
  }
  async profile(user) {
    if (!user) return null;
    const row = await one(this.db, `SELECT u.id,u.username,u.display_name AS "displayName",u.bio,u.avatar_color AS "avatarColor",
      p.total_xp AS xp,p.level,u.avatar_url AS "avatarUrl",(SELECT coalesce(sum(total_points),0) FROM skribbil.all_time_game_standings WHERE user_id=u.id) AS points,
      EXISTS(SELECT 1 FROM skribbil.platform_roles WHERE user_id=u.id AND role='administrator') AS "isAdmin"
      FROM skribbil.users u JOIN skribbil.user_progression p ON p.user_id=u.id WHERE u.id=$1`, [user.id]);
    const inventory = (await this.db.query(`SELECT d.id,d.name,d.slug,d.slot,e.cosmetic_id IS NOT NULL AS equipped
      FROM skribbil.user_inventory i JOIN skribbil.cosmetic_definitions d ON d.id=i.cosmetic_id
      LEFT JOIN skribbil.equipped_cosmetics e ON e.user_id=i.user_id AND e.cosmetic_id=i.cosmetic_id WHERE i.user_id=$1`, [user.id])).rows;
    const history = (await this.db.query(`SELECT m.id,p.score,p.placement AS rank,p.won,m.ended_at AS date,m.mode
      FROM skribbil.matches m JOIN skribbil.match_result_players p ON p.result_id=m.accepted_result_id
      WHERE p.user_id=$1 ORDER BY m.ended_at DESC LIMIT 20`, [user.id])).rows;
    const achievements=(await this.db.query(`SELECT d.slug,d.title,d.description,a.awarded_at AS "awardedAt" FROM skribbil.user_achievements a JOIN skribbil.achievement_definitions d ON d.id=a.achievement_id WHERE a.user_id=$1`,[user.id])).rows;
    const trophies=(await this.db.query(`SELECT title,placement,awarded_at AS "awardedAt" FROM skribbil.trophies WHERE user_id=$1 ORDER BY awarded_at DESC`,[user.id])).rows;
    const totals=await one(this.db,`SELECT count(*) AS played,count(*) FILTER(WHERE p.won) AS wins,coalesce(avg(p.score),0)::int AS average
      FROM skribbil.matches m JOIN skribbil.match_result_players p ON p.result_id=m.accepted_result_id WHERE p.user_id=$1`,[user.id]);
    return { ...row, avatarPreset:avatarFromUrl(row.avatarUrl), xp:Number(row.xp), points:Number(row.points),gamesPlayed:Number(totals.played),wins:Number(totals.wins),averageScore:totals.average,
      title:inventory.find(i=>i.slot==='title'&&i.equipped)?.name || 'Rookie',frame:inventory.find(i=>i.slot==='frame'&&i.equipped)?.slug||null, inventory, history,achievements,trophies };
  }
  async friendProfile(user, friendId) {
    requireValue(isUuid(friendId), 'Choose a valid friend.');
    const friend = await one(this.db, `SELECT u.id FROM skribbil.friendships f
      JOIN skribbil.users u ON u.id=$2 AND u.status='active'
      WHERE f.user_low=LEAST($1::uuid,$2::uuid) AND f.user_high=GREATEST($1::uuid,$2::uuid)
      AND f.status='accepted'`, [user.id, friendId]);
    requireValue(friend, 'This friend profile is unavailable.', 404);
    const profile = await this.profile(friend);
    const { id, username, displayName, bio, avatarColor, avatarUrl, avatarPreset, xp, level,
      points, gamesPlayed, wins, averageScore, title, frame, achievements, trophies } = profile;
    return { id, username, displayName, bio, avatarColor, avatarUrl, avatarPreset, xp, level,
      points, gamesPlayed, wins, averageScore, title, frame, achievements, trophies };
  }
  async session(db, userId, rememberMe = false) {
    const s = newSession();
    await db.query(`INSERT INTO skribbil.auth_sessions(user_id,token_hash,expires_at,remember_me) VALUES($1,$2,now()+interval '7 days',$3)`, [userId, s.tokenHash, rememberMe]);
    return s.token;
  }
  async register(body) {
    requireValue(body.rememberMe === undefined || typeof body.rememberMe === 'boolean','Remember me must be true or false.');
    const username = textField(body.username,3,24,'Username');
    requireValue(/^[A-Za-z0-9_]+$/.test(username),'Use letters, numbers and underscores in your username.');
    const email = textField(body.email,3,254,'Email').toLowerCase();
    requireValue(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email),'Enter a valid email address.');
    requireValue(typeof body.password==='string' && body.password.length>=10 && body.password.length<=128,'Password must be 10–128 characters.');
    const password = await passwordHash(body.password);
    try {
      return await this.db.transaction(async db => {
        const user = await one(db,`INSERT INTO skribbil.users(username,display_name,email) VALUES($1,$1,$2) RETURNING *`,[username,email]);
        await db.query(`INSERT INTO skribbil.credentials(user_id,password_hash) VALUES($1,$2)`,[user.id,password]);
        const context = await this.context(db);
        await db.query(`INSERT INTO skribbil.community_members(community_id,user_id) VALUES($1,$2)`,[context.community_id,user.id]);
        await db.query(`INSERT INTO skribbil.user_inventory(user_id,cosmetic_id,source,grant_key)
          SELECT $1::uuid,id,'welcome',$1::text||':welcome:'||slug FROM skribbil.cosmetic_definitions WHERE slug='rookie'`,[user.id]);
        await db.query(`INSERT INTO skribbil.equipped_cosmetics(user_id,cosmetic_id,slot)
          SELECT $1,id,slot FROM skribbil.cosmetic_definitions WHERE slug='rookie'`,[user.id]);
        return { user,token:await this.session(db,user.id,body.rememberMe === true) };
      });
    } catch(error) { if(error.code==='23505') throw new ApiError(409,'That username or email is already registered.'); throw error; }
  }
  async login(body) {
    requireValue(body.rememberMe === undefined || typeof body.rememberMe === 'boolean','Remember me must be true or false.');
    const email = textField(body.email,3,254,'Email or username');
    requireValue(typeof body.password==='string' && body.password.length<=128,'Invalid credentials.',401);
    const row = await one(this.db,`SELECT u.*,c.password_hash FROM skribbil.users u JOIN skribbil.credentials c ON c.user_id=u.id
      WHERE lower(u.email)=lower($1) OR lower(u.username)=lower($1)`,[email]);
    // A dummy hash keeps missing-account responses on the same expensive path.
    const dummy = 'scrypt:00000000000000000000000000000000:'+'0'.repeat(128);
    const correct = await passwordMatches(body.password,row?.password_hash || dummy);
    requireValue(correct && row?.status==='active','Email/username or password is incorrect.',401);
    return this.db.transaction(async db=>{
      const current=await one(db,`SELECT status FROM skribbil.users WHERE id=$1 FOR NO KEY UPDATE`,[row.id]);
      // Read the hash after acquiring the account lock. A joined credentials
      // row could otherwise retain the pre-lock snapshot across a password change.
      const credential=await one(db,'SELECT password_hash FROM skribbil.credentials WHERE user_id=$1',[row.id]);
      requireValue(current?.status==='active'&&credential?.password_hash===row.password_hash,'Credentials changed. Please sign in again.',401);
      return {user:row,token:await this.session(db,row.id,body.rememberMe === true)};
    });
  }
  async logout(token) { if(token) await this.db.query(`UPDATE skribbil.auth_sessions SET revoked_at=now() WHERE token_hash=$1`,[hash(token)]); }
  async changePassword(user,token,body) {
    requireValue(typeof body.currentPassword==='string'&&body.currentPassword.length<=128,'Enter your current password.');
    requireValue(typeof body.newPassword==='string'&&body.newPassword.length>=12&&body.newPassword.length<=128,'New password must be 12–128 characters.');
    requireValue(body.currentPassword!==body.newPassword,'Choose a different new password.');
    const credential=await one(this.db,'SELECT password_hash FROM skribbil.credentials WHERE user_id=$1',[user.id]);
    requireValue(await passwordMatches(body.currentPassword,credential?.password_hash),'Current password is incorrect.',403);
    const nextHash=await passwordHash(body.newPassword);
    return this.db.transaction(async db=>{
      const account=await one(db,'SELECT status FROM skribbil.users WHERE id=$1 FOR NO KEY UPDATE',[user.id]);
      const session=await one(db,`SELECT remember_me FROM skribbil.auth_sessions WHERE user_id=$1 AND token_hash=$2 AND revoked_at IS NULL AND expires_at>now()`,[user.id,hash(token||'')]);
      requireValue(account?.status==='active'&&session,'Sign in again to change your password.',401);
      const changed=await db.query(`UPDATE skribbil.credentials SET password_hash=$2,updated_at=now() WHERE user_id=$1 AND password_hash=$3 RETURNING user_id`,[user.id,nextHash,credential.password_hash]);
      requireValue(changed.rows.length,'Your password changed in another session. Sign in again.',409);
      await db.query(`UPDATE skribbil.auth_sessions SET revoked_at=now() WHERE user_id=$1 AND revoked_at IS NULL`,[user.id]);
      return {token:await this.session(db,user.id,session.remember_me),rememberMe:session.remember_me};
    });
  }
  async updateProfile(user,body) {
    requireValue(!Object.hasOwn(body,'title')&&!Object.hasOwn(body,'titleId'),'Only an administrator can change profile titles.');
    const displayName=textField(body.displayName ?? user.display_name,1,60,'Display name');
    const bio=textField(body.bio ?? user.bio,0,280,'Bio');
    const color=body.avatarColor || user.avatar_color;
    requireValue(/^#[a-f0-9]{6}$/i.test(color),'Choose a valid avatar color.');
    let presetUrl;
    if (Object.hasOwn(body,'avatarPreset')) {
      try { presetUrl=avatarUrl(body.avatarPreset); }
      catch(error) { throw new ApiError(400,error.message); }
    }
    await this.db.transaction(async db=>{
      if (presetUrl) {
        const current=await one(db,`SELECT avatar_url,status FROM skribbil.users WHERE id=$1 FOR NO KEY UPDATE`,[user.id]);
        requireValue(current?.status==='active','This account is unavailable.',403);
        await db.query(`UPDATE skribbil.users SET avatar_url=$2 WHERE id=$1`,[user.id,presetUrl]);
        const old=current.avatar_url?.match(/^\/api\/media\/([a-f0-9-]+)$/)?.[1];
        if (old) await db.query(`UPDATE skribbil.object_assets SET expires_at=now()+interval '1 day' WHERE id=$1 AND policy_id='profile-image'`,[old]);
      }
      await db.query(`UPDATE skribbil.users SET display_name=coalesce($2,display_name),bio=coalesce($3,bio),avatar_color=coalesce($4,avatar_color) WHERE id=$1`,
        [user.id,body.displayName!=null?displayName:null,body.bio!=null?bio:null,body.avatarColor?color:null]);
      if(body.cosmeticId){
        requireValue(isUuid(body.cosmeticId),'Invalid cosmetic.');
        const item=await one(db,`SELECT d.id,d.slot FROM skribbil.user_inventory i JOIN skribbil.cosmetic_definitions d ON d.id=i.cosmetic_id WHERE i.user_id=$1 AND i.cosmetic_id=$2`,[user.id,body.cosmeticId]);
        requireValue(item,'Earn this cosmetic before equipping it.',403);
        requireValue(item.slot!=='title','Only an administrator can change profile titles.',403);
        await db.query(`INSERT INTO skribbil.equipped_cosmetics(user_id,cosmetic_id,slot) VALUES($1,$2,$3) ON CONFLICT(user_id,slot) DO UPDATE SET cosmetic_id=excluded.cosmetic_id`,[user.id,item.id,item.slot]);
      }
    });
  }
  async challengeWindows(db=this.db) {
    // UTC boundaries are explicit and consistent for every player.
    await db.query(`INSERT INTO skribbil.challenge_windows(challenge_id,starts_at,ends_at,metric,target,xp_reward,cosmetic_reward_id)
      SELECT id,date_trunc(CASE cadence WHEN 'daily' THEN 'day' ELSE 'week' END,now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC',
      (date_trunc(CASE cadence WHEN 'daily' THEN 'day' ELSE 'week' END,now() AT TIME ZONE 'UTC')+
        CASE cadence WHEN 'daily' THEN interval '1 day' ELSE interval '1 week' END) AT TIME ZONE 'UTC',metric,target,xp_reward,cosmetic_reward_id
      FROM skribbil.challenge_definitions WHERE enabled ON CONFLICT(challenge_id,starts_at) DO NOTHING`);
  }
  async bootstrap(user,engine) {
    await this.challengeWindows();
    const context=await this.context();
    const [leagues,profile,leaderboard,seasonBoard,challenges,tournaments,teams,friends,rooms,drawings,season] = await Promise.all([
      this.db.query(`SELECT l.id,l.name,l.slug FROM skribbil.leagues l WHERE l.community_id=$1 ORDER BY EXISTS(SELECT 1 FROM skribbil.seasons s WHERE s.league_id=l.id AND s.id=$2) DESC,l.created_at DESC,l.id`,[context.community_id,context.season_id]),
      this.profile(user),
      communityLeaderboard(this,null).then(board => ({rows:board.players})),
      this.db.query(`SELECT u.id,u.username,u.display_name AS name,u.avatar_color AS "avatarColor",u.avatar_url AS "avatarUrl",s.league_points AS points,s.wins,s.matches_played AS played
        FROM skribbil.season_standings s JOIN skribbil.users u ON u.id=s.user_id WHERE s.season_id=$1 ORDER BY s.league_points DESC,s.wins DESC,u.username LIMIT 50`,[context.season_id]),
      this.db.query(`SELECT w.id,d.title,d.cadence,d.metric,w.target,w.xp_reward AS xp,w.ends_at AS "endsAt",coalesce(p.progress,0) AS progress,
        p.reward_xp_event_id IS NOT NULL AS claimed FROM skribbil.challenge_windows w JOIN skribbil.challenge_definitions d ON d.id=w.challenge_id
        LEFT JOIN skribbil.challenge_progress p ON p.window_id=w.id AND p.user_id=$1 WHERE w.starts_at<=now() AND w.ends_at>now()`,[user?.id||null]),
      this.db.query(`SELECT t.id,t.name,t.format,t.status,t.entry_type AS "entryType",t.starts_at AS "startsAt",t.maximum_entries AS capacity,
        (SELECT count(*) FROM skribbil.tournament_entries e WHERE e.tournament_id=t.id AND e.status<>'withdrawn') AS registered,
        EXISTS(SELECT 1 FROM skribbil.tournament_entries e WHERE e.tournament_id=t.id AND (e.user_id=$1 OR EXISTS(SELECT 1 FROM skribbil.tournament_rosters r WHERE r.entry_id=e.id AND r.user_id=$1))) AS joined
        FROM skribbil.tournaments t WHERE t.status<>'draft' ORDER BY t.starts_at LIMIT 20`,[user?.id||null]),
      this.db.query(`SELECT t.id,t.name,t.tag,t.logo_url AS "logoUrl",t.captain_id AS "captainId",(SELECT count(*) FROM skribbil.team_members m WHERE m.team_id=t.id AND m.left_at IS NULL) AS members
        FROM skribbil.teams t WHERE t.archived_at IS NULL ORDER BY t.created_at LIMIT 30`),
      user?this.db.query(`SELECT u.id,u.username,u.display_name AS "displayName",u.avatar_color AS "avatarColor",u.avatar_url AS "avatarUrl",f.status,f.requested_by=$1 AS outgoing FROM skribbil.friendships f
        JOIN skribbil.users u ON u.id=CASE WHEN f.user_low=$1 THEN f.user_high ELSE f.user_low END
        WHERE (f.user_low=$1 OR f.user_high=$1) AND f.status IN ('pending','accepted')`,[user.id]):{rows:[]},
      this.db.query(`SELECT m.id,m.engine_room_id AS code,m.mode,m.status,
        (SELECT count(*) FROM skribbil.match_players p WHERE p.match_id=m.id AND p.left_at IS NULL) AS players
        FROM skribbil.matches m WHERE m.status IN ('lobby','running') AND NOT m.private AND m.created_at>now()-interval '6 hours' ORDER BY m.created_at DESC LIMIT 20`),
      this.db.query(`SELECT p.id,p.hall,p.title,p.caption,p.prompt_snapshot AS prompt,p.artist_id AS "artistId",u.display_name AS artist,
        p.dislike_count AS dislikes,coalesce(v.fame,0) AS "fameVotes",coalesce(v.shame,0) AS "shameVotes",p.published_at AS date,'/api/drawings/'||p.drawing_id||'/image' AS url
        FROM skribbil.public_gallery p JOIN skribbil.users u ON u.id=p.artist_id LEFT JOIN skribbil.drawings d ON d.id=p.drawing_id LEFT JOIN skribbil.gallery_vote_totals v ON v.turn_id=d.turn_id ORDER BY p.published_at DESC LIMIT 30`),
      one(this.db,`SELECT id,name,starts_at AS "startsAt",ends_at AS "endsAt",status FROM skribbil.seasons WHERE id=$1`,[context.season_id]),
    ]);
    return {leagues:leagues.rows,user:profile,leaderboard:leaderboard.rows,seasonLeaderboard:seasonBoard.rows,challenges:challenges.rows,
      tournaments:tournaments.rows,teams:teams.rows,friends:friends.rows,rooms:rooms.rows,drawings:drawings.rows,season:season||null,
      ownRooms:user?(await this.db.query(`SELECT DISTINCT m.id,m.engine_room_id AS code,m.mode,m.status,m.private,m.created_by=$1 AS owner
        FROM skribbil.matches m JOIN skribbil.match_players p ON p.match_id=m.id WHERE p.user_id=$1 AND p.left_at IS NULL AND m.status IN ('lobby','running')
        AND (m.clubhouse_id IS NULL OR EXISTS(SELECT 1 FROM skribbil.clubhouse_members cm WHERE cm.clubhouse_id=m.clubhouse_id AND cm.user_id=$1 AND cm.left_at IS NULL))`,[user.id])).rows:[],
      stats:await one(this.db,`SELECT (SELECT count(*) FROM skribbil.users WHERE username<>'skribbil_system' AND status='active') AS players,
        (SELECT count(*) FROM skribbil.matches WHERE status='completed') AS matches`),engine,mode:this.db.mode,demo:false};
  }
  async createTeam(user,body) {
    const name=textField(body.name,3,48,'Team name'),tag=textField(body.tag,2,8,'Team tag').toUpperCase();
    requireValue(/^[A-Z0-9]+$/.test(tag),'Team tag must use letters and numbers.');
    return this.db.transaction(async db=>{
      const c=await this.context(db);
      const team=await one(db,`INSERT INTO skribbil.teams(community_id,name,tag,captain_id) VALUES($1,$2,$3,$4) RETURNING *`,[c.community_id,name,tag,user.id]);
      await db.query(`INSERT INTO skribbil.team_members(team_id,community_id,user_id,role) VALUES($1,$2,$3,'captain')`,[team.id,c.community_id,user.id]);
      return team;
    });
  }
  async friend(user,body) {
    const username=textField(body.username,3,24,'Username');
    const other=await one(this.db,`SELECT id FROM skribbil.users WHERE lower(username)=lower($1) AND status='active'`,[username]);
    requireValue(other && other.id!==user.id,'Choose another registered player.');
    const ids=[user.id,other.id].sort();
    await this.db.transaction(async db=>{
      // Resolve concurrent first requests before reading the pair: PostgreSQL
      // waits for a conflicting insert, then the next statement sees its row.
      await db.query(`INSERT INTO skribbil.friendships(user_low,user_high,requested_by) VALUES($1,$2,$3) ON CONFLICT DO NOTHING`,[...ids,user.id]);
      const existing=await one(db,`SELECT * FROM skribbil.friendships WHERE user_low=$1 AND user_high=$2 FOR UPDATE`,ids);
      if(existing.status==='pending' && existing.requested_by!==user.id) await db.query(`UPDATE skribbil.friendships SET status='accepted',updated_at=now() WHERE user_low=$1 AND user_high=$2`,ids);
      // Only the recipient who declined may reopen the relationship, as a new
      // outgoing request. The original sender cannot repeatedly request again.
      else if(existing.status==='declined' && existing.requested_by!==user.id) await db.query(`UPDATE skribbil.friendships SET status='pending',requested_by=$3,updated_at=now() WHERE user_low=$1 AND user_high=$2`,[...ids,user.id]);
      else requireValue(existing.status==='accepted'||existing.status==='pending','This friendship is unavailable.',409);
    });
  }
  async respondFriend(user,otherUserId,body) {
    requireValue(isUuid(otherUserId),'Invalid player.');
    otherUserId=otherUserId.toLowerCase();
    requireValue(otherUserId!==user.id,'Choose another registered player.');
    requireValue(body.action==='accept'||body.action==='decline','Choose accept or decline.');
    const ids=[user.id,otherUserId].sort(),status=body.action==='accept'?'accepted':'declined';
    await this.db.transaction(async db=>{
      const existing=await one(db,`SELECT * FROM skribbil.friendships WHERE user_low=$1 AND user_high=$2 FOR UPDATE`,ids);
      requireValue(existing,'Friend request not found.',404);
      requireValue(existing.requested_by===otherUserId,'Only the request recipient can respond.',403);
      // Repeating the same decision is safe; a stale or opposite decision must
      // not undo an accepted friendship or a declined request.
      if(existing.status===status)return;
      requireValue(existing.status==='pending','This friend request is no longer pending.',409);
      const updated=await db.query(`UPDATE skribbil.friendships SET status=$4,updated_at=now()
        WHERE user_low=$1 AND user_high=$2 AND requested_by=$3 AND status='pending' RETURNING user_low`,[...ids,otherUserId,status]);
      requireValue(updated.rows.length,'This friend request is no longer pending.',409);
    });
  }
  async registerTournament(user,id) {
    requireValue(isUuid(id),'Invalid tournament.');
    await this.db.transaction(async db=>{
      const t=await one(db,`SELECT * FROM skribbil.tournaments WHERE id=$1 FOR UPDATE`,[id]);
      requireValue(t && t.status==='registration' && new Date(t.registration_closes_at)>new Date(),'Registration is closed.',409);
      requireValue(t.entry_type==='individual','This tournament requires a team registration.');
      const existing=await one(db,`SELECT id FROM skribbil.tournament_entries WHERE tournament_id=$1 AND user_id=$2`,[id,user.id]);
      if(existing) return;
      const count=await one(db,`SELECT count(*) AS n FROM skribbil.tournament_entries WHERE tournament_id=$1 AND status<>'withdrawn'`,[id]);
      requireValue(Number(count.n)<t.maximum_entries,'This tournament is full.',409);
      await db.query(`INSERT INTO skribbil.tournament_entries(tournament_id,community_id,entry_type,user_id) VALUES($1,$2,'individual',$3)`,[id,t.community_id,user.id]);
    });
  }
  async claimChallenge(user,id) {
    requireValue(isUuid(id),'Invalid challenge.');
    await this.db.transaction(async db=>{
      const row=await one(db,`SELECT p.*,w.target,w.xp_reward,w.ends_at FROM skribbil.challenge_progress p JOIN skribbil.challenge_windows w ON w.id=p.window_id
        WHERE p.user_id=$1 AND p.window_id=$2 FOR UPDATE OF p`,[user.id,id]);
      requireValue(row && row.progress>=row.target,'Complete the challenge before claiming XP.',409);
      requireValue(new Date(row.ends_at)>new Date(),'This challenge has expired.',409);
      if(row.reward_xp_event_id) return;
      const xp=await one(db,`INSERT INTO skribbil.xp_events(user_id,amount,reason,idempotency_key) VALUES($1,$2,'challenge',$3) RETURNING id`,[user.id,row.xp_reward,`challenge:${id}:${user.id}`]);
      await db.query(`UPDATE skribbil.challenge_progress SET reward_xp_event_id=$3 WHERE user_id=$1 AND window_id=$2`,[user.id,id,xp.id]);
      await this.grantLevelRewards(db,user.id);
    });
  }
  async grantLevelRewards(db,userId) {
    await db.query(`INSERT INTO skribbil.user_inventory(user_id,cosmetic_id,source,grant_key)
      SELECT $1::uuid,l.cosmetic_reward_id,'level',$1::text||':level:'||l.level FROM skribbil.level_definitions l
      WHERE l.cosmetic_reward_id IS NOT NULL AND l.minimum_xp <= (SELECT total_xp FROM skribbil.user_progression WHERE user_id=$1)
      ON CONFLICT DO NOTHING`,[userId]);
  }
  async admin(user) {
    const role=await one(this.db,`SELECT role FROM skribbil.platform_roles WHERE user_id=$1 AND role='administrator'`,[user.id]);
    requireValue(role,'Administrator access required.',403);
  }
  async audit(db,user,action,entityType,entityId,reason,before,after) {
    await db.query(`INSERT INTO skribbil.admin_audit_log(actor_id,action,entity_type,entity_id,reason,before_state,after_state,request_id)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,[user.id,action,entityType,entityId,reason,JSON.stringify(before),JSON.stringify(after),randomUUID()]);
  }
  async assignTitle(user,targetId,body) {
    await this.admin(user);
    requireValue(isUuid(targetId)&&Object.hasOwn(body,'titleId')&&(body.titleId===null||isUuid(body.titleId)),'Choose a valid player and title.');
    const reason=textField(body.reason,5,500,'Reason');
    return this.db.transaction(async db=>{
      requireValue(await one(db,`SELECT role FROM skribbil.platform_roles WHERE user_id=$1 AND role='administrator' FOR SHARE`,[user.id]),'Administrator access required.',403);
      const target=await one(db,`SELECT id,status FROM skribbil.users WHERE id=$1 FOR NO KEY UPDATE`,[targetId]);
      requireValue(target&&target.status!=='erased','Player not found.',404);
      const title=await one(db,`SELECT id,name FROM skribbil.cosmetic_definitions WHERE slot='title' AND CASE WHEN $1::uuid IS NULL THEN slug='rookie' ELSE id=$1 END`,[body.titleId]);
      requireValue(title,'Choose an existing title.');
      const before=await one(db,`SELECT cosmetic_id AS "titleId" FROM skribbil.equipped_cosmetics WHERE user_id=$1 AND slot='title'`,[targetId]);
      await db.query(`INSERT INTO skribbil.user_inventory(user_id,cosmetic_id,source,grant_key) VALUES($1,$2,'admin',$3) ON CONFLICT(user_id,cosmetic_id) DO NOTHING`,[targetId,title.id,`admin-title:${targetId}:${title.id}`]);
      await db.query(`INSERT INTO skribbil.equipped_cosmetics(user_id,cosmetic_id,slot) VALUES($1,$2,'title') ON CONFLICT(user_id,slot) DO UPDATE SET cosmetic_id=excluded.cosmetic_id`,[targetId,title.id]);
      await this.audit(db,user,'profile.title.assigned','user',targetId,reason,before||{titleId:null},{titleId:title.id});
      return {titleId:title.id,title:title.name};
    });
  }
  async ban(user,body) {
    requireValue(isUuid(body.userId)&&body.userId!==user.id,'Choose another account.');
    const reason=textField(body.reason,5,1000,'Reason');
    await this.db.transaction(async db=>{
      const prior=await one(db,`UPDATE skribbil.users SET status='suspended' WHERE id=$1 RETURNING id`,[body.userId]);
      requireValue(prior,'Account not found.',404);
      await db.query(`INSERT INTO skribbil.moderation_bans(user_id,reason,issued_by) VALUES($1,$2,$3)`,[body.userId,reason,user.id]);
      await db.query(`UPDATE skribbil.auth_sessions SET revoked_at=now() WHERE user_id=$1 AND revoked_at IS NULL`,[body.userId]);
      await this.audit(db,user,'account.banned','user',body.userId,reason,{status:'active'},{status:'suspended'});
    });
  }
  async adjust(user,body) {
    requireValue(isUuid(body.matchId)&&isUuid(body.userId),'Choose a match and player.');
    requireValue(Number.isInteger(body.delta)&&body.delta!==0&&Math.abs(body.delta)<=100000,'Delta must be a nonzero integer within 100000.');
    const reason=textField(body.reason,5,1000,'Reason');
    return this.db.transaction(async db=>{
      const match=await one(db,`SELECT * FROM skribbil.matches WHERE id=$1 FOR UPDATE`,[body.matchId]);
      requireValue(match?.accepted_result_id && match.status==='completed','Choose a completed match.',409);
      const prior=await one(db,`SELECT * FROM skribbil.match_results WHERE id=$1`,[match.accepted_result_id]);
      const players=(await db.query(`SELECT * FROM skribbil.match_result_players WHERE result_id=$1`,[prior.id])).rows;
      const target=players.find(p=>p.user_id===body.userId); requireValue(target,'This player is not in that match.');
      const before=target.score; target.score+=body.delta; players.sort((a,b)=>b.score-a.score);
      const key=randomUUID();
      const result=await one(db,`INSERT INTO skribbil.match_results(match_id,version,source,previous_result_id,actor_id,reason,engine_revision,payload_sha256,idempotency_key)
        VALUES($1,$2,'admin_correction',$3,$4,$5,$6,$7,$8) RETURNING id`,[match.id,prior.version+1,prior.id,user.id,reason,prior.engine_revision,hash(JSON.stringify(players)),key]);
      for(const p of players) {
        const rank=1+players.filter(v=>v.score>p.score).length;
        await db.query(`INSERT INTO skribbil.match_result_players(result_id,match_id,user_id,score,placement,won,rounds_won,correct_guesses,fastest_guess_ms,game_stats)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,[result.id,match.id,p.user_id,p.score,rank,rank===1,p.rounds_won,p.correct_guesses,p.fastest_guess_ms,JSON.stringify(p.game_stats)]);
        if(match.season_id) await this.leaguePoints(db,match,result.id,p.user_id,rank);
      }
      await db.query(`INSERT INTO skribbil.score_events(match_id,user_id,kind,delta,idempotency_key,actor_id,reason) VALUES($1,$2,'admin_correction',$3,$4,$5,$6)`,[match.id,body.userId,body.delta,key,user.id,reason]);
      await db.query(`UPDATE skribbil.matches SET accepted_result_id=$2 WHERE id=$1`,[match.id,result.id]);
      await this.audit(db,user,'score.corrected','match',match.id,reason,{result:prior.id,score:before},{result:result.id,score:target.score});
      return {resultId:result.id};
    });
  }
  async leaguePoints(db,match,resultId,userId,rank) {
    await db.query(`INSERT INTO skribbil.season_entries(season_id,community_id,user_id) VALUES($1,$2,$3) ON CONFLICT DO NOTHING`,[match.season_id,match.community_id,userId]);
    const policy=await one(db,`SELECT scoring_version,scoring_config FROM skribbil.season_games WHERE season_id=$1 AND game_id=$2`,[match.season_id,match.game_id]);
    const points=Number(policy.scoring_config.points?.[String(rank)] ?? policy.scoring_config.participation ?? 1);
    await db.query(`INSERT INTO skribbil.league_result_points(result_id,match_id,user_id,season_id,game_id,points,scoring_version,breakdown)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,[resultId,match.id,userId,match.season_id,match.game_id,points,policy.scoring_version,JSON.stringify({rank})]);
  }
}
