import test from 'node:test';
import assert from 'node:assert/strict';
import { deployRender } from '../deploy-render.mjs';
const revision='a'.repeat(40);
const hook='https://api.render.com/deploy/srv-db6if1g473hc739rmhb0?key=test-only';

test('deploy pins a revision and waits past the old healthy release',async()=>{
  let calls=0,pauses=0;
  await deployRender({hook,revision,pause:async()=>{pauses++;},request:async(url,options)=>{
    calls++;
    if(calls===1){assert.equal(url.searchParams.get('ref'),revision);assert.equal(options.method,'POST');return new Response('{}');}
    return Response.json({ok:true,revision:calls===2?'b'.repeat(40):revision});
  }});
  assert.equal(calls,3);assert.equal(pauses,1);
});
test('wrong service and invalid commit are rejected before transmission',async()=>{
  const request=()=>{throw new Error('Must not fetch');};
  await assert.rejects(deployRender({hook:hook.replace('api.render.com','example.com'),revision,request}),/destination/);
  await assert.rejects(deployRender({hook,revision:'main',request}),/full Git/);
});
test('failures cannot expose hook secrets and stale health times out',async()=>{
  await assert.rejects(deployRender({hook,revision,request:async()=>{throw new Error(hook);}}),/^Error: Could not contact Render deployment endpoint\.$/);
  let calls=0;
  await assert.rejects(deployRender({hook,revision,attempts:2,pause:async()=>{},request:async()=>{
    calls++;return calls===1?new Response('{}'):Response.json({ok:true,revision:'b'.repeat(40)});
  }}),/Pages was not published/);
});
