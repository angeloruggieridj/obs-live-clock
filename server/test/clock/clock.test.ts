// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import { FakeTime, systemClock, systemScheduler } from '../../src/clock/clock';

describe('FakeTime', () => {
  it('runs due timers in time order, with the clock at the timer time', () => {
    const t = new FakeTime(1_000);
    const seen: Array<[string, number]> = [];
    t.setTimer(1_500, () => seen.push(['b', t.now()]));
    t.setTimer(1_200, () => seen.push(['a', t.now()]));
    t.setTimer(5_000, () => seen.push(['c', t.now()]));
    t.advance(600);
    expect(seen).toEqual([['a', 1_200], ['b', 1_500]]);
    expect(t.now()).toBe(1_600);
    expect(t.pending).toBe(1);
  });

  it('cancels timers and fires timers scheduled by a timer', () => {
    const t = new FakeTime(0);
    const seen: number[] = [];
    const cancel = t.setTimer(10, () => seen.push(10));
    cancel();
    t.setTimer(20, () => t.setTimer(30, () => seen.push(30)));
    t.advance(100);
    expect(seen).toEqual([30]);
  });

  it('keeps wall and mono in a fixed relation', () => {
    const t = new FakeTime(1_000, 5_000);
    t.advance(250);
    expect(t.wall() - t.now()).toBe(5_000);
  });
});

describe('system clock and scheduler', () => {
  it('now() is epoch-anchored and monotonic', () => {
    const a = systemClock.now();
    const b = systemClock.now();
    expect(b).toBeGreaterThanOrEqual(a);
    expect(Math.abs(a - Date.now())).toBeLessThan(60_000);
  });

  it('fires a real timer and can cancel one', async () => {
    const scheduler = systemScheduler(systemClock);
    let cancelledRan = false;
    scheduler.setTimer(systemClock.now() + 5, () => (cancelledRan = true))();
    await new Promise<void>((resolve) => scheduler.setTimer(systemClock.now() + 10, resolve));
    expect(cancelledRan).toBe(false);
  });
});
