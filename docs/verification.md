# Milestone verification

This record describes local evidence. It does not certify production deployment,
physical-phone compatibility or crash recovery. Feature boundaries remain in
[implementation status](feature-status.md).

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

The [GitHub verification run for `1bf0b5a`](https://github.com/Kenshi0905/skribbil/actions/runs/38287144653)
passed all four jobs: platform, Go engine (including the full race suite),
ten-player multiplayer run and production container build. The Pages proxy
suite passed all five cases. Local Node checks passed 91 tests, with the optional
real-engine gateway case run separately and also passing.
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
executed locally; the GitHub CI container build passed. Cloudflare Pages,
Render and Supabase deployment, hosted WebSocket behavior and hosted storage
verification are also pending; no production service was provisioned here.

Ranked play remains disabled on the free hosting profile. Live rooms are held in
engine memory, the event outbox has a small memory-before-fsync window, and the
free container filesystem is ephemeral. Process or host replacement can lose an
active room or an event that was not made durable. These runs do not establish
tournament-grade recovery or sustained production capacity.

No actual administrator credentials are included in source or Git. Administrator
account/role provisioning is an operator step at deployment; there is no shared
default admin password. Keep account data, database files, session material and
deployment secrets in protected runtime storage. See the
[free deployment guide](free-deployment.md) for setup and its remaining checks.
