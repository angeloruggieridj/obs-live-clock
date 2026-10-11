// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import { STALE_BLANK_MS, anchorFrame, remainingAt } from '../../src/core/anchor';
import type { Anchor, Source } from '../../src/core/views';
import { WALL } from '../support/views';

const cd = (endsAt: number, source: Source = 'measured'): Anchor => ({ kind: 'countdown', endsAt, source });

describe('remainingAt', () => {
  it('is signed for countdowns, constant for frozen values, null for unknown', () => {
    expect(remainingAt(cd(WALL + 5_000), WALL)).toBe(5_000);
    expect(remainingAt(cd(WALL - 5_000), WALL)).toBe(-5_000);
    expect(remainingAt({ kind: 'frozen', valueMs: 7_000, source: 'measured' }, WALL + 99_000)).toBe(7_000);
    expect(remainingAt({ kind: 'unknown' }, WALL)).toBeNull();
  });
});

describe('anchorFrame', () => {
  it('counts down from the anchor at server time', () => {
    expect(anchorFrame(cd(WALL + 522_000), WALL, null, null)).toEqual({
      text: '8:42', ticks: 522, remainingMs: 522_000, source: 'measured', paused: false, stale: false,
    });
    expect(anchorFrame(cd(WALL - 72_000, 'estimated'), WALL, null, null)).toMatchObject({ text: '+1:12', ticks: -72, source: 'estimated' });
  });

  it('shows a frozen anchor as a paused value that does not move', () => {
    const a: Anchor = { kind: 'frozen', valueMs: 300_000, source: 'measured' };
    expect(anchorFrame(a, WALL, null, null)).toMatchObject({ text: '5:00', paused: true });
    expect(anchorFrame(a, WALL + 60_000, null, 300).text).toBe('5:00');
  });

  it('shows "—" for unknown and missing anchors', () => {
    expect(anchorFrame({ kind: 'unknown' }, WALL, null, null)).toEqual({
      text: '—', ticks: null, remainingMs: null, source: null, paused: false, stale: false,
    });
    expect(anchorFrame(null, WALL, null, null).text).toBe('—');
  });

  it('freezes at the stale instant instead of counting on, then blanks after 10 s', () => {
    const a = cd(WALL + 60_000);
    expect(anchorFrame(a, WALL + 5_000, WALL, null)).toMatchObject({ text: '1:00', stale: true });
    expect(anchorFrame(a, WALL + STALE_BLANK_MS, WALL, null).text).toBe('1:00');
    expect(anchorFrame(a, WALL + STALE_BLANK_MS + 1, WALL, null)).toMatchObject({ text: '—', ticks: null, stale: true, source: 'measured' });
    expect(anchorFrame(a, WALL, Number.NEGATIVE_INFINITY, null).text).toBe('—');
  });

  it('applies the hysteresis through the previous ticks', () => {
    expect(anchorFrame(cd(WALL + 41_100), WALL, null, 41).text).toBe('0:41');
    expect(anchorFrame(cd(WALL + 41_100), WALL, null, null).text).toBe('0:42');
  });

  it('blanks on a non-finite "now", keeping the source', () => {
    expect(anchorFrame(cd(WALL + 60_000), Number.NaN, null, null)).toEqual({
      text: '—', ticks: null, remainingMs: null, source: 'measured', paused: false, stale: false,
    });
    expect(anchorFrame(cd(WALL + 60_000), Number.POSITIVE_INFINITY, null, null)).toEqual({
      text: '—', ticks: null, remainingMs: null, source: 'measured', paused: false, stale: false,
    });
  });

  it('blanks on a NaN "staleSince", while -Infinity stays blank as today', () => {
    expect(anchorFrame(cd(WALL + 60_000), WALL, Number.NaN, null)).toEqual({
      text: '—', ticks: null, remainingMs: null, source: 'measured', paused: false, stale: true,
    });
    expect(anchorFrame(cd(WALL + 60_000), WALL, Number.NEGATIVE_INFINITY, null)).toMatchObject({
      text: '—', ticks: null, remainingMs: null, source: 'measured', stale: true,
    });
  });

  it('blanks when the anchor value is not finite', () => {
    expect(anchorFrame({ kind: 'frozen', valueMs: Number.NaN, source: 'measured' }, WALL, null, null)).toEqual({
      text: '—', ticks: null, remainingMs: null, source: 'measured', paused: false, stale: false,
    });
    expect(anchorFrame({ kind: 'frozen', valueMs: Number.POSITIVE_INFINITY, source: 'measured' }, WALL, null, null).text).toBe('—');
    expect(anchorFrame(cd(Number.NaN), WALL, null, null).text).toBe('—');
    expect(anchorFrame(cd(Number.POSITIVE_INFINITY), WALL, null, null).text).toBe('—');
  });
});
