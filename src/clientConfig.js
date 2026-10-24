// Canonical client-install contract. The CLI installer, snippets, release verifier and docs parity
// gate all derive from these values. The web app mirrors the snippets because it is a standalone build;
// scripts/verify-release.mjs detects drift before an npm artifact can be accepted.

export const PACKAGE_RUN_ARGS = ['@aigora/mcp@latest', 'run'];
export const SERVER_ENTRY = Object.freeze({
  command: 'npx',
  args: PACKAGE_RUN_ARGS,
});
export const CLIENTS = Object.freeze(['claude-code', 'cursor', 'claude-desktop']);

export const INIT_COMMANDS = Object.freeze(
  Object.fromEntries(CLIENTS.map((client) => [
    client,
    `npx @aigora/mcp@latest init --client=${client}`,
  ])),
);

export const RUN_COMMAND = 'npx @aigora/mcp@latest run';
