// SPDX-License-Identifier: GPL-2.0-or-later
import { rundownDurationMs } from '@olc/shared';
import type { Anchor, PresenterView } from '@olc/shared';
export type { Anchor, PresenterView } from '@olc/shared';
import { slotDuration } from './rundown';
import { computeTiming, type Remaining } from './snapshot';
import { plannedEndAt } from './timing';
import type { LiveState, MonoMs } from './types';

function toAnchor(r: Remaining | null, toWall: (m: MonoMs) => number): Anchor {
  if (r === null) return { kind: 'unknown' };
  return r.kind === 'running'
    ? { kind: 'countdown', endsAt: toWall(r.endsAt), source: r.source }
    : { kind: 'frozen', valueMs: r.remainingMs, source: r.source };
}

function nextItem(s: LiveState): PresenterView['next'] {
  const from = (s.returnSlot ?? s.cursor) + 1;
  for (let j = Math.max(0, from); j < s.slots.length; j++) {
    const slot = s.slots[j]!;
    const status = s.slotRt[j]!.status;
    if (slot.kind === 'studio' || (status !== 'pending' && status !== 'postponed')) continue;
    const d = slotDuration(s, slot);
    return { title: slot.title, durationMs: d.ms, source: s.obs === 'lost' ? 'estimated' : d.source };
  }
  return null;
}

function upcoming(s: LiveState): string[] {
  const titles: string[] = [];
  for (const slot of s.slots) {
    if (!titles.includes(slot.title)) titles.push(slot.title);
    if (titles.length === 4) break;
  }
  return titles;
}

/** FINE: the latest block end is the program end (endProgram closes every started block at the same instant). */
function endedSummary(s: LiveState): PresenterView['ended'] {
  if (s.phase !== 'ended' || s.t0 === null) return null;
  let endAt: MonoMs | null = null;
  for (const rt of s.blockRt) {
    if (rt.endedAt !== null && (endAt === null || rt.endedAt > endAt)) endAt = rt.endedAt;
  }
  if (endAt === null) return null;
  const plannedEnd = plannedEndAt(s, s.episode.blocks.length - 1)!;
  return {
    totalMs: endAt - s.t0,
    finalOffsetMs: endAt - plannedEnd,
    source: s.obs === 'lost' || s.ambiguous ? 'estimated' : 'measured',
  };
}

export function presenterView(s: LiveState, now: MonoMs, toWall: (mono: MonoMs) => number): PresenterView {
  const t = computeTiming(s, now);
  const blocks = s.episode.blocks;
  const programEndAnchor = toAnchor(t.forecast, toWall);

  return {
    phase: s.phase,
    segment: t.segment,
    rundownFinished: t.rundownFinished,
    block: t.blockIndex >= 0 ? { index: t.blockIndex, name: blocks[t.blockIndex]!.name, anchor: toAnchor(t.block, toWall) } : null,
    onAir:
      t.onAir === null
        ? null
        : {
            title: t.onAir.title,
            anchor: toAnchor(t.onAir.remaining, toWall),
            startedAtWall: t.onAir.startedAt === null ? null : toWall(t.onAir.startedAt),
            durationMs: t.onAir.durationMs,
          },
    returnTo:
      t.returnBlockIndex === null
        ? null
        : { blockName: blocks[t.returnBlockIndex]!.name, anchor: toAnchor(t.returnAt, toWall) },
    next: nextItem(s),
    programEnd:
      t.forecast === null
        ? null
        : { anchor: programEndAnchor, endsAtWall: programEndAnchor.kind === 'countdown' ? programEndAnchor.endsAt : null },
    delay: t.delay,
    thresholds: { warnMs: s.episode.preset.warnMs, returnImminentMs: s.episode.preset.returnImminentMs },
    message: s.message === null ? null : { text: s.message.text },
    status: { ...s.outputs, obs: s.obs, control: s.control },
    preshow:
      s.phase === 'preshow'
        ? { plannedStart: s.episode.plannedStart, totalDurationMs: rundownDurationMs(s.episode), upcoming: upcoming(s) }
        : null,
    ended: endedSummary(s),
  };
}
