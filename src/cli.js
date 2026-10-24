// The tiny `aigora-mcp` CLI — `run` starts the stdio⇄http bridge, `init` prints the
// per-client install snippet. Argument parsing is pure (makeCli) so tests drive it without a process.

import { CLIENTS, initSnippet } from './initSnippet.js';
import { installClientConfig } from './initConfig.js';
import { displayUrl, resolveUrl, startBridge } from './bridge.js';

const HELP = `@aigora/mcp — Aigora MCP client bridge

Usage:
  npx @aigora/mcp run [--url <mcp-url>]      stdio ⇄ streamable-http bridge (env: AIGORA_MCP_URL, AIGORA_API_KEY)
  npx @aigora/mcp init --client=<name>       safely merge client config (${CLIENTS.join(' | ')})
  npx @aigora/mcp help
`;

/** Parse argv (post-node, post-script) into a command descriptor. Pure. */
export function parseArgs(argv) {
  const [cmd, ...rest] = argv;
  if (!cmd || cmd === 'help' || cmd === '--help' || cmd === '-h') return { cmd: 'help' };
  if (cmd === 'run') {
    const i = rest.indexOf('--url');
    const eq = rest.find((a) => a.startsWith('--url='));
    const url = i >= 0 ? rest[i + 1] : eq ? eq.slice('--url='.length) : undefined;
    return { cmd: 'run', url };
  }
  if (cmd === 'init') {
    const eq = rest.find((a) => a.startsWith('--client='));
    const i = rest.indexOf('--client');
    const client = eq ? eq.slice('--client='.length) : i >= 0 ? rest[i + 1] : undefined;
    return { cmd: 'init', client };
  }
  return { cmd: 'unknown', given: cmd };
}

/**
 * Execute a parsed command. IO is injected (out/err/bridge) so tests assert behavior without a process.
 * Returns the intended exit code; `run` resolves only when the bridge closes.
 */
export async function execute(parsed, io = {}) {
  const out = io.out ?? ((s) => process.stdout.write(s + '\n'));
  const err = io.err ?? ((s) => process.stderr.write(s + '\n'));
  const bridge = io.bridge ?? startBridge;
  const install = io.install ?? installClientConfig;

  switch (parsed.cmd) {
    case 'help':
      out(HELP);
      return 0;
    case 'init': {
      const snip = initSnippet(parsed.client);
      if (!snip.ok) {
        err(`Unknown --client. Supported: ${snip.clients.join(', ')}`);
        return 2;
      }
      try {
        const result = await install(snip.client, { env: io.env ?? process.env, platform: io.platform });
        if (!result.ok) {
          err(`Could not install Aigora MCP: ${result.error}`);
          return 2;
        }
        out(`Aigora MCP installed for ${snip.client}: ${result.path}`);
        out('Quick test: ask your client to list Aigora MCP tools, then call find_agent with a short query.');
      } catch (error) {
        err(error instanceof Error ? error.message : String(error));
        return 2;
      }
      return 0;
    }
    case 'run': {
      // stdout belongs to the MCP protocol from here on — operator notes go to stderr.
      err(`[aigora-mcp] bridging stdio ⇄ ${displayUrl(resolveUrl(parsed.url, io.env ?? process.env))}`);
      let b;
      try {
        b = await bridge({ url: parsed.url, env: io.env });
      } catch (error) {
        // startBridge's messages are fixed; never let Node print the raw error and its properties.
        err(`[aigora-mcp] ${error instanceof Error ? error.message : String(error)}`);
        return 2;
      }
      await b.closed; // live until the editor-side client hangs up (stdio EOF)
      return 0;
    }
    default:
      err(`Unknown command "${parsed.given}".`);
      err(HELP);
      return 2;
  }
}
