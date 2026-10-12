import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, copyFile, chmod, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve, join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const project = resolve(dirname(fileURLToPath(import.meta.url)), '..');
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'skribbil-secret-guard-'));
  t.after(async () => {
    assert.equal(dirname(resolve(root)), resolve(tmpdir()));
    assert.ok(basename(root).startsWith('skribbil-secret-guard-'));
    await rm(root, { recursive: true, force: true });
  });
  const repo = join(root, 'work'), remote = join(root, 'remote.git');
  await mkdir(repo); await writeFile(join(root, 'gitconfig'), '');
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (key.startsWith('GIT_')) delete env[key];
  Object.assign(env, { GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: join(root, 'gitconfig'), GIT_TERMINAL_PROMPT: '0' });
  const run = (command, args, input) => spawnSync(command, args, { cwd: repo, env, input, encoding: 'utf8', timeout: 30000, maxBuffer: 2 * 1024 * 1024, windowsHide: true });
  const git = (...args) => { const result = run('git', args); assert.equal(result.status, 0, 'fixture Git operation succeeded'); return result.stdout.trim(); };
  git('init', '--bare', remote); git('init', '-b', 'main');
  git('config', 'user.name', 'Synthetic guard fixture'); git('config', 'user.email', 'guard@example.invalid');
  git('config', 'core.autocrlf', 'false'); git('config', 'commit.gpgsign', 'false'); git('config', 'core.hooksPath', '.githooks');
  await mkdir(join(repo, 'scripts')); await mkdir(join(repo, '.githooks'));
  await copyFile(join(project, 'scripts/check-secrets.mjs'), join(repo, 'scripts/check-secrets.mjs'));
  await copyFile(join(project, '.githooks/pre-push'), join(repo, '.githooks/pre-push'));
  await chmod(join(repo, '.githooks/pre-push'), 0o755);
  await writeFile(join(repo, 'README.md'), 'Isolated synthetic fixture.\n');
  git('add', '.'); git('commit', '-m', 'Initial safe fixture'); git('remote', 'add', 'origin', remote);
  const first = run('git', ['push', 'origin', 'main']);
  assert.equal(first.status, 0, 'safe baseline passes the actual pre-push hook');
  assert.ok(/Secret guard passed/.test(first.stdout + first.stderr), 'safe baseline actually ran the guard');
  return { root, repo, remote, run, git, baseline: git('rev-parse', 'HEAD'), guard: (...args) => run(process.execPath, ['scripts/check-secrets.mjs', ...args]) };
}

test('actual pre-push blocks a generated password removed from the final outgoing commit', async t => {
  const f = await fixture(t), generated = randomBytes(24).toString('hex');
  await writeFile(join(f.repo, 'settings.json'), JSON.stringify({ password: generated }));
  f.git('add', 'settings.json'); f.git('commit', '-m', 'Add temporary settings');
  const sensitiveCommit = f.git('rev-parse', 'HEAD');
  await rm(join(f.repo, 'settings.json'));
  f.git('add', '-u'); f.git('commit', '-m', 'Remove temporary settings');
  assert.equal(f.guard('--committed').status, 0, 'clean final tree alone misses this historical exposure');
  f.git('replace', sensitiveCommit, f.baseline); // Local replacement refs must not hide outgoing objects.
  const push = f.run('git', ['push', '--force', 'origin', 'main']); // Isolated bare fixture only.
  assert.notEqual(push.status, 0);
  const output = push.stdout + push.stderr;
  assert.ok(/settings\.json.*blocked by literal password check/.test(output), 'historical credential is blocked by the hook');
  assert.ok(!output.includes(generated), 'the blocked value never appears in output');
  assert.equal(f.git('--git-dir=' + f.remote, 'rev-parse', 'refs/heads/main'), f.baseline, 'remote branch did not advance');
});

test('actual pre-push checks every updated ref, including a new branch outside HEAD', async t => {
  const f = await fixture(t);
  f.git('checkout', '-b', 'hidden');
  await mkdir(join(f.repo, '.tmp')); await writeFile(join(f.repo, '.tmp/cache.bin'), randomBytes(16));
  f.git('add', '.tmp/cache.bin'); f.git('commit', '-m', 'Temporary runtime artifact');
  f.git('checkout', 'main'); await writeFile(join(f.repo, 'README.md'), 'A harmless main branch update.\n');
  f.git('add', 'README.md'); f.git('commit', '-m', 'Safe main update');
  const push = f.run('git', ['push', 'origin', 'main', 'hidden']);
  assert.notEqual(push.status, 0); assert.ok(/\.tmp\/cache\.bin.*private runtime path/.test(push.stdout + push.stderr), 'a non-HEAD outgoing branch is scanned');
  assert.equal(f.git('--git-dir=' + f.remote, 'rev-parse', 'refs/heads/main'), f.baseline);
});

test('staged scanning reads the index, working scanning reads edits, and private paths remain blocked', async t => {
  const f = await fixture(t), generated = randomBytes(24).toString('hex');
  await writeFile(join(f.repo, 'notes.txt'), JSON.stringify({ password: generated })); f.git('add', 'notes.txt');
  assert.notEqual(f.guard('--staged').status, 0); assert.notEqual(f.guard().status, 0);
  await writeFile(join(f.repo, 'notes.txt'), 'No account credentials here.');
  const staged = f.guard('--staged'); assert.notEqual(staged.status, 0); assert.ok(!(staged.stdout + staged.stderr).includes(generated));
  assert.equal(f.guard().status, 0); f.git('add', 'notes.txt'); assert.equal(f.guard('--staged').status, 0);
  for (const file of ['.data/a.json', '.tools/a.bin', '.deploy/a.json', '.tmp/a.txt', '.env.local', 'keys/id_ed25519', 'keys/a.pem']) {
    await mkdir(dirname(join(f.repo, file)), { recursive: true }); await writeFile(join(f.repo, file), 'Synthetic fixture only.');
  }
  f.git('add', '.'); const blocked = f.guard('--staged'); assert.notEqual(blocked.status, 0);
  for (const file of ['.data/a.json', '.tools/a.bin', '.deploy/a.json', '.tmp/a.txt', '.env.local', 'keys/id_ed25519', 'keys/a.pem']) assert.ok(blocked.stderr.includes(file));
});

test('pre-push accepts deletions and rejects malformed or oversized hook input without echoing it', async t => {
  const f = await fixture(t), zero = '0'.repeat(40);
  const run = input => f.run(process.execPath, ['scripts/check-secrets.mjs', '--pre-push'], input);
  assert.equal(run('(delete) ' + zero + ' refs/heads/main ' + f.baseline + '\n').status, 0);
  const generated = randomBytes(24).toString('hex');
  const malformed = run(generated + '\n'); assert.notEqual(malformed.status, 0);
  assert.ok(!(malformed.stdout + malformed.stderr).includes(generated));
  assert.notEqual(run('x'.repeat(70 * 1024)).status, 0);
});
