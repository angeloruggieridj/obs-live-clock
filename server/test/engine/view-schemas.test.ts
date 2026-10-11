// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import { ControlView, PresenterView } from '@olc/shared';
import { controlView } from '../../src/engine/control-view';
import { presenterView } from '../../src/engine/projection';
import type { LiveState } from '../../src/engine/types';
import { T0, freshState, liveState, run } from '../helpers';

const toWall = (m: number) => 1_790_000_000_000 + m;

/** One state per screen the clients render: parse(view) must equal view, so every field is declared. */
const states: Array<[string, LiveState, number]> = [
  ['preshow', freshState(), 0],
  ['live studio', liveState(), T0 + 100_000],
  [
    'media',
    run(
      liveState(),
      { type: 'DeckItemStarted', at: T0 + 60_000, index: 0, path: 'D:/media/servizio1.mp4', title: 'Servizio 1', durationMs: 185_000 },
      { type: 'ProgramSceneChanged', at: T0 + 60_000, scene: 'PLAYOUT', deckOnProgram: true },
    ),
    T0 + 61_000,
  ],
  ['break', run(liveState(), { type: 'ProgramSceneChanged', at: T0 + 700_000, scene: 'BREAK', deckOnProgram: false }), T0 + 701_000],
  ['obs lost', run(liveState(), { type: 'SourceLost', at: T0 + 1 }), T0 + 2],
  [
    'off-script with a decision',
    run(
      liveState(),
      { type: 'ProgramSceneChanged', at: T0 + 30_000, scene: 'CAMERA OSPITE', deckOnProgram: false },
      { type: 'OutputChanged', at: T0 + 60_000, output: 'rec', state: 'stopped' },
    ),
    T0 + 61_000,
  ],
  ['ended', run(liveState(), { type: 'EndProgram', at: T0 + 1_700_000 }), T0 + 1_800_000],
];

describe('engine projections satisfy the shared view schemas', () => {
  it.each(states)('%s', (_label, state, now) => {
    const p = presenterView(state, now, toWall);
    expect(PresenterView.parse(p)).toEqual(p);
    const c = controlView(state, now, toWall);
    expect(ControlView.parse(c)).toEqual(c);
  });
});
