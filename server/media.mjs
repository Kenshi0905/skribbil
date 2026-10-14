import { randomUUID } from 'node:crypto';
import { Worker } from 'node:worker_threads';
import {inspectImage,IMAGE_MAX_BYTES} from '../web/image-file.js';
import { ApiError, requireValue, isUuid } from './security.mjs';

const one = async (db, sql, values = []) => (await db.query(sql, values)).rows[0];
let active = 0;
export function validateImage(image) {
  requireValue(typeof image==='string'&&image.length<=Math.ceil(IMAGE_MAX_BYTES/3)*4,'Image exceeds 8 MiB. Choose a smaller photo.');
  requireValue(image.length%4===0&&/^[A-Za-z0-9+/]*={0,2}$/.test(image),'This image is unreadable or corrupt.');
  const bytes=Buffer.from(image,'base64');
  requireValue(bytes.toString('base64')===image,'This image is unreadable or corrupt.');
  try{inspectImage(bytes);}catch(error){throw new ApiError(400,error.message);}
  return bytes;
}
export function validatePng(image){const bytes=validateImage(image);requireValue(inspectImage(bytes).format==='png','Choose a valid PNG image.');return bytes;}
export async function normalizePng(png) {
  return normalizeImage(png, validatePng);
}
export async function normalizeImage(image, validate = validateImage) {
  const bytes = validate(image);
  requireValue(active < 2, 'Image uploads are busy. Please retry shortly.', 503);
  active++;
  return new Promise((resolve,reject) => {
    const worker = new Worker(new URL('./media-worker.mjs', import.meta.url), {resourceLimits:{maxOldGenerationSizeMb:96}});
    let settled = false;
    const finish = (error, result) => {
      if (settled) return; settled = true; clearTimeout(timer);
      worker.terminate().catch(()=>{}).finally(() => { active--; });
      if (error) reject(error); else resolve(Buffer.from(result));
    };
    const timer = setTimeout(() => finish(new ApiError(400,'Image could not be processed within the time limit.')),15000);
    worker.on('message', result => finish(result.error ? new ApiError(400,result.error) : null,result.bytes));
    worker.on('error', () => finish(new ApiError(400,'Image could not be processed.')));
    worker.on('exit', () => { if (!settled) finish(new ApiError(400,'Image could not be processed.')); });
    worker.postMessage(bytes);
  });
}

export class Media {
  constructor(platform, assets) { this.db = platform.db; this.assets = assets; }
  async target(db, user, teamId, lock = false) {
    if (teamId) {
      requireValue(isUuid(teamId), 'Invalid team.');
      const row = await one(db,`SELECT * FROM skribbil.teams WHERE id=$1 AND archived_at IS NULL${lock?' FOR UPDATE':''}`,[teamId]);
      requireValue(row && row.captain_id === user.id, 'Only the team captain can change its logo.',403);
      return {row,table:'teams',column:'logo_url',id:teamId};
    }
    const row = await one(db,`SELECT * FROM skribbil.users WHERE id=$1${lock?' FOR NO KEY UPDATE':''}`,[user.id]);
    requireValue(row?.status === 'active','This account is unavailable.',403);
    return {row,table:'users',column:'avatar_url',id:user.id};
  }
  async expireOld(db, url) {
    const id = url?.match(/^\/api\/media\/([a-f0-9-]+)$/)?.[1];
    if (id) await db.query(`UPDATE skribbil.object_assets SET expires_at=now()+interval '1 day' WHERE id=$1 AND policy_id='profile-image'`,[id]);
  }
  async upload(user, input, teamId = null) {
    await this.target(this.db,user,teamId);
    const bytes = await normalizeImage(input.image ?? input.png), id = randomUUID();
    const uploaded = await this.assets.put(`${id}/image.png`,bytes,'image/png');
    try {
      return await this.db.transaction(async db => {
        // One quota for all profile/team uploads, serialized on the uploader.
        await db.query('SELECT id FROM skribbil.users WHERE id=$1 FOR NO KEY UPDATE',[user.id]);
        const target = await this.target(db,user,teamId,true);
        const usage = await one(db,`SELECT count(*) AS n FROM skribbil.object_assets WHERE owner_id=$1 AND policy_id='profile-image' AND created_at>now()-interval '1 day'`,[user.id]);
        requireValue(Number(usage.n) < 10,'You can upload up to 10 profile or team images per day.',429);
        await db.query(`INSERT INTO skribbil.object_assets(id,owner_id,policy_id,storage_backend,bucket,object_key,media_type,bytes,sha256,state)
          VALUES($1,$2,'profile-image',$3,$4,$5,$6,$7,$8,'ready')`,[id,user.id,uploaded.backend,uploaded.bucket,uploaded.key,uploaded.mediaType,uploaded.bytes,uploaded.sha256]);
        const url = `/api/media/${id}`;
        await db.query(`UPDATE skribbil.${target.table} SET ${target.column}=$2 WHERE id=$1`,[target.id,url]);
        await this.expireOld(db,target.row[target.column]);
        return {url};
      });
    } catch (error) { await this.assets.remove(uploaded.key).catch(()=>{}); throw error; }
  }
  async remove(user, teamId = null) {
    return this.db.transaction(async db => {
      const target = await this.target(db,user,teamId,true);
      await db.query(`UPDATE skribbil.${target.table} SET ${target.column}=NULL WHERE id=$1`,[target.id]);
      await this.expireOld(db,target.row[target.column]);
      return {ok:true};
    });
  }
  async read(id) {
    requireValue(isUuid(id),'Invalid image.');
    const row = await one(this.db,`SELECT a.object_key FROM skribbil.object_assets a WHERE a.id=$1 AND a.policy_id='profile-image' AND a.state='ready'
      AND (EXISTS(SELECT 1 FROM skribbil.users u WHERE u.avatar_url='/api/media/'||a.id AND u.status='active')
      OR EXISTS(SELECT 1 FROM skribbil.teams t WHERE t.logo_url='/api/media/'||a.id AND t.archived_at IS NULL))`,[id]);
    requireValue(row,'Image is unavailable.',404);
    return this.assets.get(row.object_key);
  }
}
