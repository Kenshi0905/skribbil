# Word-selection evidence and difficulty design

Checked 15 October 2026. Observations below do not identify a private server algorithm.

## Public facts and direct observations

- [skribbl.io's own page](https://skribbl.io/) documents choosing a word, 1–5 choices, adjustable hints and Normal/Hidden/Combination modes (its 9 November 2022 update).
- In an ordinary public English room, the UI showed `Round 1 of 3`, masked letters and a length indicator. One observed four-letter hint was `h _ i _`; the end-of-turn chat revealed `hair`. Another completed turn revealed `Norway`. A later five-letter turn displayed `_ h _ _ _`. These are a few observations, **not an imported dataset**, a distribution sample or a difficulty classification.
- In a private-room settings screen, the visible options were Word Count 1/2/3/4/5 (3 selected), Game Mode Normal/Hidden/Combination (Normal selected), and Hints 0–5 (2 selected). This verifies available controls; it does not prove how hidden/combined words are sampled internally.
- No explicitly licensed official word-bank export or published difficulty specification was verified in the official home page, credits and focused search. Third-party copied lists are not a license. No proprietary scripts, source maps, client code or bulk vocabulary were copied or decompiled.
- The [official credits](https://skribbl.io/credits) do not describe word selection. The [site terms](https://skribbl.io/terms) do not provide an open-source word-bank license. This project implements its own behavior around the separately licensed scribble.rs engine.

## REA archive inspection and limits

The supplied ZIP is the MIT-licensed REA analysis toolkit, not word data. Its SHA-256 is `450618d6475df8e79fdb68966e850650baf6884631e34c8e71eb22c7c8bbb8f9`.
Read the README, package manifest and `docs/browser-observation.md` directly from the ZIP before considering execution. Its documented passive browser tools require an explicitly exposed loopback Chrome DevTools endpoint. This session exposes an in-app browser, no attachable CDP endpoint and no installed REA MCP tools. **REA runtime capture was not performed.** Public UI observations used the available browser control instead. No ZIP setup scripts, optional Frida installation or proprietary bundle analysis were run. Archive instructions were treated as third-party documentation.

## Our implementation choices

The pinned `engine/` copy retains upstream BSD-3-Clause notices and word packs. See its LICENSE and README for separately attributed assets. Ordinary word choices retain the upstream shuffled word-stack/custom-word behavior in `words.go`; we have not replaced the game loop or claimed its distribution matches skribbl.io.

The existing 12 original conceptual penalty prompts remain `curated-hard-v1`: e.g. time travel, optical illusion, continental drift. These are editorial priors, **not measured hard-word guarantees**. The penalty still forces one word from that distinct pool on the artist's next drawing turn. Ordinary turns are versioned `upstream-shuffle-v1` and keep their configured choices; pending debt is consumed only when drawing starts.

`server/word-difficulty.mjs` defines an original, versioned `pilot-v1` model:

`score = .55*(1-solveRate) + .25*normalizedGuessTime + .10*ambiguity + .10*(1-drawability)`

Solve rate is accepted eligible first solutions / frozen eligible guessers. Guess time is measured from the engine's monotonic word-start clock. Unsolved turns have no median rather than a fake zero. Aggregate reporting uses the median of per-turn medians, normalized by the median drawing-time budget; this is a deliberate small-storage approximation, not the exact median of every historical guess. Ambiguity and drawability are explicitly labeled editorial ratings in [0,1], to be reviewed during pilots. Words need at least **20 turns and 5 distinct artists** before receiving a calibrated tier: <=.35 easy, >=.65 hard, otherwise normal. Everything below that evidence threshold is `unmeasured`.

New signed turn events persist only solve count, median milliseconds, time budget and selection version alongside existing turn metadata. Anonymous time samples are used to compute the median, not a new player guess-history table. `node scripts/word-difficulty-report.mjs` produces recommendations using normal database initialization; it never silently changes the live word pool. Freeze reviewed data and increment the selection/model version before adopting calibrated pools.

## What testing can establish

Engine tests exercise ordinary selection, custom choices, forced hard choices, debt consumption and the separate once-per-round dislike allowance. The 10-player protocol test measures actual engine timing/settlement and checks that the new summaries are populated. Its scripted players know the word: **their solve rates and times cannot establish human difficulty**. Public observations are too sparse and have changing rosters to estimate reliable solve rates. A representative human pilot across age/language/device groups is still required before the editorial hard pool can be called empirically calibrated. Never manufacture pilot results to fill that gap.

The measured protocol run completed 20 turns with 180/180 scripted eligible solutions; per-turn median times ranged from 996 to 1516 milliseconds. This is instrumentation evidence only, with answers known to the agents, not a human easy/hard calibration dataset.
