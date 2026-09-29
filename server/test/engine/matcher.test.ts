// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import { SOLO_FUTSAL_DECK } from '@olc/shared/testing';
import { correctTo, moveTo } from '../../src/engine/cursor';
import { classify, match } from '../../src/engine/matcher';
import type { LiveState } from '../../src/engine/types';
import { T0, freshState } from '../helpers';

function live(): LiveState {
  const s = freshState();
  s.phase = 'live';
  s.t0 = T0;
  s.deck.items = SOLO_FUTSAL_DECK.map((i) => ({ ...i }));
  s.program = { scene: 'CAM 1', deckOnProgram: false };
  moveTo(s, 0, T0);
  return s;
}

function onScene(s: LiveState, scene: string, at: number) {
  s.program = { scene, deckOnProgram: false };
  match(s, at);
}

function deckPlays(s: LiveState, index: number, at: number) {
  const item = s.deck.items?.find((i) => i.index === index);
  s.deck.current = {
    index, path: item?.path ?? 'D:/media/servizio1.mp4', title: item?.title ?? '', positionMs: 0,
    durationMs: item?.durationMs ?? 1000, playing: true, at,
  };
  s.program = { scene: 'PLAYOUT', deckOnProgram: true };
  match(s, at);
}

const statuses = (s: LiveState) => s.slotRt.map((r) => r.status);

describe('moveTo from the start', () => {
  it('puts slot 0 on air and starts block 0 with its target', () => {
    const s = live();
    expect(s.cursor).toBe(0);
    expect(s.slotRt[0]).toEqual({ status: 'onair', startedAt: T0, endedAt: null });
    expect(s.blockRt[0]).toMatchObject({ startedAt: T0, targetMs: 720_000 });
  });
});

describe('classify', () => {
  it('prefers deck media on program over the scene', () => {
    const s = live();
    s.deck.current = { index: 0, path: 'D:/media/servizio1.mp4', title: 'Servizio 1', positionMs: 0, durationMs: 185_000, playing: true, at: T0 };
    s.program = { scene: 'CAM 1', deckOnProgram: true };
    expect(classify(s)).toEqual({ kind: 'media', index: 0, path: 'D:/media/servizio1.mp4' });
  });

  it('recognises break and studio scenes, and nothing else', () => {
    const s = live();
    s.program = { scene: 'BREAK', deckOnProgram: false };
    expect(classify(s)).toEqual({ kind: 'break', scene: 'BREAK' });
    s.program = { scene: 'CAM 3', deckOnProgram: false };
    expect(classify(s)).toEqual({ kind: 'studio', scene: 'CAM 3' });
    s.program = { scene: 'CAMERA OSPITE', deckOnProgram: false };
    expect(classify(s)).toBeNull();
  });
});

