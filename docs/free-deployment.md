# A free hosting path for Skribbil

These are reviewable deployment files, not an active deployment. No service, subscription, public URL or cloud credential has been created. OMV is not part of this setup. The local app remains available without cloud accounts.

The proposed public preview uses Cloudflare Pages Free for the website, one Render Free service containing both the Node API and the original Go engine, and Supabase Free for PostgreSQL plus a private artwork bucket. This avoids running two services against Render's shared free-hour allowance. It is suitable for trying casual community games; ranked play stays disabled because the free server can restart and its event outbox is not durable across restarts.

## Cost boundary

Use only the named **Free** plans and their included provider subdomains. Do not enable a trial that automatically converts, paid Workers, a custom domain purchase, a persistent disk, add-ons, paid database compute, previews, autoscaling or paid image transformation. Do not attach a payment method to Render for this zero-budget deployment. If a provider's signup asks for a paid commitment, stop that setup instead of accepting it.

The current limits were checked on 12 October 2026:

| Component | Free limit or behavior | Effect on Skribbil |
| --- | --- | --- |
| Render Free | 750 instance hours per workspace per calendar month; sleeps after 15 minutes without inbound traffic; wake-up takes about a minute | One combined service; users may wait for a cold start. Active WebSocket messages count as inbound traffic. |
| Render Free filesystem | Local writes disappear on restart, redeploy or sleep; no free persistent disk | Use remote PostgreSQL and object storage. A live room and an unshipped outbox event can be lost. |
| Supabase Free | 500 MB database per project, 1 GB object storage, 5 GB included egress | Archive compressed operations and private PNGs; apply retention and watch usage. |
| Cloudflare Pages Free | 500 builds monthly | Disable automatic publishing while reviewing changes. |
| Pages Functions on Workers Free | Shared allowance of 100,000 requests daily; static requests that bypass Functions are free | Only `/api/*` and `/engine/*` invoke the proxy; ordinary website assets stay static. |

