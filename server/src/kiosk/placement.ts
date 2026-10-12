// SPDX-License-Identifier: GPL-2.0-or-later

import type { KioskScreen } from './settings';
import type { ScreenInfo } from './screens';

export type Placement =
  | { ok: true; x: number; y: number; width: number | null; height: number | null; screen: string | null }
  | { ok: false; reason: 'waiting_for_screens' | 'screen_missing' };

/** The window starts this far inside the monitor, so rounding or DPI scaling cannot push it onto a neighbour. */
export const WINDOW_INSET = 16;

function inside(screen: ScreenInfo): Placement {
  return {
    ok: true,
    x: screen.x + WINDOW_INSET,
    y: screen.y + WINDOW_INSET,
    width: screen.width,
    height: screen.height,
    screen: screen.name,
  };
}

/**
 * Where to open the kiosk. The rule that matters on air: a screen the operator named is never replaced by another
 * one. If it is not in the list the answer is "screen_missing" (the caller shows a warning and does not launch),
 * because opening the presenter on the director's own monitor would cover the multiview.
 */
export function choosePlacement(setting: KioskScreen, screens: readonly ScreenInfo[] | null): Placement {
  const list = screens ?? [];
  switch (setting.kind) {
    case 'position': {
      const hit = list.find(
        (s) => setting.x >= s.x && setting.x < s.x + s.width && setting.y >= s.y && setting.y < s.y + s.height,
      );
      return {
        ok: true,
        x: setting.x,
        y: setting.y,
        width: hit?.width ?? null,
        height: hit?.height ?? null,
        screen: hit?.name ?? null,
      };
    }
    case 'name': {
      if (list.length === 0) return { ok: false, reason: 'waiting_for_screens' };
      const hit = list.find((s) => s.name === setting.name);
      return hit === undefined ? { ok: false, reason: 'screen_missing' } : inside(hit);
    }
    case 'primary': {
      const hit = list.find((s) => s.primary);
      if (hit !== undefined) return inside(hit);
      // No list (no plugin): the primary monitor's origin is (0,0) on Windows and macOS.
      return { ok: true, x: WINDOW_INSET, y: WINDOW_INSET, width: null, height: null, screen: null };
    }
  }
}

export interface KioskArgsInput {
  url: string;
  profileDir: string;
  placement: Extract<Placement, { ok: true }>;
}

/** TECH-DESIGN §9 plus the flags that keep a crashed kiosk from opening a dialog nobody can click. */
export function buildKioskArgs({ url, profileDir, placement }: KioskArgsInput): string[] {
  const args = [
    `--app=${url}`,
    '--kiosk',
    `--user-data-dir=${profileDir}`,
    `--window-position=${placement.x},${placement.y}`,
  ];
  if (placement.width !== null && placement.height !== null) {
    args.push(`--window-size=${placement.width},${placement.height}`);
  }
  args.push(
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-translate',
    '--noerrdialogs',
    '--disable-session-crashed-bubble',
    '--autoplay-policy=no-user-gesture-required',
  );
  return args;
}
