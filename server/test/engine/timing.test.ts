// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import { blockEndsAt, plannedEndAt, plannedStartAt, targetForBlockStart } from '../../src/engine/timing';
import { T0, freshState } from '../helpers';

function started() {
  const s = freshState();
  s.t0 = T0;
  return s;
}

describe('planned schedule', () => {
  it('is null before the program starts', () => {
    expect(plannedStartAt(freshState(), 0)).toBeNull();
  });

  it('adds original block durations from t0', () => {
    const s = started();
    expect(plannedStartAt(s, 0)).toBe(T0);
    expect(plannedStartAt(s, 2)).toBe(T0 + 900_000);
    expect(plannedEndAt(s, 3)).toBe(T0 + 1_620_000);
  });

  it('ignores adjustments (the plan is the official rundown)', () => {
    const s = started();
    s.blockRt[0]!.adjustMs = 60_000;
    expect(plannedStartAt(s, 1)).toBe(T0 + 720_000);
  });
});

describe('targetForBlockStart', () => {
  it('is the block duration when on time', () => {
    const s = started();
    expect(targetForBlockStart(s, 2, T0 + 900_000)).toBe(600_000);
  });

  it('absorbs lateness from studio time of an elastic block', () => {
    const s = started();
    expect(targetForBlockStart(s, 2, T0 + 990_000)).toBe(510_000);
  });

  it('never absorbs more than the studio time', () => {
    const s = started();
    // b2 studio time = 600 000 - 120 000 = 480 000
    expect(targetForBlockStart(s, 2, T0 + 900_000 + 500_000)).toBe(120_000);
  });

  it('does not absorb on a non-elastic block (break)', () => {
    const s = started();
    expect(targetForBlockStart(s, 1, T0 + 800_000)).toBe(180_000);
  });

  it('keeps the gain when the block starts early', () => {
    const s = started();
    expect(targetForBlockStart(s, 2, T0 + 870_000)).toBe(600_000);
  });

  it('includes adjustments', () => {
    const s = started();
    s.blockRt[2]!.adjustMs = 30_000;
    expect(targetForBlockStart(s, 2, T0 + 900_000)).toBe(630_000);
  });
});

describe('blockEndsAt', () => {
  it('is start + target once started, null otherwise', () => {
    const s = started();
    expect(blockEndsAt(s, 0)).toBeNull();
    s.blockRt[0] = { startedAt: T0, endedAt: null, adjustMs: 0, targetMs: 720_000 };
    expect(blockEndsAt(s, 0)).toBe(T0 + 720_000);
  });
});
