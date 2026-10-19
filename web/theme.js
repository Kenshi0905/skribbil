// Apply the saved palette before the first paint, including in league game rooms.
(() => {
  const key = 'skribbil-theme';
  const root = document.documentElement;
  function apply(value) {
    const dark = value === 'dark';
    root.dataset.theme = dark ? 'dark' : 'light';
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#242528' : '#4b45d4');
    document.querySelectorAll('[data-community-logo]').forEach(image => {
      image.src = dark ? '/assets/skribbil-communities.png' : '/assets/skribbil-communities-light.png';
    });
    document.querySelectorAll('[data-theme-toggle]').forEach(button => {
      button.setAttribute('aria-pressed', String(dark));
      button.title = dark ? 'Switch to the original theme' : 'Switch to dark mode';
    });
  }
  try { apply(localStorage.getItem(key)); } catch { apply('light'); }
  document.addEventListener('click', event => {
    if (!event.target.closest('[data-theme-toggle]')) return;
    const value = root.dataset.theme === 'dark' ? 'light' : 'dark';
    apply(value);
    try { localStorage.setItem(key, value); } catch { /* Still works when storage is unavailable. */ }
  });
  window.addEventListener('storage', event => {
    if (event.key === key || event.key === null) apply(event.newValue);
  });
  document.addEventListener('DOMContentLoaded', () => {
    const toolbar = document.querySelector('body[data-league-mode] #league-toolbar');
    if (toolbar) {
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.themeToggle = '';
      button.className = 'league-theme-toggle';
      button.setAttribute('aria-label', 'Switch theme');
      button.innerHTML = '<svg class="theme-moon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20.8 13a9 9 0 0 1-9.8-9.8A9 9 0 1 0 20.8 13Z"/></svg><svg class="theme-sun" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5"/></svg>';
      toolbar.append(button);
    }
    apply(root.dataset.theme);
  });
})();
