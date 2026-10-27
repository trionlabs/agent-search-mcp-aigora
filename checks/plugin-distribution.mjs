import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, readdir, realpath, rename, rm, symlink, writeFile } from 'node:fs/promises';
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

const BRIDGE_BASE = '978e66196ce320211eba970a7d48e1a8ffe0ca61';
const NATIVE_PATHS = [
  '.agents/plugins/marketplace.json', '.claude-plugin/marketplace.json',
  'plugins/aigora/plugin.json', 'plugins/aigora/mcp.json',
  'plugins/aigora/.claude-plugin/plugin.json', 'plugins/aigora/.mcp.json',
];

async function verifier() {
  const url = new URL('../scripts/verify-plugin.mjs', import.meta.url);
  assert.ok(existsSync(url), 'plugin verifier is not implemented');
  return import(url.href);
}

async function packageFixture(t) {
  const { syncPluginSkills } = await generator();
  const f = await fixture(t);
  git(f.packageRoot, ['init', '--quiet']);
  git(f.packageRoot, ['fetch', '--quiet', '--no-tags', ROOT, BRIDGE_BASE]);
  git(f.packageRoot, ['read-tree', '--reset', '-u', BRIDGE_BASE]);
  for (const path of NATIVE_PATHS) {
    await mkdir(dirname(join(f.packageRoot, path)), { recursive: true });
    await writeFile(join(f.packageRoot, path), await readFile(join(ROOT, path)));
  }
  for (const path of ['.github/README.md', 'PLUGIN.md']) {
    if (existsSync(join(ROOT, path))) {
      await mkdir(dirname(join(f.packageRoot, path)), { recursive: true });
      await writeFile(join(f.packageRoot, path), await readFile(join(ROOT, path)));
    }
  }
  await writeFile(join(f.sourceRepo, 'plugin.json'), '{"version":"0.1.2"}\n');
  await syncPluginSkills({ ...f, mode: 'write' });
  return { ...f, expectedVersion: '0.2.0', bootstrap: true, previousHomeReleaseReceipt: null };
}

async function changeJson(f, path, mutate) {
  const target = join(f.packageRoot, path);
  const value = JSON.parse(await readFile(target, 'utf8'));
  mutate(value);
  await writeFile(target, JSON.stringify(value, null, 2) + '\n');
}

test('catalogs_confined_to_plugin_root', async (t) => {
  const { verifyPlugin } = await verifier();
  for (const path of NATIVE_PATHS.slice(0, 2)) {
    const f = await packageFixture(t);
    await changeJson(f, path, (x) => {
      if (typeof x.plugins[0].source === 'string') x.plugins[0].source = './';
      else x.plugins[0].source.path = '../other';
    });
    await assert.rejects(verifyPlugin(f), /catalog|source|manifest/i);
  }
});

test('payload_matches_upstream_and_complete_roster', async (t) => {
  const { verifyPlugin } = await verifier();
  for (const edit of [
    async (f) => writeFile(join(f.packageRoot, 'plugins/aigora/' + PATHS[0]), 'drift'),
    async (f) => rm(join(f.packageRoot, 'plugins/aigora/' + PATHS[0])),
    async (f) => writeFile(join(f.packageRoot, 'plugins/aigora/extra.json'), '{}'),
    async (f) => changeJson(f, 'plugins/aigora/skills-source.json', (x) => { x.commit = 'f'.repeat(40); }),
    async (f) => {
      await rm(join(f.packageRoot, 'plugins/aigora/mcp.json'));
      await symlink('/etc/hosts', join(f.packageRoot, 'plugins/aigora/mcp.json'));
    },
  ]) {
    const f = await packageFixture(t);
    await edit(f);
    await assert.rejects(verifyPlugin(f), /payload|roster|source|manifest|hash|regular|symlink/i);
  }
});

