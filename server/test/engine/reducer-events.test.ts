// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import { SOLO_FUTSAL_DECK } from '@olc/shared/testing';
import { reduce } from '../../src/engine/reducer';
import { T0, freshState, liveState, run } from '../helpers';

describe('program start', () => {
  it('starts the program on the first output and matches Program', () => {
    const s = liveState();
    expect(s.phase).toBe('live');
    expect(s.t0).toBe(T0);
    expect(s.cursor).toBe(0);
    expect(s.outputs).toEqual({ rec: true, stream: false, recPaused: false });
  });

  it('a second output does not restart the program', () => {
    const s = run(liveState(), { type: 'OutputChanged', at: T0 + 5_000, output: 'stream', state: 'started' });
    expect(s.t0).toBe(T0);
    expect(s.decisions).toEqual([]);
  });
});

describe('outputs stopping and restarting', () => {
  it('stopping every output mid-show asks for a decision and keeps the show live', () => {
    const s = run(liveState(), { type: 'OutputChanged', at: T0 + 60_000, output: 'rec', state: 'stopped' });
    expect(s.phase).toBe('live');
    expect(s.decisions).toEqual([
      { id: 1, kind: 'all_outputs_stopped', at: T0 + 60_000, defaultChoice: 'interruption', choice: 'interruption', confirmed: false },
    ]);
  });

  it('restarting confirms the interruption and records a restart decision (live-to-tape: new_session)', () => {
    const s = run(
      liveState(),
      { type: 'OutputChanged', at: T0 + 60_000, output: 'rec', state: 'stopped' },
      { type: 'OutputChanged', at: T0 + 70_000, output: 'rec', state: 'started' },
    );
    expect(s.decisions[0]).toMatchObject({ kind: 'all_outputs_stopped', confirmed: true, choice: 'interruption' });
    expect(s.decisions[1]).toMatchObject({ id: 2, kind: 'output_restart', defaultChoice: 'new_session', confirmed: false });
  });

  it('restart default is continue for streaming', () => {
    const s = run(
      liveState('streaming'),
      { type: 'OutputChanged', at: T0 + 60_000, output: 'rec', state: 'stopped' },
      { type: 'OutputChanged', at: T0 + 70_000, output: 'rec', state: 'started' },
    );
    expect(s.decisions[1]).toMatchObject({ kind: 'output_restart', defaultChoice: 'continue' });
  });

  it('stopping in the last block ends the program', () => {
    const s = liveState();
    // Put the show in the last block directly (commands such as Goto arrive in Task 8).
    s.cursor = 7;
    s.slotRt[7] = { status: 'onair', startedAt: T0 + 1_500_000, endedAt: null };
    s.blockRt[3] = { startedAt: T0 + 1_500_000, endedAt: null, adjustMs: 0, targetMs: 120_000, startedBy: 'obs' };
    const ended = run(s, { type: 'OutputChanged', at: T0 + 1_620_000, output: 'rec', state: 'stopped' });
    expect(ended.phase).toBe('ended');
    expect(ended.slotRt[7]).toMatchObject({ status: 'done', endedAt: T0 + 1_620_000 });
    expect(ended.blockRt[3]!.endedAt).toBe(T0 + 1_620_000);
  });
});

describe('REC pause', () => {
  it('live-to-tape: pause/resume shifts t0 and the current block and slot', () => {
    const s = run(
      liveState(),
      { type: 'OutputChanged', at: T0 + 100_000, output: 'rec', state: 'paused' },
      { type: 'OutputChanged', at: T0 + 130_000, output: 'rec', state: 'resumed' },
    );
    expect(s.t0).toBe(T0 + 30_000);
    expect(s.blockRt[0]!.startedAt).toBe(T0 + 30_000);
    expect(s.slotRt[0]!.startedAt).toBe(T0 + 30_000);
    expect(s.recPausedAt).toBeNull();
    expect(s.outputs.recPaused).toBe(false);
  });

  it('streaming: pause does not freeze program time', () => {
    const s = run(
      liveState('streaming'),
      { type: 'OutputChanged', at: T0 + 100_000, output: 'rec', state: 'paused' },
      { type: 'OutputChanged', at: T0 + 130_000, output: 'rec', state: 'resumed' },
    );
    expect(s.t0).toBe(T0);
  });
});

