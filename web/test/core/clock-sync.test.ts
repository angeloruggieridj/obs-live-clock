// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import { RECONNECT_MAX_MS, reconnectDelay } from '../../src/core/backoff';
import { ClockSync } from '../../src/core/clock-sync';
import { parseParams } from '../../src/core/params';

function harness() {
  let now = 0;
  const clock = new ClockSync(() => now);
  /** A round trip starting at local t0 that took `rtt`, against a server `offset` ms ahead. */
  const pong = (t0: number, rtt: number, offset: number) => {
    now = t0 + rtt;
    return clock.addPong(t0, t0 + rtt / 2 + offset);
  };
  return { clock, pong, setNow: (v: number) => { now = v; } };
}

describe('ClockSync', () => {
  it('estimates the offset from the midpoint of the round trip', () => {
    const { clock, setNow } = harness();
    expect(clock.synced).toBe(false);
    expect(clock.sample).toBeNull();
    expect(() => clock.now()).toThrow();
    setNow(1_100);
    expect(clock.addPong(1_000, 9_000_050)).toBe(true);
    expect(clock.sample).toEqual({ offsetMs: 8_999_000, rttMs: 100 });
    setNow(2_000);
    expect(clock.now()).toBe(9_001_000);
  });

  it('keeps the minimum-RTT sample among the last 8', () => {
    const { clock, pong } = harness();
    pong(0, 30, 100);
    pong(1_000, 10, 200);
    pong(2_000, 50, 300);
    expect(clock.sample).toEqual({ offsetMs: 200, rttMs: 10 });
    for (let i = 0; i < 7; i++) pong(3_000 + i * 1_000, 40, 400); // pushes the 10 ms sample out of the window
    expect(clock.sample).toEqual({ offsetMs: 400, rttMs: 40 });
  });

  it('prefers the newest of equally fast samples', () => {
    const { clock, pong } = harness();
    pong(0, 20, 100);
    pong(1_000, 20, 150);
    expect(clock.sample?.offsetMs).toBe(150);
  });

  it('ignores impossible or useless round trips', () => {
    const { clock, setNow } = harness();
    setNow(500);
    expect(clock.addPong(1_000, 5)).toBe(false); // pong before ping
    setNow(20_000);
    expect(clock.addPong(1_000, 5)).toBe(false); // 19 s round trip
    setNow(1_000);
    expect(clock.addPong(Number.NaN, 5)).toBe(false);
    expect(clock.addPong(1_000, Number.POSITIVE_INFINITY)).toBe(false);
    expect(clock.synced).toBe(false);
  });

  it('reset forgets every sample', () => {
    const { clock, pong } = harness();
    pong(0, 10, 100);
    clock.reset();
    expect(clock.synced).toBe(false);
    pong(1_000, 50, 300);
    expect(clock.sample).toEqual({ offsetMs: 300, rttMs: 50 });
  });
});

describe('reconnectDelay', () => {
  it('doubles from 0.5 s up to 5 s', () => {
    expect([0, 1, 2, 3, 4, 10].map((n) => reconnectDelay(n, () => 0.5))).toEqual([500, 1_000, 2_000, 4_000, 5_000, 5_000]);
  });

  it('jitters by ±20 % so clients do not reconnect in lockstep', () => {
    expect(reconnectDelay(0, () => 0)).toBe(400);
    expect(reconnectDelay(0, () => 0.999)).toBe(600);
    expect(reconnectDelay(9, () => 0.999)).toBeLessThanOrEqual(RECONNECT_MAX_MS * 1.2);
  });
});

describe('parseParams', () => {
  it('reads lang and screen, with safe defaults', () => {
    expect(parseParams('?lang=en&screen=tv-1')).toEqual({ lang: 'en', screen: 'tv-1' });
    expect(parseParams('')).toEqual({ lang: 'it', screen: null });
    expect(parseParams('?lang=fr&screen=<script>')).toEqual({ lang: 'it', screen: null });
    expect(parseParams(`?screen=${'a'.repeat(33)}`).screen).toBeNull();
  });
});
