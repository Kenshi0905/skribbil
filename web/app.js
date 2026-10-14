import { avatarV2Options as avatarOptions, defaultAvatarV2 as defaultAvatar, editableAvatar, avatarVibes, avatarFromUrl, renderAvatar, randomAvatar } from './avatar.js';

const $ = (selector, root = document) => root.querySelector(selector);
const app = $('#app');
const dialogRoot = $('#dialog-root');
const e = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const number = value => new Intl.NumberFormat('en-IN').format(Number(value) || 0);
const icons = {
  moon: '<path d="M20.5 13.5A8.5 8.5 0 0 1 10.5 3a8.5 8.5 0 1 0 10 10.5Z"/>',
  home: '<path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1Z"/>',
  trophy: '<path d="M7 3h10v5a5 5 0 0 1-10 0V3Zm5 10v5m-4 3h8m-8-3h8v3H8zM7 5H3v2a4 4 0 0 0 4 4m10-6h4v2a4 4 0 0 1-4 4"/>',
  sword: '<path d="m14 3 7 0 0 7-11 11-7-7L14 3Zm-9 9 7 7m-8 2 4-4m8-9-6 6"/>',
  palette: '<path d="M12 3a9 9 0 1 0 0 18h2a2 2 0 0 0 0-4h-1a1.5 1.5 0 0 1 0-3h2a6 6 0 0 0 0-12Z"/><circle cx="6.5" cy="11" r=".8"/><circle cx="8.5" cy="6.8" r=".8"/><circle cx="13" cy="6" r=".8"/><circle cx="17" cy="9" r=".8"/>',
  people: '<circle cx="9" cy="8" r="3"/><path d="M3 21v-3a6 6 0 0 1 12 0v3M16 5a3 3 0 0 1 0 6m2 4a5 5 0 0 1 3 4v2"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21v-3a8 8 0 0 1 16 0v3"/>',
  shield: '<path d="m12 3 8 3v6c0 5-8 9-8 9S4 17 4 12V6l8-3Z"/><path d="m8 12 3 3 5-6"/>',
  arrow: '<path d="M4 12h15m-6-6 6 6-6 6"/>',
  chevron: '<path d="m9 5 7 7-7 7"/>',
  down: '<path d="m6 9 6 6 6-6"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9 8a3 3 0 1 1 5 2c-2 1-2 2-2 3m0 3h.01"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 6v6l4 2"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4m10-4v4M3 11h18m-13 4h2m4 0h2m-8 3h2"/>',
  bolt: '<path d="m13 2-9 12h7l-1 8 10-13h-8l1-7Z"/>',
  star: '<path d="m12 2 3.1 6.3 6.9 1-5 4.9 1.2 6.8-6.2-3.2L5.8 21 7 14.2 2 9.3l6.9-1L12 2Z"/>',
  sparkle: '<path d="m12 2 2.5 7.5L22 12l-7.5 2.5L12 22l-2.5-7.5L2 12l7.5-2.5L12 2Z"/>',
  pencil: '<path d="m16 3 5 5-13 13-6 1 1-6L16 3Zm-4 4 5 5M3 16l5 5"/>',
  lock: '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3m-4 5v2"/>',
  game: '<path d="M7 6h10a4 4 0 0 1 4 4l1 8a2 2 0 0 1-3 2l-4-4H9l-4 4a2 2 0 0 1-3-2l1-8a4 4 0 0 1 4-4Z"/><path d="M7 9v5m-2.5-2.5h5M16 10h.01M19 13h.01"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10h.01"/>',
  heart: '<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0l-1 1-1-1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z"/>',
  target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>',
  fire: '<path d="M13 2s3 5 0 9c4-1 4-4 4-4s5 5 3 10a8 8 0 0 1-15-1C3 11 8 7 8 7s-1 4 2 5c3-4 3-10 3-10Z"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
  globe: '<circle cx="12" cy="12" r="9"/><ellipse cx="12" cy="12" rx="4" ry="9"/><path d="M3 12h18"/>',
  plus: '<path d="M12 4v16M4 12h16"/>',
  medal: '<path d="m8 13-4 8 8-3 8 3-4-8"/><circle cx="12" cy="8" r="6"/><path d="m10 8 1 1 3-3"/>',
  chart: '<path d="M4 21V11h4v10m2 0V3h4v18m2 0V7h4v14"/>',
  logout: '<path d="M10 4H4v16h6m-1-8h13m-5-5 5 5-5 5"/>',
  flag: '<path d="M4 22V3m0 1c6-4 10 4 16 0v11c-6 4-10-4-16 0"/>',
  image: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8" cy="8" r="2"/><path d="m21 16-5-5L5 21"/>',
  eye: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',
  refresh: '<path d="M20 8a8 8 0 1 0 0 8m0-14v6h-6"/>',
  crown: '<path d="m3 6 5 4 4-7 4 7 5-4-2 13H5L3 6Zm2 10h14"/>',
  book: '<path d="M12 6C8 2 3 4 3 4v15s5-2 9 2c4-4 9-2 9-2V4s-5-2-9 2Zm0 0v15"/>',
};
function icon(name, extraClass = '') { return `<svg class="${e(extraClass)}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name] || icons.star}</svg>`; }
const catArt = `<svg viewBox="0 0 270 180" xmlns="http://www.w3.org/2000/svg" aria-label="A wonderfully wonky orange cat wearing a crown" role="img"><g stroke="#38354b" stroke-width="3.7" stroke-linecap="round" stroke-linejoin="round"><path d="M103 115c-10 24-8 46 15 47h50c15-1 20-22 3-47" fill="#ffba75"/><path d="M173 145c43 13 49-13 41-20-13-12-15 17-30 7" fill="none" stroke="#ee9d55" stroke-width="12"/><path d="m88 99-6-45 32 17c14-5 27-5 41 0l31-15-7 43c3 25-18 37-47 37-31 0-47-14-44-37Z" fill="#ffc383"/><path d="m92 79-2-12 13 10m61 2 14-12-2 14" fill="#f9978d" stroke="#f9978d"/><path d="m103 98 11-5m39 1 12 5" fill="none"/><path d="m127 105 10 1-5 7-5-8Z" fill="#aa705c" stroke="#aa705c"/><path d="M132 114c-3 8-10 7-14 2m14-2c4 9 10 7 13 3" fill="none"/><path d="m89 110-17-3m18 13-17 4m107-13 17-3m-19 12 18 4" fill="none"/><path d="m116 147-1 15m31-15 1 15" fill="none"/><path d="m112 56-4-17 14 6 12-18 10 17 15-7-6 20Z" fill="#ffdc69" stroke-width="2.5"/></g><g fill="none" stroke="#9c84df" stroke-width="2.5" stroke-linecap="round"><path d="m209 48 4-9 3 10 9 4-10 3-3 10-3-10-8-3Z"/><path d="m56 126 2-6 2 6 6 2-6 2-2 6-2-6-6-2Z"/></g><path d="m69 147-6 5m129-69 8-3" stroke="#e6bd78" stroke-width="2.5" stroke-linecap="round"/><ellipse cx="135" cy="169" rx="53" ry="3" fill="#eeebef"/></svg>`;
const trophyArt = `<svg viewBox="0 0 130 150" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M38 24h54v40c0 22-12 35-27 35S38 87 38 64V24Z" fill="currentColor"/><path d="M38 34H20v18c0 21 9 28 27 28m45-46h18v18c0 21-9 28-27 28" stroke="currentColor" stroke-width="9"/><path d="M65 97v23m-20 12h40m-32-12h24v12H53Z" stroke="currentColor" stroke-width="10" stroke-linecap="round"/><path d="m65 42 5 12 13 2-10 9 2 13-10-6-11 6 2-13-9-9 13-2Z" fill="#ffeedb"/></svg>`;

