import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { INIT_COMMANDS, PACKAGE_RUN_ARGS, RUN_COMMAND } from '../src/clientConfig.js';
import { initTarget } from '../src/initConfig.js';
import { DEFAULT_MCP_URL } from '../src/bridge.js';
import { verifyDocsParity } from './docsParity.mjs';
import { startFixtureServer } from '../test/fixtures/mcpServer.mjs';

const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const NPM = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const NPX = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const MAX_PACKAGE_BYTES = 3_000_000;
const MAX_INSTALL_MS = 8_000;
const EXPECTED_FILES = [
  'LICENSE',
  'RELEASE_NOTES.md',
  'README.md',
  'bin/mcp.js',
  'dist/THIRD_PARTY_LICENSES.txt',
  'dist/cli.js',
  'docs/index.md',
  'package.json',
  'skills/aigora-mcp.md',
].sort();
const SECRET_PATTERNS = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /aigora_mcp_live_[A-Za-z0-9_-]{20,}/,
  /(?:GOOGLE|AWS|AZURE)_[A-Z_]*(?:SECRET|TOKEN|CREDENTIAL)[A-Z_]*\s*=/,
  /(?:CELO|ETHEREUM)_[A-Z_]*PRIVATE_KEY\s*=/,
];

const temp = await mkdtemp(join(tmpdir(), 'aigora-mcp-release-'));
let server;
let bridge;
try {
  const pack = JSON.parse((await run(NPM, ['pack', '--json', '--pack-destination', temp], {
    cwd: PACKAGE_ROOT,
  })).stdout)[0];
  const paths = pack.files.map((file) => file.path).sort();
  equal(paths, EXPECTED_FILES, 'tarball allowlist');
  assert(pack.name === '@aigora/mcp', 'package name');
  assert(/^\d+\.\d+\.\d+$/.test(pack.version), 'release version');
  assert(pack.unpackedSize < MAX_PACKAGE_BYTES, 'tarball unpacked size < 3 MB');

  const tarball = join(temp, pack.filename);
  const bytes = await readFile(tarball);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const packageJson = JSON.parse(await readFile(join(PACKAGE_ROOT, 'package.json'), 'utf8'));
  assert(packageJson.private === false, 'package is public');
  assert(packageJson.license === 'Apache-2.0', 'Apache-2.0 license');
  assert(packageJson.publishConfig?.access === 'public', 'public npm access');
  assert(packageJson.bin?.['aigora-mcp'] === 'bin/mcp.js', 'aigora-mcp binary');
  assert(packageJson.exports?.['.'] === './dist/cli.js', 'root export');
  assert(packageJson.exports?.['./skill'] === './skills/aigora-mcp.md', 'skill export');
  assert(Object.keys(packageJson.dependencies ?? {}).length === 0, 'zero runtime dependencies');

  const evidence = JSON.parse(
    await readFile(join(PACKAGE_ROOT, 'release', `${pack.version}.json`), 'utf8'),
  );
  assert(evidence.package === `${pack.name}@${pack.version}`, 'release evidence package');
  assert(evidence.filename === pack.filename, 'release evidence filename');
  assert(evidence.sha256 === sha256, 'release evidence SHA-256');
  assert(evidence.integrity === pack.integrity, 'release evidence npm integrity');
  assert(evidence.packed_bytes === pack.size, 'release evidence packed size');
  assert(evidence.unpacked_bytes === pack.unpackedSize, 'release evidence unpacked size');
  equal(evidence.files, paths, 'release evidence file allowlist');
  // AD-372 §2 / OA-102: a published default authority is frozen in the evidence and in the shipped bundle.
  assert(evidence.default_mcp_url === DEFAULT_MCP_URL, 'release evidence default MCP URL');
  assert((await readFile(join(PACKAGE_ROOT, 'dist', 'cli.js'), 'utf8')).includes(DEFAULT_MCP_URL), 'bundle default MCP URL');

  for (const file of paths) {
    const content = await readFile(join(PACKAGE_ROOT, file), 'utf8').catch(() => '');
    for (const pattern of SECRET_PATTERNS) {
      assert(!pattern.test(content), `secret scan: ${file}`);
    }
  }

  await verifyDocsParity();

  const installRoot = join(temp, 'clean-install');
  const home = join(temp, 'home');
  await mkdir(installRoot, { recursive: true });
  await mkdir(home, { recursive: true });
  await writeFile(join(installRoot, 'package.json'), '{"private":true}\n', 'utf8');
  // A clean install ignores the operator's npm config: its ~/.npmrc and the npm_config_* that `npm run` exports
  // (npm 11 refuses a user allow-scripts list in a project-scoped install).
  const cleanNpmrc = join(temp, 'npmrc');
  await writeFile(cleanNpmrc, '', 'utf8');
  const cleanEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^npm_config_/i.test(key)));
  const installStart = Date.now();
  await run(NPM, ['install', tarball, '--ignore-scripts', '--no-audit', '--no-fund', '--loglevel=error'], {
    cwd: installRoot,
    env: { ...cleanEnv, npm_config_userconfig: cleanNpmrc },
  });
  const installMs = Date.now() - installStart;
  assert(installMs < MAX_INSTALL_MS, `clean install < ${MAX_INSTALL_MS}ms (was ${installMs}ms)`);
  const installedPackage = join(installRoot, 'node_modules', '@aigora', 'mcp');
  assert(await directoryBytes(installedPackage) < MAX_PACKAGE_BYTES, 'installed package < 3 MB');

  const cliEnv = {
    ...process.env,
    HOME: home,
    USERPROFILE: home,
    PATH: `${join(installRoot, 'node_modules', '.bin')}${delimiter}${process.env.PATH ?? ''}`,
  };
  const help = await run(NPX, ['--no-install', 'aigora-mcp', 'help'], { cwd: installRoot, env: cliEnv });
  assert(help.stdout.includes('@aigora/mcp'), 'npx aigora-mcp help');

  const existingCursor = join(home, '.cursor', 'mcp.json');
  await mkdir(dirname(existingCursor), { recursive: true });
  await writeFile(existingCursor, '{"theme":"dark","mcpServers":{"existing":{"command":"x"}}}\n', 'utf8');
  const existingClaude = join(home, '.claude.json');
  const claudeFixture = {
    theme: 'dark',
    projects: { '/example': { mcpServers: { local: { command: 'local-tool' } } } },
    mcpServers: {
      existing: { command: 'existing-tool' },
      aigora: { command: 'old-command', env: { AIGORA_API_KEY: 'fixture-owned-value' } },
    },
  };
  await writeFile(existingClaude, JSON.stringify(claudeFixture), 'utf8');
  const obsoleteClaude = join(home, '.claude', 'mcp.json');
  await mkdir(dirname(obsoleteClaude), { recursive: true });
  await writeFile(obsoleteClaude, '{obsolete invalid JSON', 'utf8');
  for (const client of Object.keys(INIT_COMMANDS)) {
    const installed = await run(NPX, ['--no-install', 'aigora-mcp', 'init', `--client=${client}`], {
      cwd: installRoot,
      env: cliEnv,
    });
    const target = initTarget(client, cliEnv, process.platform);
    assert(target.ok, `installed config target: ${client}`);
    if (client === 'claude-code') {
      assert(target.path === existingClaude && target.rootKey === 'mcpServers', 'Claude Code user config path/schema');
      assert(installed.stdout.includes(existingClaude) && installed.stdout.includes('Quick test:'), 'Claude Code install instructions');
    }
    const installedConfig = JSON.parse(await readFile(target.path, 'utf8'));
    assert(installedConfig[target.rootKey]?.aigora?.command === 'npx', `installed config command: ${client}`);
    equal(installedConfig[target.rootKey].aigora.args, PACKAGE_RUN_ARGS, `installed config args: ${client}`);
  }
  const cursor = JSON.parse(await readFile(existingCursor, 'utf8'));
  assert(cursor.theme === 'dark' && cursor.mcpServers.existing.command === 'x', 'existing config merge');
  equal(cursor.mcpServers.aigora.args, PACKAGE_RUN_ARGS, 'installed config args');
  const claude = JSON.parse(await readFile(existingClaude, 'utf8'));
  equal(claude, {
    ...claudeFixture,
    mcpServers: {
      ...claudeFixture.mcpServers,
      aigora: { command: 'npx', args: PACKAGE_RUN_ARGS, env: claudeFixture.mcpServers.aigora.env },
    },
  }, 'Claude Code preserves user settings and optional key');
  assert(await readFile(obsoleteClaude, 'utf8') === '{obsolete invalid JSON', 'obsolete Claude Code config untouched');

  const invalid = existingClaude;
  await writeFile(invalid, '{invalid', 'utf8');
  const refused = await run(NPX, ['--no-install', 'aigora-mcp', 'init', '--client=claude-code'], {
    cwd: installRoot,
    env: cliEnv,
    allowFailure: true,
  });
  assert(refused.code === 2, 'invalid JSON returns exit 2');
  assert(await readFile(invalid, 'utf8') === '{invalid', 'invalid JSON is untouched');

  // A local MCP server stands in for Aigora's service; the live tool contract is checked in the Aigora monorepo.
  server = await startFixtureServer();
  bridge = spawn(NPX, [
    '--no-install',
    'aigora-mcp',
    'run',
    '--url',
    server.url,
  ], {
    cwd: installRoot,
    env: cliEnv,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  sendRpc(bridge, {
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: '2025-03-26',
      capabilities: {},
      clientInfo: { name: 'packed-release-verifier', version: '0.1.0' },
    },
  });
  const initialized = await replyFor(bridge, 1);
  assert(Boolean(initialized.result?.serverInfo?.name), 'packed bridge initialize');
  sendRpc(bridge, { jsonrpc: '2.0', method: 'notifications/initialized' });
  sendRpc(bridge, { jsonrpc: '2.0', id: 2, method: 'tools/list' });
  const tools = await replyFor(bridge, 2);
  assert((tools.result?.tools ?? []).some((tool) => tool.name === 'find_agent'), 'packed bridge tools/list');

  process.stdout.write(`${JSON.stringify({
    ok: true,
    package: `${pack.name}@${pack.version}`,
    filename: pack.filename,
    sha256,
    integrity: pack.integrity,
    packed_bytes: pack.size,
    unpacked_bytes: pack.unpackedSize,
    installed_bytes: await directoryBytes(installedPackage),
    clean_install_ms: installMs,
    files: paths,
    clients: Object.keys(INIT_COMMANDS),
    roundtrip: 'initialize+tools/list',
    run: RUN_COMMAND,
    default_mcp_url: DEFAULT_MCP_URL,
    evidence: `release/${pack.version}.json`,
  }, null, 2)}\n`);
} finally {
  bridge?.kill();
  await server?.close();
  await rm(temp, { recursive: true, force: true });
}

