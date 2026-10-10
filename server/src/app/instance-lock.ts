// SPDX-License-Identifier: GPL-2.0-or-later
import { open, readFile, rm, writeFile } from 'node:fs/promises';
import { isNotFound } from '../persistence/json-file';

export class InstanceLockedError extends Error {
  constructor(readonly pid: number) {
    super(`OBS Live Clock is already running (pid ${pid})`);
    this.name = 'InstanceLockedError';
  }
}

export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as { code?: unknown }).code === 'EPERM';
  }
}

/** One app instance per data directory. Returns a release function. */
export async function acquireLock(
  path: string,
  pid: number = process.pid,
  isAlive: (pid: number) => boolean = isProcessAlive,
): Promise<() => Promise<void>> {
  try {
    const handle = await open(path, 'wx');
    try {
      await handle.writeFile(String(pid));
    } finally {
      await handle.close();
    }
  } catch (err) {
    if ((err as { code?: unknown }).code !== 'EEXIST') throw err;
    const owner = Number.parseInt((await readFile(path, 'utf8')).trim(), 10);
    if (Number.isInteger(owner) && owner !== pid && isAlive(owner)) throw new InstanceLockedError(owner);
    await writeFile(path, String(pid));
  }
  return async () => {
    try {
      if ((await readFile(path, 'utf8')).trim() === String(pid)) await rm(path);
    } catch (err) {
      if (!isNotFound(err)) throw err;
    }
  };
}
