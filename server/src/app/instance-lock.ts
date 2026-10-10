// SPDX-License-Identifier: GPL-2.0-or-later
import { open, readFile, rename, rm } from 'node:fs/promises';
import { isNotFound } from '../persistence/json-file';
import type { DataPaths } from './paths';

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

/**
 * A checker that asks the running instance itself whether it still owns the lock. The lock file only
 * records a PID, and Windows recycles PIDs, so a live PID is not proof of a live instance. Instead read
 * `runtime.json` (written once the server is listening) and only trust a matching PID when that instance
 * answers on its port. Use `AbortSignal.timeout` so a hung instance cannot block startup forever.
 */
export function olcInstanceAlive(paths: DataPaths): (ownerPid: number) => Promise<boolean> {
  return async (ownerPid) => {
    let record: { pid?: unknown; port?: unknown };
    try {
      record = JSON.parse(await readFile(paths.runtime, 'utf8')) as { pid?: unknown; port?: unknown };
    } catch {
      return false;
    }
    if (record === null || typeof record !== 'object' || record.pid !== ownerPid || typeof record.port !== 'number') {
      return false;
    }
    try {
      const res = await fetch(`http://127.0.0.1:${record.port}/api/health`, { signal: AbortSignal.timeout(1_500) });
      if (!res.ok) return false;
      const body = (await res.json()) as Record<string, unknown>;
      return body !== null && typeof body === 'object' && 'version' in body && 'instanceId' in body;
    } catch {
      return false;
    }
  };
}

async function createLockFile(path: string, pid: number): Promise<void> {
  const handle = await open(path, 'wx');
  try {
    await handle.writeFile(String(pid));
  } finally {
    await handle.close();
  }
}

/** One app instance per data directory. Returns a release function. */
export async function acquireLock(
  path: string,
  pid: number = process.pid,
  isRunningOwner: (ownerPid: number) => Promise<boolean> = async () => false,
): Promise<() => Promise<void>> {
  try {
    await createLockFile(path, pid);
  } catch (err) {
    if ((err as { code?: unknown }).code !== 'EEXIST') throw err;
    let owner: number;
    try {
      owner = Number.parseInt((await readFile(path, 'utf8')).trim(), 10);
    } catch (readErr) {
      // The lock vanished between our failed create and this read: another starter is taking it over.
      if ((readErr as { code?: unknown }).code === 'ENOENT') throw new InstanceLockedError(0);
      throw readErr;
    }
    if (Number.isInteger(owner) && owner !== pid && (await isRunningOwner(owner))) {
      throw new InstanceLockedError(owner);
    }
    // The owner is not running: take over. Rename the stale file away first: `rename` is atomic, so of two
    // concurrent starters only one moves that exact file. The move is then verified: if the file we moved no
    // longer holds the stale owner we read (another starter already replaced it), we put it back and refuse.
    // The loser falls through to `open(..., 'wx')`, which fails EEXIST once the winner has created the lock.
    const stale = `${path}.stale.${pid}`;
    let renamed = false;
    try {
      await rename(path, stale);
      renamed = true;
    } catch (renameErr) {
      if ((renameErr as { code?: unknown }).code !== 'ENOENT') throw renameErr;
    }
    if (renamed) {
      let moved: string;
      try {
        moved = (await readFile(stale, 'utf8')).trim();
      } catch (readErr) {
        // The file we renamed vanished under us: another starter is taking over. Back off.
        if ((readErr as { code?: unknown }).code === 'ENOENT') throw new InstanceLockedError(owner);
        throw readErr;
      }
      if (moved !== String(owner)) {
        // We grabbed a newer lock: restore it and back off instead of stealing it.
        try {
          await rename(stale, path);
        } catch {
          // Someone recreated the lock meanwhile; the refusal below is still correct.
        }
        throw new InstanceLockedError(owner);
      }
      await rm(stale, { force: true });
    }
    try {
      await createLockFile(path, pid);
    } catch (retryErr) {
      if ((retryErr as { code?: unknown }).code === 'EEXIST') throw new InstanceLockedError(owner);
      throw retryErr;
    }
  }
  return async () => {
    try {
      if ((await readFile(path, 'utf8')).trim() === String(pid)) await rm(path);
    } catch (err) {
      if (!isNotFound(err)) throw err;
    }
  };
}
