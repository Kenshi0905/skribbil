import { parentPort } from 'node:worker_threads';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { createCanvas } from '@napi-rs/canvas';

// This is the pinned, local engine source, never user-supplied JavaScript.
// Use its exact raster and fill algorithms so archived art matches the game.
const source = await readFile(new URL('../engine/internal/frontend/resources/draw.js', import.meta.url), 'utf8');
const original = vm.createContext({});
vm.runInContext(source, original, { filename: 'original-engine-draw.js', timeout: 1000 });

parentPort.on('message', operations => {
  try {
    const canvas = createCanvas(1600, 900), context = canvas.getContext('2d');
    context.fillStyle = '#ffffff'; context.fillRect(0, 0, 1600, 900);
    const pixels = context.getImageData(0, 0, 1600, 900);
    for (const op of operations) {
      const d = op?.data;
      if (!d || !Number.isInteger(d.color) || d.color < 0 || d.color >= 26) continue;
      if (![d.x, d.y].every(Number.isInteger)) continue;
      const color = original.indexToRgbColor(d.color);
      if (op.type === 'line') {
        if (![d.x2, d.y2, d.width].every(Number.isInteger) || d.width < 8 || d.width > 32) continue;
        if ([d.x, d.y, d.x2, d.y2].some(v => v < -32768 || v > 32767)) continue;
        original.drawLineNoPut(context, pixels, d.x, d.y, d.x2, d.y2, color, d.width);
      } else if (op.type === 'fill' && d.x >= 0 && d.x < 1600 && d.y >= 0 && d.y < 900) {
        original.floodfillUint8ClampedArray(pixels.data, d.x, d.y, color, 1600, 900);
      }
    }
    context.putImageData(pixels, 0, 0);
    const output = canvas.toBuffer('image/png');
    parentPort.postMessage({ bytes: output });
  } catch (error) { parentPort.postMessage({ error: error.message }); }
});
