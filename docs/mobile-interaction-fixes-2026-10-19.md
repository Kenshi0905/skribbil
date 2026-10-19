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

Follow-up: the mobile game header contains only branding, Copy invite and the
room menu. The profile button is removed on mobile; theme switching remains in
the room menu. During short-viewport input focus the entire toolbar is hidden,
including Copy invite and the room menu, leaving round, hint and time above the
canvas. Blur restores it. The active-play header is 44px otherwise. Desktop
retains its profile and header controls. The mobile drawer omits the redundant
canvas heading.

The end-turn effect is decoded after a non-canvas user gesture and plays on
actual turn endings, including the final game-over event. Initial waiting is
quiet; existing mute, volume and word-choice effects are preserved.

Explicit measurements on this workstation (not physical-phone measurements):

| Measurement | Samples | Median | 95th percentile | Maximum |
| --- | ---: | ---: | ---: | ---: |
| Production pointer input to canvas pixel upload | 240 samples / 60 uploads | 16 ms | 19 ms | 20.8 ms |
| Canonical line drawing CPU time | 240 | below timer resolution | 0.1 ms | 0.7 ms |
| Local drawer-to-guesser WebSocket delivery | 50 | 0.249 ms | 0.546 ms | 0.799 ms |
| Local guess-message acknowledgement | 8 | 1.053 ms | 1.155 ms | 1.155 ms |

The browser benchmark uses the production input, canonical drawing and frame
presenter at 1600×900 protocol resolution, displayed at mobile width. Upload
timing does not measure physical display scanout. Transport measurements use
event listeners, avoiding the test helper's 25ms polling delay; guesses are
spaced to respect existing anti-spam rules. These loopback figures exclude
internet latency and do not establish performance on an Android device.

Follow-up validation: 249 Node tests, 248 passed, one optional external database
test skipped; Go race tests passed. On-page Send was checked in drawer and
guesser roles and both themes, including 320×300 and 390×350 visible viewports:
one received message per tap, cleared draft, retained input focus, no horizontal
overflow and input fully visible. With the toolbar hidden, the 390×350 guesser
canvas grew from 98px to 146px high at its original 16:9 aspect ratio. The room
menu and theme action were verified after blur. Native Gboard composition is
covered by the regression test but still requires a real-device confirmation.

The mobile drawing label uses 13px readable type, and reactions use 18px icons
inside 46×44px buttons. Their dimensions remain the same before and after
input focus; the canvas heading is consistently 44px. At 390×420 keyboard
space the full canvas occupies 372×209px and the input ends at 411px.
