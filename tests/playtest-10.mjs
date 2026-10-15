// Isolated protocol playtest, not browser/device automation. Three clients use
// mobile User-Agent headers; actual touch/viewport checks are separate evidence.
// All accounts, credentials, engine secret, database and assets are ephemeral.
import assert from 'node:assert/strict';
import { ProtocolSocket, delay, until } from './helpers/protocol-socket.mjs';
import net from 'node:net';
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, mkdir, writeFile, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join, dirname, basename } from 'node:path';
import { openDatabase } from '../server/db.mjs';
import { createApp } from '../server/index.mjs';
import { AssetStore } from '../server/assets.mjs';

const demo = process.argv.includes('--demo');
const sessionFlow = process.argv.includes('--room-sessions');
let demoMetadata, demoContinue, demoStart, demoClubhouseId, viewer;
const scratch = await mkdtemp(join(tmpdir(), 'skribbil-playtest-'));
const db = await openDatabase({ url: '', dataDir: ':memory:' });
const secret = randomBytes(48).toString('hex');
const portProbe = net.createServer(); await new Promise(resolve => portProbe.listen(0, '127.0.0.1', resolve));
const enginePort = portProbe.address().port; await new Promise(resolve => portProbe.close(resolve));
const config = { secret, engineUrl: `http://127.0.0.1:${enginePort}`, origin: '', secure: false, ranked: false, production: false };
const app = await createApp({ db, config, assets: new AssetStore({ root: join(scratch, 'assets'), bucket: '' }) });
await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${app.server.address().port}`; config.origin = base;
const engine = spawn(resolve(process.env.ENGINE_BINARY || '.tools/skribbil-engine.exe'), [], {
  cwd: resolve('engine'), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...process.env, ROOT_PATH: '/engine', NETWORK_ADDRESS: '127.0.0.1', PORT: String(enginePort),
    SKRIBBIL_ENGINE_SECRET: secret, SKRIBBIL_EVENTS_URL: `${base}/api/internal/engine-events`,
    SKRIBBIL_OUTBOX_DIR: join(scratch, 'outbox'), SKRIBBIL_RANKED_ENABLED: 'false' },
});
let engineError, engineExit;
engine.on('error', error => { engineError = error; }); engine.on('exit', code => { engineExit = code; });
// Do not print subprocess environment, cookies, tickets or generated credentials.
engine.stdout.on('data', () => {}); engine.stderr.on('data', () => {});
const clients = [], turns = [], report = { clients: 10, spectators: 1, mobileUserAgentClients: 3, physicalMobileDevices: 0, browserTouchTests: false, turns: 0, checks: [] };
const desktopUA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0.0.0 Safari/537.36';
const mobileUA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1';
const request = async (client, path, data, headers = {}) => {
  const response = await fetch(base + path, { method: data === undefined ? 'GET' : 'POST', redirect: 'manual',
    headers: { Cookie: client?.cookie || '', 'User-Agent': client?.ua || desktopUA, ...headers,
      ...(data === undefined ? {} : { 'Content-Type': 'application/json', 'X-Requested-With': 'Skribbil', Origin: base }) },
    body: data === undefined ? undefined : JSON.stringify(data), signal: AbortSignal.timeout(10000) });
  return response;
};
const json = async response => {
  const data = await response.json(); assert.ok(response.ok, `HTTP ${response.status}: ${data.error || 'request failed'}`); return data;
};
let matchId, lobbyId;
const connect = async (client, ticketUrl) => {
  const launch = await request(client, ticketUrl); assert.equal(launch.status, 303, 'signed account admission succeeds');
  client.nativeCookie = launch.headers.getSetCookie().map(v => v.split(';')[0]).join('; ');
  const id = new URL(launch.headers.get('location'), base).pathname.split('/').at(-1);
  assert.equal(id, lobbyId);
  client.ws = new ProtocolSocket();
  client.ws.on('event', message => { if (message.type === 'your-turn') turns.push({ client, data: message.data }); });
  await client.ws.connect(new URL(`/engine/v1/lobby/${lobbyId}/ws`, base), `${client.cookie}; ${client.nativeCookie}`, base, client.ua);
  const ready = (await client.ws.wait('ready')).data;
  assert.equal(ready.playerName, client.roomName || client.user.display_name);
  assert.equal(ready.players.find(player => player.id === ready.playerId)?.avatarUrl || '', client.roomAvatar || client.avatarUrl || '', 'signed admission carries the saved avatar, including after reconnect');
  if (client.playerId) assert.equal(ready.playerId, client.playerId, 'reconnect keeps engine identity');
  client.playerId = ready.playerId; return ready;
};
try {
  await until(async () => { if (engineError) throw engineError; if (engineExit !== undefined) throw new Error('Engine exited before playtest'); return fetch(`${config.engineUrl}/engine/`).then(r => r.ok).catch(() => false); }, 'isolated engine startup', 15000);
  for (let i = 0; i < 11; i++) {
    const name = `play_${i}_${randomBytes(4).toString('hex')}`;
    const { user, token } = await app.platform.register({ username: name, email: `${name}@example.invalid`, password: randomBytes(32).toString('hex') });
    const avatarUrl = i===0 ? '/api/avatar-presets/v2/0-12-6-0-0-6-1-7-1-1-0-0.svg' : i < 3 ? `/api/avatar-presets/v1/${i}-0-0-0-0-1-1-0-0.svg` : '';
    if (avatarUrl) await db.query('UPDATE skribbil.users SET avatar_url=$2 WHERE id=$1',[user.id,avatarUrl]);
    clients.push({ user, avatarUrl, cookie: `skribbil_session=${token}`, ua: i < 3 ? mobileUA : desktopUA, spectator: i === 10 });
  }
  if (demo) {
    const name = `viewer_${randomBytes(4).toString('hex')}`, password = randomBytes(24).toString('hex');
    const registered = await app.platform.register({ username: name, email: `${name}@example.invalid`, password });
    viewer = { user: registered.user, cookie: `skribbil_session=${registered.token}`, ua: desktopUA, password };
    await db.transaction(async tx => {
      await tx.query("INSERT INTO skribbil.platform_roles(user_id,role) VALUES($1,'administrator')", [viewer.user.id]);
      const created = await tx.query("INSERT INTO skribbil.clubhouses(name,description,owner_id,created_by) VALUES('Pencil pals','An isolated demonstration group with synthetic test players.',$1,$1) RETURNING id", [viewer.user.id]);
      demoClubhouseId = created.rows[0].id;
      await tx.query("INSERT INTO skribbil.clubhouse_members(clubhouse_id,user_id,role) VALUES($1,$2,'owner')", [demoClubhouseId, viewer.user.id]);
      for (const client of clients) await tx.query("INSERT INTO skribbil.clubhouse_members(clubhouse_id,user_id,role) VALUES($1,$2,'member')", [demoClubhouseId, client.user.id]);
    });
  }
  const room = await json(await request(clients[0], '/api/rooms', { mode: 'private', rounds: 2, drawTime: demo ? 300 : 60, maxPlayers: 10, private: true, ...(demo ? { clubhouseId: demoClubhouseId } : {}) }));
  matchId = room.matchId;
  const lookup = await db.query('SELECT engine_room_id FROM skribbil.matches WHERE id=$1', [matchId]); lobbyId = lookup.rows[0].engine_room_id;
  for (const [index, client] of clients.entries()) {
    const ticket = index === 0 ? room : await json(await request(client, `/api/rooms/${matchId}/join`, { role: client.spectator ? 'spectator' : 'player' }));
    await connect(client, ticket.url);
  }
  const players = clients.slice(0, 10), spectator = clients[10];
  report.checks.push('10 authenticated players and a spectator connected through the gateway');
  for (let i=0;i<2;i++) {
    const p=players[i];p.roomName=['Captain Doodle','Mystery Pencil'][i];p.roomAvatar=i===0?'/api/avatar-presets/v2/2-9-6-3-0-7-2-12-1-1-0-0.svg':`/api/avatar-presets/v1/${7-i}-4-2-3-1-2-8-3-1.svg`;
    p.ws.send('room-identity-change',{displayName:p.roomName,avatarUrl:p.roomAvatar});
    await Promise.all(clients.map(c=>c.ws.wait('update-players',rows=>rows.some(r=>r.id===p.playerId&&r.name===p.roomName&&r.avatarUrl===p.roomAvatar))));
    const ack=await p.ws.wait('room-command-result',d=>d.action==='room-identity-change');assert.equal(ack.data.error,undefined);
  }
  players[1].ws.send('toggle-readiness');await players[1].ws.wait('room-command-result',d=>d.action==='toggle-readiness');
  players[1].roomName='Mystery Pencil 2';players[1].ws.send('room-identity-change',{displayName:players[1].roomName,avatarUrl:players[1].roomAvatar});
  await players[0].ws.wait('update-players',rows=>rows.some(r=>r.id===players[1].playerId&&r.name==='Mystery Pencil 2'&&r.state==='standby'));
  await players[1].ws.wait('room-command-result',d=>d.action==='room-identity-change');
  players[1].ws.send('start');assert.ok((await players[1].ws.wait('room-command-result',d=>d.action==='start')).data.error);
  players[0].ws.send('start');assert.ok((await players[0].ws.wait('room-command-result',d=>d.action==='start')).data.error);
  for(const p of players.slice(0,2)) {const profile=(await db.query('SELECT display_name,avatar_url FROM skribbil.users WHERE id=$1',[p.user.id])).rows[0];assert.equal(profile.display_name,p.user.display_name);assert.equal(profile.avatar_url||'',p.avatarUrl||'');}
  report.checks.push('two room looks broadcast to every client; profile unchanged; edit unreadies; unready/unauthorized start blocked');
  // Returning from sharing an invitation must also work before the old socket
  // has disconnected, without creating a second seat or losing ownership.
  const previousOwnerSocket = players[0].ws;
  const ownerId = players[0].playerId;
  const returnTicket = await json(await request(players[0], `/api/rooms/${matchId}/join`, {}));
  const returnedOwner = await connect(players[0], returnTicket.url);
  assert.equal(returnedOwner.playerId, ownerId);
  assert.equal(returnedOwner.ownerId, ownerId);
  assert.equal(returnedOwner.players.length, 11, 'rejoining reuses the original roster');
  await until(() => previousOwnerSocket.closed, 'superseded owner connection closes');
  previousOwnerSocket.close();
  report.checks.push('room creator returns with the old socket still active and preserves their seat and ownership');
  // All clients are genuine members of this room, but one must not use another
  // account's engine cookie to view its private drawing/word state.
  const borrowed = await request(clients[1], `/engine/lobby/${lobbyId}`, undefined, { Cookie: `${clients[1].cookie}; ${clients[0].nativeCookie}` });
  assert.equal(borrowed.status, 403); report.checks.push('borrowed native cookie rejected for a different logged-in account');
  players[0].ws.send('message', 'Ten-player protocol check');
  await Promise.all(players.map(c => c.ws.wait('message', d => d.content === 'Ten-player protocol check')));
  if (demo) {
    await mkdir(resolve('.data'), { recursive: true });
    demoMetadata = resolve(`.data/playtest-demo-${process.pid}.json`);
    demoStart = resolve(`.data/playtest-demo-${process.pid}.start`);
    demoContinue = resolve(`.data/playtest-demo-${process.pid}.continue`);
    await writeFile(demoMetadata, JSON.stringify({ origin: base, username: viewer.user.username, password: viewer.password,
      matchId, clubhouseId: demoClubhouseId, startFile: demoStart, continueFile: demoContinue, stage: 'lobby' }, null, 2), { flag: 'wx' });
    console.log(`Demo lobby ready. Local ephemeral metadata: ${demoMetadata}`);
    console.log('Create its startFile to begin the native game; staging expires after12minutes.');
    await until(() => access(demoStart).then(() => true).catch(() => false), 'demo lobby continuation', 720000);
  }
  // Ready must not be blocked by the spectator.
  for (const p of players.slice(1)) {p.ws.send('toggle-readiness');await p.ws.wait('room-command-result',d=>d.action==='toggle-readiness');}
  assert.equal(turns.length,0,'managed room waits for explicit owner start');
  players[0].ws.send('start');
  let penalized;
  for (let turn = 1; turn <= 20; turn++) {
    const next = await until(() => turns.shift(), `artist turn ${turn}`);
    const artist = next.client;
    if (turn === 1) penalized = artist;
    if (turn > 10 && artist === penalized) { assert.equal(next.data.words.length, 1, 'penalized artist gets one forced hard word'); report.checks.push('next-turn hard word forced'); }
    const word = next.data.words[0]; assert.equal(typeof word, 'string');
    artist.ws.send('choose-word', 0);
    await Promise.all(clients.map(c => c.ws.wait('word-chosen')));
    const guessers = players.filter(c => c !== artist);
    const draw = { x: 30 + turn, y: 40, x2: 100 + turn, y2: 110, color: 2, width: 8 };
    artist.ws.send('line', draw);
    await Promise.all(clients.filter(c => c !== artist).map(c => c.ws.wait('line', d => d.x2 === draw.x2)));
    artist.ws.send('fill', { x: 1500, y: 800, color: 6 });
    await Promise.all(clients.filter(c => c !== artist).map(c => c.ws.wait('fill')));
    if (turn === 1 && demo) {
      const launch = await json(await request(viewer, `/api/rooms/${matchId}/join`, { role: 'spectator' }));
      await writeFile(demoMetadata, JSON.stringify({ origin: base, username: viewer.user.username, password: viewer.password,
        launchUrl: base + launch.url, matchId, clubhouseId: demoClubhouseId, startFile: demoStart, continueFile: demoContinue, stage: 'drawing' }, null, 2));
      // This is real line/fill traffic on the original game canvas. The scene is
      // a demo doodle, not a generated image or a replacement canvas renderer.
      artist.ws.send('fill', { x: 1500, y: 800, color: 0 });
      const strokes = [[300,650,600,350],[600,350,900,650],[350,610,350,850],[350,850,850,850],[850,850,850,610],[520,850,520,690],[520,690,660,690],[660,690,660,850],[1000,720,1300,480],[1300,480,1550,720]];
      for (const [x,y,x2,y2] of strokes) { artist.ws.send('line',{x,y,x2,y2,color:13,width:16}); await delay(70); }
      for (let a=0;a<24;a++) { const b=a*2*Math.PI/24,c=(a+1)*2*Math.PI/24; artist.ws.send('line',{x:Math.round(1150+80*Math.cos(b)),y:Math.round(220+80*Math.sin(b)),x2:Math.round(1150+80*Math.cos(c)),y2:Math.round(220+80*Math.sin(c)),color:3,width:16}); }
      players[1].ws.send('message', 'A tiny house, a very ambitious sun.');
      console.log(`Demo paused for CUA browser capture. Read local ephemeral metadata: ${demoMetadata}`);
      console.log('Create its continueFile to resume; all demo credentials and files are deleted on exit.');
      await until(() => access(demoContinue).then(() => true).catch(() => false), 'demo capture continuation', 240000);
    }
    if (turn === 1) {
      const reconnecting = guessers.find(c => c.ua === mobileUA) || guessers[0];
      const identity = reconnecting.playerId;
      reconnecting.ws.close(); await delay(400);
      const ticket = await json(await request(reconnecting, `/api/rooms/${matchId}/join`, {}));
      const recovered = await connect(reconnecting, ticket.url);
      assert.equal(recovered.playerId, identity); assert.ok(recovered.currentDrawing.length >= 2, 'reconnect replays current canvas');
      report.checks.push('mobile-UA connection reconnects with same identity and current drawing');
      spectator.ws.send('dislike-drawing', { turnId: 1 }); spectator.ws.send('message', word);
      spectator.ws.send('line', { ...draw, x2: 1599 });
      for (const c of guessers.slice(0, 8)) c.ws.send('dislike-drawing', { turnId: 1 });
      const before = await artist.ws.wait('dislike-state', d => d.votes === 8);
      assert.equal(before.data.required, 9); assert.equal(before.data.applied, false);
      guessers[8].ws.send('dislike-drawing', { turnId: 1 });
      await artist.ws.wait('dislike-state', d => d.applied === true);
      await artist.ws.wait('update-players', roster => roster.some(p => p.id === artist.playerId && p.score === -100));
      for (let i = 0; i < 3; i++) guessers[8].ws.send('dislike-drawing', { turnId: 1 });
      assert.ok(!guessers[0].ws.pending.some(e => e.type === 'line' && e.data.x2 === 1599), 'spectator drawing never broadcast');
      report.checks.push('spectator excluded; nine unique votes apply exactly -100 despite duplicates');
    }
    // Keep the native anti-spam rule active: fewer than five guesses in3sec.
    await delay(900);
    for (const c of guessers) c.ws.send('message', word);
    await Promise.all(guessers.map(c => c.ws.wait('correct-guess-self')));
    report.turns = turn;
    if (turn % 5 === 0) console.log(`Protocol playtest: ${turn}/20 native turns completed.`);
  }
  await Promise.all(players.map(c => c.ws.wait('game-over')));
  const settled = await until(async () => (await db.query(`SELECT * FROM skribbil.matches WHERE id=$1 AND status='completed'`, [matchId])).rows[0], 'authoritative result settlement', 90000);
  const results = (await db.query('SELECT * FROM skribbil.match_result_players WHERE result_id=$1', [settled.accepted_result_id])).rows;
  assert.equal(results.length, 10); assert.ok(!results.some(r => r.user_id === spectator.user.id));
  assert.ok(results.every(r => r.correct_guesses === 18 && r.fastest_guess_ms !== null));
  const penalties = (await db.query(`SELECT * FROM skribbil.score_events WHERE match_id=$1 AND kind='dislike_penalty'`, [matchId])).rows;
  assert.equal(penalties.length, 1); assert.equal(penalties[0].delta, -100); assert.equal(penalties[0].user_id, penalized.user.id);
  const archive = (await db.query(`SELECT count(*) AS total,count(*) FILTER(WHERE t.difficulty='hard') AS hard
    FROM skribbil.drawings d JOIN skribbil.drawing_turns t ON t.id=d.turn_id WHERE d.match_id=$1`, [matchId])).rows[0];
  assert.equal(Number(archive.total), 20); assert.equal(Number(archive.hard), 1);
  const debt = (await db.query('SELECT pending FROM skribbil.user_game_penalty_state WHERE user_id=$1', [penalized.user.id])).rows[0]; assert.equal(debt.pending, false);
  report.checks.push('20 real turns archived;10 results with18 correct guesses each; spectator absent from results; debt consumed');
  report.archivedDrawings = Number(archive.total); report.authoritativeResults = results.length;
  if (sessionFlow) {
    for (const client of [players[1], spectator]) {
      assert.equal((await request(client, `/api/rooms/${matchId}/session`, {action:'rematch'})).status, 409);
      assert.equal((await request(client, `/api/rooms/${matchId}/session`, {action:'close'})).status, 409);
    }
    const nextSession = await json(await request(players[0], `/api/rooms/${matchId}/session`, {action:'rematch'}));
    const transitions = await Promise.all(clients.map(c => c.ws.wait('room-session-transition')));
    assert.ok(transitions.every(event => event.data.matchId === nextSession.matchId));
    assert.equal(transitions.at(-1).data.role, 'spectator');
    assert.equal((await request(players[0], `/api/rooms/${matchId}/session`, {action:'close'})).status, 409);
    lobbyId = (await db.query('SELECT engine_room_id FROM skribbil.matches WHERE id=$1', [nextSession.matchId])).rows[0].engine_room_id;
    for (const client of clients) {
      client.ws.close(); delete client.playerId;
      const ticket = await json(await request(client, `/api/rooms/${nextSession.matchId}/join`, {role:client.spectator?'spectator':'player'}));
      await connect(client, ticket.url);
    }
    await Promise.all(players.map(c => c.ws.wait('next-turn')));
    report.checks.push('leader-only next session carries all ten players and spectator, preserves room identities, and starts automatically');
    for (let turn = 1; turn <= 20; turn++) {
      const next = await until(() => turns.shift(), `next-session artist turn ${turn}`);
      next.client.ws.send('choose-word', 0);
      await Promise.all(clients.map(c=>c.ws.wait('word-chosen')));
      await delay(900);
      const guessers = players.filter(c=>c!==next.client);
      for (const client of guessers) client.ws.send('message', next.data.words[0]);
      await Promise.all(guessers.map(c=>c.ws.wait('correct-guess-self')));
    }
    await Promise.all(clients.map(c=>c.ws.wait('game-over')));
    const nextResult = await until(async()=> (await db.query("SELECT * FROM skribbil.matches WHERE id=$1 AND status='completed'", [nextSession.matchId])).rows[0], 'next session settled');
    assert.notEqual(nextResult.accepted_result_id, settled.accepted_result_id);
    assert.equal((await db.query('SELECT accepted_result_id FROM skribbil.matches WHERE id=$1', [matchId])).rows[0].accepted_result_id, settled.accepted_result_id);
    // A failed replay must leave everyone on results and remain deletable,
    // even if leadership changes after its successor was reserved.
    await db.query("UPDATE skribbil.users SET status='suspended' WHERE id=$1", [spectator.user.id]);
    assert.equal((await request(players[0], `/api/rooms/${nextSession.matchId}/session`, {action:'rematch'})).status, 409);
    const failedReplay = (await db.query('SELECT target_match_id FROM skribbil.match_rematches WHERE source_match_id=$1', [nextSession.matchId])).rows[0];
    assert.ok(failedReplay);
    assert.ok(clients.every(c=>!c.ws.pending.some(event=>event.type==='room-session-transition')));
    await db.query("UPDATE skribbil.users SET status='active' WHERE id=$1", [spectator.user.id]);
    players[0].ws.close();
    await Promise.all(clients.slice(1).map(c=>c.ws.wait('owner-change', d=>d.playerId===players[1].playerId)));
    assert.equal((await request(players[0], `/api/rooms/${nextSession.matchId}/session`, {action:'close'})).status, 409);
    await json(await request(players[1], `/api/rooms/${nextSession.matchId}/session`, {action:'close'}));
    await Promise.all(clients.slice(1).map(c=>c.ws.wait('room-session-closed')));
    const removed = await fetch(config.engineUrl+'/engine/internal/rooms/status', {method:'POST', headers:{Authorization:`Bearer ${secret}`, 'Content-Type':'application/json'}, body:JSON.stringify({matchId:nextSession.matchId,lobbyId})});
    assert.equal(removed.status, 404);
    assert.equal((await db.query('SELECT status,accepted_result_id FROM skribbil.matches WHERE id=$1', [nextSession.matchId])).rows[0].accepted_result_id, nextResult.accepted_result_id);
    assert.equal((await db.query('SELECT status FROM skribbil.matches WHERE id=$1', [failedReplay.target_match_id])).rows[0].status, 'cancelled');
    report.checks.push('second game saves a separate result; failed replay leaves everyone on results; leader leaving passes controls; delete removes live room and empty reservation while preserving both results');
  } else {
    for (const c of clients) c.ws?.close();
    const fresh=await json(await request(players[0],`/api/matches/${matchId}/rematch`,{}));
    lobbyId=(await db.query('SELECT engine_room_id FROM skribbil.matches WHERE id=$1',[fresh.matchId])).rows[0].engine_room_id;
    delete players[0].roomName;delete players[0].roomAvatar;delete players[0].playerId;
    const freshReady=await connect(players[0],fresh.url);assert.equal(freshReady.playerName,players[0].user.display_name);
    report.checks.push('fresh rematch resets temporary identity to permanent profile');
  }
  report.status = 'passed'; console.log(JSON.stringify(report, null, 2));
} finally {
  for (const client of clients) client.ws?.close();
  engine.kill();
  await Promise.race([new Promise(resolve => engine.once('exit', resolve)), delay(2000)]);
  app.server.closeAllConnections(); await new Promise(resolve => app.server.close(resolve));
  await db.close();
  assert.equal(dirname(resolve(scratch)), resolve(tmpdir()));
  assert.ok(basename(scratch).startsWith('skribbil-playtest-'));
  await rm(scratch, { recursive: true, force: true });
  if (demoMetadata) await rm(demoMetadata, { force: true });
  if (demoContinue) await rm(demoContinue, { force: true });
  if (demoStart) await rm(demoStart, { force: true });
}
