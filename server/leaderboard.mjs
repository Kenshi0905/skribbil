import { requireValue } from './security.mjs';

// Only the currently accepted result counts, including after an admin correction.
export async function leaderboard(platform, user, options = {}) {
  const period = options.period || 'all-time', scope = options.scope || 'everyone';
  const search = (options.search || '').trim();
  const page = Number(options.page || 1), pageSize = 25;
  requireValue(['all-time','weekly','monthly','season'].includes(period), 'Choose a valid leaderboard period.');
  requireValue(['everyone','friends'].includes(scope), 'Choose a valid leaderboard audience.');
  requireValue(scope !== 'friends' || user, 'Sign in to see your friends leaderboard.', 401);
  requireValue(search.length <= 80, 'Search must be at most 80 characters.');
  requireValue(Number.isSafeInteger(page) && page > 0 && page <= 100000, 'Choose a valid leaderboard page.');
  const context = await platform.context();
  const result = (await platform.db.query(`WITH settings AS (SELECT $2::uuid AS season_id), scores AS (
    SELECT p.user_id, sum(${period === 'season' ? 'l.points' : 'p.score'}) AS points,
      count(*) AS played, count(*) FILTER (WHERE p.won) AS wins
    FROM skribbil.matches m JOIN skribbil.match_result_players p
      ON p.result_id=m.accepted_result_id AND p.match_id=m.id
    ${period === 'season' ? 'JOIN skribbil.league_result_points l ON l.result_id=p.result_id AND l.user_id=p.user_id' : ''}
    WHERE m.status='completed' AND m.game_id=$1
      ${period === 'weekly' ? "AND m.ended_at >= date_trunc('week',now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'" : ''}
      ${period === 'monthly' ? "AND m.ended_at >= date_trunc('month',now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'" : ''}
      ${period === 'season' ? 'AND m.season_id=(SELECT season_id FROM settings)' : ''}
    GROUP BY p.user_id
  ), ranked AS (
    SELECT u.id,u.username,u.display_name AS "displayName",u.avatar_url AS "avatarUrl",u.avatar_color AS "avatarColor",
      s.points,s.played,s.wins,p.level,
      row_number() OVER (ORDER BY s.points DESC,s.wins DESC,u.username,u.id) AS rank
    FROM scores s JOIN skribbil.users u ON u.id=s.user_id
    JOIN skribbil.user_progression p ON p.user_id=u.id
    WHERE u.status='active' AND ($3='everyone' OR u.id=$4 OR EXISTS (
      SELECT 1 FROM skribbil.friendships f WHERE f.status='accepted'
        AND f.user_low=LEAST(u.id,$4::uuid) AND f.user_high=GREATEST(u.id,$4::uuid)))
  ), filtered AS (
    SELECT * FROM ranked WHERE strpos(lower("displayName"),lower($5))>0 OR strpos(lower(username),lower($5))>0
  ), page AS (SELECT * FROM filtered ORDER BY rank LIMIT $6 OFFSET $7)
  SELECT (SELECT count(*) FROM filtered) AS total,
    (SELECT count(*) FROM ranked) AS participants,
    (SELECT row_to_json(r) FROM ranked r WHERE id=$4) AS me,
    coalesce((SELECT json_agg(r ORDER BY rank) FROM (SELECT * FROM ranked ORDER BY rank LIMIT 3) r),'[]') AS top,
    coalesce((SELECT json_agg(p ORDER BY rank) FROM page p),'[]') AS players`,
  [context.game_id,context.season_id,scope,user?.id || null,search,pageSize,(page-1)*pageSize])).rows[0];
  return {...result,total:Number(result.total),participants:Number(result.participants),page,pageSize,period,scope};
}
