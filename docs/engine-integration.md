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

Returns `{"lobbyId":"league-<opaque-id>"}`. Creation is serialized and idempotent by match ID. Private settings are bounded to 1–20 rounds, 60–300 seconds, and 2–24 players. Ranked creation ignores caller overrides and fixes `skribbil-ranked-v1`: 3 rounds, 80 seconds, 8 players, English, three ordinary word choices, upstream competitive scoring, no custom words, private access. Every HTTP patch route rejects changes to ranked settings. Ranked admission requires explicit `SKRIBBIL_RANKED_ENABLED=true` after deployment validation.

The platform signs a short-lived ticket:

```json
{"userId":"account-uuid","username":"Artist","matchId":"universal-match-uuid","lobbyId":"league-...","expiresAt":1791800000,"role":"player","hardWordPending":false}
```

`expiresAt` is Unix seconds, strictly in the future and no more than five minutes away. `role` may be `player` (or omitted) or `spectator`. Token format is `base64url(JSON) + "." + base64url(HMAC-SHA256(secret, encodedPayload))`, with no padding. Launch `/engine/league/join?ticket=<token>`. The engine validates signature, expiry, match/room binding, role, slot availability, and one live participant per account. It binds the account to the engine participant, sets an HttpOnly SameSite=Strict gameplay cookie, and redirects to `/engine/lobby/<id>`. The redirect and no-referrer policy keep the ticket out of subsequent page requests. Reverse-proxy logs must redact the ticket query string.

Managed rooms reject anonymous joins through both the native HTTP API and server-rendered lobby route. A removed participant cannot rejoin to gain a second identity. Native account-name changes and role toggles are disabled in league rooms. Spectator tickets cannot draw, guess for points, dislike, force-start, post into participant chat, or cast kick votes. Observers have a separate 100-person room cap, consume no player slots, and do not affect readiness or kick-vote quorum. A league match needs two connected participants. New ranked players cannot enter after the match starts. The backend must still enforce account bans, invitations, tournament rosters, and one active ranked admission per account before issuing tickets.

A fresh platform match/room is required for a rematch, preserving immutable result identity. Native standalone casual lobbies remain available at `/engine` without league tracking. The proxy must forward WebSocket upgrades, preserve the browser Host header, and only trust its own forwarding headers; the engine rejects mismatched browser Origins.

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
- `match.completed`: `mode`, `rulesVersion`, `deliveryFailed`, and `participants:[{userId,playerId,username,score,rank}]`. The retained match roster includes participants removed from the active room so their result history is not silently lost. Spectator-only accounts are excluded. Ties use equal dense ranks.

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
