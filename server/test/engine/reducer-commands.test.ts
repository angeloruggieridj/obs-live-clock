// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import { nextTickAt, reduce } from '../../src/engine/reducer';
import { SOLO_FUTSAL_DECK } from '@olc/shared/testing';
import { T0, freshState, liveState, run } from '../helpers';

describe('StartProgram', () => {
  it('starts from preshow and is ignored afterwards', () => {
    const s = run(freshState(), { type: 'StartProgram', at: T0 });
    expect(s.phase).toBe('live');
    expect(s.t0).toBe(T0);
    expect(reduce(s, { type: 'StartProgram', at: T0 + 1 }).changed).toBe(false);
  });
});

describe('Next / Prev / Goto', () => {
  it('moves forward and back', () => {
    const next = run(liveState(), { type: 'Next', at: T0 + 1_000 });
    expect(next.cursor).toBe(1);
    const prev = run(next, { type: 'Prev', at: T0 + 2_000 });
    expect(prev.cursor).toBe(0);
    expect(prev.slotRt[1]!.status).toBe('pending');
  });

  it('Goto jumps to any slot and rejects invalid targets', () => {
    const s = run(liveState(), { type: 'Goto', at: T0 + 1_000, slot: 4 });
    expect(s.cursor).toBe(4);
    expect(s.blockRt[2]!.startedAt).toBe(T0 + 1_000);
    expect(reduce(s, { type: 'Goto', at: T0 + 2_000, slot: 99 }).changed).toBe(false);
    expect(reduce(s, { type: 'Goto', at: T0 + 2_000, slot: 4 }).changed).toBe(false);
  });

  it('Next skips dropped slots and is a no-op at the end of the rundown', () => {
    const s = run(
      liveState(),
      { type: 'DeckPlaylistChanged', at: T0 + 1_000, items: [{ ...SOLO_FUTSAL_DECK[0]! }] }, // Servizio 2 dropped
      { type: 'Goto', at: T0 + 900_000, slot: 4 },
    );
    const next = run(s, { type: 'Next', at: T0 + 901_000 });
    expect(next.cursor).toBe(6);
    expect(next.slotRt[5]!.status).toBe('dropped');
    const end = run(liveState(), { type: 'Goto', at: T0 + 1_500_000, slot: 7 });
    expect(reduce(end, { type: 'Next', at: T0 + 1_501_000 }).changed).toBe(false);
  });

  it('Goto rejects a dropped slot', () => {
    const s = run(liveState(), { type: 'DeckPlaylistChanged', at: T0 + 1_000, items: [{ ...SOLO_FUTSAL_DECK[0]! }] });
    const r = reduce(s, { type: 'Goto', at: T0 + 2_000, slot: 5 });
    expect(r.changed).toBe(false);
    expect(r.state.cursor).toBe(0);
  });

  it('is ignored outside live', () => {
    expect(reduce(freshState(), { type: 'Next', at: 1 }).changed).toBe(false);
  });
});

describe('Adjust', () => {
  it('extends the current block target', () => {
    const s = run(liveState(), { type: 'Adjust', at: T0 + 1_000, deltaMs: 30_000 });
    expect(s.blockRt[0]).toMatchObject({ adjustMs: 30_000, targetMs: 750_000 });
  });
});

describe('SetControl', () => {
  it('manual stops matching, auto re-aligns immediately', () => {
    const manual = run(
      liveState(),
      { type: 'SetControl', at: T0 + 1_000, control: 'manual' },
      { type: 'ProgramSceneChanged', at: T0 + 2_000, scene: 'BREAK', deckOnProgram: false },
    );
    expect(manual.cursor).toBe(0);
    const auto = run(manual, { type: 'SetControl', at: T0 + 3_000, control: 'auto' });
    expect(auto.cursor).toBe(3);
  });
});

describe('messages', () => {
  it('timeout messages expire on tick; manual ones stay until cleared', () => {
    const shown = run(liveState(), {
      type: 'SendMessage', at: T0 + 1_000, text: 'STRINGI', dismiss: { kind: 'timeout', ms: 10_000 },
    });
    expect(shown.message).toEqual({ text: 'STRINGI', shownAt: T0 + 1_000, expiresAt: T0 + 11_000 });
    expect(nextTickAt(shown)).toBe(T0 + 11_000);
    expect(reduce(shown, { type: 'Tick', at: T0 + 10_999 }).changed).toBe(false);
    expect(run(shown, { type: 'Tick', at: T0 + 11_000 }).message).toBeNull();

    const manual = run(liveState(), { type: 'SendMessage', at: T0, text: 'GUARDA CAM 2', dismiss: { kind: 'manual' } });
    expect(run(manual, { type: 'Tick', at: T0 + 999_999 }).message).not.toBeNull();
    expect(run(manual, { type: 'ClearMessage', at: T0 + 5 }).message).toBeNull();
  });

  it('a new message replaces the previous one', () => {
    const s = run(
      liveState(),
      { type: 'SendMessage', at: T0, text: 'A', dismiss: { kind: 'manual' } },
      { type: 'SendMessage', at: T0 + 1, text: 'B', dismiss: { kind: 'manual' } },
    );
    expect(s.message?.text).toBe('B');
  });
});

