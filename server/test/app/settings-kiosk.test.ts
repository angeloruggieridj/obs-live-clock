// SPDX-License-Identifier: GPL-2.0-or-later
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { KioskScreen, KioskSettings } from '../../src/kiosk/settings';
import { Settings, SettingsFileInvalidError, SettingsHolder, publicSettings } from '../../src/app/settings';
import { tempDir } from '../support/tmp';

describe('kiosk settings', () => {
  it('an old settings file without a kiosk block gets the safe defaults: off, primary monitor, restart on', () => {
    expect(Settings.parse({ port: 4461 }).kiosk).toEqual({ enabled: false, screen: { kind: 'primary' }, restart: true });
  });

  it('accepts the three screen choices and a browser override', () => {
    const k = KioskSettings.parse({ enabled: true, browserPath: 'C:/chrome.exe', screen: { kind: 'name', name: 'DISPLAY2' }, restart: false });
    expect(k).toEqual({ enabled: true, browserPath: 'C:/chrome.exe', screen: { kind: 'name', name: 'DISPLAY2' }, restart: false });
    expect(KioskScreen.parse({ kind: 'position', x: -1920, y: 0 })).toEqual({ kind: 'position', x: -1920, y: 0 });
  });

  it('rejects unknown screen kinds, fractional positions, empty names and an empty browser path', () => {
    expect(KioskScreen.safeParse({ kind: 'nope' }).success).toBe(false);
    expect(KioskScreen.safeParse({ kind: 'position', x: 1.5, y: 0 }).success).toBe(false);
    expect(KioskScreen.safeParse({ kind: 'name', name: '' }).success).toBe(false);
    expect(KioskSettings.safeParse({ browserPath: '' }).success).toBe(false);
  });
});

describe('publicSettings', () => {
  it('never contains the OBS password, only whether there is one', () => {
    const s = Settings.parse({ obs: { host: '10.0.0.5', port: 4455, password: 'hunter2' } });
    const pub = publicSettings(s);
    expect(pub.obs).toEqual({ host: '10.0.0.5', port: 4455, hasPassword: true });
    expect(JSON.stringify(pub)).not.toContain('hunter2');
    expect(publicSettings(Settings.parse({})).obs).toBeNull();
    expect(publicSettings(Settings.parse({ obs: { port: 4455 } })).obs).toMatchObject({ hasPassword: false });
  });
});

describe('SettingsHolder.setKiosk', () => {
  it('writes only the kiosk block and keeps every other key, the OBS password included', async () => {
    const dir = await tempDir();
    const path = join(dir, 'settings.json');
    await writeFile(path, JSON.stringify({ port: 4470, obs: { host: '127.0.0.1', port: 4455, password: 'hunter2' }, custom: 7 }));
    const holder = new SettingsHolder(path, Settings.parse(JSON.parse(await readFile(path, 'utf8'))));
    const next = await holder.setKiosk(KioskSettings.parse({ enabled: true, screen: { kind: 'name', name: 'DISPLAY2' } }));
    expect(next.kiosk.enabled).toBe(true);
    expect(holder.get().kiosk.screen).toEqual({ kind: 'name', name: 'DISPLAY2' });
    expect(holder.get().obs?.password).toBe('hunter2');
    const onDisk = JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>;
    expect(onDisk).toMatchObject({ port: 4470, custom: 7, obs: { password: 'hunter2' }, kiosk: { enabled: true } });
  });

  it('creates the file when there is none', async () => {
    const path = join(await tempDir(), 'settings.json');
    const holder = new SettingsHolder(path, Settings.parse({}));
    await holder.setKiosk(KioskSettings.parse({ enabled: true }));
    expect(JSON.parse(await readFile(path, 'utf8'))).toEqual({ kiosk: { enabled: true, screen: { kind: 'primary' }, restart: true } });
  });

  it('refuses to overwrite a settings file it cannot parse, and says nothing about its content', async () => {
    const path = join(await tempDir(), 'settings.json');
    await writeFile(path, '{"obs":{"password":hunter2');
    const holder = new SettingsHolder(path, Settings.parse({}));
    const error = await holder.setKiosk(KioskSettings.parse({})).then(
      () => null,
      (err: unknown) => err,
    );
    expect(error).toBeInstanceOf(SettingsFileInvalidError);
    expect((error as Error).message).not.toContain('hunter2');
    expect(await readFile(path, 'utf8')).toBe('{"obs":{"password":hunter2');
  });
});
