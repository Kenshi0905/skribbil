// Presentation consumes the authoritative roster; it never sends game commands.
export function createGamePresentation({ avatar, doc = document }) {
  const byId = id => doc.getElementById(id);
  // The original menu trigger stays available in the round bar or phone header.
  const compactHeader = doc.defaultView.matchMedia('(max-width:900px)');
  const placeMenu = () => {
    const menu = byId('menu-button-container');
    if (compactHeader.matches) byId('league-toolbar').insertBefore(menu, byId('game-profile-button'));
    else byId('lobby-header').append(menu);
  };
  compactHeader.addEventListener('change', placeMenu);
  placeMenu();
  const settings = byId('lobbysettings-dialog');
  const steppers = [];
  for (const input of settings.querySelectorAll('input[type="number"]')) {
    const wrapper = doc.createElement('div'); wrapper.className = 'settings-stepper';
    input.parentElement.insertBefore(wrapper,input);
    const minus = doc.createElement('button'), plus = doc.createElement('button');
    minus.type = plus.type = 'button'; minus.textContent = '−'; plus.textContent = '+';
    const label = settings.querySelector(`label[for="${input.id}"]`)?.textContent || input.name;
    minus.setAttribute('aria-label',`Decrease ${label}`); plus.setAttribute('aria-label',`Increase ${label}`);
    wrapper.append(minus,input,plus);
    const refresh = () => { minus.disabled = Number(input.value) <= Number(input.min); plus.disabled = Number(input.value) >= Number(input.max); };
    for (const [button,direction] of [[minus,-1],[plus,1]]) button.addEventListener('click',() => {
      if (input.disabled || input.readOnly) return;
      if (direction > 0) input.stepUp(input.name === 'drawing_time' ? 10 : 1);
      else input.stepDown(input.name === 'drawing_time' ? 10 : 1);
      input.dispatchEvent(new Event('input',{bubbles:true}));
      input.dispatchEvent(new Event('change',{bubbles:true}));
      refresh();
    });
    input.addEventListener('input',refresh); steppers.push(refresh); refresh();
  }
  new MutationObserver(() => steppers.forEach(refresh=>refresh())).observe(settings,{attributes:true,attributeFilter:['style']});
  const tabs = [byId('game-chat-tab'), byId('game-players-tab')];
  function select(index, focus = false) {
    if(index) byId('message-input').blur();
    doc.body.dataset.socialPanel = index ? 'players' : 'chat';
    tabs.forEach((tab, i) => {
      tab.setAttribute('aria-selected', String(i === index));
      tab.tabIndex = i === index ? 0 : -1;
    });
    if (focus) tabs[index].focus();
  }
  tabs.forEach((tab, index) => {
    tab.addEventListener('click', () => select(index));
    tab.addEventListener('keydown', event => {
      if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
        event.preventDefault();
        select(event.key === 'Home' ? 0 : event.key === 'End' ? 1 : 1 - index, true);
      }
    });
  });
  select(0);
  const gallery = byId('game-gallery-tab');
  if (byId('gallery-voting') && doc.body.dataset.leagueSpectator !== 'true') {
    gallery.hidden = false;
    gallery.addEventListener('click', () => {
      byId('message-input').blur();
      const history = byId('gallery-voting').querySelector('details');
      if (history) { history.open = true; history.querySelector('button')?.focus(); }
    });
  }
  byId('profile-game-menu')?.addEventListener('click', () => {
    byId('game-profile-menu').hidePopover();
    byId('menu').showPopover();
  });
  byId('profile-leave-room')?.addEventListener('click', () => doc.querySelector('.league-home-link')?.click());
  const progress = doc.createElement('span');
  progress.className = 'game-timer-track';
  progress.setAttribute('aria-hidden', 'true');
  const fill = doc.createElement('span'); progress.append(fill);
  byId('time-left').append(progress);
  const caption = doc.createElement('small');
  caption.id = 'game-word-caption'; byId('lobby-header-center-element').append(caption);
  return {
    update({ players = [], ownID, ownerID, gameState, maxPlayers }) {
      const self = players.find(p => p.id === ownID);
      const drawer = players.find(p => p.connected && p.state === 'drawing');
      const count = players.filter(p => p.connected && p.state !== 'spectating').length;
      byId('game-player-count').textContent = `(${count})`;
      byId('player-container').dataset.count = `${count}${maxPlayers ? ` / ${maxPlayers}` : ''}`;
      doc.body.dataset.gameState = gameState;
      byId('canvas-drawer-label').textContent = drawer ? drawer.id === ownID ? 'Your canvas' : `${drawer.name} is drawing` : 'Drawing board';
      caption.textContent = gameState === 'ongoing' ? drawer?.id === ownID ? 'Your word · private' : self?.state === 'spectating' ? 'Spectating' : 'Guess the word' : '';
      for (const row of byId('player-container').children) {
        const id = row.querySelector('.playername')?.id?.slice('playername-'.length);
        row.classList.toggle('player-is-self', id === ownID);
        row.classList.toggle('player-is-host', id === ownerID && gameState === 'unstarted');
      }
      if (self && byId('game-profile-avatar')) {
        byId('game-profile-avatar').replaceChildren(avatar(self));
        byId('game-profile-name').textContent = self.name;
      }
    },
    timer(seconds, total, active) {
      fill.style.width = `${active ? Math.max(0, Math.min(100, seconds / Math.max(1, total) * 100)) : 0}%`;
      byId('time-left').classList.toggle('timer-urgent', active && seconds <= 10);
    },
  };
}
