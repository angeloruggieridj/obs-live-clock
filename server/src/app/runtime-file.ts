// SPDX-License-Identifier: GPL-2.0-or-later
import { readFile, rm } from 'node:fs/promises';
import { writeJsonAtomic } from '../persistence/json-file';

/**
 * runtime.json: how the OBS plugin finds a running app (TECH-DESIGN R7). A HINT, never the truth: the plugin
 * confirms it with GET /api/health, and a file left behind by a crash is harmless (nothing answers, the plugin
 * launches the app, the new instance rewrites the file). `port`, `pid` and `instanceId` are read by the
 * single-instance check (instance-lock.ts) and by plugin/core/Paths.cpp: do not rename them.
 */
export interface RuntimeInfo {
  port: number;
  pid: number;
  instanceId: string;
  version: string;
  protocol: number;
}

export function writeRuntimeFile(path: string, info: RuntimeInfo): Promise<void> {
  return writeJsonAtomic(path, info);
}

/** Removes the file on a clean shutdown, but only if it still names THIS instance (never another one's). */
export async function removeRuntimeFile(path: string, instanceId: string): Promise<void> {
  try {
    const current = JSON.parse(await readFile(path, 'utf8')) as { instanceId?: unknown };
    if (current.instanceId !== instanceId) return;
    await rm(path, { force: true });
  } catch {
    // missing or unreadable: nothing to remove
  }
}
