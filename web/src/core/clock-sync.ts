// SPDX-License-Identifier: GPL-2.0-or-later

export const CLOCK_WINDOW = 8;
export const MAX_SAMPLE_RTT_MS = 10_000;

export interface ClockSample {
  offsetMs: number;
  rttMs: number;
}

/**
 * DT-7 server-clock estimate. Each time.ping/pong round trip gives rtt = t1 − t0 and
 * offset = serverWall − (t0 + t1) / 2, with t0/t1 on the local monotonic clock. The estimate is the offset of the
 * minimum-RTT sample among the last CLOCK_WINDOW (the least delayed sample is the least skewed); ties go to the
 * newest. The server is the only source of time (NF4): the client never shows its own wall clock.
 */
export class ClockSync {
  private samples: ClockSample[] = [];
  private best: ClockSample | null = null;

  constructor(private readonly local: () => number) {}

  /** Records a pong received now. Returns false, ignoring it, for an impossible or useless round trip. */
  addPong(t0: number, serverWall: number): boolean {
    const t1 = this.local();
    const rttMs = t1 - t0;
    if (!Number.isFinite(rttMs) || !Number.isFinite(serverWall) || rttMs < 0 || rttMs > MAX_SAMPLE_RTT_MS) return false;
    this.samples.push({ offsetMs: serverWall - (t0 + t1) / 2, rttMs });
    if (this.samples.length > CLOCK_WINDOW) this.samples.shift();
    this.best = this.samples.reduce((a, b) => (b.rttMs <= a.rttMs ? b : a));
    return true;
  }

  get synced(): boolean {
    return this.best !== null;
  }

  /** The sample in use, or null before the first one. */
  get sample(): ClockSample | null {
    return this.best;
  }

  /** Estimated server wall time now. Callers check `synced` first. */
  now(): number {
    if (this.best === null) throw new Error('ClockSync.now() before the first sample');
    return this.local() + this.best.offsetMs;
  }

  reset(): void {
    this.samples = [];
    this.best = null;
  }
}
