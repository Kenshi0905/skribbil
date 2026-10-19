import test from 'node:test';
import assert from 'node:assert/strict';
import {createCanvasPresenter} from '../engine/internal/frontend/resources/canvas-presenter.js';
function setup(){
 const frames=new Map(),paints=[];let id=0;
 const presenter=createCanvasPresenter({paint:region=>paints.push(region),requestFrame:fn=>{frames.set(++id,fn);return id;},cancelFrame:id=>frames.delete(id)});
 const tick=()=>{const pending=[...frames.values()];frames.clear();pending.forEach(fn=>fn());};
 return {presenter,frames,paints,tick};
}
test('high-frequency strokes share one display upload while retaining their complete dirty region',()=>{
 const f=setup();for(let i=0;i<128;i++)f.presenter.invalidate({left:i,top:10,right:i+5,bottom:20});
 assert.equal(f.frames.size,1);assert.equal(f.paints.length,0);f.tick();
 assert.deepEqual(f.paints,[{left:0,top:10,right:132,bottom:20}]);
 f.presenter.invalidate({left:150,top:20,right:160,bottom:30});f.tick();assert.equal(f.paints.length,2);
});
test('fill, undo and replacement request the entire current buffer without stale line uploads',()=>{
 const f=setup();f.presenter.invalidate({left:2,top:3,right:4,bottom:5});f.presenter.invalidate();f.presenter.invalidate({left:8,top:8,right:9,bottom:9});f.tick();
 assert.deepEqual(f.paints,[null]);f.presenter.flush();assert.equal(f.paints.length,1);
});
test('handoff flushes pending pixels immediately and cancels duplicate presentation',()=>{
 const f=setup();const region={left:1,top:1,right:10,bottom:10};f.presenter.invalidate(region);f.presenter.flush();
 assert.equal(f.frames.size,0);assert.deepEqual(f.paints,[region]);f.tick();assert.equal(f.paints.length,1);
});
