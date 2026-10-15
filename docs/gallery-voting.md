# Gallery voting, cleanup and storage

Gallery nominations are separate from live drawing reactions and the unanimous −100 penalty. After each archived turn, authenticated participants see Fame/Shame controls in the room. The database freezes the eligible non-artist participants reported by the signed engine event. Spectators, later arrivals outside that electorate and the artist cannot vote. Membership/access rules still apply to private Clubhouses.

A `(turn_id,voter_id)` primary key and electorate foreign key enforce uniqueness and eligibility. Transactions lock the window, check `clock_timestamp()` after waiting, and insert only before the deadline. Identical retries return the recorded decision; opposing duplicate votes return 409. Reconnecting reconstructs counts and the player's choice from PostgreSQL, not local storage. Counts refresh every four seconds while visible; the drawing WebSocket is untouched.

Defaults: `GALLERY_VOTE_SECONDS=60` (10–300), `GALLERY_MIN_VOTERS=3` (2–24), `GALLERY_MAJORITY_PERCENT=67` (51–100). Settings are snapshotted per turn. A nomination requires the minimum actual voters and the specified fraction of cast votes. Ties/insufficient participation/no majority mean **no decision**. Open-window results are provisional. `gallery_vote_totals` only finalizes candidates after close. A three-player room cannot reach the default three non-artist votes; configure a minimum of two if that is desired.

Candidates never publish automatically. Artist consent and admin curation are required. Withdrawal unpublishes old entries, so re-consenting cannot resurrect removed art without fresh moderation. Shame means playful feedback on a drawing, never a personal judgment. Votes cannot overturn a takedown.

## Minimal storage and post-game cleanup

- The one canonical drawing/replay archive is reused. Votes and halls never create another image. Gallery images already load lazily; no thumbnail cache is generated in this version, trading a little first-view bandwidth for zero duplicate blob storage. If thumbnails become necessary, derive one cache object per canonical source and remove it with that source.
- A vote stores turn UUID, voter UUID, choice and timestamp only. The focused test measured **141 bytes for two vote tuples, excluding indexes**; image count and total blob bytes changed by **zero**. PostgreSQL page/index overhead means this is not the full allocated disk cost.
- At match settlement, unpublished original expiry is capped at **24 hours**, replay expiry at **one hour**. Idle/cancelled completed rooms receive the same cap during maintenance. Repeated cleanup or renewed consent never extends an existing earlier expiry. Active unpublished turns retain the existing outer caps (30 days original, 7 days replay) if a match never settles; normal ended/abandoned matches use the shorter caps.
- Consenting is not a storage hold. Only active admin curation/publication or an explicit legal hold can retain selected artwork longer. Withdrawal/takedown restores a bounded review window. Votes never extend blob expiry.
- The engine releases its transient final stroke array and per-turn timing map after queuing the immutable archival/final-result events. Durable outbox delivery remains intact. Native idle-room cleanup and existing browser chat limits remain in force.
- Keep match results, XP, standings, audit receipts, vote uniqueness/audit rows and small drawing metadata. They support history, disputes and fraud prevention; deleting them after every game would break required features. Expired blobs are claimed before deletion, failures retry, and metadata records deletion state.

This reduces retained blobs and transient memory; it does not eliminate free-tier cold starts or guarantee lower network latency. Runtime object cleanup is best-effort on the existing maintenance schedule, so an expiry timestamp is not a promise of deletion at that exact second.
