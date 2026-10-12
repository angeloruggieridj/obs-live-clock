// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import { buildKioskArgs, choosePlacement, WINDOW_INSET } from '../../src/kiosk/placement';
import type { ScreenInfo } from '../../src/kiosk/screens';
import { DEFAULT_RESTART_POLICY, RestartPolicy } from '../../src/kiosk/restart-policy';

const main: ScreenInfo = { name: '\\\\.\\DISPLAY1', x: 0, y: 0, width: 1920, height: 1080, devicePixelRatio: 1, primary: true };
const tv: ScreenInfo = { name: '\\\\.\\DISPLAY2', x: 1920, y: 0, width: 1920, height: 1080, devicePixelRatio: 1, primary: false };
const left: ScreenInfo = { name: 'LEFT', x: -1280, y: -100, width: 1280, height: 1024, devicePixelRatio: 1, primary: false };

describe('choosePlacement', () => {
  it('opens on the named monitor, a little inside it', () => {
    expect(choosePlacement({ kind: 'name', name: tv.name }, [main, tv])).toEqual({
      ok: true,
      x: 1920 + WINDOW_INSET,
      y: WINDOW_INSET,
      width: 1920,
      height: 1080,
      screen: tv.name,
    });
  });

  it('works for a monitor left of / above the primary one (negative origin)', () => {
    expect(choosePlacement({ kind: 'name', name: 'LEFT' }, [main, left])).toMatchObject({
      ok: true,
      x: -1280 + WINDOW_INSET,
      y: -100 + WINDOW_INSET,
    });
  });

  it('never replaces a named monitor that is not there: no launch, a reason instead', () => {
    expect(choosePlacement({ kind: 'name', name: 'GONE' }, [main, tv])).toEqual({ ok: false, reason: 'screen_missing' });
  });

  it('waits for the plugin when it needs the list and has none', () => {
    expect(choosePlacement({ kind: 'name', name: tv.name }, null)).toEqual({ ok: false, reason: 'waiting_for_screens' });
    expect(choosePlacement({ kind: 'name', name: tv.name }, [])).toEqual({ ok: false, reason: 'waiting_for_screens' });
  });

  it('a fixed position needs no list, and borrows the monitor size when the list knows it', () => {
    expect(choosePlacement({ kind: 'position', x: 2000, y: 40 }, null)).toEqual({
      ok: true,
      x: 2000,
      y: 40,
      width: null,
      height: null,
      screen: null,
    });
    expect(choosePlacement({ kind: 'position', x: 2000, y: 40 }, [main, tv])).toMatchObject({
      width: 1920,
      height: 1080,
      screen: tv.name,
    });
  });

  it('primary uses the monitor flagged primary, or the origin when there is no list', () => {
    expect(choosePlacement({ kind: 'primary' }, [tv, main])).toMatchObject({ ok: true, screen: main.name });
    expect(choosePlacement({ kind: 'primary' }, null)).toMatchObject({
      ok: true,
      x: WINDOW_INSET,
      y: WINDOW_INSET,
      width: null,
    });
  });
});

describe('buildKioskArgs', () => {
  const placement = { ok: true as const, x: 1936, y: 16, width: 1920, height: 1080, screen: 'DISPLAY2' };

  it('builds the TECH-DESIGN §9 command line', () => {
    const args = buildKioskArgs({ url: 'http://127.0.0.1:4460/presenter', profileDir: 'C:/d/kiosk-profile', placement });
    expect(args.slice(0, 5)).toEqual([
      '--app=http://127.0.0.1:4460/presenter',
      '--kiosk',
      '--user-data-dir=C:/d/kiosk-profile',
      '--window-position=1936,16',
      '--window-size=1920,1080',
    ]);
    for (const flag of ['--no-first-run', '--disable-translate', '--autoplay-policy=no-user-gesture-required']) {
      expect(args).toContain(flag);
    }
  });

  it('omits the size when it is unknown', () => {
    const args = buildKioskArgs({ url: 'u', profileDir: 'p', placement: { ...placement, width: null, height: null } });
    expect(args.some((a) => a.startsWith('--window-size'))).toBe(false);
  });

  it('carries no secret of any kind', () => {
    const args = buildKioskArgs({ url: 'http://127.0.0.1:4460/presenter', profileDir: 'p', placement }).join(' ');
    expect(args).not.toMatch(/token|password|secret/i);
  });
});

describe('RestartPolicy', () => {
  it('restarts with growing delays, then suspends (never fights the operator)', () => {
    const p = new RestartPolicy();
    const decisions = [0, 1, 2, 3, 4].map((i) => p.onExit(i * 60_000, { livedMs: 30_000, code: 1 }));
    expect(decisions.map((d) => (d.action === 'restart' ? d.delayMs : d.action))).toEqual([
      2_000,
      5_000,
      15_000,
      30_000,
      'suspend',
    ]);
  });

  it('forgets restarts older than the window', () => {
    const p = new RestartPolicy();
    for (let i = 0; i < 4; i++) p.onExit(i * 1_000, { livedMs: 5_000, code: 1 });
    expect(p.onExit(DEFAULT_RESTART_POLICY.windowMs + 10_000, { livedMs: 5_000, code: 1 })).toEqual({
      action: 'restart',
      delayMs: 2_000,
    });
  });

  it('a clean exit right after the start is a hand-off to a browser already running: not restarted, not counted', () => {
    const p = new RestartPolicy();
    expect(p.onExit(0, { livedMs: 800, code: 0 })).toEqual({ action: 'handoff' });
    expect(p.restarts).toBe(0);
  });

  it('a clean exit after a long life is the operator closing the window: restarted once, then it counts', () => {
    const p = new RestartPolicy();
    expect(p.onExit(0, { livedMs: 600_000, code: 0 })).toEqual({ action: 'restart', delayMs: 2_000 });
    expect(p.restarts).toBe(1);
  });

  it('reset() gives the operator a fresh start', () => {
    const p = new RestartPolicy();
    for (let i = 0; i < 5; i++) p.onExit(i, { livedMs: 5_000, code: 1 });
    p.reset();
    expect(p.onExit(10, { livedMs: 5_000, code: 1 })).toMatchObject({ action: 'restart' });
  });
});