Sources: [Render free service limits](https://render.com/docs/free), [Supabase free quotas](https://supabase.com/docs/guides/platform/billing-on-supabase), [Pages build limits](https://developers.cloudflare.com/pages/platform/limits/), [Pages Functions pricing](https://developers.cloudflare.com/pages/functions/pricing/).

Render can bill supplementary bandwidth or build usage when a payment method is present; without one it suspends services or builds instead. Free instance hours are shared with any other services in the workspace. High outbound usage can also cause suspension. The template therefore does not promise uninterrupted availability or unlimited traffic. [Render's documented billing and suspension behavior](https://render.com/docs/free).

## Files and network flow

| File | Role |
| --- | --- |
| `infra/Dockerfile` | Builds the pinned Go source and packages Node 24 plus the app in one image |
| `infra/Dockerfile.dockerignore` | Excludes local secrets, databases and development artifacts from the image context |
| `infra/start.sh` | Validates required storage configuration and supervises both processes |
| `infra/render.yaml` | One explicitly free Docker web service with automatic deploys off |
| `infra/cloudflare/_worker.js` | Pages Function reverse proxy, including untouched WebSocket upgrade responses |
| `infra/cloudflare/_routes.json` | Invokes the Function only for the API and engine routes |
| `infra/cloudflare/wrangler.toml` | Pages build output configuration, with no stored secrets |
| `infra/prepare-pages.mjs` | Copies the website and proxy into `.deploy/pages`; does not upload anything |

The browser uses one origin, for example `https://YOUR-PROJECT.pages.dev`. The Pages Function forwards `/api/*` and `/engine/*` to `https://YOUR-SERVICE.onrender.com`, adding a secret origin header. The Node server validates that header, validates account sessions and forwards engine traffic to `127.0.0.1:8080`. The Go engine's HTTP and WebSocket handlers keep their existing concurrency model. The Function returns an upgrade response directly; it does not parse or regenerate drawing frames. Cloudflare documents this API in [Pages advanced mode](https://developers.cloudflare.com/pages/functions/advanced-mode/) and [Workers WebSocket support](https://developers.cloudflare.com/workers/examples/websockets/).

Go sends signed events directly to the same container's Node process at `/api/internal/engine-events`. This route and `/engine/internal/*` are blocked at the public Pages proxy. Only the Node `$PORT` is exposed by the container; the Go port listens on loopback. Preserve the Pages `Origin` header and the matching public host when proxying a WebSocket handshake.

## Configuration when publishing is authorized

1. Create a Supabase project in a **Free** organization. Copy its PostgreSQL **Session pooler** connection string into Render's secret `DATABASE_URL`; do not put it in frontend code or source control. The session pooler supports IPv4 without buying the IPv4 add-on. Keep TLS enabled and validate its certificate. [Supabase database connection modes](https://supabase.com/docs/guides/database/connecting-to-postgres).

2. Create a **private** Supabase Storage bucket called `skribbil-private`. Generate its server S3 credentials and copy the endpoint and region from the dashboard. The endpoint follows `https://PROJECT-REF.storage.supabase.co/storage/v1/s3`. Set these only on Render. S3 access keys are server credentials that bypass Storage RLS; the application must authorize asset access. [Supabase S3 authentication](https://supabase.com/docs/guides/storage/s3/authentication).

3. Choose the intended Pages project name and its free `pages.dev` origin. Review `infra/render.yaml` before applying it manually. It specifies `plan: free` and `autoDeployTrigger: off`; the latter prevents later commits from triggering automatic deployments, but creating the service itself will still initiate its first deployment. Do not create a Render database: this configuration uses the external Supabase project. [Render Blueprint settings](https://render.com/docs/blueprint-spec).

4. Configure the following Render environment values. `infra/start.sh` refuses to run this public-preview profile without external PostgreSQL and object storage:

| Variable | Value |
| --- | --- |
| `DATABASE_URL` | Supabase Session pooler URL, stored as a secret, with TLS enabled |
| `PUBLIC_ORIGIN` | Exact Pages origin, without a trailing path |
| `SKRIBBIL_ENGINE_SECRET` | A generated random secret of at least 32 characters, shared only by Node and Go |
| `SKRIBBIL_ORIGIN_KEY` | A different generated secret of at least 32 characters, shared by Pages and Node |
| `S3_ENDPOINT` | Endpoint copied from Supabase's S3 configuration |
| `S3_REGION` | Actual project region copied from Supabase |
| `S3_BUCKET` | `skribbil-private` |
| `S3_ACCESS_KEY_ID` | Server S3 access key ID |
| `S3_SECRET_ACCESS_KEY` | Server S3 secret access key |
| `SKRIBBIL_RANKED_ENABLED` | `false`, enforced by this startup profile |
| `NODE_ENV`, `HOST`, `COOKIE_SECURE` | `production`, `0.0.0.0`, `true` |

Render provides the Node `PORT`. The startup script sets the Go child `PORT=8080`, `NETWORK_ADDRESS=127.0.0.1`, `ROOT_PATH=engine`, the loopback engine URL and the signed callback URL. Do not replace the public port with the engine port.

5. Prepare the frontend locally with `node infra/prepare-pages.mjs`. Configure the Pages output directory as `.deploy/pages`, with the repository root as the build root and `node infra/prepare-pages.mjs` as the build command if using a future Git-connected deployment. The generated `_worker.js` must be included; a plain file upload that ignores Functions cannot proxy the game.

6. Configure **production-only** Pages bindings: `API_ORIGIN` is the HTTPS Render origin; `PUBLIC_ORIGIN` is the exact Pages origin; `SKRIBBIL_ORIGIN_KEY` is a secret equal to Render's value. Do not copy database, engine-HMAC or object-store credentials into Pages. The proxy fails closed on an unconfigured or different origin, so preview deployments do not inherit access to the live backend. Keep production branch auto-deployment and preview deployment disabled until intentionally publishing.

7. After an authorized manual deployment, verify a new account, login/logout, two-player private room, native drawing/guessing, spectator separation, dislike deduction, hard-word carryover, archived artwork access and denial of direct unauthorized Render access. Reconnect after a server restart and confirm the UI explains that the previous live room is gone. Run these checks before inviting the wider community.

The template is intended for one instance. A free instance has limited memory/CPU, so no concurrency or tournament capacity is promised without measurement. Keep the standard room size at eight players and start with a small community trial.

## Data, retention and ranked play

PostgreSQL contains accounts, league history, standings and metadata. The private bucket contains images and compressed canonical drawing operations. Canonical operations reproduce the final drawing; they do not promise the artist's original timing or a complete undo/clear history.

The default retention design is 30 days for original drawings, 7 days for replay operations, and 90 days for share cards. Curated public artwork requires the artist's publication consent. A running retention worker must delete the actual object as well as update its metadata. When the free service sleeps, in-process jobs also stop; expired assets should remain inaccessible immediately by timestamp checks, and deletion resumes when the worker runs again. Usage must stay within the free quotas; pause uploads or shorten retention instead of upgrading automatically.

Profile pictures and team logos are public while equipped. Only static PNG files
up to 1 MiB and 1024 × 1024 are accepted, then reencoded to 256 × 256. An account
can upload at most ten profile/team images daily. Replacing or removing an image
immediately blocks new reads of its old URL; the object is deleted after one day.
Already-issued signed URLs can remain valid for their 60-second lifetime.

The current Go adapter queues events in memory before writing an outbox file. On the free host, even a flushed file is ephemeral. A crash can lose live state or unsettled events. **Ranked mode is deliberately disabled** in both the template and startup script. Enabling ranked requires a durable acknowledged event transport, recovery/deduplication tests, session and ban enforcement, replayable settlement and a documented operational recovery process. Changing an environment flag does not solve these issues.

Use provider dashboards to monitor storage, database and network quotas manually. No paid scheduler or external keep-alive pinger is configured. For a zero-budget trial, accept suspension or a smaller player base when a quota is reached.

## Local verification

These commands do not publish anything:

```text
node --test tests/schema.test.mjs
node --test infra/tests/proxy.test.mjs
node --check infra/cloudflare/_worker.js
node infra/prepare-pages.mjs
docker build -f infra/Dockerfile -t skribbil-preview .
```

The Node tests exercise routing, session-cookie forwarding, origin-secret replacement, blocked internal routes, redirect rewriting and WebSocket-response preservation. A successful local test does not establish real Cloudflare/Render connectivity. A Docker build requires Docker plus network access to package registries; if unavailable, report that limitation rather than treating the image as validated.
