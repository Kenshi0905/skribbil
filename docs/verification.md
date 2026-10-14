# Milestone verification

This record separates local verification from live deployment evidence collected
on **13 October 2026 (India time)**. It does not certify physical-phone
compatibility, sustained production capacity or crash recovery. Feature boundaries
remain in [implementation status](feature-status.md).

## Room looks and the Character Workshop — 14 October 2026

The permanent editor keeps its profile save/upload contract and gains a costume
drawer presentation. Managed rooms add temporary server-authoritative identities
and an explicit host start. No database migration or drawing-loop rewrite is involved.

Local verification: 147 Node tests passed, with one optional integration skip;
the full Go suite and the game/API race suites passed. The ten-player protocol
playtest completed 20 turns, checked broadcasts of two independent room looks,
unchanged profile records, reconnect preservation, readiness resets, forbidden
guest starts, and fresh-rematch profile defaults. Preset bounds have a JS/Go parity test.

Manual verification used two isolated browser sessions against an in-memory test
database. Host/member customization appeared in both rosters; profile reset stayed
a draft until Apply, Cancel discarded it, refresh preserved the room override,
editing revoked readiness, and only the host started. Both panels closed at start.
The permanent name/avatar stayed unchanged. Desktop and 390px phone layouts had
no horizontal overflow in the editor/panel, keyboard focus was visible, and both
browser sessions reported no console errors. These are viewport checks, not
physical-device certification. Test accounts were never created in production.

## Clubhouse identity and player avatars — pre-push checks

The hygiene update starts from merged `main` revision `65d8ea8`, preserving the
new friend directory, unified account settings, avatar editor and reconnect fixes.
Clubhouse is the shared home and Skribbil has its own nested game route. Private
groups remain at the existing `#/clubhouses` route; account and league schemas
are unchanged. The supplied caped-hero branding has transparent light/dark variants.

Before pushing: 141 application tests passed with one optional integration test
skipped; all eight infrastructure tests and the full Go race suite passed. The
ten-player isolated protocol playtest completed 20 turns, archived 20 drawings
and produced ten authoritative results. Three clients used mobile User-Agent
headers. Saved avatar URLs survived signed admission and reconnect. Penalty,
hard-word carryover, spectator restrictions and account-binding checks passed.

Browser checks exercised login, the game link from Clubhouse, private group room
controls, and the original game roster with three loaded preset avatars plus
initials fallbacks. Light/dark and 390-pixel mobile checks confirmed the player
cards fit without horizontal overflow and the mobile navigation still works.
These are browser viewport checks, not physical phone tests. The local fixtures
used an isolated memory database; no production accounts or matches were created.
Windows CRLF compatibility was repaired in the existing UI test harnesses.

The checks above are local evidence; the existing CI workflow repeats checks
before deploying a pushed revision. They do not claim that a future live rollout
has already succeeded.

## Initial live deployment

