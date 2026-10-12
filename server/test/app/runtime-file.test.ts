// SPDX-License-Identifier: GPL-2.0-or-later
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { removeRuntimeFile, writeRuntimeFile, type RuntimeInfo } from '../../src/app/runtime-file';
import { tempDir } from '../support/tmp';

const info: RuntimeInfo = { port: 4460, pid: 1234, instanceId: 'inst-1', version: '0.1.0', protocol: 1 };

describe('runtime.json', () => {
  it('holds port, pid and instanceId (read by the single-instance check and by the plugin) plus version and protocol', async () => {
    const path = join(await tempDir(), 'runtime.json');
    await writeRuntimeFile(path, info);
    expect(JSON.parse(await readFile(path, 'utf8'))).toEqual(info);
  });

  it('is removed on a clean shutdown, but only when it still names this instance', async () => {
    const dir = await tempDir();
    const path = join(dir, 'runtime.json');
    await writeRuntimeFile(path, info);
    await removeRuntimeFile(path, 'someone-else');
    expect(JSON.parse(await readFile(path, 'utf8')).instanceId).toBe('inst-1');
    await removeRuntimeFile(path, 'inst-1');
    await expect(readFile(path, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('removing a missing or unreadable file is not an error', async () => {
    const dir = await tempDir();
    await removeRuntimeFile(join(dir, 'missing.json'), 'x');
    await writeFile(join(dir, 'broken.json'), '{ nope');
    await removeRuntimeFile(join(dir, 'broken.json'), 'x');
    expect(await readFile(join(dir, 'broken.json'), 'utf8')).toBe('{ nope');
  });
});
