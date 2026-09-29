// SPDX-License-Identifier: GPL-2.0-or-later

/** Time source. `now()` is monotonic ms anchored to the epoch, so persisted engine times survive a restart. */
export interface Clock {
  now(): number;
  wall(): number;
}

/** Fires `fn` once the monotonic clock reaches `at`. Returns a cancel function. */
export interface Scheduler {
  setTimer(at: number, fn: () => void): () => void;
}

export const systemClock: Clock = {
  now: () => performance.timeOrigin + performance.now(),
  wall: () => Date.now(),
};

export function systemScheduler(clock: Clock): Scheduler {
  return {
    setTimer(at, fn) {
      const handle = setTimeout(fn, Math.max(0, at - clock.now()));
      return () => clearTimeout(handle);
    },
  };
}

interface FakeTimer {
  id: number;
  at: number;
  fn: () => void;
}

/** Deterministic clock + scheduler for tests. */
export class FakeTime implements Clock, Scheduler {
  private timers: FakeTimer[] = [];
  private nextId = 1;

  constructor(
    public mono = 1_000_000,
    private readonly wallOffset = 1_789_999_000_000,
  ) {}

  now(): number {
    return this.mono;
  }

  wall(): number {
    return this.mono + this.wallOffset;
  }

  setTimer(at: number, fn: () => void): () => void {
    const id = this.nextId++;
    this.timers.push({ id, at, fn });
    return () => {
      this.timers = this.timers.filter((t) => t.id !== id);
    };
  }

  get pending(): number {
    return this.timers.length;
  }

  /** Moves time forward, firing due timers in order with the clock set to each timer's time. */
  advance(ms: number): void {
    const target = this.mono + ms;
    for (;;) {
      const due = this.timers
        .filter((t) => t.at <= target)
        .sort((a, b) => a.at - b.at || a.id - b.id)[0];
      if (due === undefined) break;
      this.timers = this.timers.filter((t) => t.id !== due.id);
      this.mono = Math.max(this.mono, due.at);
      due.fn();
    }
    this.mono = target;
  }
}
