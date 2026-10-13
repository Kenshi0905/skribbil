import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { openDatabase } from '../server/db.mjs';
import { createApp } from '../server/index.mjs';

test('friend responses require recipient consent and preserve friendship state through HTTP', { timeout: 60000 }, async t => {
  const db = await openDatabase({ url: '', dataDir: ':memory:', production: false, caCert: '' });
  const app = await createApp({ db, assets: {}, config: {
    secret: randomBytes(32).toString('hex'), origin: '', engineUrl: 'http://127.0.0.1:1', secure: false, ranked: false, production: false,
  } });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  const base = 'http://127.0.0.1:' + app.server.address().port; app.config.origin = base;
  const call = async (route, body, user, headers = {}) => {
    const response = await fetch(base + route, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'Skribbil', Origin: base,
        ...(user ? { Cookie: user.cookie } : {}), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: response.status, data: await response.json(), cookie: response.headers.getSetCookie()[0]?.split(';')[0] };
  };
  const add = (from, to) => call('/api/friends', { username: to.username }, from);
  const respond = (recipient, other, action, headers) => call('/api/friends/' + other.id + '/respond', { action }, recipient, headers);
  const state = async (a, b) => (await db.query('SELECT * FROM skribbil.friendships WHERE user_low=$1 AND user_high=$2', [a.id, b.id].sort())).rows[0];
  const visible = async user => {
    const response = await call('/api/bootstrap', undefined, user); assert.equal(response.status, 200);
    return response.data.friends;
  };
  try {
    const users = [];
    for (let i = 0; i < 4; i++) {
      const username = 'friends_http_' + i;
      const response = await call('/api/auth/register', { username, email: username + '@example.test', password: randomBytes(24).toString('base64url') });
      assert.equal(response.status, 200); users.push({ id: response.data.user.id, username, cookie: response.cookie });
    }
    const [sender, recipient, outsider, fourth] = users;

    await t.test('authentication, CSRF, UUID/action validation, and sender/outsider denial precede mutation', async () => {
      assert.equal((await add(sender, recipient)).status, 200);
      assert.equal((await call('/api/friends/' + sender.id + '/respond', { action: 'accept' })).status, 401);
      assert.equal((await respond(recipient, sender, 'accept', { Origin: 'https://untrusted.example' })).status, 403);
      assert.equal((await respond(recipient, sender, 'accept', { 'X-Requested-With': '' })).status, 403);
      assert.equal((await call('/api/friends/not-a-uuid/respond', { action: 'accept' }, recipient)).status, 400);
      assert.equal((await respond(recipient, recipient, 'accept')).status, 400);
      for (const action of ['accepted', 'block', '', null, true]) assert.equal((await respond(recipient, sender, action)).status, 400);
      assert.equal((await respond(sender, recipient, 'accept')).status, 403);
      assert.equal((await respond(sender, recipient, 'decline')).status, 403);
      assert.equal((await respond(outsider, sender, 'accept')).status, 404);
      assert.equal((await respond(outsider, recipient, 'decline')).status, 404);
      assert.equal((await state(sender, recipient)).status, 'pending');
      const outgoing = (await visible(sender)).find(f => f.id === recipient.id);
      const incoming = (await visible(recipient)).find(f => f.id === sender.id);
      assert.equal(outgoing.status, 'pending'); assert.equal(outgoing.outgoing, true);
      assert.equal(incoming.status, 'pending'); assert.equal(incoming.outgoing, false);
      assert.equal((await visible(outsider)).length, 0);
    });

    await t.test('recipient accepts with idempotent retries; sender or later decline cannot undo accepted friendship', async () => {
      // PGlite serializes transactions. This checks HTTP state behavior, while
      // production PostgreSQL relies on the explicit friendship FOR UPDATE lock.
      const results = await Promise.all([respond(recipient, sender, 'accept'), respond(recipient, sender, 'accept')]);
      assert.ok(results.every(r => r.status === 200)); results.forEach(r => assert.deepEqual(r.data, { ok: true }));
      const accepted = await state(sender, recipient); assert.equal(accepted.status, 'accepted');
      assert.equal((await respond(recipient, { id: sender.id.toUpperCase() }, 'accept')).status, 200);
      assert.equal((await respond(sender, recipient, 'accept')).status, 403);
      assert.equal((await respond(recipient, sender, 'decline')).status, 409);
      assert.equal((await add(sender, recipient)).status, 200);
      const stillAccepted = await state(sender, recipient);
      assert.equal(stillAccepted.status, 'accepted'); assert.equal(stillAccepted.requested_by, sender.id);
      assert.equal(new Date(stillAccepted.updated_at).getTime(), new Date(accepted.updated_at).getTime());
      for (const [viewer, other] of [[sender, recipient], [recipient, sender]]) assert.equal((await visible(viewer)).find(f => f.id === other.id).status, 'accepted');
    });

    await t.test('profiles are limited to accepted friends and return community fields only', async () => {
      const route='/api/friends/'+recipient.id+'/profile';
      assert.equal((await call(route)).status,401);
      assert.equal((await call(route,undefined,outsider)).status,404);
      assert.equal((await call('/api/friends/invalid/profile',undefined,sender)).status,400);
      const response=await call(route,undefined,sender);
      assert.equal(response.status,200);assert.equal(response.data.profile.id,recipient.id);
      assert.equal(response.data.profile.username,recipient.username);
      assert.equal(response.data.profile.gamesPlayed,0);
      for(const field of ['email','isAdmin','inventory','history','password','credentials']) assert.equal(field in response.data.profile,false);
      await add(sender,fourth);
      assert.equal((await call('/api/friends/'+fourth.id+'/profile',undefined,sender)).status,404);
      assert.equal((await call('/api/friends/'+sender.id+'/profile',undefined,recipient)).status,200);
      await db.query("UPDATE skribbil.users SET status='suspended' WHERE id=$1",[recipient.id]);
      assert.equal((await call(route,undefined,sender)).status,404);
      await db.query("UPDATE skribbil.users SET status='active' WHERE id=$1",[recipient.id]);
    });

    await t.test('decline disappears from both lists and cannot be reopened by repeated sender requests', async () => {
      assert.equal((await add(sender, outsider)).status, 200);
      assert.equal((await respond(outsider, sender, 'decline')).status, 200);
      assert.equal((await respond(outsider, sender, 'decline')).status, 200);
      assert.equal((await state(sender, outsider)).status, 'declined');
      assert.equal((await visible(sender)).some(f => f.id === outsider.id), false);
      assert.equal((await visible(outsider)).some(f => f.id === sender.id), false);
      assert.equal((await add(sender, outsider)).status, 409);
      assert.equal((await respond(sender, outsider, 'accept')).status, 403);
      assert.equal((await respond(outsider, sender, 'accept')).status, 409);
      assert.equal((await state(sender, outsider)).status, 'declined');
    });

    await t.test('only the declining recipient can initiate a fresh request with the consent direction reversed', async () => {
      assert.equal((await add(outsider, sender)).status, 200);
      const reopened = await state(sender, outsider);
      assert.equal(reopened.status, 'pending'); assert.equal(reopened.requested_by, outsider.id);
      assert.equal((await visible(sender)).find(f => f.id === outsider.id).outgoing, false);
      assert.equal((await visible(outsider)).find(f => f.id === sender.id).outgoing, true);
      assert.equal((await respond(outsider, sender, 'accept')).status, 403);
      assert.equal((await respond(outsider, sender, 'decline')).status, 403);
      assert.equal((await respond(sender, outsider, 'accept')).status, 200);
      assert.equal((await state(sender, outsider)).status, 'accepted');
    });

    await t.test('reciprocal Add Friend still accepts requests and concurrent first requests share one accepted pair', async () => {
      assert.equal((await add(sender, fourth)).status, 200);
      assert.equal((await add(fourth, sender)).status, 200);
      assert.equal((await state(sender, fourth)).status, 'accepted');
      assert.equal((await respond(fourth, sender, 'accept')).status, 200);
      const results = await Promise.all([add(recipient, fourth), add(fourth, recipient)]);
      assert.ok(results.every(r => r.status === 200));
      assert.equal((await state(recipient, fourth)).status, 'accepted');
      assert.equal(Number((await db.query('SELECT count(*) AS n FROM skribbil.friendships WHERE user_low=$1 AND user_high=$2', [recipient.id, fourth.id].sort())).rows[0].n), 1);
    });

    await t.test('opposite recipient decisions cannot overwrite each other, and blocked pairs stay blocked', async () => {
      assert.equal((await add(recipient, outsider)).status, 200);
      const decisions = await Promise.all([respond(outsider, recipient, 'accept'), respond(outsider, recipient, 'decline')]);
      assert.deepEqual(decisions.map(r => r.status).sort(), [200, 409]);
      const settled = (await state(recipient, outsider)).status;
      assert.ok(['accepted', 'declined'].includes(settled));
      assert.equal((await respond(outsider, recipient, settled === 'accepted' ? 'decline' : 'accept')).status, 409);
      assert.equal((await state(recipient, outsider)).status, settled);
      assert.equal((await add(fourth, outsider)).status, 200);
      await db.query("UPDATE skribbil.friendships SET status='blocked' WHERE user_low=$1 AND user_high=$2", [fourth.id, outsider.id].sort());
      assert.equal((await respond(outsider, fourth, 'accept')).status, 409);
      assert.equal((await respond(outsider, fourth, 'decline')).status, 409);
      assert.equal((await add(outsider, fourth)).status, 409);
      assert.equal((await state(fourth, outsider)).status, 'blocked');
    });
  } finally { await app.close(); }
});
