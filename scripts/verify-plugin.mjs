import assert from 'node:assert/strict';
import { lstat, readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { isDeepStrictEqual, parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { parseJson, readApprovedSkills, readRegularTree, sha256, sourceGit, verifyLocalReferences } from './sync-plugin-skills.mjs';

export const DISTRIBUTION_REPOSITORY = 'https://github.com/trionlabs/agent-search-mcp-aigora';
export const ENDPOINT = 'https://aigora-prd-mcp-vfl5n4ujkq-ey.a.run.app/mcp';
const BRIDGE_BASE = '978e66196ce320211eba970a7d48e1a8ffe0ca61';
const NATIVE_FILES = ['.claude-plugin/plugin.json', '.mcp.json', 'mcp.json', 'plugin.json'];
const safeJson = parseJson;
const matches = (actual, expected, message) => assert(isDeepStrictEqual(actual, expected), message);
function keys(value, expected, label) {
  assert(value && typeof value === 'object' && !Array.isArray(value), label + ' must be an object');
  matches(Object.keys(value).sort(), [...expected].sort(), label + ' manifest keys differ');
}
function versionParts(version) {
  assert(typeof version === 'string' && /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version), 'invalid plugin version');
  return version.split('.').map(BigInt);
}
function compareVersions(a, b) {
  const left = versionParts(a); const right = versionParts(b);
  for (let i = 0; i < 3; i++) {
    if (left[i] > right[i]) return 1;
    if (left[i] < right[i]) return -1;
  }
  return 0;
}
const payloadDigest = (files) => sha256(Buffer.from(JSON.stringify(files)));

async function regularFile(root, path) {
  const rootStat = await lstat(root);
  assert(rootStat.isDirectory() && !rootStat.isSymbolicLink(), 'regular directory boundary required');
  const segments = path.split('/');
  for (let i = 0; i < segments.length; i++) {
    const stat = await lstat(join(root, ...segments.slice(0, i + 1)));
    assert(!stat.isSymbolicLink() && (i === segments.length - 1 ? stat.isFile() : stat.isDirectory()),
      'regular file/directory required, no symlink');
  }
  return readFile(join(root, path));
}

function validateNative(files, expectedVersion) {
  const codex = safeJson(files.get('plugin.json'));
  keys(codex, ['$schema', 'name', 'version', 'description'], 'Codex plugin');
  assert(codex.$schema === 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json', 'Codex manifest schema differs');
  assert(codex.name === 'aigora' && codex.version === expectedVersion, 'Codex plugin version/name differs');
  assert(typeof codex.description === 'string' && codex.description, 'manifest description required');
  const claude = safeJson(files.get('.claude-plugin/plugin.json'));
  keys(claude, ['name', 'displayName', 'version', 'description', 'author', 'homepage', 'repository', 'keywords'], 'Claude plugin');
  assert(claude.name === 'aigora' && claude.version === expectedVersion && claude.displayName === 'Aigora', 'Claude plugin version/name differs');
  matches(claude.author, { name: 'Trion Labs', url: 'https://aigora.org' }, 'Claude manifest author differs');
  assert(claude.homepage === 'https://aigora.org' && claude.repository === DISTRIBUTION_REPOSITORY, 'Claude manifest repository differs');
  matches(claude.keywords, ['aigora', 'celo', 'erc-8004', 'mcp', 'agents'], 'Claude manifest keywords differ');
  assert(typeof claude.description === 'string' && claude.description, 'manifest description required');
  for (const [path, type] of [['mcp.json', 'streamable-http'], ['.mcp.json', 'http']]) {
    const value = safeJson(files.get(path));
    keys(value, path === 'mcp.json' ? ['$schema', 'mcpServers'] : ['mcpServers'], 'MCP');
    if (path === 'mcp.json') assert(value.$schema === 'https://agent-plugins.org/schemas/1.0.0/mcp.schema.json', 'MCP manifest schema differs');
    keys(value.mcpServers, ['aigora'], 'server map');
    matches(value.mcpServers.aigora, { type, url: ENDPOINT }, 'server endpoint/transport/permission manifest differs');
  }
}

async function validateCatalogs(packageRoot) {
  const codex = safeJson(await regularFile(packageRoot, '.agents/plugins/marketplace.json'));
  keys(codex, ['name', 'interface', 'plugins'], 'Codex catalog');
  assert(codex.name === 'aigora', 'catalog name differs');
  matches(codex.interface, { displayName: 'Aigora' }, 'catalog interface differs');
  assert(Array.isArray(codex.plugins) && codex.plugins.length === 1, 'catalog roster differs');
  const plugin = codex.plugins[0];
  keys(plugin, ['name', 'source', 'policy', 'category'], 'catalog plugin');
  matches(plugin.source, { source: 'local', path: './plugins/aigora' }, 'catalog source differs');
  matches(plugin.policy, { installation: 'AVAILABLE', authentication: 'ON_INSTALL' }, 'catalog policy differs');
  assert(plugin.name === 'aigora' && plugin.category === 'Productivity', 'catalog plugin identity differs');
  const claude = safeJson(await regularFile(packageRoot, '.claude-plugin/marketplace.json'));
  keys(claude, ['name', 'owner', 'description', 'plugins'], 'Claude catalog');
  assert(claude.name === 'aigora', 'catalog name differs');
  matches(claude.owner, { name: 'Trion Labs', url: 'https://aigora.org' }, 'catalog owner differs');
  assert(typeof claude.description === 'string' && claude.description, 'catalog description required');
  assert(Array.isArray(claude.plugins) && claude.plugins.length === 1, 'catalog roster differs');
  keys(claude.plugins[0], ['name', 'source', 'description'], 'Claude catalog plugin');
  assert(claude.plugins[0].name === 'aigora' && claude.plugins[0].source === './plugins/aigora', 'catalog source differs');
  assert(typeof claude.plugins[0].description === 'string' && claude.plugins[0].description, 'catalog description required');
}

async function verifyFrozenNpmInputs(packageRoot) {
  const tree = (await sourceGit(packageRoot, ['ls-tree', '-r', '-z', BRIDGE_BASE])).toString('utf8')
    .split('\0').filter(Boolean).map((line) => line.slice(line.indexOf('\t') + 1));
  assert(tree.length > 0, 'frozen npm baseline unavailable');
  const hashes = [];
  for (const path of tree) {
    const expected = await sourceGit(packageRoot, ['cat-file', 'blob', BRIDGE_BASE + ':' + path]);
    const actual = await regularFile(packageRoot, path);
    assert(actual.equals(expected), 'frozen npm/source input differs: ' + path);
    hashes.push({ path, sha256: sha256(actual) });
  }
  return { baseCommit: BRIDGE_BASE, filesChecked: hashes.length, sha256: payloadDigest(hashes) };
}

function validatePriorReceipt(receipt, filePaths) {
  assert(receipt && receipt.schemaVersion === 1 && typeof receipt.version === 'string' &&
    Array.isArray(receipt.files) && /^[a-f0-9]{64}$/.test(receipt.payloadSha256 ?? ''), 'invalid prior baseline receipt');
  assert(receipt.distributionRepository === DISTRIBUTION_REPOSITORY, 'prior receipt belongs to a different distribution home/repository');
  versionParts(receipt.version);
  const paths = receipt.files.map((file) => file.path);
  matches(paths, filePaths, 'prior baseline receipt file roster differs');
  assert(receipt.files.every((file) => /^[a-f0-9]{64}$/.test(file.sha256 ?? '')), 'invalid prior baseline file hash');
  assert(payloadDigest(receipt.files) === receipt.payloadSha256, 'prior baseline receipt hash is inconsistent');
}

export async function verifyGuides({ packageRoot, pluginFiles }) {
  const files = new Map([...pluginFiles].map(([path, bytes]) => ['plugins/aigora/' + path, bytes]));
  files.set('README.md', await regularFile(packageRoot, 'README.md'));
  for (const path of ['.github/README.md', 'PLUGIN.md']) {
    const bytes = await regularFile(packageRoot, path);
    const text = bytes.toString('utf8');
    assert(!/^(?:\/plugin|codex plugin)\s+marketplace\s+(?:add|remove)\b/m.test(text), 'guide policy: keep installation commands in the authored reference');
    files.set(path, bytes);
  }
  verifyLocalReferences(files, ['.github/README.md', 'PLUGIN.md']);
  const entry = files.get('.github/README.md').toString('utf8');
  const policy = files.get('PLUGIN.md').toString('utf8');
  assert(entry.includes('../plugins/aigora/skills/aigora-mcp/references/install.md'), 'guide installation reference missing');
  assert(policy.includes(DISTRIBUTION_REPOSITORY) && policy.includes('aigora@aigora') && policy.includes('trionlabs/aigora-skills'), 'guide source/identity missing');
  assert(policy.includes('plugins/aigora/plugin.json') && policy.includes('plugins/aigora/.claude-plugin/plugin.json'), 'guide version references missing');
}

export async function verifyPlugin(input) {
  versionParts(input.expectedVersion);
  assert(compareVersions(input.expectedVersion, '0.2.0') >= 0, 'new-home plugin version below first release');
  const source = await readApprovedSkills(input);
  const packageRoot = resolve(input.packageRoot);
  await validateCatalogs(packageRoot);
  // Check every parent before traversing the payload, including plugins itself.
  await regularFile(packageRoot, 'plugins/aigora/plugin.json');
  const pluginFiles = await readRegularTree(join(packageRoot, 'plugins/aigora'));
  const expectedPaths = [...source.files.keys(), ...NATIVE_FILES, 'skills-source.json'].sort();
  matches([...pluginFiles.keys()].sort(), expectedPaths, 'plugin payload roster differs');
  for (const [path, bytes] of source.files) {
    assert(pluginFiles.get(path).equals(bytes), 'approved source payload hash mismatch: ' + path);
  }
  matches(safeJson(pluginFiles.get('skills-source.json')), source.manifest, 'source manifest differs from approved commit/hashes');
  validateNative(pluginFiles, input.expectedVersion);
  for (const bytes of pluginFiles.values()) {
    assert(!/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|aigora_mcp_live_[A-Za-z0-9_-]{20,}/.test(bytes.toString('utf8')),
      'likely secret in plugin payload');
  }
  const files = expectedPaths.map((path) => ({ path, sha256: sha256(pluginFiles.get(path)) }));
  const payloadSha256 = payloadDigest(files);
  const prior = input.previousHomeReleaseReceipt;
  if (prior == null) {
    assert(input.expectedVersion === '0.2.0', 'previous same-home receipt required after first-release bootstrap');
  } else {
    validatePriorReceipt(prior, expectedPaths);
    const order = compareVersions(input.expectedVersion, prior.version);
    assert(order >= 0 && (order > 0 || payloadSha256 === prior.payloadSha256), 'changed payload requires a new version in this home');
  }
  const frozenNpm = await verifyFrozenNpmInputs(packageRoot);
  await verifyGuides({ packageRoot, pluginFiles });
  return {
    schemaVersion: 1, distributionRepository: DISTRIBUTION_REPOSITORY, version: input.expectedVersion,
    sourceRepository: source.manifest.repository, sourceCommit: source.sourceCommit,
    payloadSha256, files, endpoint: ENDPOINT, frozenNpm,
  };
}

if (import.meta.main) {
  try {
    const { values } = parseArgs({ options: {
      'source-repo': { type: 'string' }, 'source-commit': { type: 'string' },
      'approved-files': { type: 'string' }, 'previous-home-receipt': { type: 'string' },
      'expected-version': { type: 'string' },
    } });
    assert(values['approved-files'], 'approved-files path required');
    const result = await verifyPlugin({
      sourceRepo: values['source-repo'], approvedSourceCommit: values['source-commit'],
      approvedFileHashes: safeJson(await readFile(values['approved-files'])),
      previousHomeReleaseReceipt: values['previous-home-receipt']
        ? safeJson(await readFile(values['previous-home-receipt'])) : null,
      expectedVersion: values['expected-version'],
      packageRoot: resolve(dirname(fileURLToPath(import.meta.url)), '..'),
    });
    process.stdout.write(JSON.stringify(result) + '\n');
  } catch (error) {
    process.stderr.write('plugin verification failed: ' + error.message + '\n');
    process.exitCode = 1;
  }
}
