// SPDX-License-Identifier: GPL-2.0-or-later
import { readFile, stat, utimes, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { InstanceLockedError, acquireLock, olcInstanceAlive } from '../../src/app/instance-lock';
import { dataPaths, defaultDataDir } from '../../src/app/paths';
import { ensureSecretToken } from '../../src/app/secret';
import { Settings, listenHost, loadSettings } from '../../src/app/settings';
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

  it('does not leak the obs password when the settings JSON is malformed', async () => {
    const dir = await tempDir();
    const password = 'hunter2';
    await writeFile(
      join(dir, 'settings.json'),
      `{"obs":{"host":"127.0.0.1","port":4455,"password":${password}}}`,
    );
    const errors: unknown[] = [];
    await loadSettings(join(dir, 'settings.json'), (err) => errors.push(err));
    expect(errors).toHaveLength(1);
    const message = errors.map((e) => (e instanceof Error ? e.message : String(e))).join('\n');
    expect(message).not.toContain(password);
    expect(message).toContain('settings.json is not valid JSON');
  });

  it('parses the optional obs credentials with defaults', () => {
    expect(Settings.parse({ obs: { port: 4456 } }).obs).toEqual({ host: '127.0.0.1', port: 4456 });
  });

  it('leaves obs undefined when it is absent', () => {
    expect(Settings.parse({}).obs).toBeUndefined();
  });
});