test('policies_and_https_transports_unchanged', async (t) => {
  const { verifyPlugin } = await verifier();
  const mutations = [
    ['.agents/plugins/marketplace.json', (x) => { x.plugins[0].policy.installation = 'INSTALLED_BY_DEFAULT'; }],
    ['.agents/plugins/marketplace.json', (x) => { x.plugins[0].policy.authentication = 'NONE'; }],
    ['plugins/aigora/mcp.json', (x) => { x.mcpServers.aigora.url = 'http://localhost:1234/mcp'; }],
    ['plugins/aigora/mcp.json', (x) => { x.mcpServers.aigora.command = 'npx'; }],
    ['plugins/aigora/.mcp.json', (x) => { x.mcpServers.aigora.headers = { Authorization: 'test-not-a-real-key' }; }],
    ['plugins/aigora/.claude-plugin/plugin.json', (x) => { x.hooks = {}; }],
    ['plugins/aigora/.mcp.json', (x) => { x.mcpServers.other = { type: 'http', url: 'https://other.invalid' }; }],
  ];
  for (const [path, mutate] of mutations) {
    const f = await packageFixture(t);
    await changeJson(f, path, mutate);
    await assert.rejects(verifyPlugin(f), /policy|manifest|server|endpoint|transport|permission/i);
  }
});

test('both_manifests_equal_within_home', async (t) => {
  const { verifyPlugin } = await verifier();
  const f = await packageFixture(t);
  const result = await verifyPlugin(f);
  assert.equal(result.version, '0.2.0'); // Legacy's independent line is 0.1.2.
  assert.equal(result.distributionRepository, 'https://github.com/trionlabs/agent-search-mcp-aigora');
  assert.equal(result.files.length, 13);
  await changeJson(f, 'plugins/aigora/.claude-plugin/plugin.json', (x) => { x.version = '0.2.1'; });
  await assert.rejects(verifyPlugin(f), /version/i);
});

test('first_release_bootstrap_then_same_home_baseline', async (t) => {
  const { verifyPlugin } = await verifier();
  const f = await packageFixture(t);
  const first = await verifyPlugin(f);
  assert.equal((await verifyPlugin({ ...f, bootstrap: false, previousHomeReleaseReceipt: first })).payloadSha256, first.payloadSha256);
  for (const path of ['plugins/aigora/plugin.json', 'plugins/aigora/.claude-plugin/plugin.json']) {
    await changeJson(f, path, (x) => { x.version = '0.2.1'; });
  }
  await assert.rejects(verifyPlugin({ ...f, expectedVersion: '0.2.1' }), /prior|previous|bootstrap/i);
  const next = await verifyPlugin({ ...f, expectedVersion: '0.2.1', bootstrap: false, previousHomeReleaseReceipt: first });
  assert.equal(next.version, '0.2.1');
  assert.notEqual(next.payloadSha256, first.payloadSha256);
  const foreign = { ...first, distributionRepository: 'https://github.com/trionlabs/aigora-skills', version: '0.1.2' };
  await assert.rejects(verifyPlugin({ ...f, expectedVersion: '0.2.1', bootstrap: false, previousHomeReleaseReceipt: foreign }), /home|repository/i);
  await assert.rejects(verifyPlugin({ ...f, expectedVersion: '0.2.1', bootstrap: false, previousHomeReleaseReceipt: { version: '0.2.0' } }), /receipt|baseline/i);
});

test('changed_payload_requires_new_version', async (t) => {
  const { verifyPlugin } = await verifier();
  const f = await packageFixture(t);
  const first = await verifyPlugin(f);
  // Identical JSON data with different shipped bytes still changes the payload.
  const path = join(f.packageRoot, 'plugins/aigora/plugin.json');
  await writeFile(path, (await readFile(path, 'utf8')) + '\n');
  await assert.rejects(verifyPlugin({ ...f, bootstrap: false, previousHomeReleaseReceipt: first }), /version/i);
});

test('frozen_npm_input_change_rejected', async (t) => {
  const { verifyPlugin } = await verifier();
  const f = await packageFixture(t);
  await writeFile(join(f.packageRoot, 'README.md'), 'unreviewed npm README');
  await assert.rejects(verifyPlugin(f), /frozen|npm/i);
});

test('new_plugin_paths_excluded_from_npm_roster', async (t) => {
  const { verifyPlugin } = await verifier();
  const f = await packageFixture(t);
  const before = await snapshot(join(f.packageRoot, 'plugins'));
  await verifyPlugin(f);
  assert.deepEqual(await snapshot(join(f.packageRoot, 'plugins')), before);
  const packageJson = JSON.parse(await readFile(join(f.packageRoot, 'package.json'), 'utf8'));
  assert(!packageJson.files.includes('plugins/'));
  assert(!packageJson.files.includes('.github/'));
  assert.equal(packageJson.version, '0.1.2');
});

