# Mobile interaction corrections — 19 October 2026

The purple webpage Send button now retains the input's focus during a primary
pointer tap. A deliberate Send click submits the current draft even when a
mobile keyboard is composing a word; implicit Enter still respects composition.
The click prevents the additional native form submission. Spectator, socket,
message-length, recall and ordinary keyboard-submit behavior remain unchanged.
The guess field uses a compact purple focus indicator in both themes.

A typing drawer no longer reserves a redundant “Your canvas” heading. Viewport
measurement treats this as a league game even when that heading is hidden,
reserving only the actual headers, tabs and input. Focus changes trigger a fresh
measurement. At 320×350 the complete drawing occupied 260×146, the input ended
at 342px and there was no horizontal page overflow. Browser viewport resizing
simulates keyboard space; actual Android Gboard and iOS keyboard behavior still
needs a physical-device check.

The mobile drawer's palette remains inline while drawing and selecting colors.
It contains the original 26 colors in two compact rows, with horizontal scrolling
where necessary on narrow phones. Brush sizes retain their existing popover;
palette and tools compact away while typing. Avatars and scores retain real
player data. Names, including moderation buttons, occupy the row above scores;
the previous button-specific grid rule can no longer place them over scores.

Canonical line/fill rendering, protocol coordinates and stroke events remain
unchanged. A presenter combines dirty regions into one canvas upload per display
frame instead of uploading for every coalesced sample. Coordinate conversion
reads the display scale once per line. Fill, undo and replacement request a full
presentation, and turn handoff flushes pending pixels before capturing artwork.
A deterministic regression test confirms 128 sample invalidations produce one
upload covering all dirty pixels; this is not a physical-device latency benchmark.

The per-turn canvas recap and its player score-gain list have been removed from
both word-selection dialogs. The previous answer remains in chat, player scores
remain in Players, and authoritative final standings/results remain unchanged.

Validation: 247 Node tests, 246 passed, one optional external PostgreSQL test
skipped; the Go race suite passed. Browser checks covered webpage Send taps in
drawer and guesser roles, exactly one received message, cleared draft, retained
focus, both themes, narrow keyboard space, palette remaining open through drawing,
name/score box separation and a correct-guess turn transition with zero recap
elements. No production account or game data was changed during these checks.
