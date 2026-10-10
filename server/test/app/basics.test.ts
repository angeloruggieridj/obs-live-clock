// SPDX-License-Identifier: GPL-2.0-or-later
import { readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { InstanceLockedError, acquireLock, olcInstanceAlive } from '../../src/app/instance-lock';
import { dataPaths, defaultDataDir } from '../../src/app/paths';
import { ensureSecretToken } from '../../src/app/secret';
import { listenHost, loadSettings } from '../../src/app/settings';
import { writeJsonAtomic } from '../../src/persistence/json-file';
import { tempDir } from '../support/tmp';

describe('defaultDataDir', () => {
  it('honours OLC_DATA_DIR', () => {
    expect(defaultDataDir({ OLC_DATA_DIR: '/data/olc' }, 'linux', '/home/a')).toBe('/data/olc');
  });

  it('uses the platform conventions', () => {
    expect(defaultDataDir({ APPDATA: 'C:/Users/a/AppData/Roaming' }, 'win32', 'C:/Users/a')).toBe(
      join('C:/Users/a/AppData/Roaming', 'obs-live-clock'),
    );
    expect(defaultDataDir({}, 'darwin', '/Users/a')).toBe(join('/Users/a', 'Library', 'Application Support', 'obs-live-clock'));
    expect(defaultDataDir({ XDG_CONFIG_HOME: '/x' }, 'linux', '/home/a')).toBe(join('/x', 'obs-live-clock'));
    expect(defaultDataDir({}, 'linux', '/home/a')).toBe(join('/home/a', '.config', 'obs-live-clock'));
  });

  it('lays out the data directory as in DT-6', () => {
    const p = dataPaths('/r');
    expect(p.snapshot).toBe(join('/r', 'live', 'snapshot.json'));
    expect(p.journal('ep-1')).toBe(join('/r', 'live', 'ep-1.log.jsonl'));
    expect(p.formats).toBe(join('/r', 'formats'));
  });
});

describe('settings', () => {
  it('defaults to localhost:4460 when the file is missing', async () => {
    const s = await loadSettings(join(await tempDir(), 'settings.json'));
    expect(s).toEqual({ port: 4460, lanAccess: false });
    expect(listenHost(s)).toBe('127.0.0.1');
  });

  it('listens on all interfaces only when LAN access is enabled', async () => {
    const dir = await tempDir();
    await writeFile(join(dir, 'settings.json'), JSON.stringify({ lanAccess: true }));
    const s = await loadSettings(join(dir, 'settings.json'));
    expect(s.port).toBe(4460);
    expect(listenHost(s)).toBe('0.0.0.0');
  });

  it('falls back to the defaults and reports when the settings are invalid', async () => {
    const dir = await tempDir();
    await writeFile(join(dir, 'settings.json'), JSON.stringify({ port: 70_000 }));
    const errors: unknown[] = [];
    const s = await loadSettings(join(dir, 'settings.json'), (err) => errors.push(err));
    expect(s).toEqual({ port: 4460, lanAccess: false });
    expect(errors).toHaveLength(1);
  });
});

describe('ensureSecretToken', () => {
  it('creates a 256-bit hex token once and reuses it', async () => {
    const path = join(await tempDir(), 'secret.token');
    const a = await ensureSecretToken(path);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(await ensureSecretToken(path)).toBe(a);
  });

  it('replaces a malformed token', async () => {
    const path = join(await tempDir(), 'secret.token');
    await writeFile(path, 'short');
    expect(await ensureSecretToken(path)).toMatch(/^[0-9a-f]{64}$/);
  });

  it.skipIf(process.platform === 'win32')('is readable only by the owner (POSIX)', async () => {
    const path = join(await tempDir(), 'secret.token');
    await ensureSecretToken(path);
    expect((await stat(path)).mode & 0o777).toBe(0o600);
  });
});

describe('acquireLock', () => {
  it('writes the pid and releases only its own lock', async () => {
    const path = join(await tempDir(), 'instance.lock');
    const release = await acquireLock(path, 111, async () => true);
    expect(await readFile(path, 'utf8')).toBe('111');
    await release();
    await expect(readFile(path, 'utf8')).rejects.toThrow();
  });

  it('refuses when another live instance holds the lock', async () => {
    const path = join(await tempDir(), 'instance.lock');
    await acquireLock(path, 111, async () => true);
    await expect(acquireLock(path, 222, async (pid) => pid === 111)).rejects.toBeInstanceOf(InstanceLockedError);
  });

  it('takes over a stale lock', async () => {
    const path = join(await tempDir(), 'instance.lock');
    await writeFile(path, '999');
    const release = await acquireLock(path, 222, async () => false);
    expect(await readFile(path, 'utf8')).toBe('222');
    await release();
  });

  it('lets exactly one of two concurrent starters take over a stale lock', async () => {
    const path = join(await tempDir(), 'instance.lock');
    await writeFile(path, '999');
    const results = await Promise.allSettled([
      acquireLock(path, 111, async () => false),
      acquireLock(path, 222, async () => false),
    ]);
    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(InstanceLockedError);
  });
});

describe('olcInstanceAlive', () => {
  it('is false when runtime.json is missing', async () => {
    const paths = dataPaths(await tempDir());
    expect(await olcInstanceAlive(paths)(4242)).toBe(false);
  });

  it('is false when the recorded port does not answer', async () => {
    const paths = dataPaths(await tempDir());
    await writeJsonAtomic(paths.runtime, { port: 1, pid: 4242, instanceId: 'i' });
    expect(await olcInstanceAlive(paths)(4242)).toBe(false);
  });
});
