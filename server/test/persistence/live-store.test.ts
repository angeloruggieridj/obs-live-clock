// SPDX-License-Identifier: GPL-2.0-or-later
import { appendFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { soloFutsalEpisode } from '@olc/shared/testing';
import { createLiveState } from '../../src/engine/index';
import { LiveJournal } from '../../src/persistence/journal';
import { SnapshotStore } from '../../src/persistence/snapshot-store';
import { tempDir } from '../support/tmp';

describe('LiveJournal', () => {
  it('appends entries in order with increasing seq', async () => {
    const j = new LiveJournal(join(await tempDir(), 'live', 'ep.log.jsonl'));
    await Promise.all([
      j.append({ type: 'SourceRestored', at: 1 }, 100),
      j.append({ type: 'Tick', at: 2 }, 200),
      j.append({ type: 'SourceLost', at: 3 }, 300),
    ]);
    expect((await j.readAll()).map((e) => [e.seq, e.input.type, e.wallAt])).toEqual([
      [1, 'SourceRestored', 100],
      [2, 'Tick', 200],
      [3, 'SourceLost', 300],
    ]);
  });

  it('continues the sequence after a restart', async () => {
    const path = join(await tempDir(), 'ep.log.jsonl');
    await new LiveJournal(path).append({ type: 'Tick', at: 1 }, 1);
    const second = new LiveJournal(path);
    await second.append({ type: 'Tick', at: 2 }, 2);
    expect((await second.readAll()).map((e) => e.seq)).toEqual([1, 2]);
  });

  it('skips a torn last line left by a crash', async () => {
    const path = join(await tempDir(), 'ep.log.jsonl');
    const j = new LiveJournal(path);
    await j.append({ type: 'Tick', at: 1 }, 1);
    await appendFile(path, '{"seq":2,"wallAt":2,"inp');
    expect(await j.readAll()).toHaveLength(1);
    await j.append({ type: 'Tick', at: 3 }, 3);
    expect((await j.readAll()).map((e) => e.seq)).toEqual([1, 2]);
  });

  it('is empty when the file does not exist', async () => {
    expect(await new LiveJournal(join(await tempDir(), 'none.jsonl')).readAll()).toEqual([]);
  });
});

describe('SnapshotStore', () => {
  it('saves, loads and clears the live snapshot', async () => {
    const store = new SnapshotStore(join(await tempDir(), 'live', 'snapshot.json'));
    expect(await store.load()).toBeUndefined();
    const state = createLiveState(soloFutsalEpisode());
    await store.save({ schemaVersion: 1, episodeId: state.episode.id, wallAt: 42, state });
    const loaded = await store.load();
    expect(loaded?.episodeId).toBe('ep-2026-10-12');
    expect(loaded?.state).toEqual(state);
    await store.clear();
    await store.clear();
    expect(await store.load()).toBeUndefined();
  });

  it('throws on unrecognised content', async () => {
    const path = join(await tempDir(), 'snapshot.json');
    await writeFile(path, JSON.stringify({ schemaVersion: 99 }));
    await expect(new SnapshotStore(path).load()).rejects.toThrow(/Unrecognised live snapshot/);
  });
});
