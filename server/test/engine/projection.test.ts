// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import { presenterView } from '../../src/engine/projection';
import { T0, freshState, liveState, run } from '../helpers';

const WALL0 = 1_790_000_000_000;
const toWall = (mono: number) => WALL0 + mono;

describe('presenterView', () => {
  it('preshow shows the plan, the upcoming items and the first thing to air', () => {
    const v = presenterView(freshState(), 0, toWall);
    expect(v.phase).toBe('preshow');
    expect(v.block).toBeNull();
    expect(v.preshow).toEqual({
      plannedStart: '2026-10-12T19:00:00+02:00',
      totalDurationMs: 1_620_000,
      upcoming: ['Primo blocco', 'Servizio 1', 'Break 1', 'Secondo blocco'],
    });
    // OBS is not connected yet, so even planned values are declared estimated (never overstate certainty).
    expect(v.next).toEqual({ title: 'Servizio 1', durationMs: 180_000, source: 'estimated' });
    expect(v.status.obs).toBe('lost');
  });

  it('live in studio: block countdown in wall time, next item, program end', () => {
    const v = presenterView(liveState(), T0 + 100_000, toWall);
    expect(v.segment).toBe('studio');
    expect(v.block).toEqual({ index: 0, name: 'Primo blocco', anchor: { kind: 'countdown', endsAt: toWall(T0 + 720_000), source: 'measured' } });
    expect(v.next).toEqual({ title: 'Servizio 1', durationMs: 185_000, source: 'measured' });
    expect(v.programEnd).toEqual({
      anchor: { kind: 'countdown', endsAt: toWall(T0 + 1_620_000), source: 'planned' },
      endsAtWall: toWall(T0 + 1_620_000),
    });
    expect(v.delayMs).toBe(0);
    expect(v.thresholds).toEqual({ warnMs: 60_000, returnImminentMs: 10_000 });
    expect(v.preshow).toBeNull();
  });

  it('during a service: on-air media and return to the block', () => {
    const s = run(
      liveState(),
      { type: 'DeckItemStarted', at: T0 + 60_000, index: 0, path: 'D:/media/servizio1.mp4', title: 'Servizio 1', durationMs: 185_000 },
      { type: 'ProgramSceneChanged', at: T0 + 60_000, scene: 'PLAYOUT', deckOnProgram: true },
    );
    const v = presenterView(s, T0 + 61_000, toWall);
    expect(v.segment).toBe('media');
    expect(v.onAir).toEqual({
      title: 'Servizio 1', anchor: { kind: 'countdown', endsAt: toWall(T0 + 245_000), source: 'measured' },
      startedAtWall: toWall(T0 + 60_000), durationMs: 185_000,
    });
    expect(v.returnTo).toEqual({ blockName: 'Primo blocco', anchor: { kind: 'countdown', endsAt: toWall(T0 + 245_000), source: 'measured' } });
    expect(v.next).toEqual({ title: 'Break 1', durationMs: 180_000, source: 'planned' });
  });

  it('degrades to estimated when OBS is lost', () => {
    const v = presenterView(run(liveState(), { type: 'SourceLost', at: T0 + 1 }), T0 + 2, toWall);
    expect(v.block?.anchor).toMatchObject({ source: 'estimated' });
    expect(v.status.obs).toBe('lost');
  });

  it('shows frozen values during a live-to-tape REC pause', () => {
    const s = run(liveState(), { type: 'OutputChanged', at: T0 + 100_000, output: 'rec', state: 'paused' });
    expect(presenterView(s, T0 + 400_000, toWall).block?.anchor).toEqual({ kind: 'frozen', valueMs: 620_000, source: 'measured' });
  });

  it('carries the active message and output status', () => {
    const s = run(liveState(), { type: 'SendMessage', at: T0, text: 'STRINGI', dismiss: { kind: 'manual' } });
    const v = presenterView(s, T0 + 1, toWall);
    expect(v.message).toEqual({ text: 'STRINGI' });
    expect(v.status).toEqual({ rec: true, stream: false, recPaused: false, obs: 'ok', control: 'auto' });
  });
});
