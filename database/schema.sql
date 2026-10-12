-- Skribbil platform schema, PostgreSQL 16+. Apply once to a new database.
-- The Go engine remains authoritative during play. This schema archives events
-- and owns identities, competitions and assets; it never schedules game turns.
BEGIN;
CREATE SCHEMA IF NOT EXISTS skribbil;
SET LOCAL search_path = skribbil, public;

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  username varchar(24) NOT NULL CHECK (username ~ '^[A-Za-z0-9_]{3,24}$'),
  display_name varchar(60) NOT NULL,
  email text,
  avatar_url text,
  avatar_color text NOT NULL DEFAULT '#ffd34d' CHECK(avatar_color ~ '^#[a-fA-F0-9]{6}$'),
  bio varchar(280) NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended','erased')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX users_username_ci ON users(lower(username));
CREATE UNIQUE INDEX users_email_ci ON users(lower(email)) WHERE email IS NOT NULL;
CREATE TABLE credentials (
  user_id uuid PRIMARY KEY REFERENCES users(id),
  password_hash text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE auth_identities (
  provider text NOT NULL, provider_subject text NOT NULL,
  user_id uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(provider, provider_subject), UNIQUE(user_id, provider)
);
CREATE TABLE auth_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id),
  token_hash text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL, revoked_at timestamptz,
  CHECK (expires_at > created_at)
);
CREATE INDEX auth_sessions_user ON auth_sessions(user_id, expires_at) WHERE revoked_at IS NULL;
CREATE TABLE platform_roles (
  user_id uuid NOT NULL REFERENCES users(id),
  role text NOT NULL CHECK(role IN ('administrator','moderator')),
  granted_by uuid REFERENCES users(id), granted_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(user_id, role)
);

CREATE TABLE games (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE CHECK(slug ~ '^[a-z][a-z0-9-]+$'),
  name text NOT NULL, engine_name text NOT NULL,
  engine_revision text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  capabilities jsonb NOT NULL DEFAULT '{}' CHECK(jsonb_typeof(capabilities)='object')
);
CREATE TABLE rule_sets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), game_id uuid NOT NULL REFERENCES games(id),
  version integer NOT NULL CHECK(version > 0), name text NOT NULL,
  competitive boolean NOT NULL DEFAULT false,
  rules jsonb NOT NULL CHECK(jsonb_typeof(rules)='object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(game_id, name, version), UNIQUE(id, game_id, competitive)
);
CREATE TABLE communities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE, name text NOT NULL,
  created_by uuid NOT NULL REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE community_members (
  community_id uuid NOT NULL REFERENCES communities(id), user_id uuid NOT NULL REFERENCES users(id),
  role text NOT NULL DEFAULT 'member' CHECK(role IN ('owner','administrator','moderator','member')),
  status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','left','banned')),
  joined_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(community_id,user_id)
);
CREATE TABLE teams (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), community_id uuid NOT NULL REFERENCES communities(id),
  name varchar(48) NOT NULL, tag varchar(8) NOT NULL,
  logo_url text, captain_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), archived_at timestamptz,
  FOREIGN KEY(community_id,captain_id) REFERENCES community_members(community_id,user_id),
  UNIQUE(id,community_id), UNIQUE(community_id,name), UNIQUE(community_id,tag)
);
CREATE TABLE team_members (
  team_id uuid NOT NULL, community_id uuid NOT NULL, user_id uuid NOT NULL,
  role text NOT NULL DEFAULT 'member' CHECK(role IN ('captain','officer','member')),
  joined_at timestamptz NOT NULL DEFAULT now(), left_at timestamptz,
  PRIMARY KEY(team_id,user_id),
  FOREIGN KEY(team_id,community_id) REFERENCES teams(id,community_id),
  FOREIGN KEY(community_id,user_id) REFERENCES community_members(community_id,user_id)
);
CREATE INDEX team_members_user ON team_members(user_id) WHERE left_at IS NULL;
CREATE TABLE leagues (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), community_id uuid NOT NULL REFERENCES communities(id),
  name text NOT NULL, slug text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(community_id,slug), UNIQUE(id,community_id)
);
CREATE TABLE seasons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), league_id uuid NOT NULL, community_id uuid NOT NULL,
  name text NOT NULL, starts_at timestamptz NOT NULL, ends_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'scheduled' CHECK(status IN ('scheduled','active','closed','archived')),
  FOREIGN KEY(league_id,community_id) REFERENCES leagues(id,community_id),
  CHECK(ends_at > starts_at), UNIQUE(id,community_id), UNIQUE(league_id,name)
);
CREATE TABLE season_games (
  season_id uuid NOT NULL REFERENCES seasons(id), game_id uuid NOT NULL REFERENCES games(id),
  rule_set_id uuid NOT NULL, competitive boolean NOT NULL DEFAULT true CHECK(competitive),
  -- Versioned mapping converts each game's result to common league points.
  scoring_version integer NOT NULL CHECK(scoring_version > 0),
  scoring_config jsonb NOT NULL CHECK(jsonb_typeof(scoring_config)='object'),
  PRIMARY KEY(season_id,game_id), UNIQUE(season_id,game_id,rule_set_id),
  FOREIGN KEY(rule_set_id,game_id,competitive) REFERENCES rule_sets(id,game_id,competitive)
);
CREATE TABLE season_entries (
  season_id uuid NOT NULL, community_id uuid NOT NULL, user_id uuid NOT NULL,
  team_id uuid, registered_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(season_id,user_id),
  FOREIGN KEY(season_id,community_id) REFERENCES seasons(id,community_id),
  FOREIGN KEY(community_id,user_id) REFERENCES community_members(community_id,user_id),
  FOREIGN KEY(team_id,community_id) REFERENCES teams(id,community_id)
);

