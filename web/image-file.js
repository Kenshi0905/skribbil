// Shared source preflight. The server always decodes again before storing PNG.
export const IMAGE_MAX_BYTES=8*1024*1024, IMAGE_MAX_PIXELS=25_000_000;
const fail=message=>{throw new Error(message);};
const ascii=(b,at,n)=>String.fromCharCode(...b.subarray(at,at+n));
const crcTable=Uint32Array.from({length:256},(_,n)=>{for(let i=0;i<8;i++)n=n&1?0xedb88320^(n>>>1):n>>>1;return n>>>0;});
const crc=(b,from,to)=>{let c=0xffffffff;for(let i=from;i<to;i++)c=crcTable[(c^b[i])&255]^(c>>>8);return (c^0xffffffff)>>>0;};
export function inspectImage(bytes){
  const b=bytes instanceof Uint8Array?bytes:new Uint8Array(bytes);
  if(b.length>IMAGE_MAX_BYTES)fail('Image exceeds 8 MiB. Choose a smaller photo.');
  const v=new DataView(b.buffer,b.byteOffset,b.byteLength),corrupt=()=>fail('This image is unreadable or corrupt. Choose another PNG, JPEG, or WebP.');
  let width=0,height=0,format='',orientation=1;
  const dimensions=(w,h)=>{if(!w||!h)corrupt();if(w>32768||h>32768||w*h>IMAGE_MAX_PIXELS)fail('Image dimensions exceed 25 megapixels or 32768 pixels per side.');if(width&&(width!==w||height!==h))corrupt();width=w;height=h;};
  if(b.length>=8&&ascii(b,0,8)==='\x89PNG\r\n\x1a\n'){
    format='png';let at=8,header=false,data=false,dataEnded=false,end=false,palette=false,color=0;
    while(at+12<=b.length){const n=v.getUint32(at),type=ascii(b,at+4,4);if(n>b.length-at-12||!/^[A-Za-z]{4}$/.test(type))corrupt();
      if(v.getUint32(at+8+n)!==crc(b,at+4,at+8+n))corrupt();
      if(!header){if(type!=='IHDR'||n!==13)corrupt();dimensions(v.getUint32(at+8),v.getUint32(at+12));const depth=b[at+16];color=b[at+17];if(!({0:[1,2,4,8,16],2:[8,16],3:[1,2,4,8],4:[8,16],6:[8,16]}[color]?.includes(depth))||b[at+18]!==0||b[at+19]!==0||b[at+20]>1)corrupt();header=true;}
      else if(type==='IHDR')corrupt();
      if(type==='acTL'||type==='fcTL'||type==='fdAT')fail('Animated images are unsupported. Choose a static photo.');
      if(type==='PLTE'){if(data||n<3||n>768||n%3)corrupt();palette=true;}
      if(type==='IDAT'){if(dataEnded||color===3&&!palette)corrupt();data=true;}
      else if(data)dataEnded=true;
      if(type==='IEND'){if(n||!data)corrupt();at+=12;end=true;break;}
      if(type[0]===type[0].toUpperCase()&&!['IHDR','PLTE','IDAT','IEND'].includes(type))corrupt();at+=n+12;
    }
    if(!end||at!==b.length)corrupt();
  }else if(b.length>=4&&b[0]===255&&b[1]===216){
    format='jpeg';let at=2,end=false,scan=false;
    const frames=new Set([0xc0,0xc1,0xc2]);
    while(at<b.length){if(b[at++]!==255)corrupt();while(b[at]===255)at++;const marker=b[at++];
      if(marker===0xd9){end=true;break;}if(marker===0||marker===0xd8||at+2>b.length)corrupt();
      const n=v.getUint16(at);if(n<2||at+n>b.length)corrupt();
      if(frames.has(marker)){if(n<8)corrupt();dimensions(v.getUint16(at+5),v.getUint16(at+3));}
      if(marker===0xe1&&n>=16&&ascii(b,at+2,6)==='Exif\0\0'){
        const start=at+8,little=ascii(b,start,2)==='II',big=ascii(b,start,2)==='MM';
        if(little||big){try{if(v.getUint16(start+2,little)===42){const dir=start+v.getUint32(start+4,little);if(dir>=start+8&&dir+2<=at+n){const count=v.getUint16(dir,little);for(let i=0;i<count&&dir+2+(i+1)*12<=at+n;i++){const p=dir+2+i*12;if(v.getUint16(p,little)===0x112&&v.getUint16(p+2,little)===3&&v.getUint32(p+4,little)===1){const value=v.getUint16(p+8,little);if(value>=1&&value<=8)orientation=value;}}}}}catch{corrupt();}}
      }
      at+=n;
      if(marker===0xda){scan=true;while(at<b.length){if(b[at++]!==255)continue;while(b[at]===255)at++;if(b[at]===0||b[at]>=0xd0&&b[at]<=0xd7){at++;continue;}at-=1;break;}}
    }
    if(!end||at!==b.length||!scan||!width)corrupt();
  }else if(b.length>=20&&ascii(b,0,4)==='RIFF'&&ascii(b,8,4)==='WEBP'){
    format='webp';if(v.getUint32(4,true)+8!==b.length)corrupt();let at=12,raster=false;
    while(at+8<=b.length){const type=ascii(b,at,4),n=v.getUint32(at+4,true),p=at+8;if(n>b.length-p)corrupt();
      if(type==='ANIM'||type==='ANMF')fail('Animated images are unsupported. Choose a static photo.');
      if(type==='VP8X'){if(n!==10)corrupt();if(b[p]&2)fail('Animated images are unsupported. Choose a static photo.');dimensions(1+b[p+4]+(b[p+5]<<8)+(b[p+6]<<16),1+b[p+7]+(b[p+8]<<8)+(b[p+9]<<16));}
      if(type==='VP8 '){if(raster||n<10||ascii(b,p+3,3)!=='\x9d\x01\x2a')corrupt();dimensions(v.getUint16(p+6,true)&0x3fff,v.getUint16(p+8,true)&0x3fff);raster=true;}
      if(type==='VP8L'){if(raster||n<5||b[p]!==0x2f)corrupt();const bits=v.getUint32(p+1,true);if(bits>>>29)corrupt();dimensions(1+(bits&0x3fff),1+((bits>>>14)&0x3fff));raster=true;}
      at=p+n+(n%2);
    }if(at!==b.length||!raster)corrupt();
  }else fail('Unsupported image format. Choose a PNG, JPEG, or WebP photo.');
  return {width,height,format,orientation};
}

