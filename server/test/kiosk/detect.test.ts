// SPDX-License-Identifier: GPL-2.0-or-later
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { detectBrowser, type DetectDeps } from '../../src/kiosk/detect';

function deps(over: Partial<DetectDeps> & { files?: string[]; onPath?: Record<string, string>; registry?: Record<string, string> }): DetectDeps {
  const files = new Set(over.files ?? []);
  return {
    platform: 'win32',
    env: { ProgramFiles: 'C:\\Program Files', 'ProgramFiles(x86)': 'C:\\Program Files (x86)', LOCALAPPDATA: 'C:\\Users\\ann\\AppData\\Local' },
    home: '/home/ann',
    exists: async (p) => files.has(p),
    which: async (n) => over.onPath?.[n] ?? null,
    appPath: async (exe) => over.registry?.[exe] ?? null,
    ...over,
  };
}

describe('detectBrowser', () => {
  it('Windows: the registry App Paths entry wins, in the order Chrome, Edge, Chromium, Brave', async () => {
    const d = deps({
      registry: { 'chrome.exe': 'D:/chrome.exe', 'msedge.exe': 'D:/edge.exe' },
      files: ['D:/chrome.exe', 'D:/edge.exe'],
    });
    expect(await detectBrowser(d)).toEqual({ kind: 'chrome', path: 'D:/chrome.exe' });
  });

  it('Windows: falls back to the known folders, and skips a registry entry whose file is gone', async () => {
    const edge = join('C:\\Program Files (x86)', 'Microsoft', 'Edge', 'Application', 'msedge.exe');
    const d = deps({ registry: { 'chrome.exe': 'D:/gone.exe' }, files: [edge] });
    expect(await detectBrowser(d)).toEqual({ kind: 'edge', path: edge });
  });

  it('Windows: finds Brave in Program Files', async () => {
    const brave = join('C:\\Program Files', 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe');
    expect(await detectBrowser(deps({ files: [brave] }))).toEqual({ kind: 'brave', path: brave });
  });

  it('macOS: looks in /Applications then ~/Applications', async () => {
    const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
    expect(await detectBrowser(deps({ platform: 'darwin', files: [chrome] }))).toEqual({ kind: 'chrome', path: chrome });
    const mine = join('/home/ann', 'Applications', 'Chromium.app', 'Contents', 'MacOS', 'Chromium');
    expect(await detectBrowser(deps({ platform: 'darwin', files: [mine] }))).toEqual({ kind: 'chromium', path: mine });
  });

  it('Linux: uses PATH names, google-chrome-stable first', async () => {
    const d = deps({ platform: 'linux', onPath: { chromium: '/usr/bin/chromium', 'google-chrome-stable': '/usr/bin/google-chrome-stable' } });
    expect(await detectBrowser(d)).toEqual({ kind: 'chrome', path: '/usr/bin/google-chrome-stable' });
    expect(await detectBrowser(deps({ platform: 'linux', onPath: { 'brave-browser': '/usr/bin/brave-browser' } }))).toEqual({
      kind: 'brave',
      path: '/usr/bin/brave-browser',
    });
  });

  it('nothing installed: null', async () => {
    expect(await detectBrowser(deps({}))).toBeNull();
    expect(await detectBrowser(deps({ platform: 'linux' }))).toBeNull();
  });

  it('an override wins, and a missing override is NOT replaced by something else', async () => {
    const d = deps({ files: ['E:/mine/chrome.exe', 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'] });
    expect(await detectBrowser(d, 'E:/mine/chrome.exe')).toEqual({ kind: 'custom', path: 'E:/mine/chrome.exe' });
    expect(await detectBrowser(d, 'E:/typo/chrome.exe')).toBeNull();
  });

  it('surrounding quotes and spaces in the override are trimmed', async () => {
    const d = deps({ files: ['C:\\Program Files\\Mine\\chrome.exe'] });
    expect(await detectBrowser(d, '  "C:\\Program Files\\Mine\\chrome.exe"  ')).toEqual({
      kind: 'custom',
      path: 'C:\\Program Files\\Mine\\chrome.exe',
    });
  });
});
