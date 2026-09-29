// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import { computeTiming } from '../../src/engine/snapshot';
import { T0, freshState, liveState, run } from '../helpers';

describe('computeTiming', () => {
  it('is empty before the program starts', () => {
    const t = computeTiming(freshState(), 5);
    expect(t).toMatchObject({ blockIndex: -1, block: null, delayMs: null, forecast: null, segment: null });
  });

  it('on time in block 1', () => {
    const t = computeTiming(liveState(), T0 + 100_000);
    expect(t.block).toEqual({ kind: 'running', endsAt: T0 + 720_000, source: 'measured' });
    expect(t.delayMs).toBe(0);
    expect(t.plannedEndAt).toBe(T0 + 1_620_000);
    expect(t.forecast).toEqual({ kind: 'running', endsAt: T0 + 1_620_000, source: 'planned' });
    expect(t.segment).toBe('studio');
    expect(t.rundownFinished).toBe(false);
  });

  it('overrun: delay grows and is absorbed by the next elastic block in the forecast', () => {
    const t = computeTiming(liveState(), T0 + 750_000);
    expect(t.delayMs).toBe(30_000);
    expect(t.forecast).toEqual({ kind: 'running', endsAt: T0 + 1_620_000, source: 'planned' });
  });

  it('forecast slips when later elastic studio time cannot absorb the delay', () => {
    const t = computeTiming(liveState(), T0 + 720_000 + 700_000); // 700 s over
    // b2 absorbs 480 000, b3 absorbs 120 000 -> residual 100 000
    expect(t.forecast).toEqual({ kind: 'running', endsAt: T0 + 1_720_000, source: 'planned' });
  });

  it('deck media on air: running, measured, with return to studio', () => {
    const s = run(
      liveState(),
      { type: 'DeckItemStarted', at: T0 + 60_000, index: 0, path: 'D:/media/servizio1.mp4', title: 'Servizio 1', durationMs: 185_000 },
      { type: 'ProgramSceneChanged', at: T0 + 60_000, scene: 'PLAYOUT', deckOnProgram: true },
      { type: 'DeckPlayback', at: T0 + 120_000, index: 0, positionMs: 60_000, durationMs: 185_000, playing: true },
    );
    const t = computeTiming(s, T0 + 121_000);
    expect(t.segment).toBe('media');
    expect(t.onAir).toEqual({
      slotIndex: 1, title: 'Servizio 1', startedAt: T0 + 60_000, durationMs: 185_000,
      remaining: { kind: 'running', endsAt: T0 + 245_000, source: 'measured' },
    });
    expect(t.returnAt).toEqual({ kind: 'running', endsAt: T0 + 245_000, source: 'measured' });
    expect(t.returnBlockIndex).toBe(0);
  });

  it('paused deck media is frozen', () => {
    const s = run(
      liveState(),
      { type: 'DeckItemStarted', at: T0 + 60_000, index: 0, path: 'D:/media/servizio1.mp4', title: 'Servizio 1', durationMs: 185_000 },
      { type: 'ProgramSceneChanged', at: T0 + 60_000, scene: 'PLAYOUT', deckOnProgram: true },
      { type: 'DeckPlayback', at: T0 + 90_000, index: 0, positionMs: 30_000, durationMs: 185_000, playing: false },
    );
    expect(computeTiming(s, T0 + 200_000).onAir?.remaining).toEqual({ kind: 'frozen', remainingMs: 155_000, source: 'measured' });
  });

  it('break with a measured filler, then without (planned)', () => {
    const inBreak = run(liveState(), { type: 'ProgramSceneChanged', at: T0 + 720_000, scene: 'BREAK', deckOnProgram: false });
    const planned = computeTiming(inBreak, T0 + 730_000);
    expect(planned.segment).toBe('break');
    expect(planned.onAir?.remaining).toEqual({ kind: 'running', endsAt: T0 + 900_000, source: 'planned' });
    expect(planned.returnBlockIndex).toBe(2);

    const measured = run(inBreak, {
      type: 'MediaStatus', at: T0 + 725_000, input: 'Tappo', playing: true, cursorMs: 5_000, durationMs: 181_000,
    });
    expect(computeTiming(measured, T0 + 730_000).returnAt).toEqual({ kind: 'running', endsAt: T0 + 901_000, source: 'measured' });
  });

  it('marks every source estimated while OBS is lost', () => {
    const s = run(liveState(), { type: 'SourceLost', at: T0 + 1 });
    const t = computeTiming(s, T0 + 2);
    expect(t.block?.source).toBe('estimated');
    expect(t.forecast?.source).toBe('estimated');
  });

  it('freezes during a live-to-tape REC pause', () => {
    const s = run(liveState(), { type: 'OutputChanged', at: T0 + 100_000, output: 'rec', state: 'paused' });
    expect(computeTiming(s, T0 + 500_000).block).toEqual({ kind: 'frozen', remainingMs: 620_000, source: 'measured' });
  });

  it('flags the rundown as finished when the last block is over time', () => {
    const s = run(liveState(), { type: 'Goto', at: T0 + 1_500_000, slot: 7 });
    const t = computeTiming(s, T0 + 1_700_000);
    expect(t.blockIndex).toBe(3);
    expect(t.rundownFinished).toBe(true);
    expect(t.delayMs).toBe(80_000);
  });

  it('out-of-order service returns to the interrupted block', () => {
    const s = run(
      liveState(),
      { type: 'ProgramSceneChanged', at: T0 + 700_000, scene: 'BREAK', deckOnProgram: false }, // Servizio 1 postponed
      { type: 'ProgramSceneChanged', at: T0 + 880_000, scene: 'CAM 1', deckOnProgram: false }, // block 2 studio, slot 4
      { type: 'DeckItemStarted', at: T0 + 900_000, index: 0, path: 'D:/media/servizio1.mp4', title: 'Servizio 1', durationMs: 185_000 },
      { type: 'ProgramSceneChanged', at: T0 + 900_000, scene: 'PLAYOUT', deckOnProgram: true }, // Servizio 1 out of order
    );
    const t = computeTiming(s, T0 + 901_000);
    expect(t.segment).toBe('media');
    expect(t.blockIndex).toBe(2);
    expect(t.onAir?.slotIndex).toBe(1);
    expect(t.returnBlockIndex).toBe(2);
    expect(t.returnAt).toEqual({ kind: 'running', endsAt: T0 + 1_085_000, source: 'measured' });
  });
});

describe('block countdown source', () => {
  it('is planned for a block started by time, measured for one started by OBS', () => {
    const s = run(liveState(), { type: 'Goto', at: T0 + 900_000, slot: 6 }, { type: 'Tick', at: T0 + 1_500_000 });
    expect(computeTiming(s, T0 + 1_500_001).block).toEqual({ kind: 'running', endsAt: T0 + 1_620_000, source: 'planned' });
    const lost = run(s, { type: 'SourceLost', at: T0 + 1_500_002 });
    expect(computeTiming(lost, T0 + 1_500_003).block?.source).toBe('estimated');
  });
});
