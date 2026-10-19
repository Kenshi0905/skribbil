// A presentation-only handoff. Server events and choice timers never wait for it.
export function createRoundTransition({ board, wrapper, panels, body,
    view = window, duration = 1600 }) {
    const doc = wrapper.ownerDocument;
    const overlay = doc.createElement('section');
    overlay.className = 'round-transition';
    overlay.hidden = true;
    const content = doc.createElement('div');
    content.className = 'round-transition-content';
    const label = doc.createElement('span');
    label.className = 'round-transition-label';
    label.textContent = 'The word was';
    const answer = doc.createElement('strong');
    answer.className = 'round-transition-word';
    const reason = doc.createElement('p');
    reason.className = 'round-transition-reason';
    content.append(label, answer, reason);
    overlay.append(content);
    wrapper.append(overlay);
    // One live announcement; repeated summaries inside hidden dialogs are quiet.
    const announcement = doc.createElement('span');
    announcement.className = 'round-transition-announcement';
    announcement.setAttribute('role', 'status');
    announcement.setAttribute('aria-live', 'polite');
    wrapper.append(announcement);
    const summaries = panels.map(panel => {
        const summary = doc.createElement('div');
        summary.className = 'round-answer'; summary.hidden = true;
        const title = doc.createElement('span'); title.textContent = 'The word was';
        const word = doc.createElement('strong');
        summary.append(title, word); panel.prepend(summary);
        return { summary, word };
    });
    let timer = null, artwork = null, generation = 0, animations = new Set();
    const reducedMotion = () => view.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const animate = (node, frames, options) => {
        if (reducedMotion() || !node.animate) return;
        const animation = node.animate(frames, options);
        animations.add(animation);
        animation.finished.then(() => animations.delete(animation), () => animations.delete(animation));
        return animation;
    };
    const stop = () => {
        if (timer !== null) view.clearTimeout(timer);
        timer = null;
        for (const animation of animations) animation.cancel();
        animations.clear();
    };
    const finish = () => {
        if (!body.dataset.roundReveal) return;
        stop(); delete body.dataset.roundReveal;
        const current = generation;
        const exit = animate(overlay, [{ opacity: 1 }, { opacity: 0 }], { duration: 180, easing: 'ease-out' });
        if (exit) exit.finished.then(() => { if (current === generation) overlay.hidden = true; }, () => {});
        else overlay.hidden = true;
        for (const panel of panels) {
            if (view.getComputedStyle(panel).visibility === 'visible') {
                animate(panel, [{ opacity: 0, transform: 'translateY(8px)' }, { opacity: 1, transform: 'translateY(0)' }],
                    { duration: 220, easing: 'ease-out' });
            }
        }
    };
    const reset = () => {
        generation++; stop(); overlay.hidden = true;
        artwork?.remove(); artwork = null;
        delete body.dataset.roundReveal; delete body.dataset.roundAnswer;
        for (const { summary, word } of summaries) { summary.hidden = true; word.textContent = ''; }
        announcement.textContent = '';
    };
    return {
        reveal(word, endReason = '') {
            reset();
            // Only the previous word supplied by the server is accepted here.
            if (typeof word !== 'string' || !word.trim()) return;
            answer.textContent = word;
            reason.textContent = endReason === 'drawer_disconnected' ? 'The drawer left the room.'
                : endReason === 'guessers_disconnected' ? 'The guessers left the room.' : 'Nice drawing. On to the next one!';
            for (const item of summaries) { item.word.textContent = word; item.summary.hidden = false; }
            announcement.textContent = `The word was ${word}.`;
            body.dataset.roundAnswer = 'true'; body.dataset.roundReveal = 'true';
            // Preserve the finished artwork until the next word actually starts.
            artwork = doc.createElement('canvas');
            artwork.width = board.width; artwork.height = board.height;
            artwork.className = 'round-finished-artwork'; artwork.setAttribute('aria-hidden', 'true');
            try { artwork.getContext('2d').drawImage(board, 0, 0); wrapper.append(artwork); }
            catch { artwork.remove(); artwork = null; }
            overlay.hidden = false;
            animate(content, [{ opacity: 0, transform: 'translateY(10px) scale(.98)' }, { opacity: 1, transform: 'translateY(0) scale(1)' }],
                { duration: 240, easing: 'ease-out' });
            timer = view.setTimeout(finish, duration);
        },
        begin: reset,
        finish,
    };
}
