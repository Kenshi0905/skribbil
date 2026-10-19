# Local round transition review

Reviewed locally and approved for production on 19 October 2026. The final
reviewed version advances automatically and has no Continue button.

The server's previous word now receives a 1.6-second reveal inside the canvas
frame. It fades into the existing word-choice or waiting panel, which remains
until the server reports a word selection. The reveal advances automatically;
a fast server selection cancels it immediately. No server event, timer, score,
private answer, drawing coordinate or voting rule is changed. No intermediate
player standings are added.

The previous answer remains in a compact panel summary and the round header
while choosing. The finished artwork is retained behind that panel. The final
game-over event uses the same reveal before the existing final results. Empty
previous words never produce a fabricated answer. Reduced-motion preferences
skip the animations. Custom words are rendered as text.

The preselected fallback-word line is hidden. Automatic fallback selection
continues to use the server's existing choice and deadline. Small typing views
compact repeated answer text and generic choice instructions while retaining
penalty explanations and every choice.

Local validation:

- 253 Node tests: 252 passed, one optional database test skipped.
- Go race suite, syntax checks, secret guard and whitespace checks passed.
- Real local drawer/guesser turns verified on desktop and narrow mobile sizes.
- At 320×350 with input focused, the complete 16:9 canvas measured 260×146;
  the input ended at 341px and there was no horizontal overflow.
- Both themes checked. The draft remained focused and unchanged through the
  answer and waiting phases, then the on-page Send button delivered it once.
- Word-choice activation reached the server-selected private word and removed
  the previous answer. All three choices fit the compact panel.
- Browser console showed no runtime errors.

Keyboard space is simulated using a short browser viewport. Physical Android
Gboard and iOS keyboard behavior still need device verification.
