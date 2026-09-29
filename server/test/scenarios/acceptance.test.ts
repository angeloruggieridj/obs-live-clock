// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import { SOLO_FUTSAL_DECK } from '@olc/shared/testing';
import { computeTiming, nextTickAt, presenterView } from '../../src/engine/index';
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
    // The hand-over to the break was made by time while OBS was lost, so it was provisional: studio on
    // Program after the restore means the pre-loss block 1 studio slot (the break was never observed).
    expect(s.cursor).toBe(0);
    expect(v.block).toEqual({ index: 0, name: 'Primo blocco', anchor: { kind: 'countdown', endsAt: toWall(T0 + 720_000), source: 'measured' } });

    // From here Program drives: the observed break and studio realign the clock, measured.
    s = run(
      s,
      { type: 'ProgramSceneChanged', at: T0 + 830_000, scene: 'BREAK', deckOnProgram: false },
      { type: 'ProgramSceneChanged', at: T0 + 1_010_000, scene: 'CAM 2', deckOnProgram: false },
    );
    v = presenterView(s, T0 + 1_010_001, toWall);
    expect(s.cursor).toBe(4);
    // block 2 starts 110 s late -> 600 000 - 110 000 target (recovery policy next_elastic).
    expect(v.block).toEqual({ index: 2, name: 'Secondo blocco', anchor: { kind: 'countdown', endsAt: toWall(T0 + 1_500_000), source: 'measured' } });
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
    expect(over.delay).toEqual({ ms: 30_000, source: 'measured' }); // red, +0:30

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

describe('Golden path — adjacent studio blocks hand over by time and REC stop ends the program', () => {
  it('holds', () => {
    const scene = (at: number, name: string, deckOnProgram = false) =>
      ({ type: 'ProgramSceneChanged', at: T0 + at, scene: name, deckOnProgram }) as const;
    let s = run(
      liveState(),
      scene(100_000, 'CAM 2'),
      { type: 'DeckItemStarted', at: T0 + 200_000, index: 0, path: 'D:/media/servizio1.mp4', title: 'Servizio 1', durationMs: 185_000 },
      scene(200_000, 'PLAYOUT', true),
      scene(385_000, 'CAM 1'),
      scene(720_000, 'BREAK'),
      scene(900_000, 'CAM 3'),
      { type: 'DeckItemStarted', at: T0 + 1_100_000, index: 1, path: 'D:/media/servizio2.mp4', title: 'Servizio 2', durationMs: 120_000 },
      scene(1_100_000, 'PLAYOUT', true),
      scene(1_220_000, 'CAM 2'),
    );
    expect(s.cursor).toBe(6);
    expect(s.blockRt[2]!.startedAt).toBe(T0 + 900_000);

    // Block 2 target expires at 900 000 + 600 000: nothing observable marks the boundary, time hands over.
    s = run(s, { type: 'Tick', at: T0 + 1_500_000 });
    expect(s.cursor).toBe(7);
    const v = presenterView(s, T0 + 1_500_001, toWall);
    expect(v.block).toMatchObject({ index: 3, name: 'Chiusura', anchor: { kind: 'countdown', source: 'planned' } });

    s = run(s, { type: 'Tick', at: T0 + 1_625_000 });
    expect(computeTiming(s, T0 + 1_625_000).rundownFinished).toBe(true);

    s = run(s, { type: 'OutputChanged', at: T0 + 1_625_000, output: 'rec', state: 'stopped' });
    expect(s.phase).toBe('ended');
    expect(s.decisions.filter((d) => !d.confirmed)).toEqual([]);
  });
});

