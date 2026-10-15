// Input coordinates remain CSS pixels. The original lobby renderer performs
// its existing conversion to the 1600 x 900 protocol canvas and draws every
// line/fill. One pointer path prevents synthetic touch clicks drawing twice.
export function attachCanvasInput(canvas, { state, line, fill }) {
    let active = null;
    let geometry = null, geometryFrame = 0;
    const view = canvas.ownerDocument?.defaultView;
    const invalidate = () => { if (geometryFrame) view?.cancelAnimationFrame?.(geometryFrame); geometry = null; geometryFrame = 0; };
    const position = (event) => {
        const rect = geometry || canvas.getBoundingClientRect();
        if (view?.requestAnimationFrame && !geometryFrame) {
            geometry = rect;
            geometryFrame = view.requestAnimationFrame(invalidate);
        }
        return {
            x: Math.max(0, Math.min(Math.max(0, rect.width - 1), event.clientX - rect.left)),
            y: Math.max(0, Math.min(Math.max(0, rect.height - 1), event.clientY - rect.top)),
        };
    };
    const width = (event, current) => {
        if (event.pointerType !== "pen" || !current.pressure || !event.pressure) return current.width;
        return Math.max(1, Math.min(32, Math.ceil(event.pressure * 32)));
    };
    const stop = (event) => {
        if (!active || (event?.pointerId !== undefined && event.pointerId !== active.id)) return;
        const id = active.id;
        active = null;
        if (canvas.hasPointerCapture?.(id)) canvas.releasePointerCapture(id);
    };
    const down = (event) => {
        const current = state();
        if (!current.enabled || active || event.isPrimary === false || (event.pointerType !== "touch" && event.button !== 0)) return;
        event.preventDefault();
        invalidate();
        const point = position(event);
        active = { id: event.pointerId, point, tool: current.tool };
        canvas.setPointerCapture?.(event.pointerId);
        if (current.tool === "fill") fill(point.x, point.y);
        else line(point.x, point.y, point.x, point.y, width(event, current));
    };
    const move = (event) => {
        if (!active || active.id !== event.pointerId) return;
        const current = state();
        if (!current.enabled || current.tool !== active.tool || (event.pointerType !== "touch" && event.buttons === 0)) { stop(event); return; }
        event.preventDefault();
        if (current.tool === "fill") return;
        // Pen coalescing preserves the device's samples without changing the
        // server's line protocol. Touch and mouse use the same coordinates.
        const samples = event.getCoalescedEvents?.();
        for (const sample of samples?.length ? samples : [event]) {
            const point = position(sample);
            if (point.x !== active.point.x || point.y !== active.point.y) {
                line(active.point.x, active.point.y, point.x, point.y, width(sample, current));
                active.point = point;
            }
        }
    };
    const listeners = { pointerdown: down, pointermove: move, pointerup: stop, pointercancel: stop, lostpointercapture: stop };
    for (const [name, listener] of Object.entries(listeners)) canvas.addEventListener(name, listener, { passive: false });
    view?.addEventListener("blur", stop);
    view?.addEventListener("resize", invalidate);
    view?.addEventListener("scroll", invalidate, true);
    view?.visualViewport?.addEventListener("resize", invalidate);
    view?.visualViewport?.addEventListener("scroll", invalidate);
    return () => {
        stop();
        for (const [name, listener] of Object.entries(listeners)) canvas.removeEventListener(name, listener);
        view?.removeEventListener("blur", stop);
        view?.removeEventListener("resize", invalidate);
        view?.removeEventListener("scroll", invalidate, true);
        view?.visualViewport?.removeEventListener("resize", invalidate);
        view?.visualViewport?.removeEventListener("scroll", invalidate);
        if (geometryFrame) view?.cancelAnimationFrame?.(geometryFrame);
    };
}
