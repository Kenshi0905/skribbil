import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import { AssetStore } from '../server/assets.mjs';

test('compatible S3 requests preserve payloads and signing without optional AWS checksum extensions',async()=>{
  // These credentials are randomly generated for the SDK's local signer. The
  // custom transport below performs no network I/O and never logs signatures.
  process.env.S3_ENDPOINT='https://storage.example.invalid/storage/v1/s3';
  process.env.S3_REGION='ap-south-1';
  process.env.S3_ACCESS_KEY_ID=randomBytes(16).toString('hex');
  process.env.S3_SECRET_ACCESS_KEY=randomBytes(32).toString('hex');
  const store=new AssetStore({bucket:'test-private'}),client=await store.client(),requests=[];
  client.config.requestHandler={
    async handle(request){
      requests.push(request);
      return {response:{statusCode:request.method==='DELETE'?204:200,headers:{etag:'"test-object"'},body:Readable.from([])}};
    },
    destroy(){},
  };
  try{
    const key=`${randomUUID()}/image.png`,bytes=randomBytes(1024);
    const metadata=await store.put(key,bytes,'image/png');
    assert.equal(requests.length,1);
    const upload=requests[0];
    assert.equal(upload.method,'PUT');
    assert.equal(upload.hostname,'storage.example.invalid');
    assert.equal(upload.path,`/storage/v1/s3/test-private/${key}`);
    assert.deepEqual(Buffer.from(upload.body),bytes);
    assert.equal(upload.headers['content-type'],'image/png');
    assert.match(upload.headers.authorization,/^AWS4-HMAC-SHA256 /);
    for(const header of Object.keys(upload.headers))assert.ok(!/checksum|trailer/i.test(header),`unexpected optional extension ${header}`);
    assert.ok(!String(upload.headers['content-encoding']||'').includes('aws-chunked'));
    assert.equal(metadata.sha256,createHash('sha256').update(bytes).digest('hex'));
    assert.equal(metadata.bytes,bytes.length);

    const download=new URL((await store.get(key)).url);
    assert.equal(download.origin,'https://storage.example.invalid');
    assert.equal(download.pathname,`/storage/v1/s3/test-private/${key}`);
    assert.equal(download.searchParams.get('X-Amz-Expires'),'60');
    assert.equal(download.searchParams.get('X-Amz-Algorithm'),'AWS4-HMAC-SHA256');
    assert.ok(download.searchParams.has('X-Amz-Signature'));
    for(const parameter of download.searchParams.keys())assert.ok(!/checksum/i.test(parameter),`unexpected optional extension ${parameter}`);
    assert.equal(requests.length,1,'presigning must not fetch the private object');

    await store.remove(key);
    assert.equal(requests.length,2);
    assert.equal(requests[1].method,'DELETE');
    assert.equal(requests[1].path,upload.path);
    assert.match(requests[1].headers.authorization,/^AWS4-HMAC-SHA256 /);
  }finally{
    client.destroy();
    for(const name of ['S3_ENDPOINT','S3_REGION','S3_ACCESS_KEY_ID','S3_SECRET_ACCESS_KEY'])delete process.env[name];
  }
});
