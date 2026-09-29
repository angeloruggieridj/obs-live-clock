// SPDX-License-Identifier: GPL-2.0-or-later
import { currentBlockIndex, isElastic, lastBlockIndex, slotDuration, studioTimeMs, worstSource } from './rundown';
import { blockEndsAt, plannedEndAt } from './timing';
import type { LiveState, MonoMs, Source } from './types';

export type Remaining =
  | { kind: 'running'; endsAt: MonoMs; source: Source }
  | { kind: 'frozen'; remainingMs: number; source: Source };

export interface OnAirTiming {
  slotIndex: number;
  title: string;
  startedAt: MonoMs | null;
  durationMs: number | null;
  remaining: Remaining;
}

export interface TimingSnapshot {
  blockIndex: number;
  block: Remaining | null;
  delayMs: number | null;
  plannedEndAt: MonoMs | null;
  forecast: Remaining | null;
  rundownFinished: boolean;
  segment: 'studio' | 'media' | 'break' | null;
  onAir: OnAirTiming | null;
  returnAt: Remaining | null;
  returnBlockIndex: number | null;
}

const EMPTY: TimingSnapshot = {
  blockIndex: -1, block: null, delayMs: null, plannedEndAt: null, forecast: null, rundownFinished: false,
  segment: null, onAir: null, returnAt: null, returnBlockIndex: null,
};

function running(endsAt: MonoMs, source: Source): Remaining {
  return { kind: 'running', endsAt, source };
}

function extend(r: Remaining, ms: number, source: Source): Remaining {
  return r.kind === 'running'
    ? { kind: 'running', endsAt: r.endsAt + ms, source: worstSource(r.source, source) }
    : { kind: 'frozen', remainingMs: r.remainingMs + ms, source: worstSource(r.source, source) };
}

/** Converts running values to frozen ones measured at `frozenAt` (REC pause), and degrades sources when OBS is lost. */
function finalize(r: Remaining | null, frozenAt: MonoMs | null, lost: boolean): Remaining | null {
  if (r === null) return null;
  let out = r;
  if (frozenAt !== null && out.kind === 'running') out = { kind: 'frozen', remainingMs: out.endsAt - frozenAt, source: out.source };
  if (lost) out = { ...out, source: 'estimated' };
  return out;
}

function onAirRemaining(s: LiveState, slotIndex: number): OnAirTiming {
  const slot = s.slots[slotIndex]!;
  const rt = s.slotRt[slotIndex]!;
  const base = { slotIndex, title: slot.title, startedAt: rt.startedAt };

  if (slot.kind === 'media') {
    const cur = s.deck.current;
    if (cur !== null && cur.durationMs >= 0) {
      const left = Math.max(0, cur.durationMs - cur.positionMs);
      return {
        ...base,
        durationMs: cur.durationMs,
        remaining: cur.playing ? running(cur.at + left, 'measured') : { kind: 'frozen', remainingMs: left, source: 'measured' },
      };
    }
    const planned = slotDuration(s, slot);
    return { ...base, durationMs: planned.ms, remaining: running((rt.startedAt ?? 0) + planned.ms, planned.source) };
  }

  // break
  const block = s.episode.blocks[slot.blockIndex]!;
  const media = s.media;
  if (block.kind === 'break' && block.mediaInput !== null && media !== null && media.input === block.mediaInput && media.durationMs > 0) {
    const left = Math.max(0, media.durationMs - media.cursorMs);
    return {
      ...base,
      durationMs: media.durationMs,
      remaining: media.playing ? running(media.at + left, 'measured') : { kind: 'frozen', remainingMs: left, source: 'measured' },
    };
  }
  const end = blockEndsAt(s, slot.blockIndex) ?? (rt.startedAt ?? 0) + slot.plannedDurationMs;
  return { ...base, durationMs: s.blockRt[slot.blockIndex]!.targetMs ?? slot.plannedDurationMs, remaining: running(end, 'planned') };
}

export function computeTiming(s: LiveState, nowIn: MonoMs): TimingSnapshot {
  if (s.t0 === null) return { ...EMPTY };
  const now = s.recPausedAt ?? nowIn;
  const frozenAt = s.recPausedAt;
  const lost = s.obs === 'lost';

  const bi = currentBlockIndex(s);
  const last = lastBlockIndex(s);
  const programPlannedEnd = plannedEndAt(s, last)!;
  const endsAt = bi >= 0 ? blockEndsAt(s, bi) : null;

  let delayMs: number | null = null;
  let forecast: Remaining | null = null;
  if (bi >= 0 && endsAt !== null) {
    delayMs = Math.max(endsAt, now) - plannedEndAt(s, bi)!;
    let residual = delayMs;
    for (let j = bi + 1; j <= last && residual > 0; j++) {
      if (isElastic(s, j)) residual -= Math.min(residual, studioTimeMs(s, j));
    }
    forecast = running(programPlannedEnd + residual, 'planned');
  }

  const slot = s.cursor >= 0 ? s.slots[s.cursor]! : null;
  const segment = slot?.kind ?? null;

  let onAir: OnAirTiming | null = null;
  let returnAt: Remaining | null = null;
  let returnBlockIndex: number | null = null;
  if (slot !== null && slot.kind !== 'studio' && s.returnSlot !== null) {
    // Out-of-order item: the show returns to the slot it interrupted.
    onAir = onAirRemaining(s, slot.index);
    returnAt = onAir.remaining;
    returnBlockIndex = s.slots[s.returnSlot]!.blockIndex;
  } else if (slot !== null && slot.kind !== 'studio') {
    onAir = onAirRemaining(s, slot.index);
    let r = onAir.remaining;
    for (let j = slot.index + 1; j < s.slots.length; j++) {
      const next = s.slots[j]!;
      if (next.kind === 'studio') {
        returnBlockIndex = next.blockIndex;
        break;
      }
      const status = s.slotRt[j]!.status;
      if (status === 'done' || status === 'dropped') continue;
      const d = slotDuration(s, next);
      r = extend(r, d.ms, d.source);
    }
    returnAt = returnBlockIndex === null ? null : r;
  }

  return {
    blockIndex: bi,
    block: finalize(endsAt === null ? null : running(endsAt, 'measured'), frozenAt, lost),
    delayMs,
    plannedEndAt: programPlannedEnd,
    forecast: finalize(forecast, frozenAt, lost),
    rundownFinished: bi === last && endsAt !== null && now > endsAt,
    segment,
    onAir: onAir === null ? null : { ...onAir, remaining: finalize(onAir.remaining, frozenAt, lost)! },
    returnAt: finalize(returnAt, frozenAt, lost),
    returnBlockIndex,
  };
}