describe('R2 — time hand-over skips only dropped slots (and studio slots that follow them)', () => {
  const scene = (at: number, name: string, deckOnProgram = false) =>
    ({ type: 'ProgramSceneChanged', at: T0 + at, scene: name, deckOnProgram }) as const;

  const toBlock2Studio = () =>
    run(
      liveState(),
      scene(100_000, 'CAM 2'),
      { type: 'DeckItemStarted', at: T0 + 200_000, index: 0, path: 'D:/media/servizio1.mp4', title: 'Servizio 1', durationMs: 185_000 },
      scene(200_000, 'PLAYOUT', true),
      scene(385_000, 'CAM 1'),
      scene(720_000, 'BREAK'),
      scene(900_000, 'CAM 3'),
    );

  it('a dropped Servizio 2 does not block the hand-over past the block-2 studio slots', () => {
    let s = toBlock2Studio();
    expect(s.cursor).toBe(4);

    s = run(
      s,
      { type: 'DeckPlaylistChanged', at: T0 + 950_000, items: [{ ...SOLO_FUTSAL_DECK[0]! }] },
      scene(1_000_000, 'CAM 2'),
    );
    expect(s.slotRt[5]!.status).toBe('dropped');
    expect(s.cursor).toBe(4);

    s = run(s, { type: 'Tick', at: T0 + 1_625_000 });
    expect(s.cursor).toBe(7); // Chiusura: block 2's studio slots and the dropped media never block the hand-over
    expect(computeTiming(s, T0 + 1_745_000).rundownFinished).toBe(true);

    s = run(s, { type: 'OutputChanged', at: T0 + 1_750_000, output: 'rec', state: 'stopped' });
    expect(s.phase).toBe('ended');
    expect(s.decisions.filter((d) => !d.confirmed)).toEqual([]);
  });

  it('a Servizio 2 still pending (not dropped) blocks the hand-over: the block overruns in red instead', () => {
    let s = run(toBlock2Studio(), scene(1_000_000, 'CAM 2'));
    expect(s.cursor).toBe(4);

    s = run(s, { type: 'Tick', at: T0 + 1_625_000 });
    expect(s.cursor).toBe(4); // no hand-over: Servizio 2 is still owed, so block 2 keeps counting
    expect(nextTickAt(s)).toBeNull();
    const t = computeTiming(s, T0 + 1_625_000);
    expect(t.blockIndex).toBe(2);
    expect(t.block).toMatchObject({ endsAt: T0 + 1_500_000 }); // in the past: the block is overrunning

    s = run(
      s,
      { type: 'DeckItemStarted', at: T0 + 1_650_000, index: 1, path: 'D:/media/servizio2.mp4', title: 'Servizio 2', durationMs: 120_000 },
      scene(1_650_000, 'PLAYOUT', true),
    );
    expect(s.cursor).toBe(5); // normal forward match into block 2, no out-of-order excursion
    expect(s.returnSlot).toBeNull();
  });
});

