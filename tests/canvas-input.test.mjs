import test from 'node:test';
import assert from 'node:assert/strict';
import { attachCanvasInput } from '../engine/internal/frontend/resources/canvas-input.js';

function setup() {
  const handlers = new Map(), lines = [], fills = [], capture = new Set();
  const canvas = {
    getBoundingClientRect: () => ({ left: 10, top: 20, width: 320, height: 180 }),
    addEventListener: (name, fn) => handlers.set(name, fn), removeEventListener: name => handlers.delete(name),
    setPointerCapture: id => capture.add(id), hasPointerCapture: id => capture.has(id), releasePointerCapture: id => capture.delete(id),
  };
  const current = { enabled: true, tool: 'pen', width: 8, pressure: false };
  const detach = attachCanvasInput(canvas, { state: () => current, line: (...args) => lines.push(args), fill: (...args) => fills.push(args) });
  const emit = (type, override = {}) => handlers.get(type)?.({ pointerId: 1, pointerType: 'touch', isPrimary: true, button: 0, buttons: 1, clientX: 20, clientY: 40, pressure: 0.5, preventDefault() {}, ...override });
  return { current, emit, lines, fills, capture, handlers, detach };
}

test('touch taps draw one dot; captured strokes remain continuous and bounded', () => {
  const f = setup(); f.emit('pointerdown');
  assert.deepEqual(f.lines, [[10, 20, 10, 20, 8]]); assert.ok(f.capture.has(1));
  f.emit('pointermove', { clientX: 60, clientY: 90 });
  f.emit('pointermove', { clientX: 600, clientY: -30 });
  assert.deepEqual(f.lines.slice(1), [[10, 20, 50, 70, 8], [50, 70, 319, 0, 8]]);
  f.emit('pointerup'); f.emit('pointermove', { clientX: 200 });
  assert.equal(f.lines.length, 3); assert.equal(f.capture.size, 0);
  assert.equal(f.handlers.has('click'), false, 'synthetic clicks cannot duplicate strokes');
});

test('fill uses one touch and does not turn a drag or second finger into fills', () => {
  const f = setup(); f.current.tool = 'fill'; f.emit('pointerdown');
  f.emit('pointerdown', { pointerId: 2, isPrimary: false, clientX: 90 });
  f.emit('pointermove', { clientX: 100 }); f.emit('pointerup');
  assert.deepEqual(f.fills, [[10, 20]]); assert.equal(f.lines.length, 0);
});

test('cancellation, revoked drawing authority and tool changes stop the active stroke', () => {
  const f = setup(); f.emit('pointerdown'); f.emit('pointercancel');
  f.emit('pointermove', { clientX: 80 }); assert.equal(f.lines.length, 1);
  f.emit('pointerdown'); f.current.enabled = false; f.emit('pointermove', { clientX: 90 });
  assert.equal(f.capture.size, 0); assert.equal(f.lines.length, 2);
  f.emit('pointerdown'); assert.equal(f.lines.length, 2);
  f.current.enabled = true; f.emit('pointerdown'); f.current.tool = 'rubber'; f.emit('pointermove');
  assert.equal(f.capture.size, 0); f.detach(); assert.equal(f.handlers.size, 0);
});

test('stylus pressure and coalesced samples retain the original protocol widths', () => {
  const f = setup(); f.current.pressure = true;
  f.emit('pointerdown', { pointerType: 'pen', pressure: 0.25 });
  f.emit('pointermove', { pointerType: 'pen', getCoalescedEvents: () => [
    { pointerType: 'pen', clientX: 30, clientY: 50, pressure: 0.5 },
    { pointerType: 'pen', clientX: 40, clientY: 60, pressure: 1 },
  ] });
  assert.deepEqual(f.lines.map(l => l[4]), [8, 16, 32]);
  f.emit('pointerup'); f.emit('pointerdown', { pointerType: 'mouse', button: 2 });
  assert.equal(f.lines.length, 3, 'right mouse button does not draw');
});