async function run(command, args, { cwd, env = process.env, allowFailure = false } = {}) {
  const child = spawn(command, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  const [code] = await once(child, 'close');
  if (!allowFailure && code !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed (${code}): ${stderr || stdout}`);
  }
  return { code, stdout, stderr };
}

async function directoryBytes(path) {
  let total = 0;
  for (const name of await readdir(path)) {
    const child = join(path, name);
    const info = await stat(child);
    total += info.isDirectory() ? await directoryBytes(child) : info.size;
  }
  return total;
}

function sendRpc(child, message) {
  child.stdin.write(`${JSON.stringify(message)}\n`);
}

function replyFor(child, id, timeoutMs = 10_000) {
  return new Promise((resolveReply, reject) => {
    let buffer = '';
    const timer = setTimeout(() => reject(new Error(`no JSON-RPC reply for ${id}`)), timeoutMs);
    const onData = (chunk) => {
      buffer += chunk.toString('utf8');
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.trim()) continue;
        const message = JSON.parse(line);
        if (message.id === id) {
          clearTimeout(timer);
          child.stdout.off('data', onData);
          resolveReply(message);
          return;
        }
      }
    };
    child.stdout.on('data', onData);
  });
}

function assert(condition, label) {
  if (!condition) throw new Error(`release verification failed: ${label}`);
}

function equal(actual, expected, label) {
  assert(JSON.stringify(actual) === JSON.stringify(expected), `${label}: ${JSON.stringify(actual)}`);
}