describe('OBS drop near a block end: estimated hand-overs are provisional', () => {
  it('restore + studio returns to the pre-loss slot; the real break then enters the break', () => {
    let s = run(
      liveState(),
      { type: 'SourceLost', at: T0 + 715_000 },
      { type: 'Tick', at: T0 + 720_000 },
    );
    expect(s.cursor).toBe(3); // provisional: break by time
    s = run(
      s,
      { type: 'SourceRestored', at: T0 + 725_000 },
      { type: 'ProgramSceneChanged', at: T0 + 725_000, scene: 'CAM 1', deckOnProgram: false },
    );
    expect(s.cursor).toBe(0); // back on the block 1 studio slot it was on before the loss
    expect(s.slotRt[3]!.status).toBe('pending');
    expect(s.blockRt[1]).toMatchObject({ startedAt: null, startedBy: null });
    expect(s.preLossCursor).toBeNull();
    expect(s.resyncPending).toBe(false);
    expect(presenterView(s, T0 + 726_000, toWall).block).toMatchObject({ index: 0, anchor: { source: 'measured' } });

    s = run(s, { type: 'ProgramSceneChanged', at: T0 + 760_000, scene: 'BREAK', deckOnProgram: false });
    const v = presenterView(s, T0 + 761_000, toWall);
    expect(s.cursor).toBe(3);
    expect(v.segment).toBe('break');
    expect(v.returnTo).toMatchObject({ blockName: 'Secondo blocco', anchor: { kind: 'countdown' } });
    expect(v.block).toMatchObject({ index: 1, anchor: { source: 'measured' } });
  });

  it('a restore that confirms the provisional position keeps it', () => {
    const s = run(
      liveState(),
      { type: 'SourceLost', at: T0 + 715_000 },
      { type: 'Tick', at: T0 + 720_000 },
      { type: 'SourceRestored', at: T0 + 725_000 },
      { type: 'ProgramSceneChanged', at: T0 + 725_000, scene: 'BREAK', deckOnProgram: false },
    );
    expect(s.cursor).toBe(3);
    // R1: OBS confirms the provisional position, so it is kept as-is rather than rolled back and
    // re-matched — the block keeps its time hand-over start, not the moment it was confirmed.
    expect(s.blockRt[1]!.startedAt).toBe(T0 + 720_000);
    expect(s.blockRt[1]!.startedBy).toBe('time');
  });

  it("R1': a restore that confirms a provisional studio position stays ambiguous until a real media/break match", () => {
    let s = run(
      liveState(),
      { type: 'SourceLost', at: T0 + 600_000 },
      { type: 'Tick', at: T0 + 1_000_000 },
    );
    expect(s.cursor).toBe(4); // estimated loop: hands over through the break into block 2 studio

    s = run(
      s,
      { type: 'SourceRestored', at: T0 + 1_000_000 },
      { type: 'ProgramSceneChanged', at: T0 + 1_000_000, scene: 'CAM 2', deckOnProgram: false },
    );
    // CAM 2 confirms the provisional block-2 studio slot: no rollback to the pre-loss block 1 slot. But the
    // break the estimating loop guessed its way through was never actually observed, so the position is
    // ambiguous and the clock keeps degrading like OBS is still lost until that gap is resolved.
    expect(s.cursor).toBe(4);
    expect(s.ambiguous).toBe(true);
    expect(presenterView(s, T0 + 1_000_001, toWall).block).toMatchObject({ index: 2, anchor: { source: 'estimated' } });
    expect(s.preLossCursor).toBeNull();
    expect(s.resyncPending).toBe(false);

    s = run(
      s,
      { type: 'DeckItemStarted', at: T0 + 1_100_000, index: 1, path: 'D:/media/servizio2.mp4', title: 'Servizio 2', durationMs: 120_000 },
      { type: 'ProgramSceneChanged', at: T0 + 1_100_000, scene: 'PLAYOUT', deckOnProgram: true },
    );
    // Servizio 2 airing is a real, normal media observation: it resolves the ambiguity.
    expect(s.cursor).toBe(5);
    expect(s.ambiguous).toBe(false);
    // The break aired by time while OBS was lost: it is 'done', not 'postponed' by a rollback that never happened.
    expect(s.slotRt[3]!.status).toBe('done');
  });

  it("R1': a restore confirming studio with no unobserved gap behind it is not ambiguous", () => {
    // A short outage entirely inside a single studio block never crosses a break or media slot, so there is
    // nothing behind the confirmed position that could still be wrong.
    const s = run(
      liveState(),
      { type: 'SourceLost', at: T0 + 50_000 },
      { type: 'Tick', at: T0 + 80_000 },
      { type: 'SourceRestored', at: T0 + 90_000 },
      { type: 'ProgramSceneChanged', at: T0 + 90_000, scene: 'CAM 2', deckOnProgram: false },
    );
    expect(s.cursor).toBe(0);
    expect(s.ambiguous).toBe(false);
  });

  it("R1': an ambiguous position is resolved by the real break, then hands over to block 2 as observed", () => {
    let s = run(
      liveState(),
      { type: 'ProgramSceneChanged', at: T0 + 100_000, scene: 'CAM 2', deckOnProgram: false },
      { type: 'DeckItemStarted', at: T0 + 200_000, index: 0, path: 'D:/media/servizio1.mp4', title: 'Servizio 1', durationMs: 185_000 },
      { type: 'ProgramSceneChanged', at: T0 + 200_000, scene: 'PLAYOUT', deckOnProgram: true },
      { type: 'ProgramSceneChanged', at: T0 + 385_000, scene: 'CAM 1', deckOnProgram: false },
    );
    expect(s.cursor).toBe(2); // b1-s2, studio, block 0

    s = run(s, { type: 'SourceLost', at: T0 + 700_000 }, { type: 'Tick', at: T0 + 950_000 });
    expect(s.cursor).toBe(4); // estimating loop guesses its way through the break into block 2 studio

    s = run(
      s,
      { type: 'SourceRestored', at: T0 + 950_000 },
      { type: 'ProgramSceneChanged', at: T0 + 950_000, scene: 'CAM 1', deckOnProgram: false },
    );
    expect(s.cursor).toBe(4);
    expect(s.ambiguous).toBe(true);
    expect(presenterView(s, T0 + 950_001, toWall).block).toMatchObject({ index: 2, anchor: { source: 'estimated' } });

    // The real break arrives: it is behind the confirmed studio position, but it was never actually
    // observed, so this is a correction (not an out-of-order excursion) and block 1 restarts as observed.
    s = run(s, { type: 'ProgramSceneChanged', at: T0 + 1_000_000, scene: 'BREAK', deckOnProgram: false });
    expect(s.cursor).toBe(3);
    expect(presenterView(s, T0 + 1_000_001, toWall).segment).toBe('break');
    expect(s.ambiguous).toBe(false);
    expect(s.blockRt[1]).toMatchObject({ startedAt: T0 + 1_000_000, startedBy: 'obs' });

    s = run(s, { type: 'ProgramSceneChanged', at: T0 + 1_180_000, scene: 'CAM 2', deckOnProgram: false });
    expect(s.cursor).toBe(4);
    expect(s.blockRt[2]).toMatchObject({ startedBy: 'obs' });
  });

  it('an operator command during the loss is not undone by the restore', () => {
    const s = run(
      liveState(),
      { type: 'SourceLost', at: T0 + 700_000 },
      { type: 'Goto', at: T0 + 710_000, slot: 2 },
      { type: 'Tick', at: T0 + 720_000 },
      { type: 'SourceRestored', at: T0 + 725_000 },
      { type: 'ProgramSceneChanged', at: T0 + 725_000, scene: 'CAM 1', deckOnProgram: false },
    );
    expect(s.cursor).toBe(2);
  });
});

