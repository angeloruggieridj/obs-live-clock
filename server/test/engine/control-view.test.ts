// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import { controlView } from '../../src/engine/control-view';
import { T0, freshState, liveState, run } from '../helpers';

const toWall = (m: number) => 1_790_000_000_000 + m;

describe('controlView', () => {
  it('lists every slot with status, duration and wall times', () => {
    const v = controlView(liveState(), T0 + 1_000, toWall);
    expect(v.episode).toEqual({ id: 'ep-2026-10-12', name: 'Solo Futsal · 12/10/2026' });
    expect(v.rows).toHaveLength(8);
    expect(v.rows[0]).toEqual({
      slot: 0, blockIndex: 0, blockName: 'Primo blocco', kind: 'studio', title: 'Primo blocco',
      status: 'onair', provisional: false, durationMs: null, durationSource: 'planned',
      plannedStartAtWall: toWall(T0),
      startedAtWall: toWall(T0), endedAtWall: null,
    });
    expect(v.rows[1]).toMatchObject({ kind: 'media', title: 'Servizio 1', status: 'pending', durationMs: 185_000, durationSource: 'measured' });
    expect(v.rows[3]).toMatchObject({ kind: 'break', blockName: 'Break 1', durationMs: 180_000, durationSource: 'planned' });
    expect(v.rows[3]!.plannedStartAtWall).toBe(toWall(T0 + 720_000));
    expect(v.presets).toEqual({
      messages: [
        { id: 'stringi', text: 'STRINGI', dismiss: { kind: 'timeout', ms: 10_000 } },
        { id: 'cam2', text: 'GUARDA CAM 2', dismiss: { kind: 'manual' } },
      ],
      adjustStepMs: 30_000,
    });
    expect(v.cursor).toBe(0);
    expect(v.presenter.phase).toBe('live');
    expect(v).toMatchObject({ control: 'auto', obs: 'ok', ambiguous: false, returnSlot: null, offScript: null, decisions: [] });
  });

  it('exposes off-script and decisions in wall time', () => {
    const s = run(
      liveState(),
      { type: 'ProgramSceneChanged', at: T0 + 30_000, scene: 'CAMERA OSPITE', deckOnProgram: false },
      { type: 'OutputChanged', at: T0 + 60_000, output: 'rec', state: 'stopped' },
    );
    const v = controlView(s, T0 + 61_000, toWall);
    expect(v.offScript).toEqual({ scene: 'CAMERA OSPITE', sinceWall: toWall(T0 + 30_000) });
    expect(v.decisions).toEqual([
      { id: 1, kind: 'all_outputs_stopped', atWall: toWall(T0 + 60_000), defaultChoice: 'interruption', choice: 'interruption', confirmed: false },
    ]);
  });

  it('marks durations estimated while OBS is lost', () => {
    const v = controlView(run(liveState(), { type: 'SourceLost', at: T0 + 1 }), T0 + 2, toWall);
    expect(v.obs).toBe('lost');
    expect(v.rows.every((r) => r.durationSource === 'estimated')).toBe(true);
  });

  it('has no planned start times before the program starts', () => {
    const v = controlView(freshState(), 0, toWall);
    expect(v.rows.every((r) => r.plannedStartAtWall === null)).toBe(true);
  });
});
