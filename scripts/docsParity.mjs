import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { INIT_COMMANDS } from '../src/clientConfig.js';

const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** The README and docs must name the package's install command for every client. The aigora.org web snippets mirror
 * initSnippet byte for byte; that parity is checked in the Aigora monorepo against the published package. */
export async function verifyDocsParity() {
  const [readme, docs] = await Promise.all([
    readFile(join(PACKAGE_ROOT, 'README.md'), 'utf8'),
    readFile(join(PACKAGE_ROOT, 'docs', 'index.md'), 'utf8'),
  ]);
  for (const [client, command] of Object.entries(INIT_COMMANDS)) {
    if (!readme.includes(command)) throw new Error(`release verification failed: README ${client} command`);
    if (!docs.includes(command)) throw new Error(`release verification failed: docs ${client} command`);
  }
}