const state = { data:{}, route:'home', leaderboardTab:'season', communityTab:'fame', socialTab:'friends', search:'', authMode:'register', modal:null, roomMode:'private', mobileNav:false, error:null, admin:null, busy:false, match:null, myDrawings:null, returnAfterAuth:null, shareRoomId:null, pendingJoin:new URLSearchParams(location.search).get('join') };
let previousFocus = null;
const user = () => state.data.user || null;
const isAdmin = () => !!user() && (user().role === 'admin' || user().isAdmin === true || user().roles?.includes('admin') || user().role === 'owner');
const rows = key => Array.isArray(state.data[key]) ? state.data[key] : [];
function displayName(person) { return person?.displayName || person?.username || person?.name || 'Scribbler'; }
function avatar(person, size = '') { const name = displayName(person); const color = /^#[0-9a-f]{6}$/i.test(person?.avatarColor || '') ? person.avatarColor : '#eee6ff'; const url = safeUrl(person?.avatarUrl); const initial = name.substring(0,2).toUpperCase(); return `<span class="avatar ${e(size)} ${person?.frame === 'violet-frame' ? 'frame-violet' : ''}" data-initial="${e(initial)}" style="background:${color}">${url ? `<img src="${e(url)}" alt="" loading="${size === 'lg' ? 'eager' : 'lazy'}"/>` : e(initial)}</span>`; }
function teamLogo(team) { const url = safeUrl(team.logoUrl); const initial = (team.tag || team.name || 'SK').substring(0,3); return `<span class="team-logo" data-initial="${e(initial)}">${url ? `<img src="${e(url)}" alt="" loading="lazy"/>` : e(initial)}</span>`; }
const plural = (count, singular, pluralWord = `${singular}s`) => `${number(count)} ${Number(count) === 1 ? singular : pluralWord}`;
function tag(text, color = '') { return `<span class="tag ${e(color)}">${e(text)}</span>`; }
function button(text, action, iconName = '', style = 'primary', extra = '') { return `<button class="button button-${e(style)}" data-action="${e(action)}" ${extra}>${iconName ? icon(iconName) : ''}${e(text)}</button>`; }
function heading(eyebrow, title, subtitle, action = '') { return `<div class="page-heading"><div><div class="eyebrow">${e(eyebrow)}</div><h1>${e(title)}</h1><p>${e(subtitle)}</p></div>${action}</div>`; }
function empty(title, message, action = '') { return `<div class="empty-state">${icon('pencil')}<h3>${e(title)}</h3><p>${e(message)}</p>${action}</div>`; }
function safeUrl(value) { if (typeof value !== 'string' || !value.trim()) return null; try { const url = new URL(value, location.origin); return url.origin === location.origin && ['http:','https:'].includes(url.protocol) ? url.pathname + url.search + url.hash : null; } catch { return null; } }
function readableDate(value) { if (!value) return 'To be announced'; const date = new Date(value); return Number.isNaN(date.getTime()) ? 'To be announced' : new Intl.DateTimeFormat('en-IN',{day:'numeric',month:'short',year:'numeric',timeZone:'Asia/Kolkata'}).format(date); }
function boardPlayers() {
  const source = rows(state.leaderboardTab === 'season' ? 'seasonLeaderboard' : 'leaderboard');
  return source.slice();
}
async function joinRoom(roomId,role) {
  if (!user()) { state.returnAfterAuth = {type:'join',id:roomId,role}; state.authMode = 'register'; openModal('auth'); return; }
  const result = await api(`/api/rooms/${encodeURIComponent(roomId)}/join`,{method:'POST',body:JSON.stringify({role})});
  const url = safeUrl(result.url);
  if (!url) throw new Error('This room does not have a playable game link yet.');
  location.assign(url);
}
function ownRoomsPanel() {
  const own = rows('ownRooms');
  if (!own.length) return '';
  return `<section class="own-rooms section-space"><div class="section-heading"><h2>${icon('game')}Your room is waiting</h2><span class="section-note">SAME FRIENDS. SAME CANVAS.</span></div>${own.map(room => `<div class="own-room-row"><div><h3>${e(room.name || (room.mode === 'ranked' ? 'Your ranked room' : 'Your sketch club'))}</h3><p>${e(room.status || 'Ready to play')} · ${room.private || room.isPrivate ? 'Invite only' : 'Open to the community'}</p></div><div class="admin-actions">${button('Jump back in','resume-room','arrow','primary',`data-id="${e(room.id)}"`)}${button('Invite friends','share-room','people','outline',`data-id="${e(room.id)}"`)}${['created','waiting','pending','lobby','provisioning'].includes(room.status || 'waiting') ? button('Close room','cancel-room','','outline',`data-id="${e(room.id)}"`) : ''}</div></div>`).join('')}</section>`;
}
function engineNote() {
  if (!state.data.engine) return '';
  const available = state.data.engine.available === true;
  return `<div class="connection-note ${available ? 'connected' : ''}">${icon(available ? 'check' : 'info')}<span>${available ? `Original game engine connected · private rooms are ready.${state.data.engine.ranked ? ' Ranked is open.' : ' Ranked competition is not enabled.'}` : 'The drawing server is not connected yet. The community is open for exploring.'}</span></div>`;
}
function inviteModal() {
  return `<div class="modal-icon">${icon('people')}</div><h2 id="modal-title">There’s a canvas for you.</h2><p>You’ve been invited to a Skribbil room. Bring your best guesses and your most questionable drawing skills.</p><div class="rules-box">Joining takes you into the original multiplayer drawing game. ${user() ? 'Your community account comes with you.' : 'Create an account or log in to take your seat.'}</div>${button(user() ? 'Take my seat' : 'Join the community','accept-invite','arrow','yellow')}<p class="form-note">The server checks the room is open and you’re allowed to join.</p>`;
}
function shareModal() {
  const invite = `${location.origin}/?join=${encodeURIComponent(state.shareRoomId)}`;
  return `<div class="modal-icon">${icon('people')}</div><h2 id="modal-title">Save a seat for your people.</h2><p>Send this room invitation to your friends. They’ll sign in with their own community account.</p><div class="form-field"><label for="invite-link">Your room invitation</label><input id="invite-link" readonly value="${e(invite)}"/></div>${button('Copy invitation','copy-invite','people','yellow')}<p class="form-note">Share the room invitation. Each player gets their own game connection when they join.</p>`;
}
async function copyInvite() {
  const input = $('#invite-link');
  try { await navigator.clipboard.writeText(input.value); toast('Invitation copied. Send it to your favorite scribblers.'); }
  catch { input.focus(); input.select(); toast('Your invitation is selected. Copy it with Ctrl+C.'); }
}
async function openMatch(matchId) {
  if (!matchId || matchId === 'undefined') throw new Error('This match does not have a saved result link yet.');
  const result = await api(`/api/matches/${encodeURIComponent(matchId)}`);
  state.match = {...result,match:{...result.match,id:result.match?.id || matchId}};
  openModal('match');
}
function rematchButton(match) {
  if (match.mode === 'tournament') return '';
  const rankedPaused = match.mode === 'ranked' && state.data.engine?.ranked !== true;
  return button('Quick rematch','quick-rematch','refresh','primary',`data-id="${e(match.id)}" ${rankedPaused ? 'disabled title="Ranked play is not enabled on this server."' : ''}`);
}
function matchModal() {
  const result = state.match;
  if (!result) return '<h2 id="modal-title">Match details unavailable.</h2>';
  const match = result.match;
  const participants = result.participants || [];
  const drawings = result.drawings || [];
  const eligible = participants.filter(player => (player.userId || player.id) !== user()?.id);
  return `<div class="modal-icon">${icon('trophy')}</div><h2 id="modal-title">That was a good round.</h2><p>${e(match.gameName || 'Skribbil')} · ${e(readableDate(match.endedAt || match.ended_at || match.createdAt))} · ${e(match.status || 'Match record')}</p><div class="panel table-scroll section-space"><table class="data-table"><thead><tr><th>Scribbler</th><th>Points</th><th>Place</th></tr></thead><tbody>${participants.map(player => `<tr><td>${e(displayName(player))}</td><td>${number(player.score ?? player.points)}</td><td>${player.rank ? `#${number(player.rank)}` : '—'}</td></tr>`).join('') || '<tr><td colspan="3">Results have not been recorded yet.</td></tr>'}</tbody></table></div>${eligible.length && user() ? `<form data-form="mvp" class="section-space">${errorSlot()}<h3 style="margin-bottom:14px">Give them their flowers.</h3><div class="form-grid"><div class="form-field"><label for="mvp-person">Your MVP</label><select id="mvp-person" name="nomineeId" required><option value="">Choose a scribbler</option>${eligible.map(player => `<option value="${e(player.userId || player.id)}">${e(displayName(player))}</option>`).join('')}</select></div><div class="form-field"><label for="mvp-category">What made them great?</label><select id="mvp-category" name="category"><option value="best_drawing">Best drawing</option><option value="fastest_guesser">Fastest guesser</option></select></div></div>${button('Cast my MVP vote','submit','star','yellow','type="submit"')}<p class="form-note">Voting eligibility and the voting window are checked by the server.</p></form>` : ''}${drawings.length ? `<h3 style="margin-bottom:12px">The match sketchbook</h3><div class="match-drawings">${drawings.map(drawing => { const url = safeUrl(drawing.url || drawing.imageUrl || drawing.assetUrl); return `<div class="match-drawing">${url ? `<img src="${e(url)}" alt="${e(drawing.prompt || 'Match drawing')}" loading="lazy"/>` : icon('image')}<p>${e(drawing.prompt || 'Untitled doodle')}</p>${drawing.replayAvailable || drawing.hasReplay || drawing.replayKey ? `<a class="text-link" href="/api/drawings/${encodeURIComponent(drawing.id)}/replay" download>Drawing operations ↓</a>` : ''}</div>`; }).join('')}</div><p class="bracket-caption">Archived operations are downloadable drawing data. They are not a timed replay.</p>` : ''}<div class="admin-actions">${button('Save summary card','save-summary','image','outline')}${match.status === 'completed' ? rematchButton(match) + button('Report a score issue','report-dispute','flag','outline') : ''}</div>`;
}
async function loadMyDrawings() {
  try {
    const result = await api('/api/drawings/mine');
    state.myDrawings = Array.isArray(result) ? result : result.drawings || [];
    openModal('my-drawings');
  } catch(error) { toast(error.message,true); }
}
function myDrawingsModal() {
  const drawings = state.myDrawings || [];
  return `<div class="modal-icon">${icon('palette')}</div><h2 id="modal-title">Your personal sketchbook.</h2><p>Manage whether your drawings can be considered for the public gallery. An administrator still curates what appears there.</p>${drawings.length ? drawings.map(drawing => { const allowed = drawing.allowPublic ?? drawing.consent ?? drawing.publicConsent ?? false; const url = safeUrl(drawing.url || drawing.imageUrl || drawing.assetUrl); return `<div class="personal-drawing">${url ? `<img src="${e(url)}" alt="${e(drawing.prompt || 'Your drawing')}" loading="lazy"/>` : icon('image')}<div><h3>${e(drawing.prompt || 'Untitled doodle')}</h3><p>${e(readableDate(drawing.date || drawing.createdAt))} · ${allowed ? 'Gallery permission granted' : 'Private sketchbook'}</p>${drawing.replayAvailable || drawing.hasReplay || drawing.replayKey ? `<a class="text-link" href="/api/drawings/${encodeURIComponent(drawing.id)}/replay" download>Download drawing operations</a>` : ''}</div>${button(allowed ? 'Make private' : 'Allow gallery','drawing-consent','','outline',`data-id="${e(drawing.id)}" data-allow="${!allowed}"`)}</div>`; }).join('') : empty('Your sketchbook is a clean slate.','Drawings saved from your matches will appear here. Some doodles are simply too good to forget.')}`;
}
async function updateDrawingConsent(element) {
  element.disabled = true;
  try {
    await api(`/api/drawings/${encodeURIComponent(element.dataset.id)}/consent`,{method:'POST',body:JSON.stringify({allow:element.dataset.allow === 'true'})});
    await loadMyDrawings();
    toast('Your drawing’s gallery permission has been updated.');
  } finally { if (element.isConnected) element.disabled = false; }
}
async function downloadSummary(result) {
  const match = result.match;
  const participants = (result.participants || []).slice().sort((a,b) => Number(b.score ?? b.points)-Number(a.score ?? a.points));
  const champion = participants[0];
  const art = (result.drawings || []).find(drawing => drawing.url || drawing.imageUrl || drawing.assetUrl);
  let artImage = '';
  if (art) {
    const url = safeUrl(art.url || art.imageUrl || art.assetUrl);
    if (url) try {
      const response = await fetch(url,{credentials:'same-origin'});
      if (response.ok) {
        const blob = await response.blob();
        if (/^image\/(png|jpeg|webp)$/.test(blob.type) && blob.size <= 5 * 1024 * 1024) {
          const dataUrl = await new Promise((resolve,reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(blob); });
          artImage = `<image x="485" y="115" width="330" height="240" href="${e(dataUrl)}" preserveAspectRatio="xMidYMid meet"/>`;
        }
      }
    } catch { /* A summary remains useful if the artwork has expired. */ }
  }
  const artwork = artImage || catArt.replace('<svg ', '<svg x="490" y="110" width="320" height="240" ');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="500" viewBox="0 0 900 500"><rect width="900" height="500" fill="#f6f5f0"/><rect x="25" y="25" width="850" height="450" rx="24" fill="#fff" stroke="#242540" stroke-width="3"/><path d="M49 25h802q24 0 24 24v36H25V49q0-24 24-24Z" fill="#5347d9"/><text x="56" y="65" fill="#fff" font-family="Arial,sans-serif" font-size="28" font-weight="bold">skribbil.</text><text x="820" y="61" text-anchor="end" fill="#ffdc72" font-family="Arial,sans-serif" font-size="13">DRAW. GUESS. GLORY.</text><text x="57" y="142" fill="#8d7aa6" font-family="Arial,sans-serif" font-size="12">DUSSEHRA LEAGUE · MATCH SCRAPBOOK</text><text x="57" y="195" fill="#242540" font-family="Arial,sans-serif" font-size="34" font-weight="bold">A round to remember.</text><text x="57" y="235" fill="#81718f" font-family="Arial,sans-serif" font-size="16">${e(readableDate(match.endedAt || match.ended_at || match.createdAt))} · ${plural(participants.length,'scribbler')}</text><text x="57" y="290" fill="#5347d9" font-family="Arial,sans-serif" font-size="24" font-weight="bold">${e(champion ? displayName(champion) : 'A community masterpiece')}</text><text x="57" y="325" fill="#81718f" font-family="Arial,sans-serif" font-size="16">${champion ? `${number(champion.score ?? champion.points)} points · top of the canvas` : 'Bad drawings. Good company.'}</text>${artwork}<text x="650" y="381" text-anchor="middle" fill="#9983aa" font-family="Arial,sans-serif" font-size="12">${artImage ? `From the match: ${e(art.prompt || 'a masterpiece')}` : 'Art skills absolutely optional.'}</text><path d="M57 413h786" stroke="#e3e2ec"/><text x="57" y="447" fill="#9c8bab" font-family="Arial,sans-serif" font-size="12">Your community. Your story. One more round?</text></svg>`;
  const downloadUrl = URL.createObjectURL(new Blob([svg],{type:'image/svg+xml'}));
  const anchor = document.createElement('a'); anchor.href = downloadUrl; anchor.download = `skribbil-match-${String(match.id || 'summary').replace(/[^a-zA-Z0-9-]/g,'')}.svg`; document.body.append(anchor); anchor.click(); anchor.remove(); setTimeout(() => URL.revokeObjectURL(downloadUrl),10000);
  toast('Your match summary card is ready to keep.');
}

async function api(path, options = {}) {
  const accountEpoch = state.accountEpoch || 0;
  const controller = new AbortController();
  const mediaUpload=options.method==='POST'&&(path==='/api/profile/avatar'||/^\/api\/teams\/[^/]+\/logo$/.test(path));
  const timer = setTimeout(() => controller.abort(), mediaUpload?30000:12000);
  try {
    const response = await fetch(path, {credentials:'same-origin',signal:controller.signal,...options,headers:{'Accept':'application/json',...(options.body ? {'Content-Type':'application/json'} : {}),...(options.method && options.method !== 'GET' ? {'X-Requested-With':'Skribbil'} : {}),...options.headers}});
    let result;
    try { result = await response.json(); } catch { throw new Error(response.ok ? 'The server returned an unexpected response. Please try again.' : 'The community server is unavailable. Please try again in a moment.'); }
    if (accountEpoch !== (state.accountEpoch || 0)) { const error = new Error('Your account changed. Please try again.'); error.code = 'ACCOUNT_CHANGED'; throw error; }
    if (!response.ok) throw new Error(result.error || `The request could not be completed (${response.status}).`);
    return result;
  } catch (error) { if (error.name === 'AbortError') throw new Error('The server took too long to respond. Please try again.'); throw error; }
  finally { clearTimeout(timer); }
}
function resetAccountViews() {
  state.photoGeneration=(state.photoGeneration||0)+1;state.photoCropper?.dispose();state.photoCropper=null;
  state.avatarDraft = null;
  state.accountEpoch = (state.accountEpoch || 0) + 1;
  for (const key of ['admin','adminDisputes','adminDisputesError','disputes','activeDispute','match','myDrawings','myTeams','teamDetail','teamTournament','teamsError','partyState','partyError','clubhouseState','clubhouseDetail','clubhouseRequest','clubhouseRequests','clubhousesError','clubhouseRequestsError','roomClubhouseId','roomClubhouseName','friendDecision','friendsError','friendProfile','friendProfileError','friendProfileId','friendProfileRequest','friendSearch']) state[key] = null;
  state.teamsLoaded = state.partyLoaded = state.clubhousesLoaded = false;
  state.teamsLoading = state.partyLoading = state.clubhousesLoading = state.friendsLoading = false;
}
async function refresh({silent = false} = {}) {
  try { const data = await api('/api/bootstrap'); if ((data.user?.id || null) !== (user()?.id || null)) { resetAccountViews(); if (state.modal && !['auth','room','invite'].includes(state.modal)) closeModal(); } state.data = data; state.error = null; }
  catch (error) { if (error.code === 'ACCOUNT_CHANGED') return; state.error = error.message; if (silent) throw error; }
  render();
  if (state.modal === 'room') {
    const form = $('form',dialogRoot);
    const values = form ? Object.fromEntries(new FormData(form)) : {};
    renderModal();
    const newForm = $('form',dialogRoot);
    for (const [name,value] of Object.entries(values)) {
      const input = newForm?.elements.namedItem(name);
      if (input && input.type !== 'checkbox') input.value = value;
    }
    const privacy = newForm?.elements.namedItem('private');
    if (privacy && form) privacy.checked = !!state.roomClubhouseId || values.private === 'on';
  }
  if (state.route === 'clubhouses' && user() && !state.clubhousesLoaded && !state.clubhousesLoading) await loadClubhouses({quiet:true});
  if (state.route === 'friends' && user() && !state.partyLoaded && !state.partyLoading) await loadParty({quiet:true});
  if (state.route === 'friends' && user() && !state.teamsLoaded && !state.teamsLoading) await loadMyTeams({quiet:true});
}
function currentRoute() { const route = location.hash.replace(/^#\/?/,'').split('?')[0] || 'home'; return ['home','skribbil','league','tournaments','community','profile','friends','clubhouses','admin'].includes(route) ? route : 'home'; }
const routeLabels = {home:'Clubhouse',skribbil:'Skribbil',league:'The league',tournaments:'Tournaments',community:'The gallery',profile:'Your profile',friends:'Friends & teams',clubhouses:'Clubhouses',admin:'Admin dashboard'};
function render() {
  state.route = currentRoute();
  if (state.route === 'admin' && !isAdmin()) state.route = 'home';
  document.title = `${routeLabels[state.route]} · Skribbil Communities`;
  app.innerHTML = `<div class="app-layout ${state.mobileNav ? 'nav-open' : ''}">
    <button class="mobile-scrim" data-action="toggle-nav" aria-label="Close navigation"></button>
    ${sidebar()}
    <div class="main-column">${topbar()}<main class="content" id="main-content">${state.error ? `<div class="engine-banner">${icon('info')}<span>${e(state.error)} Some community data could not be loaded.</span>${button('Retry','refresh','refresh','outline')}</div>` : ''}${renderPage()}${footer()}</main></div>
  </div>`;
  syncMobileNavigation();
}
function syncMobileNavigation() { const sidebar = $('.sidebar'); if (sidebar) sidebar.inert = typeof window !== 'undefined' && window.matchMedia('(max-width:760px)').matches && !state.mobileNav; }
function sidebar() {
  const links = [['home','home','Clubhouse'],['skribbil','pencil','Skribbil'],['league','trophy','The league'],['tournaments','sword','Tournaments'],['community','palette','Hall of doodles']];
  const community = [['clubhouses','people','Your Clubhouses'],['friends','people','Friends & teams'],['profile','user','My profile']];
  function nav([route,ico,label]) { return `<a class="nav-link ${route === 'skribbil' ? 'nav-game' : ''} ${state.route === route ? 'active' : ''}" href="#/${route}" ${state.route === route ? 'aria-current="page"' : ''}>${icon(ico)}<span>${label}</span></a>`; }
  return `<aside class="sidebar" id="primary-navigation" aria-label="Main navigation"><a class="brand" href="#/home" aria-label="Skribbil Communities home"><img class="community-brand" data-community-logo src="${document.documentElement?.dataset.theme === 'dark' ? '/assets/skribbil-communities.png' : '/assets/skribbil-communities-light.png'}" width="2172" height="724" alt="Skribbil Communities — the red-caped doodle hero"/></a><div class="brand-sub">YOUR PEOPLE. YOUR PLACE.</div><div class="nav-label">OUR COMMUNITY</div><nav class="nav-list">${links.map(nav).join('')}</nav><div class="nav-divider"></div><div class="nav-label">YOUR CORNER</div><nav class="nav-list">${community.map(nav).join('')}${isAdmin() ? nav(['admin','shield','Admin dashboard']) : ''}</nav><div class="sidebar-bottom"><div class="season-card"><div class="tiny">OUR SHARED LEAGUE</div><h3>Dussehra League</h3><p>Little doodles.<br>Legendary rivalries.</p><a class="season-link" href="#/league">Meet your competition ${icon('arrow')}</a>${icon('trophy')}</div><div class="sidebar-footer">Made for friends. <span class="heart">♥</span> Fueled by chaos.</div></div></aside>`;
}
function topbar() { const person = user(); return `<header class="topbar"><button class="icon-button mobile-toggle" data-action="toggle-nav" aria-label="${state.mobileNav ? 'Close' : 'Open'} navigation" aria-controls="primary-navigation" aria-expanded="${state.mobileNav}">${icon('menu')}</button><div class="breadcrumb"><span>Your community</span>${icon('chevron')}<strong>${routeLabels[state.route]}</strong></div><div class="topbar-actions"><button type="button" class="icon-button theme-toggle" data-theme-toggle aria-label="Dark" aria-pressed="${document.documentElement?.dataset.theme === 'dark'}" title="${document.documentElement?.dataset.theme === 'dark' ? 'Switch to the original theme' : 'Switch to dark mode'}">${icon('moon')}<span class="theme-toggle-label">Dark</span></button><span class="status-pill"><span class="status-dot"></span>${state.data.mode === 'embedded-postgres' ? 'LOCAL COMMUNITY' : 'DUSSEHRA LEAGUE'}</span><button class="account-button" data-action="${person ? 'account-settings' : 'auth'}">${avatar(person || {displayName:'You'})}<span class="account-text">${person ? e(displayName(person)) : 'Hey, new friend!'}<small>${person ? `${person.level != null ? `Level ${number(person.level)} · ` : ''}${e(person.title || 'No title equipped')}` : 'Join the scribble squad'}</small></span>${icon('down')}</button></div></header>`; }
function footer() { return `<footer class="content-footer"><span class="footer-note">${icon('pencil')}Your people. Your games. Skribbil Communities.</span><span><button data-action="help">How it works</button> &nbsp;·&nbsp; <a href="https://github.com/scribble-rs/scribble.rs" target="_blank" rel="noreferrer">Powered by scribble.rs ↗</a></span></footer>`; }
function renderPage() { return ({home:homePage,skribbil:skribbilPage,league:leaguePage,tournaments:tournamentsPage,community:communityPage,profile:profilePage,friends:friendsPage,clubhouses:clubhousesPage,admin:adminPage}[state.route] || homePage)(); }

function hero() { return `<section class="hero" aria-label="Play Skribbil"><div class="hero-copy"><div class="hero-tag">${icon('sparkle')}BIG IDEAS. QUESTIONABLE ART.</div><h2>Draw terribly.<br>Guess <span>brilliantly.</span></h2><p>A little friendly competition. A lot of “how is that a cat?” Grab a pencil. Your people are here.</p><div class="hero-actions">${button('Let’s play','play','pencil','yellow')}${button('Create a room','private-room','plus','outline')}</div>${icon('sparkle','hero-spark')}<span class="hero-tiny-spark" aria-hidden="true">✧</span></div><div class="hero-art">${icon('sparkle','hero-star')}<div class="drawing-board"><div class="board-top"><span>A LITTLE CAT ILLUSTRATION</span><span class="board-dots"><i></i><i></i><i></i></span></div><div class="board-canvas">${catArt}</div><div class="board-toolbar">${['#2c293e','#f7f4ec','#ef7568','#ffbe61','#e7d668','#90c69d','#84b8d6','#ae95d4'].map((color,i) => `<span class="color-dot ${i === 3 ? 'selected' : ''}" style="background:${color}"></span>`).join('')}${icon('pencil')}</div></div><span class="guess-bubble cat"><span class="bubble-avatar">☺</span> a potato??</span><span class="guess-bubble yes"><span class="bubble-avatar blue">✿</span> Definitely a cat.</span><span class="doodle-note">art skills absolutely optional ↖</span></div></section>`; }
function gameShelf() {
  return `<section class="community-games" aria-labelledby="community-games-title"><div class="section-heading"><h2 id="community-games-title">${icon('game')}Games in the Clubhouse</h2><span class="section-note">ONE ACCOUNT. ALL YOUR PEOPLE.</span></div><a class="game-entry" href="#/skribbil"><span class="game-entry-icon">${icon('pencil')}</span><div><span class="tiny">DRAW &amp; GUESS</span><h2>Skribbil</h2><p>The original drawing-room chaos. Your community account, avatar, and friends come with you.</p></div><span class="game-entry-link">Open game ${icon('arrow')}</span></a><p class="form-note">Skribbil is our first game. The Clubhouse, profiles, and Dussehra League are shared across the community.</p></section>`;
}
function skribbilPage() {
  const rooms = rows('rooms');
  return `${heading('A GAME IN THE CLUBHOUSE','Skribbil','Draw terribly. Guess brilliantly.', '<a class="text-link" href="#/home">← Clubhouse</a>')}${hero()}${engineNote()}${ownRoomsPanel()}<section class="section-space"><div class="section-heading"><h2>${icon('game')}Skribbil rooms</h2><a class="text-link" href="#/clubhouses">Your Clubhouses ${icon('arrow')}</a></div><div class="panel">${rooms.length ? rooms.map(roomRow).join('') : empty('A clean canvas awaits.','No public rooms are open right now. Create a room and invite your people.',button('Create a room','private-room','plus','outline'))}<div class="panel-footer">${icon('lock')}Private Clubhouse rooms are available to invited members inside Your Clubhouses.</div></div></section>`;
}

function homePage() {
  const person = user();
  const stats = person?.stats || {};
  const statItems = [ ['trophy','All-time points',person ? (person.points ?? stats.points ?? stats.totalPoints ?? 0) : '—','yellow'],['bolt','Your XP',person ? (person.xp ?? 0) : '—',''],['target','Matches played',person ? (person.gamesPlayed ?? stats.matchesPlayed ?? stats.matches ?? 0) : '—','green'],['medal','Your level',person ? (person.level ?? '—') : '—','orange'] ];
  const rooms = rows('rooms');
  const leaders = rows('leaderboard');
  const challenges = rows('challenges');
  return `${heading('GOOD COMPANY. GREAT GAMES.',person ? `Hey, ${displayName(person)}!` : 'Welcome to the Clubhouse.', 'Your friends, your games, and a league to share.',`<span class="date-note">${icon('calendar')}Dussehra League · Community</span>`)}${gameShelf()}${ownRoomsPanel()}<section class="stat-grid" aria-label="Your progress">${statItems.map(([ico,label,value,color]) => `<div class="stat-card"><span class="stat-icon ${color}">${icon(ico)}</span><div><small>${label}</small><strong>${value === '—' ? '—' : number(value)}</strong></div></div>`).join('')}</section><div class="dashboard-grid"><div><section><div class="section-heading"><h2>${icon('game')}Skribbil rooms</h2><button class="text-link" data-action="private-room">Create a room ${icon('arrow')}</button></div><div class="panel">${rooms.length ? `<div class="room-list">${rooms.slice(0,4).map(roomRow).join('')}</div>` : empty('A clean canvas awaits.','No public rooms are open right now. Create a room and invite your people.',button('Create a room','private-room','plus','outline'))}<div class="panel-footer">${icon('people')}Private invitation-only rooms stay off this list.</div></div></section><section class="dashboard-secondary"><div class="section-heading"><h2>${icon('trophy')}The ones to beat</h2><a class="text-link" href="#/league">Full leaderboard ${icon('arrow')}</a></div><div class="panel">${leaders.length ? `<div class="leaderboard-mini">${leaders.slice(0,3).map(leaderboardMini).join('')}</div>` : empty('The leaderboard is a clean slate.','Verified match results will put the first names on the board.')}<div class="panel-footer">${icon('flag')}All-time standings · shared across the community.</div></div></section></div><div><section><div class="section-heading"><h2>${icon('bolt')}A little side quest</h2>${challenges.length ? `<span class="reset-note">${icon('clock')}DAILY & WEEKLY</span>` : ''}</div><div class="panel">${challenges.length ? `<div class="challenge-panel">${challenges.slice(0,3).map(challengeRow).join('')}</div>` : empty(person ? 'No active challenges.' : 'Your side quests live here.',person ? 'Available challenges and your progress will appear here.' : 'Sign in to see your available challenges and progress.',person ? '' : button('Join the community','auth','arrow','outline'))}</div></section><section class="dashboard-secondary"><div class="section-heading"><h2>${icon('sword')}For the glory</h2><span class="section-note">${rows('tournaments').length ? 'TOURNAMENT BOARD' : 'NO EVENTS SCHEDULED'}</span></div>${eventPreview()}</section></div></div>`;
}

function roomRow(room,index) {
  const styles = ['','orange','green'];
  const ranked = room.mode === 'ranked';
  const name = room.name || room.title || (ranked ? 'Ranked room' : 'Private room');
  const population = room.playerCount ?? (Array.isArray(room.players) ? room.players.length : room.players);
  const details = [room.rounds != null ? plural(room.rounds,'round') : '',room.drawTime != null ? `${number(room.drawTime)} sec` : '',room.status || ''].filter(Boolean);
  return `<div class="room-row"><span class="room-icon ${styles[index%3]}">${icon(ranked ? 'trophy' : 'palette')}</span><div class="room-info"><div class="room-name">${e(name)}${tag(ranked ? 'RANKED' : 'CASUAL',ranked ? '' : 'orange')}</div><div class="room-desc">${details.map(e).join('<span>·</span>')}</div></div><span class="room-population">${icon('people')}${population == null ? 'Players unavailable' : room.capacity != null ? `${number(population)}/${number(room.capacity)}` : plural(population,'player')}</span>${button('Join','join-room','','primary',`data-id="${e(room.id)}"`)}<button class="icon-button spectate-button" data-action="spectate-room" data-id="${e(room.id)}" aria-label="Watch this room">${icon('eye')}</button></div>`;
}

function leaderboardMini(player,index) { return `<div class="leaderboard-row"><span class="rank ${index === 0 ? 'first' : ''}">${index === 0 ? icon('crown') : String(index+1).padStart(2,'0')}</span>${avatar(player,'sm')}<div><div class="player-name">${e(displayName(player))}</div><div class="player-title">${e(player.title || (player.level != null ? `Level ${player.level} scribbler` : ''))}</div></div><div class="player-points">${number(player.points ?? player.totalPoints)}<small>points</small></div></div>`; }
function challengeRow(challenge,index) { const target = Number(challenge.target ?? challenge.goal ?? 1); const progress = Math.max(0,Number(challenge.progress || 0)); const complete = progress >= target; return `<div class="challenge-row"><span class="challenge-icon">${icon(challenge.icon || ['bolt','trophy','pencil'][index%3])}</span><div><h3>${e(challenge.name || challenge.title)}</h3><p>${e(challenge.description || '')}</p><div class="challenge-progress"><div class="progress-track"><span style="width:${Math.min(100,progress/Math.max(1,target)*100)}%"></span></div><small>${number(Math.min(progress,target))}/${number(target)}</small></div></div>${complete && !challenge.claimed ? button('Claim','claim','','yellow',`data-id="${e(challenge.id)}"`) : `<span class="xp-label">${challenge.claimed ? '✓ CLAIMED' : challenge.xp != null || challenge.xpReward != null ? `+${number(challenge.xp ?? challenge.xpReward)} XP` : ''}</span>`}</div>`; }
function tournamentFormat(value) { return ({knockout:'Knockout',groups_knockout:'Groups then knockout',round_robin:'Round robin',group:'Group stage'})[value] || value || 'Format not published'; }
function eventPreview() {
  const event = rows('tournaments')[0];
  return `<div class="event-card"><div class="event-label">${icon('calendar')}${event ? e(readableDate(event.startsAt || event.startDate)) : 'NO EVENTS SCHEDULED'}</div><h3>${e(event?.name || 'The tournament board is clear.')}</h3><p>${event ? e(tournamentFormat(event.format)) + ' · ' + e(event.status || 'Details on the tournament page') : 'Published tournaments and registration details will appear here.'}</p><a class="button" href="#/tournaments">${event ? 'See the tournament' : 'Tournament board'} ${icon('arrow')}</a><span class="event-trophy">${trophyArt}</span></div>`;
}

function leaguePage() {
  const allTime = state.leaderboardTab === 'all-time';
  const season = state.data.season;
  const players = boardPlayers();
  if (allTime) players.sort((a,b) => Number(b.totalPoints ?? b.points)-Number(a.totalPoints ?? a.points));
  const top = players.slice(0,3);
  const query = state.search.trim().toLowerCase();
  const filtered = players.map((player,index) => ({...player,rank:index+1})).filter(player => displayName(player).toLowerCase().includes(query));
  const seasonCopy = allTime ? 'Every recorded point and win, across seasons.' : !season ? 'A season has not been opened. All-time results remain available in the next tab.' : season.endsAt ? `This season closes ${readableDate(season.endsAt)}. Your history stays with you.` : 'Results from this season appear below. Previous seasons remain part of your history.';
  return `${heading('DRAW YOUR WAY TO THE TOP.','A league of your own.','Friendly faces. Fierce competition. Every great guess counts.')}<section class="league-season">${icon('trophy')}<div><h2>${e(allTime ? 'The all-time greats' : season?.name || 'No active season')}</h2><p>${e(seasonCopy)}</p></div>${tag(allTime ? 'ALL-TIME' : season ? 'THIS SEASON' : 'NOT STARTED')}</section>${top.length ? `<div class="podium-grid">${top.map((player,i) => `<article class="podium-card ${i === 0 ? 'winner' : ''}"><div class="podium-label">${i === 0 ? 'THE ONE TO BEAT' : i === 1 ? 'HOT ON THEIR HEELS' : 'COMING FOR THE CROWN'}</div>${avatar(player,'lg')}<h3>${e(displayName(player))}</h3>${player.title ? `<p>${e(player.title)}</p>` : ''}<strong>${number(allTime ? (player.totalPoints ?? player.points) : player.points)}</strong></article>`).join('')}</div>` : ''}<div class="toolbar"><div class="tabs" role="tablist" aria-label="Leaderboard period"><button role="tab" aria-selected="${!allTime}" class="tab ${!allTime ? 'active' : ''}" data-action="leaderboard-tab" data-value="season">This season</button><button role="tab" aria-selected="${allTime}" class="tab ${allTime ? 'active' : ''}" data-action="leaderboard-tab" data-value="all-time">All-time legends</button></div><label class="search-wrap">${icon('search')}<input id="player-search" type="search" placeholder="Find a scribbler…" aria-label="Find a player" value="${e(state.search)}"/></label></div><div class="panel table-scroll"><table class="data-table"><thead><tr><th>Rank</th><th>Scribbler</th><th>Points</th><th>Wins</th><th>Matches</th><th>Level</th></tr></thead><tbody id="leaderboard-body">${leaderboardTableRows(filtered)}</tbody></table></div>`;
}

function leaderboardTableRows(players) {
  if (!players.length) return `<tr><td colspan="6" class="table-empty">${boardPlayers().length ? 'No scribblers found. Try another name.' : 'No verified results yet. The first recorded matches will start this leaderboard.'}</td></tr>`;
  return players.map(player => `<tr><td><span class="table-rank">${String(player.rank).padStart(2,'0')}</span></td><td><div class="table-player">${avatar(player)}<div><strong>${e(displayName(player))}</strong>${player.title ? `<div class="player-title">${e(player.title)}</div>` : ''}</div></div></td><td class="table-points">${number(state.leaderboardTab === 'all-time' ? player.totalPoints ?? player.points : player.points)}</td><td>${number(player.wins)}</td><td>${number(player.gamesPlayed ?? player.matchesPlayed ?? player.played ?? player.matches)}</td><td>${player.level != null ? number(player.level) : '—'}</td></tr>`).join('');
}

function tournamentsPage() {
  const events = rows('tournaments');
  return `${heading('SMALL DOODLES. BIG STAKES.','Bring your A-game.','The stage is yours. The drawing skills are optional.')}<div class="split-grid"><div>${events.length ? events.map(tournamentCard).join('') : empty('No tournaments scheduled.','An organizer can publish a tournament, open registration, and build the official bracket. Published events will appear here.',isAdmin() ? button('Create tournament','admin-create-tournament','plus','yellow') : '')}</div><aside><div class="info-card section-space"><h3>May the best doodler win.</h3><ul class="rule-list"><li>${icon('shield')}Competitive matches use locked rules for a level playing field.</li><li>${icon('people')}Your account and league identity travel with you across future games.</li><li>${icon('trophy')}Results become part of your permanent match history.</li><li>${icon('flag')}A score dispute? An admin can review the match audit trail.</li></ul></div><div class="event-card"><div class="event-label">${icon('people')}BETTER TOGETHER</div><h3>Find your<br>scribble squad.</h3><p>Make a team. Pick a name. Give your rivals something to remember.</p><a class="button" href="#/friends">Meet the teams ${icon('arrow')}</a><span class="event-trophy">${icon('shield')}</span></div></aside></div>`;
}

function tournamentCard(event) {
  const registered = event.joined === true || event.isRegistered === true || event.registered === true || event.registrations?.some(entry => (entry.userId || entry.id) === user()?.id);
  const registrationOpen = ['registration','open','upcoming'].includes(event.status);
  const registrationCount = event.registrationCount ?? (typeof event.registered !== 'boolean' ? event.registered : undefined) ?? event.registrations?.length;
  return `<article class="tournament-card"><div class="tournament-cover">${trophyArt}<div>${tag(event.status || 'TOURNAMENT','yellow')}<h2 style="margin-top:12px">${e(event.name || event.title)}</h2><p>One community. One canvas. One champion.</p></div></div><div class="tournament-details"><div class="tournament-meta"><span>${icon('calendar')}${e(readableDate(event.startsAt || event.startDate))}</span>${registrationCount != null ? `<span>${icon('people')}${plural(registrationCount,'registration')}</span>` : ''}<span>${icon('sword')}${e(tournamentFormat(event.format))}</span></div><p>${e(event.description || 'Play fair, draw your best, and put your name on the leaderboard.')}</p>${registered ? button('You’re on the list','noop','check','outline','disabled') : button(registrationOpen ? event.entryType === 'team' ? 'Enter your team' : 'Count me in' : 'Registration closed','register-tournament','plus',registrationOpen ? 'primary' : 'outline',`data-id="${e(event.id)}" ${!registrationOpen ? 'disabled' : ''}`)}<div style="margin-top:13px">${button('View official bracket','view-bracket','sword','outline',`data-id="${e(event.id)}"`)}</div></div></article>`;
}

function communityPage() {
  const drawings = rows('drawings').filter(drawing => (drawing.hall || drawing.curation) === state.communityTab);
  return `${heading('SOME ART DESERVES A WALL.','The hall of doodles.','Masterpieces, happy accidents, and “what on earth is that?”')}<div class="toolbar"><div class="tabs" role="tablist" aria-label="Artwork gallery"><button role="tab" aria-selected="${state.communityTab === 'fame'}" class="tab ${state.communityTab === 'fame' ? 'active' : ''}" data-action="community-tab" data-value="fame">✦ Hall of fame</button><button role="tab" aria-selected="${state.communityTab === 'shame'}" class="tab ${state.communityTab === 'shame' ? 'active' : ''}" data-action="community-tab" data-value="shame">☺ Hall of shame</button></div><span class="section-note" style="font-size:10px;color:var(--muted)">${plural(drawings.length,'drawing')} · community curated</span></div>${drawings.length ? `<div class="gallery-grid">${drawings.map(artCard).join('')}</div>` : empty('The wall is waiting.','No drawings have been curated here yet. Your next doodle could be the first.')}<div class="info-card dashboard-secondary"><h3>Every doodle has a story.</h3><p>Artwork enters the public gallery with the artist’s permission and an administrator’s selection. Match drawings and replay data follow the community’s retention policy. The hall of shame celebrates funny drawing moments; it’s a place to laugh together.</p></div>`;
}

function artCard(drawing,index) {
  const assetUrl = safeUrl(drawing.url || drawing.imageUrl || drawing.assetUrl);
  const artist = typeof drawing.artist === 'object' ? displayName(drawing.artist) : drawing.artist || drawing.artistName || 'Artist unavailable';
  const art = assetUrl ? `<img src="${e(assetUrl)}" alt="${e(drawing.prompt || 'Saved match drawing')}" loading="lazy"/>` : `<div class="empty-state" style="border:0;background:none">${icon('image')}<p>Artwork is not available.</p></div>`;
  return `<article class="art-card"><div class="art-canvas ${['','lavender','blue'][index%3]}"><span class="art-label">${tag(drawing.hall === 'shame' ? 'AN ICONIC ATTEMPT' : 'WALL-WORTHY',drawing.hall === 'shame' ? 'orange' : 'yellow')}</span>${art}</div><div class="art-details"><h3>${e(drawing.title || drawing.prompt || 'Untitled drawing')}</h3>${drawing.prompt ? `<p>The word was <strong>${e(drawing.prompt)}</strong></p>` : ''}<div class="art-bottom"><span class="art-artist">${avatar({displayName:artist},'sm')}${e(artist)}</span><span>${drawing.date || drawing.createdAt ? e(readableDate(drawing.date || drawing.createdAt)) : 'Date unavailable'}</span></div></div></article>`;
}

function profilePage() {
  const person = user();
  if (!person) return `${heading('EVERY LEGEND STARTS SOMEWHERE.','Your story, in scribbles.','One account. Every game. A whole lot of character.')}<div class="split-grid"><div>${empty('Your profile starts with you.','Sign in to see your own match history, earned XP, achievements, and cosmetic collection.',button('Join the community','auth','pencil','yellow'))}</div><div class="info-card"><h3>Your people. Your progress.</h3><ul class="rule-list"><li>${icon('user')}Keep one username and profile across the whole community.</li><li>${icon('bolt')}Finish challenges and climb through the levels.</li><li>${icon('medal')}Collect achievements, titles, and tournament trophies.</li><li>${icon('palette')}Your earned cosmetic collection follows you into future games.</li></ul></div></div>`;
  const history = person.matchHistory || person.history || []; const xp = Number(person.xp || 0); const currentXp = person.nextLevelXp ? Math.min(100, xp / person.nextLevelXp * 100) : 0; return `${heading('LOOK AT YOU GO.','Your community profile.','Every win, every wild guess, every glorious doodle.')}<div class="profile-header">${avatar(person,'lg')}<div><h2>${e(displayName(person))}</h2><p>@${e(person.username)} · ${e(person.title || 'No title equipped')}</p><div class="profile-progress">${person.nextLevelXp ? `<div class="progress-track"><span style="width:${currentXp}%"></span></div>` : ''}<span>${number(xp)} XP</span></div></div><div class="profile-buttons">${button('Avatar','avatar','palette','yellow')}${button('Profile & settings','account-settings','user','outline')}${button('My drawings','my-drawings','palette','outline')}${button('My reports','my-disputes','flag','outline')}</div></div>${person.bio ? `<div class="info-card section-space"><p>${e(person.bio)}</p></div>` : ''}<div class="split-grid"><div><div class="section-heading"><h2>${icon('sparkle')}Your personal flair</h2>${person.level != null ? tag(`LEVEL ${person.level}`) : ''}</div>${cosmeticsCollection(person)}<section class="dashboard-secondary"><div class="section-heading"><h2>${icon('book')}The match scrapbook</h2></div>${history.length ? `<div class="panel table-scroll"><table class="data-table"><thead><tr><th>Match</th><th>Points</th><th>Result</th><th>Played</th></tr></thead><tbody>${history.map(match => `<tr><td><button class="text-link" data-action="view-match" data-id="${e(match.matchId || match.id)}">${e(match.game || match.gameName || 'Skribbil')} ${icon('arrow')}</button></td><td>${number(match.points || match.score)}</td><td>${e(match.result || (match.rank ? `#${match.rank}` : 'Completed'))}</td><td>${e(readableDate(match.playedAt || match.date || match.createdAt))}</td></tr>`).join('')}</tbody></table></div>` : empty('Your first match is calling.','Finished matches will appear here when verified results are recorded.',button('Pick up a pencil','play','pencil','yellow'))}</section></div><div><div class="section-heading"><h2>${icon('medal')}Little badges. Big energy.</h2></div>${awardsPanel(person)}</div></div>`; }
function cosmeticsCollection(person) {
  const owned = person?.cosmetics || person?.inventory || [];
  return owned.length ? `<div class="cosmetics">${owned.map(item => `<div class="cosmetic ${item.equipped ? 'unlocked' : ''}">${icon(item.slot === 'frame' ? 'image' : 'crown')}<h4>${e(item.name || item.slug)}</h4><p>${e(item.slot || 'Decoration')} · ${item.equipped ? 'equipped' : 'in your collection'}</p></div>`).join('')}</div><p class="bracket-caption">Your collection belongs to you across community games.</p>` : empty('A little room for personal flair.','Your unlocked decorations will appear here as you earn them.');
}

function friendsPage() { const accepted = rows('friends').filter(friend => friend.status === 'accepted'); const teams = rows('teams'); return `${heading('GOOD COMPANY. QUESTIONABLE GUESSES.','Better with your people.','Build a squad, start a rivalry, make it a regular thing.',button(state.socialTab === 'friends' ? 'Add a friend' : 'Create a team',state.socialTab === 'friends' ? 'add-friend' : 'create-team','plus','primary'))}<div class="toolbar"><div class="tabs" role="tablist" aria-label="Community connections"><button role="tab" aria-selected="${state.socialTab === 'friends'}" class="tab ${state.socialTab === 'friends' ? 'active' : ''}" data-action="social-tab" data-value="friends">Your friends · ${number(accepted.length)}</button><button role="tab" aria-selected="${state.socialTab === 'teams'}" class="tab ${state.socialTab === 'teams' ? 'active' : ''}" data-action="social-tab" data-value="teams">Community teams${teams.length ? ` · ${number(teams.length)}` : ''}</button></div>${state.socialTab === 'friends' && user() ? button(state.friendsLoading ? 'Refreshing…' : 'Refresh friends','refresh-friends','refresh','outline',state.friendsLoading || state.friendDecision ? 'disabled' : '') : ''}</div>${state.socialTab === 'teams' ? teamInvitationsPanel() : ''}${state.socialTab === 'friends' ? friendsPanel() : teams.length ? `<div class="team-grid">${teams.map(team => `<article class="team-card">${teamLogo(team)}<div><h3>${e(team.name)}</h3><p>${team.memberCount != null || team.members != null ? plural(team.memberCount ?? (Array.isArray(team.members) ? team.members.length : team.members),'member') : 'Member count unavailable'} · ${e(team.tag || 'Community squad')}</p></div><div class="team-card-actions">${(team.ownerId || team.captainId) === user()?.id ? tag('YOUR TEAM') : ''}${button('Meet the team','team-detail','arrow','outline',`data-id="${e(team.id)}"`)}</div></article>`).join('')}</div>` : empty('A legendary team name is calling.','Bring your friends together under one banner. Your team belongs to the community, across every game.',button('Create the first team','create-team','shield','yellow'))}${partyPanel()}<div class="info-card dashboard-secondary"><h3>Same squad. More possibilities.</h3><p>Clans are competitive tournament teams. Clubhouses are invite-only friend groups. Your account, friends, and team live at the community level. Skribbil is our first game; future games can use the same league identity, social connections, and cosmetic inventory.</p></div>`; }

function friendRow(friend, kind) {
  const name = displayName(friend);
  const decision = state.friendDecision?.id === friend.id ? state.friendDecision.action : null;
  const busy = !!state.friendDecision || !!state.friendsLoading;
  const caption = kind === 'incoming' ? 'Wants to be your friend.' : kind === 'sent' ? 'Waiting for their reply.' : friend.title || 'Your community friend';
  const identity = `${avatar(friend)}<span class="friend-details"><span class="friend-name">${e(name)}</span><span class="friend-username">@${e(friend.username)}</span><span class="friend-caption">${e(caption)}</span></span>`;
  return `<div class="friend-row friend-row-${kind}" data-friend-id="${e(friend.id)}" aria-busy="${!!decision}">${kind === 'accepted' ? `<button class="friend-profile-link" data-action="friend-profile" data-id="${e(friend.id)}" aria-label="${e(`View ${name}’s profile`)}">${identity}<span class="friend-profile-hint">View profile ${icon('arrow')}</span></button>` : `<div class="friend-identity">${identity}</div>`}${kind === 'incoming' ? `<div class="friend-request-actions">${button(decision === 'accept' ? 'Accepting…' : 'Accept','respond-friend','check','primary',`data-id="${e(friend.id)}" data-response="accept" aria-label="${e(`Accept friend request from ${name}`)}" ${busy ? 'disabled' : ''}`)}${button(decision === 'decline' ? 'Declining…' : 'Decline','respond-friend','close','outline',`data-id="${e(friend.id)}" data-response="decline" aria-label="${e(`Decline friend request from ${name}`)}" ${busy ? 'disabled' : ''}`)}</div>` : kind === 'sent' ? tag('Request sent','yellow') : ''}</div>`;
}
function friendListContent() {
  const query = (state.friendSearch || '').trim().toLowerCase();
  const accepted = rows('friends').filter(friend => friend.status === 'accepted').sort((a,b) => displayName(a).localeCompare(displayName(b)));
  const filtered = accepted.filter(friend => `${displayName(friend)} ${friend.username}`.toLowerCase().includes(query));
  return filtered.length ? filtered.map(friend => friendRow(friend,'accepted')).join('') : query ? empty('No friends found.','Try another name or username.') : empty('Good company starts here.','Add a friend by username. Once they accept, you can open their profile here.',button('Find a friend','add-friend','plus','primary'));
}
function friendsPanel() {
  if (!user()) return empty('Your people are waiting.','Sign in to connect with friends and keep your requests in one place.',button('Join the community','auth','people','yellow'));
  const people = rows('friends');
  const incoming = people.filter(friend => friend.status === 'pending' && friend.outgoing === false);
  const sent = people.filter(friend => friend.status === 'pending' && friend.outgoing === true);
  const accepted = people.filter(friend => friend.status === 'accepted');
  const requests = (title, people, kind, note) => `<section class="panel friend-section friend-requests-section"><div class="friend-section-header"><h2>${icon(kind === 'incoming' ? 'heart' : 'clock')}${e(title)}<span class="friend-section-count">${number(people.length)}</span></h2><p>${e(note)}</p></div><div class="friend-list">${people.length ? people.map(friend => friendRow(friend,kind)).join('') : `<div class="friend-quiet-state">${icon('check')}<div><h3>No requests waiting</h3><p>Requests you send will appear here until they’re accepted.</p></div></div>`}</div></section>`;
  return `<div class="friends-panel" aria-busy="${!!state.friendsLoading || !!state.friendDecision}">${state.friendsError ? `<div class="friend-request-error" role="alert">${icon('info')}<span>${e(state.friendsError)}</span></div>` : ''}<div class="friends-columns"><section class="panel friend-section friends-main"><div class="friend-section-header"><h2>${icon('people')}Your friends<span class="friend-section-count">${number(accepted.length)}</span></h2><p>Your regulars, all in one place. Select a friend to see their profile.</p><label class="friend-search" for="friend-search">${icon('search')}<input id="friend-search" type="search" placeholder="Search by name or username" value="${e(state.friendSearch || '')}" aria-label="Search your friends"/></label></div><div id="friends-list" class="friend-list" aria-live="polite">${friendListContent()}</div></section><aside class="friends-requests" aria-label="Friend requests">${incoming.length ? requests('Incoming requests',incoming,'incoming','A few new faces would like to connect.') : ''}${requests('Sent requests',sent,'sent','Your invitations, waiting for a reply.')}<p class="friends-note">${icon('info')}Accepted friends can join your party. Send a party invitation below to play together.</p></aside></div></div>`;
}
async function openFriendProfile(id) {
  if (!user() || !rows('friends').some(friend => friend.id === id && friend.status === 'accepted')) return;
  const epoch = state.accountEpoch || 0;
  const request = {};
  state.friendProfileRequest = request;
  state.friendProfile = null;
  state.friendProfileError = null;
  state.friendProfileId = id;
  openModal('friend-profile');
  try {
    const result = await api(`/api/friends/${encodeURIComponent(id)}/profile`);
    if (state.friendProfileRequest !== request || (state.accountEpoch || 0) !== epoch || state.modal !== 'friend-profile') return;
    state.friendProfile = result.profile;
  } catch (error) {
    if (state.friendProfileRequest !== request || (state.accountEpoch || 0) !== epoch || state.modal !== 'friend-profile') return;
    state.friendProfileError = error.message || 'This profile could not be loaded.';
  }
  if (state.friendProfileRequest === request && state.modal === 'friend-profile') renderModal();
}
function friendProfileModal() {
  const person = state.friendProfile;
  if (state.friendProfileError) return `<div class="modal-icon">${icon('user')}</div><h2 id="modal-title">Profile unavailable</h2><p role="alert">${e(state.friendProfileError)}</p>${button('Try again','friend-profile','refresh','primary',`data-id="${e(state.friendProfileId)}"`)}`;
  if (!person) return `<div class="modal-icon">${icon('user')}</div><h2 id="modal-title">Opening their profile…</h2><p role="status">Finding your friend’s latest community highlights.</p>`;
  return `<div class="friend-profile-heading">${avatar(person,'lg')}<div>${tag('YOUR FRIEND','green')}<h2 id="modal-title">${e(displayName(person))}</h2><p>@${e(person.username)} · ${e(person.title || 'Rookie')}</p></div></div><div class="friend-profile-bio"><h3>About</h3><p>${e(person.bio || 'This scribbler hasn’t added a bio yet.')}</p></div><div class="friend-profile-stats">${[['Level',person.level],['XP',person.xp],['Games played',person.gamesPlayed],['Wins',person.wins],['Total points',person.points],['Average score',person.averageScore]].map(([label,value]) => `<div><strong>${number(value ?? 0)}</strong><span>${label}</span></div>`).join('')}</div><div class="section-heading"><h2>${icon('medal')}Badges & trophies</h2></div>${person.achievements?.length || person.trophies?.length ? awardsPanel(person) : `<div class="friend-quiet-state">${icon('medal')}<div><h3>More milestones ahead</h3><p>Their earned badges and tournament trophies will appear here.</p></div></div>`}`;
}
async function respondFriendRequest(otherUserId, action) {
  if (!user()) { requireUser(() => {}); return; }
  if (state.friendDecision || state.friendsLoading || !['accept','decline'].includes(action)) return;
  const request = rows('friends').find(friend => friend.id === otherUserId && friend.status === 'pending' && friend.outgoing === false);
  if (!request) return;
  const accountId = user().id, accountEpoch = state.accountEpoch || 0;
  const sameAccount = () => user()?.id === accountId && (state.accountEpoch || 0) === accountEpoch;
  state.friendDecision = {id:otherUserId,action}; state.friendsError = null; render();
  let saved = false;
  try {
    await api(`/api/friends/${encodeURIComponent(otherUserId)}/respond`,{method:'POST',body:JSON.stringify({action})});
    if (!sameAccount()) return;
    saved = true;
    // Reflect the confirmed decision even if the following bootstrap refresh fails.
    state.data.friends = action === 'accept' ? rows('friends').map(friend => friend.id === otherUserId ? {...friend,status:'accepted',outgoing:false} : friend) : rows('friends').filter(friend => friend.id !== otherUserId);
    render();
    await refresh({silent:true});
    if (sameAccount()) toast(action === 'accept' ? 'Friend request accepted. Your squad just grew.' : 'Friend request declined.');
  } catch(error) {
    if (!sameAccount() || error.code === 'ACCOUNT_CHANGED') return;
    state.friendsError = saved ? 'Your choice was saved, but the friend list could not refresh. Use Refresh friends to try again.' : error.message || 'That request could not be updated. Please try again.';
    toast(state.friendsError,true);
  } finally {
    if (sameAccount()) {
      state.friendDecision = null;
      if (state.route === 'friends') { render(); if (!state.modal && state.socialTab === 'friends') $('[data-action="refresh-friends"]')?.focus(); }
    }
  }
}
async function refreshFriends() {
  if (!user() || state.friendsLoading || state.friendDecision) return;
  const accountId = user().id, accountEpoch = state.accountEpoch || 0;
  const sameAccount = () => user()?.id === accountId && (state.accountEpoch || 0) === accountEpoch;
  state.friendsLoading = true; state.friendsError = null; render();
  try { await refresh({silent:true}); }
  catch(error) { if (sameAccount() && error.code !== 'ACCOUNT_CHANGED') { state.friendsError = error.message || 'Your friend list could not refresh. Please try again.'; toast(state.friendsError,true); } }
  finally { if (sameAccount()) { state.friendsLoading = false; if (state.route === 'friends') { render(); if (!state.modal && state.socialTab === 'friends') $('[data-action="refresh-friends"]')?.focus(); } } }
}

function adminPage() { if (!isAdmin()) return ''; const admin = state.admin; return `${heading('KEEP THE COMMUNITY KIND.','Behind the canvas.','Every correction has a reason. Every decision leaves a trail.')}<div class="admin-warning">Score corrections, bans, and gallery curation affect the shared community. Match scores are audited; use a clear reason for every adjustment.</div>${competitionActions()}<div class="admin-actions section-space">${button('Correct a score','adjust-score','pencil')}${button('Manage a ban','ban-player','shield','outline')}${button('Assign a title','assign-title','crown','outline')}${button('Refresh audit log','refresh-admin','refresh','outline')}</div>${clubhouseAdminPanel()}${disputesAdminPanel()}${!admin ? empty('Loading the admin records…','The secure audit log will appear here shortly.') : `<div class="split-grid"><div class="info-card"><h3>Match result audit log</h3>${(admin.audit || admin.auditLog || admin.adjustments || []).length ? `<ul class="audit-list">${(admin.audit || admin.auditLog || admin.adjustments).slice(0,30).map(entry => `<li><strong>${e(entry.action || entry.type || 'Score adjustment')}</strong> ${e(entry.reason || '')}<small>${e(readableDate(entry.createdAt))} · ${e(entry.username || entry.userId || entry.actorId || entry.matchId || '')}${entry.targetUsername ? ` → ${e(entry.targetUsername)}` : ''}${entry.delta !== undefined ? ` · ${Number(entry.delta)>0?'+':''}${number(entry.delta)} points` : ''}</small></li>`).join('')}</ul>` : '<p>No administrative events have been recorded.</p>'}</div><div class="info-card"><h3>Gallery curation</h3>${(admin.drawings || rows('drawings')).length ? (admin.drawings || rows('drawings')).map(drawing => `<div class="section-space"><p><strong>${e(drawing.prompt || drawing.title || 'Untitled drawing')}</strong> · ${e(drawing.artistName || drawing.artist?.username || drawing.artist || '')}</p><div class="admin-actions">${button('Fame','curate','','outline',`data-id="${e(drawing.id)}" data-hall="fame"`)}${button('Shame','curate','','outline',`data-id="${e(drawing.id)}" data-hall="shame"`)}${button('Unlist','curate','','outline',`data-id="${e(drawing.id)}" data-hall=""`)}</div></div>`).join('') : '<p>Saved match drawings will appear here for review.</p>'}</div></div>`}`; }

function openModal(type) {
  if (type === 'avatar-editor') {
    state.avatarDraft = avatarFromUrl(user()?.avatarUrl) || {...defaultAvatar};
    state.avatarTab = 'hair';
    state.avatarMode = user()?.avatarUrl && !avatarFromUrl(user().avatarUrl) ? 'upload' : 'preset';
  }
  if (!state.modal) previousFocus = document.activeElement;
  state.modal = type;
  renderModal();
  document.body.style.overflow = 'hidden';
  requestAnimationFrame(() => $('input:not([type="hidden"]),select,button',dialogRoot)?.focus());
}
function closeModal() { state.photoGeneration=(state.photoGeneration||0)+1;state.photoCropper?.dispose();state.photoCropper=null; state.modal = null; state.avatarDraft = null; dialogRoot.innerHTML = ''; document.body.style.overflow = ''; if (previousFocus?.isConnected) previousFocus.focus(); previousFocus = null; }
function modalShell(contents, wide = false) { return `<div class="modal-backdrop" data-backdrop="true"><section class="modal ${wide ? 'wide' : ''}" role="dialog" aria-modal="true" aria-labelledby="modal-title"><button class="icon-button modal-close" data-action="close-modal" aria-label="Close dialog">${icon('close')}</button>${contents}</section></div>`; }
function field(name,label,placeholder = '',type = 'text',extra = '') { return `<div class="form-field"><label for="field-${e(name)}">${e(label)}</label><input id="field-${e(name)}" name="${e(name)}" type="${e(type)}" placeholder="${e(placeholder)}" ${extra}/></div>`; }
function errorSlot() { return '<div id="form-error" class="form-error" role="alert" hidden></div>'; }
const avatarFeatureLabels = {face:'Face',ears:'Ears',nose:'Nose',hair:'Hair',eyes:'Eyes',eyebrows:'Brows',mouth:'Mouth',accessory:'Extras'};
const avatarColorLabels = {skin:'Skin tone',hairColor:'Hair color',shirtColor:'Clothing',background:'Background'};
function avatarEditorModal() {
  const upload=state.avatarMode === 'upload';
  return `<div class="avatar-editor-heading"><span class="eyebrow">THE CHARACTER WORKSHOP</span><h2 id="modal-title">Your avatar. Your kind of weird.</h2><p>Raid the costume drawer. Build a scribbler or bring your own photo.</p></div><div class="avatar-mode-options" aria-label="Avatar type"><button type="button" class="avatar-mode-option ${upload?'':'selected'}" data-action="avatar-mode" data-mode="preset" aria-pressed="${!upload}" ${state.busy?'disabled':''}>${icon('palette')}<span><strong>Build a character</strong><small>Mix features and colors</small></span></button><button type="button" class="avatar-mode-option ${upload?'selected':''}" data-action="avatar-mode" data-mode="upload" aria-pressed="${upload}" ${state.busy?'disabled':''}>${icon('image')}<span><strong>Upload a photo</strong><small>PNG, JPEG, or WebP</small></span></button></div>${upload?`<div class="avatar-photo-panel"><div class="avatar-photo-preview" data-avatar-upload-preview>${avatar(user(),'lg')}</div>${mediaUploadForm('avatar',user()?.avatarUrl)}</div>`:presetAvatarEditorModal()}`;
}
function presetAvatarEditorModal() {
  const original = state.avatarDraft || {...defaultAvatar}, draft = editableAvatar(original), selected = state.avatarTab || 'hair';
  return `<form data-form="avatar-preset">${errorSlot()}<div class="avatar-editor"><div class="avatar-editor-preview"><span class="avatar-card-stamp">Your permanent look</span><div class="avatar-portrait">${renderAvatar(original)}</div><span class="avatar-name-label">HELLO, I’M</span><span class="avatar-preview-name">${e(displayName(user()))}</span><div class="avatar-vibes" role="group" aria-label="Randomizer vibe">${avatarVibes.map(v=>`<button type="button" data-action="avatar-vibe" data-value="${v}" aria-pressed="${(state.avatarVibe||'Cute')===v}" ${state.busy?'disabled':''}>${v}</button>`).join('')}</div><div class="avatar-preview-actions">${button('⚄ Surprise me','avatar-random','refresh','yellow',`type="button" ${state.busy ? 'disabled' : ''}`)}${button('Reset','avatar-reset','refresh','outline',`type="button" ${state.busy ? 'disabled' : ''}`)}</div><p class="form-note">Excellent face. Questionable drawing skills. Save when it feels like you.</p></div><div class="avatar-editor-controls"><p class="avatar-drawer-label">THE COSTUME DRAWER ↴</p><div class="avatar-feature-tabs" aria-label="Avatar features">${Object.entries(avatarFeatureLabels).map(([key,label])=>`<button type="button" class="avatar-feature-tab ${selected===key?'selected':''}" data-action="avatar-tab" data-key="${key}" aria-pressed="${selected===key}" ${state.busy?'disabled':''}>${label}</button>`).join('')}</div><div class="avatar-option-heading"><h3>${avatarFeatureLabels[selected]}</h3><span>${e(avatarOptions[selected][draft[selected]])}</span></div><div class="avatar-option-grid" role="group" aria-label="${avatarFeatureLabels[selected]} presets">${avatarOptions[selected].map((label,index)=>`<button type="button" class="avatar-option ${draft[selected]===index?'selected':''}" data-action="avatar-choice" data-key="${selected}" data-value="${index}" aria-label="${e(label)}" aria-pressed="${draft[selected]===index}" ${state.busy?'disabled':''}><span aria-hidden="true">${renderAvatar({...draft,[selected]:index})}</span><small>${e(label)}</small></button>`).join('')}</div><div class="avatar-color-controls">${Object.entries(avatarColorLabels).map(([key,label])=>`<fieldset class="avatar-color-row"><legend>${label}<span>${e(avatarOptions[key][draft[key]].name)}</span></legend><div class="avatar-swatches">${avatarOptions[key].map((option,index)=>`<button type="button" class="avatar-swatch ${draft[key]===index?'selected':''}" style="--swatch:${option.color}" data-action="avatar-choice" data-key="${key}" data-value="${index}" aria-label="${label}: ${option.name}" aria-pressed="${draft[key]===index}" title="${option.name}" ${state.busy?'disabled':''}>${draft[key]===index?icon('check'):''}</button>`).join('')}</div></fieldset>`).join('')}</div></div></div><div class="avatar-editor-footer"><p>${user()?.avatarUrl && !avatarFromUrl(user().avatarUrl) ? 'Saving this look replaces your uploaded profile picture.' : 'Your avatar follows you around the community.'}</p>${button('Save my look','submit','check','yellow','type="submit"')}</div></form>`;
}
function changeAvatar(action, element) {
  if (state.busy || state.modal !== 'avatar-editor' || !user()) return;
  const {key,value} = element.dataset;
  if (action === 'avatar-tab') {
    if (!Object.hasOwn(avatarFeatureLabels,key)) return;
    state.avatarTab = key;
  } else if (action === 'avatar-choice') {
    const index=Number(value);
    if (!Object.hasOwn(avatarOptions,key) || !Number.isInteger(index) || index<0 || index>=avatarOptions[key].length) return;
    state.avatarDraft={...editableAvatar(state.avatarDraft),[key]:index};
  } else if(action==='avatar-vibe') { if(!avatarVibes.includes(value))return;state.avatarVibe=value;state.avatarDraft=randomAvatar(Math.random,value); } else state.avatarDraft=action==='avatar-random'?randomAvatar(Math.random,state.avatarVibe||'Cute'):{...defaultAvatar};
  renderModal();
  $(`[data-action="${action}"]${key?`[data-key="${key}"]`:''}${value!=null?`[data-value="${value}"]`:''}`,dialogRoot)?.focus();
}
function mediaUploadForm(kind,currentUrl) {
  const avatarUpload=kind==='avatar';
  return `<section class="media-upload-section"><h3>${avatarUpload?'Put a face to the doodles.':'Give your squad a badge.'}</h3><p>${avatarUpload?'Profile pictures':'Team logos'} are public. Choose PNG, JPEG, or WebP up to 8 MiB and 25 megapixels. Crop your photo before saving.</p><form data-form="${e(kind)}"><div class="form-error" data-upload-error role="alert" hidden></div><div class="form-field"><label for="upload-${e(kind)}">${avatarUpload?'Profile picture':'Team logo'}</label><input id="upload-${e(kind)}" name="png" type="file" accept="image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp" required/></div><div data-photo-cropper hidden></div>${button('Crop and save','submit','image','yellow','type="submit" disabled')}</form>${currentUrl?`<button class="text-link remove-media" data-action="${avatarUpload?'remove-avatar':'remove-team-logo'}">Remove current ${avatarUpload?'picture':'logo'}</button>`:''}</section>`;
}
async function imagePayload() {
  if(!state.photoCropper)throw new Error('Choose a photo and adjust its crop first.');
  return state.photoCropper.export();
}
async function previewAvatarUpload(input) {
  const generation=state.photoGeneration=(state.photoGeneration||0)+1,form=input.closest('form'),root=form?.querySelector('[data-photo-cropper]'),submit=form?.querySelector('[type="submit"]');
  if(state.busy)return;state.photoCropper?.dispose();state.photoCropper=null;if(submit)submit.disabled=true;
  const error=form?.querySelector('[data-upload-error]');if(error)error.hidden=true;
  const file=input.files?.[0];if(!file||!root)return;
  root.hidden=false;root.textContent='Reading photo…';
  try{
    const {mountPhotoCropper}=await import('./photo-cropper.js');
    if(generation!==state.photoGeneration||!root.isConnected)return;
    const cropper=await mountPhotoCropper(root,file,{onCancel(){state.photoCropper=null;input.value='';submit.disabled=true;input.focus();}});
    if(generation!==state.photoGeneration||!root.isConnected){cropper.dispose();return;}
    state.photoCropper=cropper;submit.disabled=false;
  }catch(error){if(generation!==state.photoGeneration||!root.isConnected)return;root.replaceChildren();root.hidden=true;input.value='';setFormError(error.message||'Photo decode failed. Try another photo.',form);}
}
async function loadMyTeams({quiet = false} = {}) {
  if (!user() || state.teamsLoading) return;
  state.teamsLoading = true; state.teamsError = null;
  if (!quiet) render();
  try { state.myTeams = await api('/api/teams/mine'); state.teamsLoaded = true; }
  catch(error) { if (error.code === 'ACCOUNT_CHANGED') return; state.teamsError = error.message; }
  finally { state.teamsLoading = false; if (state.route === 'friends') render(); }
}
function teamInvitationsPanel() {
  if (!user()) return '';
  const teams = state.myTeams?.teams || [];
  const invites = state.myTeams?.invites || [];
  return `<section class="team-membership-panel section-space"><div class="section-heading"><h2>${icon('shield')}Your team corner</h2><button class="text-link" data-action="refresh-teams" ${state.teamsLoading ? 'disabled' : ''}>${icon('refresh')}${state.teamsLoading ? 'Refreshing…' : 'Refresh teams'}</button></div>${state.teamsError ? `<div class="engine-banner">${icon('info')}<span>${e(state.teamsError)}</span></div>` : !state.teamsLoaded ? '<p class="party-note">Checking your teams and invitations…</p>' : `<div class="owned-team-links">${teams.length ? teams.map(team => `<button class="owned-team-link" data-action="team-detail" data-id="${e(team.id)}">${teamLogo(team)}<span><strong>${e(team.name)}</strong><small>${e(team.myRole || 'member')}</small></span>${icon('chevron')}</button>`).join('') : '<p class="party-note">No team yet. Start your own or ask a team captain to invite you.</p>'}</div>${invites.length ? `<div class="party-invites"><h3>Your next squad is calling.</h3>${invites.map(invite => `<div class="party-invite"><span class="stat-icon">${icon('shield')}</span><div><strong>${e(invite.teamName)}</strong><p>From ${e(typeof invite.from === 'object' ? displayName(invite.from) : invite.from || 'the team')} · expires ${e(readableDate(invite.expiresAt))}</p></div>${button('Join team','accept-team','arrow','outline',`data-id="${e(invite.id)}"`)}</div>`).join('')}</div>` : ''}`}</section>`;
}
async function showTeam(teamId) {
  const result = await api(`/api/teams/${encodeURIComponent(teamId)}`);
  state.teamDetail = result.team;
  openModal('team-detail');
}
function teamDetailModal() {
  const team = state.teamDetail;
  if (!team) return '<h2 id="modal-title">Team unavailable.</h2>';
  const member = !team.archived && (!!team.myRole || team.members?.some(person => person.id === user()?.id));
  const captain = member && team.captainId === user()?.id;
  const canInvite = member && (captain || team.myRole === 'officer');
  const teammates = (team.members || []).filter(person => person.id !== user()?.id);
  return `<div class="team-detail-heading">${teamLogo(team)}<div><h2 id="modal-title">${e(team.name)}</h2><p>${e(team.tag)} · ${plural(team.members?.length || 0,'scribbler')}</p></div></div><div class="team-roster">${(team.members || []).map(person => `<div class="team-roster-row">${avatar(person)}<div><strong>${e(person.username)}</strong><small>${e(person.role || (person.id === team.captainId ? 'captain' : 'member'))}${person.id === user()?.id ? ' · you' : ''}</small></div>${person.id === team.captainId ? icon('crown') : ''}</div>`).join('')}</div>${member ? `<div class="admin-actions">${canInvite ? button('Invite a teammate','invite-team','plus','yellow') : ''}${button('Leave team','leave-team','logout','outline',captain && teammates.length ? 'disabled' : '')}</div>${captain && teammates.length ? `<p class="party-note">Pass captaincy to a teammate before leaving. Your squad’s history stays with the team.</p><form data-form="transfer-captain" class="team-transfer-form">${errorSlot()}${selectField('userId','Next team captain',teammates.map(person => [person.id,person.username]))}${button('Transfer captaincy','submit','crown','outline','type="submit"')}</form>` : captain ? '<p class="party-note">Leaving as the last member archives this team.</p>' : ''}` : `<p class="party-note">${team.archived ? 'This team is archived. Its roster remains part of the community’s history.' : 'Team captains and officers can invite new members by username.'}</p>`}${captain ? mediaUploadForm('team-logo',team.logoUrl) : ''}`;
}
function teamInviteModal() {
  return `<div class="modal-icon">${icon('shield')}</div><h2 id="modal-title">Bring them onto the team.</h2><p>Invite a player to ${e(state.teamDetail?.name || 'your team')}. They’ll accept from their team corner.</p><form data-form="team-invite">${errorSlot()}${field('username','Player username','Their Skribbil username','text','required minlength="3" maxlength="24" autocomplete="off"')}${button('Send team invitation','submit','arrow','yellow','type="submit"')}</form>`;
}
async function loadDisputes() {
  const result = await api('/api/disputes');
  state.disputes = result.disputes || [];
  openModal('my-disputes');
}
function disputeCard(dispute,admin = false) {
  return `<article class="dispute-card"><div class="section-heading"><strong>${admin ? e(dispute.submittedBy?.username || 'Player report') : 'Match result report'}</strong>${tag(dispute.status || 'open',dispute.status === 'resolved' ? 'green' : dispute.status === 'rejected' ? 'gray' : 'yellow')}</div><p>${e(dispute.reason)}</p><small>Submitted ${e(readableDate(dispute.createdAt))}</small>${admin ? `<small>Match: <code>${e(dispute.matchId)}</code><br>Player: <code>${e(dispute.submittedBy?.id)}</code></small>` : ''}${dispute.resolution ? `<div class="dispute-resolution"><strong>Admin response</strong><p>${e(dispute.resolution)}</p><small>${e(readableDate(dispute.resolvedAt))}</small></div>` : ''}${admin && !['resolved','rejected'].includes(dispute.status) ? `<div style="margin-top:13px">${button('Review report','resolve-dispute','shield','outline',`data-id="${e(dispute.id)}"`)}</div>` : ''}</article>`;
}
function disputesAdminPanel() {
  return `<section class="dashboard-secondary"><div class="section-heading"><h2>${icon('flag')}Community score reports</h2><button class="text-link" data-action="refresh-disputes">${icon('refresh')}Refresh reports</button></div>${state.adminDisputesError ? `<div class="engine-banner">${icon('info')}<span>${e(state.adminDisputesError)}</span></div>` : !state.adminDisputes ? '<div class="info-card"><p>Loading the community’s reports…</p></div>' : state.adminDisputes.length ? `<div class="disputes-list">${state.adminDisputes.map(dispute => disputeCard(dispute,true)).join('')}</div>` : empty('All clear on the canvas.','There are no match score reports to review.')}</section>`;
}
async function loadAdminDisputes() {
  if (!isAdmin()) return;
  try { const result = await api('/api/admin/disputes'); state.adminDisputes = result.disputes || []; state.adminDisputesError = null; }
  catch(error) { if (error.code === 'ACCOUNT_CHANGED') return; state.adminDisputesError = error.message; }
  if (state.route === 'admin') render();
}
function disputeModal() {
  return `<div class="modal-icon">${icon('flag')}</div><h2 id="modal-title">Something doesn’t add up?</h2><p>Report a specific issue with this completed match’s result. An admin can review the audited score record.</p><form data-form="dispute">${errorSlot()}<div class="form-field"><label for="dispute-reason">What happened?</label><textarea id="dispute-reason" name="reason" required minlength="10" maxlength="2000" placeholder="Describe the score or result issue and what you expected to happen."></textarea></div>${button('Submit score report','submit','flag','yellow','type="submit"')}<p class="form-note">You can follow the report’s status from My reports on your profile.</p></form>`;
}
function resolveDisputeModal() {
  const dispute = state.activeDispute;
  return `<div class="modal-icon">${icon('shield')}</div><h2 id="modal-title">Give this report a resolution.</h2><p>Review the match record before responding. Resolving a report doesn’t automatically change scores; use an audited score correction when one is needed.</p>${disputeCard(dispute)}<form data-form="resolve-dispute">${errorSlot()}${selectField('status','Decision',[['resolved','Resolved'],['rejected','Rejected']])}<div class="form-field"><label for="dispute-resolution">Response to the player</label><textarea id="dispute-resolution" name="resolution" required minlength="10" maxlength="2000" placeholder="Explain what you checked and the outcome."></textarea></div>${button('Save resolution','submit','check','yellow','type="submit"')}</form>`;
}
function partyPanel() {
  const account = user();
  const data = state.partyState || {party:null,invites:[]};
  const party = data.party;
  const invites = data.invites || [];
  return `<section class="party-section"><div class="section-heading"><h2>${icon('people')}Round up your people</h2>${account ? `<button class="text-link" data-action="refresh-party" ${state.partyLoading ? 'disabled' : ''}>${icon('refresh')}${state.partyLoading ? 'Refreshing…' : 'Refresh party'}</button>` : tag('UP TO 8 FRIENDS')}</div>${!account ? `<div class="info-card"><h3>Your pre-game meeting spot.</h3><p>Make a party, invite friends, and gather your squad before starting a room. Sign in to see your party invitations.</p><div style="margin-top:15px">${button('Join your people','auth','people','yellow')}</div></div>` : state.partyError ? `<div class="engine-banner">${icon('info')}<span>${e(state.partyError)}</span>${button('Try again','refresh-party','refresh','outline')}</div>` : !state.partyLoaded ? `<div class="info-card"><p>Checking who’s around for a game…</p></div>` : `<div class="party-panel">${party ? `<div class="party-header"><div><h3>${party.leaderId === account.id ? 'Your scribble squad is gathering.' : 'You’ve got good company.'}</h3><p>${plural(party.members?.length || 0,'scribbler')} of 8 · ${party.leaderId === account.id ? 'You’re the party leader' : 'Ready for a shared room invitation'}</p></div>${tag('PARTY')}</div><div class="party-members">${(party.members || []).map(member => `<div class="party-member">${avatar(member)}<div><strong>${e(member.username)}</strong><span>${member.id === party.leaderId ? 'Party leader' : member.id === account.id ? 'That’s you' : 'Part of the squad'}</span></div>${member.id === party.leaderId ? icon('crown') : ''}</div>`).join('')}</div><div class="admin-actions">${party.leaderId === account.id ? button('Invite a friend','invite-party','plus','yellow',party.members?.length >= 8 ? 'disabled' : '') : ''}${button('Create a room','private-room','game','primary')}${button('Leave party','leave-party','logout','outline')}</div><p class="party-note">Create a room, then share its invitation with your party from the Clubhouse. Joining a party doesn’t automatically put anyone into a game.</p>` : `<div class="party-header"><span class="stat-icon">${icon('people')}</span><div><h3>One party. Your favorite people.</h3><p>Gather up to 8 friends before your next round.</p></div></div>${button('Start a party','create-party','plus','yellow')}<p class="party-note">Invite friends you’re already connected with. You can share a room invitation once everyone’s ready.</p>`}</div>${invites.length ? `<div class="party-invites"><h3>There’s a seat for you.</h3>${invites.map(invite => `<div class="party-invite"><span class="stat-icon yellow">${icon('people')}</span><div><strong>${e(typeof invite.from === 'object' ? displayName(invite.from) : invite.from || 'A friend')} invited you</strong><p>Party invitation · expires ${e(readableDate(invite.expiresAt))}</p></div>${button('Join party','accept-party','arrow','outline',`data-id="${e(invite.id)}" ${party ? 'disabled' : ''}`)}</div>`).join('')}${party ? '<p class="party-note">Leave your current party before accepting another invitation.</p>' : ''}</div>` : ''}`}</section>`;
}
async function loadParty({quiet = false} = {}) {
  if (!user() || state.partyLoading) return;
  state.partyLoading = true;
  state.partyError = null;
  if (!quiet) render();
  try { state.partyState = await api('/api/party'); state.partyLoaded = true; }
  catch (error) { state.partyError = error.message; }
  finally { state.partyLoading = false; if (state.route === 'friends') render(); }
}
async function changeParty(path) {
  await api(path,{method:'POST',body:'{}'});
  await loadParty();
}
function partyInviteModal() {
  return `<div class="modal-icon">${icon('people')}</div><h2 id="modal-title">Save them a seat.</h2><p>Invite an accepted friend to your party. Parties have room for up to 8 people.</p><form data-form="party-invite">${errorSlot()}${field('username','Friend’s username','Their Skribbil username','text','required minlength="3" maxlength="24" autocomplete="off"')}${button('Send party invitation','submit','arrow','yellow','type="submit"')}<p class="form-note">Your friend can accept the invitation from their Friends & teams page.</p></form>`;
}
function awardsPanel(person) {
  const achievements = person.achievements || [];
  const trophies = person.trophies || [];
  if (!achievements.length && !trophies.length) return empty('Room for your first trophy.','Play, complete challenges, and make a name for yourself. Achievements and tournament trophies will appear here as you earn them.');
  return `<div class="panel awards-list">${trophies.map(trophy => `<article class="award-row"><span class="stat-icon yellow">${icon('trophy')}</span><div><h3>${e(trophy.title || 'Tournament trophy')}</h3><p>${trophy.placement ? `Place #${number(trophy.placement)} · ` : ''}${e(readableDate(trophy.awardedAt))}</p></div></article>`).join('')}${achievements.map(achievement => `<article class="award-row"><span class="stat-icon">${icon('medal')}</span><div><h3>${e(achievement.title || achievement.name || achievement.slug)}</h3><p>${e(achievement.description || 'A little milestone. A big moment.')}</p><small>Earned ${e(readableDate(achievement.awardedAt))}</small></div></article>`).join('')}</div>`;
}
function competitionActions() {
  return `<section class="admin-competition"><h3>Write the next chapter.</h3><p>Create a season, open a tournament, and publish real fixtures for your community.</p><div class="admin-actions">${button('Create season','admin-create-season','flag','outline')}${button('Activate season','admin-activate-season','check','outline')}${button('Create tournament','admin-create-tournament','trophy','primary')}${button('Generate bracket','admin-seed','sword','outline')}${button('Record fixture result','admin-fixture-result','pencil','outline')}</div></section>`;
}
function teamRegistrationModal() {
  const teams = (state.myTeams?.teams || []).filter(team => team.captainId === user()?.id || team.myRole === 'captain');
  return `<div class="modal-icon">${icon('trophy')}</div><h2 id="modal-title">Bring the whole squad.</h2><p>${e(state.teamTournament?.name || 'This tournament')} welcomes team entries. Choose a team you captain.</p>${teams.length ? `<form data-form="team-registration">${errorSlot()}${selectField('teamId','Your competing team',teams.map(team => [team.id,`${team.name} · ${team.tag}`]))}${button('Register my team','submit','trophy','yellow','type="submit"')}<p class="form-note">Your team needs at least two eligible members. Registration saves your current roster for the tournament.</p></form>` : `<div class="rules-box">You need to captain a team to register it. Start a team or ask your captain to enter the competition.</div>${button('Go to your teams','go-teams','shield','yellow')}`}`;
}
function selectField(name,label,options) {
  return `<div class="form-field"><label for="field-${e(name)}">${e(label)}</label><select id="field-${e(name)}" name="${e(name)}" required>${options.map(([value,text]) => `<option value="${e(value)}">${e(text)}</option>`).join('')}</select></div>`;
}
function competitionModal(kind) {
  const common = `<div class="modal-icon">${icon('trophy')}</div>`;
  const tournamentOptions = rows('tournaments').map(item => [item.id,item.name]);
  const seasons = state.admin?.seasons || state.data.seasons || (state.data.season ? [state.data.season] : []);
  if (kind === 'create-season') return `${common}<h2 id="modal-title">A new league chapter.</h2><p>Create a season for the shared community. Activate it when the league is ready.</p><form data-form="create-season">${errorSlot()}${field('name','Season name','e.g. Dussehra League 2026','text','required minlength="3" maxlength="80"')}${field('startsAt','Season starts','','datetime-local','required')}${field('endsAt','Season ends','','datetime-local','required')}${button('Create season','submit','flag','yellow','type="submit"')}</form>`;
  if (kind === 'activate-season') return `${common}<h2 id="modal-title">Open the next chapter.</h2><p>Activating a season changes the live league leaderboard. Historical seasons remain saved.</p><form data-form="activate-season">${errorSlot()}${seasons.length ? selectField('seasonId','Season to activate',seasons.map(item => [item.id,item.name])) : field('seasonId','Season ID','','text','required')}${button('Activate season','submit','check','yellow','type="submit"')}</form>`;
  if (kind === 'create-tournament') return `${common}<h2 id="modal-title">Give the squad a stage.</h2><p>Set the competition format and registration window.</p><form data-form="create-tournament">${errorSlot()}${field('name','Tournament name','Name your tournament','text','required minlength="3" maxlength="100"')}<div class="form-grid">${selectField('format','Competition format',[['knockout','Knockout'],['groups_knockout','Groups then knockout'],['round_robin','Round robin']])}${selectField('entryType','Who competes?',[['individual','Individual players'],['team','Community teams']])}</div>${field('startsAt','Tournament starts','','datetime-local','required')}${field('registrationClosesAt','Registration closes','','datetime-local','required')}${field('maxEntries','Maximum entries','16','number','required value="16" min="2" max="128" step="1"')}${button('Create tournament','submit','trophy','yellow','type="submit"')}</form>`;
  if (kind === 'seed') return `${common}<h2 id="modal-title">Let the matchups begin.</h2><p>Generate a tournament bracket from registered entries. The server checks that registration and format rules are satisfied.</p><form data-form="seed">${errorSlot()}${tournamentOptions.length ? selectField('tournamentId','Tournament',tournamentOptions) : field('tournamentId','Tournament ID','','text','required')}${button('Generate bracket','submit','sword','yellow','type="submit"')}</form>`;
  return `${common}<h2 id="modal-title">Record the result.</h2><p>Use the fixture and entry IDs from the tournament’s official bracket. Every result includes an audit reason.</p><form data-form="fixture-result">${errorSlot()}${field('fixtureId','Fixture ID','','text','required')}${field('winnerEntryId','Winning entry ID','','text','required')}${field('reason','Result verification','How was the winner verified?','text','required minlength="10" maxlength="500"')}${button('Record fixture winner','submit','check','yellow','type="submit"')}</form>`;
}
async function showBracket(id) {
  state.bracket = await api(`/api/tournaments/${encodeURIComponent(id)}/bracket`);
  openModal('bracket');
}
function officialBracketModal() {
  const data = state.bracket || {};
  const entries = data.entries || [];
  const nameOf = id => { const entry = entries.find(item => item.id === id); return entry?.name || entry?.displayName || entry?.username || entry?.teamName || (id ? 'Registered contender' : 'To be decided'); };
  return `<div class="modal-icon">${icon('sword')}</div><h2 id="modal-title">${e(data.tournament?.name || 'The official bracket')}</h2><p>${e(data.tournament?.format || 'Competition')} · ${plural(entries.length,'entry','entries')}</p>${data.fixtures?.length ? data.fixtures.map(fixture => `<div class="bracket-fixture"><h3>Round ${e(fixture.roundNumber || fixture.round || 1)}${fixture.groupName ? ` · Group ${e(fixture.groupName)}` : ''}</h3><p>${e(nameOf(fixture.homeEntryId || fixture.entryAId || fixture.entry1Id))} vs ${e(nameOf(fixture.awayEntryId || fixture.entryBId || fixture.entry2Id))}<br>${fixture.winnerEntryId ? `Winner: ${e(nameOf(fixture.winnerEntryId))}` : e(fixture.status || 'Awaiting result')}</p>${isAdmin() ? `<code>Fixture: ${e(fixture.id)}<br>Entries: ${e(fixture.homeEntryId || fixture.entryAId || fixture.entry1Id || 'TBD')} / ${e(fixture.awayEntryId || fixture.entryBId || fixture.entry2Id || 'TBD')}</code>` : ''}</div>`).join('') : empty('The draw is still to come.','Registered entries will appear in fixtures once an administrator generates the bracket.')}${isAdmin() ? `<div class="admin-actions" style="margin-top:17px">${button('Record fixture result','admin-fixture-result','pencil','outline')}</div>` : ''}`;
}
function authModal() { const register = state.authMode === 'register'; return `<div class="modal-icon">${icon('pencil')}</div><h2 id="modal-title">${register ? 'Find your scribble people.' : 'Hey, welcome back.'}</h2><p>${register ? 'One account for your league, your squad, and every game that comes next.' : 'Your next great guess is waiting for you.'}</p><form data-form="auth">${errorSlot()}${register ? field('username','Pick a username','Your future leaderboard name','text','required minlength="3" maxlength="24" pattern="[A-Za-z0-9_]+" autocomplete="username"') : ''}${field('email',register ? 'Email address' : 'Email or username',register ? 'you@example.com' : 'Your email or username',register ? 'email' : 'text',`required autocomplete="${register ? 'email' : 'username'}"`)}${field('password','Password',register ? 'At least 10 characters' : 'Your secret scribble code','password',`required ${register ? 'minlength="10"' : ''} maxlength="128" autocomplete="${register ? 'new-password' : 'current-password'}"`)}<label class="remember-device" for="auth-remember"><input id="auth-remember" name="rememberMe" type="checkbox" aria-describedby="auth-remember-help"/>Remember me on this device</label><p id="auth-remember-help" class="form-note remember-help">Stay signed in after closing your browser.</p>${button(register ? 'Join the community' : 'Back to the community','submit','arrow','yellow','type="submit"')}<p class="form-note">Keep your account yours. Use a unique password.</p></form><div class="auth-toggle">${register ? 'Already part of the chaos?' : 'New around here?'} <button data-action="toggle-auth">${register ? 'Log in' : 'Create an account'}</button></div>`; }
function roomModal() { const clubhouse = state.roomClubhouseId ? state.roomClubhouseName || 'Your clubhouse' : null; const ranked = !clubhouse && state.roomMode === 'ranked'; const available = state.data.engine?.available === true; const rankedReady = state.data.engine?.ranked === true; const canCreate = available && (!ranked || rankedReady); return `<div class="modal-icon">${icon('game')}</div><h2 id="modal-title">Make room for a little chaos.</h2><p>The original scribble.rs drawing and guessing game, with your community around it.</p><div class="room-mode-cards"><button class="room-mode ${ranked ? 'selected' : ''}" data-action="room-mode" data-value="ranked" ${clubhouse ? 'disabled title="Clubhouse rooms are private"' : ''} aria-pressed="${ranked}">${icon('trophy')}<strong>Ranked match</strong><p>Locked rules. League points. Bring your best guesses.</p></button><button class="room-mode ${!ranked ? 'selected' : ''}" data-action="room-mode" data-value="private" aria-pressed="${!ranked}">${icon('lock')}<strong>Your own room</strong><p>Your friends. Your settings. Your questionable art.</p></button></div><form data-form="room">${errorSlot()}${clubhouse ? `<div class="rules-box clubhouse-room-banner"><strong>${e(clubhouse)}</strong><br>This room is private. Only current clubhouse members can play or spectate, even with an invitation link.</div>` : ''}${ranked ? '<div class="rules-box"><strong>A level playing field.</strong><br>Ranked matches use the server’s fixed rules. Round count, timer, and word settings cannot be changed by players.</div>' : `<div class="form-grid"><div class="form-field"><label for="room-rounds">Rounds</label><select id="room-rounds" name="rounds"><option value="2">2 rounds · a quick doodle</option><option value="3" selected>3 rounds · the classic</option><option value="5">5 rounds · one more!</option><option value="8">8 rounds · settle in</option></select></div><div class="form-field"><label for="room-time">Time to draw</label><select id="room-time" name="drawTime"><option value="60">60 seconds</option><option value="80" selected>80 seconds</option><option value="100">100 seconds</option><option value="120">120 seconds</option></select></div></div><label class="form-checkbox"><input type="checkbox" name="private" checked ${clubhouse ? 'disabled' : ''}/>Invite only · ${clubhouse ? 'for your Clubhouse members' : 'share the room link with your friends'}</label>`}${ranked && !rankedReady ? '<div class="rules-box"><strong>Ranked is warming up.</strong><br>Competitive matchmaking is not enabled yet. Choose your own room to play the original game with friends.</div>' : ''}${!available ? '<div class="rules-box"><strong>The game server is not connected yet.</strong><br>Room creation will be available when the scribble.rs engine is running. You can explore the community in the meantime.</div>' : ''}<div class="rules-box archive-disclosure"><strong>Your drawing’s afterlife.</strong><br>Drawings are private by default and kept for 30 days. Replay data is kept for 7 days. Artwork becomes public only with the artist’s permission and an admin’s selection.</div>${button(canCreate ? ranked ? 'Find my competition' : 'Create my room' : available ? 'Ranked is coming soon' : 'Game server not connected','submit','arrow','yellow',`type="submit" ${!canCreate ? 'disabled' : ''}`)}<p class="form-note">${ranked ? 'Sign in to play ranked and keep your results.' : 'Opening a room takes you into the original drawing game.'}</p></form>`; }
function profileModal() { const person = user(); return `<div class="account-settings-heading">${avatar(person,'lg')}<div><h2 id="modal-title">Profile & settings</h2><p>${e(displayName(person))}<br>@${e(person.username)}</p></div></div><div class="account-avatar-action">${button('Change avatar','avatar','palette','outline')}</div><form data-form="profile">${errorSlot()}${field('displayName','Display name','What should we call you?','text',`required maxlength="32" value="${e(displayName(person))}"`)}<div class="form-field"><label for="field-bio">A little about you</label><textarea id="field-bio" name="bio" maxlength="240" placeholder="Tell the community a little about yourself.">${e(person.bio || '')}</textarea></div><p class="form-note">Current title: <strong>${e(person.title||'Rookie')}</strong> · assigned by community admins.</p><div class="form-field"><label for="field-avatarColor">Your color</label><select name="avatarColor" id="field-avatarColor">${[['#eee6ff','Lilac daydream'],['#ffe4cb','Peach please'],['#dcefe5','Mint condition'],['#f9dfed','Pink pencil'],['#dceaf8','Blue skies'],['#fff0b9','Golden doodle']].map(([color,label]) => `<option value="${color}" ${person.avatarColor === color ? 'selected' : ''}>${label}</option>`).join('')}</select></div>${button('Save profile','submit','check','yellow','type="submit"')}</form><details class="account-password-settings"><summary>${icon('lock')}Password & security${icon('down')}</summary>${passwordForm()}</details><div class="account-settings-footer">${button('View full profile','go-profile','user','outline')}${button('Log out','logout','logout','outline')}</div>`; }
function renderModal() {
  let contents = ''; let wide = false;
  switch(state.modal) {
    case 'clubhouse-detail': contents = clubhouseDetailModal(); wide = true; break;
    case 'create-clubhouse': contents = clubhouseFormModal(true); break;
    case 'request-clubhouse': contents = clubhouseFormModal(); break;
    case 'clubhouse-invite': contents = clubhouseInviteModal(); break;
    case 'review-clubhouse': contents = reviewClubhouseModal(); break;
    case 'auth': contents = authModal(); break;
    case 'room': contents = roomModal(); wide = true; break;
    case 'profile': contents = profileModal(); wide = true; break;
    case 'friend-profile': contents = friendProfileModal(); wide = true; break;
    case 'avatar-editor': contents = avatarEditorModal(); wide = true; break;
    case 'match': contents = matchModal(); wide = true; break;
    case 'my-drawings': contents = myDrawingsModal(); wide = true; break;
    case 'bracket': contents = officialBracketModal(); wide = true; break;
    case 'create-season': case 'activate-season': case 'create-tournament': case 'seed': case 'fixture-result': contents = competitionModal(state.modal); break;
    case 'invite': contents = inviteModal(); break;
    case 'share': contents = shareModal(); break;
    case 'friend': contents = `<div class="modal-icon">${icon('people')}</div><h2 id="modal-title">Find a familiar face.</h2><p>Add a friend using their Skribbil username.</p><form data-form="friend">${errorSlot()}${field('username','Friend’s username','Enter their username','text','required minlength="3" maxlength="24" autocomplete="off"')}${button('Add my friend','submit','plus','yellow','type="submit"')}</form>`; break;
    case 'party-invite': contents = partyInviteModal(); break;
    case 'team-detail': contents = teamDetailModal(); wide = true; break;
    case 'team-invite': contents = teamInviteModal(); break;
    case 'team-registration': contents = teamRegistrationModal(); break;
    case 'dispute': contents = disputeModal(); break;
    case 'resolve-dispute': contents = resolveDisputeModal(); wide = true; break;
    case 'my-disputes': contents = `<div class="modal-icon">${icon('flag')}</div><h2 id="modal-title">Your score reports.</h2><p>The community’s admins review completed match results and leave a response here.</p>${state.disputes?.length ? state.disputes.map(report => disputeCard(report)).join('') : empty('No reports to follow up on.','If a completed match result looks wrong, open its summary from your profile and report the issue.')}`; wide = true; break;
    case 'team': contents = `<div class="modal-icon">${icon('shield')}</div><h2 id="modal-title">Your squad needs a name.</h2><p>Make it memorable. This team follows you into future community games.</p><form data-form="team">${errorSlot()}${field('name','Team name','Name your team','text','required minlength="3" maxlength="40"')}${field('tag','Short team tag','e.g. THA','text','required minlength="2" maxlength="6" pattern="[A-Za-z0-9]+"')}${button('Bring the squad together','submit','plus','yellow','type="submit"')}</form>`; break;
    case 'adjustment': contents = `<div class="modal-icon">${icon('shield')}</div><h2 id="modal-title">Correct a match score.</h2><p>Corrections are recorded in the audit log.</p><form data-form="adjustment">${errorSlot()}${field('matchId','Match ID','','text','required')}${field('userId','Player ID','','text','required')}${field('delta','Point adjustment','e.g. -100 or 50','number','required step="1"')}${field('reason','Reason for the correction','Explain the verified issue','text','required minlength="10" maxlength="500"')}${button('Record correction','submit','check','primary','type="submit"')}</form>`; break;
    case 'assign-title': contents = titleAssignmentModal(); break;
    case 'ban': contents = `<div class="modal-icon">${icon('shield')}</div><h2 id="modal-title">Protect the community.</h2><p>Bans restrict the player’s community account and are audited.</p><form data-form="ban">${errorSlot()}${field('userId','Player ID','','text','required')}${field('reason','Reason for the ban','Describe the verified behavior','text','required minlength="10" maxlength="500"')}${button('Record account ban','submit','shield','primary','type="submit"')}</form>`; break;
    default: contents = `<div class="modal-icon">${icon('pencil')}</div><h2 id="modal-title">Bad drawings. Great times.</h2><p>Skribbil is the Clubhouse around your drawing game.</p><div class="help-copy"><h3>The game you came for.</h3><p>Take turns drawing a secret word. Everyone else guesses. The faster you get it, the more points you earn. We use the original open-source <a href="https://github.com/scribble-rs/scribble.rs" target="_blank" rel="noreferrer">scribble.rs engine</a> for drawing, guesses, rooms, and live multiplayer.</p><h3>A little competitive chaos.</h3><p>In community rooms, all eligible non-drawing players must dislike a drawing to trigger the penalty. It deducts 100 points from the artist once for that turn and gives them a harder word on their next drawing turn. Spectators never count.</p><h3>One identity. Every game.</h3><p>Your profile, league history, team, and cosmetic collection belong to the community. Skribbil is the first game, with room for more.</p><h3>Our walls are curated.</h3><p>Drawings become public only with the artist’s permission and admin curation. Uncurated artwork and replays follow the server’s retention policy.</p></div>`; wide = true;
  }
  dialogRoot.innerHTML = modalShell(contents,wide);
}
function toast(message, isError = false) { const node = document.createElement('div'); node.className = `toast ${isError ? 'error' : ''}`; node.innerHTML = `${icon(isError ? 'info' : 'check')}<span>${e(message)}</span>`; $('#toast-root').append(node); setTimeout(() => node.remove(),6500); }
function requireUser(callback) { if (!user()) { state.authMode = 'register'; openModal('auth'); return false; } callback(); return true; }
function setFormError(message,form = null) { const error = form?.querySelector('[data-form-error],[data-upload-error],#form-error') || $('#form-error'); if (error) { error.textContent = message; error.hidden = false; } else toast(message,true); }

async function loadClubhouses({quiet=false}={}) {
  if (!user() || state.clubhousesLoading) return;
  state.clubhousesLoading = true;
  try { state.clubhouseState = await api('/api/clubhouses'); state.clubhousesLoaded = true; state.clubhousesError = null; }
  catch(error) { if (error.code === 'ACCOUNT_CHANGED') return; state.clubhousesError = error.message; if (!quiet) toast(error.message,true); }
  finally { state.clubhousesLoading = false; if (state.route === 'clubhouses') render(); }
}
function clubhouseRequestCard(request,admin=false) {
  const pending = request.status === 'pending';
  return `<article class="clubhouse-request"><div class="clubhouse-request-heading"><h3>${e(request.name)}</h3>${tag(e(request.status || 'pending'),pending ? 'yellow' : request.status === 'approved' ? 'green' : '')}</div>${request.description ? `<p>${e(request.description)}</p>` : ''}<small>${admin ? `Requested by ${e(request.requester?.username || 'a community member')} · ` : ''}${e(readableDate(request.createdAt))}</small>${request.reason ? `<p class="request-decision"><strong>Admin response:</strong> ${e(request.reason)}</p>` : ''}${admin && pending ? `<div class="admin-actions">${button('Review request','review-clubhouse','shield','outline',`data-id="${e(request.id)}"`)}</div>` : ''}${request.clubhouseId ? `<div class="admin-actions">${button('View clubhouse','clubhouse-detail','arrow','outline',`data-id="${e(request.clubhouseId)}"`)}</div>` : ''}</article>`;
}
function clubhousesPage() {
  const data = state.clubhouseState || {}; const groups = data.clubhouses || []; const invites = data.invites || []; const requests = data.requests || [];
  return `${heading('YOUR PEOPLE. YOUR LITTLE CORNER.','There’s room for your regulars.','Invite-only groups for every game we play. One account, one community, plenty of inside jokes.',user() ? button(isAdmin() ? 'Create a Clubhouse' : 'Request a Clubhouse',isAdmin() ? 'create-clubhouse' : 'request-clubhouse','plus','yellow') : button('Sign in to join','auth','user','yellow'))}<div class="info-card clubhouse-intro"><span class="stat-icon yellow">${icon('home')}</span><div><h3>A Clubhouse is your private hangout.</h3><p>Members can start private game rooms together. Your competitive team, profile, and global league identity still travel with you everywhere. New Clubhouses need a platform admin’s approval.</p></div></div>${!user() ? empty('A familiar place for your favourite people.','Sign in to see your Clubhouse invitations or request a new group. Membership is by invitation. Your groups are not publicly listed.') : `<div class="section-heading section-space"><h2>${icon('home')}Your Clubhouses</h2><button class="text-link" data-action="refresh-clubhouses">Refresh ${icon('refresh')}</button></div>${state.clubhousesError ? `<div class="engine-banner">${icon('info')}<span>${e(state.clubhousesError)}</span></div>` : ''}${!state.clubhousesLoaded ? empty('Finding your people…','Your private groups will appear here.') : groups.length ? `<div class="clubhouse-grid">${groups.map(group => `<article class="clubhouse-card"><div class="clubhouse-card-top"><span class="clubhouse-symbol">${icon('home')}</span>${tag(e(group.myRole || 'member'))}</div><h3>${e(group.name)}</h3><p>${e(group.description || 'A little space for good company and questionable drawings.')}</p><div class="clubhouse-card-bottom"><small>${group.memberCount != null ? plural(group.memberCount,'member') : 'Member count unavailable'}</small>${button('Step inside','clubhouse-detail','arrow','outline',`data-id="${e(group.id)}"`)}</div></article>`).join('')}</div>` : empty('Your corner of the community starts here.','Accept an invitation below, or request a Clubhouse for your regular group.')}${invites.length ? `<section class="section-space"><div class="section-heading"><h2>${icon('people')}You’re invited</h2></div><div class="panel">${invites.map(invite => `<div class="clubhouse-invite"><div><h3>${e(invite.clubhouseName)}</h3><p>From ${e(typeof invite.from === 'object' ? invite.from.username : invite.from)} · expires ${e(readableDate(invite.expiresAt))}</p></div>${button('Accept invitation','accept-clubhouse','check','yellow',`data-id="${e(invite.id)}"`)}</div>`).join('')}</div></section>` : ''}${requests.length ? `<section class="section-space"><div class="section-heading"><h2>${icon('clock')}Your clubhouse requests</h2></div><div class="clubhouse-request-grid">${requests.map(request => clubhouseRequestCard(request)).join('')}</div></section>` : ''}`}`;
}
async function showClubhouse(id) { const result = await api(`/api/clubhouses/${encodeURIComponent(id)}`); state.clubhouseDetail = result.clubhouse; if (!state.clubhouseDetail) throw new Error('This Clubhouse is not available.'); openModal('clubhouse-detail'); }
function clubhouseRooms(group) {
  const rooms = group.rooms || [];
  return `<section class="section-space clubhouse-live-rooms"><div class="section-heading"><h3 class="modal-section-title">The drawing rooms</h3><button class="text-link" data-action="refresh-clubhouse">Refresh ${icon('refresh')}</button></div>${rooms.length ? `<div class="panel">${rooms.map(room => `<div class="room-row"><span class="room-icon">${icon('palette')}</span><div class="room-info"><div class="room-name">${room.owner ? 'Your room' : 'Skribbil room'} ${tag('PRIVATE','green')}</div><div class="room-desc">${e(room.status || 'Waiting for players')} · ${plural(Number(room.players) || 0,'player')}</div></div>${button('Join room','resume-room','arrow','yellow',`data-id="${e(room.id)}"`)}${button('Watch','spectate-room','eye','outline',`data-id="${e(room.id)}"`)}${room.owner && ['lobby','waiting'].includes(room.status) ? button('Close room','cancel-clubhouse-room','','outline',`data-id="${e(room.id)}"`) : ''}</div>`).join('')}</div>` : '<div class="rules-box">The canvas is quiet. Start a private room above and gather your Clubhouse.</div>'}</section>`;
}
function clubhouseDetailModal() {
  const group = state.clubhouseDetail; if (!group) return empty('This Clubhouse is not available.','Refresh your groups and try again.');
  const members = group.members || []; const member = !group.archived && members.some(person => person.id === user()?.id); const owner = group.ownerId === user()?.id; const manage = !group.archived && (owner || group.myRole === 'admin' || isAdmin()); const control = !group.archived && (owner || isAdmin()); const others = members.filter(person => person.id !== group.ownerId); const canLeave = member && (!owner || members.length === 1);
  return `<div class="modal-icon">${icon('home')}</div><h2 id="modal-title">${e(group.name)}</h2><p>${e(group.description || 'Good company has a home here.')}</p><div class="clubhouse-detail-meta">${tag(group.archived ? 'ARCHIVED' : 'INVITE ONLY',group.archived ? '' : 'green')}<span>${plural(members.length,'member')}</span>${group.myRole ? tag(e(group.myRole)) : ''}</div>${group.archived ? '<div class="rules-box">This Clubhouse is archived. New rooms and invitations are closed.</div>' : `<div class="admin-actions clubhouse-primary-actions">${member ? button('Start a private room','clubhouse-room','pencil','yellow') : '<p class="form-note">Only current members can play or watch this Clubhouse’s rooms.</p>'}${manage ? button('Invite a member','invite-clubhouse','plus','outline') : ''}</div><p class="form-note">Clubhouse rooms stay inside this group. A shared link also checks that the person is a member.</p>`}${member ? clubhouseRooms(group) : ''}<section class="section-space"><h3 class="modal-section-title">The regulars</h3><div class="clubhouse-roster">${members.map(person => { const personOwner = person.id === group.ownerId; const canRemove = manage && !personOwner && person.id !== user()?.id && (control || person.role === 'member'); return `<div class="clubhouse-member">${avatar(person,'sm')}<div class="clubhouse-member-name"><strong>${e(person.username)}</strong><small>${e(personOwner ? 'owner' : person.role || 'member')}${person.id === user()?.id ? ' · you' : ''}</small></div><div class="clubhouse-member-actions">${control && !personOwner ? button(person.role === 'admin' ? 'Make member' : 'Make admin','clubhouse-role','','outline',`data-id="${e(person.id)}" data-role="${person.role === 'admin' ? 'member' : 'admin'}"`) : ''}${canRemove ? button('Remove','remove-clubhouse-member','','outline',`data-id="${e(person.id)}"`) : ''}</div></div>`; }).join('')}</div></section>${control && others.length ? `<form data-form="clubhouse-owner" class="section-space"><h3 class="modal-section-title">Pass the keys</h3><p class="form-note">The new owner controls membership and Clubhouse admins. Your membership stays, but ownership changes immediately.</p><div data-form-error class="form-error" role="alert" hidden></div><div class="form-field"><label for="clubhouse-owner">New owner</label><select name="userId" id="clubhouse-owner" required>${others.map(person => `<option value="${e(person.id)}">${e(person.username)}</option>`).join('')}</select></div>${button('Transfer ownership','submit','arrow','outline','type="submit"')}</form>` : ''}${member ? `<div class="clubhouse-leave section-space">${button('Leave Clubhouse','leave-clubhouse','logout','outline',canLeave ? '' : 'disabled')}<p class="form-note">${owner ? members.length > 1 ? 'Pass the keys to another member before leaving.' : 'As its last member, leaving will archive this Clubhouse.' : 'You’ll need a new invitation to come back.'}</p></div>` : ''}`;
}
function clubhouseFormModal(create=false) { return `<div class="modal-icon">${icon('home')}</div><h2 id="modal-title">${create ? 'Make room for your people.' : 'Let’s find your group a home.'}</h2><p>${create ? 'Create an invite-only Clubhouse. You’ll be its first owner and can pass ownership to a member later.' : 'Tell the community admins about your group. When approved, you’ll be the owner and can invite your people.'}</p><form data-form="${create ? 'create-clubhouse' : 'request-clubhouse'}">${errorSlot()}${field('name','Clubhouse name','A name your people will recognise','text','required minlength="2" maxlength="48"')}<div class="form-field"><label for="clubhouse-description">About your group</label><textarea id="clubhouse-description" name="description" maxlength="500" placeholder="Who’s hanging out here? What will you play?"></textarea></div>${button(create ? 'Create Clubhouse' : 'Send for approval','submit','arrow','yellow','type="submit"')}</form>`; }
function clubhouseInviteModal() { return `<div class="modal-icon">${icon('people')}</div><h2 id="modal-title">Save a seat for someone.</h2><p>Invite a player to ${e(state.clubhouseDetail?.name)}. Invitations expire after 7 days. Up to 64 members can share a Clubhouse.</p><form data-form="clubhouse-invite">${errorSlot()}${field('username','Player’s username','','text','required minlength="3" maxlength="24" autocomplete="off"')}${button('Send invitation','submit','plus','yellow','type="submit"')}</form>`; }
async function loadClubhouseRequests() { if (!isAdmin()) return; try { const result = await api('/api/clubhouse-requests'); state.clubhouseRequests = result.requests || []; state.clubhouseRequestsError = null; } catch(error) { if (error.code === 'ACCOUNT_CHANGED') return; state.clubhouseRequestsError = error.message; } if (state.route === 'admin') render(); }
function clubhouseAdminPanel() { const requests = state.clubhouseRequests || []; return `<section class="section-space"><div class="section-heading"><h2>${icon('home')}Clubhouse requests</h2><div class="admin-actions">${button('Create Clubhouse','create-clubhouse','plus','outline')}${button('Refresh','refresh-clubhouse-requests','refresh','outline')}</div></div>${state.clubhouseRequestsError ? `<p class="form-error">${e(state.clubhouseRequestsError)}</p>` : state.clubhouseRequests ? requests.length ? `<div class="clubhouse-request-grid">${requests.map(request => clubhouseRequestCard(request,true)).join('')}</div>` : '<div class="info-card"><p>No Clubhouse requests to review yet.</p></div>' : '<div class="info-card"><p>Loading clubhouse requests…</p></div>'}</section>`; }
function reviewClubhouseModal() { const request = state.clubhouseRequest; return `<div class="modal-icon">${icon('shield')}</div><h2 id="modal-title">A new place for ${e(request?.requester?.username || 'the group')}.</h2><div class="rules-box"><strong>${e(request?.name)}</strong><br>${e(request?.description || 'No description provided.')}</div><p>Approval creates an invite-only Clubhouse with the requester as its owner. Your response is visible to them.</p><form data-form="review-clubhouse">${errorSlot()}<div class="form-field"><label for="clubhouse-decision">Your decision</label><select id="clubhouse-decision" name="status"><option value="approved">Approve and create clubhouse</option><option value="rejected">Decline request</option></select></div><div class="form-field"><label for="clubhouse-reason">Response to the requester</label><textarea id="clubhouse-reason" name="reason" required minlength="5" maxlength="2000"></textarea></div>${button('Save decision','submit','check','yellow','type="submit"')}</form>`; }
function titleAssignmentModal() { const admin=state.admin;return `<h2 id="modal-title">Assign a community title.</h2><p>Titles come from the community's existing collection. Every change is audited.</p><form data-form="assign-title">${errorSlot()}<div class="form-field"><label for="title-user">Player</label><select id="title-user" name="userId" required><option value="" disabled selected>Select a player</option>${(admin?.users||[]).filter(p=>p.status!=='erased').map(p=>`<option value="${e(p.id)}">${e(p.username)}</option>`).join('')}</select></div><div class="form-field"><label for="title-definition">Title</label><select id="title-definition" name="titleId"><option value="">Restore default · Rookie</option>${(admin?.titles||[]).map(t=>`<option value="${e(t.id)}">${e(t.name)}</option>`).join('')}</select></div>${field('reason','Reason for title assignment','','text','required minlength="5" maxlength="500"')}${button('Assign title','submit','check','yellow',`type="submit" ${!admin?.users?.length?'disabled':''}`)}</form>`; }
function passwordForm() { return `<form data-form="password" class="section-space account-security"><h3 class="modal-section-title">Change your password</h3><p class="form-note">Use 12–128 characters. You’ll stay signed in here, and your other sessions will be signed out.</p><div data-form-error class="form-error" role="alert" hidden></div>${field('currentPassword','Current password','','password','required maxlength="128" autocomplete="current-password"')}${field('newPassword','New password','','password','required minlength="12" maxlength="128" autocomplete="new-password"')}${field('confirmPassword','Confirm new password','','password','required minlength="12" maxlength="128" autocomplete="new-password"')}${button('Change password','submit','lock','outline','type="submit"')}</form>`; }

async function handleAction(action, element) {
  switch(action) {
    case 'toggle-nav': state.mobileNav = !state.mobileNav; render(); $(state.mobileNav ? '.sidebar .nav-link' : '.mobile-toggle')?.focus(); break;
    case 'help': openModal('help'); break;
    case 'auth': state.authMode = 'register'; openModal('auth'); break;
    case 'toggle-auth': state.authMode = state.authMode === 'register' ? 'login' : 'register'; renderModal(); $('input',dialogRoot)?.focus(); break;
    case 'close-modal': if(!state.busy)closeModal(); break;
    case 'go-profile': closeModal(); location.hash = '/profile'; break;
    case 'go-league': location.hash = '/league'; break;
    case 'go-teams': closeModal(); state.socialTab = 'teams'; location.hash = '/friends'; if (state.route === 'friends') { render(); await loadMyTeams(); } break;
    case 'play': state.roomClubhouseId = null; state.roomClubhouseName = null; state.roomMode = state.data.engine?.ranked ? 'ranked' : 'private'; openModal('room'); break;
    case 'private-room': state.roomClubhouseId = null; state.roomClubhouseName = null; state.roomMode = 'private'; openModal('room'); break;
    case 'room-mode': state.roomMode = !state.roomClubhouseId && element.dataset.value === 'ranked' ? 'ranked' : 'private'; renderModal(); break;
    case 'account-settings': requireUser(() => openModal('profile')); break;
    case 'avatar': requireUser(() => openModal('avatar-editor')); break;
    case 'avatar-mode': if(state.busy)return;state.photoGeneration=(state.photoGeneration||0)+1;state.photoCropper?.dispose();state.photoCropper=null; if (!state.busy && state.modal === 'avatar-editor' && ['preset','upload'].includes(element.dataset.mode)) { if (state.avatarUploadUrl) URL.revokeObjectURL(state.avatarUploadUrl); state.avatarUploadUrl = null; state.avatarMode=element.dataset.mode; renderModal(); $(`[data-action="avatar-mode"][data-mode="${state.avatarMode}"]`,dialogRoot)?.focus(); } break;
    case 'avatar-tab': case 'avatar-choice': case 'avatar-random': case 'avatar-reset': case 'avatar-vibe': changeAvatar(action,element); break;
    case 'add-friend': requireUser(() => openModal('friend')); break;
    case 'respond-friend': await respondFriendRequest(element.dataset.id,element.dataset.response); break;
    case 'refresh-friends': await refreshFriends(); break;
    case 'friend-profile': await openFriendProfile(element.dataset.id); break;
    case 'create-team': requireUser(() => openModal('team')); break;
    case 'refresh-clubhouse': await showClubhouse(state.clubhouseDetail.id); break;
    case 'cancel-clubhouse-room': element.disabled = true; try { await api('/api/rooms/'+encodeURIComponent(element.dataset.id)+'/cancel',{method:'POST',body:'{}'}); await showClubhouse(state.clubhouseDetail.id); await refresh({silent:true}); toast('Room closed. A fresh canvas is ready when you are.'); } finally { if (element.isConnected) element.disabled = false; } break;
    case 'refresh-clubhouses': await loadClubhouses(); break;
    case 'refresh-clubhouse-requests': await loadClubhouseRequests(); break;
    case 'create-clubhouse': if (isAdmin()) openModal('create-clubhouse'); break;
    case 'request-clubhouse': requireUser(() => openModal('request-clubhouse')); break;
    case 'clubhouse-detail': await showClubhouse(element.dataset.id); break;
    case 'invite-clubhouse': openModal('clubhouse-invite'); break;
    case 'review-clubhouse': state.clubhouseRequest = state.clubhouseRequests?.find(request => request.id === element.dataset.id); if (isAdmin() && state.clubhouseRequest) openModal('review-clubhouse'); break;
    case 'clubhouse-room': state.roomClubhouseId = state.clubhouseDetail.id; state.roomClubhouseName = state.clubhouseDetail.name; state.roomMode = 'private'; openModal('room'); break;
    case 'accept-clubhouse': element.disabled = true; try { const result = await api('/api/clubhouse-invites/'+encodeURIComponent(element.dataset.id)+'/accept',{method:'POST',body:'{}'}); await loadClubhouses(); if (result.clubhouseId) await showClubhouse(result.clubhouseId); toast('You’re in. Welcome to your Clubhouse!'); } finally { if (element.isConnected) element.disabled = false; } break;
    case 'leave-clubhouse': element.disabled = true; try { await api('/api/clubhouses/'+encodeURIComponent(state.clubhouseDetail.id)+'/leave',{method:'POST',body:'{}'}); closeModal(); await loadClubhouses(); await refresh({silent:true}); toast('You’ve left the Clubhouse.'); } finally { if (element.isConnected) element.disabled = false; } break;
    case 'clubhouse-role': case 'remove-clubhouse-member': element.disabled = true; try { const id = state.clubhouseDetail.id; const remove = action === 'remove-clubhouse-member'; await api('/api/clubhouses/'+encodeURIComponent(id)+(remove ? '/members/'+encodeURIComponent(element.dataset.id)+'/remove' : '/roles'),{method:'POST',body:JSON.stringify(remove ? {} : {userId:element.dataset.id,role:element.dataset.role})}); await showClubhouse(id); await loadClubhouses({quiet:true}); toast(remove ? 'The member has been removed.' : 'The member’s Clubhouse role has been updated.'); } finally { if (element.isConnected) element.disabled = false; } break;
    case 'refresh-party': await loadParty(); break;
    case 'refresh-teams': await loadMyTeams(); break;
    case 'team-detail': if (!user()) { state.returnAfterAuth = {type:'team',id:element.dataset.id}; requireUser(() => {}); } else await showTeam(element.dataset.id); break;
    case 'invite-team': openModal('team-invite'); break;
    case 'accept-team': element.disabled = true; try { await api(`/api/teams/invites/${encodeURIComponent(element.dataset.id)}/accept`,{method:'POST',body:'{}'}); await loadMyTeams(); await refresh({silent:true}); toast('You’re on the team. Make some memories!'); } finally { if (element.isConnected) element.disabled = false; } break;
    case 'leave-team': element.disabled = true; try { await api(`/api/teams/${encodeURIComponent(state.teamDetail.id)}/leave`,{method:'POST',body:'{}'}); closeModal(); await loadMyTeams(); await refresh({silent:true}); toast('You’ve left the team.'); } finally { if (element.isConnected) element.disabled = false; } break;
    case 'my-disputes': await loadDisputes(); break;
    case 'report-dispute': openModal('dispute'); break;
    case 'refresh-disputes': await loadAdminDisputes(); break;
    case 'resolve-dispute': state.activeDispute = state.adminDisputes?.find(report => report.id === element.dataset.id); if (state.activeDispute) openModal('resolve-dispute'); break;
    case 'quick-rematch': element.disabled = true; try { const result = await api(`/api/matches/${encodeURIComponent(element.dataset.id)}/rematch`,{method:'POST',body:'{}'}); const url = safeUrl(result.url); if (!url) throw new Error('The server did not return a valid rematch link.'); location.assign(url); } catch(error) { await refresh(); throw new Error(error.message + (rows('ownRooms').length ? ' You have a saved room in the commons that you can resume.' : '')); } finally { if (element.isConnected) element.disabled = false; } break;
    case 'remove-avatar': if(state.busy)return; element.disabled = true; try { await api('/api/profile/avatar',{method:'DELETE',body:'{}'}); closeModal(); await refresh({silent:true}); toast('Your profile picture has been removed.'); } finally { if (element.isConnected) element.disabled = false; } break;
    case 'remove-team-logo': if(state.busy)return; element.disabled = true; try { const teamId = state.teamDetail.id; await api(`/api/teams/${encodeURIComponent(teamId)}/logo`,{method:'DELETE',body:'{}'}); await refresh({silent:true}); await loadMyTeams(); await showTeam(teamId); toast('Your team logo has been removed.'); } finally { if (element.isConnected) element.disabled = false; } break;
    case 'invite-party': requireUser(() => openModal('party-invite')); break;
    case 'create-party': if (!user()) { requireUser(() => {}); break; } element.disabled = true; try { await changeParty('/api/party'); toast('Your party is ready. Invite your people!'); } finally { if (element.isConnected) element.disabled = false; } break;
    case 'leave-party': element.disabled = true; try { await changeParty('/api/party/leave'); toast('You’ve left the party.'); } finally { if (element.isConnected) element.disabled = false; } break;
    case 'accept-party': element.disabled = true; try { await changeParty(`/api/party/invites/${encodeURIComponent(element.dataset.id)}/accept`); toast('You’re in. Time to round up the squad.'); } finally { if (element.isConnected) element.disabled = false; } break;
    case 'adjust-score': if (isAdmin()) openModal('adjustment'); break;
    case 'admin-create-season': case 'admin-activate-season': case 'admin-create-tournament': case 'admin-seed': case 'admin-fixture-result': if (isAdmin()) openModal(action.replace('admin-','')); break;
    case 'view-bracket': await showBracket(element.dataset.id); break;
    case 'assign-title': if(isAdmin())openModal('assign-title');break;
    case 'ban-player': if (isAdmin()) openModal('ban'); break;
    case 'leaderboard-tab': state.leaderboardTab = element.dataset.value; render(); break;
    case 'community-tab': state.communityTab = element.dataset.value; render(); break;
    case 'social-tab': state.socialTab = element.dataset.value; render(); if (state.socialTab === 'teams' && user()) await loadMyTeams(); break;
    case 'refresh': element.disabled = true; await refresh(); break;
    case 'refresh-admin': await loadAdmin(); break;
    case 'view-match': await openMatch(element.dataset.id); break;
    case 'save-summary': if (state.match) await downloadSummary(state.match); break;
    case 'my-drawings': requireUser(() => loadMyDrawings()); break;
    case 'drawing-consent': await updateDrawingConsent(element); break;
    case 'spectate-room': await joinRoom(element.dataset.id,'spectator'); break;
    case 'resume-room': await joinRoom(element.dataset.id,'player'); break;
    case 'share-room': state.shareRoomId = element.dataset.id; openModal('share'); break;
    case 'copy-invite': await copyInvite(); break;
    case 'accept-invite': await joinRoom(state.pendingJoin,state.pendingRole || 'player'); break;
    case 'cancel-room': element.disabled = true; try { await api(`/api/rooms/${encodeURIComponent(element.dataset.id)}/cancel`,{method:'POST',body:'{}'}); await refresh({silent:true}); toast('Room closed. You can start a fresh canvas.'); } finally { if (element.isConnected) element.disabled = false; } break;
    case 'join-room': { const room = rows('rooms').find(item => String(item.id) === element.dataset.id); if (room) await joinRoom(element.dataset.id,'player'); break; }
    case 'register-tournament': if (!user()) { requireUser(() => {}); break; } { const tournament = rows('tournaments').find(item => item.id === element.dataset.id); if (tournament?.entryType === 'team') { await loadMyTeams({quiet:true}); if (state.teamsError) throw new Error(state.teamsError); state.teamTournament = tournament; openModal('team-registration'); break; } } element.disabled = true; try { await api(`/api/tournaments/${encodeURIComponent(element.dataset.id)}/register`,{method:'POST',body:'{}'}); await refresh({silent:true}); toast('You’re on the list. Time to warm up those drawing hands!'); } finally { if (element.isConnected) element.disabled = false; } break;
    case 'claim': element.disabled = true; try { await api(`/api/challenges/${encodeURIComponent(element.dataset.id)}/claim`,{method:'POST',body:'{}'}); await refresh({silent:true}); toast('Side quest complete. XP added to your story!'); } finally { if (element.isConnected) element.disabled = false; } break;
    case 'curate': if (!isAdmin()) return; element.disabled = true; try { await api(`/api/admin/drawings/${encodeURIComponent(element.dataset.id)}`,{method:'POST',body:JSON.stringify({hall:element.dataset.hall || null})}); await loadAdmin(); await refresh({silent:true}); toast('The gallery has been updated.'); } finally { if (element.isConnected) element.disabled = false; } break;
    case 'logout': await api('/api/auth/logout',{method:'POST',body:'{}'}); resetAccountViews(); closeModal(); state.admin = null; state.partyState = null; state.partyLoaded = false; state.partyError = null; state.myTeams = null; state.teamsLoaded = false; state.clubhouseState = null; state.clubhousesLoaded = false; state.clubhouseDetail = null; state.clubhouseRequests = null; state.roomClubhouseId = null; await refresh(); toast('See you for the next round.'); break;
    default: break;
  }
}
async function submitForm(form) {
  if (state.busy) return;
  const fields = Object.fromEntries(new FormData(form)); const kind = form.dataset.form;
  if (kind === 'room' && !user()) { state.returnAfterAuth = {type:'room'}; state.authMode = 'register'; openModal('auth'); toast('Make an account to save your place in the community.'); return; }
  const error = form.querySelector('[data-form-error],[data-upload-error],#form-error'); if (error) error.hidden = true;
  const submit = form.querySelector('[type="submit"]'); const originalText = submit?.innerHTML; const photoInput=['avatar','team-logo'].includes(kind)?form.querySelector('input[type=file]'):null; if(photoInput)photoInput.disabled=true;
  state.busy = true; state.photoCropper?.setBusy(true); if (submit) { submit.disabled = true; submit.innerHTML = 'One little moment…'; }
  try {
    let message = '';
    if (kind === 'auth') { await api(`/api/auth/${state.authMode}`,{method:'POST',body:JSON.stringify({...fields,rememberMe:form.elements.namedItem('rememberMe').checked})}); resetAccountViews(); message = state.authMode === 'register' ? 'You’re one of us now. Welcome to the community!' : 'Welcome back. Let’s make some questionable art.'; }
    if (kind === 'password') { if (fields.newPassword !== fields.confirmPassword) throw new Error('The new passwords do not match.'); await api('/api/auth/password',{method:'POST',body:JSON.stringify({currentPassword:fields.currentPassword,newPassword:fields.newPassword})}); form.reset(); message = 'Password changed. Your other sessions have been signed out.'; }
    if (kind === 'create-clubhouse' || kind === 'request-clubhouse') { await api(kind === 'create-clubhouse' ? '/api/clubhouses' : '/api/clubhouse-requests',{method:'POST',body:JSON.stringify(fields)}); state.clubhousesLoaded = false; message = kind === 'create-clubhouse' ? 'Your clubhouse is ready. Invite your people!' : 'Request sent. You can follow its progress in Clubhouses.'; }
    if (kind === 'clubhouse-invite') { await api('/api/clubhouses/'+encodeURIComponent(state.clubhouseDetail.id)+'/invites',{method:'POST',body:JSON.stringify(fields)}); message = 'Clubhouse invitation sent. They can accept from Clubhouses.'; }
    if (kind === 'clubhouse-owner') { await api('/api/clubhouses/'+encodeURIComponent(state.clubhouseDetail.id)+'/owner',{method:'POST',body:JSON.stringify(fields)}); state.clubhousesLoaded = false; message = 'The clubhouse has a new owner. The keys are in their hands.'; }
    if (kind === 'review-clubhouse') { await api('/api/clubhouse-requests/'+encodeURIComponent(state.clubhouseRequest.id),{method:'POST',body:JSON.stringify(fields)}); state.clubhousesLoaded = false; message = fields.status === 'approved' ? 'Request approved. Their new clubhouse is ready.' : 'The request and your response have been saved.'; }
    if (kind === 'create-season') { const startsAt = new Date(fields.startsAt).toISOString(); const endsAt = new Date(fields.endsAt).toISOString(); if (endsAt <= startsAt) throw new Error('A season must end after it starts.'); await api('/api/admin/seasons',{method:'POST',body:JSON.stringify({...fields,startsAt,endsAt})}); message = 'The season is created. Activate it when your community is ready.'; }
    if (kind === 'activate-season') { await api(`/api/admin/seasons/${encodeURIComponent(fields.seasonId)}/activate`,{method:'POST',body:'{}'}); message = 'Your new league season is active.'; }
    if (kind === 'create-tournament') { const startsAt = new Date(fields.startsAt).toISOString(); const registrationClosesAt = new Date(fields.registrationClosesAt).toISOString(); if (registrationClosesAt > startsAt) throw new Error('Registration must close before the tournament starts.'); await api('/api/admin/tournaments',{method:'POST',body:JSON.stringify({...fields,startsAt,registrationClosesAt,maxEntries:Number(fields.maxEntries)})}); message = 'Your tournament is ready for its contenders.'; }
    if (kind === 'seed') { await api(`/api/admin/tournaments/${encodeURIComponent(fields.tournamentId)}/seed`,{method:'POST',body:'{}'}); message = 'The tournament bracket has been generated.'; }
    if (kind === 'fixture-result') { await api(`/api/admin/fixtures/${encodeURIComponent(fields.fixtureId)}/result`,{method:'POST',body:JSON.stringify({winnerEntryId:fields.winnerEntryId,reason:fields.reason})}); message = 'The fixture result has been recorded.'; }
    if (kind === 'team-registration') { await api(`/api/tournaments/${encodeURIComponent(state.teamTournament.id)}/register`,{method:'POST',body:JSON.stringify(fields)}); message = 'Your team is entered. Time to warm up those drawing hands!'; }
    if (kind === 'avatar') { await api('/api/profile/avatar',{method:'POST',body:JSON.stringify(await imagePayload(form))}); message = 'Your new profile picture is ready for the Clubhouse.'; }
    if (kind === 'team-logo') { await api(`/api/teams/${encodeURIComponent(state.teamDetail.id)}/logo`,{method:'POST',body:JSON.stringify(await imagePayload(form))}); state.teamsLoaded = false; message = 'Your team has a fresh new badge.'; }
    if (kind === 'team-invite') { await api(`/api/teams/${encodeURIComponent(state.teamDetail.id)}/invites`,{method:'POST',body:JSON.stringify(fields)}); message = 'Team invitation sent. They can accept from their team corner.'; }
    if (kind === 'transfer-captain') { await api(`/api/teams/${encodeURIComponent(state.teamDetail.id)}/captain`,{method:'POST',body:JSON.stringify(fields)}); state.teamsLoaded = false; message = 'Captaincy has been passed to your teammate.'; }
    if (kind === 'dispute') { await api('/api/disputes',{method:'POST',body:JSON.stringify({...fields,matchId:state.match.match.id})}); message = 'Your score report is in. Follow it from My reports on your profile.'; }
    if (kind === 'resolve-dispute') { await api(`/api/admin/disputes/${encodeURIComponent(state.activeDispute.id)}`,{method:'POST',body:JSON.stringify(fields)}); message = 'The report’s resolution has been saved.'; }
    if (kind === 'profile') { await api('/api/profile',{method:'PATCH',body:JSON.stringify({displayName:fields.displayName,bio:fields.bio,avatarColor:fields.avatarColor})}); message = 'Looking good. Your profile has been saved.'; }
    if (kind === 'avatar-preset') { await api('/api/profile',{method:'PATCH',body:JSON.stringify({avatarPreset:state.avatarDraft})}); message = 'Your scribbler has a fresh new look.'; }
    if (kind === 'friend') { await api('/api/friends',{method:'POST',body:JSON.stringify(fields)}); message = 'Your friend connection has been saved.'; }
    if (kind === 'party-invite') { if (!state.partyState?.party?.id) throw new Error('Your party is no longer available. Refresh and try again.'); await api(`/api/party/${encodeURIComponent(state.partyState.party.id)}/invites`,{method:'POST',body:JSON.stringify(fields)}); await loadParty(); message = 'Party invitation sent. Your friend can accept from Friends & teams.'; }
    if (kind === 'team') { state.teamsLoaded = false; await api('/api/teams',{method:'POST',body:JSON.stringify(fields)}); message = 'Your team is ready for its first chapter.'; state.socialTab = 'teams'; }
    if (kind === 'adjustment') { await api('/api/admin/adjustments',{method:'POST',body:JSON.stringify({...fields,delta:Number(fields.delta)})}); message = 'Score correction recorded in the audit log.'; }
    if (kind === 'mvp') { await api(`/api/matches/${encodeURIComponent(state.match.match.id)}/mvp`,{method:'POST',body:JSON.stringify(fields)}); message = 'Your MVP vote is in. Give your fellow scribblers their flowers!'; }
    if (kind === 'assign-title') { await api(`/api/admin/users/${encodeURIComponent(fields.userId)}/title`,{method:'POST',body:JSON.stringify({titleId:fields.titleId||null,reason:fields.reason})}); message='Title assigned and recorded in the audit log.'; }
    if (kind === 'ban') { await api('/api/admin/bans',{method:'POST',body:JSON.stringify(fields)}); message = 'The account ban has been recorded.'; }
    if (kind === 'room') { const payload = {mode:state.roomMode,...(state.roomMode === 'private' ? {rounds:Number(fields.rounds || 3),drawTime:Number(fields.drawTime || 80),private:!!state.roomClubhouseId || fields.private === 'on'} : {}),...(state.roomClubhouseId ? {clubhouseId:state.roomClubhouseId} : {})}; const result = await api('/api/rooms',{method:'POST',body:JSON.stringify(payload)}); const url = safeUrl(result.url); if (!url) throw new Error('The server did not return a valid game link.'); location.assign(url); return; }
    if (kind === 'auth') { state.partyState = null; state.partyLoaded = false; state.partyError = null; state.myTeams = null; state.teamsLoaded = false; state.teamsError = null; state.clubhouseState = null; state.clubhousesLoaded = false; state.clubhousesError = null; state.clubhouseRequests = null; }
    closeModal(); await refresh({silent:true}); if (state.route === 'admin') await loadAdmin(); toast(message); if (kind === 'auth' && state.returnAfterAuth) { const next = state.returnAfterAuth; state.returnAfterAuth = null; if (next.type === 'room') openModal('room'); else if (next.type === 'join') { state.pendingJoin = next.id; state.pendingRole = next.role; openModal('invite'); } else if (next.type === 'team') await showTeam(next.id); }
  } catch (error) { if (kind === 'room') { await refresh(); const saved = rows('ownRooms').length ? ' You have a saved room in the commons that you can resume.' : ''; setFormError((error.message || 'The room could not be opened.') + saved,$('form',dialogRoot)); } else setFormError(error.message || 'That did not work. Please try again.',form); }
  finally { state.busy = false; if(photoInput)photoInput.disabled=false; state.photoCropper?.setBusy(false); if (submit?.isConnected) { submit.disabled = false; submit.innerHTML = originalText; } }
}
async function loadAdmin() { if (!isAdmin()) return; try { state.admin = await api('/api/admin'); await loadAdminDisputes(); await loadClubhouseRequests(); render(); } catch(error) { toast(error.message,true); } }
document.addEventListener('click',event => {
  const element = event.target.closest('[data-action]');
  if (element && !element.disabled) { if (element.dataset.action === 'submit') return; event.preventDefault(); handleAction(element.dataset.action,element).catch(error => { if (error.code !== 'ACCOUNT_CHANGED') toast(error.message || 'Please try again.',true); }); }
  if (event.target.dataset.backdrop && !state.busy) closeModal();
  const navLink = event.target.closest('.nav-link,.brand'); if (navLink) { state.mobileNav = false; $('.app-layout')?.classList.remove('nav-open'); $('.mobile-toggle')?.setAttribute('aria-expanded','false'); $('.mobile-toggle')?.setAttribute('aria-label','Open navigation'); syncMobileNavigation(); }
});
document.addEventListener('change',event => { if (['upload-avatar','upload-team-logo'].includes(event.target.id)) previewAvatarUpload(event.target); });
document.addEventListener('submit',event => { if (event.target.matches('[data-form]')) { event.preventDefault(); submitForm(event.target); } });
document.addEventListener('input',event => { if (event.target.id === 'friend-search') { state.friendSearch = event.target.value; $('#friends-list').innerHTML = friendListContent(); } if (event.target.id === 'player-search') { state.search = event.target.value; let players = boardPlayers(); if (state.leaderboardTab === 'all-time') players.sort((a,b) => Number(b.totalPoints ?? b.points)-Number(a.totalPoints ?? a.points)); const filtered = players.map((player,index) => ({...player,rank:index+1})).filter(player => displayName(player).toLowerCase().includes(state.search.trim().toLowerCase())); $('#leaderboard-body').innerHTML = leaderboardTableRows(filtered); } });
document.addEventListener('error',event => { const img = event.target; if (img instanceof HTMLImageElement && img.parentElement?.matches('.avatar,.team-logo')) { const holder = img.parentElement; holder.textContent = holder.dataset.initial || ''; } },true);
document.addEventListener('keydown',event => {
  if (event.key === 'Escape') { if (state.modal && !state.busy) closeModal(); else if (state.mobileNav) { state.mobileNav = false; render(); $('.mobile-toggle')?.focus(); } }
  if (event.key === 'Tab' && state.modal) { const focusable = [...dialogRoot.querySelectorAll('button:not([disabled]),a,summary,input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex="0"]')]; const first = focusable[0]; const last = focusable.at(-1); if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); } else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); } }
});
window.matchMedia('(max-width:760px)').addEventListener('change',syncMobileNavigation);
window.addEventListener('hashchange',() => { state.mobileNav = false; render(); window.scrollTo({top:0,behavior:'instant'}); if (state.route === 'admin') loadAdmin(); if (state.route === 'clubhouses' && user()) loadClubhouses(); if (state.route === 'friends') { loadParty(); if (user()) loadMyTeams(); } });
render();
await refresh();
if (state.pendingJoin) openModal('invite');
if (state.route === 'admin' && isAdmin()) await loadAdmin();
