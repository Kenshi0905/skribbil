-- Idempotent additions used by the first runnable adapter.
BEGIN;
INSERT INTO skribbil.asset_policies(id,description,retention_days,public_by_default)
VALUES('profile-image','Public while equipped; replaced images removed after one day',NULL,true) ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS skribbil.engine_receipts (
  event_id uuid PRIMARY KEY REFERENCES skribbil.engine_events(id),
  payload_sha256 text NOT NULL CHECK(payload_sha256 ~ '^[a-f0-9]{64}$')
);
CREATE TABLE IF NOT EXISTS skribbil.user_game_penalty_state (
  user_id uuid NOT NULL REFERENCES skribbil.users(id),game_id uuid NOT NULL REFERENCES skribbil.games(id),
  pending boolean NOT NULL,occurred_at timestamptz NOT NULL,source_event_id uuid NOT NULL REFERENCES skribbil.engine_events(id),
  PRIMARY KEY(user_id,game_id)
);
UPDATE skribbil.level_definitions SET cosmetic_reward_id='00000000-0000-4000-8000-000000000062' WHERE level=2 AND cosmetic_reward_id IS NULL;
-- 'local' is exclusively for private filesystem development, never a public bucket.
ALTER TABLE skribbil.object_assets DROP CONSTRAINT IF EXISTS object_assets_storage_backend_check;
ALTER TABLE skribbil.object_assets ADD CONSTRAINT object_assets_storage_backend_check CHECK(storage_backend IN ('s3','minio','supabase','local'));
COMMIT;