CREATE TABLE matches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id uuid NOT NULL REFERENCES games(id), rule_set_id uuid NOT NULL,
  community_id uuid REFERENCES communities(id), season_id uuid,
  mode text NOT NULL DEFAULT 'casual' CHECK(mode IN ('casual','ranked','tournament')),
  competitive boolean GENERATED ALWAYS AS (mode IN ('ranked','tournament')) STORED,
  status text NOT NULL DEFAULT 'lobby' CHECK(status IN ('lobby','running','completed','cancelled')),
  engine_room_id text NOT NULL, engine_instance_id text NOT NULL,
  custom_rules jsonb NOT NULL DEFAULT '{}' CHECK(jsonb_typeof(custom_rules)='object'),
  private boolean NOT NULL DEFAULT false, access_code_hash text,
  created_by uuid REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz, ended_at timestamptz,
  accepted_result_id uuid,
  FOREIGN KEY(rule_set_id,game_id,competitive) REFERENCES rule_sets(id,game_id,competitive),
  FOREIGN KEY(season_id,community_id) REFERENCES seasons(id,community_id),
  FOREIGN KEY(season_id,game_id) REFERENCES season_games(season_id,game_id),
  FOREIGN KEY(season_id,game_id,rule_set_id) REFERENCES season_games(season_id,game_id,rule_set_id),
  CHECK(season_id IS NULL OR (community_id IS NOT NULL AND mode <> 'casual')),
  CHECK(mode='casual' OR custom_rules='{}'::jsonb),
  CHECK(ended_at IS NULL OR (started_at IS NOT NULL AND ended_at >= started_at)),
  UNIQUE(engine_instance_id,engine_room_id), UNIQUE(id,game_id), UNIQUE(id,season_id,game_id)
);
CREATE INDEX matches_history ON matches(game_id, ended_at DESC) WHERE status='completed';
CREATE INDEX matches_season ON matches(season_id, ended_at DESC) WHERE season_id IS NOT NULL;
CREATE TABLE match_players (
  match_id uuid NOT NULL REFERENCES matches(id), user_id uuid NOT NULL REFERENCES users(id),
  engine_player_id text NOT NULL, display_name_snapshot text NOT NULL,
  team_id uuid REFERENCES teams(id), joined_at timestamptz NOT NULL DEFAULT now(),
  left_at timestamptz, disqualified boolean NOT NULL DEFAULT false,
  PRIMARY KEY(match_id,user_id), UNIQUE(match_id,engine_player_id)
);
CREATE INDEX match_players_history ON match_players(user_id,match_id);
CREATE TABLE spectator_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), match_id uuid NOT NULL REFERENCES matches(id),
  user_id uuid REFERENCES users(id), joined_at timestamptz NOT NULL DEFAULT now(), left_at timestamptz,
  delay_ms integer NOT NULL DEFAULT 5000 CHECK(delay_ms >= 0)
);
CREATE TABLE room_join_tickets (
  token_hash text PRIMARY KEY, match_id uuid NOT NULL REFERENCES matches(id),
  user_id uuid NOT NULL REFERENCES users(id),
  role text NOT NULL CHECK(role IN ('player','spectator')),
  created_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL,
  consumed_at timestamptz, CHECK(expires_at > created_at)
);
CREATE TABLE engine_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), match_id uuid NOT NULL REFERENCES matches(id),
  engine_instance_id text NOT NULL, sequence bigint NOT NULL CHECK(sequence >= 0),
  event_type text NOT NULL, payload jsonb NOT NULL CHECK(jsonb_typeof(payload)='object'),
  occurred_at timestamptz NOT NULL, received_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  UNIQUE(match_id,sequence), CHECK(octet_length(payload::text) <= 262144)
);
CREATE INDEX engine_events_pending ON engine_events(received_at) WHERE processed_at IS NULL;
CREATE TABLE score_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), match_id uuid NOT NULL, user_id uuid NOT NULL,
  kind text NOT NULL CHECK(kind IN ('guess','drawing','bonus','dislike_penalty','admin_correction')),
  delta integer NOT NULL, idempotency_key text NOT NULL UNIQUE,
  engine_event_id uuid REFERENCES engine_events(id),
  actor_id uuid REFERENCES users(id), reason text,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(match_id,user_id) REFERENCES match_players(match_id,user_id),
  CHECK(kind <> 'dislike_penalty' OR delta=-100),
  CHECK(kind <> 'admin_correction' OR (actor_id IS NOT NULL AND length(trim(reason)) > 0)),
  UNIQUE(id,match_id,user_id,kind,delta)
);
CREATE INDEX score_events_player ON score_events(match_id,user_id,occurred_at);
CREATE TABLE match_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), match_id uuid NOT NULL REFERENCES matches(id),
  version integer NOT NULL CHECK(version > 0),
  source text NOT NULL CHECK(source IN ('engine','admin_correction')),
  previous_result_id uuid, actor_id uuid REFERENCES users(id), reason text,
  engine_revision text NOT NULL, payload_sha256 text NOT NULL CHECK(payload_sha256 ~ '^[a-f0-9]{64}$'),
  idempotency_key text NOT NULL UNIQUE, created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(match_id,version), UNIQUE(id,match_id),
  FOREIGN KEY(previous_result_id,match_id) REFERENCES match_results(id,match_id),
  CHECK(source <> 'admin_correction' OR (actor_id IS NOT NULL AND previous_result_id IS NOT NULL AND length(trim(reason)) > 0))
);
ALTER TABLE matches ADD CONSTRAINT matches_accepted_result_fk
  FOREIGN KEY(accepted_result_id,id) REFERENCES match_results(id,match_id) DEFERRABLE INITIALLY DEFERRED;
