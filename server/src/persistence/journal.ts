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
  /** Cleared until the first read seeds `seq`; afterwards appends never re-read the file. */
  private loaded = false;
  /** Whether the file currently ends with `\n` (a torn line does not). */
  private endsWithNewline = true;

  constructor(readonly path: string) {}

  append(input: EngineInput, wallAt: number): Promise<void> {
    const next = this.chain
      .catch(() => undefined)
      .then(async () => {
        if (!this.loaded) await this.prime();
        this.seq = (this.seq ?? 0) + 1;
        const lead = this.endsWithNewline ? '' : '\n';
        await mkdir(dirname(this.path), { recursive: true });
        await appendFile(this.path, `${lead}${JSON.stringify({ seq: this.seq, wallAt, input })}\n`, 'utf8');
        this.endsWithNewline = true;
      });
    this.chain = next;
    return next;
  }

  async readAll(): Promise<JournalEntry[]> {
    const raw = await this.readRaw();
    this.primeFrom(raw);
    return parseEntries(raw);
  }

  /** One read seeds the seq chain and the trailing-newline state; every later append reuses them. */
  private async prime(): Promise<void> {
    this.primeFrom(await this.readRaw());
  }

  private primeFrom(raw: string): void {
    this.seq = parseEntries(raw).reduce((max, e) => Math.max(max, e.seq), 0);
    this.endsWithNewline = raw.length === 0 || raw.endsWith('\n');
    this.loaded = true;
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
      const parsed = JSON.parse(line) as unknown;
      const entry = parsed as { seq?: unknown; input?: unknown };
      // A truncated write or a hand-edited file can leave valid JSON that is not an entry; keep the seq
      // chain honest by ignoring anything without an integer seq and an input object.
      if (parsed !== null && typeof parsed === 'object' && Number.isInteger(entry.seq) && typeof entry.input === 'object') {
        entries.push(parsed as JournalEntry);
      }
    } catch {
      // A torn line left by a crash mid-append: skip it.
    }
  }
  return entries;
}
