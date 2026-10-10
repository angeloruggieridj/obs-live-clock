// SPDX-License-Identifier: GPL-2.0-or-later
import { mkdir, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Format } from '@olc/shared';
import { soloFutsalFormat } from '@olc/shared/testing';
import { DocumentRepository, InvalidIdError } from '../../src/persistence/repository';
import { tempDir } from '../support/tmp';

async function repo() {
  const dir = join(await tempDir(), 'formats');
  const invalid: string[] = [];
  return { dir, invalid, repo: new DocumentRepository(dir, Format, (d) => invalid.push(d.file)) };
}

describe('DocumentRepository', () => {
  it('stores, reads, lists and deletes documents', async () => {
    const { repo: r } = await repo();
    expect(await r.list()).toEqual([]);
    const f = soloFutsalFormat();
    await r.put(f);
    await r.put({ ...soloFutsalFormat(), id: 'another', name: 'Another' });
    expect(await r.get('solo-futsal')).toEqual(f);
    expect((await r.list()).map((d) => d.id)).toEqual(['another', 'solo-futsal']);
    expect(await r.delete('another')).toBe(true);
    expect(await r.delete('another')).toBe(false);
    expect(await r.get('another')).toBeUndefined();
  });

  it('rejects unsafe ids before touching the filesystem', async () => {
    const { repo: r } = await repo();
    for (const id of ['../escape', 'a/b', 'a\\b', '..', '', '.hidden', 'x'.repeat(101)]) {
      await expect(r.get(id)).rejects.toBeInstanceOf(InvalidIdError);
    }
    await expect(r.put({ ...soloFutsalFormat(), id: '../escape' })).rejects.toThrow();
  });

  it('rejects documents that do not match the schema', async () => {
    const { repo: r } = await repo();
    await expect(r.put({ ...soloFutsalFormat(), blocks: 'nope' } as never)).rejects.toThrow();
  });

  it('skips corrupt documents when listing and reports them', async () => {
    const { repo: r, dir, invalid } = await repo();
    await r.put(soloFutsalFormat());
    await writeFile(join(dir, 'broken.json'), '{ not json');
    await writeFile(join(dir, 'foreign.json'), JSON.stringify({ hello: 'world' }));
    expect((await r.list()).map((d) => d.id)).toEqual(['solo-futsal']);
    expect(invalid.sort()).toEqual(['broken.json', 'foreign.json']);
  });

  it('leaves no temp files behind', async () => {
    const { repo: r, dir } = await repo();
    await r.put(soloFutsalFormat());
    await r.put(soloFutsalFormat());
    expect(await readdir(dir)).toEqual(['solo-futsal.json']);
  });

  it('rejects ids that are not lowercase', async () => {
    const { repo: r } = await repo();
    await expect(r.get('Solo-Futsal')).rejects.toBeInstanceOf(InvalidIdError);
    await expect(r.put({ ...soloFutsalFormat(), id: 'Solo-Futsal' })).rejects.toBeInstanceOf(InvalidIdError);
  });

  it('rejects windows reserved device names', async () => {
    const { repo: r } = await repo();
    for (const id of ['con', 'nul', 'com1', 'lpt9', 'aux.backup']) {
      await expect(r.get(id)).rejects.toBeInstanceOf(InvalidIdError);
    }
  });

  it('rejects unsafe ids on delete', async () => {
    const { repo: r } = await repo();
    await expect(r.delete('../x')).rejects.toBeInstanceOf(InvalidIdError);
  });

  it('removes the temp file when the rename fails', async () => {
    const { repo: r, dir } = await repo();
    await mkdir(dir, { recursive: true });
    await mkdir(join(dir, 'blocked.json'));
    await expect(r.put({ ...soloFutsalFormat(), id: 'blocked' })).rejects.toThrow();
    expect((await readdir(dir)).filter((n) => n.endsWith('.tmp'))).toEqual([]);
  });
});
