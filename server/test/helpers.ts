// SPDX-License-Identifier: GPL-2.0-or-later
import type { ProductionMode } from '@olc/shared';
import { soloFutsalEpisode } from '@olc/shared/testing';
import { createLiveState } from '../src/engine/state';
import type { LiveState } from '../src/engine/types';

/** Program start used by all tests (monotonic ms). */
export const T0 = 10_000;

export function freshState(mode: ProductionMode = 'live_to_tape'): LiveState {
  return createLiveState(soloFutsalEpisode(mode));
}
