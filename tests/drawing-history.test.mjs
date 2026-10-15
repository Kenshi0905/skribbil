import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { createDrawingHistory } from '../engine/internal/frontend/resources/drawing-history.js';

const renderer = vm.createContext({console});
vm.runInContext(readFileSync(new URL('../engine/internal/frontend/resources/draw.js', import.meta.url), 'utf8'), renderer);

test('dirty updates preserve all stroke pixels while touching only the local region',()=>{
  const pixels={width:160,height:90,data:new Uint8ClampedArray(160*90*4).fill(255)},screen=pixels.data.slice(),areas=[];
  const context={canvas:{width:160,height:90},putImageData(image,dx,dy,x,y,width,height){
    areas.push(width*height);
    for(let row=y;row<y+height;row++)screen.set(image.data.subarray((row*160+x)*4,(row*160+x+width)*4),(row*160+x)*4);
  }};
  for(const point of [[130,70,136,74],[0,0,3,4],[158,88,164,95]]) {
    renderer.drawLine(context,pixels,...point,{r:35,g:20,b:90},4);
    assert.deepEqual(screen,pixels.data,'partial presentation must match canonical pixels including edges');
  }
  assert.ok(areas.every(area=>area<160*90/5),'a small stroke must not repaint the origin-to-stroke rectangle');
});
function canvas() {
  const image = {width:64,height:36,data:new Uint8ClampedArray(64*36*4)};
  const context = {canvas:{width:64,height:36}};
  let time=0, draws=0, presents=0;
  const reset = () => image.data.fill(255);
  const draw = ({type,data}) => {
    draws++;
    if (type==='fill') return renderer.floodfillUint8ClampedArray(image.data,data.x,data.y,data.color,image.width,image.height);
    renderer.drawLineNoPut(context,image,data.x,data.y,data.x2,data.y2,data.color,data.width);
  };
  const history = createDrawingHistory({snapshot:()=>image.data.slice(),restore:pixels=>image.data.set(pixels),clear:reset,draw,present:()=>presents++,now:()=>time});
  history.reset();
  return {history,image,draw,reset,advance:()=>time+=200,counts:()=>({draws,presents})};
}
const line = (i=0) => ({type:'line',data:{x:8+i%30,y:8,x2:9+i%30,y2:9,color:{r:0,g:0,b:0},width:2}});
const fill = {type:'fill',data:{x:0,y:0,color:{r:50,g:100,b:150}}};
function expectPixels(client,events) {
  const reference=canvas();
  for (const event of events) reference.draw(event);
  assert.deepEqual(client.image.data,reference.image.data);
}

test('cached undo restores exact pixels for pen, fill, rapid undo and queued new strokes',()=>{
  const c=canvas(), events=[line(1),line(2),fill,line(3),line(4)];
  for (const event of events) { c.advance(); c.history.append(event); }
  assert.equal(c.history.undo({from:3,to:4}),true);
  events.splice(3,1); expectPixels(c,events);
  assert.equal(c.history.undo({from:2,to:3}),true);
  events.splice(2,1); expectPixels(c,events);
  assert.equal(c.history.undo({from:0,to:events.length}),true);
  expectPixels(c,[]);
});

test('recent undo replays only a bounded suffix instead of the entire drawing',()=>{
  const c=canvas(), events=Array.from({length:1000},(_,i)=>line(i));
  for (const event of events) c.history.append(event);
  const before=c.counts();
  c.history.undo({from:990,to:1000});
  assert.equal(c.counts().draws-before.draws,94);
  assert.equal(c.counts().presents-before.presents,1);
  expectPixels(c,events.slice(0,990));
});

test('evicted snapshots replay safely and clear/reconnect replace all history',()=>{
  const c=canvas(), events=Array.from({length:12},(_,i)=>line(i));
  for (const event of events) { c.advance(); c.history.append(event); }
  c.history.undo({from:1,to:12}); expectPixels(c,events.slice(0,1));
  c.history.replace([fill,line(3)]); expectPixels(c,[fill,line(3)]);
  c.history.undo({from:1,to:2}); expectPixels(c,[fill]);
  c.history.replace([]); expectPixels(c,[]);
  assert.equal(c.history.undo({from:0,to:1}),false);
  for (const range of [{from:-1,to:0},{from:0,to:0},{from:0.5,to:1}]) assert.equal(c.history.undo(range),false);
});
