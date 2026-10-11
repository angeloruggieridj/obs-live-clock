// SPDX-License-Identifier: GPL-2.0-or-later
import type { Scheduler } from '../../src/core/ws-client';

/** Deterministic local clock + scheduler: timers fire in time order during `advance`. */
export class FakeScheduler implements Scheduler {
  now = 1_000;
  private timers: Array<{ id: number; at: number; fn: () => void }> = [];
  private nextId = 1;

  readonly local = (): number => this.now;

  setTimeout(fn: () => void, ms: number): () => void {
    const timer = { id: this.nextId++, at: this.now + Math.max(0, ms), fn };
    this.timers.push(timer);
    return () => {
      this.timers = this.timers.filter((t) => t !== timer);
    };
  }

  advance(ms: number): void {
    const target = this.now + ms;
    for (;;) {
      const due = this.timers.filter((t) => t.at <= target).sort((a, b) => a.at - b.at || a.id - b.id)[0];
      if (due === undefined) break;
      this.timers = this.timers.filter((t) => t !== due);
      this.now = due.at;
      due.fn();
    }
    this.now = target;
  }
}
