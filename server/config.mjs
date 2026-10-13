import { randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { postgresOptions } from './db.mjs';
try { process.loadEnvFile?.('.env'); } catch(e) { if(e.code!=='ENOENT')throw e; }
export async function loadConfig() {
  const production=process.env.NODE_ENV==='production';
  let secret=process.env.SKRIBBIL_ENGINE_SECRET;
  if(!secret&&!production) {
    await mkdir('.data',{recursive:true});
    try{secret=(await readFile('.data/dev-secret','utf8')).trim();}
    catch(e){if(e.code!=='ENOENT')throw e;secret=randomBytes(32).toString('hex');await writeFile('.data/dev-secret',secret,{mode:0o600});}
  }
  if(!secret||secret.length<32)throw new Error('SKRIBBIL_ENGINE_SECRET must contain at least 32 characters.');
  if(production&&(!process.env.DATABASE_URL||!process.env.S3_BUCKET||process.env.COOKIE_SECURE!=='true'||!process.env.PUBLIC_ORIGIN?.startsWith('https://')))
    throw new Error('Production requires external DATABASE_URL, private S3_BUCKET, COOKIE_SECURE=true and HTTPS PUBLIC_ORIGIN.');
  if(production){
    postgresOptions({url:process.env.DATABASE_URL,production,caCert:process.env.DATABASE_CA_CERT});
    const origin=new URL(process.env.PUBLIC_ORIGIN);
    if(origin.origin!==process.env.PUBLIC_ORIGIN)throw new Error('PUBLIC_ORIGIN must be an exact HTTPS origin without a path or trailing slash.');
    if(!process.env.SKRIBBIL_ORIGIN_KEY||process.env.SKRIBBIL_ORIGIN_KEY.length<32||process.env.SKRIBBIL_ORIGIN_KEY===secret)
      throw new Error('Production needs a separate SKRIBBIL_ORIGIN_KEY of at least 32 characters.');
    const engine=new URL(process.env.ENGINE_URL||'http://127.0.0.1:8080');
    if(!['127.0.0.1','localhost','[::1]'].includes(engine.hostname))throw new Error('The production engine must listen on loopback.');
  }
  const revision=/^[a-f0-9]{40}$/.test(process.env.RENDER_GIT_COMMIT||'')?process.env.RENDER_GIT_COMMIT:null;
  return {secret,production,revision,port:Number(process.env.PORT||3000),host:process.env.HOST||'127.0.0.1',
    engineUrl:process.env.ENGINE_URL||'http://127.0.0.1:8080',origin:process.env.PUBLIC_ORIGIN||'http://localhost:3000',
    secure:process.env.COOKIE_SECURE==='true',originKey:process.env.SKRIBBIL_ORIGIN_KEY,
    ranked:process.env.SKRIBBIL_RANKED_ENABLED==='true'};
}
