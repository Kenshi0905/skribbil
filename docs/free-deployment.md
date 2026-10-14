# Skribbil live deployment on free hosting

The casual preview launched on **13 October 2026** at **[skribbil.pages.dev](https://skribbil.pages.dev)**. The backend is [skribbil.onrender.com](https://skribbil.onrender.com). The website and backend health checks returned HTTP 200. OMV is not involved; the local app remains available without cloud accounts.

The live preview uses Cloudflare Pages Free for the website, one Render Free Docker service in Singapore containing both the Node API and the original Go engine, and Supabase Free in the dedicated **Skribbil Games** organization for PostgreSQL plus a private artwork bucket. This avoids running two services against Render's shared free-hour allowance. It is suitable for trying casual community games; ranked play stays disabled because the free server can restart and its event outbox is not durable across restarts.

## Initial launch evidence

- Initial launch revision: [`dab93f4`](https://github.com/Kenshi0905/skribbil/commit/dab93f4). All four jobs passed in [CI run 38290967168](https://github.com/Kenshi0905/skribbil/actions/runs/38290967168). These checks describe the launch, not validation of a later update.
- PostgreSQL certificate-chain and hostname verification succeeded using the provider CA. TLS verification remains enabled.
- The private S3-compatible bucket passed upload, signed read, anonymous-read denial, and deletion checks.
- Two real administrator accounts were provisioned privately; their credentials and identifying details are not part of this documentation.
- Pages has production-only `API_ORIGIN`, `PUBLIC_ORIGIN`, and `SKRIBBIL_ORIGIN_KEY` bindings. Preview bindings are empty. Automatic deployments are off.
- Live authentication and WSS passed with two players and one spectator in an unstarted private room: chat, spectator restrictions, and exact account-identity access checks. A separate two-player reconnect test passed with graceful close acknowledgement, preserved identity, an empty canvas, and zero scores.
- A guarded transaction removed all five synthetic accounts and both unstarted test rooms while preserving the two real administrators. At completion of launch cleanup, the database had two real players and zero matches, results, or drawings. No full production match was started; the isolated local/CI ten-player playtest covers gameplay. See [verification](verification.md) for evidence and remaining checks.

## Friend-request update

Revision `4b8d013317ed301cc1ee12d9b262c84bd159c4dc` adds explicit recipient-only
Accept/Decline controls and separates incoming, sent and accepted connections.
All four [CI jobs passed](https://github.com/Kenshi0905/skribbil/actions/runs/38297170524).
Local automated and desktop/390 × 844 browser checks passed; the four browser
fixtures used an isolated in-memory database and were not production accounts.
The production room count was zero immediately before this rollout.

Render was deployed at that exact revision for this update. The matching
[Pages deployment](https://9be020ea.skribbil.pages.dev) was published to
[skribbil.pages.dev](https://skribbil.pages.dev). Live `app.js` and `styles.css`
returned HTTP 200 with SHA-256 hashes matching the tested files; bootstrap
returned HTTP 200 with the engine available. Accept/Decline behavior was verified
through isolated HTTP and browser tests, not production mutations. Existing
production friendships were untouched. See the
[update verification](verification.md#friend-request-update).

## Dark mode and automatic updates

The dark theme from `28d237e`, merged as `a33850a`, was released on 13 October
2026 to both Render and [Pages](https://559119c9.skribbil.pages.dev).
The live toggle persisted after reloading the website. Drawing colors and the
original Go game loop are unchanged.

The `Verify Skribbil` workflow now includes production deployment after all four
verification jobs succeed on a push to this repository's `main` branch. Pull
requests never run deployment. Older commits are skipped if a newer commit is
already on `main`; production deployments are serialized and not cancelled in
the middle of a rollout.

GitHub Actions uses two encrypted repository secrets: `CLOUDFLARE_API_TOKEN`
(Cloudflare Pages Edit on the hosting account) and `RENDER_DEPLOY_HOOK_URL`
(deployment access to the existing Skribbil service). Neither value belongs in
Git. Repository collaborators who can change workflows must be trusted with this
deployment access. Database and administrator credentials remain outside Actions.

The workflow sends Render the exact tested commit, waits for `/api/health` to
report that revision, then publishes the matching Pages artifact. A failed or
timed-out server rollout prevents Pages publication. Check the workflow's `deploy`
job and Render logs when an update does not appear. Render's own Auto-Deploy
setting stays off to avoid duplicate releases; GitHub Actions owns the sequence.
Cloudflare remains a direct-upload project with production-only proxy secrets.
Forks and preview URLs do not receive production credentials.

This uses the existing free services and GitHub's public-repository runners.
Each server deployment restarts the in-memory game engine, so merge releases
between games. This does not provide room migration or a maintenance drain.
For an emergency stop, disable the workflow in GitHub Actions; a manual Render
deployment and Wrangler Pages upload remain available. Revoking the Pages token
or regenerating the Render hook requires updating the corresponding Actions secret.

References: [Cloudflare direct upload from CI](https://developers.cloudflare.com/pages/how-to/use-direct-upload-with-continuous-integration/)
and [Render deployment hooks](https://render.com/docs/deploy-hooks).

## Cost boundary

Use only the named **Free** plans and their included provider subdomains. Do not enable a trial that automatically converts, paid Workers, a custom domain purchase, a persistent disk, add-ons, paid database compute, previews, autoscaling or paid image transformation. Do not attach a payment method to Render for this zero-budget deployment. If a provider's signup asks for a paid commitment, stop that setup instead of accepting it.

The current limits were checked on 12 October 2026:

| Component | Free limit or behavior | Effect on Skribbil |
| --- | --- | --- |
| Render Free | 750 instance hours per workspace per calendar month; sleeps after 15 minutes without inbound traffic; wake-up takes about a minute | One combined service; users may wait for a cold start. Active WebSocket messages count as inbound traffic. |
| Render Free filesystem | Local writes disappear on restart, redeploy or sleep; no free persistent disk | Use remote PostgreSQL and object storage. A live room and an unshipped outbox event can be lost. |
| Supabase Free | 500 MB database per project, 1 GB object storage, 5 GB included egress | Archive compressed operations and private PNGs; apply retention and watch usage. |
| Cloudflare Pages Free | 500 builds monthly | Publish tested main-branch releases only. |
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

The browser uses one origin, `https://skribbil.pages.dev`. The Pages Function forwards `/api/*` and `/engine/*` to `https://skribbil.onrender.com`, adding a secret origin header. The Node server validates that header, validates account sessions and forwards engine traffic to `127.0.0.1:8080`. The Go engine's HTTP and WebSocket handlers keep their existing concurrency model. The Function returns an upgrade response directly; it does not parse or regenerate drawing frames. Cloudflare documents this API in [Pages advanced mode](https://developers.cloudflare.com/pages/functions/advanced-mode/) and [Workers WebSocket support](https://developers.cloudflare.com/workers/examples/websockets/).

Go sends signed events directly to the same container's Node process at `/api/internal/engine-events`. This route and `/engine/internal/*` are blocked at the public Pages proxy. Only the Node `$PORT` is exposed by the container; the Go port listens on loopback. Preserve the Pages `Origin` header and the matching public host when proxying a WebSocket handshake.

## Deployment configuration and manual updates

The following describes how to reproduce the setup or perform a manual update.
For this repository, tested pushes to `main` use the automatic workflow above.

1. Create a Supabase project in a **Free** organization. Copy its PostgreSQL **Session pooler** connection string into Render's secret `DATABASE_URL`; do not put it in frontend code or source control. The session pooler supports IPv4 without buying the IPv4 add-on. Use a URL with no SSL query options or with `sslmode=verify-full`. Production code always enables TLS with certificate-chain and hostname verification; it rejects weaker SSL modes and URL-level certificate/socket overrides. If the provider needs its own trust root, download the database CA from Supabase Database settings and put the PEM text, including real line breaks, in Render's protected `DATABASE_CA_CERT` environment value. Without this option, Node's standard trusted roots are used. Do not disable verification to work around a certificate error. [Supabase database connection modes and SSL](https://supabase.com/docs/guides/database/connecting-to-postgres).

   The app validates and removes `sslmode=verify-full` before handing the URL to `pg`, then supplies its verified TLS configuration directly. This prevents URL parsing from replacing the optional CA or verification settings. Do not add `sslrootcert`, `sslcert`, `sslkey`, `ssl`, or `uselibpqcompat` to the URL. [node-postgres SSL configuration precedence](https://node-postgres.com/features/ssl).

2. Create a **private** Supabase Storage bucket called `skribbil-private`. Generate its server S3 credentials and copy the endpoint and region from the dashboard. The endpoint follows `https://PROJECT-REF.storage.supabase.co/storage/v1/s3`. Set these only on Render. S3 access keys are server credentials that bypass Storage RLS; the application must authorize asset access. [Supabase S3 authentication](https://supabase.com/docs/guides/storage/s3/authentication).

   For a configured S3-compatible endpoint, the client uses AWS's `WHEN_REQUIRED`
   request and response checksum settings. This avoids opting into optional AWS
   checksum extensions while retaining HTTPS, request signing and the app's stored
   SHA-256 metadata. Native AWS endpoints retain the SDK defaults. This is a
   compatibility choice; local request-shape tests alone do not establish live
   bucket behavior. Upload, signed read, anonymous-read denial, and deletion were
   verified for this deployment; repeat them after changing storage configuration.
   [AWS checksum controls](https://docs.aws.amazon.com/sdkref/latest/guide/feature-dataintegrity.html),
   [Supabase S3 compatibility](https://supabase.com/docs/guides/storage/s3/compatibility).

3. Choose the intended Pages project name and its free `pages.dev` origin. Review `infra/render.yaml` before applying it manually. It specifies `plan: free` and `autoDeployTrigger: off`; the latter disables Render's independent Git trigger, while the Actions workflow above uses a deployment hook. Creating the service itself still initiates its first deployment. Do not create a Render database: this configuration uses the external Supabase project. [Render Blueprint settings](https://render.com/docs/blueprint-spec).

4. Configure the following Render environment values. `infra/start.sh` refuses to run this public-preview profile without external PostgreSQL and object storage:

| Variable | Value |
| --- | --- |
| `DATABASE_URL` | Supabase Session pooler URL, stored as a secret; omit SSL parameters or use only `sslmode=verify-full` |
| `DATABASE_CA_CERT` | Optional provider CA PEM bundle, at most 64 KiB, stored only in protected server runtime configuration |
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

6. Configure **production-only** Pages bindings: `API_ORIGIN` is the HTTPS Render origin; `PUBLIC_ORIGIN` is the exact Pages origin; `SKRIBBIL_ORIGIN_KEY` is a secret equal to Render's value. Do not copy database, engine-HMAC or object-store credentials into Pages. The proxy fails closed on an unconfigured or different origin, so preview deployments do not inherit access to the live backend. Keep production branch auto-deployment and preview deployment disabled. In Wrangler 4.149.0, `pages secret bulk` without `--env` targets production only; verify preview binding names remain empty after updates.

7. After a manual deployment, record public health, authentication, private-lobby WebSocket, spectator, reconnect, and access-boundary checks in [verification](verification.md). The launch lobby and focused reconnect checks have passed. Use the isolated local/CI playtest for drawing, guessing, dislike penalties, hard-word carryover, and archive settlement. Playing a real production match creates audit and result records; do not present isolated test results as proof of a live match or erase immutable ledgers to clean up a test.

Render Free does not provide a service shell or one-off jobs. After a real account registers, an authorized operator can run `npm run admin -- <registered-username>` locally with `NODE_ENV=production`, the protected production `DATABASE_URL`, and `DATABASE_CA_CERT` when needed supplied to that process. The same verified TLS checks apply to this command and `npm run db:migrate`. Keep these values out of shell history, source files and browser code. [Render Free restrictions](https://render.com/docs/free).

The template is intended for one instance. A free instance has limited memory/CPU, so no concurrency or tournament capacity is promised without measurement. Keep the standard room size at eight players and start with a small community trial.

## Data, retention and ranked play

Initialize a fresh production database from the checked-in schema and seed; do
not import a development database or playtest assets. The seed contains the
credential-free system identity, Dussehra community and league, Skribbil rules,
cosmetics, level thresholds, challenge and achievement definitions, and the word
catalog. It creates no player accounts, seasons, tournaments, match results,
drawings, XP or completed challenges. Administrators create actual seasons and
tournaments after launch. Time-bounded challenge windows are generated by the
application and are legitimate configuration, not fabricated player progress.
The seed does not delete pre-existing data: any cleanup of an existing database
must identify synthetic records separately and preserve real accounts and history.

PostgreSQL contains accounts, league history, standings and metadata. The private bucket contains images and compressed canonical drawing operations. Canonical operations reproduce the final drawing; they do not promise the artist's original timing or a complete undo/clear history.

The default retention design is 30 days for original drawings, 7 days for replay operations, and 90 days for share cards. Curated public artwork requires the artist's publication consent. A running retention worker must delete the actual object as well as update its metadata. When the free service sleeps, in-process jobs also stop; expired assets should remain inaccessible immediately by timestamp checks, and deletion resumes when the worker runs again. Usage must stay within the free quotas; pause uploads or shorten retention instead of upgrading automatically.

Profile pictures and team logos are public while equipped. Static PNG, JPEG, and WebP sources
up to 8 MiB and 25 megapixels are accepted. Players crop locally before uploading;
the server validates the real container and decoded content, applies JPEG EXIF
orientation, and reencodes to a metadata-free 512 × 512 PNG. An account
can upload at most ten profile/team images daily. Replacing or removing an image
immediately blocks new reads of its old URL; the object is deleted after one day.
Already-issued signed URLs can remain valid for their 60-second lifetime.

The current Go adapter queues events in memory before writing an outbox file. On the free host, even a flushed file is ephemeral. A crash can lose live state or unsettled events. **Ranked mode is deliberately disabled** in both the template and startup script. Enabling ranked requires a durable acknowledged event transport, recovery/deduplication tests, session and ban enforcement, replayable settlement and a documented operational recovery process. Changing an environment flag does not solve these issues.

Use provider dashboards to monitor storage, database and network quotas manually. No paid scheduler or external keep-alive pinger is configured. For a zero-budget trial, accept suspension or a smaller player base when a quota is reached.

## Local verification

These commands do not publish anything:

```text
node --test tests/schema.test.mjs tests/database-tls.test.mjs
node --test infra/tests/proxy.test.mjs
node --check infra/cloudflare/_worker.js
node infra/prepare-pages.mjs
docker build -f infra/Dockerfile -t skribbil-preview .
```

The Node tests exercise routing, session-cookie forwarding, origin-secret replacement, blocked internal routes, redirect rewriting and WebSocket-response preservation. Local proxy tests do not establish public WebSocket connectivity. The live HTTP, database TLS, and storage checks listed above have passed; consult the verification record for the separate live lobby result. A Docker build requires Docker plus network access to package registries; if unavailable, report that limitation rather than treating the image as validated.
