import test from 'node:test';
import assert from 'node:assert/strict';
import { attachCanvasInput } from '../engine/internal/frontend/resources/canvas-input.js';

function setup({view,rect=()=>({ left: 10, top: 20, width: 320, height: 180 })}={}) {
  const handlers = new Map(), lines = [], fills = [], capture = new Set();
  const canvas = {
    ownerDocument:{defaultView:view},getBoundingClientRect:rect,
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

test('coalesced input shares geometry within a frame and scrolling invalidates it immediately',()=>{
  const frames=new Map();let id=0,reads=0,left=10;
  const view=Object.assign(new EventTarget(),{
    visualViewport:new EventTarget(),
    requestAnimationFrame:fn=>{frames.set(++id,fn);return id;},cancelAnimationFrame:id=>frames.delete(id),
  });
  const f=setup({view,rect:()=>{reads++;return{left,top:20,width:320,height:180};}});
  f.emit('pointerdown');f.emit('pointermove',{getCoalescedEvents:()=>[
    {clientX:30,clientY:50},{clientX:40,clientY:60},{clientX:50,clientY:70},
  ]});
  assert.equal(reads,1,'all samples are preserved without repeated layout reads');assert.equal(f.lines.length,4);
  left=20;view.visualViewport.dispatchEvent(new Event('scroll'));f.emit('pointermove',{clientX:70,clientY:80});
  assert.equal(reads,2);assert.deepEqual(f.lines.at(-1).slice(2,4),[50,60]);
  for(const fn of [...frames.values()])fn();frames.clear();f.emit('pointermove',{clientX:80,clientY:90});
  assert.equal(reads,3,'the next frame obtains current geometry');
  f.detach();assert.equal(frames.size,0);view.dispatchEvent(new Event('resize'));assert.equal(frames.size,0);
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
