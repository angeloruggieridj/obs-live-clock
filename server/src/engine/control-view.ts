// SPDX-License-Identifier: GPL-2.0-or-later
import type { ControlDecision, ControlView, RundownRow } from '@olc/shared';
import { presenterView } from './projection';
import { slotDuration } from './rundown';
import { plannedStartAt } from './timing';
import type { LiveState, MonoMs } from './types';

export type { ControlDecision, ControlView, RundownRow } from '@olc/shared';

/** Data for the dock and the extended control view (SPEC §8). Pure. */
export function controlView(s: LiveState, now: MonoMs, toWall: (mono: MonoMs) => number): ControlView {
  const degraded = s.obs === 'lost' || s.ambiguous;
  const wall = (m: MonoMs | null) => (m === null ? null : toWall(m));
  return {
    episode: { id: s.episode.id, name: s.episode.name },
    presenter: presenterView(s, now, toWall),
    control: s.control,
    obs: s.obs,
    ambiguous: s.ambiguous,
    cursor: s.cursor,
    returnSlot: s.returnSlot,
    offScript: s.offScript === null ? null : { scene: s.offScript.scene, sinceWall: toWall(s.offScript.since) },
    decisions: s.decisions.map((d) => ({
      id: d.id,
      kind: d.kind,
      atWall: toWall(d.at),
      defaultChoice: d.defaultChoice,
      choice: d.choice,
      confirmed: d.confirmed,
    })),
    rows: s.slots.map((slot) => {
      const rt = s.slotRt[slot.index]!;
      const d = slotDuration(s, slot);
      return {
        slot: slot.index,
        blockIndex: slot.blockIndex,
        blockName: s.episode.blocks[slot.blockIndex]!.name,
        kind: slot.kind,
        title: slot.title,
        status: rt.status,
        provisional: rt.provisional,
        durationMs: slot.kind === 'studio' ? null : d.ms,
        durationSource: degraded ? 'estimated' : d.source,
        plannedStartAtWall: wall(plannedStartAt(s, slot.blockIndex)),
        startedAtWall: wall(rt.startedAt),
        endedAtWall: wall(rt.endedAt),
      };
    }),
    presets: { messages: s.episode.messages.map((m) => ({ ...m })), adjustStepMs: s.episode.preset.adjustStepMs },
  };
}
