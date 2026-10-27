import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PATHS = [
  'skills/aigora-feedback/SKILL.md',
  'skills/aigora-feedback/references/bug-form.md',
  'skills/aigora-feedback/references/feature-form.md',
  'skills/aigora-feedback/references/other-feedback-form.md',
  'skills/aigora-mcp/SKILL.md',
  'skills/aigora-mcp/references/install.md',
  'skills/aigora-register/SKILL.md',
  'skills/aigora-register/references/registration-fields.md',
];
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const git = (cwd, args, input) => execFileSync('git', args, {
  cwd, input, encoding: 'utf8',
  env: {
    ...process.env,
    GIT_AUTHOR_NAME: 'Plugin fixture',
    GIT_AUTHOR_EMAIL: 'fixture@example.invalid',
    GIT_COMMITTER_NAME: 'Plugin fixture',
    GIT_COMMITTER_EMAIL: 'fixture@example.invalid',
  },
  stdio: ['pipe', 'pipe', 'pipe'],
}).trim();

async function generator() {
  const url = new URL('../scripts/sync-plugin-skills.mjs', import.meta.url);
  assert.ok(existsSync(url), 'snapshot generator is not implemented');
  return import(url.href);
}

async function fixture(t, edit = async () => {}) {
  const root = await mkdtemp(join(tmpdir(), 'aigora-plugin-check-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const sourceRepo = join(root, 'upstream');
  const packageRoot = join(root, 'package');
  await mkdir(sourceRepo);
  await mkdir(packageRoot);
  git(sourceRepo, ['init', '--quiet']);
  for (const path of PATHS) {
    await mkdir(dirname(join(sourceRepo, path)), { recursive: true });
    await writeFile(join(sourceRepo, path), path.endsWith('/aigora-mcp/SKILL.md')
      ? '# MCP\n[Install](references/install.md)\n'
      : '# ' + path + '\n');
  }
  await edit(sourceRepo);
  git(sourceRepo, ['add', '--', 'skills']);
  const tree = git(sourceRepo, ['write-tree']);
  const approvedSourceCommit = git(sourceRepo, ['commit-tree', tree, '-m', 'fixture']);
  const approvedFileHashes = {};
  for (const path of PATHS) {
    try {
      const bytes = execFileSync('git', ['cat-file', 'blob', approvedSourceCommit + ':' + path], {
        cwd: sourceRepo, stdio: ['pipe', 'pipe', 'pipe'],
      });
      approvedFileHashes[path] = hash(bytes);
    } catch { /* missing-file fixtures still pass the expected roster */ }
  }
  return { root, sourceRepo, packageRoot, approvedSourceCommit, approvedFileHashes };
}

async function snapshot(root) {
  const out = {};
  async function walk(dir, prefix = '') {
    for (const entry of await readdir(dir, { withFileTypes: true }).catch((error) => {
      if (error.code === 'ENOENT') return [];
      throw error;
    })) {
      const path = prefix + entry.name;
      if (entry.isDirectory()) await walk(join(dir, entry.name), path + '/');
      else if (entry.isSymbolicLink()) out[path] = 'SYMLINK';
      else out[path] = hash(await readFile(join(dir, entry.name)));
    }
  }
  await walk(root);
  return out;
}

test('snapshot_exact_commit_and_roster', async (t) => {
  const { syncPluginSkills } = await generator();
  const f = await fixture(t);
  // A dirty worktree is not the selected committed source.
  await writeFile(join(f.sourceRepo, PATHS[0]), 'uncommitted content');
  const result = await syncPluginSkills({ ...f, mode: 'write' });
  assert.equal(result.sourceCommit, f.approvedSourceCommit);
  assert.deepEqual(result.fileHashes, f.approvedFileHashes);
  assert.equal(result.changed, true);
  const target = join(f.packageRoot, 'plugins/aigora');
  const manifest = JSON.parse(await readFile(join(target, 'skills-source.json'), 'utf8'));
  assert.equal(manifest.repository, 'https://github.com/trionlabs/aigora-skills');
  assert.equal(manifest.commit, f.approvedSourceCommit);
  assert.deepEqual(manifest.files.map((file) => file.path), PATHS);
  assert.deepEqual(Object.keys(await snapshot(target)).sort(), [...PATHS, 'skills-source.json'].sort());
  for (const path of PATHS) {
    assert.equal(hash(await readFile(join(target, path))), f.approvedFileHashes[path]);
  }
  assert.equal((await syncPluginSkills({ ...f, mode: 'write' })).changed, false);
});

test('snapshot_bad_pin_and_hash_preserve_output', async (t) => {
  const { syncPluginSkills } = await generator();
  const f = await fixture(t);
  await syncPluginSkills({ ...f, mode: 'write' });
  const before = await snapshot(f.packageRoot);
  for (const approvedSourceCommit of ['main', '0'.repeat(40), '--help']) {
    await assert.rejects(syncPluginSkills({ ...f, approvedSourceCommit, mode: 'write' }), /commit|source/i);
  }
  await assert.rejects(syncPluginSkills({
    ...f, approvedFileHashes: { ...f.approvedFileHashes, [PATHS[0]]: '0'.repeat(64) }, mode: 'write',
  }), /hash|approved/i);
  assert.deepEqual(await snapshot(f.packageRoot), before);
});

test('snapshot_extra_missing_symlink_and_escape_rejected', async (t) => {
  const { syncPluginSkills } = await generator();
  const variants = [
    async (repo) => writeFile(join(repo, 'skills/aigora-mcp/extra.md'), 'extra'),
    async (repo) => rm(join(repo, PATHS[0])),
    async (repo) => {
      await rm(join(repo, PATHS[0]));
      await symlink('/etc/hosts', join(repo, PATHS[0]));
    },
  ];
  for (const edit of variants) {
    const f = await fixture(t, edit);
    // Missing-file inputs cannot shrink the independently supplied approved roster.
    f.approvedFileHashes = Object.fromEntries(PATHS.map((p) => [p, f.approvedFileHashes[p] ?? '0'.repeat(64)]));
    await assert.rejects(syncPluginSkills({ ...f, mode: 'write' }), /roster|regular|source|symlink/i);
    assert.deepEqual(await snapshot(f.packageRoot), {});
  }
  const f = await fixture(t);
  await assert.rejects(syncPluginSkills({
    ...f, approvedFileHashes: { ...f.approvedFileHashes, '../outside.md': '0'.repeat(64) }, mode: 'write',
  }), /roster|path/i);
  const external = join(f.root, 'external');
  await mkdir(external);
  await symlink(external, join(f.packageRoot, 'plugins'));
  await assert.rejects(syncPluginSkills({ ...f, mode: 'write' }), /symlink|directory/i);
  assert.deepEqual(await snapshot(external), {});
});

test('snapshot_broken_reference_rejected', async (t) => {
  const { syncPluginSkills } = await generator();
  for (const link of ['references/missing.md', '../../../outside.md', '%2e%2e/%2e%2e/outside.md']) {
    const f = await fixture(t, (repo) => writeFile(join(repo, 'skills/aigora-mcp/SKILL.md'), '[bad](' + link + ')\n'));
    await assert.rejects(syncPluginSkills({ ...f, mode: 'write' }), /reference|link/i);
    assert.deepEqual(await snapshot(f.packageRoot), {});
  }
});

test('snapshot_check_is_nonmutating_and_rejects_unrelated_output', async (t) => {
  const { syncPluginSkills } = await generator();
  const f = await fixture(t);
  await assert.rejects(syncPluginSkills({ ...f, mode: 'check' }), /snapshot|missing|drift/i);
  assert.deepEqual(await snapshot(f.packageRoot), {});
  await syncPluginSkills({ ...f, mode: 'write' });
  const before = await snapshot(f.packageRoot);
  assert.equal((await syncPluginSkills({ ...f, mode: 'check' })).changed, false);
  assert.deepEqual(await snapshot(f.packageRoot), before);
  await writeFile(join(f.packageRoot, 'plugins/aigora/skills/unrelated.md'), 'keep');
  const withExtra = await snapshot(f.packageRoot);
  await assert.rejects(syncPluginSkills({ ...f, mode: 'write' }), /unexpected|roster/i);
  assert.deepEqual(await snapshot(f.packageRoot), withExtra);
});
