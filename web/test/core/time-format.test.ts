// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import { stableTicks } from '../../src/core/stable-ticks';
import { MINUS, clockText, durationText, signedText, tickText, ticksOf, wallText } from '../../src/core/time-format';
import { WALL } from '../support/views';

describe('ticksOf / tickText', () => {
  it('ceil-rounds to whole seconds, zero and below being the overrun', () => {
    expect([10_000, 9_001, 9_000, 1, 0, -1, -999, -1_000, -1_001, -2_000].map(ticksOf)).toEqual([10, 10, 9, 1, 0, 0, 0, -1, -1, -2]);
    expect(Object.is(ticksOf(-1), 0)).toBe(true);
  });

  it('formats countdowns, overruns and hours', () => {
    expect(tickText(522)).toBe('8:42');
    expect(tickText(59)).toBe('0:59');
    expect(tickText(0)).toBe('+0:00');
    expect(tickText(-72)).toBe('+1:12');
    expect(tickText(3_600)).toBe('1:00:00');
    expect(tickText(-3_725)).toBe('+1:02:05');
    expect(clockText(0)).toBe('0:00');
  });
});

describe('durationText / signedText / wallText', () => {
  it('rounds plain durations to the nearest second', () => {
    expect(durationText(184_000)).toBe('3:04');
    expect(durationText(184_499)).toBe('3:04');
    expect(durationText(184_500)).toBe('3:05');
    expect(durationText(-5)).toBe('0:00');
    expect(durationText(7_200_000)).toBe('2:00:00');
  });

  it('signs offsets with + and U+2212', () => {
    expect(signedText(42_000)).toBe('+0:42');
    expect(signedText(-15_000)).toBe(`${MINUS}0:15`);
    expect(signedText(400)).toBe('0:00');
    expect(signedText(-400)).toBe('0:00');
    expect(signedText(61_000)).toBe('+1:01');
  });

  it('formats wall time as 24-hour HH:MM:SS', () => {
    expect(wallText(WALL, 'UTC')).toBe('14:13:20');
    expect(wallText(Date.UTC(2026, 9, 12, 17, 58, 40), 'UTC')).toBe('17:58:40');
    expect(wallText(Date.UTC(2026, 9, 12, 0, 0, 5), 'UTC')).toBe('00:00:05');
  });
});

describe('stableTicks', () => {
  it('follows a normal countdown exactly on the second boundary', () => {
    let prev: number | null = null;
    const shown = [41_999, 41_001, 41_000, 40_999, 40_000].map((r) => (prev = stableTicks(prev, r)));
    expect(shown).toEqual([42, 42, 41, 41, 40]);
  });

  it('holds a one-tick step back while it is within 250 ms of the boundary', () => {
    expect(stableTicks(41, 41_100)).toBe(41);
    expect(stableTicks(41, 41_250)).toBe(41);
    expect(stableTicks(41, 41_251)).toBe(42);
    expect(stableTicks(0, 200)).toBe(0);
    expect(stableTicks(0, 300)).toBe(1);
  });

  it('shows bigger jumps at once, in either direction', () => {
    expect(stableTicks(41, 72_000)).toBe(72);
    expect(stableTicks(41, 10_000)).toBe(10);
    expect(stableTicks(null, 41_100)).toBe(42);
  });

  it('jitter around a boundary never flickers', () => {
    let prev: number | null = 42;
    const shown = [41_050, 40_990, 41_120, 40_950, 41_200, 40_900].map((r) => (prev = stableTicks(prev, r)));
    expect(shown).toEqual([42, 41, 41, 41, 41, 41]);
  });
});
