# Skribbil engine integration

## Provenance and preserved behavior

`engine/` is the actual source of [scribble-rs/scribble.rs](https://github.com/scribble-rs/scribble.rs), pinned to commit `1bda7ed8b880bb598dede5096c0e2f3f58abe0b8` (6 September 2026). Its BSD-3-Clause license, upstream README, and third-party asset credits are retained. The original logo, background, and favicon were explicitly excluded from that license; they are removed/replaced with original Skribbil SVG/CSS assets. A new product name does not remove license obligations.

The original client remains the playable game: original canvas renderer, brushes, fills, undo/clear, hints, chat/guess handling, native scoring algorithms, spectators, reconnect flow, turn timer, and concurrent lobby registry. The wrapper adds a small solid-color league toolbar with an authoritative dislike control. The platform is not a replacement canvas or simulated local game.

## Concurrency boundary

Upstream `internal/api/ws.go` uses `gws` with parallel input handlers and asynchronous ordered outgoing writes. `Lobby.HandleEvent` and timer `tickLogic` serialize room state with the existing per-lobby mutex. Keep that transport, writer queue, and mutex. Each engine process owns many independent rooms; route every connection for a room to its owning process. Redis/database pub-sub is not the drawing transport.

A real two-client WebSocket race test exposed an inherited upstream disconnect race: connection fields were cleared outside the mutex. The integration moves that transition into the same lobby lock and removes the duplicate unlocked clear; no drawing or guess algorithm is changed.

The additions in `internal/game/league.go` execute while that same mutex is held. Vote membership, votes, exact score deduction, hard-word debt, and turn transition therefore have one serial order. There are no network/database/filesystem calls inside the room mutex. At turn completion the engine copies the final drawing-operation slice; its accepted operation objects are immutable. It also copies primitive result fields into a detached event payload. A bounded channel sends those snapshots to an outbox worker.

The outbox worker writes and fsyncs each JSON event to a temporary file, renames it into the outbox, then an independent delivery worker POSTs it to the platform. A 2xx acknowledgement removes the file; transport errors/non-2xx preserve it for retry, including across process restarts. The platform must transactionally deduplicate `eventId` and `(matchId, sequence)` before applying scores or rewards.

**Known durability boundary:** channel admission precedes disk fsync, so a process/power failure can lose an event in that short interval. Queue overflow marks `deliveryFailed` on the result and logs a critical error. Rooms themselves are in memory. A production ranked rollout must invalidate interrupted matches and reconcile missing sequences, and should use a durable local journal or acknowledged append stream before committing final ranked settlement. Do not advertise exactly-once delivery or crash-resumable rooms. The default ranked gate is off.

## HTTP admission contract

Environment (engine listens privately on port 8080):

```dotenv
ROOT_PATH=/engine
NETWORK_ADDRESS=127.0.0.1
PORT=8080
SKRIBBIL_ENGINE_SECRET=<same random secret as platform, at least 32 characters>
SKRIBBIL_EVENTS_URL=http://127.0.0.1:3000/api/internal/engine-events
SKRIBBIL_OUTBOX_DIR=.data/engine-outbox
SKRIBBIL_RANKED_ENABLED=false
```

In containers use an internal network address, `http://platform:3000/...`, a persistent outbox volume, and do not expose the engine's internal control endpoint publicly. Secrets are read directly rather than through upstream's logging environment parser.

`POST /engine/internal/rooms` requires `Authorization: Bearer <SKRIBBIL_ENGINE_SECRET>` and JSON:

```json
{"matchId":"universal-match-uuid","mode":"private","rounds":3,"drawTime":80,"maxPlayers":8}
```

`POST /engine/internal/rooms/cancel` uses the same bearer authentication with `{matchId,lobbyId}`. It serializes cancellation against the first start event with the room mutex: only unstarted matches can be cancelled; a running/finished game returns 409. Repeating an accepted cancellation is idempotent. The platform must obtain this acknowledgement before changing its database status.

`POST /engine/internal/rooms/status` uses the same bearer authentication with `{matchId,lobbyId}`. A matching, non-cancelled room returns exactly `{"exists":true}` with `Cache-Control: no-store`; it exposes no words, participants, scores, or other room state. An authoritative missing room, mismatched match/room binding, or cancelled room returns 404 with the exact text body `match not found` (plus a trailing newline). A finished room still returns 200 while result delivery may be pending. Invalid input returns 400 and invalid authentication returns 401. The platform may abandon an active database reservation only on the authenticated status endpoint's 404; connection failures, timeouts, other HTTP errors, or a generic gateway 404 are not evidence of abandonment. This lets every participant recover after an engine restart without waiting for an absent room owner.

Returns `{"lobbyId":"league-<opaque-id>"}`. Creation is serialized and idempotent by match ID. Private settings are bounded to 1–20 rounds, 60–300 seconds, and 2–24 players. Ranked creation ignores caller overrides and fixes `skribbil-ranked-v1`: 3 rounds, 80 seconds, 8 players, English, three ordinary word choices, upstream competitive scoring, no custom words, private access. Every HTTP patch route rejects changes to ranked settings. Ranked admission requires explicit `SKRIBBIL_RANKED_ENABLED=true` after deployment validation.

The platform signs a short-lived ticket:

```json
{"userId":"account-uuid","username":"Artist","matchId":"universal-match-uuid","lobbyId":"league-...","expiresAt":1791800000,"role":"player","hardWordPending":false}
```

`expiresAt` is Unix seconds, strictly in the future and no more than five minutes away. `role` may be `player` (or omitted) or `spectator`. Token format is `base64url(JSON) + "." + base64url(HMAC-SHA256(secret, encodedPayload))`, with no padding. Launch `/engine/league/join?ticket=<token>`. The engine validates signature, expiry, match/room binding, role, slot availability, and one live participant per account. It binds the account to the engine participant, sets an HttpOnly SameSite=Strict gameplay cookie, and redirects to `/engine/lobby/<id>`. The redirect and no-referrer policy keep the ticket out of subsequent page requests. Reverse-proxy logs must redact the ticket query string.

Managed rooms reject anonymous joins through both the native HTTP API and server-rendered lobby route. A removed participant cannot rejoin to gain a second identity. Native account-name changes and role toggles are disabled in league rooms. Spectator tickets cannot draw, guess for points, dislike, force-start, post into participant chat, or cast kick votes. Observers have a separate 100-person room cap, consume no player slots, and do not affect readiness or kick-vote quorum. A league match needs two connected participants. New ranked players cannot enter after the match starts. The backend must still enforce account bans, invitations, tournament rosters, and one active ranked admission per account before issuing tickets.

For every managed-room browser hop the gateway overwrites `X-Skribbil-User` with the authenticated account ID and `X-Skribbil-Gateway-Key` with the engine secret. The engine constant-time checks the key and binds that account to the signed ticket or the native usersession owner on WebSocket upgrades, lobby pages and native HTTP mutations. This prevents one logged-in account from borrowing another account’s engine cookie to see its word or act as that player. The raw key stays on the private gateway-to-engine hop and must never be forwarded to a browser or logged. Standalone upstream rooms do not require these headers.

A fresh platform match/room is required for a rematch, preserving immutable result identity. Native standalone casual lobbies remain available at `/engine` without league tracking. The proxy must forward WebSocket upgrades, preserve the browser Host header, and only trust its own forwarding headers; the engine rejects mismatched browser Origins.

`POST /api/matches/:id/rematch` requires a player present in the completed match's accepted result. One durable `match_rematches` mapping gives all returning players the same new match; a source row lock and unique constraints serialize allocation, and account locks prevent concurrent admission elsewhere. The engine receives a stable match ID on retries. A timeout keeps the pending reservation so retrying after a lost response or API restart cannot allocate another room. Completed/cancelled successors are never reopened. Tournament fixtures must be advanced or rescheduled by their organizer, and ranked rematches retain the ranked gate and immutable rules. A ranked successor uses a currently active season only if that season accepts the same ruleset; it never continues scoring into a closed season.

Private rematches preserve the final round count, configured drawing duration, player cap, and platform room privacy. An owner edit queued during the last drawing is included in the final settings snapshot. Auxiliary native word-choice and per-IP controls currently return to adapter defaults in a rematch. Older engine results without a settings snapshot use the settings stored at initial room creation; unsupported settings return an explicit error. The completed-result requirement also ensures the previous match has reached the result consumer before issuing a new hard-word-debt ticket.

## Dislike penalty semantics

1. When the artist chooses a word, snapshot connected, non-spectating participants other than the artist. The room's voters are its guessers, including players who subsequently solve the word. The artist cannot vote on their own drawing. A zero-person electorate never triggers a penalty.
2. The client submits `{"type":"dislike-drawing","data":{"turnId":7}}`. The server checks the current turn counter, active drawing, authenticated participant state, and frozen eligibility. Clients do not supply identities, scores, counts, or chosen penalties.
3. Duplicate votes are idempotent. Late joiners cannot vote in this turn. Disconnects/leaves do not shrink the denominator; a disconnected eligible player may reconnect as the same participant and vote. This prevents a disconnect from manufacturing unanimity. A missing voter may prevent the penalty, which is the explicit fairness trade-off of this policy.
4. Under the same mutex, exactly `votes == eligible && eligible > 0` sets the once-only applied flag, subtracts **exactly 100 points**, recalculates ranks, marks the artist's hard-word debt, and broadcasts updated scores. Scores may become negative. Ordinary drawer/guesser scoring is otherwise unchanged.
5. On the affected artist's next word-selection turn, override the native random word choices with exactly one item from a separate curated hard-word pack. Both selecting it and letting the native timeout choose it force a hard word. The debt is consumed only when the word starts; a skipped/disconnected turn does not consume it. Later ordinary choices use the untouched upstream word selector.
6. The signed ticket can initialize cross-match `hardWordPending`. The platform persists debt on `drawing.penalized` and clears it on `hard-word.consumed`, using sequence and event-time guards. As webhook delivery is asynchronous, a production rematch should wait for previous-match settlement before issuing a fresh ticket; otherwise a rapid cross-room join can temporarily observe stale debt.

`dislike-state` broadcasts `{turnId,votes,required,applied,eligible,voters}`; IDs here are engine player IDs, not universal account IDs. Reconnect `ready` includes the current state. Votes and IDs reset at the next word start. Final-turn debt is carried through the platform account state into the next match.

The initial hard pack is a versioned English starter set of difficult concepts (for example optical illusion, continental drift, parallel universe). It requires community difficulty calibration and larger localized packs before claiming standardized competitive difficulty.

## Authoritative event contract

Every POST to `SKRIBBIL_EVENTS_URL` has `Content-Type: application/json` and `X-Skribbil-Signature: <hex HMAC-SHA256(secret, exact raw body)>`:

```json
{
  "eventId":"uuid",
  "sequence":1,
  "type":"turn.completed",
  "matchId":"universal-match-uuid",
  "lobbyId":"league-...",
  "occurredAt":"2026-10-12T12:00:00Z",
  "payload":{}
}
```

Sequence increases for every event within the room's single match. Event payloads:

- `drawing.penalized`: `turnId` (UUID), `turnNumber` (integer), `artistId`, `userId`, `delta:-100`, `dislikeCount`.
- `hard-word.consumed`: `userId`, `turnId` (UUID), `turnNumber`.
- `turn.completed`: `turnId` (UUID), `turnNumber`, `round`, `artistId`, `artistUsername`, `word`, `dislikeCount`, `penaltyApplied`, `hardWord`, `eligibleVoterIds`, `voterIds`, `drawing`. IDs in these payloads are universal account IDs. The revealed prompt is emitted only after the turn ends.
- `match.completed`: `mode`, `rulesVersion`, `deliveryFailed`, `settings:{rounds,drawTime,maxPlayers}`, and `participants:[{userId,playerId,username,score,rank,correctGuesses,fastestGuessMs,comebackWin}]`. The retained match roster includes participants removed from the active room so their result history is not silently lost. Spectator-only accounts are excluded. Ties use equal dense ranks in the engine; the platform derives competition ranks from final scores. The settings snapshot updates only private rule fields; a competitive snapshot must match its locked ruleset.

Guess telemetry increments only at the native accepted-correct-guess branch, before the guesser changes state, and excludes spectators. The fastest duration uses a monotonic clock starting when the selected word begins; it is null when no duration exists. Correct guesses count accepted solutions even if a later native kick refunds points. The comeback flag requires at least two different scores at the actual start of the final round, after the prior artist's points have settled, and a final winner who was tied or alone at the bottom in that frozen snapshot. One-round games, all-tied snapshots, early endings, and private edits that change the final-round number do not manufacture the achievement. No synthetic rounds-won metric is emitted.

Final scores already include the dislike deduction. **Do not subtract the `drawing.penalized` amount again during final score ingestion.** Use the penalty event for the audit trail, challenges, and hard-word debt. League points can be derived separately under an immutable game/season scoring policy.

An archive contains original canonical operations on a 1600×900 canvas:

```json
[
  {"type":"line","data":{"x":12,"y":15,"x2":20,"y2":35,"color":2,"width":8}},
  {"type":"fill","data":{"x":100,"y":100,"color":2}}
]
```

Color is an index in the original client's 26-color palette. The list reflects native undo/clear, so it reconstructs the finished canvas and supports step-by-step reconstruction. It is not a timestamped recording of deleted strokes, guesses, or chat. Do not approximate a flood fill as a whole-canvas fill in thumbnails. Keep the replay JSON private in object storage, render through the original algorithm, and store only object keys/checksums/retention/curation metadata in PostgreSQL.

## Local verification

From `engine/` with Go 1.25 or later:

```sh
go test ./...
go test -race ./internal/game ./internal/api
go build -o ../.tools/skribbil-engine ./cmd/scribblers
```

The inherited test suite is retained. Added tests exercise quorum, duplicates, stale turns, spectators, negative deductions, concurrent vote races, reconnect membership, forced hard choices, detached drawing snapshots, signed/expired tickets, immutable ranked settings, and signed outbox retries, unstarted-only cancellation, and a real two-client WebSocket exercise of drawing, guessing, turn advancement and the penalty. Go's race detector requires a 64-bit C compiler on Windows.

## Touch input and reproducible playtest

The original canvas now uses a single Pointer Events adapter for mouse, pen and touch. It captures one primary pointer, handles cancellation and lost capture, draws a tap exactly once, supports fill taps and coalesced pen pressure samples, and bounds CSS coordinates before the unchanged native canvas conversion. Only the canvas suppresses touch scrolling; page zoom remains available elsewhere. Phone layouts retain the canvas aspect ratio, provide 44px tools and horizontally scrollable colors/players, and place usable chat with an explicit Send button below the board. Input unit tests are in `tests/canvas-input.test.mjs`; they are not physical-device tests.

Run `node tests/playtest-10.mjs` with `ENGINE_BINARY` pointing to a current engine build. It creates a private local engine/API, an in-memory database and runtime-generated synthetic credentials, drives 10 authenticated players plus a spectator through two rounds, and removes its data afterward. Three connections have mobile User-Agent headers, which is protocol coverage only; real touch and mobile layout require browser/device testing. It checks readiness, chat, line/fill fan-out, reconnection, account binding, unanimous penalty, hard-word consumption, 20 archives and 10 authoritative results.

For a live screenshot fixture, append `--demo`. It creates an isolated Clubhouse and an administrator spectator with synthetic local credentials. The ignored `.data/playtest-demo-<pid>.json` metadata contains the local origin, login, Clubhouse ID and two control-file paths. The lobby waits up to 12 minutes for `startFile`, allowing browser login and Clubhouse inspection. After that file is created, the native game starts with a 300-second drawing timer; metadata gains a fresh spectator launch URL and the first real canvas pauses for at most four minutes, until `continueFile` is created. The Go game timer is never paused or bypassed. Credentials and metadata are removed on normal exit; never commit, publish or include them in screenshots.

The native sound toggle remains in the game menu, alongside one persisted Effects volume slider with a 44px interaction target. New preferences default to 40% master volume, with the correct-guess pop at half gain (20% effective default). Existing mute preferences are honored. A single Web Audio context unlocks on pointer/keyboard gestures, and per-effect GainNodes control amplitude on browsers such as iOS Safari that do not reliably apply HTML media volume. Sources and gains disconnect after playback. Moving the slider changes active effects, muting stops them immediately, and suspended or rejected playback is skipped without queuing stale sounds. A simultaneous burst of correct guesses shares one pop until it finishes; turn notifications remain independent. Browsers without Web Audio use the HTML audio fallback. Audio behavior is covered by `tests/game-audio.test.mjs`; physical iPhone playback still requires device verification.