describe('ensureSecretToken', () => {
  it('creates a 256-bit hex token once and reuses it', async () => {
    const path = join(await tempDir(), 'secret.token');
    const a = await ensureSecretToken(path, { platform: 'linux' });
    expect(a.token).toMatch(/^[0-9a-f]{64}$/);
    expect((await ensureSecretToken(path, { platform: 'linux' })).token).toBe(a.token);
  });

  it('replaces a malformed token', async () => {
    const path = join(await tempDir(), 'secret.token');
    await writeFile(path, 'short');
    expect((await ensureSecretToken(path, { platform: 'linux' })).token).toMatch(/^[0-9a-f]{64}$/);
  });

  it.skipIf(process.platform === 'win32')('is readable only by the owner (POSIX)', async () => {
    const path = join(await tempDir(), 'secret.token');
    await ensureSecretToken(path);
    expect((await stat(path)).mode & 0o777).toBe(0o600);
  });

  it('restricts the ACL on win32 with the token path', async () => {
    const path = join(await tempDir(), 'secret.token');
    const restricted: string[] = [];
    const result = await ensureSecretToken(path, {
      platform: 'win32',
      restrictAcl: async (target) => {
        restricted.push(target);
      },
    });
    expect(restricted).toEqual([path]);
    expect(result.token).toMatch(/^[0-9a-f]{64}$/);
  });

  it('reports a failing ACL as a warning and still returns the token', async () => {
    const path = join(await tempDir(), 'secret.token');
    const result = await ensureSecretToken(path, {
      platform: 'win32',
      restrictAcl: async () => {
        throw new Error('icacls failed');
      },
    });
    expect(result.token).toMatch(/^[0-9a-f]{64}$/);
    expect(result.aclWarning).toContain('icacls failed');
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

  it.each(['', '  ', 'garbage', '1234x'])('takes over a lock whose content is %j', async (content) => {
    const path = join(await tempDir(), 'instance.lock');
    await writeFile(path, content);
    let checked = 0;
    const release = await acquireLock(path, 222, async () => {
      checked++;
      return false;
    });
    expect(await readFile(path, 'utf8')).toBe('222');
    expect(checked).toBe(0);
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
  it('is false when there is no lock file', async () => {
    const paths = dataPaths(await tempDir());
    expect(await olcInstanceAlive(paths, paths.lock, { isPidAlive: () => true })(4242)).toBe(false);
  });

  it('is false when the lock is old and the recorded port does not answer', async () => {
    const dir = await tempDir();
    const paths = dataPaths(dir);
    await writeFile(paths.lock, '4242');
    const now = Date.now();
    await utimes(paths.lock, new Date(now - 60_000), new Date(now - 60_000));
    await writeJsonAtomic(paths.runtime, { port: 1, pid: 4242, instanceId: 'i' });
    const alive = olcInstanceAlive(paths, paths.lock, {
      now: () => now,
      uptimeS: () => 10_000,
      isPidAlive: () => true,
      fetchImpl: async () => {
        throw new Error('connection refused');
      },
    });
    expect(await alive(4242)).toBe(false);
  });

  it('is true while the owner is still starting (lock younger than 30 s)', async () => {
    const dir = await tempDir();
    const paths = dataPaths(dir);
    await writeFile(paths.lock, '4242');
    const now = Date.now();
    await utimes(paths.lock, new Date(now - 10_000), new Date(now - 10_000));
    const alive = olcInstanceAlive(paths, paths.lock, { now: () => now, uptimeS: () => 10_000, isPidAlive: () => true });
    expect(await alive(4242)).toBe(true);
  });

  it('is false when the lock is old and no runtime.json exists', async () => {
    const dir = await tempDir();
    const paths = dataPaths(dir);
    await writeFile(paths.lock, '4242');
    const now = Date.now();
    await utimes(paths.lock, new Date(now - 60_000), new Date(now - 60_000));
    const alive = olcInstanceAlive(paths, paths.lock, { now: () => now, uptimeS: () => 10_000, isPidAlive: () => true });
    expect(await alive(4242)).toBe(false);
  });

  it('is false when the lock predates the last boot and the reused pid does not answer', async () => {
    const dir = await tempDir();
    const paths = dataPaths(dir);
    const now = Date.now();
    const uptimeS = 10_000;
    await writeFile(paths.lock, '4242');
    const beforeBoot = now - uptimeS * 1000 - 60_000;
    await utimes(paths.lock, new Date(beforeBoot), new Date(beforeBoot));
    await writeJsonAtomic(paths.runtime, { port: 9, pid: 4242, instanceId: 'i' });
    let fetched = 0;
    const alive = olcInstanceAlive(paths, paths.lock, {
      now: () => now,
      uptimeS: () => uptimeS,
      isPidAlive: () => true,
      fetchImpl: async () => {
        fetched++;
        throw new Error('connection refused');
      },
    });
    expect(await alive(4242)).toBe(false);
    expect(fetched).toBe(3);
  });

  it('is true when a forward clock step makes a healthy old lock look older than the boot', async () => {
    const dir = await tempDir();
    const paths = dataPaths(dir);
    const realNow = Date.now();
    await writeFile(paths.lock, '4242');
    await utimes(paths.lock, new Date(realNow - 40_000), new Date(realNow - 40_000));
    await writeJsonAtomic(paths.runtime, { port: 9, pid: 4242, instanceId: 'i' });
    const alive = olcInstanceAlive(paths, paths.lock, {
      now: () => realNow + 120_000,
      uptimeS: () => 60,
      isPidAlive: () => true,
      fetchImpl: async () => new Response(JSON.stringify({ version: 'x', instanceId: 'i' }), { status: 200 }),
    });
    expect(await alive(4242)).toBe(true);
  });

  it('is false when the owner pid is not alive', async () => {
    const dir = await tempDir();
    const paths = dataPaths(dir);
    await writeFile(paths.lock, '4242');
    expect(await olcInstanceAlive(paths, paths.lock, { isPidAlive: () => false })(4242)).toBe(false);
  });

  it('is true when an old lock answers health on a later attempt', async () => {
    const dir = await tempDir();
    const paths = dataPaths(dir);
    await writeFile(paths.lock, '4242');
    const now = Date.now();
    await utimes(paths.lock, new Date(now - 60_000), new Date(now - 60_000));
    await writeJsonAtomic(paths.runtime, { port: 9, pid: 4242, instanceId: 'i' });
    let calls = 0;
    const alive = olcInstanceAlive(paths, paths.lock, {
      now: () => now,
      uptimeS: () => 10_000,
      isPidAlive: () => true,
      fetchImpl: async () => {
        calls++;
        if (calls < 2) throw new Error('not yet');
        return new Response(JSON.stringify({ version: 'x', instanceId: 'i' }), { status: 200 });
      },
    });
    expect(await alive(4242)).toBe(true);
    expect(calls).toBe(2);
  });
});
