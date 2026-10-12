import { randomBytes } from 'node:crypto';
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID, createHmac } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { createApp } from '../server/index.mjs';
import { openDatabase } from '../server/db.mjs';
import { AssetStore, PALETTE, renderDrawing } from '../server/assets.mjs';
import { loadImage, createCanvas } from '@napi-rs/canvas';

const secret = randomBytes(32).toString('hex');
const password = randomBytes(24).toString('base64url');
const listen = server => new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${server.address().port}`)));
const close = server => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); });

test('platform HTTP integration: accounts, consent, authoritative results and admission', { timeout: 120000 }, async t => {
  const db = await openDatabase({ dataDir: ':memory:', url: '' });
  const dir = await mkdtemp(join(tmpdir(), 'skribbil-assets-'));
  const assets = new AssetStore({ root: dir, bucket: '' });
  const controlRequests = [];
  // A local control-plane fixture verifies the wrapper contract. Real engine
  // websocket drawing/guessing is exercised by engine/internal/api/*socket_test.go.
  const engine = http.createServer(async (req, res) => {
    if (req.method === 'GET') { res.end('Skribbil engine fixture'); return; }
    assert.equal(req.headers.authorization, `Bearer ${secret}`);
    const parts = []; for await (const p of req) parts.push(p);
    const body = JSON.parse(Buffer.concat(parts).toString());
    controlRequests.push({ path: req.url, body });
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(req.url.endsWith('/cancel') ? { cancelled: true } : req.url.endsWith('/status') ? {exists:true} : { lobbyId: `fixture-${body.matchId}` }));
  });
  const engineUrl = await listen(engine);
  const config = { secret, engineUrl, origin: '', secure: false, ranked: false, production: false };
  const app = await createApp({ db, config, assets });
  const base = await listen(app.server); config.origin = base;
  const api = async (path, { method = 'GET', body, cookie, headers = {} } = {}) => {
    const response = await fetch(base + path, {
      method,
      headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json', 'X-Requested-With': 'Skribbil' }), ...(cookie ? { Cookie: cookie } : {}), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: 'manual',
    });
    const data = response.headers.get('content-type')?.includes('application/json') ? await response.json() : Buffer.from(await response.arrayBuffer());
    return { status: response.status, data, headers: response.headers, cookie: response.headers.get('set-cookie')?.split(';')[0] };
  };
  let artist, guesser, room, turnId, drawingId;
  const publish = async event => {
    const raw = JSON.stringify(event);
    return api('/api/internal/engine-events', { method: 'POST', body: event, headers: { 'X-Skribbil-Signature': createHmac('sha256', secret).update(raw).digest('hex') } });
  };
  const event = (type, sequence, payload) => ({ eventId: randomUUID(), sequence, type, matchId: room.data.matchId, lobbyId: `fixture-${room.data.matchId}`, occurredAt: new Date().toISOString(), payload });
  try {
    await t.test('registration stores a hashed credential and private cookie; unauthenticated mutations fail', async () => {
      assert.equal((await api('/api/me')).data.user, null);
      assert.equal((await api('/api/teams', { method: 'POST', body: { name: 'No access', tag: 'NO' } })).status, 401);
      artist = await api('/api/auth/register', { method: 'POST', body: { username: 'test_artist', email: 'artist@example.test', password } });
      guesser = await api('/api/auth/register', { method: 'POST', body: { username: 'test_guesser', email: 'guesser@example.test', password } });
      assert.equal(artist.status, 200, JSON.stringify(artist.data)); assert.equal(guesser.status, 200, JSON.stringify(guesser.data));
      assert.match(artist.headers.get('set-cookie'), /HttpOnly/); assert.match(artist.headers.get('set-cookie'), /SameSite=Lax/);
      assert.equal(artist.data.user.isAdmin, false); assert.equal(artist.data.user.title, 'Rookie');
      const stored = (await db.query('SELECT password_hash FROM skribbil.credentials WHERE user_id=$1', [artist.data.user.id])).rows[0];
      assert.match(stored.password_hash, /^scrypt:/); assert.ok(!stored.password_hash.includes(password));
      assert.equal((await api('/api/auth/register', { method: 'POST', body: { username: 'TEST_ARTIST', email: 'another@example.test', password } })).status, 409);
      assert.equal((await api('/api/auth/login', { method: 'POST', body: { email: 'test_artist', password: randomBytes(24).toString('base64url') } })).status, 401);
    });

    await t.test('CSRF, cosmetic ownership and admin authorization survive forged client fields', async () => {
      assert.equal((await api('/api/profile', { method: 'PATCH', cookie: artist.cookie, body: { displayName: 'Forged' }, headers: { Origin: 'https://attacker.example' } })).status, 403);
      assert.equal((await api('/api/profile', { method: 'PATCH', cookie: artist.cookie, body: { displayName: 'Forged' }, headers: { 'X-Requested-With': '' } })).status, 403);
      const saved = await api('/api/profile', { method: 'PATCH', cookie: artist.cookie, body: { displayName: 'Pencil Captain', bio: 'Draw, guess, repeat.', avatarColor: '#ffcc55', isAdmin: true, xp: 999999 } });
      assert.equal(saved.status, 200); assert.equal(saved.data.user.displayName, 'Pencil Captain'); assert.equal(saved.data.user.xp, 0); assert.equal(saved.data.user.isAdmin, false);
      assert.equal((await api('/api/profile', { method: 'PATCH', cookie: artist.cookie, body: { title: 'Nonexistent Champion' } })).status, 400);
      assert.equal((await api('/api/admin', { cookie: artist.cookie })).status, 403);
      assert.equal((await api('/api/admin/bans', { method: 'POST', cookie: artist.cookie, body: { userId: guesser.data.user.id, reason: 'Forged request' } })).status, 403);
    });

    await t.test('teams persist and friendships require the recipient to accept', async () => {
      const team = await api('/api/teams', { method: 'POST', cookie: artist.cookie, body: { name: 'Pencil Pirates', tag: 'INK' } });
      assert.equal(team.status, 201, JSON.stringify(team.data));
      assert.equal((await api('/api/friends', { method: 'POST', cookie: artist.cookie, body: { username: 'test_guesser' } })).status, 200);
      let friends = (await api('/api/bootstrap', { cookie: guesser.cookie })).data.friends;
      assert.equal(friends[0].status, 'pending'); assert.equal(friends[0].outgoing, false);
      assert.equal((await api('/api/friends', { method: 'POST', cookie: guesser.cookie, body: { username: 'test_artist' } })).status, 200);
      friends = (await api('/api/bootstrap', { cookie: artist.cookie })).data.friends;
      assert.equal(friends[0].status, 'accepted');
      assert.equal((await db.query('SELECT count(*)::int AS n FROM skribbil.friendships')).rows[0].n, 1);
    });

    await t.test('private admission signs identity and rules; ranked stays gated', async () => {
      assert.equal((await api('/api/rooms', { method: 'POST', cookie: artist.cookie, body: { mode: 'ranked' } })).status, 503);
      room = await api('/api/rooms', { method: 'POST', cookie: artist.cookie, body: { mode: 'private', rounds: 2, drawTime: 90, maxPlayers: 4 } });
      assert.equal(room.status, 201, JSON.stringify(room.data));
      const token = new URL(room.data.url, base).searchParams.get('ticket');
      const [encoded, signature] = token.split('.'); const payload = JSON.parse(Buffer.from(encoded, 'base64url'));
      assert.equal(signature, createHmac('sha256', secret).update(encoded).digest('base64url'));
      assert.equal(payload.userId, artist.data.user.id); assert.equal(payload.username, 'Pencil Captain'); assert.equal(payload.matchId, room.data.matchId);
      assert.ok(payload.expiresAt > Date.now() / 1000 && payload.expiresAt < Date.now() / 1000 + 300);
      assert.deepEqual(controlRequests[0].body, { matchId: room.data.matchId, mode: 'private', rounds: 2, drawTime: 90, maxPlayers: 4 });
      assert.equal((await api(`/api/rooms/${room.data.matchId}/join`, { method: 'POST', cookie: guesser.cookie, body: {} })).status, 200);
      assert.equal((await api('/api/rooms', { method: 'POST', cookie: artist.cookie, body: { mode: 'private' } })).status, 409);
    });

    await t.test('signed turn ingestion archives exact replay, rejects forged writes and stays private', async () => {
      turnId = randomUUID();
      const penalty = event('drawing.penalized', 1, { userId: artist.data.user.id, artistId: artist.data.user.id, turnId, turnNumber: 1, delta: -100, dislikeCount: 1 });
      assert.equal((await api('/api/internal/engine-events', { method: 'POST', body: penalty, headers: { 'X-Skribbil-Signature': '0'.repeat(64) } })).status, 401);
      assert.equal((await publish(penalty)).status, 200);
      const drawing = [{ type: 'line', data: { x: 10, y: 10, x2: 20, y2: 20, color: 13, width: 8 } }];
      const archived = event('turn.completed', 2, { turnId, turnNumber: 1, round: 1, artistId: artist.data.user.id, artistUsername: 'Pencil Captain', word: 'pencil', dislikeCount: 1, penaltyApplied: true, hardWord: false, eligibleVoterIds: [guesser.data.user.id], voterIds: [guesser.data.user.id], drawing });
      const accepted = await publish(archived); assert.equal(accepted.status, 200, JSON.stringify(accepted.data));
      assert.deepEqual((await publish(archived)).data, { duplicate: true });
      drawingId = (await db.query('SELECT id FROM skribbil.drawings WHERE turn_id=$1', [turnId])).rows[0].id;
      assert.equal((await api(`/api/drawings/${drawingId}/image`)).status, 403);
      assert.equal((await api(`/api/drawings/${drawingId}/image`, { cookie: artist.cookie })).status, 200);
      const replay = await api(`/api/drawings/${drawingId}/replay`, { cookie: artist.cookie });
      assert.deepEqual(JSON.parse(gunzipSync(replay.data)).operations, drawing);
      assert.equal((await db.query('SELECT count(*)::int AS n FROM skribbil.drawing_penalties WHERE turn_id=$1', [turnId])).rows[0].n, 1);
      assert.equal((await db.query('SELECT pending FROM skribbil.user_game_penalty_state WHERE user_id=$1', [artist.data.user.id])).rows[0].pending, true);
    });

    await t.test('duplicate final results cannot double points, XP or penalties', async () => {
      const finished = event('match.completed', 3, { mode: 'private', rulesVersion: 'skribbil-ranked-v1', deliveryFailed: false, participants: [
        { userId: artist.data.user.id, playerId: randomUUID(), username: 'Pencil Captain', score: -60, rank: 2 },
        { userId: guesser.data.user.id, playerId: randomUUID(), username: 'test_guesser', score: 200, rank: 1, correctGuesses: 2, fastestGuessMs: 3200, comebackWin: true },
      ] });
      const result = await publish(finished); assert.equal(result.status, 200, JSON.stringify(result.data));
      assert.deepEqual((await publish(finished)).data, { duplicate: true });
      assert.equal((await publish({ ...finished, payload: { ...finished.payload, participants: [] } })).status, 409);
      const profile = (await api('/api/me', { cookie: artist.cookie })).data.user;
      assert.equal(profile.points, 0, "casual results do not enter competitive standings"); assert.equal(profile.xp, 25); assert.equal(profile.history.length, 1); assert.equal(profile.history[0].score, -60);
      const score = (await db.query('SELECT sum(delta)::int AS total FROM skribbil.score_events WHERE match_id=$1 AND user_id=$2', [room.data.matchId, artist.data.user.id])).rows[0];
      assert.equal(score.total, -60, 'final score already includes the -100 penalty');
      const win = (await api('/api/me', { cookie: guesser.cookie })).data.user;
      assert.equal(win.xp, 50); assert.equal(win.points, 0); assert.equal(win.history[0].score, 200);
      assert.deepEqual(win.achievements.map(a=>a.slug).sort(),['comeback-kid','mind-reader']);
      assert.equal((await api(`/api/matches/${room.data.matchId}/mvp`, { method: 'POST', cookie: artist.cookie, body: { nomineeId: guesser.data.user.id, category: 'best_drawing' } })).status, 200);
      const absent=await api('/api/auth/register',{method:'POST',body:{username:'ticket_only',email:'absent@example.test',password}});
      await db.query(`INSERT INTO skribbil.match_players(match_id,user_id,engine_player_id,display_name_snapshot) VALUES($1,$2::uuid,$2::text,'Ticket only')`,[room.data.matchId,absent.data.user.id]);
      assert.equal((await api(`/api/matches/${room.data.matchId}`,{cookie:absent.cookie})).status,403);
      assert.equal((await api(`/api/matches/${room.data.matchId}/mvp`,{method:'POST',cookie:absent.cookie,body:{nomineeId:artist.data.user.id,category:'community_mvp'}})).status,403);
      assert.equal((await api(`/api/matches/${room.data.matchId}/mvp`,{method:'POST',cookie:artist.cookie,body:{nomineeId:absent.data.user.id,category:'community_mvp'}})).status,400);
      assert.equal((await api('/api/disputes',{method:'POST',cookie:absent.cookie,body:{matchId:room.data.matchId,reason:'A ticket alone cannot create a dispute'}})).status,403);
    });

    await t.test('publication needs artist consent and administrator curation; revoked sessions fail', async () => {
      await db.query("INSERT INTO skribbil.platform_roles(user_id,role) VALUES($1,'administrator')", [guesser.data.user.id]);
      assert.equal((await api(`/api/admin/drawings/${drawingId}`, { method: 'POST', cookie: guesser.cookie, body: { hall: 'shame', title: 'A valiant pencil' } })).status, 409);
      assert.equal((await api(`/api/drawings/${drawingId}/consent`, { method: 'POST', cookie: artist.cookie, body: { allow: true } })).status, 200);
      const published = await api(`/api/admin/drawings/${drawingId}`, { method: 'POST', cookie: guesser.cookie, body: { hall: 'fame', title: 'A valiant pencil' } });
      assert.equal(published.status, 200, JSON.stringify(published.data));
      assert.equal((await api(`/api/drawings/${drawingId}/image`)).status, 200);
      assert.equal((await api(`/api/drawings/${drawingId}/consent`, { method: 'POST', cookie: artist.cookie, body: { allow: false } })).status, 200);
      assert.equal((await api(`/api/drawings/${drawingId}/image`)).status, 403);
      const correction = await api('/api/admin/adjustments', { method: 'POST', cookie: guesser.cookie, body: { matchId: room.data.matchId, userId: artist.data.user.id, delta: 300, reason: 'Verified drawing score correction' } });
      assert.equal(correction.status, 200, JSON.stringify(correction.data));
      const corrected = (await api('/api/me', { cookie: artist.cookie })).data.user;
      assert.equal(corrected.history[0].score, 240); assert.equal(corrected.history[0].rank, 1); assert.equal(corrected.xp, 25);
      assert.equal((await db.query('SELECT count(*)::int AS n FROM skribbil.match_results WHERE match_id=$1', [room.data.matchId])).rows[0].n, 2);
      assert.equal((await db.query("SELECT count(*)::int AS n FROM skribbil.admin_audit_log WHERE action='score.corrected'")).rows[0].n, 1);
      assert.equal((await api('/api/auth/logout', { method: 'POST', cookie: artist.cookie, body: {} })).status, 200);
      assert.equal((await api('/api/me', { cookie: artist.cookie })).data.user, null);
      const login = await api('/api/auth/login', { method: 'POST', body: { email: 'test_artist', password } });
      assert.equal(login.status, 200); assert.notEqual(login.cookie, artist.cookie);
    });
  } finally {
    await close(app.server); await close(engine); await db.close();
    assert.ok(dir.startsWith(join(tmpdir(), "skribbil-assets-")), "temporary cleanup must stay in its generated directory");
    await rm(dir, { recursive: true, force: true });
  }
});

test('archive renderer uses the exact original color mapping and flood-fill boundary', { timeout: 30000 }, async () => {
  const source = await readFile(new URL('../engine/internal/frontend/resources/draw.js', import.meta.url), 'utf8');
  const colors = [...source.slice(source.indexOf('const colorMap')).matchAll(/#[a-fA-F0-9]{6}/g)].map(m => m[0].toLowerCase());
  assert.deepEqual(PALETTE, [...new Set(colors)]);
  const bytes = await renderDrawing([
    { type: 'line', data: { x: 800, y: 0, x2: 800, y2: 899, color: 13, width: 8 } },
    { type: 'fill', data: { x: 100, y: 100, color: 2 } },
  ]);
  const image = await loadImage(bytes), canvas = createCanvas(1600, 900), context = canvas.getContext('2d');
  context.drawImage(image, 0, 0);
  assert.deepEqual([...context.getImageData(100, 100, 1, 1).data], [239, 19, 11, 255]);
  assert.deepEqual([...context.getImageData(1400, 100, 1, 1).data], [255, 255, 255, 255]);
  assert.deepEqual([...context.getImageData(800, 100, 1, 1).data], [0, 0, 0, 255]);
});
