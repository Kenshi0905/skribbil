-- Account-targeted team invitations. Apply after schema.sql/runtime.sql.
BEGIN;
CREATE TABLE IF NOT EXISTS skribbil.team_invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id uuid NOT NULL, community_id uuid NOT NULL,
  inviter_id uuid NOT NULL, invitee_id uuid NOT NULL,
  token_hash text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL,
  accepted_at timestamptz, revoked_at timestamptz,
  FOREIGN KEY(team_id,community_id) REFERENCES skribbil.teams(id,community_id),
  FOREIGN KEY(team_id,inviter_id) REFERENCES skribbil.team_members(team_id,user_id),
  FOREIGN KEY(community_id,invitee_id) REFERENCES skribbil.community_members(community_id,user_id),
  CHECK(inviter_id<>invitee_id), CHECK(expires_at>created_at)
);
CREATE UNIQUE INDEX IF NOT EXISTS team_invitation_pending ON skribbil.team_invitations(team_id,invitee_id)
  WHERE accepted_at IS NULL AND revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS team_invitation_inbox ON skribbil.team_invitations(invitee_id,expires_at)
  WHERE accepted_at IS NULL AND revoked_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS disputes_one_open ON skribbil.disputes(match_id,submitted_by)
  WHERE status IN ('open','reviewing');
REVOKE ALL ON skribbil.team_invitations FROM PUBLIC;
COMMIT;