CREATE TABLE match_result_players (
  result_id uuid NOT NULL, match_id uuid NOT NULL, user_id uuid NOT NULL,
  score integer NOT NULL, placement integer NOT NULL CHECK(placement > 0),
  won boolean NOT NULL DEFAULT false,
  rounds_won integer NOT NULL DEFAULT 0 CHECK(rounds_won >= 0),
  correct_guesses integer NOT NULL DEFAULT 0 CHECK(correct_guesses >= 0),
  fastest_guess_ms integer CHECK(fastest_guess_ms >= 0),
  game_stats jsonb NOT NULL DEFAULT '{}' CHECK(jsonb_typeof(game_stats)='object'),
  PRIMARY KEY(result_id,user_id),
  FOREIGN KEY(result_id,match_id) REFERENCES match_results(id,match_id),
  FOREIGN KEY(match_id,user_id) REFERENCES match_players(match_id,user_id),
  UNIQUE(result_id,match_id,user_id)
);
CREATE TABLE league_result_points (
  result_id uuid NOT NULL, match_id uuid NOT NULL, user_id uuid NOT NULL,
  season_id uuid NOT NULL, game_id uuid NOT NULL,
  points numeric(12,3) NOT NULL, scoring_version integer NOT NULL,
  breakdown jsonb NOT NULL DEFAULT '{}' CHECK(jsonb_typeof(breakdown)='object'),
  PRIMARY KEY(result_id,user_id),
  FOREIGN KEY(result_id,match_id,user_id) REFERENCES match_result_players(result_id,match_id,user_id),
  FOREIGN KEY(match_id,season_id,game_id) REFERENCES matches(id,season_id,game_id),
  FOREIGN KEY(season_id,user_id) REFERENCES season_entries(season_id,user_id)
);