describe('ResolveDecision', () => {
  it('ends the program when all outputs stopped is resolved as end', () => {
    const stopped = run(liveState(), { type: 'OutputChanged', at: T0 + 60_000, output: 'rec', state: 'stopped' });
    const ended = run(stopped, { type: 'ResolveDecision', at: T0 + 61_000, id: 1, choice: 'end' });
    expect(ended.phase).toBe('ended');
    expect(ended.decisions[0]).toMatchObject({ choice: 'end', confirmed: true });
    expect(reduce(ended, { type: 'ResolveDecision', at: T0 + 62_000, id: 42, choice: 'end' }).changed).toBe(false);
  });
});

describe('EndProgram', () => {
  it('ends a live program, closing the current slot and started blocks', () => {
    const s = run(liveState(), { type: 'EndProgram', at: T0 + 30_000 });
    expect(s.phase).toBe('ended');
    expect(s.slotRt[0]).toMatchObject({ status: 'done', endedAt: T0 + 30_000 });
    expect(s.blockRt[0]).toMatchObject({ startedAt: T0, endedAt: T0 + 30_000 });
  });

  it('does nothing outside live', () => {
    expect(reduce(freshState(), { type: 'EndProgram', at: T0 }).changed).toBe(false);
  });
});

describe('estimated mode (OBS lost)', () => {
  it('hands over to the next block at the planned end, never past the last block', () => {
    const lost = run(liveState(), { type: 'SourceLost', at: T0 + 100_000 });
    expect(nextTickAt(lost)).toBe(T0 + 720_000);
    const s = run(lost, { type: 'Tick', at: T0 + 950_000 });
    // block 0 ended at 720 000 -> break (180 000) ended at 900 000 -> block 2 started at 900 000
    expect(s.cursor).toBe(4);
    expect(s.blockRt[1]).toMatchObject({ startedAt: T0 + 720_000, endedAt: T0 + 900_000 });
    expect(s.blockRt[2]!.startedAt).toBe(T0 + 900_000);
    const late = run(s, { type: 'Tick', at: T0 + 5_000_000 });
    expect(late.cursor).toBe(7);
    expect(nextTickAt(late)).toBeNull();
  });

  it('does not advance while OBS is connected', () => {
    expect(run(liveState(), { type: 'Tick', at: T0 + 950_000 }).cursor).toBe(0);
    expect(nextTickAt(liveState())).toBeNull();
  });
});

describe('time-based hand-over between adjacent studio blocks (OBS connected)', () => {
  const inBlock2Tail = () => {
    const s = run(liveState(), { type: 'Goto', at: T0 + 900_000, slot: 6 });
    expect(s.blockRt[2]!.startedAt).toBe(T0 + 900_000);
    return s;
  };

  it('schedules and performs the hand-over at the block end, marking the new block as started by time', () => {
    const s = inBlock2Tail();
    expect(nextTickAt(s)).toBe(T0 + 1_500_000);
    expect(reduce(s, { type: 'Tick', at: T0 + 1_499_999 }).changed).toBe(false);
    const after = run(s, { type: 'Tick', at: T0 + 1_510_000 });
    expect(after.cursor).toBe(7);
    expect(after.slotRt[6]).toMatchObject({ status: 'done', endedAt: T0 + 1_500_000 });
    expect(after.blockRt[3]).toMatchObject({ startedAt: T0 + 1_500_000, startedBy: 'time', targetMs: 120_000 });
    expect(after.blockRt[2]).toMatchObject({ endedAt: T0 + 1_500_000, startedBy: 'obs' });
    expect(nextTickAt(after)).toBeNull();
  });

  it('does not hand over when the next slot is observable (media) or Program is not in the next group', () => {
    const s = run(liveState(), { type: 'Tick', at: T0 + 800_000 });
    expect(s.cursor).toBe(0);
    const offGroup = run(inBlock2Tail(), { type: 'ProgramSceneChanged', at: T0 + 1_000_000, scene: 'GRAFICA', deckOnProgram: false });
    expect(nextTickAt(offGroup)).toBeNull();
    expect(run(offGroup, { type: 'Tick', at: T0 + 1_600_000 }).cursor).toBe(6);
  });

  it('does not hand over in manual control', () => {
    const s = run(inBlock2Tail(), { type: 'SetControl', at: T0 + 1_000_000, control: 'manual' });
    expect(run(s, { type: 'Tick', at: T0 + 1_600_000 }).cursor).toBe(6);
  });

  it('estimated-mode hand-overs are also marked as started by time', () => {
    const s = run(liveState(), { type: 'SourceLost', at: T0 + 100_000 }, { type: 'Tick', at: T0 + 950_000 });
    expect(s.blockRt[1]!.startedBy).toBe('time');
    expect(s.blockRt[2]!.startedBy).toBe('time');
    expect(s.blockRt[0]!.startedBy).toBe('obs');
  });
});

