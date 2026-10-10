// SPDX-License-Identifier: GPL-2.0-or-later
import { open, readFile, rename, rm, stat } from 'node:fs/promises';
import { uptime as osUptime } from 'node:os';
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

export interface AliveDeps {
  now?: () => number;
  uptimeS?: () => number;
  isPidAlive?: (pid: number) => boolean;
  fetchImpl?: typeof fetch;
}

/** How long a freshly written lock is trusted while its owner is still starting. */
const STARTUP_GRACE_MS = 30_000;
/** Tolerance for clock differences between the boot time and the lock's mtime. */
const BOOT_SLACK_MS = 5_000;
const HEALTH_ATTEMPTS = 3;
const HEALTH_TIMEOUT_MS = 1_500;
const HEALTH_RETRY_MS = 500;

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * A checker that asks the running instance itself whether it still owns the lock. A live PID is not proof
 * (Windows recycles PIDs), so the owner only counts as running when every one of these holds:
 *   1. the PID is alive (`process.kill(pid, 0)`; `EPERM` counts as alive);
 *   2. the lock was written after the last OS boot (a lock from before a reboot is stale even if its PID
 *      has been reused since);
 *   3. the lock is younger than 30 s (its owner is still starting), or `runtime.json` records the owner
 *      PID and that instance answers `/api/health` with `version` and `instanceId`.
 * The health probe retries a few times, each with a short timeout, so a momentarily stalled owner is not
 * declared dead. The time sources and the PID probe are injectable so tests stay deterministic.
 */
export function olcInstanceAlive(
  paths: DataPaths,
  lockPath: string,
  { now = Date.now, uptimeS = osUptime, isPidAlive = isProcessAlive, fetchImpl = fetch }: AliveDeps = {},
): (ownerPid: number) => Promise<boolean> {
  return async (ownerPid) => {
    if (!isPidAlive(ownerPid)) return false;
    let mtimeMs: number;
    try {
      mtimeMs = (await stat(lockPath)).mtimeMs;
    } catch {
      return false;
    }
    const current = now();
    if (mtimeMs <= current - uptimeS() * 1000 - BOOT_SLACK_MS) return false;
    if (mtimeMs > current - STARTUP_GRACE_MS) return true;
    let record: { pid?: unknown; port?: unknown };
    try {
      record = JSON.parse(await readFile(paths.runtime, 'utf8')) as { pid?: unknown; port?: unknown };
    } catch {
      return false;
    }
    if (record === null || typeof record !== 'object' || record.pid !== ownerPid || typeof record.port !== 'number') {
      return false;
    }
    for (let attempt = 0; attempt < HEALTH_ATTEMPTS; attempt++) {
      if (attempt > 0) await delay(HEALTH_RETRY_MS);
      try {
        const res = await fetchImpl(`http://127.0.0.1:${record.port}/api/health`, {
          signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS),
        });
        if (!res.ok) continue;
        const body = (await res.json()) as Record<string, unknown>;
        if (body !== null && typeof body === 'object' && 'version' in body && 'instanceId' in body) return true;
      } catch {
        // A refused or timed-out attempt is not proof of death; try again until the attempts are exhausted.
      }
    }
    return false;
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
    let raw: string;
    try {
      raw = await readFile(path, 'utf8');
    } catch (readErr) {
      // The lock vanished between our failed create and this read: another starter is taking it over.
      if ((readErr as { code?: unknown }).code === 'ENOENT') throw new InstanceLockedError(0);
      throw readErr;
    }
    const trimmed = raw.trim();
    const parsed = Number(trimmed);
    // The lock only claims an owner when it holds a positive integer pid. An empty file (a power loss between
    // open('wx') and writeFile) or any other garbage is not a claim: it is stale and we take it over without
    // asking the checker.
    const claimsPid = /^\d+$/.test(trimmed) && Number.isSafeInteger(parsed) && parsed > 0;
    const owner = claimsPid ? parsed : 0;
    if (claimsPid && parsed !== pid && (await isRunningOwner(parsed))) {
      throw new InstanceLockedError(parsed);
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
        moved = await readFile(stale, 'utf8');
      } catch (readErr) {
        // The file we renamed vanished under us: another starter is taking over. Back off.
        if ((readErr as { code?: unknown }).code === 'ENOENT') throw new InstanceLockedError(owner);
        throw readErr;
      }
      if (moved !== raw) {
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
