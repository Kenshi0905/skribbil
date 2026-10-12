# Dussehra League of Skribbil: architecture

Status: implementation blueprint with a runnable first release. See `feature-status.md`
for the distinction between implemented behavior and planned capabilities.

## 1. Shared data model

`database/schema.sql` is the authoritative executable PostgreSQL migration.
`docs/data-model.md` explains every domain and its invariants. The schema uses
UUID identities and explicit relationships, rather than putting the platform
inside the drawing game's transient player IDs.

| Domain | Responsibilities |
| --- | --- |
| Identity | Universal accounts, password credentials, opaque revocable sessions, profiles, permissions |
| Community | Communities, membership, friendships, parties, invitations, teams and rosters |
| Game registry | Independent game IDs, engine adapters, versioned immutable rules |
| Competition | Cross-game leagues and seasons, game-specific divisions and standings, tournaments, stages, entrants and fixtures |
| Results | Matches, participants, turns, append-only score events and signed engine event receipts |
| Progression | XP ledger, levels, challenges, achievements, trophies, universal cosmetic inventory and equipped slots |
| Art | Private object references, hashes, sizes, artist and prompt metadata, retention, drawing operations, curation and removal state |
| Trust | Reports, disputes, bans, role grants and append-only administrator audit records |

Accounts, communities, teams, trophies and inventories outlive individual games.
Each match references one game and one versioned ruleset. A league season may
include several game divisions. Each division keeps its own raw scores; cross-game
standings aggregate normalized placement points according to a versioned league
policy. Adding Among Us-like or other original party games means adding an adapter
and game-specific tables, not creating another login system. No future game code
or third-party intellectual property is bundled in this release.

Never reset all-time totals when a season closes. Close the season, preserve its
results and awards, then create a new season. Corrections append a signed delta
with actor and reason; they do not overwrite the original engine result.

## 2. Artwork storage decision

**Recommendation: PostgreSQL for relational metadata and small structured events;
a private S3-compatible object store for PNG/WebP images and compressed replays.
Use the OMV PC as an encrypted backup destination, or as a primary store only
for a deliberately private LAN/VPN community.**

| Concern | OMV + private S3 service | Hosted PostgreSQL + object storage |
| --- | --- | --- |
| Privacy/control | Direct disk and location control; operator owns patching, encryption and access logs | Provider processes stored data; choose region and provider carefully; encrypt, minimize metadata, use private buckets |
| Bandwidth | Every public view consumes home upload bandwidth; finals can saturate it | Object/CDN delivery scales independently of database and game server |
| Connectivity | CGNAT, dynamic IPs, router configuration and certificates can complicate public access | Stable HTTPS endpoints; no residential port forwarding |
| Availability | Sleep, power cuts, disk failure and home ISP outages affect access | Managed redundancy available; still requires backups and monitoring |
| Operations | Maintain disks, S3 service, TLS, updates, UPS, backups and recovery | Storage fees and egress costs; fewer hardware tasks |
| Database performance | Keep blobs outside PostgreSQL even when both run on OMV | Blob uploads/downloads avoid SQL memory, WAL, replication and backup load |

SMB is suitable between trusted machines or for backups, not a browser-facing
public artwork API. OMV supplies NAS/file-sharing capabilities; an S3-compatible
service is a separate deployment. Do not expose OMV administration or SMB to the
internet. An outbound VPN connection can deliver encrypted backups without an
inbound public port. Local storage alone is not an off-site backup.

PostgreSQL `bytea` can store binary data, but doing so for every drawing increases
WAL, replica traffic and restore size. JSONB is useful for validated small rule
and event metadata; it is not a reason to place full replay streams in hot rows.
This workload has no transactional need to load image bytes alongside standings.

Object keys should be opaque: `private/<match UUID>/<turn UUID>/<asset UUID>.webp`.
Track bucket, key, SHA-256, MIME, byte length, owner, visibility, created time and
delete-after in SQL. Authorize every read, then issue a short-lived signed URL
(for example 60 seconds). Signed URLs are bearer capabilities: anyone holding
one can use it until expiry. Never make the original bucket public.

### Retention and privacy policy

- Raw replay operations: 7 days by default. Export them as compressed NDJSON;
  keep a format version and relative operation timestamps.
- Rendered drawings: 30 days by default. Clearly disclose automatic archiving
  in the lobby before play.
- Curated public artwork: retained while approved; publish only with artist
  consent and moderator approval. Hall of Shame is opt-in, including penalized
  drawings. A penalty does not itself authorize public humiliation.
- Account removal: delete identifying profile data and eligible private assets;
  pseudonymize historical competition records and retain justified audit records
  according to the community's published policy.
- Deletion is a retryable two-step workflow: mark pending deletion in SQL, remove
  every derived object/version, then record completion. Do not use an object-store
  lifecycle rule that silently deletes curated or disputed evidence.
- Backups have their own expiry. Document delayed backup deletion and legal holds.

A worker captures authoritative canvas operations at turn completion, rasterizes
using the engine's coordinate conventions in a sandboxed renderer, writes images
and replays, and records object metadata. Uploads, image rendering, database writes
and public moderation never run while the lobby mutex is held.

