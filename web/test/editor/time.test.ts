// SPDX-License-Identifier: GPL-2.0-or-later
import { Episode } from '@olc/shared';
import { soloFutsalEpisode, soloFutsalFormat } from '@olc/shared/testing';
import { describe, expect, it } from 'vitest';
import { blockOffsets, blockTimings, localDate, plannedEndMs, timeOfDay, toIsoWithOffset, totalMs } from '../../src/editor/model/time';

describe('time math', () => {
  const f = soloFutsalFormat();
  it('computes offsets and the total', () => {
    expect(blockOffsets(f.blocks)).toEqual([0, 720_000, 900_000, 1_500_000]);
    expect(totalMs(f.blocks)).toBe(1_620_000);
  });
  it('computes the planned end from the planned start', () => {
    expect(plannedEndMs('2026-10-12T19:00:00+02:00', 1_620_000)).toBe(Date.parse('2026-10-12T17:27:00Z'));
    expect(plannedEndMs(null, 1)).toBeNull();
    expect(plannedEndMs('not a date', 1)).toBeNull();
  });
  it('computes studio time per block (duration minus media) and null for a break', () => {
    const t = blockTimings(f.blocks);
    expect(t.map((x) => x.studioMs)).toEqual([540_000, null, 480_000, 120_000]);
    expect(t[1]).toMatchObject({ startMs: 720_000, endMs: 900_000 });
  });
  it('localDate uses the local calendar date', () => {
    expect(localDate(new Date(2026, 9, 5, 23, 59))).toBe('2026-10-05');
  });
  it('toIsoWithOffset names the same instant as the local wall time and satisfies the Episode schema', () => {
    const iso = toIsoWithOffset('2026-10-12', '19:30');
    expect(iso).toMatch(/^2026-10-12T19:30:00[+-]\d{2}:\d{2}$/);
    expect(Date.parse(iso)).toBe(new Date(2026, 9, 12, 19, 30).getTime());
    expect(Episode.safeParse({ ...soloFutsalEpisode(), plannedStart: iso }).success).toBe(true);
  });
  it('timeOfDay is the local HH:MM of an ISO datetime', () => {
    expect(timeOfDay(toIsoWithOffset('2026-10-12', '19:30'))).toBe('19:30');
    expect(timeOfDay(null)).toBeNull();
    expect(timeOfDay('nope')).toBeNull();
  });
  it('counts media with an unknown duration', () => {
    const g = structuredClone(f);
    const b = g.blocks[0]!;
    if (b.kind === 'studio') b.elements = b.elements.map((e) => (e.kind === 'media' ? { ...e, plannedDurationMs: 0, durationSource: 'unknown' as const } : e));
    expect(blockTimings(g.blocks)[0]!.unknownMedia).toBe(1);
  });
});