describe('estimated hand-over during an out-of-order excursion', () => {
  // Servizio 1 airs out of order, interrupting the block-2 studio slot it was owed before (cursor 1,
  // returnSlot 4), then OBS is lost.
  const excursion = () =>
    run(
      liveState(),
      { type: 'ProgramSceneChanged', at: T0 + 700_000, scene: 'BREAK', deckOnProgram: false },
      { type: 'ProgramSceneChanged', at: T0 + 880_000, scene: 'CAM 1', deckOnProgram: false },
      { type: 'DeckItemStarted', at: T0 + 900_000, index: 0, path: 'D:/media/servizio1.mp4', title: 'Servizio 1', durationMs: 185_000 },
      { type: 'ProgramSceneChanged', at: T0 + 900_000, scene: 'PLAYOUT', deckOnProgram: true },
    );

  it('starts from the resume position, closes the interrupted returnSlot and stays ambiguous until the gap is resolved', () => {
    let s = run(excursion(), { type: 'SourceLost', at: T0 + 950_000 });
    expect(s.cursor).toBe(1);
    expect(s.returnSlot).toBe(4);

    s = run(s, { type: 'Tick', at: T0 + 1_520_000 });
    expect(s.cursor).toBe(7);
    // The hand-over clears the excursion: no stale returnSlot survives (otherwise `position(s)` never
    // advances past the resume slot and the restore below never resyncs).
    expect(s.returnSlot).toBeNull();
    // Slots between the excursion slot and the resume position were observed: they must not be provisional.
    expect(s.slotRt[3]!.provisional).toBe(false);
    expect(s.slotRt[4]!.provisional).toBe(false);
    // The interrupted returnSlot studio slot is closed rather than left on air.
    expect(s.slotRt[4]!.status).toBe('done');
    expect(s.slotRt.filter((r) => r.status === 'onair')).toHaveLength(1);

    s = run(
      s,
      { type: 'SourceRestored', at: T0 + 1_520_000 },
      { type: 'ProgramSceneChanged', at: T0 + 1_520_000, scene: 'CAM 1', deckOnProgram: false },
    );
    // CAM 1 confirms the provisional block-2 studio position, but the estimating loop guessed its way
    // through the break and block-2 media slot 5 (Servizio 2) that OBS never observed. Per R1' the position
    // is therefore ambiguous: the clock keeps degrading like OBS is still lost until a later real
    // media/break observation (or a correction) resolves the gap. The original "not ambiguous" assertion
    // was a plan defect — nothing ever observed slot 5.
    expect(s.ambiguous).toBe(true);
  });

  it('on a mismatched restore rolls the guessed position back cleanly, un-starting the time-started block', () => {
    let s = run(excursion(), { type: 'SourceLost', at: T0 + 950_000 }, { type: 'Tick', at: T0 + 1_520_000 });
    expect(s.cursor).toBe(7);

    // OBS comes back showing Servizio 2 on PLAYOUT (slot 5), not the guessed block-3 studio slot.
    s = run(
      s,
      { type: 'SourceRestored', at: T0 + 1_520_000 },
      { type: 'DeckItemStarted', at: T0 + 1_520_000, index: 1, path: 'D:/media/servizio2.mp4', title: 'Servizio 2', durationMs: 120_000 },
      { type: 'ProgramSceneChanged', at: T0 + 1_520_000, scene: 'PLAYOUT', deckOnProgram: true },
    );
    // The guess is discarded: resync rolls back to the pre-loss position and the normal match then enters
    // the real slot 5. Block 3 (time-started) is un-started and slot 7 is pending again, not a done slot.
    expect(s.cursor).toBe(5);
    expect(s.returnSlot).toBeNull();
    expect(s.blockRt[3]!.startedAt).toBeNull();
    expect(s.slotRt[7]!.status).toBe('pending');
    expect(s.slotRt[5]!.status).toBe('onair');
    expect(s.slotRt.filter((r) => r.status === 'onair')).toHaveLength(1);
    expect(s.ambiguous).toBe(false);
  });

  it('with further blocks remaining, the second iteration measures from the resume slot and the restore still resyncs', () => {
    // A shorter excursion inside block 0 (Servizio 1 skipped then aired out of order: cursor 1, returnSlot
    // 2) leaves two blocks to hand over: block 0 -> break -> block 2.
    let s = run(
      liveState(),
      { type: 'Goto', at: T0 + 100_000, slot: 2 },
      { type: 'DeckItemStarted', at: T0 + 200_000, index: 0, path: 'D:/media/servizio1.mp4', title: 'Servizio 1', durationMs: 185_000 },
      { type: 'ProgramSceneChanged', at: T0 + 200_000, scene: 'PLAYOUT', deckOnProgram: true },
    );
    expect(s.cursor).toBe(1);
    expect(s.returnSlot).toBe(2);

    s = run(s, { type: 'SourceLost', at: T0 + 250_000 }, { type: 'Tick', at: T0 + 950_000 });
    expect(s.cursor).toBe(4);
    expect(s.returnSlot).toBeNull();
    expect(s.blockRt[1]).toMatchObject({ startedAt: T0 + 720_000, startedBy: 'time' });
    expect(s.blockRt[2]).toMatchObject({ startedAt: T0 + 900_000, startedBy: 'time' });
    // The guessed range is exactly the break (3) and the block-2 studio slot (4): the resume slot 2 itself
    // was really observed and stays non-provisional, and the second iteration measured from slot 3.
    expect(s.slotRt[2]!.provisional).toBe(false);
    expect(s.slotRt[3]!.provisional).toBe(true);
    expect(s.slotRt[4]!.provisional).toBe(true);

    // The real break arrives: it is a correction into the never-observed guessed gap, so both time-started
    // blocks roll back and the break enters as observed.
    s = run(
      s,
      { type: 'SourceRestored', at: T0 + 950_000 },
      { type: 'ProgramSceneChanged', at: T0 + 950_000, scene: 'BREAK', deckOnProgram: false },
    );
    expect(s.cursor).toBe(3);
    expect(s.blockRt[1]).toMatchObject({ startedAt: T0 + 950_000, startedBy: 'obs' });
    expect(s.blockRt[2]).toMatchObject({ startedAt: null, startedBy: null });
  });

  it('no stale returnSlot survives the hand-over: Next moves forward and the time hand-over works again', () => {
    let s = run(
      liveState(),
      { type: 'Goto', at: T0 + 100_000, slot: 2 },
      { type: 'DeckItemStarted', at: T0 + 200_000, index: 0, path: 'D:/media/servizio1.mp4', title: 'Servizio 1', durationMs: 185_000 },
      { type: 'ProgramSceneChanged', at: T0 + 200_000, scene: 'PLAYOUT', deckOnProgram: true },
    );
    expect(s.cursor).toBe(1);
    expect(s.returnSlot).toBe(2);

    s = run(s, { type: 'SourceLost', at: T0 + 250_000 }, { type: 'Tick', at: T0 + 750_000 });
    expect(s.cursor).toBe(3); // one hand-over: block 0 -> break
    expect(s.returnSlot).toBeNull();

    const next = run(s, { type: 'Next', at: T0 + 750_001 });
    expect(next.cursor).toBe(4); // forward, not backwards to the stale resume slot

    // OBS confirms the new block (no rollback) and Servizio 2 is dropped, so the ordinary time hand-over
    // from block 2 to Chiusura must be scheduled again: with a stale returnSlot `studioHandOver` would
    // wrongly return null.
    const restored = run(
      next,
      { type: 'SourceRestored', at: T0 + 760_000 },
      { type: 'ProgramSceneChanged', at: T0 + 760_000, scene: 'CAM 1', deckOnProgram: false },
      { type: 'DeckPlaylistChanged', at: T0 + 800_000, items: [{ ...SOLO_FUTSAL_DECK[0]! }] },
    );
    expect(restored.cursor).toBe(4);
    expect(restored.ambiguous).toBe(false);
    expect(nextTickAt(restored)).toBe(T0 + 1_350_001);
  });
});
