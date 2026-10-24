#!/usr/bin/env node
// `npx @aigora/mcp …` entry — thin shell over the generated single-file release bundle.
const bundleUrl = new URL('../dist/cli.js', import.meta.url);
const { execute, parseArgs } = await import(bundleUrl.href);

const code = await execute(parseArgs(process.argv.slice(2)));
// `run` resolves when the bridge closes (client hung up) — exiting then is correct for npx lifetimes.
process.exit(code);
