import { parentPort } from 'node:worker_threads';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import {inspectImage,IMAGE_MAX_PIXELS} from '../web/image-file.js';
import {validatePngRaster} from './png-raster.mjs';

parentPort.on('message', async bytes => {
  try {
    const meta=inspectImage(bytes);
    if(meta.format==='png')await validatePngRaster(Buffer.from(bytes));
    // The native decoder applies EXIF orientation before exposing dimensions.
    const image = await loadImage(Buffer.from(bytes));
    const swapped=meta.format==='jpeg'&&meta.orientation>=5;
    if(image.width!== (swapped?meta.height:meta.width)||image.height!==(swapped?meta.width:meta.height)||image.width*image.height>IMAGE_MAX_PIXELS)throw new Error('Decoded image dimensions do not match its header.');
    const canvas = createCanvas(512, 512), ctx = canvas.getContext('2d');
    const side = Math.min(image.width, image.height);
    ctx.drawImage(image, (image.width - side) / 2, (image.height - side) / 2, side, side, 0, 0, 512, 512);
    // Reencoding strips text chunks, location metadata and any trailing payload.
    parentPort.postMessage({bytes: canvas.toBuffer('image/png')});
  } catch { parentPort.postMessage({error: 'Image decode failed. The photo may be damaged; choose another PNG, JPEG, or WebP.'}); }
});
