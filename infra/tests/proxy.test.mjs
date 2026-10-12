import test from 'node:test';
import assert from 'node:assert/strict';
import { proxy } from '../cloudflare/_worker.js';

const env = {
  API_ORIGIN: 'https://preview.onrender.com',
  PUBLIC_ORIGIN: 'https://skribbil.pages.dev',
  SKRIBBIL_ORIGIN_KEY: 'a'.repeat(64),
  ASSETS: { fetch: () => new Response('static') },
};

test('proxy preserves cookies and origin but replaces spoofed forwarding credentials', async () => {
  let forwarded;
  const request = new Request('https://skribbil.pages.dev/api/me', { headers: {
    cookie: 'skribbil_session=test', origin: 'https://skribbil.pages.dev',
    'x-skribbil-origin-key': 'spoof', 'x-forwarded-for': '127.0.0.1',
    'x-forwarded-host': 'evil.test', 'cf-connecting-ip': '203.0.113.1',
  } });
  await proxy(request, env, async r => { forwarded = r; return new Response('{}'); });
  assert.equal(forwarded.url, 'https://preview.onrender.com/api/me');
  assert.equal(forwarded.headers.get('cookie'), 'skribbil_session=test');
  assert.equal(forwarded.headers.get('origin'), env.PUBLIC_ORIGIN);
  assert.equal(forwarded.headers.get('x-skribbil-origin-key'), env.SKRIBBIL_ORIGIN_KEY);
  assert.equal(forwarded.headers.get('x-forwarded-for'), '203.0.113.1');
  assert.equal(forwarded.headers.get('x-forwarded-host'), 'skribbil.pages.dev');
});

test('loopback event ingestion and internal engine room creation are not public routes', async () => {
  for (const path of ['/api/internal/engine-events', '/engine/internal/rooms', '/engine/%69nternal/rooms']) {
    const response = await proxy(new Request(`${env.PUBLIC_ORIGIN}${path}`), env,
      async () => { throw new Error('internal endpoint was forwarded'); });
    assert.equal(response.status, 404);
  }
});

test('redirects remain on Pages and response cookies survive', async () => {
  const response = await proxy(new Request(`${env.PUBLIC_ORIGIN}/engine/league/join?ticket=test`), env,
    async () => new Response(null, { status: 303, headers: {
      Location: 'https://preview.onrender.com/engine/lobby/league-test',
      'Set-Cookie': 'usersession=test; Path=/; HttpOnly; Secure',
    } }));
  assert.equal(response.headers.get('Location'), `${env.PUBLIC_ORIGIN}/engine/lobby/league-test`);
  assert.match(response.headers.get('Set-Cookie'), /usersession=test/);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
});

test('websocket responses pass through without reconstruction or protocol handling', async () => {
  const upgradeResponse = { status: 101, webSocket: {} };
  const response = await proxy(new Request(`${env.PUBLIC_ORIGIN}/engine/v1/lobby/abc/ws`,
    { headers: { Upgrade: 'websocket' } }), env, async () => upgradeResponse);
  assert.equal(response, upgradeResponse);
});

test('unconfigured or preview origins fail closed while static assets remain available', async () => {
  assert.equal((await proxy(new Request(`${env.PUBLIC_ORIGIN}/api/me`), {})).status, 503);
  assert.equal((await proxy(new Request('https://other.pages.dev/api/me'), env)).status, 503);
  assert.equal(await (await proxy(new Request(`${env.PUBLIC_ORIGIN}/app.js`), env)).text(), 'static');
});
