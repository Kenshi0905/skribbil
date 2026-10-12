// Claim an expired object before touching its blob. Gallery publication must
// lock the same metadata row and require state=ready, so it cannot rescue a
// blob after deletion has begun. Failed deletions remain retryable.
export async function expireAssets(db, assets) {
  const claimed=await db.transaction(async tx=>(await tx.query(`UPDATE skribbil.object_assets SET state='deleting'
    WHERE id IN (SELECT id FROM skribbil.object_assets WHERE NOT legal_hold
      AND ((state='ready' AND expires_at<now()) OR state='deleting')
      ORDER BY created_at LIMIT 20 FOR UPDATE SKIP LOCKED) RETURNING id,object_key`)).rows);
  const failures=[];
  for(const asset of claimed){
    try {
      await assets.remove(asset.object_key);
      await db.query(`UPDATE skribbil.object_assets SET state='deleted',deleted_at=now() WHERE id=$1 AND state='deleting'`,[asset.id]);
    } catch(error) { failures.push(error); }
  }
  if(failures.length)throw new AggregateError(failures,'One or more retained asset deletions failed.');
}
