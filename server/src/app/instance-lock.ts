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
 * (Windows recycles PIDs), so the owner counts as running in this order:
 *   1. the PID is not alive (`process.kill(pid, 0)`; `EPERM` counts as alive) -> not running;
 *   2. `runtime.json` exists, records the owner PID and that instance answers `/api/health` with `version`
 *      and `instanceId` -> running. The boot check deliberately does not apply here: a running, answering
 *      owner is running even when a forward wall-clock step (time sync, DST on FAT32) moved its lock
 *      mtime before the computed boot time. The probe is skipped when `runtime.json` is missing or its PID
 *      does not match, so the step costs no time for an unrelated or absent runtime;
 *   3. the lock was written after the last OS boot (`mtimeMs > now - uptime*1000 - 5000`) and is younger
 *      than 30 s -> running, because the owner is still starting;
 *   4. otherwise -> not running.
 * The health probe retries a few times, each with a short timeout, so a momentarily stalled owner is not
 * declared dead. Compare wall-clock times only to wall-clock times: `now` and the lock mtime are wall
 * clock, `uptime` is not. The time sources and the PID probe are injectable so tests stay deterministic.
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
    // 2. A matching, answering runtime.json proves the owner is running, regardless of the boot check.
    let record: { pid?: unknown; port?: unknown } | null = null;
    try {
      const parsed = JSON.parse(await readFile(paths.runtime, 'utf8')) as { pid?: unknown; port?: unknown };
      if (parsed !== null && typeof parsed === 'object' && parsed.pid === ownerPid && typeof parsed.port === 'number') {
        record = parsed;
      }
    } catch {
      // A missing or unreadable runtime.json is not proof of anything: fall through to the boot check.
    }
    if (record !== null) {
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
    }
    // 3. The lock proves its owner is starting only when it was written after boot and is still young.
    const current = now();
    if (mtimeMs > current - uptimeS() * 1000 - BOOT_SLACK_MS && mtimeMs > current - STARTUP_GRACE_MS) return true;
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
