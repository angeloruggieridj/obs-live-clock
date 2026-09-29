// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import { nextTickAt, reduce } from '../../src/engine/reducer';
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
