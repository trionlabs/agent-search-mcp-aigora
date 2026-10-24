import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { promisify } from 'node:util';
import { mkdir, open, readFile, rename, rm } from 'node:fs/promises';
import { dirname, join, win32 } from 'node:path';
import { platform } from 'node:os';
import { SERVER_ENTRY } from './clientConfig.js';

/** Resolve the canonical config file + root key for a supported MCP client. */
export function initTarget(client, env = process.env, os = platform()) {
  const home = env.HOME || env.USERPROFILE;
  if (!home) return { ok: false, error: 'home_not_found' };

  if (client === 'claude-code') {
    return { ok: true, path: join(home, '.claude.json'), rootKey: 'mcpServers' };
  }
  if (client === 'cursor') {
    return { ok: true, path: join(home, '.cursor', 'mcp.json'), rootKey: 'mcpServers' };
  }
  if (client === 'claude-desktop') {
    const path =
      os === 'darwin'
        ? join(home, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json')
        : os === 'win32'
          ? join(env.APPDATA || join(home, 'AppData', 'Roaming'), 'Claude', 'claude_desktop_config.json')
          : join(home, '.config', 'Claude', 'claude_desktop_config.json');
    return { ok: true, path, rootKey: 'mcpServers' };
  }
  return { ok: false, error: 'unknown_client' };
}

/**
 * Windows ignores 0600: give the still-empty file an owner-only ACL (no inherited entries) before any secret lands.
 * @param {string} path
 * @param {NodeJS.ProcessEnv} env
 * @param {(file: string, args: string[]) => Promise<unknown>} [exec]
 */
export async function restrictToOwnerOnWindows(path, env, exec = promisify(execFile)) {
  if (!env.USERNAME) throw new Error('Cannot restrict the config file to the current Windows user: USERNAME is unset');
  const user = env.USERDOMAIN ? `${env.USERDOMAIN}\\${env.USERNAME}` : env.USERNAME;
  const systemRoot = env.SystemRoot || process.env.SystemRoot;
  if (!systemRoot) throw new Error('Cannot restrict the config file to the current Windows user: SystemRoot is unset');
  await exec(win32.join(systemRoot, 'System32', 'icacls.exe'), [path, '/inheritance:r', '/grant:r', `${user}:F`]);
}

async function readJson(path) {
  try {
    const raw = await readFile(path, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') throw new Error('config root must be an object');
    return parsed;
  } catch (error) {
    if (/** @type {NodeJS.ErrnoException} */ (error).code === 'ENOENT') return {};
    if (error instanceof SyntaxError) throw new Error(`Refusing to overwrite invalid JSON at ${path}`);
    throw error;
  }
}

/** Merge only the `aigora` server entry and atomically replace the client config. */
export async function installClientConfig(client, opts = {}) {
  const target = initTarget(client, opts.env, opts.platform);
  if (!target.ok) return target;

  const config = await readJson(target.path);
  const current = config[target.rootKey];
  if (current != null && (Array.isArray(current) || typeof current !== 'object')) {
    throw new Error(`Refusing to replace non-object ${target.rootKey} in ${target.path}`);
  }
  // Every client keeps a user-added aigora.env (an optional key or URL override) and refuses malformed maps.
  if (current === null) throw new Error(`Refusing to replace non-object ${target.rootKey} in ${target.path}`);
  const existing = current?.aigora;
  if (existing !== undefined && (!existing || Array.isArray(existing) || typeof existing !== 'object')) {
    throw new Error(`Refusing to replace non-object aigora in ${target.path}`);
  }
  const userEnv = existing?.env;
  if (userEnv !== undefined && (!userEnv || Array.isArray(userEnv) || typeof userEnv !== 'object')) {
    throw new Error(`Refusing to replace non-object aigora.env in ${target.path}`);
  }
  const entry = { ...SERVER_ENTRY, ...(userEnv === undefined ? {} : { env: userEnv }) };
  const next = {
    ...config,
    [target.rootKey]: { ...(current || {}), aigora: entry },
  };

  await mkdir(dirname(target.path), { recursive: true });
  // An unpredictable name created exclusively: a file or symlink planted in a shared directory is never written through.
  const temp = `${target.path}.aigora-tmp-${randomBytes(8).toString('hex')}`;
  const os = opts.platform ?? platform();
  const restrictToOwner = opts.restrictToOwner
    ?? (os === 'win32' ? (path) => restrictToOwnerOnWindows(path, opts.env ?? process.env) : null);
  const file = await open(temp, 'wx', 0o600);
  try {
    if (restrictToOwner) await restrictToOwner(temp);
    await file.writeFile(`${JSON.stringify(next, null, 2)}\n`, 'utf8');
    await file.close();
    await rename(temp, target.path);
  } catch (error) {
    await file.close().catch(() => {});
    await rm(temp, { force: true });
    throw error;
  }
  return { ok: true, path: target.path };
}
