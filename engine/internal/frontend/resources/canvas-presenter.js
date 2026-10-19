// Keep all canonical pixels and protocol events; upload their combined dirty
// region once per display frame instead of once per coalesced pointer sample.
export function createCanvasPresenter({paint, requestFrame = callback => requestAnimationFrame(callback), cancelFrame = id => cancelAnimationFrame(id)}) {
    let frame = null, dirty = null, full = false;
    const flush = () => {
        if (frame !== null) cancelFrame(frame);
        frame = null;
        if (!full && !dirty) return;
        const region = full ? null : dirty;
        dirty = null; full = false;
        paint(region);
    };
    const invalidate = region => {
        if (!region) full = true;
        else if (!full) dirty = dirty ? {
            left: Math.min(dirty.left, region.left), top: Math.min(dirty.top, region.top),
            right: Math.max(dirty.right, region.right), bottom: Math.max(dirty.bottom, region.bottom),
        } : {...region};
        if (frame === null) frame = requestFrame(flush);
    };
    return {invalidate, flush};
}
