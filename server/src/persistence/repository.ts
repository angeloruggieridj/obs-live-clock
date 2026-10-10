// SPDX-License-Identifier: GPL-2.0-or-later
import { readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { z } from 'zod';
import { isNotFound, readJson, writeJsonAtomic } from './json-file';

const SAFE_ID = /^[a-z0-9][a-z0-9._-]{0,99}$/;
const RESERVED_ID = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\.|$)/;

export class InvalidIdError extends Error {
  constructor(readonly id: string) {
    super(`Invalid document id "${id}"`);
    this.name = 'InvalidIdError';
  }
}

export interface InvalidDocument {
  file: string;
  error: string;
}

/** One JSON file per document, named `<id>.json`, in a single directory. */
export class DocumentRepository<T extends { id: string }> {
  constructor(
    private readonly dir: string,
    private readonly schema: z.ZodType<T>,
    private readonly onInvalid: (doc: InvalidDocument) => void = () => {},
  ) {}

  private file(id: string): string {
    if (!SAFE_ID.test(id) || id.includes('..') || RESERVED_ID.test(id)) throw new InvalidIdError(id);
    return join(this.dir, `${id}.json`);
  }

  async list(): Promise<T[]> {
    let names: string[];
    try {
      names = await readdir(this.dir);
    } catch (err) {
      if (isNotFound(err)) return [];
      throw err;
    }
    const docs: T[] = [];
    for (const name of names.filter((n) => n.endsWith('.json')).sort()) {
      try {
        const doc = await readJson(join(this.dir, name), this.schema);
        if (doc !== undefined) docs.push(doc);
      } catch (err) {
        this.onInvalid({ file: name, error: err instanceof Error ? err.message : String(err) });
      }
    }
    return docs;
  }

  async get(id: string): Promise<T | undefined> {
    return readJson(this.file(id), this.schema);
  }

  async put(doc: T): Promise<T> {
    const parsed = this.schema.parse(doc);
    await writeJsonAtomic(this.file(parsed.id), parsed);
    return parsed;
  }

  async delete(id: string): Promise<boolean> {
    try {
      await rm(this.file(id));
      return true;
    } catch (err) {
      if (isNotFound(err)) return false;
      throw err;
    }
  }
}
