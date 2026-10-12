# Local demonstration media

These media were captured locally on **12 October 2026** from the running
Skribbil platform and its original Go game engine. They use an isolated automated
test session and synthetic accounts. They do not show real community members,
human gameplay, a hosted production service, or physical-phone testing.

Screenshots were prepared for documentation, including resizing/compression and
selection of useful frames. The GIF and silent MP4 are edited sequences of screen
captures from the automated local demonstration. They are not an unedited screen
recording. Browser address bars, private launch URLs, and credentials are excluded.

| File | What it shows |
| --- | --- |
| [commons-desktop.jpg](commons-desktop.jpg) | The desktop commons: navigation, play card, progress, and room discovery. Clearly labeled example content can appear before real league results exist. |
| [commons-phone.jpg](commons-phone.jpg) | The commons in a narrow browser viewport. |
| [clubhouse.jpg](clubhouse.jpg) | A synthetic invite-only group, its private room list, and owner/member controls. Visible usernames are generated test identities. |
| [gameplay-desktop.jpg](gameplay-desktop.jpg) | The actual Go-powered game client with a synchronized test drawing, roster, chat, and dislike controls. |
| [gameplay-phone.jpg](gameplay-phone.jpg) | The same native game in a narrow browser viewport, with stacked chat and a Send button. |
| [gameplay.gif](gameplay.gif) | An animated preview assembled from local gameplay captures. |
| [gameplay.mp4](gameplay.mp4) | A silent video version of the edited demonstration. |

## What was checked

- Ten real WebSocket player connections and a spectator joined the local game.
  Three player clients sent mobile user-agent strings. These were automated
  protocol clients, not three physical phones.
- Browser viewport inspection covered 360, 390, and 430 CSS-pixel widths. Canvas
  layout, page overflow, and accessible-sized chat/Send controls were checked.
- Automated pointer-event tests exercise drawing input behavior. They supplement
  the viewport checks; neither proves physical touch, stylus, or on-screen-keyboard
  behavior on an actual phone.
- Desktop and narrow-view community screens were inspected for sidebar scrolling,
  navigation, forms, and modal fit.

The screenshots are selected views rather than a complete test report. Testing
scope, reliability limits, and unfinished work are documented in
[feature status](../feature-status.md), with implementation changes in the
[changelog](../../CHANGELOG.md). No deployment or production-readiness claim is
implied by this media.
