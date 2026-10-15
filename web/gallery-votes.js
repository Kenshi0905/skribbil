// Separate authenticated gallery votes. Stable bar; optional, scrollable history.
export function createGalleryVoting(
  root,
  {
    roomCode,
    fetcher = fetch,
    document: doc = document,
    hidden = () => document.hidden,
  } = {},
) {
  let stopped = false,
    loading = false,
    pending = false,
    fingerprint = "",
    timer,
    failures = 0;
  const followups = new Set();
  const compact = doc.createElement("div");
  compact.className = "gallery-current";
  const history = doc.createElement("details");
  history.className = "gallery-history";
  const summary = doc.createElement("summary");
  summary.textContent = "History";
  const list = doc.createElement("div");
  list.className = "gallery-history-content";
  const heading = doc.createElement("div");
  heading.className = "gallery-history-heading";
  const title = doc.createElement("strong");
  title.textContent = "Drawing votes";
  const dismiss = doc.createElement("button");
  dismiss.type = "button";
  dismiss.textContent = "Close";
  dismiss.className = "gallery-close";
  dismiss.setAttribute("aria-label", "Close drawing votes");
  const dismissHistory = () => {
    history.open = false;
    const opener = doc.querySelector?.(".mobile-gallery-link");
    (opener?.getClientRects().length ? opener : summary).focus?.();
  };
  dismiss.addEventListener("click", dismissHistory);
  heading.append(title, dismiss);
  const note = doc.createElement("small");
  note.textContent =
    "Shame is playful art feedback, never personal. Publication needs artist consent and admin approval.";
  const message = doc.createElement("p");
  message.setAttribute("role", "status");
  message.className = "gallery-vote-status";
  list.append(heading, message);
  history.append(summary, list, note);
  root.append(compact, history);
  root.hidden = false;
  const close = (event) => {
    if (event.key === "Escape" && history.open) dismissHistory();
  };
  summary.addEventListener("click", () => {
    if (failures) refresh();
  });
  doc.addEventListener?.("keydown", close);
  async function request(path, options = {}) {
    const response = await fetcher(path, {
      credentials: "same-origin",
      ...options,
      signal: AbortSignal.timeout(10000),
    });
    const body = await response.json();
    if (!response.ok)
      throw new Error(body.error || "Voting is temporarily unavailable.");
    return body;
  }
  function voteRow(turn, small = false) {
    const row = doc.createElement("section");
    row.className = small
      ? "gallery-turn-vote gallery-vote-inline"
      : "gallery-turn-vote";
    const title = doc.createElement("strong");
    title.textContent = `${turn.artist} · ${turn.prompt}`;
    title.title = title.textContent;
    row.append(title);
    for (const [choice, label] of [
      ["fame", "👍 Fame"],
      ["shame", "👎 Shame"],
    ]) {
      const button = doc.createElement("button");
      button.type = "button";
      button.textContent = `${label} ${turn[choice]}`;
      button.setAttribute(
        "aria-label",
        `${label} for ${turn.artist}’s ${turn.prompt}: ${turn[choice]} votes`,
      );
      button.setAttribute("aria-pressed", String(turn.choice === choice));
      button.disabled =
        pending || !turn.open || !turn.eligible || Boolean(turn.choice);
      button.title = !turn.open
        ? "Voting closed"
        : turn.choice
          ? "Your vote is saved"
          : !turn.eligible
            ? "Only eligible players can vote; no self-votes"
            : "One gallery vote per drawing";
      button.addEventListener("click", async () => {
        if (pending || button.disabled) return;
        pending = true;
        for (const b of root.querySelectorAll("button[aria-pressed]"))
          b.disabled = true;
        try {
          await request(
            `/api/turns/${encodeURIComponent(turn.turnId)}/gallery-vote`,
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "X-Requested-With": "Skribbil",
              },
              body: JSON.stringify({ choice }),
            },
          );
          message.className = "gallery-vote-status";
          message.textContent = "Vote recorded.";
        } catch (error) {
          message.className = "gallery-vote-status is-error";
          message.textContent = error.message;
          history.open = true;
        } finally {
          pending = false;
          fingerprint = "";
          await refresh();
        }
      });
      row.append(button);
    }
    if (!small) {
      const result = doc.createElement("small");
      result.textContent = `${turn.open ? "Open" : "Closed"} · ${turn.decision === "no-decision" ? "No decision" : `${turn.decision === "fame" ? "Fame" : "Shame"} candidate${turn.open ? " (provisional)" : ""}`} · ${turn.minimum} voters minimum, ${turn.percent}% majority`;
      row.append(result);
    }
    return row;
  }
  function render(turns) {
    const key = JSON.stringify(turns);
    if (fingerprint === key) return;
    fingerprint = key;
    compact.replaceChildren();
    list.replaceChildren(heading, message);
    root.setAttribute(
      "data-pending",
      String(
        turns.filter((turn) => turn.open && turn.eligible && !turn.choice)
          .length,
      ),
    );
    const current =
      turns.find((turn) => turn.open && turn.eligible && !turn.choice) ||
      turns.find((turn) => turn.open);
    if (current) compact.append(voteRow(current, true));
    else {
      const idle = doc.createElement("span");
      idle.textContent = turns.length ? "Gallery votes saved" : "Gallery votes";
      compact.append(idle);
    }
    for (const turn of turns) list.append(voteRow(turn));
    summary.textContent = turns.length ? `History · ${turns.length}` : "About";
  }
  async function refresh() {
    if (stopped || loading || pending || hidden()) return;
    loading = true;
    clearTimeout(timer);
    try {
      const data = await request(
        `/api/rooms/${encodeURIComponent(roomCode)}/gallery-votes`,
      );
      if (failures) {
        message.className = "gallery-vote-status";
        message.textContent = "Voting reconnected.";
      }
      failures = 0;
      if (!stopped) {
        render(data.turns);
        summary.textContent = data.turns.length
          ? `History · ${data.turns.length}`
          : "About";
      }
    } catch (error) {
      failures++;
      if (!stopped) {
        message.className = "gallery-vote-status is-error";
        message.textContent = error.message;
        summary.textContent = "Retry votes";
      }
    } finally {
      loading = false;
      if (!stopped)
        timer = setTimeout(
          refresh,
          Math.min(60000, 15000 * 2 ** Math.min(2, failures)),
        );
    }
  }
  function onTurn() {
    for (const timeout of followups) clearTimeout(timeout);
    followups.clear();
    refresh();
    // Archive delivery can finish shortly after the native turn notification.
    for (const delay of [900, 3000]) {
      const timeout = setTimeout(() => {
        followups.delete(timeout);
        refresh();
      }, delay);
      followups.add(timeout);
    }
  }
  render([]);
  refresh();
  return {
    refresh,
    onTurn,
    dispose() {
      stopped = true;
      clearTimeout(timer);
      for (const timeout of followups) clearTimeout(timeout);
      followups.clear();
      doc.removeEventListener?.("keydown", close);
    },
  };
}
