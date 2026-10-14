import test from 'node:test';
import assert from 'node:assert/strict';
import {createCanvas,loadImage} from '@napi-rs/canvas';
import {mountPhotoCropper,cropGeometry} from '../web/photo-cropper.js';
import {stripedPhoto} from './helpers/photo-fixtures.mjs';

test('crop geometry preserves aspect ratio and clamps all pans/zooms without gaps',()=>{
  for(const [w,h]of [[4000,1000],[1000,4000],[1200,800]])for(const z of [0,1,2,4,10])for(const x of [-100000,0,100000]){
    const g=cropGeometry(w,h,z,x,-x);assert.ok(w*g.scale>=512&&h*g.scale>=512);assert.ok(Math.abs(g.x)<=g.maxX&&Math.abs(g.y)<=g.maxY);
  }
});
function documentFixture(){
  class Element{
    constructor(tag){this.tag=tag;this.children=[];this.events={};this.attrs={};this.hidden=false;this.disabled=false;if(tag==='canvas')this.canvas=createCanvas(512,512);}
    setAttribute(k,v){this.attrs[k]=v;}append(...n){this.children.push(...n);}replaceChildren(...n){this.children=n;}addEventListener(k,fn){this.events[k]=fn;}focus(){}setPointerCapture(){}getBoundingClientRect(){return {width:256};}getContext(){return this.canvas.getContext('2d');}toBlob(fn){fn(new Blob([this.canvas.toBuffer('image/png')],{type:'image/png'}));}
    fire(type,event={}){this.events[type]?.({preventDefault(){},...event});}
  }
  const document={createElement:tag=>new Element(tag)};return {document,root:new Element('div')};
}
test('cropper supports touch/mouse and keyboard, exports only on demand, and cleans URLs on cancel',{timeout:30000},async()=>{
  const {document,root}=documentFixture();globalThis.document=document;const bytes=stripedPhoto(1200,800,'image/png'),file=new File([bytes],'actually-png.jpg',{type:'text/html'}),urls=[];let cancelled=false;
  const cropper=await mountPhotoCropper(root,file,{decode:()=>loadImage(bytes),urls:{createObjectURL(){urls.push('created');return 'blob:test';},revokeObjectURL(){urls.push('revoked');}},onCancel(){cancelled=true;}});
  const all=n=>[n,...n.children.flatMap(all)],canvas=all(root).find(n=>n.tag==='canvas'),button=text=>all(root).find(n=>n.textContent===text);
  assert.deepEqual(urls,['created']);canvas.fire('pointerdown',{button:0,pointerType:'touch',pointerId:1,clientX:0,clientY:0});canvas.fire('pointermove',{pointerId:1,clientX:9999,clientY:9999});canvas.fire('pointerup',{pointerId:1});
  canvas.fire('pointerdown',{button:0,pointerType:'mouse',pointerId:2,clientX:100,clientY:100});canvas.fire('pointermove',{pointerId:2,clientX:-9999,clientY:-9999});canvas.fire('pointercancel',{pointerId:2});
  canvas.fire('keydown',{key:'ArrowLeft'});canvas.fire('keydown',{key:'+'});button('Zoom in').fire('click');button('Reset').fire('click');
  const exported=await cropper.export(),image=await loadImage(Buffer.from(exported.image,'base64'));assert.equal(image.width,512);assert.equal(image.height,512);
  cropper.setBusy(true);assert.ok(button('Cancel crop').disabled);button('Cancel crop').fire('click');assert.equal(cancelled,false);
  cropper.setBusy(false);button('Cancel crop').fire('click');assert.equal(cancelled,true);assert.deepEqual(urls,['created','revoked']);assert.ok(root.hidden);await assert.rejects(cropper.export(),/Choose a photo/);cropper.dispose();assert.equal(urls.length,2);
});
test('decode failures revoke temporary URLs and do not expose an uploadable crop',async()=>{
  const {document,root}=documentFixture();globalThis.document=document;let revoked=0;
  await assert.rejects(mountPhotoCropper(root,new File([stripedPhoto()],'photo.jpg'),{decode:async()=>{throw new Error('decode failed');},urls:{createObjectURL:()=> 'blob:test',revokeObjectURL:()=>revoked++}}),/decode failed/);assert.equal(revoked,1);
});
