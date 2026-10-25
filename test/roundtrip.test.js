import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { startFixtureServer } from './fixtures/mcpServer.mjs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// M6-17B (#142): the clean-env round-trip. A local fixture MCP server (test/fixtures/mcpServer.mjs) stands in for
// Aigora's service; the REAL bin/mcp.js bridge runs as a child process and a stdio MCP session goes through it.
// The live service's tool contract is checked in the Aigora monorepo against the published package.

/** @type {import('node:child_process').ChildProcess} */ let bridge;
/** @type {{ url: string, close: () => Promise<unknown> }} */ let fixture;

beforeAll(async () => {
  fixture = await startFixtureServer();
}, 20_000);

afterAll(async () => {
  bridge?.kill();
  await fixture?.close();
});

function rpc(child, msg) {
  child.stdin.write(JSON.stringify(msg) + '\n');
}

/** Collect newline-delimited JSON-RPC replies off the bridge's stdout until `id` shows up. */
function replyFor(child, id, timeoutMs = 10_000) {
  return new Promise((resolve, reject) => {
    let buf = '';
    const timer = setTimeout(() => reject(new Error(`no reply for id ${id}; got: ${buf.slice(0, 400)}`)), timeoutMs);
    child.stdout.on('data', (chunk) => {
      buf += chunk.toString('utf8');
      for (const line of buf.split('\n')) {
        if (!line.trim()) continue;
        try {
          const msg = JSON.parse(line);
          if (msg.id === id) {
            clearTimeout(timer);
            resolve(msg);
            return;
          }
        } catch {
          /* partial line — keep buffering */
        }
      }
    });
  });
}

describe('stdio ⇄ streamable-http round-trip against a local MCP server', () => {
  it('initialize, tools/list and a tools/call reply flow through the bridge and back', async () => {
    bridge = spawn(process.execPath, ['bin/mcp.js', 'run', '--url', fixture.url], {
      cwd: fileURLToPath(new URL('..', import.meta.url)),
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const bridgeErr = [];
    bridge.stderr.on('data', (c) => bridgeErr.push(c.toString()));

    rpc(bridge, {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'roundtrip-test', version: '0.0.1' } },
    });
    const init = await replyFor(bridge, 1);
    expect(init.result?.serverInfo?.name).toBeTruthy();

    rpc(bridge, { jsonrpc: '2.0', method: 'notifications/initialized' });
    rpc(bridge, { jsonrpc: '2.0', id: 2, method: 'tools/list' });
    const tools = await replyFor(bridge, 2);
    const names = (tools.result?.tools ?? []).map((t) => t.name);
    expect(names).toEqual(['find_agent']);

    // A tools/call reply also crosses both bundled transports' message schemas (zod 4).
    rpc(bridge, { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'find_agent', arguments: { query: 'x' } } });
    const call = await replyFor(bridge, 3);
    expect(call).toMatchObject({ id: 3, result: { content: [{ type: 'text', text: 'fixture:x' }] } });

    // The editor hangs up: the bridge exits 0, and stderr holds only its startup line, no error from its own shutdown.
    bridge.stdin.end();
    const [code] = await once(bridge, 'close'); // after stderr is drained
    expect(code).toBe(0);
    expect(bridgeErr.join('').trim().split('\n')).toEqual([`[aigora-mcp] bridging stdio ⇄ ${fixture.url}`]);
  }, 30_000);
});
