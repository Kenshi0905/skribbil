import {createInflate} from 'node:zlib';
// Verify compressed scanlines with bounded streaming memory. Some native image
// decoders recover damaged PNGs instead of failing, so decoding alone is unsafe.
export async function validatePngRaster(bytes){
  const width=bytes.readUInt32BE(16),height=bytes.readUInt32BE(20),depth=bytes[24],color=bytes[25],interlaced=bytes[28];
  const channels={0:1,2:3,3:1,4:2,6:4}[color],chunks=[];
  for(let at=8;at+12<=bytes.length;){const n=bytes.readUInt32BE(at);if(bytes.toString('ascii',at+4,at+8)==='IDAT')chunks.push(bytes.subarray(at+8,at+8+n));at+=12+n;}
  const passes=interlaced?[[0,0,8,8],[4,0,8,8],[0,4,4,8],[2,0,4,4],[0,2,2,4],[1,0,2,2],[0,1,1,2]]:[[0,0,1,1]];
  const rows=passes.map(([x,y,dx,dy])=>{const w=Math.max(0,Math.ceil((width-x)/dx)),h=Math.max(0,Math.ceil((height-y)/dy));return {count:w?h:0,bytes:1+Math.ceil(w*channels*depth/8)};}).filter(p=>p.count);
  const compressed=Buffer.concat(chunks),inflate=createInflate();let pass=0,row=0,column=0;
  const invalid=()=>new Error('Corrupt PNG scanlines.');
  await new Promise((resolve,reject)=>{
    inflate.on('error',reject);
    inflate.on('data',chunk=>{try{let at=0;while(at<chunk.length){const p=rows[pass];if(!p)throw invalid();if(column===0&&chunk[at]>4)throw invalid();const n=Math.min(chunk.length-at,p.bytes-column);at+=n;column+=n;if(column===p.bytes){column=0;if(++row===p.count){row=0;pass++;}}}}catch(error){inflate.destroy(error);}});
    inflate.on('end',()=>pass===rows.length&&column===0&&inflate.bytesWritten===compressed.length?resolve():reject(invalid()));
    inflate.end(compressed);
  });
}
