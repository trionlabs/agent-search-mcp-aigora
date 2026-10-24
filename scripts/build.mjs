import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(PACKAGE_ROOT, 'dist');
const BUNDLED_PACKAGES = [
  '@modelcontextprotocol/sdk',
  'content-type',
  'eventsource-parser',
  'pkce-challenge',
  'zod',
];
await mkdir(DIST, { recursive: true });
const result = await build({
  entryPoints: [join(PACKAGE_ROOT, 'src', 'cli.js')],
  outfile: join(DIST, 'cli.js'),
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node24',
  minify: true,
  legalComments: 'eof',
  metafile: true,
});

const actualPackages = new Set();
for (const input of Object.keys(result.metafile.inputs)) {
  const marker = 'node_modules/';
  const at = input.lastIndexOf(marker);
  if (at < 0) continue;
  const parts = input.slice(at + marker.length).split('/');
  actualPackages.add(parts[0].startsWith('@') ? `${parts[0]}/${parts[1]}` : parts[0]);
}
const actual = [...actualPackages].sort();
const expected = [...BUNDLED_PACKAGES].sort();
if (JSON.stringify(actual) !== JSON.stringify(expected)) {
  throw new Error(`bundled dependency set changed: expected ${expected.join(', ')}, got ${actual.join(', ')}`);
}

const notices = [
  'Aigora MCP — bundled third-party license notices',
  '',
  ...await Promise.all(BUNDLED_PACKAGES.map(async (name) => {
    const { packageDir, packageJson } = await findPackage(name);
    const licensePath = join(packageDir, 'LICENSE');
    const license = await readFile(licensePath, 'utf8');
    const version = packageJson.version;
    return [
      '='.repeat(80),
      `${name}@${version}`,
      '='.repeat(80),
      license.trim(),
      '',
    ].join('\n');
  })),
].join('\n');
await writeFile(join(DIST, 'THIRD_PARTY_LICENSES.txt'), notices, 'utf8');

async function findPackage(name) {
  let packageDir = dirname(fileURLToPath(import.meta.resolve(name)));
  while (true) {
    const candidate = join(packageDir, 'package.json');
    try {
      const packageJson = JSON.parse(await readFile(candidate, 'utf8'));
      if (packageJson.name === name) return { packageDir, packageJson };
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
    const parent = dirname(packageDir);
    if (parent === packageDir) throw new Error(`package root not found: ${name}`);
    packageDir = parent;
  }
}
