import test from 'node:test';
import assert from 'node:assert/strict';
import {loadImage,createCanvas} from '@napi-rs/canvas';
import {inspectImage,IMAGE_MAX_BYTES} from '../web/image-file.js';
import {normalizeImage,validateImage} from '../server/media.mjs';
import {pngVariant,pngChunk,stripedPhoto,orientedJpeg} from './helpers/photo-fixtures.mjs';
const input=b=>b.toString('base64');
test('real PNG variants, transparency, phone-size JPEG, wide/tall images and WebP normalize safely',{timeout:60000},async()=>{
  for(const bytes of [0,2,3,4,6].map(n=>pngVariant(n,{transparent:true})).concat([stripedPhoto(4000,1000),stripedPhoto(1000,4000),stripedPhoto(2400,1800,'image/webp')])){
    assert.doesNotThrow(()=>validateImage(input(bytes)));const normalized=await normalizeImage(input(bytes)),image=await loadImage(normalized);assert.equal(image.width,512);assert.equal(image.height,512);assert.equal(inspectImage(normalized).format,'png');
  }
  const transparent=await loadImage(await normalizeImage(input(pngVariant(6,{transparent:true}))));const c=createCanvas(512,512),x=c.getContext('2d');x.drawImage(transparent,0,0);assert.ok(x.getImageData(256,256,1,1).data[3]<255);
});
test('all EXIF orientation variants decode before normalized crop',{timeout:60000},async()=>{
  for(let orientation=1;orientation<=8;orientation++){const bytes=orientedJpeg(orientation);assert.equal(inspectImage(bytes).orientation,orientation);const image=await loadImage(bytes);assert.equal(image.width,orientation>=5?40:80);assert.equal(image.height,orientation>=5?80:40);assert.equal(inspectImage(await normalizeImage(input(bytes))).orientation,1);}
});
test('source size, decoded dimensions, CRC, truncation, wrong signatures and trailing polyglots are bounded',{timeout:60000},async()=>{
  const png=pngVariant(),extra=IMAGE_MAX_BYTES-png.length-12,maximum=Buffer.concat([png.subarray(0,-12),pngChunk('tEXt',Buffer.concat([Buffer.from('note\0'),Buffer.alloc(extra-5,97)])),png.subarray(-12)]);
  assert.equal(maximum.length,IMAGE_MAX_BYTES);assert.doesNotThrow(()=>validateImage(input(maximum)));assert.ok((await normalizeImage(input(maximum))).length<10000);
  assert.throws(()=>validateImage(input(Buffer.concat([maximum,Buffer.from('x')]))),/8 MiB/);
  const header=Buffer.alloc(13);header.writeUInt32BE(5001);header.writeUInt32BE(5000,4);header[8]=8;header[9]=6;
  const bomb=Buffer.concat([png.subarray(0,8),pngChunk('IHDR',header),png.subarray(33)]);assert.throws(()=>validateImage(input(bomb)),/25 megapixels/);
  for(const bytes of [png.subarray(0,-1),Buffer.concat([png,Buffer.from('<script>alert(1)</script>')]),Buffer.from('<html>not a photo</html>'),Buffer.from('<svg/>'),Buffer.from('GIF89a'),Buffer.concat([stripedPhoto(),Buffer.from('unsafe')])])assert.throws(()=>validateImage(input(bytes)));
  const damaged=Buffer.from(png);damaged[damaged.length-16]^=255;assert.throws(()=>validateImage(input(damaged)),/corrupt/);
  const validContainer=Buffer.concat([png.subarray(0,33),pngChunk('IDAT',Buffer.from('not zlib')),pngChunk('IEND',Buffer.alloc(0))]);await assert.rejects(normalizeImage(input(validContainer)),/decode failed/);
});