-- These tables describe the one drawing game adapter, rather than universal matches.
CREATE TABLE drawing_turns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), match_id uuid NOT NULL,
  artist_id uuid NOT NULL, turn_number integer NOT NULL CHECK(turn_number > 0),
  round_number integer NOT NULL CHECK(round_number > 0),
  status text NOT NULL CHECK(status IN ('selecting','drawing','ended','cancelled')),
  word text, word_language text NOT NULL DEFAULT 'en',
  difficulty text NOT NULL DEFAULT 'normal' CHECK(difficulty IN ('normal','hard')),
  started_at timestamptz, ended_at timestamptz,
  electorate_size integer NOT NULL CHECK(electorate_size >= 0),
  FOREIGN KEY(match_id,artist_id) REFERENCES match_players(match_id,user_id),
  UNIQUE(match_id,turn_number), UNIQUE(id,match_id), UNIQUE(id,match_id,artist_id)
);
CREATE TABLE turn_eligible_voters (
  turn_id uuid NOT NULL, match_id uuid NOT NULL, artist_id uuid NOT NULL, voter_id uuid NOT NULL,
  PRIMARY KEY(turn_id,voter_id), CHECK(voter_id <> artist_id),
  FOREIGN KEY(turn_id,match_id,artist_id) REFERENCES drawing_turns(id,match_id,artist_id),
  FOREIGN KEY(match_id,voter_id) REFERENCES match_players(match_id,user_id)
);
CREATE TABLE drawing_dislikes (
  turn_id uuid NOT NULL, voter_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(turn_id,voter_id),
  FOREIGN KEY(turn_id,voter_id) REFERENCES turn_eligible_voters(turn_id,voter_id)
);
CREATE TABLE drawing_penalties (
  turn_id uuid PRIMARY KEY, match_id uuid NOT NULL, artist_id uuid NOT NULL,
  score_event_id uuid NOT NULL UNIQUE,
  kind text NOT NULL DEFAULT 'dislike_penalty' CHECK(kind='dislike_penalty'),
  delta integer NOT NULL DEFAULT -100 CHECK(delta=-100),
  applied_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(turn_id,match_id,artist_id) REFERENCES drawing_turns(id,match_id,artist_id),
  FOREIGN KEY(score_event_id,match_id,artist_id,kind,delta) REFERENCES score_events(id,match_id,user_id,kind,delta),
  UNIQUE(turn_id,match_id,artist_id)
);
CREATE TABLE hard_word_obligations (
  source_turn_id uuid PRIMARY KEY, match_id uuid NOT NULL, artist_id uuid NOT NULL,
  consumed_turn_id uuid UNIQUE, consumed_at timestamptz,
  FOREIGN KEY(source_turn_id,match_id,artist_id) REFERENCES drawing_penalties(turn_id,match_id,artist_id),
  FOREIGN KEY(consumed_turn_id,match_id,artist_id) REFERENCES drawing_turns(id,match_id,artist_id),
  CHECK(consumed_turn_id IS NULL OR consumed_turn_id <> source_turn_id),
  CHECK((consumed_turn_id IS NULL) = (consumed_at IS NULL))
);
CREATE INDEX hard_word_pending ON hard_word_obligations(match_id,artist_id) WHERE consumed_turn_id IS NULL;
CREATE TABLE word_catalog (
  game_id uuid NOT NULL REFERENCES games(id), language text NOT NULL, word text NOT NULL,
  difficulty text NOT NULL CHECK(difficulty IN ('normal','hard')),
  enabled boolean NOT NULL DEFAULT true, PRIMARY KEY(game_id,language,word)
);
CREATE TABLE mvp_ballots (
  match_id uuid NOT NULL, voter_id uuid NOT NULL, nominee_id uuid NOT NULL,
  category text NOT NULL CHECK(category IN ('best_drawing','fastest_guesser','community_mvp')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(match_id,voter_id,category), CHECK(voter_id <> nominee_id),
  FOREIGN KEY(match_id,voter_id) REFERENCES match_players(match_id,user_id),
  FOREIGN KEY(match_id,nominee_id) REFERENCES match_players(match_id,user_id)
);

CREATE TABLE cosmetic_definitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), slug text NOT NULL UNIQUE,
  name text NOT NULL, slot text NOT NULL CHECK(slot IN ('avatar','frame','title','badge','brush')),
  game_id uuid REFERENCES games(id), asset_url text,
  metadata jsonb NOT NULL DEFAULT '{}' CHECK(jsonb_typeof(metadata)='object'), UNIQUE(id,slot)
);
CREATE TABLE user_inventory (
  user_id uuid NOT NULL REFERENCES users(id), cosmetic_id uuid NOT NULL REFERENCES cosmetic_definitions(id),
  acquired_at timestamptz NOT NULL DEFAULT now(), source text NOT NULL,
  grant_key text NOT NULL UNIQUE, PRIMARY KEY(user_id,cosmetic_id)
);
CREATE TABLE equipped_cosmetics (
  user_id uuid NOT NULL, cosmetic_id uuid NOT NULL, slot text NOT NULL,
  PRIMARY KEY(user_id,slot),
  FOREIGN KEY(user_id,cosmetic_id) REFERENCES user_inventory(user_id,cosmetic_id),
  FOREIGN KEY(cosmetic_id,slot) REFERENCES cosmetic_definitions(id,slot)
);
CREATE TABLE xp_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES users(id),
  game_id uuid REFERENCES games(id), match_id uuid REFERENCES matches(id),
  amount integer NOT NULL CHECK(amount <> 0), reason text NOT NULL,
  idempotency_key text NOT NULL UNIQUE, created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(match_id,game_id) REFERENCES matches(id,game_id),
  CHECK(match_id IS NULL OR game_id IS NOT NULL), UNIQUE(id,user_id)
);
CREATE INDEX xp_events_user ON xp_events(user_id,created_at);
CREATE TABLE level_definitions (
  level integer PRIMARY KEY CHECK(level >= 1), minimum_xp bigint NOT NULL UNIQUE CHECK(minimum_xp >= 0),
  cosmetic_reward_id uuid REFERENCES cosmetic_definitions(id)
);
CREATE TABLE challenge_definitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), slug text NOT NULL UNIQUE,
  title text NOT NULL, game_id uuid REFERENCES games(id),
  cadence text NOT NULL CHECK(cadence IN ('daily','weekly')),
  metric text NOT NULL, target integer NOT NULL CHECK(target > 0),
  xp_reward integer NOT NULL CHECK(xp_reward > 0),
  cosmetic_reward_id uuid REFERENCES cosmetic_definitions(id), enabled boolean NOT NULL DEFAULT true
);
CREATE TABLE challenge_windows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), challenge_id uuid NOT NULL REFERENCES challenge_definitions(id),
  starts_at timestamptz NOT NULL, ends_at timestamptz NOT NULL,
  -- Snapshot reward and target so edits cannot change active challenges.
  metric text NOT NULL,
  target integer NOT NULL CHECK(target > 0), xp_reward integer NOT NULL CHECK(xp_reward > 0),
  cosmetic_reward_id uuid REFERENCES cosmetic_definitions(id),
  CHECK(ends_at > starts_at), UNIQUE(challenge_id,starts_at)
);
CREATE TABLE challenge_progress (
  window_id uuid NOT NULL REFERENCES challenge_windows(id), user_id uuid NOT NULL REFERENCES users(id),
  progress integer NOT NULL DEFAULT 0 CHECK(progress >= 0),
  completed_at timestamptz, reward_xp_event_id uuid UNIQUE REFERENCES xp_events(id),
  PRIMARY KEY(window_id,user_id),
  FOREIGN KEY(reward_xp_event_id,user_id) REFERENCES xp_events(id,user_id)
);
CREATE TABLE challenge_events (
  window_id uuid NOT NULL, user_id uuid NOT NULL, source_key text NOT NULL,
  increment integer NOT NULL CHECK(increment > 0), created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(window_id,user_id,source_key),
  FOREIGN KEY(window_id,user_id) REFERENCES challenge_progress(window_id,user_id)
);
CREATE TABLE achievement_definitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), slug text NOT NULL UNIQUE,
  title text NOT NULL, description text NOT NULL, game_id uuid REFERENCES games(id),
  criterion_version integer NOT NULL CHECK(criterion_version > 0),
  criteria jsonb NOT NULL CHECK(jsonb_typeof(criteria)='object'),
  cosmetic_reward_id uuid REFERENCES cosmetic_definitions(id)
);
CREATE TABLE user_achievements (
  user_id uuid NOT NULL REFERENCES users(id), achievement_id uuid NOT NULL REFERENCES achievement_definitions(id),
  match_id uuid REFERENCES matches(id), awarded_at timestamptz NOT NULL DEFAULT now(),
  evidence jsonb NOT NULL DEFAULT '{}' CHECK(jsonb_typeof(evidence)='object'), PRIMARY KEY(user_id,achievement_id)
);

