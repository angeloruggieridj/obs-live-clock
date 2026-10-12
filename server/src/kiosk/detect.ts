// SPDX-License-Identifier: GPL-2.0-or-later
import { join } from 'node:path';

export type BrowserKind = 'chrome' | 'edge' | 'chromium' | 'brave' | 'custom';
export interface DetectedBrowser {
  kind: BrowserKind;
  path: string;
}

export interface DetectDeps {
  platform: NodeJS.Platform;
  env: NodeJS.ProcessEnv;
  home: string;
  /** true when the file exists and is a regular file. */
  exists(path: string): Promise<boolean>;
  /** Linux/macOS `which`: the first match on PATH, or null. */
  which(name: string): Promise<string | null>;
  /** Windows: the default value of HKLM or HKCU `SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\<exe>`, or null. */
  appPath(exe: string): Promise<string | null>;
}

interface Candidate {
  kind: Exclude<BrowserKind, 'custom'>;
  /** Windows App Paths executable name, Linux `which` names. */
  exe?: string;
  which?: string[];
  paths: (d: DetectDeps) => string[];
}

const win = (d: DetectDeps, ...rel: string[]): string[] =>
  [d.env.ProgramFiles, d.env['ProgramFiles(x86)'], d.env.LOCALAPPDATA]
    .filter((root): root is string => root !== undefined && root !== '')
    .map((root) => join(root, ...rel));

/** Chrome, then Edge, then Chromium, then Brave (TECH-DESIGN §9). Order inside a browser: registry, then known folders. */
const CANDIDATES: Candidate[] = [
  {
    kind: 'chrome',
    exe: 'chrome.exe',
    which: ['google-chrome-stable', 'google-chrome'],
    paths: (d) =>
      d.platform === 'win32'
        ? win(d, 'Google', 'Chrome', 'Application', 'chrome.exe')
        : [
            '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
            join(d.home, 'Applications', 'Google Chrome.app', 'Contents', 'MacOS', 'Google Chrome'),
          ],
  },
  {
    kind: 'edge',
    exe: 'msedge.exe',
    which: ['microsoft-edge-stable', 'microsoft-edge'],
    paths: (d) =>
      d.platform === 'win32'
        ? win(d, 'Microsoft', 'Edge', 'Application', 'msedge.exe')
        : [
            '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
            join(d.home, 'Applications', 'Microsoft Edge.app', 'Contents', 'MacOS', 'Microsoft Edge'),
          ],
  },
  {
    kind: 'chromium',
    which: ['chromium', 'chromium-browser'],
    paths: (d) =>
      d.platform === 'win32'
        ? win(d, 'Chromium', 'Application', 'chrome.exe')
        : ['/Applications/Chromium.app/Contents/MacOS/Chromium', join(d.home, 'Applications', 'Chromium.app', 'Contents', 'MacOS', 'Chromium')],
  },
  {
    kind: 'brave',
    exe: 'brave.exe',
    which: ['brave-browser', 'brave'],
    paths: (d) =>
      d.platform === 'win32'
        ? win(d, 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe')
        : [
            '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
            join(d.home, 'Applications', 'Brave Browser.app', 'Contents', 'MacOS', 'Brave Browser'),
          ],
  },
];

/**
 * The first installed Chromium-family browser, or null. `override` (settings.kiosk.browserPath) wins and is never
 * silently replaced: when it does not exist the answer is null, so the caller can say "browser not found".
 */
export async function detectBrowser(deps: DetectDeps, override?: string): Promise<DetectedBrowser | null> {
  if (override !== undefined && override !== '') {
    return (await deps.exists(override)) ? { kind: 'custom', path: override } : null;
  }
  for (const c of CANDIDATES) {
    if (deps.platform === 'win32' && c.exe !== undefined) {
      const registered = await deps.appPath(c.exe);
      if (registered !== null && (await deps.exists(registered))) return { kind: c.kind, path: registered };
    }
    if (deps.platform === 'linux') {
      for (const name of c.which ?? []) {
        const found = await deps.which(name);
        if (found !== null) return { kind: c.kind, path: found };
      }
      continue;
    }
    for (const path of c.paths(deps)) {
      if (await deps.exists(path)) return { kind: c.kind, path };
    }
  }
  return null;
}
