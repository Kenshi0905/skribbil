import { randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
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
  return {secret,production,port:Number(process.env.PORT||3000),host:process.env.HOST||'127.0.0.1',
    engineUrl:process.env.ENGINE_URL||'http://127.0.0.1:8080',origin:process.env.PUBLIC_ORIGIN||'http://localhost:3000',
    secure:process.env.COOKIE_SECURE==='true',originKey:process.env.SKRIBBIL_ORIGIN_KEY,
    ranked:process.env.SKRIBBIL_RANKED_ENABLED==='true'};
}
