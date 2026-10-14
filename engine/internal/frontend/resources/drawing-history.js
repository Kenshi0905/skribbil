// Cache at most four canvas images; older undo operations fall back to replay.
// Server-provided ranges remain authoritative, including stroke boundaries.
export function createDrawingHistory({ snapshot, restore, clear, draw, present, now = () => performance.now(), maxSnapshots = 4 }) {
    let events = [], checkpoints = [], lastAt = -Infinity;
    function checkpoint(index, event, at) {
        if (!index || checkpoints.some(item => item.index === index)) return;
        if (event.type === 'fill' || events[index - 1]?.type === 'fill' || at - lastAt > 150 || index % 128 === 0) {
            checkpoints.push({ index, pixels: snapshot() });
            if (checkpoints.length > maxSnapshots) checkpoints.shift();
        }
    }
    function reset() {
        events = []; checkpoints = []; lastAt = -Infinity;
        clear();
    }
    function append(event, skipUnchanged = false, paint = true) {
        const at = now();
        checkpoint(events.length, event, at);
        const changed = draw(event) !== false;
        if (skipUnchanged && !changed) return false;
        events.push(event);
        lastAt = at;
        if (paint && changed) present(event);
        return changed;
    }
    function replace(drawing) {
        reset();
        for (const event of drawing) append(event, false, false);
        present();
    }
    function undo({ from, to }) {
        if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to <= from || to > events.length) return false;
        // Keep locally drawn events queued after the undo request. They arrive
        // at the server after this removed range and must remain on the canvas.
        events.splice(from, to - from);
        checkpoints = checkpoints.filter(item => item.index <= from);
        const saved = checkpoints.at(-1);
        if (saved) restore(saved.pixels);
        else clear();
        lastAt = -Infinity;
        for (let index = saved?.index || 0; index < events.length; index++) {
            const at = now();
            checkpoint(index, events[index], at);
            draw(events[index]);
            lastAt = at;
        }
        present();
        return true;
    }
    return { append, replace, reset, undo };
}
