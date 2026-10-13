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
      button.textContent = 'Dark';
      toolbar.append(button);
    }
    apply(root.dataset.theme);
  });
})();
