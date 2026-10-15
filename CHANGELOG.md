# Changelog

## 2026-10-15 — Identity, gallery nominations and phone hygiene

- Integrated the latest main changes while preserving avatar/photo uploads, auth, waiting-room settings, room controls and results.
- Removed the community header status pill; current display names replace account handles in social rosters. Trusted engine identity refresh broadcasts profile name changes, including reconnects, while retaining explicit room looks.
- Added separate persisted Fame/Shame nominations with fixed eligibility, one vote, closing windows, minimum/majority thresholds and no-decision handling. Publication still requires consent and moderation; withdrawal requires fresh curation.
- Limited penalty dislikes to one per account per round without changing the unanimous −100/hard-word consequence. Added reduced-motion-aware visual turn handoffs and a prominent room-entry action.
- Capped post-game unpublished art at 24 hours and replays at one hour; transient engine strokes are released after durable archival events are queued. Votes never retain or duplicate images.
- Added original versioned difficulty calibration telemetry and documented public skribbl.io observations separately from design choices. Human difficulty calibration remains unverified; REA capture was unavailable without a CDP endpoint.


Each major milestone is committed and pushed separately under the repository
owner's configured Git identity. Unreleased work is described honestly; feature
designs are not treated as completed runtime features.

## Friend request controls - 2026-10-13

- Incoming friend requests now offer one-click Accept and Decline controls;
  sent requests show Request sent. Only accepted connections count as friends.
- Only the recipient can decide a pending request. Repeated decisions are safe,
  and a declined request cannot be repeatedly reopened by its sender.
- Preserved reciprocal Add Friend acceptance and corrected concurrent first
  requests so they settle into one friendship.
- Verified both actions through the browser, including a 390px phone layout with
  fully visible 44px controls. HTTP and UI regression tests cover permissions,
  retries, failed requests, refresh failures and account changes.

## Casual preview launch - 2026-10-13

