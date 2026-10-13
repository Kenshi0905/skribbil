# Implementation status

This file distinguishes running features from schema support and deployment work.
[Skribbil is live](https://skribbil.pages.dev) on Cloudflare Pages with a Render
backend and Supabase database/private storage, provisioned on 13 October 2026.
The [milestone verification record](verification.md) lists the observed engine
runs, live transport/storage checks, browser viewports, automated checks and
remaining release tests. Full production gameplay remains unverified.

| Feature | Current implementation |
| --- | --- |
| Original drawing / guesses / rooms | Actual pinned Go engine and original client, with a small isolated league extension; real two-client WebSocket/race tests |
| Universal accounts | Durable PostgreSQL identities, scrypt password hashes, revocable HttpOnly sessions; username, display name, bio, colored avatar |
| Password changes | Current-password verification, fresh scrypt hash, revocation of existing sessions, a new session for the requesting browser, and closure of existing game connections; email recovery and MFA remain future work |
| User-uploaded avatars / team logos | Public profile pictures and captain-managed team logos; PNG/JPG up to 1 MiB / 1024px, cropped to a square and server-reencoded to 256px PNG; 10 uploads per account/day, old URLs revoked on replacement |
| Profile avatar choices | Your profile → Avatar offers a preset character or an uploaded PNG/JPG photo. Original mix-and-match SVG portraits: hair, eyes, brows, mouths, extras, skin/hair/clothing/background colors; live preview, randomize, reset, and explicit save; validated preset URLs persist in PostgreSQL and appear in profiles, the account menu, friends, and standings; uploads and characters can replace each other |
| Match history / XP / titles | Trusted match results, immutable XP, server-issued level rewards and owned title selection |
| Challenges | Daily play-three and weekly win-three windows in UTC, server-side progress, one-time XP claims |
| Achievement evidence | Native accepted-guess timing and final-round comeback telemetry; award evaluation in the result consumer |
| Shared leagues | Communities, cross-game season memberships and versioned placement scoring; preserved all-time and historical results |
| Ranked settings | Fixed rules enforced by Go and SQL; disabled by default until durability validation |
| Tournaments | Individual/team registration, frozen rosters, knockout byes, round robin, groups then knockout, audited manual fixture results, champion/placement trophies |
| Automatic tournament room orchestration | Not yet implemented; an admin records fixture outcomes; manual records are separate from trusted engine leaderboards |
| Teams | Named teams/tags, logos, recipient-bound invitations, roster view, joining/leaving and captain transfer; frozen tournament rosters remain historical snapshots |
| Clubhouses | Separate invite-only friend groups shared across games. Administrators create them or approve a player's request; approval makes the requester owner. Recipient-bound invitations, member/admin roles, removal, ownership transfer and audit records are implemented; ordinary players cannot directly create groups |
| Moderation | Administrator role, bans/session revocation, immutable score-correction versions and audit trail, consent-gated gallery curation |
| Disputes | Participant-only private reports, duplicate-open protection, personal status history and audited admin resolution; score correction remains an explicit separate operation |
| Dislike | Atomic unanimous non-artist vote, exact -100 delta, frozen electorate, hard-word choices and timeout, cross-match account debt |
| Private room controls | Rounds, draw time, participant limits and classic link access; Clubhouse-scoped rooms additionally require current membership for playing, spectating and rematches, remain private even if the client requests otherwise, and revoke access after removal; locked ranked controls |
| Mobile layout / input | Responsive canvas, larger controls, scrollable palettes, stacked chat and a Send button; Pointer Events support touch/stylus drawing, capture, cancellation and pressure. Automated input tests are present; physical-phone and browser touch/keyboard testing remain outstanding |
| MVP | Participant-only voting for 24 hours, one vote per category, no self-votes |
| Drawings | Automatic authoritative PNG + compressed operation archive, artist/prompt/date/dislike metadata, private access checks |
| Retention | Original PNG 30 days; canonical replay 7 days; metadata is claimed before blob deletion to prevent publication races, failures retry without blocking other deletions, and active curation/legal holds are preserved |
| Gallery | Artist opt-in + admin publication for Fame/Shame; revocation immediately blocks new reads; signed URLs can remain usable until their 60-second expiry |
| Spectators | Native engine spectators excluded from draw/guess/dislike/ready/kick quorum; no delayed tournament broadcast yet |
| Replays | Final canonical operation sequence retained/downloadable; undo/clear are reflected in that sequence. Full timed stroke/undo chronology and an interactive replay player are not implemented |
| Friends / parties | Account-targeted friendships requiring mutual acceptance; party membership and recipient-bound, expiring invitations |
| Match cards | Downloadable client-rendered summary card, restricted to available participant-visible artwork |
| Rematch / matchmaking | One shared successor room per completed match, participant-only quick rematch and retry-safe provisioning; Clubhouse scope and current membership carry forward, and removed members are not trapped by historical room reservations. Skill-based public matchmaking and unanimous rematch voting are not implemented |
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
Clubhouse service tests use in-memory PostgreSQL, and gateway regressions exercise
approval, intended-recipient invitations, private room creation, revoked tickets,
cookie-based legacy engine routes, cancellation and access after removal. These
local tests are not a hosted deployment or a production load test. Mobile user-agent
WebSocket connections validate protocol behavior, not real touch input or physical
phone usability.
Browser viewport inspection of the native canvas at 360, 390 and 430 CSS pixels
found no horizontal page overflow, preserved the 16:9 canvas and verified 44px
chat/Send controls. These visual checks do not replace physical touch, stylus or
on-screen-keyboard testing.
Docker configuration was reviewed but not executed locally because Docker
Desktop's Linux daemon was not running; the production container build passed in
CI. Live health/bootstrap, verified-TLS database access, private Supabase PNG
upload/signed read/anonymous denial/deletion, and Pages-proxied WSS checks passed.
The live transport checks covered authentication, two-player chat, spectator
restrictions, rejection of a borrowed native cookie and reconnect identity in an
unstarted room. All five synthetic accounts and two unstarted smoke matches were
removed transactionally; real administrator roles and audit records were
preserved. Full hosted gameplay, load/recovery and physical-device testing remain
outstanding.

The [verification for deployed commit `dab93f4`](https://github.com/Kenshi0905/skribbil/actions/runs/38290967168)
passed platform tests, the Go race suite, the ten-player protocol playtest and
the production Docker build. These CI results are separate from the live checks
above and do not establish physical-device compatibility or production capacity.