describe('Brief cutaway to studio during a clip', () => {
  const onAir = () =>
    run(
      liveState(),
      { type: 'DeckItemStarted', at: T0 + 60_000, index: 0, path: 'D:/media/servizio1.mp4', title: 'Servizio 1', durationMs: 185_000 },
      { type: 'ProgramSceneChanged', at: T0 + 60_000, scene: 'PLAYOUT', deckOnProgram: true },
      { type: 'ProgramSceneChanged', at: T0 + 90_000, scene: 'CAM 2', deckOnProgram: false },
    );

  it('re-enters the clip, returns to the studio slot on the next cut', () => {
    let s = onAir();
    expect(s.cursor).toBe(2);
    s = run(s, { type: 'ProgramSceneChanged', at: T0 + 95_000, scene: 'PLAYOUT', deckOnProgram: true });
    const v = presenterView(s, T0 + 96_000, toWall);
    expect(v.segment).toBe('media');
    expect(v.returnTo).toMatchObject({ blockName: 'Primo blocco', anchor: { kind: 'countdown', endsAt: toWall(T0 + 245_000) } });
    expect(s.cursor).toBe(1);
    expect(s.returnSlot).toBe(2);
    expect(s.slotRt[1]).toEqual({ status: 'onair', startedAt: T0 + 60_000, endedAt: null, provisional: false });
    expect(s.slotRt[2]!.status).toBe('onair');

    s = run(s, { type: 'ProgramSceneChanged', at: T0 + 245_000, scene: 'CAM 1', deckOnProgram: false });
    expect(s.cursor).toBe(2);
    expect(s.returnSlot).toBeNull();
    expect(s.slotRt[1]).toMatchObject({ status: 'done', endedAt: T0 + 245_000 });
  });

  it('does not re-enter a clip that is no longer playing', () => {
    const s = run(
      onAir(),
      { type: 'DeckPlayback', at: T0 + 92_000, index: 0, positionMs: 32_000, durationMs: 185_000, playing: false },
      { type: 'ProgramSceneChanged', at: T0 + 95_000, scene: 'PLAYOUT', deckOnProgram: true },
    );
    expect(s.cursor).toBe(2);
    expect(s.offScript).not.toBeNull();
  });
});
