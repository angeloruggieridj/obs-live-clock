// SPDX-License-Identifier: GPL-2.0-or-later
import { appendFileSync } from 'node:fs';
import { appendFile, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LiveJournal } from '../../src/persistence/journal';
import { tempDir } from '../support/tmp';

// Wrap the real `readFile`/`appendFile` so how often the journal reads, and whether a write fails, is
// observable without changing the journal's behaviour.
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return { ...actual, readFile: vi.fn(actual.readFile), appendFile: vi.fn(actual.appendFile) };
});

const reads = () => vi.mocked(readFile).mock.calls.length;

describe('LiveJournal read amplification', () => {
  beforeEach(() => {
    vi.mocked(readFile).mockClear();
    vi.mocked(appendFile).mockClear();
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

describe('LiveJournal failed appends', () => {
  beforeEach(() => {
    vi.mocked(readFile).mockClear();
    vi.mocked(appendFile).mockClear();
  });

  it('re-primes after a failed append: the next append has no seq gap and starts on a fresh line', async () => {
    const path = join(await tempDir(), 'live', 'ep.log.jsonl');
    const j = new LiveJournal(path);
    await j.append({ type: 'Tick', at: 1 }, 1);

    vi.mocked(appendFile).mockRejectedValueOnce(new Error('disk full'));
    await expect(j.append({ type: 'Tick', at: 2 }, 2)).rejects.toThrow('disk full');
    await j.append({ type: 'Tick', at: 3 }, 3);

    const entries = await j.readAll();
    expect(entries.map((e) => [e.seq, e.input.at])).toEqual([
      [1, 1],
      [2, 3],
    ]);
    const raw = await readFile(path, 'utf8');
    expect(raw.endsWith('\n')).toBe(true);
    expect(raw.split('\n').filter((line) => line !== '')).toHaveLength(2);
  });

  it('does not glue onto a torn tail left by a failed append', async () => {
    const path = join(await tempDir(), 'live', 'ep.log.jsonl');
    const j = new LiveJournal(path);
    await j.append({ type: 'Tick', at: 1 }, 1);

    // A partial write: the seq-2 line lands on disk torn (no trailing newline) and then the write fails.
    vi.mocked(appendFile).mockImplementationOnce(async () => {
      appendFileSync(path, '{"seq":2,"wallAt":2,"inp');
      throw new Error('disk full');
    });
    await expect(j.append({ type: 'Tick', at: 2 }, 2)).rejects.toThrow('disk full');
    await j.append({ type: 'Tick', at: 3 }, 3);

    const entries = await j.readAll();
    // The torn prefix is skipped, and the recovered append continues from the file on a fresh line.
    expect(entries.map((e) => [e.seq, e.input.at])).toEqual([
      [1, 1],
      [2, 3],
    ]);
    expect(await readFile(path, 'utf8')).toContain('\n{"seq":2');
  });

  it('readAll racing an in-flight append does not lower the sequence (no duplicate seq)', async () => {
    const path = join(await tempDir(), 'live', 'ep.log.jsonl');
    const j = new LiveJournal(path);
    await j.append({ type: 'Tick', at: 1 }, 1);

    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let held = false;
    vi.mocked(appendFile).mockImplementationOnce(async () => {
      held = true;
      await gate;
      appendFileSync(path, '{"seq":2,"wallAt":2,"input":{"type":"Tick","at":2}}\n');
    });

    const inFlight = j.append({ type: 'Tick', at: 2 }, 2);
    // Yield to the event loop (mkdir/write are real I/O) until the append is parked on the gate.
    for (let i = 0; i < 1_000 && !held; i++) await new Promise((resolve) => setTimeout(resolve, 0));
    expect(held).toBe(true);

    const read = j.readAll();
    // Let a racing (unchained) read settle against the file before the append is allowed to land. A chained
    // read is still parked behind the append, so this loop simply runs out its bound.
    let settled = false;
    void read.then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      },
    );
    for (let i = 0; i < 50 && !settled; i++) await new Promise((resolve) => setTimeout(resolve, 0));

    release();
    await inFlight;
    expect(await read).toHaveLength(2);

    await j.append({ type: 'Tick', at: 3 }, 3);
    const seqs = (await j.readAll()).map((e) => e.seq);
    expect(seqs).toEqual([1, 2, 3]);
    expect(new Set(seqs).size).toBe(3);
  });
});
