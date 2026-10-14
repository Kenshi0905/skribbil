// The visual viewport shrinks for the software keyboard on iOS as well as
// Android. Keep the entire game in that visible rectangle, including when
// Safari pans the layout viewport to reveal the focused guess input.
export function attachMobileViewport(view = window, doc = document) {
    const root = doc.documentElement;
    const mobile = view.matchMedia('(max-width: 900px)');
    const panel = doc.getElementById('room-look-panel');
    let frame = 0;
    const update = () => {
        frame = 0;
        const active = mobile.matches && (!panel || panel.hidden);
        root.classList.toggle('mobile-game', active);
        const viewport = view.visualViewport;
        // Let browser pinch zoom work normally; zoom is not a keyboard resize.
        if (active && (!viewport || viewport.scale === 1)) {
            const height = viewport?.height ?? view.innerHeight;
            root.classList.toggle('mobile-game-short', height < 500);
            root.style.setProperty('--game-height', `${height}px`);
            root.style.setProperty('--game-top', `${viewport?.offsetTop ?? 0}px`);
            const chromeHeight = ['league-toolbar', 'lobby-header', 'toolbox', 'message-form']
                .reduce((sum, id) => sum + (doc.getElementById(id)?.getBoundingClientRect().height ?? 0), 0);
            const padding = view.getComputedStyle(doc.getElementById('app'));
            const safeArea = (parseFloat(padding.paddingTop) || 0) + (parseFloat(padding.paddingBottom) || 0);
            // Leave room for the full-width guess field and a little chat even
            // on short screens. Shrink the board uniformly, never crop pixels.
            root.style.setProperty('--game-board-limit', `${Math.max(0, height - chromeHeight - safeArea - 68)}px`);
            root.style.setProperty('--game-content-height', `${Math.max(0, height - chromeHeight - safeArea - 20)}px`);
        } else if (!active) {
            root.classList.remove('mobile-game-short');
            root.style.removeProperty('--game-height');
            root.style.removeProperty('--game-top');
            root.style.removeProperty('--game-board-limit');
            root.style.removeProperty('--game-content-height');
        }
    };
    const schedule = () => {
        if (!frame) frame = view.requestAnimationFrame(update);
    };
    view.addEventListener('resize', schedule);
    view.visualViewport?.addEventListener('resize', schedule);
    view.visualViewport?.addEventListener('scroll', schedule);
    mobile.addEventListener('change', schedule);
    const observer = panel ? new view.MutationObserver(schedule) : null;
    observer?.observe(panel, { attributes: true, attributeFilter: ['hidden'] });
    const sizes = new view.ResizeObserver(schedule);
    for (const id of ['league-toolbar', 'lobby-header', 'toolbox', 'message-form']) {
        const element = doc.getElementById(id);
        if (element) sizes.observe(element);
    }
    update();
    return () => {
        view.cancelAnimationFrame(frame);
        view.removeEventListener('resize', schedule);
        view.visualViewport?.removeEventListener('resize', schedule);
        view.visualViewport?.removeEventListener('scroll', schedule);
        mobile.removeEventListener('change', schedule);
        observer?.disconnect();
        sizes.disconnect();
        root.classList.remove('mobile-game');
        root.classList.remove('mobile-game-short');
        root.style.removeProperty('--game-height');
        root.style.removeProperty('--game-top');
        root.style.removeProperty('--game-board-limit');
        root.style.removeProperty('--game-content-height');
    };
}
