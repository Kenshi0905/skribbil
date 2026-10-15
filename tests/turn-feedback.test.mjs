import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const source = readFileSync(
  new URL("../engine/internal/frontend/lobby.js", import.meta.url),
  "utf8",
);
const feedback = source.slice(
  source.indexOf("function showTurnFeedback("),
  source.indexOf("let leagueDislikes ="),
);
function setup() {
  const holders = new Map(
    ["turn-recap", "word-choice-recap"].map((id) => [
      id,
      {
        children: [],
        replaceChildren() {
          this.children = [];
        },
        append(...nodes) {
          this.children.push(...nodes);
        },
      },
    ]),
  );
  const context = vm.createContext({
    document: {
      getElementById: (id) => holders.get(id),
      createElement: (tag) => ({ tag, textContent: "" }),
    },
  });
  vm.runInContext(feedback + ";globalThis.show=showTurnFeedback;", context);
  return { holders, show: context.show };
}

test("turn recaps reveal only the previous word, with bounded real score gains as literal text", () => {
  const f = setup();
  f.show({
    previousWord: "<img onerror=bad>",
    players: [
      { name: "<b>Player</b>", lastScore: 100 },
      { name: "Runner", lastScore: 50 },
      { name: "Penalty", lastScore: -100 },
      { name: "No change", lastScore: 0 },
      { name: "Unknown", lastScore: "nope" },
      { name: "Fourth", lastScore: -200 },
    ],
  });
  for (const holder of f.holders.values()) {
    assert.equal(holder.hidden, false);
    assert.equal(
      holder.children[0].textContent,
      "The word was “<img onerror=bad>”",
    );
    assert.equal(
      holder.children[1].textContent,
      "<b>Player</b>: +100 · Runner: +50 · Penalty: -100",
    );
  }
  f.show({ word: "unrevealed future prompt" });
  for (const holder of f.holders.values()) {
    assert.equal(holder.hidden, true);
    assert.equal(holder.children.length, 0);
  }
});
