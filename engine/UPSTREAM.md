# Preserved upstream engine

Source: https://github.com/scribble-rs/scribble.rs
Commit: `1bda7ed8b880bb598dede5096c0e2f3f58abe0b8` (2026-09-06).
Imported from the exact GitHub commit archive; original LICENSE and README credits retained.

The original logo, background, and favicon are excluded from upstream BSD licensing. They have been removed/replaced with original Skribbil SVG/CSS assets. Renaming a game does not change copyright obligations. Other original asset attribution remains in README.md.

Skribbil additions: `internal/game/league*`, `internal/api/league*`; small hooks in lobby.go, shared.go, data.go, route/identity guards, and the original client dislike controls. Core draw.js, word matching/scoring algorithms, gws transport, room registry, and normal turn timer remain upstream. See ../docs/engine-integration.md.
