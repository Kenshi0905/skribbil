# Screenshots and demonstration media

## Redesigned game UI — 19 October 2026

The following JPEGs were captured from the current local application at source
revision `f2e4c9d`, using two disposable accounts in an isolated in-memory
database and the real Node gateway/Go engine. They show the running frontend,
existing SVG avatar renderer, and actual player connections. No generated
screenshots, reference-image assets, production accounts, or private credentials
are included.

The documentation fixture draws a sample house through the normal game protocol;
the drawer screenshots also include real canvas pointer drags. The house is
demonstration artwork rather than an answer guide for the private word. Counts,
messages, words, and player states come from that local session. Screenshots
exclude browser chrome and launch URLs; images are JPEG browser captures.

| File | Image size (px) | What it shows |
| --- | --- | --- |
| [game-guesser-light.jpg](game-guesser-light.jpg) | 1280 × 720 | Blue doodle background, masked hint, reactions, players, chat, and Gallery votes. |
| [game-guesser-dark.jpg](game-guesser-dark.jpg) | 1280 × 720 | The same guesser layout with charcoal surfaces and a white canvas. |
| [game-drawer-light.jpg](game-drawer-light.jpg) | 1265 × 712 | Private word, pencil/fill/eraser, original palette, brush sizes, undo/clear, and shortcuts. |
| [game-drawer-dark.jpg](game-drawer-dark.jpg) | 1265 × 712 | The drawer layout in dark mode. |
| [game-mobile-drawer.jpg](game-mobile-drawer.jpg) | 390 × 844 | Compact header with Back, the full canvas, and an inline palette below the tools. |
| [game-mobile-guesser.jpg](game-mobile-guesser.jpg) | 390 × 844 | Compact reactions, real test chat, and Chat/Players/Gallery votes beneath the canvas. |
| [game-mobile-typing.jpg](game-mobile-typing.jpg) | 390 × 420 | Focused guess input with the full artwork, round/time/hint, compact tabs, and visible Send. |
| [waiting-room-light.jpg](waiting-room-light.jpg) | 1264 × 834 | Full-page waiting room: invite, settings, counts, host-only Start eligibility, and room-look preview. |
| [waiting-room-dark.jpg](waiting-room-dark.jpg) | 1264 × 834 | The complete waiting room in dark mode. |
| [lobby-settings.jpg](lobby-settings.jpg) | 1265 × 712 | All current numeric settings, visibility control, and dialog actions. |
| [room-look-editor.jpg](room-look-editor.jpg) | 1280 × 720 | Live avatar preview, room name, presets, grouped options, Apply, and Cancel; contents scroll internally. |

The 390 × 420 view reserves keyboard space by reducing the browser viewport and
focusing the real input. It contains no fake keyboard/status bar and is **not a
physical-phone screenshot**. It does not prove Android Gboard, iOS keyboard,
stylus, or real-device rendering performance. The mobile typing capture contains
an unsent draft; another test message was sent through the on-page button and
appears in the full-height mobile view.

[Mobile interaction checks and latency scope](../mobile-interaction-fixes-2026-10-19.md)
· [Rematch/result-saving verification](../rematch-waiting-room-2026-10-19.md).

## Community home — 15 October 2026

`clean-community-light.jpg`, `clean-community-dark.jpg`, and
`clean-community-phone.jpg` are resized/compressed screenshots from local UI
verification fixtures, retained because they show the community-home design.
They use disposable accounts, an accepted friendship, and an open room. Desktop
captures include a real locally completed game and saved XP/quest/result data;
the phone capture uses a fresh fixture. The deliberately long display name and
geometric uploaded avatar exercise wrapping, truncation, and photo upload.
See [the UI verification record](../ui-revamp-verification.md).

## Earlier gameplay demonstration — 12 October 2026

These older files document the original engine integration. Their game chrome
**predates the redesigned UI**. The current README leads with the 19 October
screenshots; earlier media remain available for historical context.

| File | What it shows |
| --- | --- |
| [commons-desktop.jpg](commons-desktop.jpg) | Earlier desktop commons and genuine empty states. |
| [commons-phone.jpg](commons-phone.jpg) | Earlier commons in a narrow viewport. |
| [clubhouse.jpg](clubhouse.jpg) | A synthetic invite-only group, private rooms, and owner/member controls. |
| [gameplay-desktop.jpg](gameplay-desktop.jpg) | Earlier Go-powered client with synchronized drawing, roster, chat, and dislikes. |
| [gameplay-phone.jpg](gameplay-phone.jpg) | Earlier narrow game layout. |
| [gameplay.gif](gameplay.gif) | Edited animation assembled from automated local gameplay captures. |
| [gameplay.mp4](gameplay.mp4) | A silent video of that edited demonstration. |

The animation/video are selected sequences, not an unedited screen recording.
All demonstration accounts are synthetic; these files show neither human matches
nor a production service. Browser viewport tests and automated pointer/protocol
tests supplement, rather than replace, physical-device checks. See
[feature status](../feature-status.md) and [verification](../verification.md) for
testing scope and reliability limits.