describe('playlist changes', () => {
  it('drops a media slot removed from the playlist and restores it when re-added', () => {
    const removed = run(liveState(), {
      type: 'DeckPlaylistChanged', at: T0 + 1_000, items: [{ ...SOLO_FUTSAL_DECK[0]! }],
    });
    expect(removed.slotRt[5]!.status).toBe('dropped');
    const back = run(removed, {
      type: 'DeckPlaylistChanged', at: T0 + 2_000, items: SOLO_FUTSAL_DECK.map((i) => ({ ...i })),
    });
    expect(back.slotRt[5]!.status).toBe('pending');
  });

  it('a re-added clip behind the cursor goes back to postponed, not pending', () => {
    const skipped = run(liveState(), { type: 'ProgramSceneChanged', at: T0 + 700_000, scene: 'BREAK', deckOnProgram: false });
    expect(skipped.slotRt[1]!.status).toBe('postponed');
    const removed = run(skipped, { type: 'DeckPlaylistChanged', at: T0 + 701_000, items: [{ ...SOLO_FUTSAL_DECK[1]!, index: 0 }] });
    expect(removed.slotRt[1]!.status).toBe('dropped');
    const back = run(removed, { type: 'DeckPlaylistChanged', at: T0 + 702_000, items: SOLO_FUTSAL_DECK.map((i) => ({ ...i })) });
    expect(back.slotRt[1]!.status).toBe('postponed');
    expect(back.slotRt[5]!.status).toBe('pending');
  });

  it('never drops a slot that is already on air or done', () => {
    const s = run(
      liveState(),
      { type: 'DeckItemStarted', at: T0 + 60_000, index: 0, path: 'D:/media/servizio1.mp4', title: 'Servizio 1', durationMs: 185_000 },
      { type: 'ProgramSceneChanged', at: T0 + 60_000, scene: 'PLAYOUT', deckOnProgram: true },
      { type: 'DeckPlaylistChanged', at: T0 + 61_000, items: [{ ...SOLO_FUTSAL_DECK[1]!, index: 0 }] },
    );
    expect(s.cursor).toBe(1);
    expect(s.slotRt[1]!.status).toBe('onair');
  });
});

describe('deck and media status', () => {
  it('tracks deck playback and matches when the deck goes on program', () => {
    const s = run(
      liveState(),
      { type: 'DeckItemStarted', at: T0 + 60_000, index: 0, path: 'D:/media/servizio1.mp4', title: 'Servizio 1', durationMs: 185_000 },
    );
    expect(s.cursor).toBe(0); // deck not on program yet
    const onAir = run(s, { type: 'ProgramSceneChanged', at: T0 + 61_000, scene: 'PLAYOUT', deckOnProgram: true });
    expect(onAir.cursor).toBe(1);
    const paused = run(onAir, { type: 'DeckPlayback', at: T0 + 70_000, index: 0, positionMs: 9_000, durationMs: 185_000, playing: false });
    expect(paused.deck.current).toMatchObject({ positionMs: 9_000, playing: false, path: 'D:/media/servizio1.mp4' });
  });

  it('stores media input status', () => {
    const s = run(liveState(), { type: 'MediaStatus', at: T0 + 1, input: 'Tappo', playing: true, cursorMs: 0, durationMs: 180_000 });
    expect(s.media).toEqual({ input: 'Tappo', playing: true, cursorMs: 0, durationMs: 180_000, at: T0 + 1 });
  });
});

describe('connection', () => {
  it('reports unchanged state as the same reference', () => {
    const s = liveState();
    const lost = reduce(s, { type: 'SourceLost', at: T0 + 1 });
    expect(lost.changed).toBe(true);
    expect(lost.state.obs).toBe('lost');
    const again = reduce(lost.state, { type: 'SourceLost', at: T0 + 2 });
    expect(again.changed).toBe(false);
    expect(again.state).toBe(lost.state);
  });
});

describe('phase guards', () => {
  it('ignores matching outside live', () => {
    const pre = run(freshState(), { type: 'ProgramSceneChanged', at: 1, scene: 'BREAK', deckOnProgram: false });
    expect(pre.cursor).toBe(-1);
    expect(pre.program.scene).toBe('BREAK');
    const ended = { ...liveState(), phase: 'ended' as const };
    const after = run(ended, { type: 'ProgramSceneChanged', at: T0 + 5, scene: 'BREAK', deckOnProgram: false });
    expect(after.cursor).toBe(0);
  });
});
