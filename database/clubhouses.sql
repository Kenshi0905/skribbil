-- Invite-only friend groups share universal identities across every game.
-- They do not create, replace, or own leagues or global communities.
BEGIN;
CREATE TABLE IF NOT EXISTS skribbil.clubhouses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name varchar(48) NOT NULL CHECK(length(trim(name)) BETWEEN 2 AND 48),
  description text NOT NULL DEFAULT '' CHECK(length(description)<=500),
  owner_id uuid NOT NULL REFERENCES skribbil.users(id),
  created_by uuid NOT NULL REFERENCES skribbil.users(id),
  created_at timestamptz NOT NULL DEFAULT now(), archived_at timestamptz
);
CREATE TABLE IF NOT EXISTS skribbil.clubhouse_members (
  clubhouse_id uuid NOT NULL REFERENCES skribbil.clubhouses(id),
  user_id uuid NOT NULL REFERENCES skribbil.users(id),
  role text NOT NULL DEFAULT 'member' CHECK(role IN ('owner','admin','member')),
  joined_at timestamptz NOT NULL DEFAULT now(), left_at timestamptz,
  PRIMARY KEY(clubhouse_id,user_id)
);
CREATE INDEX IF NOT EXISTS clubhouse_members_user ON skribbil.clubhouse_members(user_id) WHERE left_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS clubhouse_one_active_owner ON skribbil.clubhouse_members(clubhouse_id) WHERE role='owner' AND left_at IS NULL;
DO $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='clubhouse_owner_membership_fk' AND conrelid='skribbil.clubhouses'::regclass) THEN
    ALTER TABLE skribbil.clubhouses ADD CONSTRAINT clubhouse_owner_membership_fk FOREIGN KEY(id,owner_id)
      REFERENCES skribbil.clubhouse_members(clubhouse_id,user_id) DEFERRABLE INITIALLY DEFERRED;
  END IF;
END; $$;
CREATE TABLE IF NOT EXISTS skribbil.clubhouse_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), requested_by uuid NOT NULL REFERENCES skribbil.users(id),
  name varchar(48) NOT NULL CHECK(length(trim(name)) BETWEEN 2 AND 48),
  description text NOT NULL DEFAULT '' CHECK(length(description)<=500),
  status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),
  clubhouse_id uuid UNIQUE REFERENCES skribbil.clubhouses(id),
  created_at timestamptz NOT NULL DEFAULT now(), decided_by uuid REFERENCES skribbil.users(id),
  decided_at timestamptz, decision_reason text,
  CHECK((status='pending' AND clubhouse_id IS NULL AND decided_by IS NULL AND decided_at IS NULL AND decision_reason IS NULL)
    OR (status IN ('approved','rejected') AND decided_by IS NOT NULL AND decided_at IS NOT NULL AND decision_reason IS NOT NULL
      AND length(trim(decision_reason)) BETWEEN 5 AND 2000 AND ((status='approved')=(clubhouse_id IS NOT NULL))))
);
CREATE UNIQUE INDEX IF NOT EXISTS clubhouse_one_pending_request ON skribbil.clubhouse_requests(requested_by) WHERE status='pending';
CREATE INDEX IF NOT EXISTS clubhouse_requests_inbox ON skribbil.clubhouse_requests(status,created_at);
CREATE TABLE IF NOT EXISTS skribbil.clubhouse_invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), clubhouse_id uuid NOT NULL REFERENCES skribbil.clubhouses(id),
  inviter_id uuid NOT NULL REFERENCES skribbil.users(id), invitee_id uuid NOT NULL REFERENCES skribbil.users(id),
  token_hash text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL,
  accepted_at timestamptz, revoked_at timestamptz,
  CHECK(inviter_id<>invitee_id), CHECK(expires_at>created_at)
);
CREATE UNIQUE INDEX IF NOT EXISTS clubhouse_invitation_pending ON skribbil.clubhouse_invitations(clubhouse_id,invitee_id)
  WHERE accepted_at IS NULL AND revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS clubhouse_invitation_inbox ON skribbil.clubhouse_invitations(invitee_id,expires_at)
  WHERE accepted_at IS NULL AND revoked_at IS NULL;

CREATE OR REPLACE FUNCTION skribbil.protect_clubhouse_request_decision() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Clubhouse requests are retained for audit.'; END IF;
  IF OLD.status<>'pending' AND NEW IS DISTINCT FROM OLD THEN
    RAISE EXCEPTION 'A clubhouse request decision is immutable.';
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS clubhouse_request_decision_immutable ON skribbil.clubhouse_requests;
CREATE TRIGGER clubhouse_request_decision_immutable BEFORE UPDATE OR DELETE ON skribbil.clubhouse_requests
  FOR EACH ROW EXECUTE FUNCTION skribbil.protect_clubhouse_request_decision();

ALTER TABLE skribbil.matches ADD COLUMN IF NOT EXISTS clubhouse_id uuid REFERENCES skribbil.clubhouses(id);
ALTER TABLE skribbil.matches DROP CONSTRAINT IF EXISTS clubhouse_rooms_private;
ALTER TABLE skribbil.matches ADD CONSTRAINT clubhouse_rooms_private CHECK(clubhouse_id IS NULL OR (private AND mode='casual'));
CREATE INDEX IF NOT EXISTS matches_clubhouse ON skribbil.matches(clubhouse_id,created_at DESC) WHERE clubhouse_id IS NOT NULL;
REVOKE ALL ON skribbil.clubhouses,skribbil.clubhouse_members,skribbil.clubhouse_requests,skribbil.clubhouse_invitations FROM PUBLIC;
COMMIT;
