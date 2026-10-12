# Implementation status

This file distinguishes running features from schema support and deployment work.
Nothing has been published to Cloudflare, Render or Supabase in this task.

| Feature | Current implementation |
| --- | --- |
| Original drawing / guesses / rooms | Actual pinned Go engine and original client, with a small isolated league extension; real two-client WebSocket/race tests |
| Universal accounts | Durable PostgreSQL identities, scrypt password hashes, revocable HttpOnly sessions; username, display name, bio, colored avatar |
| User-uploaded avatars / team logos | Public profile pictures and captain-managed team logos; static PNG up to 1 MiB / 1024px, server-reencoded to 256px; 10 uploads per account/day, old URLs revoked on replacement |
| Match history / XP / titles | Trusted match results, immutable XP, server-issued level rewards and owned title selection |
| Challenges | Daily play-three and weekly win-three windows in UTC, server-side progress, one-time XP claims |
| Achievement evidence | Native accepted-guess timing and final-round comeback telemetry; award evaluation in the result consumer |
| Shared leagues | Communities, cross-game season memberships and versioned placement scoring; preserved all-time and historical results |
| Ranked settings | Fixed rules enforced by Go and SQL; disabled by default until durability validation |
| Tournaments | Individual/team registration, frozen rosters, knockout byes, round robin, groups then knockout, audited manual fixture results, champion/placement trophies |
| Automatic tournament room orchestration | Not yet implemented; an admin records fixture outcomes; manual records are separate from trusted engine leaderboards |
| Teams | Named teams/tags, logos, recipient-bound invitations, roster view, joining/leaving and captain transfer; frozen tournament rosters remain historical snapshots |
| Moderation | Administrator role, bans/session revocation, immutable score-correction versions and audit trail, consent-gated gallery curation |
| Disputes | Participant-only private reports, duplicate-open protection, personal status history and audited admin resolution; score correction remains an explicit separate operation |
| Dislike | Atomic unanimous non-artist vote, exact -100 delta, frozen electorate, hard-word choices and timeout, cross-match account debt |
| Private room controls | Rounds, draw time, participant limits, link access; locked ranked controls |
| MVP | Participant-only voting for 24 hours, one vote per category, no self-votes |
| Drawings | Automatic authoritative PNG + compressed operation archive, artist/prompt/date/dislike metadata, private access checks |
| Retention | Original PNG 30 days; canonical replay 7 days; background deletion, public-curated image exemption while approved |
| Gallery | Artist opt-in + admin publication for Fame/Shame; revocation immediately blocks new reads; signed URLs can remain usable until their 60-second expiry |
| Spectators | Native engine spectators excluded from draw/guess/dislike/ready/kick quorum; no delayed tournament broadcast yet |
| Replays | Final canonical operation sequence retained/downloadable; undo/clear are reflected in that sequence. Full timed stroke/undo chronology and an interactive replay player are not implemented |
| Friends / parties | Account-targeted friendships requiring mutual acceptance; party membership and recipient-bound, expiring invitations |
| Match cards | Downloadable client-rendered summary card, restricted to available participant-visible artwork |
| Rematch / matchmaking | One shared successor room per completed match, participant-only quick rematch and retry-safe provisioning; skill-based public matchmaking and unanimous rematch voting are not implemented |
| Future games | Shared schema, game registry, versioned rules and adapter boundary are ready; only Skribbil is implemented |

## Reliability limits

The preserved engine stores live rooms in memory. A process restart does not
resume a game. The disk outbox retries stored events, but there is a small
RAM-before-fsync window in order to keep filesystem work out of the lobby mutex.
The free deployment filesystem is also ephemeral. Ranked remains disabled there;
do not advertise tournament-grade crash recovery.

Room admission probes the authenticated engine control endpoint. Its explicit
missing-room response cancels the stale reservation so any participant can start
again, even if the old owner is absent. Timeouts, sleeping hosts and generic
route-not-found responses do not cancel matches or award results.

The development profile uses durable local PostgreSQL and private local assets.
The production profile requires external PostgreSQL and private S3-compatible
storage. S3 failure or exhausted quota can delay archival/result delivery; monitor
the outbox and storage usage. Do not silently upgrade billing to resolve limits.

Email verification/recovery, MFA, content reporting, distributed rate limiting,
cross-instance room routing and revocation, a durable outbox across ephemeral
container replacement, and production load/backup restore testing remain launch
work. The current gateway's throttling is per process. Only one engine instance
is supported by the provided free deployment profile.

Completed automated tests are recorded in the repository's CI and changelog.
Docker configuration was reviewed but not executed locally because Docker
Desktop's Linux daemon was not running. Hosted S3, Pages proxy WebSockets and
Supabase production credentials need end-to-end verification after provisioning.
