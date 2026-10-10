// SPDX-License-Identifier: GPL-2.0-or-later
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LiveJournal } from '../../src/persistence/journal';
import { tempDir } from '../support/tmp';

// Wrap the real `readFile` so how often the journal reads is observable without changing its behaviour.
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return { ...actual, readFile: vi.fn(actual.readFile) };
});

const reads = () => vi.mocked(readFile).mock.calls.length;

describe('LiveJournal read amplification', () => {
  beforeEach(() => {
    vi.mocked(readFile).mockClear();
  });

  it('reads the file exactly once for 100 appends', async () => {
    const path = join(await tempDir(), 'live', 'ep.log.jsonl');
    const j = new LiveJournal(path);
    for (let i = 0; i < 100; i++) await j.append({ type: 'Tick', at: i }, i);
    expect(reads()).toBe(1);
    expect((await j.readAll()).map((e) => e.seq)).toEqual(Array.from({ length: 100 }, (_, i) => i + 1));
  });

  it('prefixes the first append with a newline when the file ends mid-line', async () => {
    const path = join(await tempDir(), 'ep.log.jsonl');
    await writeFile(path, '{"seq":1,"wallAt":1,"input":{"type":"Tick","at":1}}');
    const j = new LiveJournal(path);
    await j.append({ type: 'Tick', at: 2 }, 2);
    expect((await j.readAll()).map((e) => e.seq)).toEqual([1, 2]);
  });
});