[Skribbil is deployed on Cloudflare Pages](https://skribbil.pages.dev), with its
Render backend and Supabase database/storage provisioned. The initial launch
checks below used `dab93f41ebf34e979d9c7704d5cbae1bdecf1483`; they are historical
launch evidence, separate from verification of subsequent updates.

- Public health and bootstrap requests returned HTTP 200. The backend connected
  to the hosted PostgreSQL database with TLS certificate verification enabled.
- A PNG was uploaded to a private Supabase bucket. Its signed read returned the
  same bytes, anonymous access was denied, and deletion was verified by a
  subsequent HTTP 404.
- Two administrator accounts were provisioned privately. Authentication and
  administrator roles were verified, then their verification sessions were
  revoked. No account identities, emails or credentials are recorded here.
- Three synthetic accounts exercised authentication, logout/login and live WSS
  connections. Two players and one spectator joined an unstarted private room.
  Player chat propagated; spectator chat and drawing-line messages were
  rejected. Reusing another account's native engine cookie returned HTTP 403.

The focused two-account live reconnect test **passed**. A masked client
`Close(1000)` received its graceful-close acknowledgement; the observing client
received `connected:false` after 10,195 ms. Reconnection retained the same engine
player identity, with the room still unstarted, an empty canvas and zero scores.
The first smoke test's 10-second notification timeout was shorter than the
observed disconnect propagation; no game-code change was needed.

Both smoke rooms were cancelled and the synthetic sessions logged out.
Transactional cleanup then removed exactly **five synthetic accounts and two
unstarted matches**, including their sessions, memberships and welcome cosmetics.
The cleanup guarded UUID references across all base tables and checked audit and
outbox payload references. No immutable ledger rows were deleted. Final checks
confirmed two real player accounts, zero matches, zero results and zero drawings;
the real administrators, their roles and their audit records were unchanged.

No full production match, dislike penalty, hard-word assignment or authoritative
result ingestion has been exercised. Those behaviors have the local evidence
below; the live smoke did not generate permanent competitive ledger history.

## Friend-request update

Revision `4b8d013317ed301cc1ee12d9b262c84bd159c4dc` adds recipient-only Accept/Decline
actions, distinct incoming/sent lists and an accepted-friend count. Render is
**live at that exact revision**, and the matching
[Pages deployment](https://9be020ea.skribbil.pages.dev) was published to
[skribbil.pages.dev](https://skribbil.pages.dev). Live `app.js` and `styles.css`
returned HTTP 200 and matched the tested files' SHA-256 hashes. Public bootstrap
returned HTTP 200 with the engine available. Production had zero rooms immediately
before deployment began.

- All four jobs passed in [CI run 38297170524](https://github.com/Kenshi0905/skribbil/actions/runs/38297170524):
  platform, Go race tests, ten-player multiplayer and production container build.
- The local `npm test` run reported **123 tests: 122 passed and one optional
  real-engine case skipped**, with no failures. The separate CI multiplayer job
  passed; the local skip is not counted as a pass.
- Desktop and **390 × 844** browser checks exercised Accept and Decline. The
  44px action buttons stayed fully within their row; outgoing requests showed
  status only, and the friend count included accepted connections only.
- All four browser fixtures used an isolated local PGlite in-memory server. That
  server was stopped and its temporary login file deleted after verification;
  the browser checks did not create production accounts or friendships.

Accept/Decline behavior was verified through isolated HTTP and browser tests.
No production friendship mutation test was performed; existing production
friendships were untouched. Live publication and asset checks do not substitute
for a production Accept/Decline test.

## Real engine runs

Both runs used the preserved Go engine through the platform gateway, with ten
authenticated players and at least one spectator. The browser demo added a second
spectator for capture. The ten results below are player result
rows for a completed match, not ten separate matches.

| Local run | Completed turns | Authoritative player results | Archived drawings | Unanimous penalties | Next-turn hard word |
| --- | ---: | ---: | ---: | ---: | --- |
| Ten-client protocol run | 20 | 10 | 20 | 1 | Verified |
| Clubhouse demo run | 20 | 10 | 20 | 1 | Verified |

Each run included three clients with mobile user-agent strings and **zero physical
mobile devices**. These are protocol tests, not browser touch tests. The harness
checked reconnect identity, spectator exclusion, duplicate-vote handling, the
exact 100-point deduction and consumption of the next-turn hard-word requirement.
The reproducible harness is [tests/playtest-10.mjs](../tests/playtest-10.mjs); it
requires installed dependencies and a built engine binary. It creates isolated
loopback services and temporary storage, then removes its test data on exit.

## Browser inspection

- The desktop chapter layout fits the inspected 1366×768 viewport.
- Native game layouts at 360, 390 and 430 CSS-pixel widths have no horizontal page
  overflow, preserve the 16:9 canvas and provide 44px chat input/Send controls.
- Drawer and dialog behavior was exercised. A signup/login username-handling
  issue was found and fixed.
- Read-only spectator chat controls were found enabled and corrected to match
  the server's existing restriction. Spectators cannot send chat or use player
  readiness controls in managed rooms.

The sound menu was checked in the browser: changing effects volume and reloading
retained the chosen value. Automated audio checks cover the 20% default pop gain,
overlapping-pop suppression, mute behavior and Web Audio unlock/failure paths.

Physical touch/stylus gestures and mobile on-screen-keyboard behavior remain
unverified. Mobile user agents and resized desktop browser windows do not prove
those behaviors.

## Automated checks

The initial-launch [GitHub verification run for `dab93f4`](https://github.com/Kenshi0905/skribbil/actions/runs/38290967168)
passed all four jobs: platform, Go engine (including the full race suite),
ten-player multiplayer run and production container build. The Pages proxy
suite passed all five cases. Local Node checks and the separately run optional
real-engine gateway case passed.
Node regression coverage includes authentication and password changes, Clubhouse
approval/invitations, room privacy and revocation, encoded legacy engine paths,
rematches, competitions, archival and retention. The complete Node regression
command and supporting checks are:

```sh
npm test
npm run check
npm run check:secrets
node --test infra/tests/proxy.test.mjs
```

From the `engine` directory:

```sh
go test -race ./...
```

Local SQL tests use PGlite, whose transaction wrapper serializes work. Account
locks use PostgreSQL `FOR NO KEY UPDATE`; membership and credential checks read
again after acquiring their lock. These choices address reviewed lock-order and
statement-snapshot races, but multi-connection PostgreSQL contention remains a
hosted validation step.

Gateway tests start temporary localhost services; restricted sandboxes may need
permission to connect to those local ports. They do not require hosted accounts.

## Remaining release checks

The local Docker Linux daemon was unavailable, so the container build was not
executed locally; the GitHub CI container build passed. The hosted checks above
cover deployment, private object storage, WebSocket access and reconnect identity.
Synthetic fixture cleanup was verified. Full hosted gameplay, physical-phone
interaction and production load/recovery testing remain outstanding.

Ranked play remains disabled on the free hosting profile. Live rooms are held in
engine memory, the event outbox has a small memory-before-fsync window, and the
free container filesystem is ephemeral. Process or host replacement can lose an
active room or an event that was not made durable. These runs do not establish
tournament-grade recovery or sustained production capacity.

No actual administrator credentials are included in source or Git. The two live
administrators were provisioned privately; there is no shared default admin
password. Keep account data, database files, session material and
deployment secrets in protected runtime storage. See the
[free deployment guide](free-deployment.md) for setup and its remaining checks.

## Avatar v2 and large ready-room preview (2026-10-14)

- Frozen v1 SVG renderer/catalog; canonical v2 has 12 indices plus a versioned profile object. Go, native browser, and JS bounds have parity coverage. Query, zero-padded, unknown-version, out-of-range and external paths are rejected.
- All v2 options decode as 200×200 SVG images. Vibe tests cover all eight skin tones; legacy opening, edit migration, save/reopen, room drafts, errors and cancellation have regression coverage.
- Visually reviewed 32 generated avatars across four vibes plus all 24 hairstyles and 22 extras at large and thumbnail sizes. Corrected deep-skin facial contrast.
- Desktop 1280px preview 420px, tablet 1024px preview 280px, phone 390px preview 220px. Phone panel scrollWidth equals clientWidth (357px); viewport has no horizontal overflow. These are browser viewport checks, not physical-device tests.
- Two isolated browser sessions verify independent v2 customization, server-accepted roster broadcasts, reconnect persistence, draft-only profile restore/cancel, readiness and explicit owner start.
- 10-player/one-spectator protocol playtest includes v2 permanent and temporary identities, legacy compatibility, profile unchanged, readiness reset, stale-seat protection, 20 drawing turns and fresh-rematch reset.
- Full Node tests: 154 total, 153 passed, one optional integration skip. Go test ./... and race tests for game/API passed; syntax, infra, secret guard and diff checks passed.
