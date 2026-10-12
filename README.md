# Skribbil

**Dussehra League of Skribbil** is a game-independent community platform wrapped
around the original [scribble.rs](https://github.com/scribble-rs/scribble.rs) Go
engine. The original real-time drawing, guessing, room locks, timers and
WebSocket protocol remain in `engine/`. This is not a reimplementation of the
game in the platform frontend.

The clubhouse uses original paper-and-marker artwork, flat cards and bold color.
Accounts, communities, teams, leagues and cosmetics can be reused by later games.

## Start locally (free)

Requirements: Node.js 22+ (24 recommended), npm, Go 1.25+.

```sh
npm ci
mkdir -p .tools
cd engine
go build -o ../.tools/skribbil-engine ./cmd/scribblers
cd ..
npm run dev
```

On Windows, build to `../.tools/skribbil-engine.exe`. Open
<http://localhost:3000>. The development launcher starts Go on port 4181 and the
platform on port 3000. Set `ENGINE_PORT` or `PORT` to change them.

No hosted account or API key is required to run locally. Embedded PostgreSQL
persists in `.data/postgres`, private artwork in `.data/assets`, and the generated
development signing secret in `.data/dev-secret`. All are Git-ignored. This is
real local persistence, not browser-local fake authentication. Register through
the website. The seed contains configuration, a non-login system identity and
no fabricated match results. Clearly labeled example content illustrates empty
community screens; it never enters competitive standings.

To grant yourself local administrator access, stop the dev server first (the
embedded database supports one process), then run:

```sh
npm run admin -- YOUR_REGISTERED_USERNAME
npm run dev
```

The admin can create seasons/tournaments, seed brackets, record fixture winners,
curate consented artwork, suspend accounts and append score corrections.

`npm start` runs only the platform. Set `ENGINE_URL` if Go runs separately. The
`.env.example` file documents configuration; secrets belong in an ignored `.env`
or your hosting provider's secret environment, never in Git.

## The requested design deliverables

- [Complete PostgreSQL schema](database/schema.sql) and [data-model guide](docs/data-model.md).
- [Architecture and storage recommendation](docs/architecture.md), including
  privacy, bandwidth, NAT, availability and database trade-offs. OMV is deferred.
- [Exact Go integration and dislike implementation](docs/engine-integration.md).
- [Free deployment plan](docs/free-deployment.md) for a `pages.dev` frontend.
- [Feature status and launch limitations](docs/feature-status.md).

## How the penalty works

The existing lobby mutex protects a frozen set of connected, non-artist,
non-spectator voters. A dislike belongs to the current turn. Each eligible player
can vote once; unanimity deducts exactly 100 points once, including below zero,
and queues a hard word for the artist's next drawing turn. Disconnecting never
shrinks the required vote count. Every offered word and the timeout selection
come from the hard pool when the obligation is pending. Account-bound debt also
travels through signed platform tickets; see the documented delivery limits.

Normal drawing and guessing packets remain between the browser and Go. The
Node service streams WebSocket traffic without interpreting it. Go sends
HMAC-authenticated result events asynchronously. The platform atomically records
event receipts, score ledgers, result versions, XP and standings; repeats cannot
double-award a match. Drawings are rendered using the original pinned raster
functions inside bounded workers, not browser-supplied screenshots.

## Tests

```sh
npm test
node --test infra/tests/*.test.mjs
cd engine
go test -race ./...
```

Go's race detector needs a supported C toolchain. On Windows use a 64-bit GCC
toolchain with `CGO_ENABLED=1`. CI runs these on Ubuntu. HTTP integration tests
open loopback sockets; a restrictive sandbox may require local-network permission.

## Deployment is intentionally pending review

No deployment workflow is attached to GitHub pushes. The target is Cloudflare
Pages Free + a Render Free container + Supabase Free PostgreSQL/private Storage.
Never attach a payment method or upgrade a service as part of this free-only
setup. Provider free-tier terms can change; recheck the linked official limits
before provisioning. Exhausted quotas can interrupt the app.

The production container refuses to start with an ephemeral local database or
local artwork store. Ranked is disabled by default and forcibly disabled in the
free preview deployment: free Render can restart and its filesystem outbox is
ephemeral. Casual multiplayer, local ranked testing, competition management and
all architecture work are available. Official ranked launch needs a durable
result-delivery design and validation first.

## Attribution

BSD-3-Clause for the platform; original upstream license and notices are retained.
See [third-party notices](THIRD_PARTY_NOTICES.md) and the exact pinned revision in
[engine/UPSTREAM.md](engine/UPSTREAM.md). Skribbil is independent; renaming does
not waive third-party licenses. Upstream's excluded branding was replaced.
