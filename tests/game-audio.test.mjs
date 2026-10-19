import test from 'node:test';
import assert from 'node:assert/strict';
import { createGameAudio } from '../engine/internal/frontend/resources/game-audio.js';

test('muted and zero-volume gestures never initialize audio hardware',async()=>{
  for(const saved of [{sound:'false'},{'skribbil.sound.volume':'0'}]) {
    let contexts=0;
    const audio=createGameAudio({storage:{getItem:key=>saved[key]??null},createContext:()=>{contexts++;return {state:'running'};}});
    await audio.unlock();audio.play('pop.wav');assert.equal(contexts,0);
    audio.setEnabled(true);audio.setVolume(.4);await audio.unlock();assert.equal(contexts,1);
    await audio.unlock();assert.equal(contexts,1,'subsequent gestures reuse the context');
  }
});

function fixture(saved = {}) {
  const values = new Map(Object.entries(saved)), played = [];
  const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
  const createAudio = file => {
    const listeners = new Map();
    const audio = { file, volume: 1, pauses: 0, listeners,
      addEventListener: (event, callback) => listeners.set(event, callback),
      play() { this.volumeAtPlay = this.volume; return Promise.resolve(); },
      pause() { this.pauses++; },
    };
    played.push(audio); return audio;
  };
  return { storage, played, values, createAudio, audio: createGameAudio({ storage, createAudio }) };
}

test('game sounds default to 40%; pop dispatch is attenuated to 20% before playback', () => {
  const f = fixture();
  assert.equal(f.played.length, 0, 'loading preferences never starts a sound');
  f.audio.play('pop.wav', 0.5); f.audio.play('your-turn.wav');
  assert.equal(f.played[0].volumeAtPlay, 0.2);
  assert.equal(f.played[1].volumeAtPlay, 0.4);
  assert.deepEqual(f.played.map(a => a.file), ['pop.wav', 'your-turn.wav']);
});

test('volume and the existing mute preference persist across a new controller', () => {
  const f = fixture({ sound: 'false' });
  f.audio.play('pop.wav', 0.5); assert.equal(f.played.length, 0);
  f.audio.setVolume(0.7); f.audio.setEnabled(true); f.audio.play('pop.wav', 0.5);
  assert.equal(f.played[0].volumeAtPlay, 0.35);
  f.audio.setEnabled(false);
  const restored = createGameAudio({ storage: f.storage, createAudio: f.createAudio });
  assert.equal(restored.enabled, false); assert.equal(restored.volume, 0.7);
  restored.play('your-turn.wav'); assert.equal(f.played.length, 1);
});

test('sliding volume updates active effects and mute immediately pauses them', () => {
  const f = fixture(); f.audio.play('pop.wav', 0.5); f.audio.play('end-turn.wav');
  f.audio.setVolume(0.2);
  assert.equal(f.played[0].volume, 0.1); assert.equal(f.played[1].volume, 0.2);
  f.played[0].listeners.get('ended')();
  f.audio.setEnabled(false);
  assert.equal(f.played[0].pauses, 0, 'finished effects are released');
  assert.equal(f.played[1].pauses, 1);
  f.audio.setEnabled(true); assert.equal(f.played.length, 2, 'unmute never replays an old effect');
  f.audio.setVolume(0); f.audio.play('pop.wav', 0.5); assert.equal(f.played.length, 2);
});

test('invalid storage, blocked persistence and autoplay rejection are harmless', async () => {
  for (const stored of ['broken', 'NaN', 'Infinity', '', '   ']) {
    assert.equal(fixture({ 'skribbil.sound.volume': stored }).audio.volume, 0.4);
  }
  assert.equal(fixture({ 'skribbil.sound.volume': '0' }).audio.volume, 0);
  assert.equal(fixture({ 'skribbil.sound.volume': '0.65' }).audio.volume, 0.65);
  const f = fixture({ 'skribbil.sound.volume': 'broken' }); assert.equal(f.audio.volume, 0.4);
  f.audio.setVolume(5); assert.equal(f.audio.volume, 1);
  f.audio.setVolume(-1); assert.equal(f.audio.volume, 0);
  f.audio.setVolume(NaN); assert.equal(f.audio.volume, 0);
  const denied = { getItem() { throw Error('blocked'); }, setItem() { throw Error('blocked'); } };
  let pauses = 0;
  const audio = createGameAudio({ storage: denied, createAudio: () => ({ play: () => Promise.reject(Error('autoplay denied')), pause() { pauses++; } }) });
  audio.play('pop.wav', 0.5); await new Promise(resolve => setImmediate(resolve));
  audio.setEnabled(false); assert.equal(pauses, 0, 'rejected playback is released');
  audio.setVolume(0.3); assert.equal(audio.volume, 0.3);
});

