import { mkdir, writeFile, readFile, unlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { gzipSync } from 'node:zlib';
import { hash } from './security.mjs';
import { Worker } from 'node:worker_threads';

// Matches the original engine's 26-color palette. Render final canonical operations,
// including flood fill, rather than accepting a client-provided image.
export const PALETTE = ['#ffffff','#c1c1c1','#ef130b','#ff7100','#ffe400','#00cc00','#00b2ff','#231fd3','#a300ba','#d37caa','#a0522d','#592f2a','#ecbcb4','#000000','#4c4c4c','#740b07','#c23800','#e8a200','#005510','#00569e','#0e0865','#550069','#a75574','#63300d','#492f31','#d1a3a4'];
const renderQueue = [];
let activeRenders = 0;
function pumpRenderQueue() {
  while (activeRenders < 2 && renderQueue.length) {
    const job = renderQueue.shift(); activeRenders++;
    const worker = new Worker(new URL('./render-worker.mjs', import.meta.url), { resourceLimits: { maxOldGenerationSizeMb: 128 } });
    let settled = false;
    const finish = (error, bytes) => {
      if (settled) return; settled = true; clearTimeout(timer);
      worker.terminate().finally(() => { activeRenders--; pumpRenderQueue(); });
      if (error) job.reject(error); else job.resolve(Buffer.from(bytes));
    };
    const timer = setTimeout(() => finish(new Error('Drawing render exceeded 15-second budget')), 15000);
    worker.on('message', result => finish(result.error ? new Error(result.error) : null, result.bytes));
    worker.on('error', error => finish(error));
    worker.on('exit', code => { if (!settled) finish(new Error('Drawing renderer exited with code ' + code)); });
    worker.postMessage(job.operations);
  }
}
export function renderDrawing(operations) {
  if (!Array.isArray(operations) || operations.length > 20000) return Promise.reject(new Error('Drawing operation limit exceeded'));
  if (renderQueue.length >= 32) return Promise.reject(new Error('Drawing renderer is busy; retry later'));
  return new Promise((resolve, reject) => { renderQueue.push({ operations, resolve, reject }); pumpRenderQueue(); });
}
export class AssetStore {
  constructor({root=process.env.ASSET_DIR||'.data/assets',bucket=process.env.S3_BUCKET}={}) { this.root=resolve(root);this.bucket=bucket||'local-private';this.backend=bucket?'s3':'local'; }
  async client() {
    if(!this.s3) { const {S3Client}=await import('@aws-sdk/client-s3');this.s3=new S3Client({region:process.env.S3_REGION||'us-east-1',endpoint:process.env.S3_ENDPOINT,forcePathStyle:true,
      credentials:process.env.S3_ACCESS_KEY_ID?{accessKeyId:process.env.S3_ACCESS_KEY_ID,secretAccessKey:process.env.S3_SECRET_ACCESS_KEY}:undefined}); }
    return this.s3;
  }
  path(key) { if(!/^[a-f0-9-]+\/(image\.png|replay\.json\.gz)$/.test(key))throw new Error('Invalid asset key'); return join(this.root,key); }
  async put(key,bytes,mediaType) {
    if(this.backend==='local') { const path=this.path(key);await mkdir(resolve(path,'..'),{recursive:true});await writeFile(path,bytes); }
    else { const {PutObjectCommand}=await import('@aws-sdk/client-s3');await (await this.client()).send(new PutObjectCommand({Bucket:this.bucket,Key:key,Body:bytes,ContentType:mediaType})); }
    return {key,bytes:bytes.length,sha256:hash(bytes),mediaType,backend:this.backend,bucket:this.bucket};
  }
  async get(key) {
    if(this.backend==='local')return {body:await readFile(this.path(key))};
    const {GetObjectCommand}=await import('@aws-sdk/client-s3');const {getSignedUrl}=await import('@aws-sdk/s3-request-presigner');
    return {url:await getSignedUrl(await this.client(),new GetObjectCommand({Bucket:this.bucket,Key:key}),{expiresIn:60})};
  }
  async remove(key) {
    if(this.backend==='local')await unlink(this.path(key)).catch(e=>{if(e.code!=='ENOENT')throw e;});
    else {const {DeleteObjectCommand}=await import('@aws-sdk/client-s3');await(await this.client()).send(new DeleteObjectCommand({Bucket:this.bucket,Key:key}));}
  }
  async archive(turnId,ops) {
    const image=await renderDrawing(ops);
    const replay=gzipSync(Buffer.from(JSON.stringify({version:1,kind:'canonical-operations',width:1600,height:900,operations:ops})));
    return {image:await this.put(`${turnId}/image.png`,image,'image/png'),replay:await this.put(`${turnId}/replay.json.gz`,replay,'application/gzip')};
  }
}
