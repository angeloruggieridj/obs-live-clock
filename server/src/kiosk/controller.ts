// SPDX-License-Identifier: GPL-2.0-or-later
import type { Clock, Scheduler } from '../clock/clock';
import type { DetectedBrowser } from './detect';
import { buildKioskArgs, choosePlacement, type Placement } from './placement';
import { RestartPolicy } from './restart-policy';
import type { ScreenInfo } from './screens';
import type { KioskSettings } from './settings';

export interface ExitInfo {
  code: number | null;
  /** Set when the process could not be started at all (ENOENT, EACCES). */
  error?: string;
}

export interface KioskProcess {
  readonly pid: number | undefined;
  kill(): void;
  /** Called once, when the process ends (or never started). */
  onExit(callback: (info: ExitInfo) => void): void;
}

export interface KioskDeps {
  clock: Clock;
  scheduler: Scheduler;
  spawn(command: string, args: string[]): KioskProcess;
  detect(override: string | undefined): Promise<DetectedBrowser | null>;
  screens(): ScreenInfo[] | null;
  port(): number;
  profileDir: string;
  log(message: string): void;
}

export type KioskState =
  | 'disabled'
  | 'stopped'
  | 'running'
  | 'restarting'
  | 'waiting_for_screens'
  | 'screen_missing'
  | 'browser_not_found'
  | 'spawn_failed'
  | 'suspended'
  | 'handed_off';

export interface KioskStatus {
  state: KioskState;
  enabled: boolean;
  pid: number | null;
  restarts: number;
  browser: string | null;
  screen: string | null;
}

/**
 * Keeps the presenter window open on the right monitor, and gets out of the way when it should. It never opens the
 * window on a monitor other than the one configured (screen_missing / waiting_for_screens instead), restarts a
 * closed or crashed browser with growing delays, and stops for good after too many restarts (suspended) until the
 * operator presses Start.
 */
export class KioskController {
  private state: KioskState = 'stopped';
  private process: KioskProcess | null = null;
  private startedAt = 0;
  private placement: Extract<Placement, { ok: true }> | null = null;
  private browser: DetectedBrowser | null = null;
  private cancelTimer: (() => void) | null = null;
  private generation = 0;
  private disposed = false;
  private readonly policy: RestartPolicy;

  constructor(
    private readonly deps: KioskDeps,
    private settings: KioskSettings,
    policy?: RestartPolicy,
  ) {
    this.policy = policy ?? new RestartPolicy();
    if (!settings.enabled) this.state = 'disabled';
  }

  status(): KioskStatus {
    return {
      state: this.state,
      enabled: this.settings.enabled,
      pid: this.process?.pid ?? null,
      restarts: this.policy.restarts,
      browser: this.browser?.path ?? null,
      screen: this.placement?.screen ?? null,
    };
  }

  /** Boot, or the operator's Start: a fresh start with a clean restart history. */
  async start(): Promise<void> {
    this.policy.reset();
    await this.launch();
  }

  /** The operator's Stop: kills the browser and stays stopped. */
  stop(): void {
    this.teardown();
    this.state = this.settings.enabled ? 'stopped' : 'disabled';
  }

  async restart(): Promise<void> {
    this.teardown();
    await this.start();
  }

  async applySettings(settings: KioskSettings): Promise<void> {
    this.settings = settings;
    if (!settings.enabled) {
      this.teardown();
      this.state = 'disabled';
      return;
    }
    await this.restart();
  }

  /** The monitor list changed: retry what was waiting for it, and follow a monitor that moved. */
  onScreensChanged(): void {
    if (this.disposed || !this.settings.enabled) return;
    if (this.state === 'waiting_for_screens' || this.state === 'screen_missing') {
      void this.launch();
      return;
    }
    if (this.state === 'running' && this.placement !== null) {
      const next = choosePlacement(this.settings.screen, this.deps.screens());
      if (next.ok && (next.x !== this.placement.x || next.y !== this.placement.y || next.width !== this.placement.width || next.height !== this.placement.height)) {
        this.deps.log('the kiosk monitor moved: reopening the presenter there');
        void this.restart();
      }
    }
  }

  /** Application shutdown: close the browser we opened and never restart it. */
  dispose(): void {
    this.disposed = true;
    this.teardown();
  }

  private teardown(): void {
    this.generation++;
    this.cancelTimer?.();
    this.cancelTimer = null;
    const proc = this.process;
    this.process = null;
    if (proc !== null) {
      try {
        proc.kill();
      } catch {
        // already gone
      }
    }
  }

  private async launch(): Promise<void> {
    if (this.disposed) return;
    const generation = ++this.generation;
    this.cancelTimer?.();
    this.cancelTimer = null;
    if (!this.settings.enabled) {
      this.state = 'disabled';
      return;
    }
    const browser = await this.deps.detect(this.settings.browserPath);
    if (generation !== this.generation || this.disposed) return; // superseded while detecting
    this.browser = browser;
    if (browser === null) {
      this.state = 'browser_not_found';
      this.deps.log('no Chromium-family browser found for the kiosk');
      return;
    }
    const placement = choosePlacement(this.settings.screen, this.deps.screens());
    if (!placement.ok) {
      this.state = placement.reason;
      this.placement = null;
      this.deps.log(`kiosk not started: ${placement.reason}`);
      return;
    }
    this.placement = placement;
    const url = `http://127.0.0.1:${this.deps.port()}/presenter`;
    const args = buildKioskArgs({ url, profileDir: this.deps.profileDir, placement });
    let proc: KioskProcess;
    try {
      proc = this.deps.spawn(browser.path, args);
    } catch (err) {
      this.state = 'spawn_failed';
      this.deps.log(`could not start the kiosk browser: ${err instanceof Error ? err.message : String(err)}`);
      return;
    }
    this.process = proc;
    this.startedAt = this.deps.clock.now();
    this.state = 'running';
    proc.onExit((info) => this.onExit(proc, generation, info));
  }

  private onExit(proc: KioskProcess, generation: number, info: { code: number | null; error?: string }): void {
    if (proc !== this.process || generation !== this.generation || this.disposed) return; // we closed it ourselves
    this.process = null;
    if (info.error !== undefined) {
      this.state = 'spawn_failed';
      this.deps.log(`could not start the kiosk browser: ${info.error}`);
      return;
    }
    const now = this.deps.clock.now();
    const decision = this.policy.onExit(now, { livedMs: now - this.startedAt, code: info.code });
    if (decision.action === 'handoff') {
      this.state = 'handed_off';
      this.deps.log('the kiosk browser handed its window to an instance that was already running');
      return;
    }
    if (decision.action === 'suspend') {
      this.state = 'suspended';
      this.deps.log(`the kiosk browser closed ${decision.restarts} times in a row: not reopening it (press Start to try again)`);
      return;
    }
    if (!this.settings.restart) {
      this.state = 'stopped';
      return;
    }
    this.state = 'restarting';
    const at = now + decision.delayMs;
    this.cancelTimer = this.deps.scheduler.setTimer(at, () => {
      this.cancelTimer = null;
      void this.launch();
    });
  }
}
