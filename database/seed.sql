-- Safe to run repeatedly. Configuration only: no fabricated players, wins or results.
BEGIN;
SET LOCAL search_path = skribbil, public;
INSERT INTO users(id,username,display_name,status)
VALUES ('00000000-0000-4000-8000-000000000001','skribbil_system','Skribbil system','active')
ON CONFLICT DO NOTHING;
INSERT INTO communities(id,slug,name,created_by)
VALUES ('00000000-0000-4000-8000-000000000010','skribbil','Skribbil community',
  '00000000-0000-4000-8000-000000000001') ON CONFLICT DO NOTHING;
-- Upgrade the original community configuration without changing its identity.
UPDATE communities SET slug='skribbil',name='Skribbil community'
WHERE id='00000000-0000-4000-8000-000000000010';
-- Remove only the unused legacy seeded league. Preserve administrator seasons.
DELETE FROM leagues WHERE id='00000000-0000-4000-8000-000000000040'
  AND NOT EXISTS (SELECT 1 FROM seasons WHERE league_id=leagues.id);
UPDATE leagues SET name='Community league',slug='community-league'
WHERE id='00000000-0000-4000-8000-000000000040';
INSERT INTO community_members(community_id,user_id,role)
VALUES ('00000000-0000-4000-8000-000000000010','00000000-0000-4000-8000-000000000001','owner')
ON CONFLICT DO NOTHING;
INSERT INTO games(id,slug,name,engine_name,engine_revision,capabilities)
VALUES ('00000000-0000-4000-8000-000000000020','skribbil','Skribbil','scribble.rs','1bda7ed8b880bb598dede5096c0e2f3f58abe0b8',
  '{"drawing":true,"guessing":true,"spectators":true,"replays":true,"timedReplays":false}') ON CONFLICT DO NOTHING;
INSERT INTO rule_sets(id,game_id,version,name,competitive,rules) VALUES
  ('00000000-0000-4000-8000-000000000030','00000000-0000-4000-8000-000000000020',1,'Private',false,
    '{"rounds":3,"drawingTime":80,"maxPlayers":8,"language":"en","dislikePenalty":100,"hardWordNextTurn":true}'),
  ('00000000-0000-4000-8000-000000000031','00000000-0000-4000-8000-000000000020',1,'Standard ranked',true,
    '{"rounds":3,"drawingTime":80,"maxPlayers":8,"language":"en","dislikePenalty":100,"hardWordNextTurn":true}')
ON CONFLICT DO NOTHING;
-- Actual seasons and tournaments are created by an administrator. Fresh
-- installations have no placeholder schedules, entrants, activity or results.
INSERT INTO cosmetic_definitions(id,slug,name,slot,metadata) VALUES
  ('00000000-0000-4000-8000-000000000060','rookie','Rookie','title','{"color":"#ffd34d"}'),
  ('00000000-0000-4000-8000-000000000062','violet-frame','Violet victory','frame','{"color":"#8064e8"}'),
  ('00000000-0000-4000-8000-000000000061','inkcredible','Inkcredible','title','{"color":"#a991ff"}')
ON CONFLICT DO NOTHING;
INSERT INTO level_definitions(level,minimum_xp,cosmetic_reward_id) VALUES
  (1,0,'00000000-0000-4000-8000-000000000060'),(2,150,'00000000-0000-4000-8000-000000000062'),(3,400,NULL),(4,750,NULL),
  (5,1200,'00000000-0000-4000-8000-000000000061'),(6,1800,NULL),(7,2600,NULL),
  (8,3600,NULL),(9,4800,NULL),(10,6200,NULL)
ON CONFLICT DO NOTHING;
INSERT INTO challenge_definitions(id,slug,title,game_id,cadence,metric,target,xp_reward) VALUES
  ('00000000-0000-4000-8000-000000000070','daily-play-three','Play 3 matches',
    '00000000-0000-4000-8000-000000000020','daily','matches_completed',3,100),
  ('00000000-0000-4000-8000-000000000071','weekly-win-three','Win 3 matches',
    '00000000-0000-4000-8000-000000000020','weekly','matches_won',3,250)
ON CONFLICT DO NOTHING;
INSERT INTO achievement_definitions(slug,title,description,game_id,criterion_version,criteria) VALUES
  ('mind-reader','Mind Reader','Guess correctly within 5 seconds.',
    '00000000-0000-4000-8000-000000000020',1,'{"metric":"guess_elapsed_ms","maximum":5000}'),
  ('comeback-kid','Comeback Kid','Win after being last at the start of the final round.',
    '00000000-0000-4000-8000-000000000020',1,'{"metric":"comeback_win","final_round_start_rank":"last"}')
ON CONFLICT DO NOTHING;
INSERT INTO word_catalog(game_id,language,word,difficulty) VALUES
  ('00000000-0000-4000-8000-000000000020','en','photosynthesis','hard'),
  ('00000000-0000-4000-8000-000000000020','en','archaeologist','hard'),
  ('00000000-0000-4000-8000-000000000020','en','metamorphosis','hard'),
  ('00000000-0000-4000-8000-000000000020','en','constellation','hard'),
  ('00000000-0000-4000-8000-000000000020','en','optical illusion','hard'),
  ('00000000-0000-4000-8000-000000000020','en','time paradox','hard'),
  ('00000000-0000-4000-8000-000000000020','en','ecosystem','hard'),
  ('00000000-0000-4000-8000-000000000020','en','perspective','hard')
ON CONFLICT DO NOTHING;
COMMIT;
