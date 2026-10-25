import { execFile, spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, mkdtemp, readdir, readFile, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { parseArgs, execute } from '../src/cli.js';
import { INIT_COMMANDS, PACKAGE_RUN_ARGS } from '../src/clientConfig.js';
import { CLIENTS, initSnippet } from '../src/initSnippet.js';
import { installClientConfig, initTarget, restrictToOwnerOnWindows } from '../src/initConfig.js';
import { DEFAULT_MCP_URL, resolveUrl, startBridge } from '../src/bridge.js';

// The pure CLI layer: arg parsing, init snippets, URL resolution, and the bridge pipe
// with injected fake transports (the real stdio/http round-trip lives in roundtrip.test.js).

describe('parseArgs', () => {
  it('maps run/init/help and both --flag forms', () => {
    expect(parseArgs([])).toEqual({ cmd: 'help' });
    expect(parseArgs(['help'])).toEqual({ cmd: 'help' });
    expect(parseArgs(['run'])).toEqual({ cmd: 'run', url: undefined });
    expect(parseArgs(['run', '--url', 'http://x/mcp'])).toEqual({ cmd: 'run', url: 'http://x/mcp' });
    expect(parseArgs(['run', '--url=http://y/mcp'])).toEqual({ cmd: 'run', url: 'http://y/mcp' });
    expect(parseArgs(['init', '--client=cursor'])).toEqual({ cmd: 'init', client: 'cursor' });
    expect(parseArgs(['init', '--client', 'claude-code'])).toEqual({ cmd: 'init', client: 'claude-code' });
    expect(parseArgs(['frobnicate'])).toEqual({ cmd: 'unknown', given: 'frobnicate' });
  });
});

describe('initSnippet', () => {
  it('covers every supported client; cursor/desktop emit mcpServers JSON, claude-code a one-liner', () => {
    for (const c of CLIENTS) expect(initSnippet(c).ok).toBe(true);
    expect(initSnippet('claude-code').snippet).toMatch(/^claude mcp add aigora/);
    const cursor = JSON.parse(initSnippet('cursor').snippet);
    expect(cursor.mcpServers.aigora).toMatchObject({ command: 'npx', args: ['@aigora/mcp@latest', 'run'] });
    expect(initSnippet('vscode')).toMatchObject({ ok: false, error: 'unknown_client' });
  });

  it('keeps the canonical init/run commands stable for docs and release checks', () => {
    expect(INIT_COMMANDS).toEqual({
      'claude-code': 'npx @aigora/mcp@latest init --client=claude-code',
      cursor: 'npx @aigora/mcp@latest init --client=cursor',
      'claude-desktop': 'npx @aigora/mcp@latest init --client=claude-desktop',
    });
    expect(PACKAGE_RUN_ARGS).toEqual(['@aigora/mcp@latest', 'run']);
  });
});

describe('execute', () => {
  it('init installs config + prints quick test (exit 0); unknown client → exit 2', async () => {
    const out = vi.fn();
    const err = vi.fn();
    const install = vi.fn(async () => ({ ok: true, path: '/tmp/mcp.json' }));
    expect(await execute({ cmd: 'init', client: 'cursor' }, { out, err, install })).toBe(0);
    expect(install).toHaveBeenCalledWith('cursor', expect.any(Object));
    expect(out.mock.calls.map((c) => c[0]).join('\n')).toMatch(/Quick test/);
    expect(await execute({ cmd: 'init', client: 'nope' }, { out, err })).toBe(2);
    expect(err).toHaveBeenCalled();
  });

  it('returns exit 2 and preserves the error when config installation fails', async () => {
    const err = vi.fn();
    const code = await execute(
      { cmd: 'init', client: 'cursor' },
      { out: vi.fn(), err, install: async () => { throw new Error('invalid config'); } },
    );
    expect(code).toBe(2);
    expect(err).toHaveBeenCalledWith('invalid config');
  });

  it('run starts the bridge with the parsed url and logs to stderr, never stdout', async () => {
    const bridge = vi.fn(async () => ({ close: async () => {}, closed: Promise.resolve() }));
    const out = vi.fn();
    const err = vi.fn();
    expect(await execute({ cmd: 'run', url: 'http://x/mcp' }, { out, err, bridge, env: {} })).toBe(0);
    expect(bridge).toHaveBeenCalledWith({ url: 'http://x/mcp', env: {} });
    expect(out).not.toHaveBeenCalled();
    expect(err.mock.calls[0][0]).toMatch(/http:\/\/x\/mcp/);
  });

  // The startup line names the server without credentials, query or fragment.
  it('run logs the server URL without userinfo, query or fragment', async () => {
    const bridge = vi.fn(async () => ({ close: async () => {}, closed: Promise.resolve() }));
    const err = vi.fn();
    await execute({ cmd: 'run', url: 'https://user:pass@x.example/mcp?token=t0k#frag' }, { out: vi.fn(), err, bridge, env: {} });
    expect(err.mock.calls[0][0]).toContain('https://x.example/mcp');
    expect(err.mock.calls[0][0]).not.toMatch(/user|pass|t0k|frag/);
  });
});

describe('installClientConfig', () => {
  // Windows ignores 0600, so the still-empty temp file is restricted to the owner first.
  it('on Windows restricts the empty temp file to its owner before writing, and fails closed', async () => {
    const home = await mkdtemp(join(tmpdir(), 'aigora-mcp-'));
    /** @type {Array<{path: string, size: number}>} */ const calls = [];
    const restrictToOwner = async (/** @type {string} */ path) => { calls.push({ path, size: (await stat(path)).size }); };
    await installClientConfig('cursor', { env: { HOME: home }, platform: 'win32', restrictToOwner });
    expect(calls).toHaveLength(1);
    expect(calls[0].size).toBe(0);
    expect(calls[0].path).toMatch(/mcp\.json\.aigora-tmp-[0-9a-f]{16}$/);
    const failing = async () => { throw new Error('icacls failed'); };
    await expect(installClientConfig('cursor', { env: { HOME: home }, platform: 'win32', restrictToOwner: failing })).rejects.toThrow('icacls');
    expect((await readdir(join(home, '.cursor'))).filter((name) => name.includes('aigora-tmp'))).toEqual([]);
  });

  // icacls.exe runs from the Windows system directory by absolute path, never through search.
  it('runs the system icacls.exe by absolute path and fails closed without SystemRoot or USERNAME', async () => {
    const exec = vi.fn(async () => ({ stdout: '', stderr: '' }));
    await restrictToOwnerOnWindows('C:\\u\\cfg.tmp', { USERNAME: 'ann', USERDOMAIN: 'PC', SystemRoot: 'C:\\Windows' }, exec);
    expect(exec).toHaveBeenCalledWith('C:\\Windows\\System32\\icacls.exe', ['C:\\u\\cfg.tmp', '/inheritance:r', '/grant:r', 'PC\\ann:F']);
    const saved = process.env.SystemRoot;
    delete process.env.SystemRoot;
    try {
      await expect(restrictToOwnerOnWindows('x', { USERNAME: 'ann' }, exec)).rejects.toThrow('SystemRoot');
    } finally {
      if (saved !== undefined) process.env.SystemRoot = saved;
    }
    await expect(restrictToOwnerOnWindows('x', { SystemRoot: 'C:\\Windows' }, exec)).rejects.toThrow('USERNAME');
  });

  // A file or symlink planted at the old predictable temp name is never written through.
  it('never writes through a pre-planted temp path in a shared config directory', async () => {
    const home = await mkdtemp(join(tmpdir(), 'aigora-mcp-'));
    const path = join(home, '.cursor', 'mcp.json');
    await mkdir(dirname(path), { recursive: true });
    const victim = join(home, 'victim.txt');
    await writeFile(victim, 'untouched', 'utf8');
    await symlink(victim, `${path}.aigora-tmp-${process.pid}`);
    await installClientConfig('cursor', { env: { HOME: home } });
    expect(await readFile(victim, 'utf8')).toBe('untouched');
    expect(JSON.parse(await readFile(path, 'utf8')).mcpServers.aigora.command).toBe('npx');
  });

  it('merges only Aigora into an existing Cursor config', async () => {
    const home = await mkdtemp(join(tmpdir(), 'aigora-mcp-'));
    const target = initTarget('cursor', { HOME: home });
    await mkdir(dirname(target.path), { recursive: true });
    await writeFile(target.path, JSON.stringify({ theme: 'dark', mcpServers: { existing: { command: 'x' } } }));
    const result = await installClientConfig('cursor', { env: { HOME: home } });
    expect(result).toEqual({ ok: true, path: target.path });
    const saved = JSON.parse(await readFile(target.path, 'utf8'));
    expect(saved.theme).toBe('dark');
    expect(saved.mcpServers.existing.command).toBe('x');
    expect(saved.mcpServers.aigora).toMatchObject({ command: 'npx', args: ['@aigora/mcp@latest', 'run'] });
    expect(saved.mcpServers.aigora).not.toHaveProperty('env');
  });

  it('merges Claude Code user settings in ~/.claude.json and leaves the obsolete file untouched', async () => {
    const home = await mkdtemp(join(tmpdir(), 'aigora-mcp-'));
    const path = join(home, '.claude.json');
    const obsolete = join(home, '.claude', 'mcp.json');
    await mkdir(dirname(obsolete), { recursive: true });
    await writeFile(obsolete, '{obsolete invalid JSON');
    const original = {
      theme: 'dark',
      projects: { '/example': { mcpServers: { local: { command: 'local-tool' } } } },
      mcpServers: {
        existing: { command: 'existing-tool', env: { USER_SETTING: 'keep' } },
        aigora: { command: 'old-command', args: ['old-arg'], env: { AIGORA_API_KEY: 'fixture-owned-value', USER_SETTING: 'keep' } },
      },
    };
    await writeFile(path, JSON.stringify(original));
    expect(initTarget('claude-code', { HOME: home })).toEqual({ ok: true, path, rootKey: 'mcpServers' });
    expect(await installClientConfig('claude-code', { env: { HOME: home } })).toEqual({ ok: true, path });
    const saved = JSON.parse(await readFile(path, 'utf8'));
    expect(saved).toEqual({
      ...original,
      mcpServers: {
        ...original.mcpServers,
        aigora: { command: 'npx', args: ['@aigora/mcp@latest', 'run'], env: original.mcpServers.aigora.env },
      },
    });
    expect(await readFile(obsolete, 'utf8')).toBe('{obsolete invalid JSON');
  });

  it.each([
    '{broken', 'null', '[]',
    '{"mcpServers":null}', '{"mcpServers":[]}', '{"mcpServers":"invalid"}',
    '{"mcpServers":{"aigora":null}}', '{"mcpServers":{"aigora":[]}}', '{"mcpServers":{"aigora":"invalid"}}',
    '{"mcpServers":{"aigora":{"env":null}}}', '{"mcpServers":{"aigora":{"env":[]}}}',
    '{"mcpServers":{"aigora":{"env":"invalid"}}}',
  ])('refuses invalid Claude Code config without changing its bytes: %s', async (raw) => {
    const home = await mkdtemp(join(tmpdir(), 'aigora-mcp-'));
    const path = join(home, '.claude.json');
    await writeFile(path, raw);
    await expect(installClientConfig('claude-code', { env: { HOME: home } })).rejects.toThrow();
    expect(await readFile(path, 'utf8')).toBe(raw);
    await expect(stat(join(home, '.claude', 'mcp.json'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('the bundled CLI installs a fresh Claude Code user entry and prints its exact path and quick test', async () => {
    const home = await mkdtemp(join(tmpdir(), 'aigora-mcp-'));
    const path = join(home, '.claude.json');
    const bin = fileURLToPath(new URL('../bin/mcp.js', import.meta.url));
    const { stdout } = await promisify(execFile)(process.execPath, [bin, 'init', '--client=claude-code'], {
      env: { HOME: home, USERPROFILE: home, PATH: process.env.PATH },
    });
    expect(stdout).toContain(`Aigora MCP installed for claude-code: ${path}\n`);
    expect(stdout).toContain('Quick test:');
    expect(JSON.parse(await readFile(path, 'utf8'))).toEqual({
      mcpServers: { aigora: { command: 'npx', args: ['@aigora/mcp@latest', 'run'] } },
    });
    expect((await stat(path)).mode & 0o777).toBe(0o600);
    await expect(stat(join(home, '.claude', 'mcp.json'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('resolves Claude Desktop paths on macOS, Windows and Linux', () => {
    const env = { HOME: '/home/aigora', USERPROFILE: 'C:\\Users\\aigora', APPDATA: 'C:\\Users\\aigora\\AppData\\Roaming' };
    expect(initTarget('claude-desktop', env, 'darwin').path)
      .toBe('/home/aigora/Library/Application Support/Claude/claude_desktop_config.json');
    expect(initTarget('claude-desktop', env, 'linux').path)
      .toBe('/home/aigora/.config/Claude/claude_desktop_config.json');
    expect(initTarget('claude-desktop', env, 'win32').path)
      .toContain('C:\\Users\\aigora\\AppData\\Roaming/Claude/claude_desktop_config.json');
  });

  // Re-running init for Cursor/Claude Desktop must not delete a key or URL override the user added.
  it.each(['cursor', 'claude-desktop'])('re-running %s init keeps the user aigora.env and refuses malformed entries', async (client) => {
    const home = await mkdtemp(join(tmpdir(), 'aigora-mcp-'));
    const opts = { env: { HOME: home }, platform: /** @type {NodeJS.Platform} */ ('linux') };
    const target = initTarget(client, opts.env, opts.platform);
    if (!target.ok) throw new Error('no target');
    await mkdir(dirname(target.path), { recursive: true });
    const env = { AIGORA_API_KEY: 'fixture-owned-value', AIGORA_MCP_URL: 'https://example.test/mcp' };
    await writeFile(target.path, JSON.stringify({ mcpServers: { aigora: { command: 'old', args: ['old'], env } } }));
    await installClientConfig(client, opts);
    expect(JSON.parse(await readFile(target.path, 'utf8')).mcpServers.aigora)
      .toEqual({ command: 'npx', args: ['@aigora/mcp@latest', 'run'], env });
    for (const raw of ['{"mcpServers":null}', '{"mcpServers":{"aigora":[]}}', '{"mcpServers":{"aigora":{"env":"invalid"}}}']) {
      await writeFile(target.path, raw);
      await expect(installClientConfig(client, opts)).rejects.toThrow();
      expect(await readFile(target.path, 'utf8')).toBe(raw);
    }
  });

  it('refuses a non-object config root or server map without replacing either file', async () => {
    const home = await mkdtemp(join(tmpdir(), 'aigora-mcp-'));
    const target = initTarget('cursor', { HOME: home });
    await mkdir(dirname(target.path), { recursive: true });
    for (const raw of ['[]', '{"mcpServers":[]}']) {
      await writeFile(target.path, raw);
      await expect(installClientConfig('cursor', { env: { HOME: home } })).rejects.toThrow();
      expect(await readFile(target.path, 'utf8')).toBe(raw);
    }
  });
});

describe('resolveUrl', () => {
  it('flag > env > default', () => {
    expect(resolveUrl('http://flag/mcp', { AIGORA_MCP_URL: 'http://env/mcp' })).toBe('http://flag/mcp');
    expect(resolveUrl(undefined, { AIGORA_MCP_URL: 'http://env/mcp' })).toBe('http://env/mcp');
    expect(resolveUrl(undefined, {})).toBe(DEFAULT_MCP_URL);
  });

  it('defaults to the isolated production MCP service', () => {
    const url = new URL(DEFAULT_MCP_URL);
    expect(url.protocol).toBe('https:');
    expect(url.hostname).toMatch(/^aigora-prd-mcp-/);
    expect(url.pathname).toBe('/mcp');
    expect(url.hostname).not.toMatch(/^aigora-mcp-/);
  });
});

describe('startBridge (fake transports)', () => {
  function fakeTransport() {
    const t = {
      started: false,
      closed: false,
      sent: [],
      onmessage: null,
      onerror: null,
      onclose: null,
      start: vi.fn(async () => { t.started = true; }),
      close: vi.fn(async () => { t.closed = true; t.onclose?.(); }),
      send: vi.fn(async (m) => { t.sent.push(m); }),
    };
    return t;
  }

  it('pipes messages both ways and mirrors a local close to the remote', async () => {
    const local = fakeTransport();
    const remote = fakeTransport();
    await startBridge({ url: 'http://x/mcp', env: {}, makeLocal: () => local, makeRemote: () => remote });
    expect(local.started && remote.started).toBe(true);

    local.onmessage({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
    expect(remote.sent[0]).toMatchObject({ method: 'tools/list' });

    remote.onmessage({ jsonrpc: '2.0', id: 1, result: { tools: [] } });
    expect(local.sent[0]).toMatchObject({ result: { tools: [] } });

    await local.close();
    expect(remote.closed).toBe(true);
  });

  // An HTTP failure (revoked key, quota, outage) still answers the request instead of leaving it pending.
  it('answers a request the remote rejects with a JSON-RPC error; a failed notification is only logged', async () => {
    const local = fakeTransport();
    const remote = fakeTransport();
    remote.send = vi.fn(async () => { throw Object.assign(new Error('Streamable HTTP error: Error POSTing to endpoint'), { code: 401 }); });
    /** @type {string[]} */ const errors = [];
    await startBridge({ url: 'http://x/mcp', env: {}, makeLocal: () => local, makeRemote: () => remote, onError: (where) => errors.push(where) });
    local.onmessage({ jsonrpc: '2.0', id: 7, method: 'tools/list' });
    local.onmessage({ jsonrpc: '2.0', method: 'notifications/initialized' });
    await vi.waitFor(() => expect(errors).toEqual(['remote send', 'remote send']));
    expect(local.sent).toEqual([{ jsonrpc: '2.0', id: 7, error: { code: -32603, message: expect.stringContaining('HTTP 401') } }]);
  });

  // The SDK stdio transport ignores stdin EOF, so `run` never settled and Node exited 13.
  it('the bundled CLI exits 0 when the editor closes stdin', async () => {
    const bin = fileURLToPath(new URL('../bin/mcp.js', import.meta.url));
    const child = spawn(process.execPath, [bin, 'run', '--url', 'http://127.0.0.1:9/mcp'], { stdio: ['pipe', 'ignore', 'ignore'] });
    child.stdin.end();
    const [code] = await once(child, 'exit');
    expect(code).toBe(0);
  });

  // The SDK HTTP transport aborts its open SSE stream on close and reports that abort through onerror.
  it('reports remote errors while open, but not the abort its own shutdown causes', async () => {
    for (const shutdown of ['stdin EOF', 'close()']) {
      const local = fakeTransport();
      const remote = fakeTransport();
      remote.close = vi.fn(async () => { remote.onerror?.(new Error('SSE stream disconnected: AbortError')); remote.onclose?.(); });
      /** @type {string[]} */ const errors = [];
      const b = await startBridge({ url: 'http://x/mcp', env: {}, makeLocal: () => local, makeRemote: () => remote,
        onError: (where) => errors.push(where) });
      remote.onerror(new Error('SSE stream disconnected: socket hang up'));
      expect(errors).toEqual(['http']);
      if (shutdown === 'stdin EOF') await local.close(); else await b.close();
      expect(remote.close).toHaveBeenCalled();
      expect(errors, shutdown).toEqual(['http']);
    }
  });

  // The key never reaches stderr or an MCP error reply, and never travels in cleartext off-host.
  it('refuses a key a header cannot carry with a fixed message that does not echo it', async () => {
    const run = startBridge({ url: 'https://x/mcp', env: { AIGORA_API_KEY: 'aigora_mcp_live_abc\nxyz' },
      makeLocal: fakeTransport, makeRemote: fakeTransport });
    await expect(run).rejects.toThrow('AIGORA_API_KEY');
    await run.catch((error) => expect(String(error.message)).not.toContain('aigora_mcp_live_abc'));
  });

  it('refuses an authenticated plain-http remote URL; loopback http and keyless http stay allowed', async () => {
    const key = { AIGORA_API_KEY: 'aigora_mcp_live_abc' };
    await expect(startBridge({ url: 'http://remote.example/mcp', env: key, makeLocal: fakeTransport, makeRemote: fakeTransport }))
      .rejects.toThrow('https');
    for (const url of ['http://127.0.0.1:9/mcp', 'http://localhost:9/mcp', 'http://[::1]:9/mcp']) {
      await expect(startBridge({ url, env: key, makeLocal: fakeTransport, makeRemote: fakeTransport })).resolves.toBeTruthy();
    }
    await expect(startBridge({ url: 'http://remote.example/mcp', env: {}, makeLocal: fakeTransport, makeRemote: fakeTransport })).resolves.toBeTruthy();
  });

  it('redacts the key from a failed request\'s error reply and from the default stderr diagnostic', async () => {
    const local = fakeTransport();
    const remote = fakeTransport();
    remote.send = vi.fn(async () => { throw new Error('upstream echoed Authorization: Bearer aigora_mcp_live_abc'); });
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    await startBridge({ url: 'https://x/mcp', env: { AIGORA_API_KEY: 'aigora_mcp_live_abc' }, makeLocal: () => local, makeRemote: () => remote });
    local.onmessage({ jsonrpc: '2.0', id: 7, method: 'tools/list' });
    await vi.waitFor(() => expect(local.sent).toHaveLength(1));
    expect(JSON.stringify(local.sent)).not.toContain('aigora_mcp_live_abc');
    expect(JSON.stringify(logged.mock.calls, (_k, v) => (v instanceof Error ? v.message : v))).not.toContain('aigora_mcp_live_abc');
    logged.mockRestore();
  });

  // URL credentials never reach an error message, stderr or a reply.
  it('refuses a malformed or credential-bearing URL with a fixed message that echoes nothing', async () => {
    for (const url of ['https://u:secretpw@[bad/mcp?token=t0k', 'https://u:secretpw@x.example/mcp', 'file:///etc/secretpw']) {
      const run = startBridge({ url, env: {}, makeLocal: fakeTransport, makeRemote: fakeTransport });
      await expect(run).rejects.toThrow('MCP URL');
      await run.catch((error) => expect(String(error.message)).not.toMatch(/secretpw|t0k/));
    }
  });

  it('redacts URL query values from a failed request\'s reply and the default diagnostic', async () => {
    const local = fakeTransport();
    const remote = fakeTransport();
    remote.send = vi.fn(async () => { throw new Error('POST https://x.example/mcp?token=t0kq1 failed'); });
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    await startBridge({ url: 'https://x.example/mcp?token=t0kq1', env: {}, makeLocal: () => local, makeRemote: () => remote });
    local.onmessage({ jsonrpc: '2.0', id: 8, method: 'tools/list' });
    await vi.waitFor(() => expect(local.sent).toHaveLength(1));
    expect(JSON.stringify(local.sent)).not.toContain('t0kq1');
    expect(JSON.stringify(logged.mock.calls)).not.toContain('t0kq1');
    logged.mockRestore();
  });

  it('the bundled CLI exits 2 on a bad URL without printing it', async () => {
    const bin = fileURLToPath(new URL('../bin/mcp.js', import.meta.url));
    const child = spawn(process.execPath, [bin, 'run', '--url', 'https://u:secretpw@[bad/mcp?token=t0k'], { stdio: ['pipe', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    const [code] = await once(child, 'exit');
    expect(code).toBe(2);
    expect(stderr).toContain('MCP URL');
    expect(stderr).not.toMatch(/secretpw|t0k/);
  });

  // Upstream error text is never relayed, so a reflected query value or short key cannot leak.
  it('answers a failed request with a fixed message and status only, never upstream text', async () => {
    const local = fakeTransport();
    const remote = fakeTransport();
    remote.send = vi.fn(async () => { throw Object.assign(new Error('Invalid token: fixture-query-secret; key abc'), { code: 401 }); });
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    await startBridge({ url: 'https://x.example/mcp?token=fixture-query-secret&mode=read', env: { AIGORA_API_KEY: 'abc' },
      makeLocal: () => local, makeRemote: () => remote });
    local.onmessage({ jsonrpc: '2.0', id: 9, method: 'tools/list' });
    await vi.waitFor(() => expect(local.sent).toHaveLength(1));
    expect(local.sent[0]).toEqual({ jsonrpc: '2.0', id: 9, error: { code: -32603, message: 'Aigora MCP request failed (HTTP 401)' } });
    expect(JSON.stringify(logged.mock.calls)).not.toMatch(/fixture-query-secret|abc/);
    logged.mockRestore();
  });

  it('passes the Tier-1 key as a Bearer header to the remote factory', async () => {
    const makeRemote = vi.fn(() => fakeTransport());
    await startBridge({ url: 'https://x/mcp', env: { AIGORA_API_KEY: 'aigora_mcp_live_abc' }, makeLocal: fakeTransport, makeRemote });
    const [url, init] = /** @type {any[]} */ (/** @type {unknown} */ (makeRemote.mock.calls[0]));
    expect(url.href).toBe('https://x/mcp');
    expect(init.headers.authorization).toBe('Bearer aigora_mcp_live_abc');
  });
});
