// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import { Episode, createEpisode, formatDateIt } from '../src/index';
import { soloFutsalFormat } from '../src/testing/fixtures';

describe('createEpisode', () => {
  const input = {
    id: 'ep-1',
    date: '2026-10-12',
    plannedStart: '2026-10-12T19:00:00+02:00',
    playlistName: 'Puntata del 12/10/2026',
  };

  it('copies the format and names the episode with the date', () => {
    const ep = createEpisode(soloFutsalFormat(), input);
    expect(ep.name).toBe('Solo Futsal · 12/10/2026');
    expect(ep.formatId).toBe('solo-futsal');
    expect(ep.blocks).toHaveLength(4);
    expect(Episode.safeParse(ep).success).toBe(true);
  });

  it('is independent from the format it came from', () => {
    const format = soloFutsalFormat();
    const ep = createEpisode(format, input);
    ep.blocks[0]!.durationMs = 1_000;
    expect(format.blocks[0]!.durationMs).toBe(720_000);
  });

  it('rejects an invalid date', () => {
    expect(() => createEpisode(soloFutsalFormat(), { ...input, date: '12/10/2026' })).toThrow();
  });
});

describe('formatDateIt', () => {
  it('formats ISO dates as dd/mm/yyyy', () => {
    expect(formatDateIt('2026-10-12')).toBe('12/10/2026');
  });
});
