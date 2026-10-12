# Skribbil data model

`database/schema.sql` is a transactional, extension-free PostgreSQL 16+ baseline. It creates the `skribbil` schema. Apply it once to a new database; future changes belong in numbered migrations. It also works with an embedded PostgreSQL runtime that implements the same SQL. The schema describes the complete target platform. A table's presence does not mean its corresponding HTTP endpoint, background worker, or game hook has been implemented.

The runnable application then applies `seed.sql`, `runtime.sql`, `community.sql`
and `rematch.sql` in that order. The latter additions are idempotent and add
engine receipts, account hard-word state, public profile-image policies,
recipient-bound team invitations and one successor room per completed match.
Run `npm run db:migrate` to apply the same sequence outside application startup.

## Identity and game boundaries

An account has one immutable UUID in `users`. The username has a case-insensitive unique index; `display_name` is separate from the login identifier. Deleting a membership or leaving a game does not replace this UUID. Future games receive the same account ID, community memberships, equipment, inventory, progression, and friendships.

`credentials` contains a slow password hash, never a password. Use Argon2id or a deliberately configured scrypt implementation. `auth_identities` maps provider subject IDs to accounts. `auth_sessions` stores only a digest of a cryptographically random bearer token, with an expiry and revocation time. Browser cookies must be HttpOnly, Secure in production, SameSite=Lax or stricter, and rotated after login. Do not place session tokens or provider credentials in engine URLs or room broadcasts.

`games` is the adapter registry. Its ID appears in game-specific configuration and statistics, not in the identity primary key. `rule_sets` are immutable, versioned records. Ranked and tournament matches must reference a competitive rule set; their custom-rule JSON must be empty. A casual match references a noncompetitive base rule set and may have validated overrides. The game adapter validates the JSON against its own schema before room creation.

`communities` and `community_members` provide shared social identity. A league belongs to a community, and a season belongs to a league. A season can contain several games through `season_games`. Each row fixes that game's competitive rules and its conversion to common league points. A league does not need to be recreated when another game is added. Start a new season instead of deleting or zeroing old season results.

## Table map

| Area | Tables | Purpose |
| --- | --- | --- |
| Accounts | `users`, `credentials`, `auth_identities`, `auth_sessions`, `platform_roles` | Universal account, authentication and platform permissions |
| Community | `communities`, `community_members`, `teams`, `team_members` | Shared identity, community roles and named clans |
| Game registry | `games`, `rule_sets`, `word_catalog` | Engine adapters, frozen standard rules, curated word difficulty |
| League | `leagues`, `seasons`, `season_games`, `season_entries`, `league_result_points` | Cross-game competitions with permanent seasonal history |
| Matches | `matches`, `match_players`, `spectator_sessions`, `room_join_tickets` | Room mapping, authenticated player identity and separate spectators |
| Engine ingestion | `engine_events`, `outbox_events` | Sequenced, deduplicated ingestion and transactional publication |
| Results | `score_events`, `match_results`, `match_result_players` | Append-only scoring and versioned accepted results |
| Drawing adapter | `drawing_turns`, `turn_eligible_voters`, `drawing_dislikes`, `drawing_penalties`, `hard_word_obligations` | Per-turn evidence, one penalty per turn and hard-word carryover within a match |
| Progression | `xp_events`, `level_definitions`, `challenge_definitions`, `challenge_windows`, `challenge_progress`, `challenge_events` | Universal XP and deduplicated daily/weekly challenge rewards |
| Cosmetics | `cosmetic_definitions`, `user_inventory`, `equipped_cosmetics` | Owned frames, titles, avatars, badges and game-specific tools |
| Achievements | `achievement_definitions`, `user_achievements`, `trophies` | Evidence-backed feats and competition placements |
| Tournaments | `tournaments`, `tournament_entries`, `tournament_rosters`, `tournament_fixtures`, `tournament_fixture_entries` | Individual/team registration, roster snapshots, group stages and knockout advancement |
| Social | `friendships`, `parties`, `party_members`, `party_invites`, `matchmaking_tickets`, `mvp_ballots` | Friends, invitations, rematches, queue membership and participant-only MVP votes |
| Media | `asset_policies`, `object_assets`, `drawings`, `gallery_entries`, `replay_chunks`, `match_share_cards`, `asset_deletion_jobs` | Private object references, retention, publication and replay metadata |
| Moderation | `disputes`, `moderation_bans`, `admin_audit_log` | Dispute resolution, scope-specific bans and immutable admin history |

## Results and ranking

The Go room remains the authority for a running game's score. The wrapper accepts authenticated engine events, not browser-submitted scores. A monotonic per-match `sequence` and unique `(match_id, sequence)` deduplicate transport retries. Save the event and resulting ledger rows in the same transaction, then publish notifications through the outbox. Mark processing complete only after the transaction has committed. A worker retry must reuse the original idempotency keys.

`score_events` stores deltas, including negative values. A dislike penalty is exactly `-100`; it is not clamped at zero. `current_match_scores` is a projection of these events. The final engine score is not another additive score event: doing that would count all the points twice.

