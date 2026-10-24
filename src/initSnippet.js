// Per-client install snippets behind `npx @aigora/mcp init --client=…`.
// Pure snippet descriptions used by the installer and documentation. `init` merges the matching entry
// into the client's config file; the filesystem operation lives in initConfig.js.

import { CLIENTS, SERVER_ENTRY } from './clientConfig.js';

export { CLIENTS };

/**
 * Build the install snippet for a client. Returns { ok:true, client, target, snippet } or
 * { ok:false, error, clients } for an unknown client.
 * @param {string} client
 */
export function initSnippet(client) {
  switch ((client ?? '').trim()) {
    case 'claude-code':
      return {
        ok: true,
        client: 'claude-code',
        target: 'run this in your project (writes .mcp.json / user scope per the flag you choose)',
        snippet: 'claude mcp add aigora -- npx @aigora/mcp@latest run',
      };
    case 'cursor':
      return {
        ok: true,
        client: 'cursor',
        target: '~/.cursor/mcp.json (or .cursor/mcp.json in your project)',
        snippet: JSON.stringify({ mcpServers: { aigora: SERVER_ENTRY } }, null, 2),
      };
    case 'claude-desktop':
      return {
        ok: true,
        client: 'claude-desktop',
        target: 'claude_desktop_config.json (Claude Desktop → Settings → Developer → Edit Config)',
        snippet: JSON.stringify({ mcpServers: { aigora: SERVER_ENTRY } }, null, 2),
      };
    default:
      return { ok: false, error: 'unknown_client', clients: CLIENTS };
  }
}
