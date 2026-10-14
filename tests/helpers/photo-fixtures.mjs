import {deflateSync} from 'node:zlib';
import {createCanvas} from '@napi-rs/canvas';
const table=Uint32Array.from({length:256},(_,n)=>{for(let i=0;i<8;i++)n=n&1?0xedb88320^(n>>>1):n>>>1;return n>>>0;});
export function pngChunk(type,data){const out=Buffer.alloc(data.length+12);out.writeUInt32BE(data.length);out.write(type,4);data.copy(out,8);let c=0xffffffff;for(let i=4;i<out.length-4;i++)c=table[(c^out[i])&255]^(c>>>8);out.writeUInt32BE((c^0xffffffff)>>>0,out.length-4);return out;}
export function pngVariant(color=6,{width=12,height=10,transparent=false}={}){
  const header=Buffer.alloc(13);header.writeUInt32BE(width);header.writeUInt32BE(height,4);header[8]=8;header[9]=color;
  const channels={0:1,2:3,3:1,4:2,6:4}[color],row=Buffer.alloc(width*channels+1),scan=Buffer.alloc(row.length*height);
  for(let i=0;i<width;i++){const p=1+i*channels;if(color===3)row[p]=i%2;else{row[p]=180;if(channels>=3){row[p+1]=70;row[p+2]=210;}if(color===4)row[p+1]=transparent?80:255;if(color===6)row[p+3]=transparent?80:255;}}
  for(let i=0;i<height;i++)row.copy(scan,i*row.length);
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),pngChunk('IHDR',header),...(color===3?[pngChunk('PLTE',Buffer.from([255,80,100,50,180,200])),pngChunk('tRNS',Buffer.from([0,255]))]:[]),pngChunk('IDAT',deflateSync(scan)),pngChunk('IEND',Buffer.alloc(0))]);
}
export function stripedPhoto(width=1200,height=800,format='image/jpeg'){
  const c=createCanvas(width,height),x=c.getContext('2d');x.fillStyle='#ef503d';x.fillRect(0,0,width/3,height);x.fillStyle='#54aa76';x.fillRect(width/3,0,width/3,height);x.fillStyle='#6e65cf';x.fillRect(width*2/3,0,width/3,height);return c.toBuffer(format);
}
export function orientedJpeg(orientation=6){const jpeg=stripedPhoto(80,40),exif=Buffer.from('45786966000049492a0008000000010012010300010000000600000000000000','hex');exif.writeUInt16LE(orientation,24);const marker=Buffer.alloc(4);marker[0]=255;marker[1]=225;marker.writeUInt16BE(exif.length+2,2);return Buffer.concat([jpeg.subarray(0,2),marker,exif,jpeg.subarray(2)]);}
