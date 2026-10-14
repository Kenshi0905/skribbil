-- Preserve persistence for existing sessions and legacy writers during rolling
-- deployment. New session creation always supplies its explicit opt-in boolean.
ALTER TABLE skribbil.auth_sessions ADD COLUMN IF NOT EXISTS remember_me boolean NOT NULL DEFAULT true;