test('malformed_manifest_errors_do_not_echo_content', async (t) => {
  const { verifyPlugin } = await verifier();
  const f = await packageFixture(t);
  await writeFile(join(f.packageRoot, 'plugins/aigora/mcp.json'), 'sensitive-fixture-marker-not-json');
  await assert.rejects(verifyPlugin(f), (error) => {
    assert(!error.message.includes('sensitive'), 'JSON parser must not echo payload content');
    return true;
  });
});

test('snapshot_cli_parse_error_does_not_echo_input', async (t) => {
  const f = await fixture(t);
  await mkdir(join(f.packageRoot, 'scripts'));
  await writeFile(join(f.packageRoot, 'scripts/sync-plugin-skills.mjs'), await readFile(join(ROOT, 'scripts/sync-plugin-skills.mjs')));
  const hashFile = join(f.root, 'malformed-input.json');
  await writeFile(hashFile, 'sensitive-fixture-marker-not-json');
  const result = spawnSync(process.execPath, [
    await realpath(join(f.packageRoot, 'scripts/sync-plugin-skills.mjs')),
    '--source-repo', f.sourceRepo, '--source-commit', f.approvedSourceCommit, '--approved-files', hashFile,
  ], { encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert(!result.stderr.includes('sensitive'), 'CLI must not echo input content');
  assert.equal(result.stdout, '');
});

test('snapshot_cli_executes_from_native_temp_paths_and_symlink_entry', async (t) => {
  const f = await fixture(t);
  await mkdir(join(f.packageRoot, 'scripts'));
  await writeFile(join(f.packageRoot, 'scripts/sync-plugin-skills.mjs'), await readFile(join(ROOT, 'scripts/sync-plugin-skills.mjs')));
  const hashFile = join(f.root, 'approved-files.json');
  await writeFile(hashFile, JSON.stringify(f.approvedFileHashes));
  const entry = join(f.packageRoot, 'scripts/sync-plugin-skills.mjs');
  const alias = join(f.root, 'snapshot-entry.mjs');
  await symlink(entry, alias);
  for (const path of [entry, alias]) {
    const result = spawnSync(process.execPath, [
      path, '--source-repo', f.sourceRepo, '--source-commit', f.approvedSourceCommit, '--approved-files', hashFile,
    ], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    assert(result.stdout.includes(f.approvedSourceCommit), 'CLI must actually execute on the native temporary path');
  }
});

test('guides_link_to_one_bundled_install_reference', async (t) => {
  const module = await verifier();
  assert.equal(typeof module.verifyGuides, 'function', 'new guide verification is not implemented');
  const f = await packageFixture(t);
  assert.ok(existsSync(join(f.packageRoot, 'PLUGIN.md')), 'migration guide is missing');
  assert.ok(existsSync(join(f.packageRoot, '.github/README.md')), 'GitHub entry is missing');
  await module.verifyPlugin(f);
});

test('guide_broken_relative_link_rejected', async (t) => {
  const module = await verifier();
  assert.equal(typeof module.verifyGuides, 'function', 'new guide verification is not implemented');
  const f = await packageFixture(t);
  const path = join(f.packageRoot, '.github/README.md');
  const content = await readFile(path, 'utf8');
  await writeFile(path, content.replace('../plugins/aigora/skills/aigora-mcp/references/install.md', '../missing.md'));
  await assert.rejects(module.verifyPlugin(f), /reference|link/i);
});

test('guide_never_instructs_legacy_source_removal', async (t) => {
  const module = await verifier();
  assert.equal(typeof module.verifyGuides, 'function', 'new guide verification is not implemented');
  const f = await packageFixture(t);
  const path = join(f.packageRoot, 'PLUGIN.md');
  await writeFile(path, (await readFile(path, 'utf8')) + '\ncodex plugin marketplace remove aigora\n');
  await assert.rejects(module.verifyPlugin(f), /guide|policy|installation/i);
});

test('verifier_rejects_symlinked_plugin_parent', async (t) => {
  const { verifyPlugin } = await verifier();
  const f = await packageFixture(t);
  const outside = join(f.root, 'outside-plugins');
  await rename(join(f.packageRoot, 'plugins'), outside);
  await symlink(outside, join(f.packageRoot, 'plugins'));
  await assert.rejects(verifyPlugin(f), /directory|regular|symlink/i);
});

test('bootstrap_is_explicit_and_never_combined_with_a_receipt', async (t) => {
  const { verifyPlugin } = await verifier();
  const f = await packageFixture(t);
  await assert.rejects(verifyPlugin({ ...f, bootstrap: false }), /bootstrap|previous|receipt/i);
  await assert.rejects(verifyPlugin({ ...f, bootstrap: undefined }), /bootstrap|previous|receipt/i);
  const first = await verifyPlugin(f);
  await assert.rejects(verifyPlugin({ ...f, previousHomeReleaseReceipt: first }), /bootstrap|combined/i);
  await verifyPlugin({ ...f, bootstrap: false, previousHomeReleaseReceipt: first });
});

test('generated_provenance_requires_exact_bytes', async (t) => {
  const { verifyPlugin } = await verifier();
  const f = await packageFixture(t);
  const path = join(f.packageRoot, 'plugins/aigora/skills-source.json');
  const data = JSON.parse(await readFile(path, 'utf8'));
  await writeFile(path, JSON.stringify(data) + '\n');
  await assert.rejects(verifyPlugin(f), /provenance|generated|manifest|byte/i);
});

test('unsupported_tool_runtime_fails_instead_of_silent_cli_success', async () => {
  const module = await generator();
  assert.equal(typeof module.assertToolRuntime, 'function', 'runtime fail-closed guard not implemented');
  for (const [version, hasEntryPoint] of [['24.0.0', false], ['24.1.0', false], ['24.21.0', false], ['22.23.2', true], ['25.0.0', true]]) {
    assert.throws(() => module.assertToolRuntime(version, hasEntryPoint), /Node 24/i);
  }
  assert.doesNotThrow(() => module.assertToolRuntime('24.21.0', true));
});

test('version_floor_downgrade_and_inconsistent_prior_digest_rejected', async (t) => {
  const { verifyPlugin } = await verifier();
  const f = await packageFixture(t);
  await assert.rejects(verifyPlugin({ ...f, expectedVersion: '0.1.9' }), /version/i);
  const first = await verifyPlugin(f);
  await assert.rejects(verifyPlugin({
    ...f, bootstrap: false, previousHomeReleaseReceipt: { ...first, payloadSha256: '0'.repeat(64) },
  }), /hash|inconsistent/i);
  for (const path of ['plugins/aigora/plugin.json', 'plugins/aigora/.claude-plugin/plugin.json']) {
    await changeJson(f, path, (x) => { x.version = '0.2.1'; });
  }
  const next = await verifyPlugin({ ...f, expectedVersion: '0.2.1', bootstrap: false, previousHomeReleaseReceipt: first });
  for (const path of ['plugins/aigora/plugin.json', 'plugins/aigora/.claude-plugin/plugin.json']) {
    await changeJson(f, path, (x) => { x.version = '0.2.0'; });
  }
  await assert.rejects(verifyPlugin({ ...f, bootstrap: false, previousHomeReleaseReceipt: next }), /version/i);
});

test('verifier_cli_bootstrap_and_receipt_parse_are_fail_closed', async (t) => {
  const f = await packageFixture(t);
  for (const path of ['scripts/sync-plugin-skills.mjs', 'scripts/verify-plugin.mjs']) {
    await writeFile(join(f.packageRoot, path), await readFile(join(ROOT, path)));
  }
  const hashFile = join(f.root, 'hashes.json');
  await writeFile(hashFile, JSON.stringify(f.approvedFileHashes));
  const args = [
    join(f.packageRoot, 'scripts/verify-plugin.mjs'), '--source-repo', f.sourceRepo,
    '--source-commit', f.approvedSourceCommit, '--approved-files', hashFile, '--expected-version', '0.2.0',
  ];
  const run = (extra) => spawnSync(process.execPath, [...args, ...extra], { encoding: 'utf8' });
  assert.equal(run([]).status, 1, 'missing history must not imply bootstrap');
  const boot = run(['--bootstrap']);
  assert.equal(boot.status, 0, boot.stderr);
  const receiptFile = join(f.root, 'receipt.json');
  await writeFile(receiptFile, boot.stdout);
  assert.equal(run(['--previous-home-receipt', receiptFile]).status, 0);
  assert.equal(run(['--bootstrap', '--previous-home-receipt', receiptFile]).status, 1);
  await writeFile(receiptFile, 'null');
  assert.equal(run(['--previous-home-receipt', receiptFile]).status, 1);
  await writeFile(receiptFile, 'sensitive-fixture-not-json');
  const invalid = run(['--previous-home-receipt', receiptFile]);
  assert.equal(invalid.status, 1);
  assert(!invalid.stderr.includes('sensitive'), 'verifier CLI must not echo receipt contents');
});
