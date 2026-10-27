import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstat, mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join, posix, resolve } from 'node:path';
import { parseArgs, promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

export const UPSTREAM_REPOSITORY = 'https://github.com/trionlabs/aigora-skills';
export const SKILL_PATHS = [
  'skills/aigora-feedback/SKILL.md',
  'skills/aigora-feedback/references/bug-form.md',
  'skills/aigora-feedback/references/feature-form.md',
  'skills/aigora-feedback/references/other-feedback-form.md',
  'skills/aigora-mcp/SKILL.md',
  'skills/aigora-mcp/references/install.md',
  'skills/aigora-register/SKILL.md',
  'skills/aigora-register/references/registration-fields.md',
];
const exec = promisify(execFile);
export const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

export function parseJson(bytes) {
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch { throw new Error('invalid JSON manifest or receipt'); }
}


export async function sourceGit(repo, args) {
  try {
    const result = await exec('git', ['--no-replace-objects', '-C', repo, ...args], {
      encoding: 'buffer', maxBuffer: 1_048_576,
    });
    return result.stdout;
  } catch {
    throw new Error('source commit or Git object unavailable');
  }
}

export function verifyLocalReferences(files, paths = [...files.keys()]) {
  for (const path of paths) {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(files.get(path));
    for (const match of text.matchAll(/\]\((?:<([^>]+)>|([^\s)]+))(?:\s+"[^"]*")?\)/g)) {
      const href = match[1] ?? match[2];
      if (/^(https?:|mailto:|ipfs:|#)/i.test(href)) continue;
      let local;
      try { local = decodeURIComponent(href.split(/[?#]/)[0]); }
      catch { throw new Error('invalid reference in ' + path); }
      assert(local && !local.startsWith('/') && !/[:\\\0]/.test(local), 'unsafe reference in ' + path);
      const target = posix.normalize(posix.join(posix.dirname(path), local));
      assert(!target.startsWith('../') && files.has(target), 'missing or escaped reference in ' + path);
    }
  }
}

export async function readApprovedSkills({ sourceRepo, approvedSourceCommit, approvedFileHashes }) {
  assert(typeof sourceRepo === 'string' && sourceRepo, 'source repository required');
  assert(/^[a-f0-9]{40}$/.test(approvedSourceCommit ?? ''), 'full source commit required');
  assert(approvedFileHashes && typeof approvedFileHashes === 'object' && !Array.isArray(approvedFileHashes), 'approved hash roster required');
  assert.deepEqual(Object.keys(approvedFileHashes).sort(), SKILL_PATHS, 'approved path roster differs');
  for (const path of SKILL_PATHS) assert(/^[a-f0-9]{64}$/.test(approvedFileHashes[path]), 'invalid approved hash');
  const type = (await sourceGit(sourceRepo, ['cat-file', '-t', approvedSourceCommit])).toString().trim();
  assert.equal(type, 'commit', 'source commit required');
  const tree = (await sourceGit(sourceRepo, [
    'ls-tree', '-r', '-z', approvedSourceCommit, '--',
    'skills/aigora-feedback', 'skills/aigora-mcp', 'skills/aigora-register',
  ])).toString('utf8').split('\0').filter(Boolean).map((line) => {
    const tab = line.indexOf('\t');
    return { mode: line.slice(0, tab).split(' ')[0], path: line.slice(tab + 1) };
  });
  assert.deepEqual(tree.map((entry) => entry.path).sort(), SKILL_PATHS, 'source file roster differs');
  assert(tree.every((entry) => entry.mode === '100644'), 'source must contain only regular non-executable files, no symlink');
  const files = new Map();
  const fileHashes = {};
  for (const path of SKILL_PATHS) {
    const bytes = await sourceGit(sourceRepo, ['cat-file', 'blob', approvedSourceCommit + ':' + path]);
    fileHashes[path] = sha256(bytes);
    assert.equal(fileHashes[path], approvedFileHashes[path], 'approved source hash mismatch: ' + path);
    files.set(path, bytes);
  }
  verifyLocalReferences(files);
  const manifest = {
    schemaVersion: 1, repository: UPSTREAM_REPOSITORY, commit: approvedSourceCommit,
    files: SKILL_PATHS.map((path) => ({ path, sha256: fileHashes[path] })),
  };
  return { files, fileHashes, manifest, sourceCommit: approvedSourceCommit };
}

async function optionalStat(path) {
  try { return await lstat(path); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

export async function readRegularTree(root) {
  const files = new Map();
  async function walk(dir, prefix = '') {
    const stat = await optionalStat(dir);
    if (!stat) return;
    assert(stat.isDirectory() && !stat.isSymbolicLink(), 'directory or symlink boundary invalid');
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const name = prefix + entry.name;
      const path = join(dir, entry.name);
      if (entry.isDirectory()) await walk(path, name + '/');
      else {
        assert(entry.isFile() && !entry.isSymbolicLink(), 'non-regular output or symlink');
        files.set(name, await readFile(path));
      }
    }
  }
  await walk(root);
  return files;
}

async function checkTarget(packageRoot) {
  for (const suffix of ['', 'plugins', 'plugins/aigora']) {
    const stat = await optionalStat(join(packageRoot, suffix));
    assert(!stat || (stat.isDirectory() && !stat.isSymbolicLink()), 'target directory/symlink boundary invalid');
  }
  const root = join(packageRoot, 'plugins/aigora');
  const existing = await readRegularTree(join(root, 'skills'));
  for (const path of existing.keys()) assert(SKILL_PATHS.includes('skills/' + path), 'unexpected snapshot output file');
  const manifest = await optionalStat(join(root, 'skills-source.json'));
  assert(!manifest || (manifest.isFile() && !manifest.isSymbolicLink()), 'manifest must be a regular file, no symlink');
}

export async function syncPluginSkills(input) {
  assert(input.mode === 'write' || input.mode === 'check', 'mode must be write or check');
  assert(typeof input.packageRoot === 'string' && input.packageRoot, 'package root required');
  const source = await readApprovedSkills(input);
  const files = new Map(source.files);
  files.set('skills-source.json', Buffer.from(JSON.stringify(source.manifest, null, 2) + '\n'));
  const packageRoot = resolve(input.packageRoot);
  await checkTarget(packageRoot);
  const root = join(packageRoot, 'plugins/aigora');
  let changed = false;
  for (const [path, expected] of files) {
    const actual = await readFile(join(root, path)).catch((error) => {
      if (error.code === 'ENOENT') return null;
      throw error;
    });
    if (!actual?.equals(expected)) changed = true;
  }
  if (input.mode === 'check') assert(!changed, 'snapshot drift or missing output');
  else if (changed) {
    await mkdir(root, { recursive: true });
    const stage = await mkdtemp(join(root, '.snapshot-'));
    try {
      for (const [path, bytes] of files) {
        await mkdir(dirname(join(stage, path)), { recursive: true });
        await writeFile(join(stage, path), bytes, { flag: 'wx' });
      }
      for (const path of files.keys()) {
        await mkdir(dirname(join(root, path)), { recursive: true });
        await rename(join(stage, path), join(root, path));
      }
    } finally { await rm(stage, { recursive: true, force: true }); }
  }
  return { sourceCommit: source.sourceCommit, fileHashes: source.fileHashes, changed };
}

if (import.meta.main) {
  try {
    const { values } = parseArgs({ options: {
      'source-repo': { type: 'string' }, 'source-commit': { type: 'string' },
      'approved-files': { type: 'string' }, check: { type: 'boolean', default: false },
    } });
    assert(values['approved-files'], 'approved-files path required');
    const result = await syncPluginSkills({
      sourceRepo: values['source-repo'], approvedSourceCommit: values['source-commit'],
      approvedFileHashes: parseJson(await readFile(values['approved-files'])),
      packageRoot: resolve(dirname(fileURLToPath(import.meta.url)), '..'),
      mode: values.check ? 'check' : 'write',
    });
    process.stdout.write(JSON.stringify(result) + '\n');
  } catch (error) {
    process.stderr.write('snapshot check failed: ' + error.message + '\n');
    process.exitCode = 1;
  }
}
