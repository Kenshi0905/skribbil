# Play again returns to the waiting room

The game-over WebSocket event can reach browsers before the asynchronous result
worker commits the match record. The session endpoint now returns HTTP 202 for
that verified finished-room state, rather than sending a premature rematch
request to the completed-result API. The client displays a saving message and
retries with backoff. It keeps the original results visible, prevents duplicate
Play again requests, and permits leaving or deleting between retries. Losing
leadership or receiving a room transfer cancels pending retries.

The engine still verifies the current connected host and game-over state on
every request. Result acceptance, participant eligibility, Clubhouse admission,
spectator restrictions and immutable score records remain authoritative. A
pending save never creates a successor or bypasses result validation.

After saving, every connected player and spectator is transferred to the same
new waiting room. Arrival no longer starts the match or marks guests ready.
The host can edit settings and everyone can edit their room look, then guests
ready up and the host explicitly starts. Carried room identities are consumed
once so reconnecting cannot overwrite new waiting-room edits. New scores start
at zero; the completed match keeps its separate final result.

Validation includes the client retry/cancellation tests, database result-gating
tests, Go ownership/readiness/identity tests, and a two-game protocol playtest
with ten players plus a spectator. The playtest deliberately holds final result
saving, checks the 202 response, transfers all eleven clients into an unstarted
room, edits a room look, readies guests and starts explicitly. It also checks
separate second-game results and deletion/leadership behavior. This extended
flow now runs in production CI alongside the existing multiplayer playtest.

Browser checks reproduced the held-save state without a red error, automatic
host and guest transfer after saving, a disabled Start button with 0/1 guests
ready, host settings, guest room-look editing and the mobile waiting layout.
