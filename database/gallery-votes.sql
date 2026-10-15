-- Separate from drawing_dislikes: gallery votes never affect game scores.
CREATE TABLE IF NOT EXISTS skribbil.gallery_vote_windows (
  turn_id uuid PRIMARY KEY REFERENCES skribbil.drawing_turns(id),
  closes_at timestamptz NOT NULL,
  minimum_voters smallint NOT NULL CHECK(minimum_voters BETWEEN 2 AND 24),
  majority_percent smallint NOT NULL CHECK(majority_percent BETWEEN 51 AND 100)
);
CREATE TABLE IF NOT EXISTS skribbil.gallery_votes (
  turn_id uuid NOT NULL REFERENCES skribbil.gallery_vote_windows(turn_id),
  voter_id uuid NOT NULL,
  choice text NOT NULL CHECK(choice IN ('fame','shame')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(turn_id,voter_id),
  FOREIGN KEY(turn_id,voter_id) REFERENCES skribbil.turn_eligible_voters(turn_id,voter_id)
);

CREATE OR REPLACE VIEW skribbil.gallery_vote_totals AS
SELECT w.turn_id, count(v.voter_id) FILTER(WHERE choice='fame')::int AS fame,
  count(v.voter_id) FILTER(WHERE choice='shame')::int AS shame,
  CASE WHEN w.closes_at>clock_timestamp() OR count(v.voter_id)<w.minimum_voters THEN 'no-decision'
    WHEN count(v.voter_id) FILTER(WHERE choice='fame')*100>=count(v.voter_id)*w.majority_percent THEN 'fame'
    WHEN count(v.voter_id) FILTER(WHERE choice='shame')*100>=count(v.voter_id)*w.majority_percent THEN 'shame'
    ELSE 'no-decision' END AS candidate
FROM skribbil.gallery_vote_windows w LEFT JOIN skribbil.gallery_votes v ON v.turn_id=w.turn_id
GROUP BY w.turn_id;

-- Minimal per-turn calibration summaries; no chat or per-user guess history.
ALTER TABLE skribbil.drawing_turns ADD COLUMN IF NOT EXISTS difficulty_version text NOT NULL DEFAULT 'legacy-unmeasured';
ALTER TABLE skribbil.drawing_turns ADD COLUMN IF NOT EXISTS solved_count smallint CHECK(solved_count>=0 AND solved_count<=24);
ALTER TABLE skribbil.drawing_turns ADD COLUMN IF NOT EXISTS median_guess_ms integer CHECK(median_guess_ms>=0);
ALTER TABLE skribbil.drawing_turns ADD COLUMN IF NOT EXISTS draw_time_ms integer CHECK(draw_time_ms>0);

CREATE INDEX IF NOT EXISTS drawings_match ON skribbil.drawings(match_id);
