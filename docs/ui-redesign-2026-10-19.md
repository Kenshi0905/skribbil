# Communities UI redesign — 19 October 2026

## Scope and reference mapping

Pulled `origin/main` with a fast-forward-only pull before editing; the checkout
was already current. The existing untracked `web/assets/discord-server-icon.png`
was left untouched. Implementation and visual review used local test accounts;
no account migration or production test data was created. After local review,
the owner authorized pushing and deploying through the existing GitHub Actions
workflow, which verifies the revision before releasing Render and Pages.

The nine supplied references guide presentation, not rules or sample data:

| Reference | State |
| --- | --- |
| 09.58.10 | Room-only avatar editor |
| 09.50.58 | Host lobby settings |
| 09.50.04 | Waiting room |
| 09.49.27 | Light mobile guesser and frame reactions |
| 09.42.01 (1) | Dark mobile drawer |
| 09.42.01 (2) | Light desktop drawer |
| 09.42.01 (3) | Light mobile drawer |
| 09.42.01 (4) | Focused guess field / keyboard-sized viewport |
| 09.42.01 | Dark desktop drawer |

## Implementation

- Shared theme tokens, locally served Baloo 2 cartoon headings, readable body
  type, consistent controls, borders, panels, and focus indicators. The font's
  SIL Open Font License is included. Original branding and avatar art remain.
- Blue doodle background outside the white canvas; coordinated charcoal
  surfaces in dark mode. Canvas pixels and palette colors are not themed.
- Desktop players/canvas/chat arrangement, top-right profile, leaderboard and
  full game-menu access, and drawing controls below the board.
- Green/red icon-and-count reactions occupy a frame header above the artwork.
  Existing server-confirmed counts, eligibility, spent round dislike rules,
  disabled states and labels remain. Drawer and spectator restrictions remain.
- Responsive Chat/Players tabs, full palette and brush popovers, safe-area
  spacing, and visual-viewport sizing. A focused short viewport keeps the social
  tabs below the canvas with a 4px gap above the input; secondary history compacts
  while the input and Send remain at the bottom of the visible viewport.
- Waiting-room settings summary, invitation action, authoritative ready/player
  counts, host/guest start controls and room-look summary.
- All seven settings fields remain connected to their original inputs and save
  behavior. Bounded steppers reuse native number-input validation and limits.
- Room-only editor has Face/Hair/Colors/Extras tabs, all original options,
  original-renderer thumbnails, live preview, room name, presets, Surprise me,
  profile restore, Apply and Cancel. Draft changes do not mutate the roster or
  permanent profile. Dialog actions stay outside its internal scrolling body.
- Shared original avatars also appear in chat, profile, players and results.
  Existing uploaded-photo validation, cropping and fallback paths are retained.
- Fixed stale imported-module caching: entry-point cache keys now include
  resource checksums, with regression coverage. No gameplay-loop, scoring,
  word-selection, authentication, permission or transport rules were rewritten.

## Verification

- Baseline: 237 JavaScript tests, 236 passed, one optional external PostgreSQL
  integration skipped. Sandbox restrictions initially blocked local HTTP/Git
  fixtures; the suite passed with its required local permissions.
- Final: **240 JavaScript tests, 239 passed, one optional integration skipped,
  zero failures**. New coverage includes every editor catalog and thumbnail
  choice, cancellation boundaries, canvas-header sizing and the separate keyboard
  control row. Existing authentication, permission, avatar/photo, gallery,
  drawing, word choice, moderation, score, retention and rematch tests pass.
- **Go race suite passed across all packages**, including the new resource-cache
  regression. Native engine build passed. The preinstalled MinGW compiler could
  not start; the already available w64devkit compiler completed the race run.
- Eight infrastructure tests passed. JavaScript syntax checks, secret guard,
  and whitespace checks passed. Production dependency audit: **0 vulnerabilities**.
