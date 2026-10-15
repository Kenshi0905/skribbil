# Clean community UI and phone gameplay verification

## Baseline — 15 October 2026

- Main and origin/main: `578d24360371948bf606552a3d9724deec8bfe00`.
- Working tree: only the pre-existing, untracked `web/assets/discord-server-icon.png`; left untouched.
- Node: 227 tests, 226 passed, one optional external PostgreSQL integration skipped.
- Go: `go test -race ./...` passed. Baseline engine built from `./cmd/scribblers`.
- Syntax check, secret guard (291 tracked files), and eight infrastructure tests passed.
- There is no frontend bundle build, configured linter, or TypeScript checker. The app serves native ES modules/CSS; syntax checks, rendering tests, the Go build and container CI cover its available build checks.
- Reference images: four approved clean UI images in `output/imagegen/`. Mobile references guide styling only; no simulated phone status bar or fictional people/rooms will ship.

## Scope and safeguards

Preserve existing routes, accounts, avatar/photo editing, community permissions,
room admission, original Go gameplay/concurrency, scoring, independent voting
systems, curation/consent, replay and retention. Use existing free services and
dependencies. Prioritize measured layout/rendering defects; optional smoothing,
worker, transport and adaptive-memory experiments need further evidence and are
not automatic production changes.

## Implemented

- Clean community shell matching the approved desktop layout and palette. Rooms sit left, XP/quests right, leaderboard below; phone order is rooms, leaderboard, quests, XP. The yellow create-room illustration is original SVG. No native-phone chrome, mock people, scores, online presence or rooms ship.
- Persistent light/dark toggle, account/notification actions and all existing routes. Friends, requests, invitations, Clubhouses, room ownership controls, profile/Character Workshop/photo crop/upload, league, gallery and admin flows remain accessible.
- Prominent room-code/invitation joining reuses the existing authenticated admission path. Codes cannot bypass Clubhouse membership, reserved admission, bans or closed-room checks. In-flight hub refreshes preserve a typed code, selection and focus.
- Real level thresholds supply progress. Profile all-time points now agree with accepted casual results and corrections; competitive/season standings remain separate. Profile and friend-profile captions correctly label the stable account handle while headings use the current display name.
- Phone tools reuse the original controls/handlers in a compact row with colour/size popovers. Reaction controls have a stable slot; keyboard-sized views retain the earlier overlay/resize behavior. Landscape fits the full 16:9 board without stretching/cropping. The menu stays below its opener, and gallery history has an explicit Close action.
- Fixed-height gallery slot prevents arriving votes from shifting the canvas. History/threshold/publication detail lives in a scrollable panel. Counts and immutable choices still come from the existing server, independently of penalty dislikes. Polling falls from every four seconds to every 15 seconds, with turn/vote/reconnect refreshes, hidden-page pauses and error backoff capped at one minute.
- Word/score recaps accompany the existing next-word picker without delaying it or changing deadlines. Previous-canvas fades are bounded, non-intercepting and disabled for reduced motion. Chat follows only near the bottom and offers a new-message button while reading history.
- Correct dirty rectangles in both line presentation paths; cache pointer geometry per frame with resize/scroll/pan invalidation. Every stroke sample and the existing canonical pixels/protocol remain intact. Muted/zero-volume audio avoids initialization; canvas gestures no longer initiate audio unlock. Native identity periodic fallback is one minute; change/focus/reconnect recovery remains immediate.

## Results