`match_results` and `match_result_players` are immutable result snapshots. `matches.accepted_result_id` points to the accepted version for that same match. A correction creates a new result version, replacement league-point rows, a compensating score event if needed, and an audit record in one transaction, then changes the accepted pointer. It never edits the original result or overwrites the audit trail. Require a meaningful reason, administrator authorization, and a version check or row lock to prevent lost updates.

The views provide:

- `all_time_game_standings`: competitive raw points, wins and guesses per game; different games' raw scores are never treated as equivalent.
- `season_standings`: normalized league points for one season, using only accepted results.
- `all_time_league_standings`: normalized points across a league's historical seasons and participating games.
- `user_progression`: XP derived from immutable XP events and the configured level thresholds.

Order leaderboards by points descending, wins descending, then account UUID for stable pagination. Use `dense_rank()` on the competitive fields if tied players should share a rank. Historical season totals remain accessible after closure. Materialized views or cached projections may be added later, but must remain rebuildable from accepted results.

## Referential guarantees and service checks

Composite foreign keys prevent a season from silently referring to another community, a league match from using another game's rules, a result from being accepted for another match, a dislike from someone outside its electorate, a penalty from targeting another artist, and a consumed hard-word obligation from moving to another artist or match. Ranked custom overrides and noncompetitive ranked rule sets are rejected by database constraints.

Cosmetic equipment must refer to an item the account owns and to the correct slot. Tournament entrants must match the competition's individual/team entry type, and a recorded fixture winner must be a participant in that fixture. Score, result, XP, vote, ruleset and audit histories reject updates and deletes through triggers. Keys on grants, engine events and rewards make retries safe.

Some invariants require a service transaction or the room's existing lock because they depend on time, permission, or a collection of rows:

- Check active community membership, team captain authority, administrator/moderator scope and all applicable bans on every protected action.
- Check tournament registration deadlines, capacity, unique users across locked team rosters, full roster eligibility, seeding validity, fixture rule-set/community agreement and acyclic bracket advancement.
- Keep the party leader in the active membership, enforce capacity, and update `left_at` for all members when a party closes.
- Validate challenge metrics against trusted events; freeze definition values into challenge windows. Use a consistent timezone for daily/weekly boundaries; the recommended community default is Asia/Kolkata, storing timestamps in UTC.
- Lock `challenge_progress` when completing a reward, insert a unique XP event and inventory grant, and update completion state in the same transaction. Never let a client-supplied progress number or claim button satisfy the challenge itself.
- Verify the XP event's game matches the match, require a supported cosmetic game when equipping a game-specific slot, and snapshot relevant scoring/achievement policy versions.
- Accept MVP votes only after the match ends, within a configured voting deadline, from eligible participants; spectators cannot vote and users cannot nominate themselves.
- Authorize every private asset read, restrict content types and maximum size, and issue short-lived signed object-store URLs after authorization. A UUID is not an access-control mechanism.

The API is the only public interface to this database. No browser, engine participant, or anonymous client receives database credentials. The baseline revokes PUBLIC access. Deployment should use distinct migration, API and worker roles with explicit grants; the API role must not own tables or be able to disable triggers. Community authorization must be enforced in the API; this baseline does not pretend to provide a complete row-level-security policy.

## The dislike transaction

Interpret unanimity as every eligible guesser, excluding the artist and spectators. Requiring the artist to dislike their own drawing would make the penalty optional. Snapshot the electorate at drawing start; late joins do not join that turn's electorate, reconnects retain the same account identity, and disconnecting does not shrink the threshold. A zero-voter room can never trigger the penalty. Apply any minimum-room-size or anti-collusion policy before a ranked match begins.

The real-time implementation executes inside the existing Go room mutation/locking model:

1. Resolve the authenticated account from its signed room ticket, then validate the turn, drawing phase, participant role and electorate membership.
2. Record the vote once per account and turn. Count the snapshot's eligible voters, not socket connections.
3. If the electorate is nonempty and every eligible voter has voted, atomically mark this turn penalized, subtract 100 from the artist's engine score, and set the artist's next-hard-word flag. Repeated messages must see the existing penalty and do nothing.
4. Emit sequenced events. The backend transaction inserts a `score_events` row with `kind='dislike_penalty'`, a `drawing_penalties` row, and a `hard_word_obligations` row. The primary key on `drawing_penalties.turn_id` guarantees one archived penalty per turn.
5. Before that artist's next word offer, consume the pending flag in the room's existing word-selection path and supply only words from the curated hard pool for the room's language. Preserve the original selection timeout, scoring, turn rotation and drawing WebSocket behavior.
6. Record the selected next turn in `hard_word_obligations.consumed_turn_id` and its timestamp when consumption occurs in the same match. This baseline reference must be the same artist and match. The runnable adapter additionally uses `user_game_penalty_state` from `database/runtime.sql` to retain pending hard-word debt across rooms for the same account and game; the signed join ticket carries that state into the next room. The original obligation remains historical evidence when consumed in a later match. Do not allow parallel active rooms to race consumption of the same account's debt.

