-- One durable successor per finished match. A retry keeps the same engine ID;
-- network failures never allocate a second room or turn an unfinished match
-- into a completed result. Kept game-agnostic for future engine adapters.
CREATE TABLE IF NOT EXISTS skribbil.match_rematches (
  source_match_id uuid PRIMARY KEY REFERENCES skribbil.matches(id),
  target_match_id uuid NOT NULL UNIQUE REFERENCES skribbil.matches(id),
  requested_by uuid NOT NULL REFERENCES skribbil.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK(source_match_id <> target_match_id)
);
