import { parentPort } from 'node:worker_threads';
import { createCanvas, loadImage } from '@napi-rs/canvas';

parentPort.on('message', async bytes => {
  try {
    const image = await loadImage(Buffer.from(bytes));
    if (image.width > 1024 || image.height > 1024) throw new Error('Image dimensions exceed the limit.');
    const canvas = createCanvas(256, 256), ctx = canvas.getContext('2d');
    const side = Math.min(image.width, image.height);
    ctx.drawImage(image, (image.width - side) / 2, (image.height - side) / 2, side, side, 0, 0, 256, 256);
    // Reencoding strips text chunks, location metadata and any trailing payload.
    parentPort.postMessage({bytes: canvas.toBuffer('image/png')});
  } catch { parentPort.postMessage({error: 'Choose a valid PNG or JPG image.'}); }
});
