# Changelog

Each major milestone is committed and pushed separately under the repository
owner's configured Git identity. Unreleased work is described honestly; feature
designs are not treated as completed runtime features.

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
- Deployment is pending owner review. Target: Cloudflare Pages frontend plus
  a separate long-running Go engine, platform service, and PostgreSQL.
