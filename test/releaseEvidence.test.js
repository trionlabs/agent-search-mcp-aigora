import { readFile } from 'node:fs/promises';
import { expect, it } from 'vitest';
import { DEFAULT_MCP_URL } from '../src/bridge.js';

const read = async (path) => JSON.parse(await readFile(new URL(path, import.meta.url), 'utf8'));

// A published version freezes its default authority. The release evidence records it, so a
// later bridge.js change (custom domain, recreated service) fails here instead of silently diverging from npm.
it('the release evidence binds the published default MCP URL', async () => {
  const { version } = await read('../package.json');
  const evidence = await read(`../release/${version}.json`);
  expect(evidence.default_mcp_url).toBe(DEFAULT_MCP_URL);
});