CREATE TABLE tournaments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), community_id uuid NOT NULL REFERENCES communities(id),
  season_id uuid, game_id uuid NOT NULL REFERENCES games(id), rule_set_id uuid NOT NULL,
  competitive boolean NOT NULL DEFAULT true CHECK(competitive),
  name text NOT NULL,
  format text NOT NULL CHECK(format IN ('knockout','round_robin','groups_knockout')),
  entry_type text NOT NULL CHECK(entry_type IN ('individual','team')),
  status text NOT NULL DEFAULT 'registration' CHECK(status IN ('draft','registration','seeded','running','completed','cancelled')),
  registration_closes_at timestamptz NOT NULL, starts_at timestamptz NOT NULL,
  maximum_entries integer NOT NULL CHECK(maximum_entries >= 2),
  FOREIGN KEY(season_id,community_id) REFERENCES seasons(id,community_id),
  FOREIGN KEY(rule_set_id,game_id,competitive) REFERENCES rule_sets(id,game_id,competitive),
  CHECK(starts_at >= registration_closes_at),
  UNIQUE(id,community_id), UNIQUE(id,game_id), UNIQUE(id,entry_type)
);
CREATE TABLE tournament_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tournament_id uuid NOT NULL,
  community_id uuid NOT NULL, entry_type text NOT NULL,
  user_id uuid, team_id uuid,
  status text NOT NULL DEFAULT 'registered' CHECK(status IN ('registered','checked_in','withdrawn','disqualified')),
  seed integer CHECK(seed > 0), registered_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(tournament_id,community_id) REFERENCES tournaments(id,community_id),
  FOREIGN KEY(tournament_id,entry_type) REFERENCES tournaments(id,entry_type),
  FOREIGN KEY(community_id,user_id) REFERENCES community_members(community_id,user_id),
  FOREIGN KEY(team_id,community_id) REFERENCES teams(id,community_id),
  CHECK((entry_type='individual' AND user_id IS NOT NULL AND team_id IS NULL) OR
        (entry_type='team' AND user_id IS NULL AND team_id IS NOT NULL)),
  UNIQUE(id,tournament_id), UNIQUE(tournament_id,user_id), UNIQUE(tournament_id,team_id), UNIQUE(tournament_id,seed)
);
CREATE TABLE tournament_rosters (
  entry_id uuid NOT NULL REFERENCES tournament_entries(id), user_id uuid NOT NULL REFERENCES users(id),
  captain boolean NOT NULL DEFAULT false, locked_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(entry_id,user_id)
);
CREATE TABLE tournament_fixtures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tournament_id uuid NOT NULL,
  game_id uuid NOT NULL, match_id uuid UNIQUE,
  stage text NOT NULL CHECK(stage IN ('group','knockout','final','third_place')),
  group_label text, round_number integer NOT NULL CHECK(round_number > 0),
  position integer NOT NULL CHECK(position > 0), scheduled_at timestamptz,
  winner_entry_id uuid, advances_to_id uuid, advances_to_slot integer CHECK(advances_to_slot > 0),
  FOREIGN KEY(tournament_id,game_id) REFERENCES tournaments(id,game_id),
  FOREIGN KEY(match_id,game_id) REFERENCES matches(id,game_id),
  FOREIGN KEY(winner_entry_id,tournament_id) REFERENCES tournament_entries(id,tournament_id),
  UNIQUE(id,tournament_id), UNIQUE(tournament_id,stage,group_label,round_number,position),
  FOREIGN KEY(advances_to_id,tournament_id) REFERENCES tournament_fixtures(id,tournament_id),
  CHECK((advances_to_id IS NULL) = (advances_to_slot IS NULL)), CHECK(advances_to_id IS NULL OR advances_to_id<>id)
);
CREATE TABLE tournament_fixture_entries (
  fixture_id uuid NOT NULL, tournament_id uuid NOT NULL,
  slot integer NOT NULL CHECK(slot > 0), entry_id uuid NOT NULL,
  score numeric(12,3), PRIMARY KEY(fixture_id,slot), UNIQUE(fixture_id,entry_id),
  FOREIGN KEY(fixture_id,tournament_id) REFERENCES tournament_fixtures(id,tournament_id),
  FOREIGN KEY(entry_id,tournament_id) REFERENCES tournament_entries(id,tournament_id)
);
ALTER TABLE tournament_fixtures ADD CONSTRAINT winner_must_be_in_fixture
  FOREIGN KEY(id,winner_entry_id) REFERENCES tournament_fixture_entries(fixture_id,entry_id)
  DEFERRABLE INITIALLY DEFERRED;
