// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import {
  MAX_SCALE, MIN_BLOCK_PX, MIN_SCALE, blockKeyIntent, clampDuration, dropIndex, fitScale, layout, resizeDuration, snapMs,
} from '../../src/editor/timeline/geometry';

const key = (k: string, o: Partial<{ shiftKey: boolean; altKey: boolean; ctrlKey: boolean; metaKey: boolean }> = {}) =>
  blockKeyIntent({ key: k, shiftKey: false, altKey: false, ctrlKey: false, metaKey: false, ...o });

describe('snap and clamp', () => {
  it.each([[0, 0], [2_499, 0], [2_500, 5_000], [7_400, 5_000], [7_500, 10_000], [-3_000, -5_000]])('snapMs(%i) = %i', (a, b) => {
    expect(snapMs(a)).toBe(b);
  });
  it('clampDuration never goes below 5 s', () => {
    expect(clampDuration(0)).toBe(5_000);
    expect(clampDuration(-90_000)).toBe(5_000);
    expect(clampDuration(12_000)).toBe(10_000);
    expect(clampDuration(720_000)).toBe(720_000);
  });
});

describe('layout', () => {
  it('draws widths proportional to the duration and accumulates positions', () => {
    const s = layout([{ id: 'a', durationMs: 100_000 }, { id: 'b', durationMs: 200_000 }], 0.001);
    expect(s).toEqual([{ id: 'a', x: 0, w: 100 }, { id: 'b', x: 100, w: 200 }]);
  });
  it('keeps a minimum drawn width and adds the gap', () => {
    const s = layout([{ id: 'a', durationMs: 5_000 }, { id: 'b', durationMs: 100_000 }], 0.001, MIN_BLOCK_PX, 4);
    expect(s[0]).toEqual({ id: 'a', x: 0, w: MIN_BLOCK_PX });
    expect(s[1]).toEqual({ id: 'b', x: MIN_BLOCK_PX + 4, w: 100 });
  });
  it('fitScale fits the total into the width, within the zoom limits', () => {
    expect(fitScale(1_000_000, 1_000)).toBeCloseTo(0.001);
    expect(fitScale(10_000_000, 1_000)).toBe(MIN_SCALE); // 0.0001 would be below the minimum zoom
    expect(fitScale(100_000, 1_000)).toBeCloseTo(0.01);
    expect(fitScale(1_000, 100_000)).toBe(MAX_SCALE);
    expect(fitScale(0, 500)).toBe(0.02);
    expect(fitScale(500, 0)).toBe(0.02);
  });
});

describe('dropIndex (final index of the dragged block)', () => {
  // A 0-100 (centre 50) · B 100-200 (150) · C 200-300 (250)
  const equal = layout([{ id: 'A', durationMs: 100_000 }, { id: 'B', durationMs: 100_000 }, { id: 'C', durationMs: 100_000 }], 0.001);
  // A 0-100 (50) · B 100-500 (300) · C 500-600 (550)
  const wide = layout([{ id: 'A', durationMs: 100_000 }, { id: 'B', durationMs: 400_000 }, { id: 'C', durationMs: 100_000 }], 0.001);

  it('stays put until the dragged centre passes a neighbour centre', () => {
    expect(dropIndex(equal, 'A', 0)).toBe(0);
    expect(dropIndex(equal, 'A', 99)).toBe(0); // centre 149 < 150
    expect(dropIndex(equal, 'A', 101)).toBe(1); // centre 151 > 150
    expect(dropIndex(equal, 'A', 201)).toBe(2);
  });
  it('goes to the very first and very last place', () => {
    expect(dropIndex(equal, 'C', -1_000)).toBe(0);
    expect(dropIndex(equal, 'A', 1_000)).toBe(2);
  });
  it('moves a middle block both ways', () => {
    expect(dropIndex(equal, 'B', -101)).toBe(0);
    expect(dropIndex(equal, 'B', 101)).toBe(2);
    expect(dropIndex(equal, 'B', 40)).toBe(1);
  });
  it("is correct with a wide neighbour (uses the dragged block's own centre)", () => {
    expect(dropIndex(wide, 'A', 200)).toBe(0); // centre 250 < 300
    expect(dropIndex(wide, 'A', 260)).toBe(1); // centre 310 > 300
    expect(dropIndex(wide, 'C', -300)).toBe(1); // centre 250: past A (50), not past B (300)
    expect(dropIndex(wide, 'C', -240)).toBe(2); // centre 310: past B too, so C stays last
  });
  it('returns -1 for an unknown block', () => {
    expect(dropIndex(equal, 'Z', 10)).toBe(-1);
  });
});

describe('resizeDuration', () => {
  it('converts pixels to time, snaps to 5 s and clamps', () => {
    expect(resizeDuration(60_000, 50, 0.01)).toBe(65_000);
    expect(resizeDuration(60_000, 26, 0.01)).toBe(65_000); // 62 600 ms -> 65 000
    expect(resizeDuration(60_000, 24, 0.01)).toBe(60_000); // 62 400 ms -> 60 000
    expect(resizeDuration(60_000, -10_000, 0.01)).toBe(5_000);
    expect(resizeDuration(60_000, 100, 0)).toBe(60_000);
  });
});

describe('blockKeyIntent', () => {
  it('maps the documented keys', () => {
    expect(key('ArrowRight')).toEqual({ type: 'select', delta: 1 });
    expect(key('ArrowLeft')).toEqual({ type: 'select', delta: -1 });
    expect(key('ArrowRight', { altKey: true })).toEqual({ type: 'move', delta: 1 });
    expect(key('ArrowLeft', { altKey: true })).toEqual({ type: 'move', delta: -1 });
    expect(key('ArrowRight', { shiftKey: true })).toEqual({ type: 'resize', deltaMs: 5_000 });
    expect(key('ArrowLeft', { shiftKey: true })).toEqual({ type: 'resize', deltaMs: -5_000 });
    expect(key('ArrowRight', { shiftKey: true, ctrlKey: true })).toEqual({ type: 'resize', deltaMs: 60_000 });
    expect(key('ArrowLeft', { shiftKey: true, metaKey: true })).toEqual({ type: 'resize', deltaMs: -60_000 });
    expect(key('Delete')).toEqual({ type: 'delete' });
    expect(key('d', { ctrlKey: true })).toEqual({ type: 'duplicate' });
    expect(key('D', { metaKey: true })).toEqual({ type: 'duplicate' });
  });
  it('ignores everything else so the browser keeps its defaults', () => {
    expect(key('a')).toBeNull();
    expect(key('ArrowRight', { ctrlKey: true })).toBeNull();
    expect(key('Delete', { ctrlKey: true })).toBeNull();
    expect(key('d')).toBeNull();
    expect(key('Tab')).toBeNull();
  });
});