- Node: **237 tests, 236 passed, one optional external PostgreSQL integration skipped**, zero failures. Existing HTTP tests were updated to distinguish all-time profile points from competitive standings; added coverage includes code admission/Clubhouse denial, level progress, account-handle presentation, literal/limited turn recaps, pointer geometry invalidation, deterministic dirty rectangles, muted audio and gallery close/duplicate behavior.
- Go: **all packages passed `go test -race ./...`**; final native executable built. No Go gameplay-loop, scoring, concurrency or word-selection source changed.
- Eight infrastructure tests, syntax checks, pinned formatter checks for new styles/modules, and `git diff --check` passed. There is no configured linter/type checker to run. Secret guard is run again on the staged tree before publication.
- Ten-player protocol playtest: ten authenticated players and one spectator; three mobile User-Agent clients; **20 turns, 20 archives, ten results, 180 scripted correct guesses**. Readiness/room looks, re-entry, borrowed-cookie denial, rename broadcasts to all 11 clients, reconnect identity/drawing, spectator exclusion, unique unanimous −100 penalty, forced hard word, separate gallery votes, rematch defaults and replay expiry passed. These scripted solve times are not human difficulty calibration.
- Real Chromium browser checks used two independent clients and disposable in-memory databases. Community screenshots cover both themes at 320/360/390/430/600/760/768/900/1024/1440 widths plus 844×390. No horizontal page overflow; requested card order and visible theme toggle retained. Empty and completed-match populated states, current names/long names, friend acceptance, notifications, create/join, every route, menu dismissal, preset save and cropped photo upload were checked. Loading and temporary API failure/retry states were exercised.
- Actual native touch-event injection reached the other client with **identical canvas pixels**. Erase, fill, undo and clear also matched; clear returned an all-white board. Gallery choice/count survived reload, stayed disabled, and did not change penalty reactions. Recap and a live handoff were observed; the picker stayed usable. No uncaught application errors were collected. Two harness-only mistakes (clicking an obscured opener, then unregistering a pending route twice) were resolved; neither was classified as an application exception.

### Dedicated phone pass

Both themes, guesser input focused/unfocused; all listed canvas values are CSS pixels. The backing canvas stays **1600×900**.

| Viewport | Full canvas | Guess field bottom |
| --- | --- | --- |
| 360×800 | 352×198 | 796 |
| 390×844 | 382×215 | 840 |
| 430×932 | 422×237 | 928 |
| 390×400, focused | 345×194 | 396 |
| 390×320, focused | 203×114 | 316 |
| 844×390, focused | 412×232 | 386 |
| 844×390, unfocused | 327×184 | 386 |

Artist touch/palette/size/erase/fill/undo/clear and phone gallery/menu controls were checked separately. Swatches remain 44×44; input is 44px with 16px text. Unit tests preserve visualViewport resize/pan, pinch zoom, observer updates and disposal. Community editors scroll naturally, including the crop/save action in a 390×400 viewport. The earlier keyboard-aware QOL was preserved, not replaced with a fixed-height native-app layout.

### Measured rendering effect

Comparable local 180-update gesture, around six seconds; diagnostic single trials, not a universal benchmark. Before: 69,555,337 submitted dirty pixels; after: **116,490**. Warm synchronous canvas API time was 300.7→223.8ms normally and 1,194.5→971.9ms at 4× CPU throttling. Post-change p95 frame interval was 16.9ms, with no frames over 34ms in these two samples. Canvas size/brush/path affect these numbers. This does not establish network latency, physical-phone speed or a replicated private skribbl algorithm.

### Research disposition

The REA/DevTools study's production-ready layout, stable voting, dirty-rectangle, input-geometry, audio startup, recap, chat-follow, touch-target and polling fixes are implemented. Existing IME/Enter handling, bounded chat/undo, identity controls, consent/moderation, retention, reconnect state and free-hosting warnings were retained and regression-tested where available. The toolbar is compact rather than removing the user's visible theme/back/share actions. Short views reuse the original reaction overlay to protect keyboard QOL.

Frame batching, raster smoothing/interpolation, worker flood fill, adaptive undo tiles, wire encoding/backpressure changes, new presence infrastructure, haptics and extra telemetry remain experiments. The study did not justify changing their protocols, pixel semantics or memory budgets for this release. Human word-difficulty calibration and proprietary algorithm reconstruction are not claimed. Public browser observations remain separate from our original word model in [word research](word-selection-research.md).

## Limits and release checks

No physical Android/iPhone software keyboard, Safari/WebKit, low-memory GPU or 120Hz device was available. Desktop touch/viewport emulation and unit tests cannot certify every phone. No external PostgreSQL concurrency or sustained production-load run was performed. Free backend sleep/restarts and memory-resident active rooms remain existing limits; ranked stays gated. No paid dependencies/services, hosting changes or production dummy users were introduced.

Ignored local screenshots/traces and test summaries live in `.tmp/ui-revamp/`. Selected credential-free screenshots are copied into `docs/media/` with explicit synthetic-local captions. Temporary fixtures expire/clean their credentials; test data is never production data. CI must pass platform, engine, container and multiplayer jobs before the existing Render-then-Pages deployment proceeds.