CREATE UNIQUE INDEX tournament_fixture_position ON tournament_fixtures
  (tournament_id,stage,coalesce(group_label,''),round_number,position);
CREATE TABLE trophies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid REFERENCES users(id), team_id uuid REFERENCES teams(id),
  season_id uuid REFERENCES seasons(id), tournament_id uuid REFERENCES tournaments(id),
  title text NOT NULL, placement integer NOT NULL CHECK(placement > 0),
  awarded_at timestamptz NOT NULL DEFAULT now(), award_key text NOT NULL UNIQUE,
  CHECK(num_nonnulls(user_id,team_id)=1), CHECK(num_nonnulls(season_id,tournament_id)=1)
);

CREATE TABLE friendships (
  user_low uuid NOT NULL REFERENCES users(id), user_high uuid NOT NULL REFERENCES users(id),
  requested_by uuid NOT NULL REFERENCES users(id),
  status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','accepted','declined','blocked')),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(user_low,user_high), CHECK(user_low < user_high), CHECK(requested_by IN (user_low,user_high))
);
CREATE INDEX friendships_recipient ON friendships(user_high,status);
CREATE TABLE parties (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), leader_id uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(), closed_at timestamptz,
  maximum_members integer NOT NULL DEFAULT 8 CHECK(maximum_members BETWEEN 2 AND 32)
);
CREATE TABLE party_members (
  party_id uuid NOT NULL REFERENCES parties(id), user_id uuid NOT NULL REFERENCES users(id),
  joined_at timestamptz NOT NULL DEFAULT now(), left_at timestamptz, PRIMARY KEY(party_id,user_id)
);
CREATE UNIQUE INDEX one_active_party ON party_members(user_id) WHERE left_at IS NULL;
CREATE TABLE party_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), party_id uuid NOT NULL REFERENCES parties(id),
  inviter_id uuid NOT NULL, invitee_id uuid NOT NULL REFERENCES users(id),
  token_hash text NOT NULL UNIQUE, expires_at timestamptz NOT NULL,
  accepted_at timestamptz, revoked_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(party_id,inviter_id) REFERENCES party_members(party_id,user_id),
  CHECK(inviter_id <> invitee_id), CHECK(expires_at > created_at)
);
CREATE TABLE matchmaking_tickets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES users(id),
  party_id uuid REFERENCES parties(id), game_id uuid NOT NULL REFERENCES games(id),
  mode text NOT NULL CHECK(mode IN ('casual','ranked')), region text NOT NULL,
  status text NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','matched','cancelled','expired')),
  match_id uuid, previous_match_id uuid REFERENCES matches(id),
  created_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL,
  FOREIGN KEY(match_id,game_id) REFERENCES matches(id,game_id), CHECK(expires_at > created_at)
);
CREATE UNIQUE INDEX matchmaking_one_queue ON matchmaking_tickets(user_id) WHERE status='queued';

CREATE TABLE asset_policies (
  id text PRIMARY KEY, description text NOT NULL,
  retention_days integer CHECK(retention_days > 0), public_by_default boolean NOT NULL DEFAULT false
);
INSERT INTO asset_policies VALUES
  ('drawing-original','Private original; expire after 30 days',30,false),
  ('drawing-replay','Private stroke replay; expire after 7 days',7,false),
  ('summary-card','Shareable only after user opts in; expire after 90 days',90,false),
  ('curated-art','Retain while publication consent and curation remain active',NULL,false);
