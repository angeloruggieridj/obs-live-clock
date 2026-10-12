// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import { FakeTime } from '../../src/clock/clock';
import { KioskController, type ExitInfo, type KioskDeps, type KioskProcess } from '../../src/kiosk/controller';
import type { DetectedBrowser } from '../../src/kiosk/detect';
import type { ScreenInfo } from '../../src/kiosk/screens';
import type { KioskSettings } from '../../src/kiosk/settings';

const main: ScreenInfo = { name: 'DISPLAY1', x: 0, y: 0, width: 1920, height: 1080, devicePixelRatio: 1, primary: true };
const tv: ScreenInfo = { name: 'DISPLAY2', x: 1920, y: 0, width: 1920, height: 1080, devicePixelRatio: 1, primary: false };

class FakeProcess implements KioskProcess {
  killed = false;
  private cb: ((e: ExitInfo) => void) | null = null;
  constructor(readonly pid: number) {}
  kill(): void {
    this.killed = true;
  }
  onExit(cb: (e: ExitInfo) => void): void {
    this.cb = cb;
  }
  exit(code: number | null = 1, error?: string): void {
    this.cb?.({ code, error });
  }
}

function setup(over: Partial<KioskSettings> = {}, opts: { screens?: ScreenInfo[] | null; browser?: DetectedBrowser | null } = {}) {
  const time = new FakeTime();
  const spawned: { command: string; args: string[]; proc: FakeProcess }[] = [];
  const logs: string[] = [];
  let screens: ScreenInfo[] | null = opts.screens === undefined ? [main, tv] : opts.screens;
  let browser: DetectedBrowser | null = opts.browser === undefined ? { kind: 'chrome', path: 'C:/chrome.exe' } : opts.browser;
  let spawnError: Error | null = null;
  const deps: KioskDeps = {
    clock: time,
    scheduler: time,
    spawn: (command, args) => {
      if (spawnError !== null) throw spawnError;
      const proc = new FakeProcess(1000 + spawned.length);
      spawned.push({ command, args, proc });
      return proc;
    },
    detect: async () => browser,
    screens: () => screens,
    port: () => 4460,
    profileDir: 'C:/d/kiosk-profile',
    log: (m) => logs.push(m),
  };
  const settings: KioskSettings = { enabled: true, screen: { kind: 'name', name: 'DISPLAY2' }, restart: true, ...over };
  const kiosk = new KioskController(deps, settings);
  return {
    time,
    kiosk,
    spawned,
    logs,
    setScreens: (s: ScreenInfo[] | null) => (screens = s),
    setBrowser: (b: DetectedBrowser | null) => (browser = b),
    failSpawn: (e: Error | null) => (spawnError = e),
  };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('KioskController start', () => {
  it('opens the presenter on the configured monitor with the TECH-DESIGN §9 command line', async () => {
    const t = setup();
    await t.kiosk.start();
    expect(t.spawned).toHaveLength(1);
    expect(t.spawned[0]!.command).toBe('C:/chrome.exe');
    expect(t.spawned[0]!.args).toContain('--app=http://127.0.0.1:4460/presenter');
    expect(t.spawned[0]!.args).toContain('--kiosk');
    expect(t.spawned[0]!.args).toContain('--user-data-dir=C:/d/kiosk-profile');
    expect(t.spawned[0]!.args).toContain('--window-position=1936,16');
    expect(t.kiosk.status()).toMatchObject({ state: 'running', screen: 'DISPLAY2', pid: 1000 });
  });

  it('does nothing when the kiosk is disabled', async () => {
    const t = setup({ enabled: false });
    await t.kiosk.start();
    expect(t.spawned).toHaveLength(0);
    expect(t.kiosk.status().state).toBe('disabled');
  });

  it('wrong screen is never an option: a named monitor that is not there means no window and a clear state', async () => {
    const t = setup({}, { screens: [main] });
    await t.kiosk.start();
    expect(t.spawned).toHaveLength(0);
    expect(t.kiosk.status().state).toBe('screen_missing');
  });

  it('waits for the plugin when it needs the list, then opens as soon as the list arrives', async () => {
    const t = setup({}, { screens: null });
    await t.kiosk.start();
    expect(t.kiosk.status().state).toBe('waiting_for_screens');
    t.setScreens([main, tv]);
    t.kiosk.onScreensChanged();
    await flush();
    expect(t.spawned).toHaveLength(1);
    expect(t.kiosk.status().state).toBe('running');
  });

  it('reports a missing browser and does not retry by itself', async () => {
    const t = setup({}, { browser: null });
    await t.kiosk.start();
    expect(t.kiosk.status().state).toBe('browser_not_found');
    t.time.advance(10 * 60_000);
    expect(t.spawned).toHaveLength(0);
  });

  it('a spawn that throws is reported and not retried', async () => {
    const t = setup();
    t.failSpawn(new Error('spawn EACCES'));
    await t.kiosk.start();
    expect(t.kiosk.status().state).toBe('spawn_failed');
    t.time.advance(60_000);
    expect(t.spawned).toHaveLength(0);
  });

  it('a process that reports it could not start is spawn_failed, not a crash to restart', async () => {
    const t = setup();
    await t.kiosk.start();
    t.spawned[0]!.proc.exit(null, 'spawn ENOENT');
    expect(t.kiosk.status().state).toBe('spawn_failed');
    t.time.advance(60_000);
    expect(t.spawned).toHaveLength(1);
  });

  it('starting again tears down the window the first start opened (no orphaned kiosk)', async () => {
    const t = setup();
    await t.kiosk.start();
    await t.kiosk.start();
    expect(t.spawned[0]!.proc.killed).toBe(true);
    expect(t.spawned).toHaveLength(2);
    expect(t.kiosk.status()).toMatchObject({ state: 'running', pid: 1001 });
  });
});

describe('KioskController supervision (never fight the operator)', () => {
  it('reopens a closed browser after a pause, with growing pauses', async () => {
    const t = setup();
    await t.kiosk.start();
    t.time.advance(30_000);
    t.spawned[0]!.proc.exit(1);
    expect(t.kiosk.status().state).toBe('restarting');
    t.time.advance(1_999);
    expect(t.spawned).toHaveLength(1);
    t.time.advance(1);
    await flush();
    expect(t.spawned).toHaveLength(2);
    t.time.advance(30_000);
    t.spawned[1]!.proc.exit(1);
    t.time.advance(4_999);
    await flush();
    expect(t.spawned).toHaveLength(2);
    t.time.advance(1);
    await flush();
    expect(t.spawned).toHaveLength(3);
  });

  it('stops after four restarts in the window and says so (suspended), until the operator starts it again', async () => {
    const t = setup();
    await t.kiosk.start();
    for (let i = 0; i < 4; i++) {
      t.time.advance(20_000);
      t.spawned.at(-1)!.proc.exit(0);
      t.time.advance(40_000);
      await flush();
    }
    expect(t.spawned).toHaveLength(5);
    t.time.advance(20_000);
    t.spawned.at(-1)!.proc.exit(0);
    expect(t.kiosk.status().state).toBe('suspended');
    t.time.advance(60 * 60_000);
    await flush();
    expect(t.spawned).toHaveLength(5);
    await t.kiosk.start();
    expect(t.spawned).toHaveLength(6);
    expect(t.kiosk.status().state).toBe('running');
  });

  it('with restart off, a closed window stays closed', async () => {
    const t = setup({ restart: false });
    await t.kiosk.start();
    t.time.advance(30_000);
    t.spawned[0]!.proc.exit(0);
    expect(t.kiosk.status().state).toBe('stopped');
    t.time.advance(60_000);
    expect(t.spawned).toHaveLength(1);
  });

  it('a quick clean exit is a hand-off to a browser that was already running: no restart loop', async () => {
    const t = setup();
    await t.kiosk.start();
    t.time.advance(800);
    t.spawned[0]!.proc.exit(0);
    expect(t.kiosk.status().state).toBe('handed_off');
    t.time.advance(10 * 60_000);
    expect(t.spawned).toHaveLength(1);
  });

  it('Stop kills the browser and nothing reopens it', async () => {
    const t = setup();
    await t.kiosk.start();
    t.kiosk.stop();
    expect(t.spawned[0]!.proc.killed).toBe(true);
    t.spawned[0]!.proc.exit(1); // the kill arrives as an exit
    t.time.advance(60_000);
    await flush();
    expect(t.spawned).toHaveLength(1);
    expect(t.kiosk.status().state).toBe('stopped');
  });

  it('dispose (application shutdown) kills the browser and cancels a pending restart', async () => {
    const t = setup();
    await t.kiosk.start();
    t.time.advance(30_000);
    t.spawned[0]!.proc.exit(1);
    t.kiosk.dispose();
    t.time.advance(60_000);
    await flush();
    expect(t.spawned).toHaveLength(1);
    const t2 = setup();
    await t2.kiosk.start();
    t2.kiosk.dispose();
    expect(t2.spawned[0]!.proc.killed).toBe(true);
  });
});

describe('KioskController follows the monitors', () => {
  it('a monitor that moved gets the window reopened there, once', async () => {
    const t = setup();
    await t.kiosk.start();
    t.setScreens([main, { ...tv, x: 2560 }]);
    t.kiosk.onScreensChanged();
    await flush();
    expect(t.spawned[0]!.proc.killed).toBe(true);
    expect(t.spawned).toHaveLength(2);
    expect(t.spawned[1]!.args).toContain('--window-position=2576,16');
  });

  it('an unchanged list (the plugin reports again) does not restart anything', async () => {
    const t = setup();
    await t.kiosk.start();
    t.kiosk.onScreensChanged();
    await flush();
    expect(t.spawned).toHaveLength(1);
    expect(t.spawned[0]!.proc.killed).toBe(false);
  });

  it('the named monitor unplugged while running: the window is left alone (no jump to another monitor)', async () => {
    const t = setup();
    await t.kiosk.start();
    t.setScreens([main]);
    t.kiosk.onScreensChanged();
    await flush();
    expect(t.spawned).toHaveLength(1);
    expect(t.kiosk.status().state).toBe('running');
  });

  it('a flapping monitor cannot reopen the window without limit', async () => {
    const t = setup();
    await t.kiosk.start();
    for (let i = 0; i < 10; i++) {
      t.setScreens([main, { ...tv, x: 1920 + i * 640 }]);
      t.kiosk.onScreensChanged();
      await flush();
    }
    expect(t.kiosk.status().state).toBe('suspended');
    expect(t.spawned).toHaveLength(5);
    t.time.advance(60 * 60_000);
    await flush();
    expect(t.spawned).toHaveLength(5);
  });
});

describe('KioskController settings', () => {
  it('disabling stops the browser; enabling starts it', async () => {
    const t = setup();
    await t.kiosk.start();
    await t.kiosk.applySettings({ enabled: false, screen: { kind: 'primary' }, restart: true });
    expect(t.spawned[0]!.proc.killed).toBe(true);
    expect(t.kiosk.status().state).toBe('disabled');
    await t.kiosk.applySettings({ enabled: true, screen: { kind: 'primary' }, restart: true });
    expect(t.spawned).toHaveLength(2);
    expect(t.spawned[1]!.args).toContain('--window-position=16,16');
  });

  it('a superseded start (settings changed while detecting) does not open a second window', async () => {
    const t = setup();
    const a = t.kiosk.start();
    const b = t.kiosk.restart();
    await Promise.all([a, b]);
    expect(t.spawned).toHaveLength(1);
  });

  it('a settings save does not reopen a kiosk the operator stopped', async () => {
    const t = setup();
    await t.kiosk.start();
    t.kiosk.stop();
    expect(t.kiosk.status().state).toBe('stopped');
    await t.kiosk.applySettings({ enabled: true, screen: { kind: 'primary' }, restart: true });
    expect(t.spawned).toHaveLength(1);
    expect(t.kiosk.status().state).toBe('stopped');
  });

  it('a settings save does not reopen a suspended kiosk', async () => {
    const t = setup();
    await t.kiosk.start();
    for (let i = 0; i < 4; i++) {
      t.time.advance(20_000);
      t.spawned.at(-1)!.proc.exit(0);
      t.time.advance(40_000);
      await flush();
    }
    t.time.advance(20_000);
    t.spawned.at(-1)!.proc.exit(0);
    expect(t.kiosk.status().state).toBe('suspended');
    await t.kiosk.applySettings({ enabled: true, screen: { kind: 'primary' }, restart: true });
    expect(t.spawned).toHaveLength(5);
    expect(t.kiosk.status().state).toBe('suspended');
  });

  it('a kiosk-relevant change while running moves the window to the new monitor', async () => {
    const t = setup();
    await t.kiosk.start();
    await t.kiosk.applySettings({ enabled: true, screen: { kind: 'primary' }, restart: true });
    expect(t.spawned[0]!.proc.killed).toBe(true);
    expect(t.spawned).toHaveLength(2);
    expect(t.spawned[1]!.args).toContain('--window-position=16,16');
  });

  it('a settings save that changes nothing leaves the running kiosk alone', async () => {
    const t = setup();
    await t.kiosk.start();
    await t.kiosk.applySettings({ enabled: true, screen: { kind: 'name', name: 'DISPLAY2' }, restart: true });
    expect(t.spawned).toHaveLength(1);
    expect(t.spawned[0]!.proc.killed).toBe(false);
  });
});