export async function verifyBrowserPng(bytes){
  // Modern browsers expose a strict streaming zlib decoder. Older browsers
  // still use their native image decoder; the server revalidates every export.
  if(typeof DecompressionStream!=='function')return;
  const b=new Uint8Array(bytes),v=new DataView(b.buffer,b.byteOffset,b.byteLength),parts=[];
  for(let at=8;at+12<=b.length;){const n=v.getUint32(at);if(ascii(b,at+4,4)==='IDAT')parts.push(b.subarray(at+8,at+8+n));at+=12+n;}
  const width=v.getUint32(16),height=v.getUint32(20),channels={0:1,2:3,3:1,4:2,6:4}[b[25]],depth=b[24];
  const passes=b[28]?[[0,0,8,8],[4,0,8,8],[0,4,4,8],[2,0,4,4],[0,2,2,4],[1,0,2,2],[0,1,1,2]]:[[0,0,1,1]];
  const rows=passes.map(([x,y,dx,dy])=>{const w=Math.max(0,Math.ceil((width-x)/dx)),h=Math.max(0,Math.ceil((height-y)/dy));return {count:w?h:0,bytes:1+Math.ceil(w*channels*depth/8)};}).filter(p=>p.count);
  const reader=new Blob(parts).stream().pipeThrough(new DecompressionStream('deflate')).getReader();let pass=0,row=0,column=0;
  try{while(true){const {value,done}=await reader.read();if(done)break;let at=0;while(at<value.length){const p=rows[pass];if(!p||column===0&&value[at]>4)throw new Error();const n=Math.min(value.length-at,p.bytes-column);at+=n;column+=n;if(column===p.bytes){column=0;if(++row===p.count){row=0;pass++;}}}}if(pass!==rows.length||column)throw new Error();}
  catch{await reader.cancel().catch(()=>{});fail('This PNG is corrupt or truncated. Choose another photo.');}
  finally{reader.releaseLock();}
}
