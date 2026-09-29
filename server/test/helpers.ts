// SPDX-License-Identifier: GPL-2.0-or-later
import type { ProductionMode } from '@olc/shared';
import { SOLO_FUTSAL_DECK, soloFutsalEpisode } from '@olc/shared/testing';
import { reduce } from '../src/engine/reducer';
import { createLiveState } from '../src/engine/state';
import type { EngineInput, LiveState } from '../src/engine/types';

/** Program start used by all tests (monotonic ms). */
export const T0 = 10_000;

export function freshState(mode: ProductionMode = 'live_to_tape'): LiveState {
  return createLiveState(soloFutsalEpisode(mode));
}

export function run(state: LiveState, ...inputs: EngineInput[]): LiveState {
  return inputs.reduce((s, input) => reduce(s, input).state, state);
}

/** OBS connected, deck list known, CAM 1 on program, REC started at T0. */
export function liveState(mode: ProductionMode = 'live_to_tape'): LiveState {
  return run(
    freshState(mode),
    { type: 'SourceRestored', at: 0 },
    { type: 'DeckPlaylistChanged', at: 0, items: SOLO_FUTSAL_DECK.map((i) => ({ ...i })) },
    { type: 'ProgramSceneChanged', at: 0, scene: 'CAM 1', deckOnProgram: false },
    { type: 'OutputChanged', at: T0, output: 'rec', state: 'started' },
  );
}
