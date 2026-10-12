// SPDX-License-Identifier: GPL-2.0-or-later

export interface RestartPolicyConfig {
  /** Sliding window in which restarts are counted. */
  windowMs: number;
  /** Delay before restart number 1, 2, 3, ... inside the window. */
  delaysMs: number[];
  /** A clean exit this soon after the start means Chrome handed the window to an instance already running. */
  handoffMs: number;
}

export const DEFAULT_RESTART_POLICY: RestartPolicyConfig = {
  windowMs: 10 * 60_000,
  delaysMs: [2_000, 5_000, 15_000, 30_000],
  handoffMs: 3_000,
};

export type ExitDecision =
  | { action: 'restart'; delayMs: number }
  /** The browser we started is not the process that shows the window: do not restart, do not count. */
  | { action: 'handoff' }
  /** Too many restarts in the window: stop and let the operator decide (never fight the operator). */
  | { action: 'suspend'; restarts: number };

/**
 * When the kiosk browser exits, decide whether to open it again. At most `delaysMs.length` restarts per sliding
 * window, with growing delays; one more and we stop, because a window the operator keeps closing, or a browser
 * that keeps crashing, must not be reopened in a loop in front of a live show.
 */
export class RestartPolicy {
  private readonly restartTimes: number[] = [];

  constructor(private readonly config: RestartPolicyConfig = DEFAULT_RESTART_POLICY) {}

  onExit(now: number, info: { livedMs: number; code: number | null }): ExitDecision {
    if (info.code === 0 && info.livedMs < this.config.handoffMs) return { action: 'handoff' };
    this.prune(now);
    const index = this.restartTimes.length;
    if (index >= this.config.delaysMs.length) return { action: 'suspend', restarts: index };
    this.restartTimes.push(now);
    return { action: 'restart', delayMs: this.config.delaysMs[index]! };
  }

  /**
   * A restart the controller decides itself (the monitor moved). It counts against the same limit as a crash, so a
   * flapping display cannot reopen the window forever; false means the limit is reached.
   */
  allowRestart(now: number): boolean {
    this.prune(now);
    if (this.restartTimes.length >= this.config.delaysMs.length) return false;
    this.restartTimes.push(now);
    return true;
  }

  /** Operator pressed Start/Restart: a fresh start. */
  reset(): void {
    this.restartTimes.length = 0;
  }

  get restarts(): number {
    return this.restartTimes.length;
  }

  private prune(now: number): void {
    while (this.restartTimes.length > 0 && now - this.restartTimes[0]! > this.config.windowMs) this.restartTimes.shift();
  }
}