- Existing ten-player protocol playtest passed with ten players, one spectator,
  three mobile User-Agent clients, 20 turns, 180 correct guesses, 20 archived
  drawings and ten authoritative results. It covered room-only identity and
  permanent-profile isolation, readiness/start permission, borrowed-cookie
  denial, re-entry, rename/reconnect, spectator exclusion, dislike penalty and
  next hard word, independent gallery votes, rematches and replay expiry.
- Isolated browser clients exercised settings bounds/save, room-editor tabs,
  Cancel and Apply, readiness/start, masked guesser vs private drawer word,
  drawing transmission, palette/brush choices, eraser/fill/undo/clear, chat,
  confirmed like disabling, full game menu, theme/profile access, correct guesses,
  turn handoff, results, and rematch navigation. Spectator input and Send remained
  disabled; drawing tools and reactions stayed hidden. No application console
  errors were collected.
- Rendered screenshots were inspected in light/dark at desktop, tablet and
  narrow mobile sizes, including 320, 390, 768, 1024 and 1440px widths. Measured
  layouts had no horizontal page overflow. The backing canvas remains 1600×900.

### Focused short-viewport measurements

These are browser viewport resizes with the guess input focused, not a physical
software keyboard. The complete artwork is proportionally scaled.

| Visible viewport | Canvas CSS size | Input bottom |
| --- | --- | --- |
| 390×430 | 316×178 | 422px |
| 390×400 | 263×148 | 392px |
| 390×320 | 121×68 | 312px |
| 390×844 restored | 372×209 | 836px |

The existing unit tests also cover visualViewport resize/pan, pinch zoom,
observers, fallback sizing and disposal. Room-editor actions were measured
inside a 320×568 viewport with internal scrolling and no horizontal overflow.

Screenshots are saved locally in `.tmp/redesign-screenshots/`. They contain
synthetic, disposable local accounts and actual local game events, not shipped
fallback players, counts or messages.

## Reference refinements

The game header now uses outlined invite and gold trophy icons, separators,
and a visible moon/sun theme button beside the profile. The original game menu
is in the desktop round bar and mobile header. Gallery votes sits above the
desktop chat input and in the mobile tab row with a purple picture icon.
Chat and Players use underlined mobile tabs in a connected chat panel.

The toolbar uses original outline icons, labeled brush sizes, a selected-size
ring, Undo/Clear labels and hints derived from the actual keyboard bindings.
Pencil, Fill and Eraser each occupy 78px with 3px gaps. All 26 existing colors
and brush widths remain unchanged; the selected color also exposes its state
to assistive technology. Native standalone engine icons remain unchanged.

After these refinements: 239 Node tests passed (one optional integration
skipped), frontend Go tests passed, and syntax, secret and whitespace checks
passed. Browser checks covered tool/size selection, both themes, menu access,
mobile tabs and gallery access. The keyboard layout now keeps the social tabs
in a separate row below the canvas and only 4px above the guess field. Its
collapsed chat history leaves no empty grid track. Seven viewport tests and
frontend Go tests passed after this adjustment. The house was redrawn using
the actual drawing tools and checked in both themes; focused 390×320 through
390×430 views kept all artwork visible without horizontal overflow. Selecting
Players after restoring the tall viewport still shows the authoritative roster.
The original 1600×900 backing canvas is unchanged.

The visible theme toggle was also checked at 320px, 390px and 768px widths;
the header remained within the viewport. Mobile palette and brush popovers
retained all 26 colors and all four sizes and closed after selection.

## Remaining checks

Physical Android/iPhone keyboard behavior, Safari/WebKit viewport quirks,
hardware stylus behavior and device performance still need real-device checks.
The optional external PostgreSQL integration was not configured. No production
load test was performed. Live publication follows the existing release workflow
after the owner's approval. Docker/container verification is left to that
workflow; the Docker client is installed, but its Linux
engine is not running (the engine pipe was absent).
