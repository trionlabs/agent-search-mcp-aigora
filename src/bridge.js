// The stdio ⇄ streamable-http bridge behind `npx @aigora/mcp run`.
// A local MCP client (Claude Code / Cursor / Claude Desktop) speaks stdio JSON-RPC; the Aigora server
// speaks stateless streamable-http. The bridge is a RAW MESSAGE
// PIPE between the two SDK transports — it interprets nothing, so every current and future tool flows
// through unchanged (additive schema policy). Transports are injectable for tests.

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

// The default is Aigora's production MCP service.
// A later custom-domain change still requires a minor+ release; users can always override via
// `--url` / AIGORA_MCP_URL.
export const DEFAULT_MCP_URL = 'https://aigora-prd-mcp-vfl5n4ujkq-ey.a.run.app/mcp';

/** Resolve the server URL: explicit flag > AIGORA_MCP_URL env > the published default. */
export function resolveUrl(flagUrl, env = process.env) {
  return (flagUrl || env.AIGORA_MCP_URL || DEFAULT_MCP_URL).trim();
}

/** The URL for diagnostics: no userinfo, query or fragment, which may carry credentials. */
export function displayUrl(raw) {
  try {
    const url = new URL(raw);
    url.username = ''; url.password = ''; url.search = ''; url.hash = '';
    return url.href;
  } catch {
    return '(invalid URL)';
  }
}

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/**
 * Wire the two transports into a bidirectional pipe and start both ends.
 * @param {{ url?: string, apiKey?: string|null, env?: NodeJS.ProcessEnv,
 *           makeLocal?: () => any, makeRemote?: (url: URL, init: any) => any,
 *           onError?: (where: string, err: unknown) => void }} [opts]
 * @returns {Promise<{ close: () => Promise<void>, closed: Promise<void> }>}
 */
export async function startBridge(opts = {}) {
  const env = opts.env ?? process.env;
  // Fixed messages: a malformed or credential-bearing URL is never echoed into an error.
  let url;
  try { url = new URL(resolveUrl(opts.url, env)); } catch { throw new Error('The MCP URL is not a valid URL'); }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('The MCP URL must be https:// (or http:// to localhost)');
  if (url.username || url.password) throw new Error('The MCP URL must not contain a username or password');
  const apiKey = opts.apiKey ?? env.AIGORA_API_KEY ?? null;
  // The key goes into one header only, never in cleartext off this machine, and never into stderr or a reply.
  if (apiKey && !/^[A-Za-z0-9_-]+$/.test(apiKey)) throw new Error('AIGORA_API_KEY may contain only letters, digits, "_" and "-"');
  if (apiKey && url.protocol !== 'https:' && !LOOPBACK_HOSTS.has(url.hostname)) {
    throw new Error('AIGORA_API_KEY needs an https:// MCP URL (plain http only to localhost)');
  }
  // Upstream and transport errors may quote the URL, its query or a reflected header, so none of their text is relayed:
  // only a fixed message and a validated HTTP status reach stderr or a reply.
  const failure = (err) => {
    const status = /** @type {any} */ (err)?.code;
    return `request failed${Number.isInteger(status) && status >= 100 && status <= 599 ? ` (HTTP ${status})` : ''}`;
  };
  const onError = opts.onError ?? ((where, err) => console.error(`[aigora-mcp] ${where}: ${failure(err)}`));

  // Tier-1 key rides as a Bearer header; Tier-0 sends nothing.
  const requestInit = apiKey ? { headers: { authorization: `Bearer ${apiKey}` } } : undefined;

  const local = opts.makeLocal ? opts.makeLocal() : new StdioServerTransport();
  const remote = opts.makeRemote ? opts.makeRemote(url, requestInit) : new StreamableHTTPClientTransport(url, { requestInit });

  local.onmessage = (msg) => {
    remote.send(msg).catch((err) => {
      onError('remote send', err);
      // A failed request (revoked key, quota, outage) still gets an answer, so the client never waits forever.
      if (msg && 'method' in msg && 'id' in msg) {
        local.send({ jsonrpc: '2.0', id: msg.id,
          error: { code: -32603, message: `Aigora MCP ${failure(err)}` } })
          .catch((sendErr) => onError('local send', sendErr));
      }
    });
  };
  remote.onmessage = (msg) => {
    local.send(msg).catch((err) => onError('local send', err));
  };
  local.onerror = (err) => onError('stdio', err);
  remote.onerror = (err) => onError('http', err);

  // `closed` resolves when the LOCAL client hangs up (stdio EOF) — the CLI awaits it so the npx
  // process lives exactly as long as the editor-side MCP session does.
  let resolveClosed;
  const closed = new Promise((r) => { resolveClosed = r; });
  local.onclose = () => {
    remote.close().catch(() => {});
    resolveClosed();
  };

  try {
    await remote.start();
    await local.start();
  } catch (error) {
    throw new Error(`Could not start the Aigora MCP bridge: ${failure(error)}`);
  }
  // The SDK stdio transport ignores stdin EOF; close on it so `run` settles and exits 0.
  if (!opts.makeLocal) process.stdin.once('end', () => { local.close().catch(() => {}); });
  return {
    closed,
    close: async () => {
      await Promise.allSettled([local.close(), remote.close()]);
      resolveClosed();
    },
  };
}
