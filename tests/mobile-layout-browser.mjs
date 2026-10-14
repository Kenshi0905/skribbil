// Opt-in rendering check. Start Chrome with --remote-debugging-port=9223,
// build the engine, then run ENGINE_BINARY=/path/to/engine node this-file.
// Uses a disposable native room and synthetic UI states; no saved accounts.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import net from 'node:net';

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const probe = net.createServer();
await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve));
const port = probe.address().port;
await new Promise(resolve => probe.close(resolve));
const base = `http://127.0.0.1:${port}`;
const engine = spawn(resolve(process.env.ENGINE_BINARY || '.tools/skribbil-engine'), [], {
  cwd: resolve('engine'), stdio: 'ignore',
  env: { ...process.env, PORT: String(port), ROOT_PATH: '', NETWORK_ADDRESS: '127.0.0.1', SKRIBBIL_ENGINE_SECRET: '', SKRIBBIL_EVENTS_URL: '' },
});
let ws, target;
const debug = process.env.CHROME_DEBUG_URL || 'http://127.0.0.1:9223';
try {
  for (let attempt = 0; ; attempt++) {
    if (await fetch(base).then(r => r.ok).catch(() => false)) break;
    assert.ok(attempt < 100, 'engine starts'); await delay(100);
  }
  const created = await fetch(`${base}/lobby`, { method: 'POST', redirect: 'manual',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'Chrome' },
    body: new URLSearchParams({ language: 'english', score_calculation: 'chill', drawing_time: '120', rounds: '4', max_players: '24', words_per_turn: '3', custom_words_per_turn: '1', clients_per_ip_limit: '24', public: 'false' }),
  });
  assert.equal(created.status, 302, 'creates isolated native room');
  target = await (await fetch(`${debug}/json/new?about:blank`, { method: 'PUT' })).json();
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise(resolve => ws.addEventListener('open', resolve, { once: true }));
  let sequence = 0;
  const pending = new Map(), errors = [];
  ws.addEventListener('message', event => {
    const data = JSON.parse(event.data);
    if (data.method === 'Runtime.exceptionThrown') errors.push(data.params.exceptionDetails.exception?.description || data.params.exceptionDetails.text);
    if (data.id) {
      const p = pending.get(data.id); pending.delete(data.id);
      data.error ? p.reject(Error(data.error.message)) : p.resolve(data.result);
    }
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++sequence; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async expression => {
    const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    assert.equal(result.exceptionDetails, undefined, JSON.stringify(result.exceptionDetails));
    return result.result.value;
  };
  await send('Page.enable'); await send('Runtime.enable');
  await send('Page.setBypassCSP', { enabled: true });
  for (const cookie of created.headers.getSetCookie()) {
    const [name, ...value] = cookie.split(';')[0].split('=');
    await send('Network.setCookie', { name, value: value.join('='), url: base });
  }
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await send('Page.navigate', { url: base + created.headers.get('location') });
  for (let attempt = 0; ; attempt++) {
    if (await evaluate(`Boolean(document.querySelector('#player-container .player'))`)) break;
    assert.ok(attempt < 100, 'native game connects: ' + JSON.stringify({ errors, page: await evaluate(`document.body.innerText.slice(0, 500)`) })); await delay(100);
  }
  const themes = await readFile('web/themes.css', 'utf8');
  const roomLook = await readFile('web/room-look.css', 'utf8');
  await evaluate(`(() => {
    const style = document.createElement('style'); style.textContent = ${JSON.stringify(themes + roomLook)}; document.head.append(style);
    document.body.dataset.leagueMode = 'private';
    const toolbar = document.getElementById('league-toolbar'); toolbar.hidden = false;
    toolbar.insertAdjacentHTML('beforeend', '<button id="copy-room-invite" class="dialog-button">Copy invite link</button><button class="league-theme-toggle">Dark</button>');
    document.querySelectorAll('.center-dialog').forEach(d => d.style.visibility = 'hidden');
    document.getElementById('toolbox').style.display = 'none';
    const roster = document.getElementById('player-container'), player = roster.firstElementChild.cloneNode(true);
    player.classList.add('community-player'); player.insertAdjacentHTML('beforeend', '<span class="community-player-avatar">PP</span>');
    roster.replaceChildren();
    for (let i = 0; i < 20; i++) { const p = player.cloneNode(true); p.querySelector('.playername').textContent = ['Pencil pal', 'Long player name that should truncate', 'Doodle'][i % 3]; roster.append(p); }
    document.getElementById('message-container').innerHTML = Array.from({length:40}, (_,i) => '<div class="message"><b>Player:</b> '+(i%2?'Is it a butterfly?':'Great drawing!')+'</div>').join('');
    document.getElementById('rounds').textContent = '2'; document.getElementById('max-rounds').textContent = '4';
    document.getElementById('word-container').textContent = '_ _ _ _ _ _';
    const c = document.getElementById('drawing-board').getContext('2d'); c.fillStyle = '#fff'; c.fillRect(0,0,1600,900); c.strokeStyle = '#6750c7'; c.lineWidth = 16; c.beginPath(); c.arc(800,450,200,0,Math.PI*2); c.stroke();
  })()`);
  const measure = () => evaluate(`(() => {
    const rect = id => { const r = document.getElementById(id).getBoundingClientRect(); return { x:r.x, y:r.y, width:r.width, height:r.height, bottom:r.bottom, right:r.right }; };
    return { board:rect('drawing-board'), input:rect('message-form'), players:rect('player-container'), chat:rect('message-container'), menu:rect('menu-button'), header:rect('lobby-header'), pageWidth:document.documentElement.scrollWidth, viewportWidth:innerWidth };
  })()`);
  for (const [width,height] of [[320,320],[320,568],[375,667],[390,400],[390,844],[430,932],[768,1024],[844,390],[1280,800]]) {
    await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width <= 900 });
    for (const theme of ['light','dark']) {
      await evaluate(`document.documentElement.dataset.theme = '${theme}'`); await delay(80);
      const m = await measure();
      assert.ok(m.pageWidth <= width + 1, JSON.stringify(m));
      assert.ok(Math.abs(m.board.width / m.board.height - 16/9) < .02, 'canvas ratio stays accurate');
      if (width <= 900) {
        assert.ok(m.board.y >= 0 && m.board.bottom < m.input.y, JSON.stringify(m));
        assert.ok(m.input.bottom <= height + 1 && m.input.height >= 44, JSON.stringify(m));
        assert.ok(m.players.x < m.chat.x && m.players.height > 40, JSON.stringify(m));
        assert.ok(m.menu.right >= m.header.right - 8, 'menu stays in upper-right corner');
        const lastPlayerReachable = await evaluate(`(() => {const p=document.getElementById('player-container');p.scrollTop=p.scrollHeight;return p.lastElementChild.getBoundingClientRect().bottom <= p.getBoundingClientRect().bottom + 1;})()`);
        assert.ok(lastPlayerReachable, 'full vertical roster can be scrolled');
      } else {
        assert.ok(m.players.x < m.board.x && m.chat.x > m.board.x, 'desktop remains three columns');
      }
      for (const count of [1,3,6]) {
        await evaluate(`document.getElementById('word-button-container').innerHTML = ${JSON.stringify(Array.from({length:count}, (_,i)=>`<button class="dialog-button">${['butterfly','ice cream','extraordinarilylongword'][i%3]}</button>`).join(''))}; document.getElementById('word-dialog').style.visibility = 'visible'`);
        assert.ok(await evaluate(`(() => {const d=document.getElementById('word-dialog'),r=d.getBoundingClientRect(),c=d.querySelector('.center-dialog-content');return r.top >= 0 && r.bottom <= innerHeight && d.scrollWidth <= d.clientWidth + 1 && c.scrollWidth <= c.clientWidth + 1;})()`), 'word picker fits without horizontal overflow');
        if (width === 390 && count === 3) {
          const shot = await send('Page.captureScreenshot', { format: 'png' });
          await writeFile(`/tmp/skribbil-mobile-${theme}.png`, Buffer.from(shot.data, 'base64'));
        }
      }
      await evaluate(`document.getElementById('word-dialog').style.visibility = 'hidden'; document.getElementById('toolbox').style.display = 'flex'`);
      await delay(80);
      if (width <= 900) {
        const drawing = await measure();
        assert.ok(drawing.input.bottom <= height + 1 && drawing.board.height > 30, 'drawing tools keep input and canvas on screen');
        await evaluate(`document.getElementById('menu-button').click()`);
        assert.ok(await evaluate(`(() => {const r=document.getElementById('menu').getBoundingClientRect();return r.top >= document.getElementById('menu-button').getBoundingClientRect().bottom && r.bottom <= innerHeight && r.left >= 0;})()`), 'corner menu opens fully within the screen');
        await evaluate(`document.getElementById('menu').hidePopover()`);
        await evaluate(`document.getElementById('help-button').click()`);
        for (const id of ['help-dialog', 'lobbysettings-dialog']) {
          await evaluate(`document.getElementById('${id}').style.visibility='visible'`);
          assert.ok(await evaluate(`(() => {const r=document.getElementById('${id}').getBoundingClientRect();return r.top >= 0 && r.bottom <= innerHeight && r.left >= 0 && r.right <= innerWidth;})()`), `${id} stays reachable`);
          await evaluate(`document.getElementById('${id}').style.visibility='hidden'`);
        }
      }
      await evaluate(`document.getElementById('toolbox').style.display = 'none'`);
      await evaluate(`document.getElementById('game-over-dialog').style.visibility = 'visible'`);
      assert.ok(await evaluate(`(() => {const r=document.getElementById('game-over-dialog').getBoundingClientRect();return r.left >= 0 && r.right <= innerWidth + 1 && r.top >= 0 && r.bottom <= innerHeight + 1;})()`), 'results dialog remains positioned within the viewport');
      await evaluate(`document.getElementById('game-over-dialog').style.visibility = 'hidden'`);
      console.log(`${width}x${height} ${theme}: canvas, roster, word picker and drawing controls fit`);
    }
  }
  await send('Emulation.setDeviceMetricsOverride', { width:390, height:844, deviceScaleFactor:1, mobile:true });
  await evaluate(`window.originalViewport = window.visualViewport; window.keyboardViewport = {height:390, offsetTop:140, scale:1}; Object.defineProperty(window,'visualViewport',{configurable:true,value:window.keyboardViewport}); document.getElementById('message-input').focus(); window.originalViewport.dispatchEvent(new Event('resize'));`);
  await delay(100);
  const keyboard = await measure();
  assert.ok(keyboard.board.y >= 140 && keyboard.board.bottom <= 530, JSON.stringify(keyboard));
  assert.ok(keyboard.input.bottom <= 530 && keyboard.input.y > keyboard.board.bottom, JSON.stringify(keyboard));
  await evaluate(`document.getElementById('message-input').value='butterfly'; document.getElementById('message-form').requestSubmit()`);
  assert.equal(await evaluate(`document.getElementById('message-input').value`), '', 'native websocket guess submission still works');
  await evaluate(`Object.defineProperty(window,'visualViewport',{configurable:true,value:window.originalViewport}); window.originalViewport.dispatchEvent(new Event('resize'));`);
  await delay(100);
  assert.ok((await measure()).input.bottom <= 844);
  assert.deepEqual(errors, [], 'no browser JavaScript exceptions');
  console.log('Simulated keyboard resize/pan and native guess submission passed. Physical keyboard/device testing is still separate.');
} finally {
  ws?.close();
  if (target?.id) await fetch(`${debug}/json/close/${target.id}`).catch(() => {});
  engine.kill();
}
