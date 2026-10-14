// Use the server's final ranks, including ties and disconnected participants.
export function renderGameResults(container, players, { ownID, createAvatar, random = Math.random } = {}) {
    const document = container.ownerDocument;
    const standings = players.filter(player => player.state !== "spectating")
        .slice().sort((a, b) => Number(b.connected) - Number(a.connected) || a.rank - b.rank || b.score - a.score);
    const finalists = standings.filter(player => player.connected);
    const winners = finalists.filter(player => player.rank === 1);
    const node = (tag, className, text) => {
        const element = document.createElement(tag);
        element.className = className;
        if (text !== undefined) element.textContent = text;
        return element;
    };
    const confetti = node("div", "results-confetti");
    confetti.setAttribute("aria-hidden", "true");
    const colors = ["#ffce54", "#8c70e8", "#ef7f91", "#67c6ba", "#70b9f5"];
    for (let i = 0; i < 48; i++) {
        const piece = node("i", "results-confetti-piece");
        piece.style.setProperty("--x", `${random() * 100}%`);
        piece.style.setProperty("--drift", `${(random() - .5) * 160}px`);
        piece.style.setProperty("--delay", `${random() * 1.4}s`);
        piece.style.setProperty("--duration", `${3 + random() * 2}s`);
        piece.style.backgroundColor = colors[i % colors.length];
        confetti.appendChild(piece);
    }
    const heading = node("div", "results-winner");
    heading.appendChild(node("span", "results-eyebrow", winners.length > 1 ? "SHARED VICTORY" : "THE CANVAS CHAMPION"));
    heading.appendChild(node("h2", "results-winner-name", winners.map(player => player.name).join(" & ") || "Great game!"));
    heading.appendChild(node("p", "results-subtitle", "Good guesses. Questionable drawings. Great company."));

    const podium = node("div", "results-podium");
    podium.setAttribute("aria-label", "Top players");
    finalists.slice(0, 3).forEach((player, index) => {
        const place = node("div", "results-podium-place");
        place.dataset.place = String(index + 1);
        if (player.rank === 1) place.classList.add("results-champion");
        if (player.id === ownID) place.classList.add("results-self");
        if (player.rank === 1) {
            const crown = node("span", "results-crown", "♛");
            crown.setAttribute("aria-hidden", "true");
            place.appendChild(crown);
        }
        place.appendChild(createAvatar(player));
        place.appendChild(node("strong", "results-player-name", player.name));
        place.appendChild(node("span", "results-points", `${player.score} points`));
        place.appendChild(node("div", "results-podium-step", `#${player.rank}`));
        podium.appendChild(place);
    });
    const list = node("ol", "results-standings");
    list.setAttribute("aria-label", "Final standings");
    standings.forEach(player => {
        const row = node("li", "results-row");
        if (player.connected) row.value = player.rank;
        if (player.id === ownID) row.classList.add("results-self");
        row.appendChild(node("span", "results-rank", player.connected ? `#${player.rank}` : "—"));
        row.appendChild(createAvatar(player));
        const name = node("span", "results-row-name", player.name);
        if (player.id === ownID) name.appendChild(node("small", "results-you", "You"));
        if (!player.connected) name.appendChild(node("small", "results-left", "Left the room"));
        row.appendChild(name);
        row.appendChild(node("strong", "results-row-points", `${player.score} points`));
        list.appendChild(row);
    });
    container.replaceChildren(confetti, heading, podium, node("h3", "results-list-title", "Final standings"), list);
    return { winners, selfPlayer: standings.find(player => player.id === ownID) };
}
