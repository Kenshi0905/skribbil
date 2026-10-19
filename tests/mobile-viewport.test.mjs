import test from 'node:test';
import assert from 'node:assert/strict';
import { attachMobileViewport } from '../engine/internal/frontend/resources/mobile-viewport.js';

function setup({ viewport = true, mobile = true, waiting = false } = {}) {
  const classes = new Set(), styles = new Map(), frames = new Map();
  const root = { classList: {
    toggle(name, enabled) { enabled ? classes.add(name) : classes.delete(name); },
    remove: name => classes.delete(name),
  }, style: { setProperty: (key, value) => styles.set(key, value), removeProperty: key => styles.delete(key) } };
  const panel = { hidden: !waiting }, media = Object.assign(new EventTarget(), { matches: mobile });
  const visualViewport = Object.assign(new EventTarget(), { height: 844, offsetTop: 0, scale: 1 });
  let mutation, resize, nextFrame = 0;
  const view = Object.assign(new EventTarget(), {
    visualViewport: viewport ? visualViewport : undefined, innerHeight: 844,
    matchMedia: () => media,
    requestAnimationFrame(fn) { frames.set(++nextFrame, fn); return nextFrame; },
    cancelAnimationFrame: id => frames.delete(id),
    getComputedStyle: () => ({ paddingTop: '0px', paddingBottom: '20px' }),
    MutationObserver: class { constructor(fn) { mutation = fn; } observe() {} disconnect() {} },
    ResizeObserver: class { constructor(fn) { resize = fn; } observe() {} disconnect() {} },
  });
  const heights = { 'league-toolbar': 44, 'lobby-header': 48, toolbox: 0, 'message-form': 44 };
  const doc = { documentElement: root, getElementById: id => id === 'room-look-panel' ? panel : { getBoundingClientRect: () => ({ height: heights[id] ?? 0 }) } };
  const detach = attachMobileViewport(view, doc);
  const flush = () => { const pending = [...frames.values()]; frames.clear(); pending.forEach(fn => fn()); };
  return { doc, view, visualViewport, media, panel, classes, styles, heights, frames, flush, detach, mutation: () => mutation(), resize: () => resize() };
}

test('keyboard resizing and Safari viewport panning retain space for canvas, chat and input', () => {
  const f = setup();
  assert.ok(f.classes.has('mobile-game'));
  f.visualViewport.height = 400; f.visualViewport.offsetTop = 130;
  f.visualViewport.dispatchEvent(new Event('resize'));
  f.visualViewport.dispatchEvent(new Event('scroll'));
  assert.equal(f.frames.size, 1, 'resize bursts share one animation frame');
  f.flush();
  assert.equal(f.styles.get('--game-height'), '400px');
  assert.equal(f.styles.get('--game-top'), '130px');
  assert.equal(f.styles.get('--game-board-limit'), '176px');
  f.heights.toolbox = 100; f.resize(); f.flush();
  assert.equal(f.styles.get('--game-board-limit'), '76px', 'drawing controls remain accessible');
  f.visualViewport.height = 844; f.visualViewport.offsetTop = 0;
  f.visualViewport.dispatchEvent(new Event('resize')); f.flush();
  assert.equal(f.styles.get('--game-height'), '844px');
  assert.equal(f.styles.get('--game-top'), '0px');
});

test('pinch zoom is not mistaken for a keyboard and desktop clears mobile sizing', () => {
  const f = setup();
  f.visualViewport.scale = 2; f.visualViewport.height = 422;
  f.visualViewport.dispatchEvent(new Event('resize')); f.flush();
  assert.equal(f.styles.get('--game-height'), '844px');
  f.media.matches = false; f.media.dispatchEvent(new Event('change')); f.flush();
  assert.equal(f.classes.size, 0); assert.equal(f.styles.size, 0);
});

test('pre-game editor scrolls normally; starting and returning from a game update sizing', () => {
  const f = setup({ waiting: true });
  assert.equal(f.classes.size, 0);
  f.panel.hidden = true; f.mutation(); f.flush();
  assert.ok(f.classes.has('mobile-game'));
  f.panel.hidden = false; f.mutation(); f.flush();
  assert.equal(f.classes.size, 0); assert.equal(f.styles.size, 0);
});

test('fallback viewport, initial desktop and disposal do not leave scroll locks behind', () => {
  const desktop = setup({ mobile: false });
  assert.equal(desktop.styles.size, 0); desktop.detach();
  const f = setup({ viewport: false });
  f.view.innerHeight = 420; f.view.dispatchEvent(new Event('resize')); f.flush();
  assert.equal(f.styles.get('--game-height'), '420px');
  f.view.dispatchEvent(new Event('resize')); f.detach(); f.flush();
  assert.equal(f.frames.size, 0); assert.equal(f.classes.size, 0); assert.equal(f.styles.size, 0);
  f.view.dispatchEvent(new Event('resize')); assert.equal(f.frames.size, 0);
});

test('gallery nominations reserve viewport space instead of covering the phone guess field',()=>{
 const f=setup();const before=parseFloat(f.styles.get('--game-board-limit'));
 f.heights['gallery-voting']=154;f.resize();f.flush();
 assert.equal(parseFloat(f.styles.get('--game-board-limit')),before-154);
 f.visualViewport.height=400;f.visualViewport.dispatchEvent(new Event('resize'));f.flush();
 assert.ok(parseFloat(f.styles.get('--game-board-limit'))>=0);f.detach();
});

test('canvas-frame reactions and social tabs reserve space above a keyboard-sized canvas',()=>{
 const f=setup();f.heights['canvas-frame-heading']=44;f.heights['game-social-tabs']=44;
 f.visualViewport.height=320;f.visualViewport.offsetTop=80;f.resize();f.flush();
 assert.equal(f.styles.get('--game-board-limit'),'28px');
 assert.equal(f.styles.get('--game-top'),'80px');
 f.visualViewport.height=200;f.resize();f.flush();
 assert.equal(f.styles.get('--game-board-limit'),'0px');
 f.detach();
});

test('focused short view reserves separate canvas reactions and tabs with compact gaps',()=>{
 const f=setup();f.heights['canvas-frame-heading']=48;f.heights['game-social-tabs']=48;
 f.heights['lobby-header']=48;f.doc.activeElement={id:'message-input'};
 f.visualViewport.height=320;f.resize();f.flush();
 assert.equal(f.styles.get('--game-board-limit'),'56px');
 f.heights['game-social-tabs']+=12;f.resize();f.flush();
 assert.equal(f.styles.get('--game-board-limit'),'44px','taller tabs never overlap or cover the artwork');
 f.heights['game-social-tabs']-=12;
 f.doc.activeElement=null;f.resize();f.flush();
 assert.equal(f.styles.get('--game-board-limit'),'20px');f.detach();
});
