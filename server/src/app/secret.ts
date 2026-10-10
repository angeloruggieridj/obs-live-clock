// SPDX-License-Identifier: GPL-2.0-or-later
import { randomBytes } from 'node:crypto';
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { isNotFound } from '../persistence/json-file';

const TOKEN = /^[0-9a-f]{64}$/;

/** DT-5 shared secret between plugin and app. Created once, owner-only on POSIX. */
export async function ensureSecretToken(path: string): Promise<string> {
  try {
    const existing = (await readFile(path, 'utf8')).trim();
    if (TOKEN.test(existing)) return existing;
  } catch (err) {
    if (!isNotFound(err)) throw err;
  }
  await mkdir(dirname(path), { recursive: true });
  const token = randomBytes(32).toString('hex');
  await writeFile(path, token, { mode: 0o600 });
  await chmod(path, 0o600);
  return token;
}