describe('match', () => {
  it('does not advance on a camera switch within the studio group', () => {
    const s = live();
    onScene(s, 'CAM 2', T0 + 5_000);
    expect(s.cursor).toBe(0);
  });

  it('follows studio -> media -> studio -> break -> studio', () => {
    const s = live();
    deckPlays(s, 0, T0 + 60_000);
    expect(s.cursor).toBe(1);
    expect(s.slotRt[0]).toMatchObject({ status: 'done', endedAt: T0 + 60_000 });
    onScene(s, 'CAM 1', T0 + 245_000);
    expect(s.cursor).toBe(2);
    onScene(s, 'BREAK', T0 + 720_000);
    expect(s.cursor).toBe(3);
    expect(s.blockRt[0]!.endedAt).toBe(T0 + 720_000);
    expect(s.blockRt[1]!.startedAt).toBe(T0 + 720_000);
    onScene(s, 'CAM 1', T0 + 900_000);
    expect(s.cursor).toBe(4);
    expect(s.blockRt[2]).toMatchObject({ startedAt: T0 + 900_000, targetMs: 600_000 });
  });

  it('postpones skipped media and closes skipped studio slots', () => {
    const s = live();
    onScene(s, 'BREAK', T0 + 700_000);
    expect(s.cursor).toBe(3);
    expect(statuses(s).slice(0, 4)).toEqual(['done', 'postponed', 'done', 'onair']);
  });

  it('unknown scene is off-script: cursor and block unchanged', () => {
    const s = live();
    onScene(s, 'CAMERA OSPITE', T0 + 30_000);
    expect(s.cursor).toBe(0);
    expect(s.offScript).toEqual({ scene: 'CAMERA OSPITE', since: T0 + 30_000 });
    expect(s.blockRt[0]!.endedAt).toBeNull();
    onScene(s, 'CAM 1', T0 + 40_000);
    expect(s.offScript).toBeNull();
    expect(s.cursor).toBe(0);
  });

  it('airs a postponed item out of order and returns to where it was', () => {
    const s = live();
    onScene(s, 'BREAK', T0 + 700_000); // Servizio 1 postponed
    onScene(s, 'CAM 1', T0 + 880_000); // block 2 studio, slot 4
    deckPlays(s, 0, T0 + 900_000); // Servizio 1 now
    expect(s.cursor).toBe(1);
    expect(s.returnSlot).toBe(4);
    expect(s.slotRt[1]!.status).toBe('onair');
    onScene(s, 'CAM 2', T0 + 1_085_000);
    expect(s.cursor).toBe(4);
    expect(s.returnSlot).toBeNull();
    expect(s.slotRt[1]).toMatchObject({ status: 'done', endedAt: T0 + 1_085_000 });
  });

  it('same file twice: the second occurrence matches the second playlist item', () => {
    const s = live();
    const b2 = s.episode.blocks[2]!;
    if (b2.kind !== 'studio') throw new Error('fixture changed');
    s.slots[5] = { ...s.slots[5]!, path: 'D:/media/servizio1.mp4', occurrence: 1 };
    s.deck.items = [
      { index: 0, path: 'D:/media/servizio1.mp4', title: 'Servizio 1', durationMs: 185_000 },
      { index: 1, path: 'D:/media/servizio1.mp4', title: 'Servizio 1 (replica)', durationMs: 185_000 },
    ];
    deckPlays(s, 1, T0 + 10_000);
    expect(s.cursor).toBe(5);
    expect(s.slotRt[1]!.status).toBe('postponed');
  });

  it('matches by path when deck items are unknown', () => {
    const s = live();
    s.deck.items = null;
    s.deck.current = { index: 7, path: 'D:/media/servizio2.mp4', title: '', positionMs: 0, durationMs: 120_000, playing: true, at: T0 };
    s.program = { scene: 'PLAYOUT', deckOnProgram: true };
    match(s, T0 + 20_000);
    expect(s.cursor).toBe(5);
  });

  it('marks deck media that is not in the rundown as off-script', () => {
    const s = live();
    s.deck.items = [...s.deck.items!, { index: 2, path: 'D:/media/extra.mp4', title: 'Extra', durationMs: 30_000 }];
    s.deck.current = { index: 2, path: 'D:/media/extra.mp4', title: 'Extra', positionMs: 0, durationMs: 30_000, playing: true, at: T0 };
    s.program = { scene: 'PLAYOUT', deckOnProgram: true };
    match(s, T0 + 20_000);
    expect(s.cursor).toBe(0);
    expect(s.offScript).toEqual({ scene: 'PLAYOUT', since: T0 + 20_000 });
  });
});

describe('correctTo', () => {
  it('moves back, resets later slots and un-starts later blocks', () => {
    const s = live();
    onScene(s, 'BREAK', T0 + 700_000);
    onScene(s, 'CAM 1', T0 + 880_000);
    correctTo(s, 2, T0 + 890_000);
    expect(s.cursor).toBe(2);
    expect(s.slotRt[2]).toMatchObject({ status: 'onair' });
    expect(s.slotRt[3]!.status).toBe('pending');
    expect(s.slotRt[4]!.status).toBe('pending');
    expect(s.blockRt[1]!.startedAt).toBeNull();
    expect(s.blockRt[2]!.startedAt).toBeNull();
    expect(s.blockRt[0]!.endedAt).toBeNull();
  });
});
