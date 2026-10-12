import { execFileSync } from 'node:child_process';
import { lstatSync, openSync, closeSync, readSync, readlinkSync } from 'node:fs';

// Never print Git output, source lines or suspected secret values. Limits fail
// closed rather than silently skipping a large object or truncated history.
const MAX_OUTPUT = 8 * 1024 * 1024, MAX_BLOB = 16 * 1024 * 1024;
const MAX_COMMITS = 20000, MAX_BLOBS = 100000, MAX_FAILURES = 100;
const modes = ['--staged', '--committed', '--pre-push'].filter(flag => process.argv.includes(flag));
const mode = modes[0] || 'working';
const oidPattern = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i;
const zero = oid => /^0+$/.test(oid);
const git = (args, options = {}) => {
  try { return execFileSync('git', ['--no-replace-objects', ...args], { maxBuffer: MAX_OUTPUT, timeout: 30000, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], ...options }); }
  catch { throw Error('Git read failed or exceeded the guard limits.'); }
};
const hasCommit = oid => {
  try { git(['cat-file', '-e', oid + '^{commit}']); return true; } catch { return false; }
};
const rules = [
  ['private key', /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/],
  ['GitHub token', /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})\b/],
  ['cloud access key', /\bAKIA[A-Z0-9]{16}\b/],
  ['embedded database credential', /postgres(?:ql)?:\/\/[^\s:'"/]+:(?!YOUR_|REPLACE_|<)[^\s@'"/]{6,}@/i],
  ['literal password', /(?:\b(?:password|passwd|pass|currentPassword|newPassword)\s*[:=]|["'](?:password|passwd|pass|currentPassword|newPassword)["']\s*:)\s*(['"])(?!YOUR_|REPLACE_|<|\$)[^'"\r\n]{8,}\1/i],
];
const failures = [], blobs = new Map();
let failureCount = 0, filesChecked = 0, commitsChecked = 0;
const block = (file, rule, commit = '') => {
  failureCount++;
  if (failures.length < MAX_FAILURES) failures.push({ file, rule, commit: commit.slice(0, 12) });
};
const checkPath = (file, commit) => {
  file = file.replaceAll("\\", "/");
  let blocked = false;
  if (/(^|\/)(?:\.data|\.tools|\.deploy|\.tmp|node_modules|output|\.git|\.ssh|\.aws|\.azure|\.kube)(?:\/|$)/i.test(file)
      || (/(^|\/)\.env(?:\.|$)/i.test(file) && !/(^|\/)\.env\.example$/i.test(file))) {
    block(file, 'private runtime path', commit); blocked = true;
  }
  if (/(?:\.(?:pem|p12|pfx|key|sqlite|sqlite3|db)|(?:^|\/)(?:credentials(?:\.json)?|id_(?:rsa|dsa|ecdsa|ed25519)))$/i.test(file)) {
    block(file, 'credential or database file', commit); blocked = true;
  }
  return blocked;
};
const inspect = (file, content, commit) => {
  const found = rules.filter(([, pattern]) => pattern.test(content)).map(([rule]) => rule);
  for (const rule of found) block(file, rule, commit);
  return found;
};
const object = (oid, type = 'blob') => {
  if (!oidPattern.test(oid)) throw Error('Invalid Git object identifier.');
  const size = Number(git(['cat-file', '-s', oid]).trim());
  if (!Number.isSafeInteger(size) || size < 0 || size > MAX_BLOB) throw Error('A Git object exceeds the guard size limit.');
  return git(['cat-file', type, oid], { maxBuffer: MAX_BLOB + 1024 });
};
const inspectBlob = (file, oid, commit) => {
  filesChecked++;
  if (checkPath(file, commit)) return;
  if (blobs.has(oid)) { for (const rule of blobs.get(oid)) block(file, rule, commit); return; }
  if (blobs.size >= MAX_BLOBS) throw Error('Too many unique objects for one guard run.');
  blobs.set(oid, inspect(file, object(oid), commit));
};
const tree = commit => {
  const entries = git(['ls-tree', '-r', '-z', commit]).split('\0').filter(Boolean);
  for (const entry of entries) {
    const split = entry.indexOf('\t');
    if (split < 0) throw Error('Invalid Git tree entry.');
    const [permissions, type, oid] = entry.slice(0, split).split(' '), file = entry.slice(split + 1);
    if (type === 'blob') inspectBlob(file, oid, commit);
    else if (permissions === '160000') checkPath(file, commit); // Submodule objects are not part of this push.
    else throw Error('Unsupported Git tree object.');
  }
};
const readHookInput = () => {
  const chunks = [], buffer = Buffer.alloc(4096); let total = 0;
  for (;;) {
    const size = readSync(0, buffer, 0, buffer.length, null); if (!size) break;
    total += size; if (total > 64 * 1024) throw Error('Too many push ref updates.');
    chunks.push(Buffer.from(buffer.subarray(0, size)));
  }
  return Buffer.concat(chunks).toString('utf8');
};
const outgoing = () => {
  const tips = new Set(), bases = new Set(), tags = new Set();
  for (const line of readHookInput().split(/\r?\n/).filter(Boolean)) {
    const fields = line.trim().split(/\s+/);
    if (fields.length !== 4 || !oidPattern.test(fields[1]) || !oidPattern.test(fields[3])) throw Error('Invalid pre-push ref update.');
    const [, localOID, , remoteOID] = fields;
    if (zero(localOID)) continue; // A deletion sends no local objects.
    let tip = localOID;
    for (let depth = 0; ; depth++) {
      if (depth > 32) throw Error('Too many nested tags.');
      const type = git(['cat-file', '-t', tip]).trim();
      if (type === 'commit') { tips.add(tip); break; }
      if (type !== 'tag') throw Error('Pushes of non-commit objects require separate review.');
      const content = object(tip, 'tag');
      if (!tags.has(tip)) { inspect('<annotated tag>', content, tip); tags.add(tip); }
      const next = /^object ([a-f0-9]{40}|[a-f0-9]{64})$/m.exec(content);
      if (!next) throw Error('Invalid annotated tag.');
      tip = next[1];
    }
    // Only advertised remote tips are authoritative. Remote-tracking refs can
    // be stale or locally forged. Missing bases scan extra history safely.
    if (!zero(remoteOID) && hasCommit(remoteOID)) bases.add(remoteOID);
  }
  if (!tips.size) return [];
  const input = [...tips, ...[...bases].map(oid => '^' + oid)].join('\n') + '\n';
  const commits = git(['rev-list', '--max-count=' + (MAX_COMMITS + 1), '--stdin'], { input }).trim().split(/\r?\n/).filter(Boolean);
  if (commits.length > MAX_COMMITS) throw Error('Outgoing history exceeds the guard commit limit.');
  return commits;
};
const workingContent = file => {
  let stat; try { stat = lstatSync(file); } catch (error) { if (error.code === 'ENOENT') return null; throw Error('Cannot inspect a tracked working file.'); }
  if (stat.isSymbolicLink()) return readlinkSync(file);
  if (!stat.isFile()) return null;
  if (stat.size > MAX_BLOB) throw Error('A working file exceeds the guard size limit.');
  const fd = openSync(file, 'r'), chunks = [], buffer = Buffer.alloc(64 * 1024); let total = 0;
  try {
    for (;;) {
      const size = readSync(fd, buffer, 0, buffer.length, null); if (!size) break;
      total += size; if (total > MAX_BLOB) throw Error('A working file exceeds the guard size limit.');
      chunks.push(Buffer.from(buffer.subarray(0, size)));
    }
  } finally { closeSync(fd); }
  return Buffer.concat(chunks).toString('utf8');
};
try {
  if (modes.length > 1) throw Error('Choose only one guard mode.');
  if (mode === '--pre-push') {
    const commits = outgoing();
    for (const commit of commits) {
      if (!oidPattern.test(commit)) throw Error('Invalid outgoing commit identifier.');
      inspect('<commit message>', object(commit, 'commit'), commit);
      tree(commit); commitsChecked++;
    }
  } else if (mode === '--committed') tree(git(['rev-parse', 'HEAD']).trim());
  else {
    const changed = mode === '--staged' ? new Set(git(['diff', '--cached', '--name-only', '--diff-filter=ACMR', '-z']).split('\0')) : null;
    for (const entry of git(['ls-files', '--stage', '-z']).split('\0').filter(Boolean)) {
      const split = entry.indexOf('\t'), file = entry.slice(split + 1);
      const [permissions, oid, stage] = entry.slice(0, split).split(' ');
      if (changed && !changed.has(file)) continue;
      if (stage !== '0') throw Error('Unmerged index entries require resolution.');
      if (permissions === '160000') { checkPath(file); continue; }
      if (mode === '--staged') inspectBlob(file, oid);
      else { filesChecked++; if (!checkPath(file)) { const content = workingContent(file); if (content !== null) inspect(file, content); } }
    }
  }
  if (failureCount) {
    for (const { file, rule, commit } of failures) console.error(JSON.stringify(file) + (commit ? ' at ' + commit : '') + ': blocked by ' + rule + ' check');
    if (failureCount > failures.length) console.error('Additional blocked matches omitted.');
    process.exitCode = 1;
  } else console.log('Secret guard passed (' + filesChecked + ' files' + (mode === '--pre-push' ? ', ' + commitsChecked + ' outgoing commits' : '') + ').');
} catch {
  // Child-process errors can contain captured secret material: do not print them.
  console.error('Secret guard could not complete safely; push/commit blocked. Check Git input, object availability and guard size limits.');
  process.exitCode = 1;
}
