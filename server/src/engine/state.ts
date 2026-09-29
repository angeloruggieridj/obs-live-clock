// SPDX-License-Identifier: GPL-2.0-or-later
import type { Episode } from '@olc/shared';
import { buildSlots } from './rundown';
import type { LiveState } from './types';

export function createLiveState(episode: Episode): LiveState {
  const slots = buildSlots(episode);
  return {
    episode,
    slots,
    phase: 'preshow',
    t0: null,
    outputs: { rec: false, stream: false, recPaused: false },
    recPausedAt: null,
    control: 'auto',
    obs: 'lost',
    cursor: -1,
    returnSlot: null,
    preLossCursor: null,
    resyncPending: false,
    slotRt: slots.map(() => ({ status: 'pending', startedAt: null, endedAt: null })),
    blockRt: episode.blocks.map(() => ({ startedAt: null, endedAt: null, adjustMs: 0, targetMs: null, startedBy: null })),
    program: { scene: null, deckOnProgram: false },
    deck: { items: null, current: null },
    media: null,
    offScript: null,
    message: null,
    decisions: [],
    nextDecisionId: 1,
  };
}
