// SPDX-License-Identifier: GPL-2.0-or-later
import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { promisify } from 'node:util';
import { isNotFound } from '../persistence/json-file';

const TOKEN = /^[0-9a-f]{64}$/;
const execFileAsync = promisify(execFile);

export interface EnsureSecretTokenOptions {
  /** Platform selector, injectable so the Windows branch is testable off Windows. Defaults to `process.platform`. */
  platform?: NodeJS.Platform;
  /** ACL restriction runner, injectable so tests never shell out to `icacls`. Defaults to the real one on Windows. */
  restrictAcl?: (path: string) => Promise<void>;
}

export interface SecretToken {
  token: string;
  /** Set when the Windows ACL could not be applied; the token is still valid and this is never fatal. */
  aclWarning?: string;
}

/** The real Windows ACL restriction: strip inheritance and grant only the current user full control. */
function defaultRestrictAcl(path: string): Promise<void> {
  return execFileAsync('icacls', [path, '/inheritance:r', '/grant:r', `${process.env.USERNAME}:F`]).then(() => undefined);
}

async function createToken(path: string): Promise<string> {
  await mkdir(dirname(path), { recursive: true });
  const token = randomBytes(32).toString('hex');
  await writeFile(path, token, { mode: 0o600 });
  await chmod(path, 0o600);
  return token;
}

/**
 * DT-5 shared secret between plugin and app. Created once, owner-only on POSIX.
 * On Windows the file ACL is restricted best-effort: a failure is reported as `aclWarning` and never fatal.
 */
export async function ensureSecretToken(
  path: string,
  options: EnsureSecretTokenOptions = {},
): Promise<SecretToken> {
  const platform = options.platform ?? process.platform;
  const restrictAcl = options.restrictAcl ?? defaultRestrictAcl;
  let token: string;
  try {
    const existing = (await readFile(path, 'utf8')).trim();
    token = TOKEN.test(existing) ? existing : await createToken(path);
  } catch (err) {
    if (!isNotFound(err)) throw err;
    token = await createToken(path);
  }
  if (platform === 'win32') {
    try {
      await restrictAcl(path);
    } catch (err) {
      return { token, aclWarning: err instanceof Error ? err.message : String(err) };
    }
  }
  return { token };
}
