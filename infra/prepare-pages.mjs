import { cp, mkdir, copyFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = resolve(root, '.deploy/pages');
await mkdir(output, { recursive: true });
await cp(resolve(root, 'web'), output, { recursive: true });
for (const file of ['_worker.js', '_routes.json']) {
  await copyFile(resolve(root, 'infra/cloudflare', file), resolve(output, file));
}
console.log(`Prepared Pages artifact: ${output} (${(await readdir(output)).length} top-level entries). Nothing was published.`);
