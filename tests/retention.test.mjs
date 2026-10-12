import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { openDatabase } from '../server/db.mjs';
import { expireAssets } from '../server/retention.mjs';

let db;
const one=async(sql,args=[]) => (await db.query(sql,args)).rows[0];
const read=id=>one('SELECT * FROM skribbil.object_assets WHERE id=$1',[id]);
async function asset({policy='drawing-original',state='ready',legalHold=false,expiresAt=new Date(Date.now()-86400000)}={}){
  const id=randomUUID();
  return one(`INSERT INTO skribbil.object_assets(id,owner_id,policy_id,storage_backend,bucket,object_key,media_type,bytes,sha256,state,created_at,expires_at,legal_hold)
    VALUES($1,'00000000-0000-4000-8000-000000000001',$2,'local','private',$3,'image/png',23,$4,$5,now()-interval '3 days',$6,$7) RETURNING *`,
  [id,policy,`retention/${id}.png`,'a'.repeat(64),state,expiresAt,legalHold]);
}
before(async()=>{db=await openDatabase({url:null,dataDir:':memory:'});});
after(async()=>{if(db)await db.close();});

test('expired private artwork is durably claimed before its blob is removed',async()=>{
  const original=await asset();const removed=[];
  await expireAssets(db,{remove:async key=>{
    removed.push(key);
    const claimed=await read(original.id);
    assert.equal(claimed.state,'deleting');assert.equal(claimed.deleted_at,null);
    // A competing publication guarded by state=ready can no longer extend retention.
    const publication=await db.query("UPDATE skribbil.object_assets SET expires_at=now()+interval '1 year' WHERE id=$1 AND state='ready' RETURNING id",[original.id]);
    assert.equal(publication.rows.length,0);
  }});
  assert.deepEqual(removed,[original.object_key]);
  assert.equal((await read(original.id)).state,'deleted');
});

test('failed blob deletion remains retryable even after the expiry timestamp changes',async()=>{
  const original=await asset();let calls=0;
  await assert.rejects(expireAssets(db,{remove:async key=>{
    assert.equal(key,original.object_key);calls++;throw new Error('Temporary object-store outage');
  }}),error=>error instanceof AggregateError&&error.errors.some(e=>e.message==='Temporary object-store outage'));
  const failed=await read(original.id);assert.equal(failed.state,'deleting');assert.equal(failed.deleted_at,null);
  await db.query("UPDATE skribbil.object_assets SET expires_at=now()+interval '1 year' WHERE id=$1",[original.id]);
  await expireAssets(db,{remove:async key=>{assert.equal(key,original.object_key);calls++;}});
  assert.equal(calls,2);
  const retried=await read(original.id);assert.equal(retried.state,'deleted');assert.ok(retried.deleted_at);
  assert.ok(new Date(retried.expires_at)>new Date());
});

test('unexpired curated assets, indefinite curation and legal holds remain untouched',async()=>{
  const originals=await Promise.all([
    asset({policy:'curated-art',expiresAt:new Date(Date.now()+86400000)}),
    asset({policy:'curated-art',expiresAt:null}),
    asset({legalHold:true}),
    asset({state:'deleting',legalHold:true}),
  ]);
  const removed=[];await expireAssets(db,{remove:async key=>{removed.push(key);}});
  assert.deepEqual(removed,[]);
  for(const original of originals){
    const unchanged=await read(original.id);
    assert.equal(unchanged.state,original.state);assert.equal(unchanged.deleted_at,null);
    assert.equal(unchanged.legal_hold,original.legal_hold);
    assert.deepEqual(unchanged.expires_at,original.expires_at);
  }
});

test('successful deletion retains audit metadata and is not repeated on subsequent runs',async()=>{
  const original=await asset({policy:'drawing-replay'}),removed=[];
  const store={remove:async key=>{removed.push(key);}};
  const started=Date.now();await expireAssets(db,store);
  const deleted=await read(original.id);
  assert.equal(deleted.state,'deleted');assert.ok(new Date(deleted.deleted_at).getTime()>=started-1000);
  for(const field of ['id','owner_id','policy_id','storage_backend','bucket','object_key','sha256','bytes','created_at','expires_at']){
    assert.deepEqual(deleted[field],original[field],`${field} remains available for retention audits`);
  }
  await expireAssets(db,store);assert.deepEqual(removed,[original.object_key]);
});

test('one failing blob does not prevent later claimed assets from being deleted',async()=>{
  const failing=await asset(),healthy=await asset(),attempted=[];
  await assert.rejects(expireAssets(db,{remove:async key=>{
    attempted.push(key);
    if(key===failing.object_key)throw new Error('This single blob cannot be removed yet');
  }}),error=>error instanceof AggregateError&&error.errors.length===1);
  // UPDATE RETURNING does not promise the subquery's row order.
  assert.deepEqual(attempted.sort(),[failing.object_key,healthy.object_key].sort());
  assert.equal((await read(failing.id)).state,'deleting');
  const successful=await read(healthy.id);
  assert.equal(successful.state,'deleted');assert.ok(successful.deleted_at);
  const retries=[];await expireAssets(db,{remove:async key=>{retries.push(key);}});
  assert.deepEqual(retries,[failing.object_key]);
});
