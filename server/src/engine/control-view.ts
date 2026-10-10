// SPDX-License-Identifier: GPL-2.0-or-later
import { presenterView, type PresenterView } from './projection';
import { slotDuration } from './rundown';
import type { Decision, LiveState, MonoMs, SlotKind, SlotStatus, Source } from './types';

export interface RundownRow {
  slot: number;
  blockIndex: number;
  blockName: string;
  kind: SlotKind;
  title: string;
  status: SlotStatus;
  provisional: boolean;
  durationMs: number | null;
  durationSource: Source;
  startedAtWall: number | null;
  endedAtWall: number | null;
}

export interface ControlDecision {
  id: number;
  kind: Decision['kind'];
  atWall: number;
  defaultChoice: string;
  choice: string;
  confirmed: boolean;
}

export interface ControlView {
  episode: { id: string; name: string };
  presenter: PresenterView;
  control: 'auto' | 'manual';
  obs: 'ok' | 'lost';
  ambiguous: boolean;
  cursor: number;
  returnSlot: number | null;
  offScript: { scene: string; sinceWall: number } | null;
  decisions: ControlDecision[];
  rows: RundownRow[];
}

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
        startedAtWall: wall(rt.startedAt),
        endedAtWall: wall(rt.endedAt),
      };
    }),
  };
}
