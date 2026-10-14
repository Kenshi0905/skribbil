// Uses the owner's existing credential helper; never prints or stores a token.
import { spawnSync } from 'node:child_process';
const credential = spawnSync('git', ['credential', 'fill'], {
  input: 'protocol=https\nhost=github.com\n\n', encoding: 'utf8',
  env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
});
const fields = Object.fromEntries((credential.stdout || '').trim().split('\n').map(line => {
  const split = line.indexOf('='); return [line.slice(0, split), line.slice(split + 1)];
}));
if (!fields.password) { console.error('No stored GitHub credential. Authenticate GitHub in Git Credential Manager first.'); process.exit(2); }
async function request(path, options = {}) {
  const response = await fetch(`https://api.github.com${path}`, {
    ...options, headers: { Authorization: `Bearer ${fields.password}`, 'User-Agent': 'Skribbil-repository-setup',
      Accept: 'application/vnd.github+json', 'Content-Type': 'application/json', ...options.headers },
  });
  const body = await response.json();
  return { response, body };
}
const account = await request('/user');
if (!account.response.ok) { console.error(`GitHub authentication failed (${account.response.status})`); process.exit(2); }
console.log(`Authenticated GitHub account: ${account.body.login}`);
if (!process.argv.includes('--create')) process.exit(0);
const name = 'skribbil';
const existing = await request(`/repos/${account.body.login}/${name}`);
if (existing.response.ok) {
  console.log(`Repository already exists; no changes made: ${existing.body.html_url}`);
  process.exit(3);
}
if (existing.response.status !== 404) throw new Error(`Cannot check repository: ${existing.response.status}`);
const result = await request('/user/repos', { method: 'POST', body: JSON.stringify({
  name, description: 'Skribbil — a cross-game community league powered by scribble.rs',
  private: false, auto_init: false, has_issues: true,
}) });
if (!result.response.ok) throw new Error(`Repository creation failed (${result.response.status}): ${result.body.message}`);
console.log(`Created ${result.body.html_url}`);
const remote = spawnSync('git', ['remote', 'add', 'origin', result.body.clone_url], { encoding: 'utf8' });
if (remote.status !== 0) throw new Error('Repository created, but remote could not be added. Inspect git remote configuration.');
