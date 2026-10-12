// Browser audio preferences are independent of the native game event protocol.
const DEFAULT_VOLUME = 0.4;
const VOLUME_KEY = "skribbil.sound.volume";
const browserContext = () => {
    const Context = globalThis.AudioContext || globalThis.webkitAudioContext;
    return Context ? new Context() : null;
};
export function createGameAudio({ storage, createAudio = file => new Audio(file), createContext = browserContext,
    fetchAudio = file => fetch(file) } = {}) {
    const read = key => { try { return storage?.getItem(key); } catch { return null; } };
    const write = (key, value) => { try { storage?.setItem(key, String(value)); } catch { /* Private browsing may deny persistence. */ } };
    const storedVolume = read(VOLUME_KEY);
    let volume = storedVolume !== null && storedVolume !== undefined && storedVolume.trim() !== "" && Number.isFinite(Number(storedVolume))
        ? Math.max(0, Math.min(1, Number(storedVolume))) : DEFAULT_VOLUME;
    let enabled = read("sound") !== "false";
    let context, generation = 0;
    const active = new Set(), buffers = new Map(), coalesced = new Set();
    const getContext = () => {
        if (context === undefined) {
            try { context = createContext(); } catch { context = null; }
        }
        return context;
    };
    const release = item => {
        if (!active.delete(item)) return;
        if (item.coalesceKey) coalesced.delete(item.coalesceKey);
        if (item.source) {
            item.source.onended = null;
            item.source.disconnect();
            item.node.disconnect();
        }
    };
    const refresh = () => {
        for (const item of active) {
            if (item.node) item.node.gain.value = volume * item.gain;
            else item.audio.volume = volume * item.gain;
            if (!enabled || volume === 0) {
                if (item.source) { try { item.source.stop(); } catch { /* Already ended. */ } }
                else item.audio.pause();
                release(item);
            }
        }
    };
    const decode = (ctx, file) => {
        if (!buffers.has(file)) {
            buffers.set(file, Promise.resolve().then(() => fetchAudio(file)).then(response => {
                if (!response.ok) throw Error("Sound resource unavailable");
                return response.arrayBuffer();
            }).then(bytes => ctx.decodeAudioData(bytes)).catch(error => {
                buffers.delete(file); throw error;
            }));
        }
        return buffers.get(file);
    };
    const playWebAudio = async (ctx, file, gain, startedGeneration, coalesceKey) => {
        // Suspended audio is not queued: a later gesture must not replay old
        // guesses in a burst. The shared context is unlocked by input handlers.
        let item;
        try {
            const buffer = await decode(ctx, file);
            if (!enabled || volume === 0 || generation !== startedGeneration || ctx.state !== "running") return;
            const source = ctx.createBufferSource(), node = ctx.createGain();
            item = { source, node, gain, coalesceKey };
            active.add(item);
            source.buffer = buffer;
            node.gain.value = volume * gain;
            source.connect(node); node.connect(ctx.destination);
            source.onended = () => release(item);
            try { source.start(); } catch { release(item); }
        } catch { if (item) release(item); /* Missing sounds never interrupt play. */ }
        finally { if (!item || !active.has(item)) coalesced.delete(coalesceKey); }
    };
    const playMedia = (file, gain, coalesceKey) => {
        let audio;
        try { audio = createAudio(file); } catch { coalesced.delete(coalesceKey); return; }
        const item = { audio, gain, coalesceKey };
        audio.type = "audio/wav"; audio.volume = volume * gain;
        active.add(item);
        const done = () => release(item);
        audio.addEventListener?.("ended", done, { once: true });
        audio.addEventListener?.("error", done, { once: true });
        try { Promise.resolve(audio.play()).catch(done); } catch { done(); }
    };
    return {
        get enabled() { return enabled; },
        get volume() { return volume; },
        // Call synchronously from a trusted pointer/keyboard event. One context
        // and decoded buffer cache serve every effect, including on iOS Safari.
        unlock() {
            const ctx = getContext();
            if (!ctx || ctx.state === "running" || ctx.state === "closed") return Promise.resolve();
            try { return Promise.resolve(ctx.resume()).catch(() => {}); } catch { return Promise.resolve(); }
        },
        setEnabled(value) { enabled = Boolean(value); if (!enabled) generation++; write("sound", enabled); refresh(); },
        setVolume(value) {
            const next = Number(value);
            if (!Number.isFinite(next)) return;
            volume = Math.max(0, Math.min(1, next)); if (volume === 0) generation++;
            write(VOLUME_KEY, volume); refresh();
        },
        play(file, gain = 1, { coalesce = false } = {}) {
            if (!enabled || volume === 0) return;
            gain = Number.isFinite(gain) ? Math.max(0, Math.min(1, gain)) : 1;
            const ctx = getContext();
            if (ctx && ctx.state !== "running") return;
            if (coalesce && coalesced.has(file)) return;
            const coalesceKey = coalesce ? file : null;
            if (coalesceKey) coalesced.add(coalesceKey);
            if (ctx) return playWebAudio(ctx, file, gain, generation, coalesceKey);
            playMedia(file, gain, coalesceKey);
        },
    };
}