CREATE TABLE object_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), owner_id uuid NOT NULL REFERENCES users(id),
  policy_id text NOT NULL REFERENCES asset_policies(id),
  storage_backend text NOT NULL CHECK(storage_backend IN ('s3','minio','supabase')),
  bucket text NOT NULL, object_key text NOT NULL,
  media_type text NOT NULL, bytes bigint NOT NULL CHECK(bytes >= 0),
  sha256 text NOT NULL CHECK(sha256 ~ '^[a-f0-9]{64}$'),
  state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','ready','quarantined','deleting','deleted','failed')),
  created_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz,
  legal_hold boolean NOT NULL DEFAULT false, deleted_at timestamptz,
  UNIQUE(storage_backend,bucket,object_key), UNIQUE(id,owner_id),
  CHECK(expires_at IS NULL OR expires_at > created_at),
  CHECK(state <> 'deleted' OR deleted_at IS NOT NULL)
);
CREATE INDEX object_assets_retention ON object_assets(expires_at) WHERE state='ready' AND NOT legal_hold;
CREATE TABLE drawings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), turn_id uuid NOT NULL UNIQUE,
  match_id uuid NOT NULL, artist_id uuid NOT NULL,
  image_asset_id uuid, replay_asset_id uuid,
  prompt_snapshot text NOT NULL, dislike_count integer NOT NULL DEFAULT 0 CHECK(dislike_count >= 0),
  visibility text NOT NULL DEFAULT 'private' CHECK(visibility IN ('private','match','public')),
  publication_consent_at timestamptz, consent_revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(turn_id,match_id,artist_id) REFERENCES drawing_turns(id,match_id,artist_id),
  FOREIGN KEY(image_asset_id,artist_id) REFERENCES object_assets(id,owner_id),
  FOREIGN KEY(replay_asset_id,artist_id) REFERENCES object_assets(id,owner_id),
  CHECK(visibility <> 'public' OR (publication_consent_at IS NOT NULL AND consent_revoked_at IS NULL))
);
CREATE INDEX drawings_artist ON drawings(artist_id,created_at DESC);
CREATE TABLE gallery_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), drawing_id uuid NOT NULL REFERENCES drawings(id),
  hall text NOT NULL CHECK(hall IN ('fame','shame')),
  title text NOT NULL, caption text NOT NULL DEFAULT '', curated_by uuid NOT NULL REFERENCES users(id),
  published_at timestamptz, unpublished_at timestamptz,
  UNIQUE(drawing_id,hall), CHECK(unpublished_at IS NULL OR published_at IS NOT NULL)
);
CREATE TABLE replay_chunks (
  drawing_id uuid NOT NULL REFERENCES drawings(id), chunk_number integer NOT NULL CHECK(chunk_number >= 0),
  asset_id uuid NOT NULL REFERENCES object_assets(id),
  first_sequence bigint NOT NULL CHECK(first_sequence >= 0), last_sequence bigint NOT NULL,
  duration_ms integer NOT NULL CHECK(duration_ms >= 0),
  PRIMARY KEY(drawing_id,chunk_number), CHECK(last_sequence >= first_sequence)
);
CREATE TABLE match_share_cards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), match_id uuid NOT NULL, user_id uuid NOT NULL,
  result_id uuid NOT NULL, asset_id uuid,
  share_token_hash text NOT NULL UNIQUE, best_drawing_id uuid REFERENCES drawings(id),
  expires_at timestamptz NOT NULL, revoked_at timestamptz,
  FOREIGN KEY(match_id,user_id) REFERENCES match_players(match_id,user_id),
  FOREIGN KEY(result_id,match_id) REFERENCES match_results(id,match_id),
  FOREIGN KEY(asset_id,user_id) REFERENCES object_assets(id,owner_id)
);
CREATE TABLE asset_deletion_jobs (
  asset_id uuid PRIMARY KEY REFERENCES object_assets(id), reason text NOT NULL,
  requested_at timestamptz NOT NULL DEFAULT now(), next_attempt_at timestamptz NOT NULL DEFAULT now(),
  attempts integer NOT NULL DEFAULT 0 CHECK(attempts >= 0), completed_at timestamptz, last_error text
);

CREATE TABLE disputes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), match_id uuid NOT NULL, submitted_by uuid NOT NULL,
  reason text NOT NULL, status text NOT NULL DEFAULT 'open' CHECK(status IN ('open','reviewing','resolved','rejected')),
  assigned_to uuid REFERENCES users(id), resolved_by uuid REFERENCES users(id), resolution text,
  created_at timestamptz NOT NULL DEFAULT now(), resolved_at timestamptz,
  FOREIGN KEY(match_id,submitted_by) REFERENCES match_players(match_id,user_id),
  CHECK(status NOT IN ('resolved','rejected') OR (resolved_by IS NOT NULL AND resolved_at IS NOT NULL AND resolution IS NOT NULL))
);
CREATE TABLE moderation_bans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES users(id),
  community_id uuid REFERENCES communities(id), game_id uuid REFERENCES games(id),
  reason text NOT NULL, issued_by uuid NOT NULL REFERENCES users(id),
  starts_at timestamptz NOT NULL DEFAULT now(), ends_at timestamptz, revoked_at timestamptz,
  CHECK(ends_at IS NULL OR ends_at > starts_at)
);
CREATE INDEX moderation_active_bans ON moderation_bans(user_id,ends_at) WHERE revoked_at IS NULL;
CREATE TABLE admin_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), actor_id uuid NOT NULL REFERENCES users(id),
  community_id uuid REFERENCES communities(id), action text NOT NULL,
  entity_type text NOT NULL, entity_id uuid NOT NULL,
  reason text NOT NULL CHECK(length(trim(reason)) > 0),
  before_state jsonb, after_state jsonb, request_id text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX admin_audit_entity ON admin_audit_log(entity_type,entity_id,created_at);