function webFixture({ rejectedResume = false, delayedDecode = false } = {}) {
  let contexts = 0, fetches = 0, decodes = 0, resumeCalls = 0, resolveDecode;
  const sources = [], nodes = [];
  const ctx = {
    state: 'suspended', destination: {},
    resume() { resumeCalls++; if (rejectedResume) return Promise.reject(Error('gesture required')); this.state = 'running'; return Promise.resolve(); },
    decodeAudioData() { decodes++; return delayedDecode ? new Promise(resolve => { resolveDecode = resolve; }) : Promise.resolve({ pcm: true }); },
    createGain() {
      const node = { gain: { value: 1 }, disconnects: 0, connect(target) { this.target = target; }, disconnect() { this.disconnects++; } };
      nodes.push(node); return node;
    },
    createBufferSource() {
      const source = { stops: 0, disconnects: 0, connect(target) { this.target = target; }, disconnect() { this.disconnects++; },
        start() { this.started = true; this.gainAtStart = this.target.gain.value; }, stop() { this.stops++; }, onended: null };
      sources.push(source); return source;
    },
  };
  const audio = createGameAudio({
    createContext() { contexts++; return ctx; },
    createAudio() { throw Error('Web Audio must not fall back to uncontrolled media volume'); },
    fetchAudio: async () => { fetches++; return { ok: true, arrayBuffer: async () => new ArrayBuffer(4) }; },
  });
  return { audio, ctx, sources, nodes, finishDecode: () => resolveDecode({ pcm: true }), counts: () => ({ contexts, fetches, decodes, resumeCalls }) };
}

test('Web Audio unlock uses one context; pop has 20% GainNode amplitude and cached decoding', async () => {
  const f = webFixture();
  await f.audio.play('pop.wav', 0.5);
  assert.equal(f.sources.length, 0, 'suspended playback is skipped without an old-effect queue');
  await f.audio.unlock(); await f.audio.unlock();
  await f.audio.play('pop.wav', 0.5); await f.audio.play('pop.wav', 0.5);
  assert.equal(f.sources[0].gainAtStart, 0.2);
  assert.deepEqual(f.counts(), { contexts: 1, fetches: 1, decodes: 1, resumeCalls: 1 });
  f.sources[0].onended();
  assert.equal(f.sources[0].disconnects, 1); assert.equal(f.nodes[0].disconnects, 1);
  f.audio.setVolume(0.2); assert.equal(f.nodes[1].gain.value, 0.1);
  f.audio.setEnabled(false);
  assert.equal(f.sources[1].stops, 1); assert.equal(f.sources[1].disconnects, 1); assert.equal(f.nodes[1].disconnects, 1);
  await f.audio.play('pop.wav', 0.5); assert.equal(f.sources.length, 2);
});

test('Web Audio resume rejection never plays a loud HTML fallback or queues stale sounds', async () => {
  const f = webFixture({ rejectedResume: true });
  await f.audio.unlock(); await f.audio.play('pop.wav', 0.5);
  assert.equal(f.sources.length, 0); assert.equal(f.counts().fetches, 0);
  await f.audio.unlock(); assert.equal(f.counts().contexts, 1);
  assert.equal(f.counts().resumeCalls, 2, 'a later trusted gesture can retry unlock');
});

test('muting while Web Audio decodes cancels that effect even after unmuting', async () => {
  const f = webFixture({ delayedDecode: true }); await f.audio.unlock();
  const playback = f.audio.play('pop.wav', 0.5);
  await new Promise(resolve => setImmediate(resolve));
  f.audio.setEnabled(false); f.audio.setEnabled(true);
  f.finishDecode(); await playback;
  assert.equal(f.sources.length, 0);
  await f.audio.play('pop.wav', 0.5); assert.equal(f.sources[0].gainAtStart, 0.2);
});

test('Web Audio decoding failure is contained and retryable', async () => {
  const f = webFixture(); await f.audio.unlock();
  f.ctx.decodeAudioData = () => Promise.reject(Error('invalid wav'));
  await f.audio.play('broken.wav', 0.5); await f.audio.play('broken.wav', 0.5);
  assert.equal(f.sources.length, 0); assert.equal(f.counts().fetches, 2);
});

test('simultaneous correct guesses share one pop while turn notifications stay independent', async () => {
  const f = webFixture(); await f.audio.unlock();
  await Promise.all(Array.from({ length: 9 }, () => f.audio.play('pop.wav', 0.5, { coalesce: true })));
  assert.equal(f.sources.length, 1, 'one pop while loading and playing, not nine overlapping effects');
  assert.equal(f.sources[0].gainAtStart, 0.2);
  await f.audio.play('your-turn.wav'); assert.equal(f.sources.length, 2);
  await f.audio.play('pop.wav', 0.5, { coalesce: true }); assert.equal(f.sources.length, 2);
  f.sources[0].onended();
  await f.audio.play('pop.wav', 0.5, { coalesce: true }); assert.equal(f.sources.length, 3);
  f.audio.setEnabled(false); f.audio.setEnabled(true);
  await f.audio.play('pop.wav', 0.5, { coalesce: true }); assert.equal(f.sources.length, 4, 'muting releases the coalesced effect');
});

test('HTML fallback also coalesces pops until completion', () => {
  const f = fixture();
  for (let i = 0; i < 9; i++) f.audio.play('pop.wav', 0.5, { coalesce: true });
  assert.equal(f.played.length, 1);
  f.audio.play('end-turn.wav'); assert.equal(f.played.length, 2);
  f.played[0].listeners.get('ended')();
  f.audio.play('pop.wav', 0.5, { coalesce: true }); assert.equal(f.played.length, 3);
});

test('round-end audio can be decoded before the event without playing or bypassing mute',async()=>{
 const f=webFixture();await f.audio.unlock();await f.audio.preload(['end-turn.wav']);
 assert.equal(f.sources.length,0);assert.equal(f.counts().fetches,1);
 await f.audio.play('end-turn.wav');assert.equal(f.sources.length,1);assert.equal(f.counts().fetches,1);
 f.audio.setEnabled(false);await f.audio.preload(['other.wav']);assert.equal(f.counts().fetches,1);
});
