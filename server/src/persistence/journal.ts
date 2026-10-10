// SPDX-License-Identifier: GPL-2.0-or-later
import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { EngineInput } from '../engine/index';
import { isNotFound } from './json-file';

export interface JournalEntry {
  seq: number;
  wallAt: number;
  input: EngineInput;
}

/** Append-only JSONL log of every accepted engine input for one episode (DT-6). */
export class LiveJournal {
  private seq: number | null = null;
  private chain: Promise<void> = Promise.resolve();

  constructor(readonly path: string) {}

  append(input: EngineInput, wallAt: number): Promise<void> {
    const next = this.chain
      .catch(() => undefined)
      .then(async () => {
        const raw = await this.readRaw();
        if (this.seq === null) this.seq = parseEntries(raw).reduce((max, e) => Math.max(max, e.seq), 0);
        this.seq += 1;
        const lead = raw.length > 0 && !raw.endsWith('\n') ? '\n' : '';
        await mkdir(dirname(this.path), { recursive: true });
        await appendFile(this.path, `${lead}${JSON.stringify({ seq: this.seq, wallAt, input })}\n`, 'utf8');
      });
    this.chain = next;
    return next;
  }

  async readAll(): Promise<JournalEntry[]> {
    return parseEntries(await this.readRaw());
  }

  private async readRaw(): Promise<string> {
    try {
      return await readFile(this.path, 'utf8');
    } catch (err) {
      if (isNotFound(err)) return '';
      throw err;
    }
  }
}

function parseEntries(raw: string): JournalEntry[] {
  const entries: JournalEntry[] = [];
  for (const line of raw.split('\n')) {
    if (line.trim() === '') continue;
    try {
      entries.push(JSON.parse(line) as JournalEntry);
    } catch {
      // A torn line left by a crash mid-append: skip it.
    }
  }
  return entries;
}
