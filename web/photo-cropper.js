import {inspectImage,verifyBrowserPng,IMAGE_MAX_BYTES,IMAGE_MAX_PIXELS} from './image-file.js';
export function cropGeometry(width,height,zoom=1,x=0,y=0,side=512){
  const scale=Math.max(side/width,side/height)*Math.max(1,Math.min(4,zoom));
  const maxX=(width*scale-side)/2,maxY=(height*scale-side)/2;
  return {scale,x:Math.max(-maxX,Math.min(maxX,x)),y:Math.max(-maxY,Math.min(maxY,y)),maxX,maxY};
}
export async function mountPhotoCropper(root,file,{onCancel,onReady,decode,urls=URL}={}){
  if(file.size>IMAGE_MAX_BYTES)throw new Error('Image exceeds 8 MiB. Choose a smaller photo.');
  const bytes=new Uint8Array(await file.arrayBuffer()),meta=inspectImage(bytes);
  if(meta.format==='png')await verifyBrowserPng(bytes);
  const url=urls.createObjectURL(new Blob([bytes],{type:{png:'image/png',jpeg:'image/jpeg',webp:'image/webp'}[meta.format]}));
  let image,disposed=false;
  try{image=await (decode?decode(url):new Promise((resolve,reject)=>{const img=new Image();img.onload=()=>resolve(img);img.onerror=()=>reject(new Error('Image decode failed. Choose another photo.'));img.src=url;}));}
  catch(error){urls.revokeObjectURL(url);throw error;}
  const width=image.naturalWidth||image.width,height=image.naturalHeight||image.height;
  if(!width||!height||width*height>IMAGE_MAX_PIXELS){urls.revokeObjectURL(url);throw new Error('Decoded image exceeds 25 megapixels.');}
  const node=(tag,text,cls)=>{const n=document.createElement(tag);if(text)n.textContent=text;if(cls)n.className=cls;return n;};
  const canvas=node('canvas',null,'photo-crop-canvas');canvas.width=512;canvas.height=512;canvas.tabIndex=0;canvas.setAttribute('role','img');canvas.setAttribute('aria-label','Photo crop. Drag or use arrow keys to pan; plus and minus zoom; zero resets.');canvas.setAttribute('aria-describedby','photo-crop-instructions');
  const window=node('div',null,'photo-crop-window'),circle=node('span',null,'photo-crop-circle');circle.setAttribute('aria-hidden','true');window.append(canvas,circle);
  const help=node('p','Drag the photo or use arrow keys to move it. Use + / − to zoom and 0 to reset. The circle previews your avatar; the saved image is square.','form-note');help.id='photo-crop-instructions';
  const status=node('p',null,'form-note');status.setAttribute('role','status');
  const zoomLabel=node('label','Zoom'),slider=node('input');slider.type='range';slider.min='1';slider.max='4';slider.step='.01';slider.value='1';slider.id='photo-crop-zoom';zoomLabel.htmlFor=slider.id;zoomLabel.append(slider);
  let zoom=1,x=0,y=0,pointer=null,busy=false;const ctx=canvas.getContext('2d'),controls=node('div',null,'photo-crop-controls');
  const button=(text,fn)=>{const b=node('button',text);b.type='button';b.addEventListener('click',fn);return b;};
  function draw(){if(disposed)return;const g=cropGeometry(width,height,zoom,x,y);x=g.x;y=g.y;const side=512/g.scale;ctx.clearRect(0,0,512,512);ctx.drawImage(image,(width-side)/2-x/g.scale,(height-side)/2-y/g.scale,side,side,0,0,512,512);slider.value=String(zoom);}
  function setZoom(value){if(busy||disposed)return;const prior=cropGeometry(width,height,zoom,x,y);zoom=Math.max(1,Math.min(4,value));const next=cropGeometry(width,height,zoom,x,y);x*=next.scale/prior.scale;y*=next.scale/prior.scale;draw();}
  function reset(){if(busy||disposed)return;zoom=1;x=0;y=0;draw();status.textContent='Crop reset.';}
  const buttons=[button('Zoom out',()=>setZoom(zoom-.2)),button('Zoom in',()=>setZoom(zoom+.2)),button('Reset',reset),button('Cancel crop',()=>{if(busy||disposed)return;dispose();onCancel?.();})];controls.append(zoomLabel,...buttons);
  slider.addEventListener('input',()=>setZoom(Number(slider.value)));
  canvas.addEventListener('pointerdown',e=>{if(busy||disposed||pointer||e.button!==0&&e.pointerType==='mouse')return;pointer={id:e.pointerId,x:e.clientX,y:e.clientY};canvas.focus();canvas.setPointerCapture(e.pointerId);e.preventDefault();});
  canvas.addEventListener('pointermove',e=>{if(!pointer||pointer.id!==e.pointerId||busy||disposed)return;const factor=512/canvas.getBoundingClientRect().width;x+=(e.clientX-pointer.x)*factor;y+=(e.clientY-pointer.y)*factor;pointer.x=e.clientX;pointer.y=e.clientY;draw();e.preventDefault();});
  const release=e=>{if(pointer?.id===e.pointerId)pointer=null;};for(const type of ['pointerup','pointercancel','lostpointercapture'])canvas.addEventListener(type,release);
  canvas.addEventListener('keydown',e=>{if(busy||disposed)return;const step=e.shiftKey?32:8;if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','+','=','-','0'].includes(e.key)){e.preventDefault();if(e.key==='ArrowLeft')x-=step;if(e.key==='ArrowRight')x+=step;if(e.key==='ArrowUp')y-=step;if(e.key==='ArrowDown')y+=step;if(e.key==='+'||e.key==='=')setZoom(zoom+.2);else if(e.key==='-')setZoom(zoom-.2);else if(e.key==='0')reset();else draw();}});
  function dispose(){if(disposed)return;disposed=true;pointer=null;urls.revokeObjectURL(url);image.close?.();canvas.width=canvas.height=0;root.replaceChildren();root.hidden=true;}
  root.replaceChildren(node('h3','Crop your photo'),window,help,controls,status);root.hidden=false;draw();onReady?.();canvas.focus();
  return {dispose,setBusy(value){busy=value;slider.disabled=value;for(const b of buttons)b.disabled=value;canvas.setAttribute('aria-disabled',String(value));},async export(){if(disposed)throw new Error('Choose a photo first.');const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));if(!blob)throw new Error('Photo export failed. Try another photo.');const bytes=new Uint8Array(await blob.arrayBuffer());let binary='';for(const byte of bytes)binary+=String.fromCharCode(byte);return {image:btoa(binary)};}};
}
