// SPDX-License-Identifier: GPL-2.0-or-later
import { rm } from 'node:fs/promises';
import type { LiveState } from '../engine/index';
import { isNotFound, readJsonFile, writeJsonAtomic } from './json-file';

export interface LiveSnapshot {
  schemaVersion: 1;
  episodeId: string;
  wallAt: number;
  state: LiveState;
}

function isLiveSnapshot(data: unknown): data is LiveSnapshot {
  if (typeof data !== 'object' || data === null) return false;
  const d = data as Record<string, unknown>;
  return d.schemaVersion === 1 && typeof d.episodeId === 'string' && typeof d.state === 'object' && d.state !== null;
}

/** The live state of the loaded episode, rewritten atomically after every change (resume after restart). */
export class SnapshotStore {
  constructor(readonly path: string) {}

  save(snapshot: LiveSnapshot): Promise<void> {
    return writeJsonAtomic(this.path, snapshot);
  }

  async load(): Promise<LiveSnapshot | undefined> {
    const data = await readJsonFile(this.path);
    if (data === undefined) return undefined;
    if (!isLiveSnapshot(data)) throw new Error(`Unrecognised live snapshot at ${this.path}`);
    return data;
  }

  async clear(): Promise<void> {
    try {
      await rm(this.path);
    } catch (err) {
      if (!isNotFound(err)) throw err;
    }
  }
}