The database is not queried for each brush stroke or vote. Slow PostgreSQL/object-store traffic must never hold the room mutex. Database rows are durable evidence of engine decisions; replaying an archived penalty must not deduct points from an already-running room again. On restoration, rebuild the room's applied-event set before accepting commands.

## Artwork storage and privacy

This checkout does not provision a cloud object store or require an OMV machine. The runnable adapter creates PNGs and compressed canonical drawing operations, uses private local files for development, and supports a configured private S3-compatible bucket for hosting. Public deployment still requires the external bucket and its credentials. Drawing metadata can exist without an image or replay reference when capture is unavailable. The database schema alone does not run capture or retention workers.

Store binary image and replay bodies in a private S3-compatible object store. Keep object keys, ownership, checksums, dimensions/format metadata, retention timestamps and moderation state in PostgreSQL. The initial schema stores shared object metadata in `object_assets`; dimensions or richer media metadata can be added without moving binary data into the database. Use compressed replay chunks rather than inserting every pointer move as a relational row.

| Choice | Benefits | Costs and constraints |
| --- | --- | --- |
| PostgreSQL `bytea`/large JSON | One transactional backup boundary; simple for tiny prototypes | Enlarges WAL, replication, backups and memory pressure; binary delivery competes with account and leaderboard queries; poor fit for large stroke streams |
| Managed PostgreSQL + private object store | Separate scaling, lifecycle rules, reliable bandwidth and CDN support; no home inbound ports | Hosting cost, provider trust and region selection; egress charges; configure bucket privacy and retention explicitly |
| OMV PC + S3-compatible service | Physical control, local backups, inexpensive existing disk capacity | Home uplink limits, power/ISP outages, CGNAT or port forwarding, TLS, security updates, monitoring and off-site recovery become operational work |
| SMB exposed to clients | No appropriate benefit for public game delivery | Do not expose SMB to the internet or browsers; it is a private file-sharing transport rather than an authenticated web asset API |

Recommended public launch when asset storage is enabled: PostgreSQL plus a private managed S3-compatible bucket. Keep the same S3 interface for a later migration to a self-hosted object service. OMV is optional future backup infrastructure, not a launch dependency or a current deployment step. If all participants are on a trusted LAN or VPN, OMV could serve as primary storage; for public competitions it should not be the single availability dependency. A tunnel or reverse proxy can solve reachability but does not increase home upload bandwidth or power reliability.

Self-hosting improves custody, not automatic privacy. Either deployment still requires least-privilege credentials, TLS, at-rest encryption where available, tested restores, access logs, explicit publication consent and a deletion policy. The API should strip unnecessary identifying metadata from derived images. Do not store an expiring signed URL in `object_assets`; store the stable bucket and object key.

Default policies are inserted in `asset_policies`:

- Drawing originals: private, delete after 30 days.
- Stroke replays: private, delete after 7 days.
- Share cards: expire after 90 days, with a revocable share token and explicit user sharing.
- Curated artwork: retain while curation and publication consent remain valid; unpublish immediately after consent is revoked, then schedule deletion under the retention policy.

The worker stamps `expires_at` when it creates an asset, queues expired objects in `asset_deletion_jobs`, deletes the object, verifies completion, and only then marks the row deleted. Deleting metadata alone does not delete the blob. Retry object deletion with the same object key. Legal holds must be exceptional, access-controlled and audited. Apply corresponding lifecycle/deletion windows to replicas and backups; document the maximum backup expiry rather than promising immediate removal from immutable backups.

Automatically capture a completed turn's drawing privately. Admin curation publishes only after the artist opts in, including Hall of Shame entries. `public_gallery` excludes revoked consent, unpublished records, missing/deleted objects and expired objects. Public gallery endpoints must use this view or equivalent checks. Replays and spectator streams must withhold the secret word until the turn is over; a drawing game's privileged engine payload is not a safe spectator feed.

## Runtime setup and evolution

Seed in dependency order: account, community, community membership, game, casual/competitive rule sets, league, season, season-game configuration, then player registrations and optional cosmetics/challenges. All UUIDs can be generated by PostgreSQL; use returned IDs instead of assuming a fixed seed value. Match ingestion then creates the match, participants, turns and result snapshots in causal order.

Use explicit schema-qualified queries or configure each database connection's `search_path` to `skribbil,public`. Run migrations once under a migration lock and record their checksums in the application's migration table. Do not rerun the baseline for every request. UTC timestamps are stored as `timestamptz`; display dates using the community's configured timezone.

Accounts with retained competitive history should be pseudonymized when erased, revoke all sessions, remove external identities and credentials, revoke publication consent, and queue owned media for deletion. Keep only the minimum lawful audit/result records and make the retention policy visible. Soft membership exits preserve cross-community foreign keys and historical rosters. Database dumps and external object backups must be tested together so retained metadata still resolves to the intended asset.
