# Changelog

Each major milestone is committed and pushed separately under the repository
owner's configured Git identity. Unreleased work is described honestly; feature
designs are not treated as completed runtime features.

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

### Deployment
- Deployment is pending owner review. Target: Cloudflare Pages frontend plus
  a separate long-running Go engine, platform service, and PostgreSQL.