Primary references: [PostgreSQL binary storage](https://www.postgresql.org/docs/current/datatype-binary.html),
[S3 signed access](https://docs.aws.amazon.com/AmazonS3/latest/userguide/using-presigned-url.html),
[OMV features](https://docs.openmediavault.org/en/7.x/features.html).

## 3. Wrapping the original engine

```text
Browser
  | HTTPS: auth, profiles, league tables, teams, moderation
  v
Platform API ------------------------------> PostgreSQL
  | authenticated create-room request          ^
  | signed, short-lived account launch ticket  | receipts + result transaction
  v                                            |
Go scribble.rs engine -- durable event outbox --+
  ^                         |
  | original WebSocket      +--> archive worker --> private object storage
  | drawing/guessing
Original game client (Skribbil branding)
```

The upstream revision is pinned in `engine/UPSTREAM.md`. Its lobby mutex,
WebSocket reader/writer behavior, canvas protocol, word hints, guess matching,
timer and normal scoring remain authoritative. The platform does not recreate
or intercept the drawing loop in JavaScript. In local development the Node
gateway streams `/engine/*`, including upgrades, to Go. A production ingress
should terminate TLS and route these paths directly to the correct engine shard.

The gateway never interprets canvas packets. It preserves cookies, upgrade
headers, backpressure and socket close behavior. Room assignment is sticky:
every connection for a lobby returns to its owning process. Redis may hold a
room directory or presence later, but does not become the canvas message bus.

The API creates a database match, asks Go to create its room over a private
authenticated endpoint, then returns a signed launch URL. The ticket binds
account, match, lobby, expiry and spectator role. The engine creates or resumes
the correct player and sets its own session cookie. It rejects forged, expired,
cross-room tickets and unauthenticated entry to managed rooms. Engine identity
comes from this ticket, never a username submitted by the browser.

Platform and engine share a random 32-byte-or-longer secret in this first release.
Production should separate ticket signing and webhook keys, support key IDs and
rotation, and keep internal room routes off the public ingress. Signed engine
events use raw-body HMAC, unique event IDs and database uniqueness constraints.
The platform checks the registered match and participant identities before
projecting scores. Browser-submitted final scores are not an accepted API.

Persist an event receipt and all result changes in one transaction. A retry of
the same event is a successful no-op; a conflicting payload with the same ID is
an error. A completed match cannot be finalized again under a new event ID.
The engine outbox retries outages. An in-memory room itself is not crash-durable:
after a process crash, completed outbox events recover, but interrupted games
must be cancelled without granting rewards. Never promise live game recovery
until snapshots and replay recovery have been tested.

## 4. Unanimous dislike and next-turn hard word

The exact engine hooks are documented in `engine-integration.md` with file paths.

1. When an artist begins a turn, capture a stable voter set of active players
   other than the artist. Exclude spectators, bots and later joiners. Require at
   least one eligible voter. Room-size fairness rules can require a larger
   minimum for ranked admission; do not silently change the requested 100% rule.
2. Give the turn a unique ID. Clients send a dislike for that turn through the
   existing authenticated WebSocket. The server checks phase, turn ID and voter
   eligibility. One vote per account/player; duplicate packets are harmless.
3. Under the existing lobby lock, compare unique votes to the frozen electorate.
   A disconnect does not shrink it and accidentally cause unanimity; reconnects
   keep the same vote. Later joiners cannot vote in that turn.
4. If all eligible voters have voted and this turn is unpenalized, atomically set
   the penalty-applied flag, subtract **exactly 100** from the artist's current
   score (negative scores are allowed), and set a next-turn hard-word obligation.
   Broadcast the normal score update plus a small league event. No external I/O
   occurs during this critical section.
5. At the artist's next word selection, use only a curated, versioned hard-word
   pool for the configured language. All offered choices are hard. A selection
   timeout must also choose from that pool. Consume the obligation only when the
   hard turn actually starts; reconnects must not clear it. Do not merely append
   one difficult word to ordinary choices.
6. Record the turn, electorate, votes, exact delta, hard-word obligation and
   resolution for audits. Repeated unanimous penalties on separate turns each
   deduct 100; an already-pending obligation need not stack extra turns unless
   a future ruleset explicitly specifies that behavior.

Hard words are a curated difficulty classification, not simply longer strings.
The first ranked pool is English and versioned with its rules. Private unsupported
languages must not silently receive easier words when a penalty is due.
Store prompt text in the private archive only after the turn ends; spectator
events and public score updates must never leak the answer during play.

Tests must cover simultaneous final votes, duplicate votes, artist/spectator
votes, stale turns, empty electorates, disconnect/reconnect, negative scores,
hard-word timeout and multiple-room isolation. Go's race detector validates the
engine tests on a supported toolchain.

## 5. Cloudflare Pages deployment boundary

The user has requested **review before any deployment**. GitHub pushes do not
deploy this project automatically. No provider credentials belong in Git.

Final topology: `skribbil.pages.dev` serves the static `web/` frontend. A Pages
Function or a same-origin routing layer forwards `/api/*` and `/engine/*` to a
dedicated HTTPS origin. Keep original WebSocket upgrade semantics and engine
root paths. The Go engine and Node API run on a VM/container host; PostgreSQL and
S3 storage can be managed or privately operated. Cloudflare Pages cannot execute
this long-running Go process as a normal static deployment.

Before launch: choose the engine region, provision PostgreSQL and object storage,
configure HTTPS origin restrictions and secret injection, perform multi-client
WebSocket and reconnect testing, review privacy/retention copy, validate backups,
then obtain the owner's deployment go-ahead. Full admin credentials and public
user data must never be baked into a Pages build.
