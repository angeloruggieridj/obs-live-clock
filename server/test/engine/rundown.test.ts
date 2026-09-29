// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import { SOLO_FUTSAL_DECK } from '@olc/shared/testing';
import {
  buildSlots, currentBlockIndex, firstSlotOfBlock, isElastic, lastBlockIndex,
  resolveDeckIndex, slotDuration, studioTimeMs, worstSource,
} from '../../src/engine/rundown';
import { freshState } from '../helpers';

const deck = () => SOLO_FUTSAL_DECK.map((i) => ({ ...i }));

describe('buildSlots', () => {
  it('flattens blocks into slots in order', () => {
    const s = freshState();
    expect(buildSlots(s.episode).map((x) => `${x.blockIndex}:${x.kind}`)).toEqual([
      '0:studio', '0:media', '0:studio', '1:break', '2:studio', '2:media', '2:studio', '3:studio',
    ]);
    expect(s.slots[1]).toMatchObject({ title: 'Servizio 1', path: 'D:/media/servizio1.mp4', plannedDurationMs: 180_000 });
    expect(s.slots[3]).toMatchObject({ title: 'Break 1', plannedDurationMs: 180_000 });
    expect(s.slots[0]).toMatchObject({ title: 'Primo blocco', plannedDurationMs: 0 });
  });
});

describe('createLiveState', () => {
  it('starts in preshow, before the first slot, with OBS not yet connected', () => {
    const s = freshState();
    expect(s.phase).toBe('preshow');
    expect(s.cursor).toBe(-1);
    expect(s.obs).toBe('lost');
    expect(s.slotRt.every((r) => r.status === 'pending')).toBe(true);
    expect(s.blockRt).toHaveLength(4);
  });
});

describe('resolveDeckIndex', () => {
  it('returns null while deck items are unknown', () => {
    const s = freshState();
    expect(resolveDeckIndex(null, s.slots[1]!)).toBeNull();
  });

  it('matches the n-th occurrence of the same path', () => {
    const s = freshState();
    const items = [
      { index: 0, path: 'a.mp4', title: 'A', durationMs: 1 },
      { index: 1, path: 'a.mp4', title: 'A', durationMs: 1 },
    ];
    expect(resolveDeckIndex(items, { ...s.slots[1]!, path: 'a.mp4', occurrence: 1 })).toBe(1);
    expect(resolveDeckIndex(items, { ...s.slots[1]!, path: 'a.mp4', occurrence: 2 })).toBeNull();
  });
});

describe('slotDuration', () => {
  it('uses the measured deck duration when known', () => {
    const s = freshState();
    s.deck.items = deck();
    expect(slotDuration(s, s.slots[1]!)).toEqual({ ms: 185_000, source: 'measured' });
  });

  it('unknown deck duration falls back to planned', () => {
    const s = freshState();
    s.deck.items = deck();
    s.deck.items[0]!.durationMs = -1;
    expect(slotDuration(s, s.slots[1]!)).toEqual({ ms: 180_000, source: 'planned' });
  });

  it('uses the planned duration for breaks', () => {
    const s = freshState();
    expect(slotDuration(s, s.slots[3]!)).toEqual({ ms: 180_000, source: 'planned' });
  });
});

describe('studioTimeMs', () => {
  it('subtracts media (measured when known) from the block', () => {
    const s = freshState();
    expect(studioTimeMs(s, 0)).toBe(540_000);
    s.deck.items = deck();
    expect(studioTimeMs(s, 0)).toBe(535_000);
  });

  it('ignores dropped media and is 0 for breaks', () => {
    const s = freshState();
    s.slotRt[5]!.status = 'dropped';
    expect(studioTimeMs(s, 2)).toBe(600_000);
    expect(studioTimeMs(s, 1)).toBe(0);
  });
});

describe('block helpers', () => {
  it('finds first slots, last block, elasticity and current block', () => {
    const s = freshState();
    expect(firstSlotOfBlock(s, 2)).toBe(4);
    expect(lastBlockIndex(s)).toBe(3);
    expect(isElastic(s, 0)).toBe(true);
    expect(isElastic(s, 1)).toBe(false);
    expect(currentBlockIndex(s)).toBe(-1);
    s.blockRt[0]!.startedAt = 1;
    s.blockRt[2]!.startedAt = 2;
    expect(currentBlockIndex(s)).toBe(2);
  });

  it('worstSource prefers estimated over planned over measured', () => {
    expect(worstSource('measured', 'planned')).toBe('planned');
    expect(worstSource('estimated', 'planned')).toBe('estimated');
    expect(worstSource('measured', 'measured')).toBe('measured');
  });
});