CREATE TABLE outbox_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), topic text NOT NULL,
  aggregate_id uuid NOT NULL, idempotency_key text NOT NULL UNIQUE,
  payload jsonb NOT NULL CHECK(jsonb_typeof(payload)='object'),
  created_at timestamptz NOT NULL DEFAULT now(), published_at timestamptz,
  attempts integer NOT NULL DEFAULT 0 CHECK(attempts >= 0)
);
CREATE INDEX outbox_pending ON outbox_events(created_at) WHERE published_at IS NULL;

-- No mutable counters are treated as the source of truth for rankings or XP.
CREATE VIEW current_match_scores AS
  SELECT match_id,user_id,sum(delta)::bigint AS score FROM score_events GROUP BY match_id,user_id;
CREATE VIEW all_time_game_standings AS
  SELECT m.game_id,p.user_id,count(*) AS matches_played,sum(p.score)::bigint AS total_points,
    count(*) FILTER(WHERE p.won) AS wins,sum(p.correct_guesses)::bigint AS correct_guesses
  FROM matches m JOIN match_result_players p ON p.result_id=m.accepted_result_id AND p.match_id=m.id
  WHERE m.status='completed' AND m.competitive GROUP BY m.game_id,p.user_id;
CREATE VIEW season_standings AS
  SELECT l.season_id,l.user_id,sum(l.points) AS league_points,count(*) AS matches_played,
    count(*) FILTER(WHERE p.won) AS wins
  FROM league_result_points l JOIN matches m ON m.id=l.match_id AND m.accepted_result_id=l.result_id
    JOIN match_result_players p ON p.result_id=l.result_id AND p.user_id=l.user_id
  WHERE m.status='completed' GROUP BY l.season_id,l.user_id;
CREATE VIEW all_time_league_standings AS
  SELECT s.league_id,l.user_id,sum(l.points) AS league_points,
    count(*) AS matches_played,count(*) FILTER(WHERE p.won) AS wins
  FROM league_result_points l JOIN seasons s ON s.id=l.season_id
    JOIN matches m ON m.id=l.match_id AND m.accepted_result_id=l.result_id
    JOIN match_result_players p ON p.result_id=l.result_id AND p.user_id=l.user_id
  WHERE m.status='completed' GROUP BY s.league_id,l.user_id;
CREATE VIEW user_progression AS
  SELECT u.id AS user_id,coalesce(x.total_xp,0) AS total_xp,
    coalesce((SELECT max(level) FROM level_definitions WHERE minimum_xp <= coalesce(x.total_xp,0)),1) AS level
  FROM users u LEFT JOIN (SELECT user_id,sum(amount)::bigint AS total_xp FROM xp_events GROUP BY user_id) x ON x.user_id=u.id;
CREATE VIEW public_gallery AS
  SELECT g.id,g.hall,g.title,g.caption,g.published_at,d.id AS drawing_id,d.artist_id,
    d.prompt_snapshot,d.dislike_count,d.image_asset_id
  FROM gallery_entries g JOIN drawings d ON d.id=g.drawing_id
    JOIN object_assets a ON a.id=d.image_asset_id
  WHERE g.published_at IS NOT NULL AND g.unpublished_at IS NULL AND d.visibility='public'
    AND d.publication_consent_at IS NOT NULL AND d.consent_revoked_at IS NULL AND a.state='ready'
    AND (a.expires_at IS NULL OR a.expires_at > now());

CREATE FUNCTION reject_ledger_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION '% is append-only; record a compensating event', TG_TABLE_NAME; END;
$$;
DO $$ DECLARE relation_name text; BEGIN
  FOREACH relation_name IN ARRAY ARRAY['score_events','match_results','match_result_players',
    'league_result_points','xp_events','admin_audit_log','drawing_penalties','drawing_dislikes',
    'turn_eligible_voters','challenge_events','rule_sets','season_games']
  LOOP
    EXECUTE format('CREATE TRIGGER immutable_ledger BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION reject_ledger_mutation()',relation_name);
  END LOOP;
END $$;

-- Backend-only database. Deliberately no anonymous or browser-access grants.
REVOKE ALL ON SCHEMA skribbil FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA skribbil FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA skribbil FROM PUBLIC;
COMMIT;
