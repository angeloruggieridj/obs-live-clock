// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import { SOLO_FUTSAL_DECK } from '@olc/shared/testing';
import { computeTiming, presenterView } from '../../src/engine/index';
import { T0, liveState, run } from '../helpers';

const toWall = (m: number) => 1_790_000_000_000 + m;

describe('AC3 — camera switches never advance the block; the break scene enters the break', () => {
  it('holds', () => {
    let s = liveState();
    for (const [i, cam] of ['CAM 2', 'CAM 3', 'CAM 1', 'CAM 2'].entries()) {
      s = run(s, { type: 'ProgramSceneChanged', at: T0 + 10_000 * (i + 1), scene: cam, deckOnProgram: false });
      expect(s.cursor).toBe(0);
    }
    s = run(s, { type: 'ProgramSceneChanged', at: T0 + 700_000, scene: 'BREAK', deckOnProgram: false });
    expect(presenterView(s, T0 + 700_001, toWall).segment).toBe('break');
    expect(s.cursor).toBe(3);
    expect(presenterView(s, T0 + 700_001, toWall).block?.index).toBe(1);
  });
});

describe('AC5 — removing a service drops it from next without moving the block or program end (fixed-container blocks)', () => {
  it('holds', () => {
    let s = run(
      liveState(),
      { type: 'ProgramSceneChanged', at: T0 + 700_000, scene: 'BREAK', deckOnProgram: false },
      { type: 'ProgramSceneChanged', at: T0 + 880_000, scene: 'CAM 1', deckOnProgram: false },
    );
    expect(presenterView(s, T0 + 881_000, toWall).next).toMatchObject({ title: 'Servizio 2' });
    const before = presenterView(s, T0 + 889_000, toWall);
    s = run(s, { type: 'DeckPlaylistChanged', at: T0 + 890_000, items: [{ ...SOLO_FUTSAL_DECK[0]! }] });
    const after = presenterView(s, T0 + 889_000, toWall);
    expect(s.slotRt[5]!.status).toBe('dropped');
    expect(presenterView(s, T0 + 891_000, toWall).next).toBeNull();
    // Blocks are fixed-duration containers (SPEC §9): dropping a media never moves the block end nor the forecast end.
    expect(after.programEnd).toEqual(before.programEnd);
    expect(after.block).toEqual(before.block);
    expect(before.next?.title).toBe('Servizio 2');
    expect(after.next).toBeNull();
  });
});

describe('AC6 — OBS lost: estimated, keeps counting; restored: measured and aligned', () => {
  it('holds', () => {
    let s = run(liveState(), { type: 'SourceLost', at: T0 + 600_000 });
    let v = presenterView(s, T0 + 600_500, toWall);
    expect(v.block?.anchor).toMatchObject({ kind: 'countdown', source: 'estimated' });

    s = run(s, { type: 'Tick', at: T0 + 800_000 });
    expect(s.cursor).toBe(3); // handed over to the break at its planned time

    s = run(
      s,
      { type: 'SourceRestored', at: T0 + 820_000 },
      { type: 'ProgramSceneChanged', at: T0 + 820_000, scene: 'CAM 2', deckOnProgram: false },
    );
    v = presenterView(s, T0 + 820_001, toWall);
    expect(s.cursor).toBe(4); // reality wins: studio of block 2
    expect(v.block).toMatchObject({ index: 2, anchor: { source: 'measured' } });
    // block 2 starts early at 820 s -> full 600 000 ms target (recovery policy `keep` for an early start).
    expect(v.block!.anchor).toEqual({ kind: 'countdown', endsAt: toWall(T0 + 820_000 + 600_000), source: 'measured' });
  });
});

describe('AC8 — overrun: amber/red is derivable, recovery lands on the next elastic block', () => {
  it('holds', () => {
    let s = liveState();
    const warn = presenterView(s, T0 + 690_000, toWall);
    const anchor = warn.block!.anchor;
    if (anchor.kind !== 'countdown') throw new Error('expected countdown');
    const remaining = anchor.endsAt - toWall(T0 + 690_000);
    expect(remaining).toBeLessThan(warn.thresholds.warnMs); // client shows amber
    expect(remaining).toBeGreaterThan(0);

    const over = computeTiming(s, T0 + 750_000);
    expect(over.delayMs).toBe(30_000); // red, +0:30

    const red = presenterView(s, T0 + 750_000, toWall).block!.anchor;
    expect(red.kind).toBe('countdown');
    expect(toWall(T0 + 750_000) - (red as { endsAt: number }).endsAt).toBe(30_000); // counter 30 s past zero

    s = run(
      s,
      { type: 'ProgramSceneChanged', at: T0 + 750_000, scene: 'BREAK', deckOnProgram: false },
      { type: 'ProgramSceneChanged', at: T0 + 930_000, scene: 'CAM 1', deckOnProgram: false },
    );
    // block 2 started 30 s late -> it gets 600 000 - 30 000
    expect(s.blockRt[2]!.targetMs).toBe(570_000);
    expect(computeTiming(s, T0 + 931_000).forecast).toMatchObject({ endsAt: T0 + 1_620_000 });
  });
});

describe('Out-of-order service (Servizio 1 aired in block 2)', () => {
  it('is postponed, then aired, then the show resumes in block 2', () => {
    let s = run(
      liveState(),
      { type: 'ProgramSceneChanged', at: T0 + 700_000, scene: 'BREAK', deckOnProgram: false },
      { type: 'ProgramSceneChanged', at: T0 + 880_000, scene: 'CAM 1', deckOnProgram: false },
    );
    expect(s.slotRt[1]!.status).toBe('postponed'); // Servizio 1 postponed when the block was skipped to the break

    s = run(
      s,
      { type: 'DeckItemStarted', at: T0 + 900_000, index: 0, path: 'D:/media/servizio1.mp4', title: 'Servizio 1', durationMs: 185_000 },
      { type: 'ProgramSceneChanged', at: T0 + 900_000, scene: 'PLAYOUT', deckOnProgram: true },
    );
    const during = presenterView(s, T0 + 901_000, toWall);
    expect(during.segment).toBe('media');
    expect(during.returnTo?.blockName).toBe('Secondo blocco'); // back to where the show was interrupted
    expect(during.block?.name).toBe('Secondo blocco'); // the block clock keeps running

    const back = run(s, { type: 'ProgramSceneChanged', at: T0 + 1_085_000, scene: 'CAM 1', deckOnProgram: false });
    expect(back.cursor).toBe(4);
    expect(back.slotRt[1]!.status).toBe('done');
  });
});