- Published [Skribbil](https://skribbil.pages.dev) on Cloudflare Pages Free, with
  [one Render Free Docker service](https://skribbil.onrender.com) in Singapore
  running Node and Go, and Supabase Free PostgreSQL/private storage in the
  Skribbil Games organization.
- Deployed revision [`dab93f4`](https://github.com/Kenshi0905/skribbil/commit/dab93f4);
  all four jobs passed in [CI run 38290967168](https://github.com/Kenshi0905/skribbil/actions/runs/38290967168).
- Verified live site/backend health, PostgreSQL TLS with hostname and CA checks,
  and private storage upload, signed read, anonymous-read denial, and deletion.
- Privately provisioned two real administrator accounts without publishing credentials.
- Configured Pages backend bindings only for production, left preview bindings
  empty, and kept automatic deployments off.
- Kept ranked disabled: free hosting can sleep or restart, live rooms are in
  memory, and the event outbox is not durable across container replacement.
- Passed live authentication and WSS checks with two players and one spectator
  in an unstarted private room: chat, spectator restrictions, and identity access.
  A focused two-player reconnect check passed with graceful close acknowledgement,
  preserved identity, an empty canvas, and zero scores.
- Removed all five synthetic accounts and both unstarted test rooms in a guarded
  transaction, preserving both real administrators. Final database: two real
  players, zero matches, results, or drawings. No full production match was
  started; gameplay is covered by the isolated local/CI ten-player playtest.
  See [verification](docs/verification.md). README media remains an edited local
  demonstration, and no physical-phone test coverage is claimed.

- Removed sample rooms, leaderboards, artwork, brackets, cosmetics, and player
  progress from the live interface; empty and unavailable states are explicit.
- Fresh databases keep required game catalogs but create no placeholder seasons,
  player accounts, tournament entries, results, drawings, or earned progress.
- Corrected tournament membership and PostgreSQL room/team count displays.
- Enforced verified TLS for production PostgreSQL, including hostname checks and
  optional provider CA configuration; unsafe SSL URL overrides are rejected.
- Added conservative S3-compatible checksum settings with SDK request coverage.

## 0.2.0 - Private groups and mobile play, 2026-10-12

- Added game-independent, invite-only Clubhouses. Platform admins create them
  directly or approve player requests; owners manage invitations and membership.
- Enforced Clubhouse privacy at room creation, admission, native HTTP/WebSocket
  entry and rematch. Removing a member disconnects their live game connection.
- Added password changes with current-password verification, session rotation
  and revocation of older sessions. No user credentials are included in source.
- Bound managed native engine sessions to the authenticated universal account.
- Replaced fragile mouse/touch dispatch with captured Pointer Events while
  keeping the original canvas renderer, drawing protocol and Go game loop.
- Fixed cropped desktop league cards and added phone navigation, usable chat,
  scrollable player/palette strips and larger touch controls.
- Lowered the default pop to 20% amplitude, coalesced simultaneous pops, and
  added persistent sound volume with Web Audio gain for supported mobile browsers.
- Passed a real ten-player, two-round protocol playtest with three mobile
  User-Agent profiles, a spectator, reconnects, penalties and result archival.
  Mobile profiles and input tests do not claim physical-phone coverage.
- Added staged and outgoing-history secret guards and a CI container build; kept automatic deployment
  disabled and all runtime secrets, databases and test credentials Git-ignored.

- Added real desktop/mobile screenshots, an animated gameplay preview and silent
  MP4 to the README, with explicit synthetic-account and test-coverage notes.

## 0.1.0 - Local preview, 2026-10-12

### Architecture and foundation
- Established universal accounts and a game-independent competition model.
- Selected PostgreSQL plus private object storage; OMV is an optional backup target.
- Preserved scribble.rs as the authoritative game engine.
- Added local development and production configuration boundaries.

### Original engine integration
- Pinned upstream at 1bda7ed8b880bb598dede5096c0e2f3f58abe0b8 and retained its license.
- Added signed universal-account room admission and server-locked ranked settings.
- Added frozen-electorate unanimous dislikes, exact -100 scoring and hard-word debt.
- Preserved native spectators, canvas raster algorithms and the original WebSocket client.
- Fixed a disconnect data race found by real two-client testing.
- Added authoritative guess timing and final-round comeback evidence.

### Community platform
- Implemented PostgreSQL-backed registration, sessions, profiles, progression,
  challenges, owned cosmetics, match history and immutable score corrections.
- Added versioned leagues/seasons, individual/team tournament registration,
  knockout/group/round-robin fixtures, audited winners and trophies.
- Added friends, parties, private room invitations, spectators, MVP votes and cards.
- Added original playful responsive clubhouse UI, profile and administration views.
- Archive original drawings as private PNG plus compressed canonical operations;
  artist permission and admin curation control public galleries.

### Verification
- PostgreSQL schema, HTTP integration, competition and party invariants tested.
- Original raster/flood-fill behavior tested against archived PNG pixels.
- Go tests run under the race detector, including real multiplayer WebSockets.
- Real engine-through-gateway admission and chat smoke test passed.
- Pages proxy tests pass; deployment container has not been run locally because
  Docker Desktop's Linux daemon is unavailable.

Known gaps and launch gates are tracked in docs/feature-status.md.

### Connected community flows
- Added recipient-bound team invitations, roster management, captain transfers,
  captain-only logos and registration of frozen team rosters in tournaments.
- Added participant-private dispute submission and audited admin resolution.
- Added bounded, server-reencoded PNG profile pictures and team logos; old media
  access is revoked on replacement and removal, with deferred blob cleanup.
- Added one shared quick-rematch room per completed match, preserving supported
  settings with account admission locks and retry-safe engine provisioning.
- Room creation now reserves the account before contacting Go, so concurrent
  requests cannot allocate conflicting rooms; uncertain responses can be resumed.
- Added database, media validation, privacy, concurrent admission and rematch tests.
- Added authenticated room status and safe stale-room recovery for all participants.
- MVP voting and disputes now require appearance in the accepted match result.
- Retention claims blobs before deletion and isolates failed deletes; curation
  cannot publish a blob whose deletion has begun.
- Preserved final native private-room settings and the original league on rematch.

### Deployment
- At this local-preview milestone, deployment awaited owner review. The actual
  free-hosted launch and combined Node/Go service are recorded above.
