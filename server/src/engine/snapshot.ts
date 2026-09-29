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
  /** Current block end (or now, if later) minus its planned end; its source is the block anchor's. */
  delay: { ms: number; source: Source } | null;
  plannedEndAt: MonoMs | null;
  forecast: Remaining | null;
  rundownFinished: boolean;
  segment: 'studio' | 'media' | 'break' | null;
  onAir: OnAirTiming | null;
  returnAt: Remaining | null;
  returnBlockIndex: number | null;
}

const EMPTY: TimingSnapshot = {
  blockIndex: -1, block: null, delay: null, plannedEndAt: null, forecast: null, rundownFinished: false,
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

/** Tolerance for "the media reached its end" (players often stop a few frames short). */
const MEDIA_END_TOLERANCE_MS = 250;

/**
 * Remaining time of a media from a player status. Playing, or stopped at its end (a held last frame is
 * still on Program), it runs, so an ended media counts past zero; only a genuine mid-clip pause freezes.
 */
function mediaRemaining(playing: boolean, positionMs: number, durationMs: number, at: MonoMs): Remaining {
  const left = Math.max(0, durationMs - positionMs);
  const ended = !playing && positionMs >= durationMs - MEDIA_END_TOLERANCE_MS;
  return playing || ended ? running(at + left, 'measured') : { kind: 'frozen', remainingMs: left, source: 'measured' };
}

function onAirRemaining(s: LiveState, slotIndex: number): OnAirTiming {
  const slot = s.slots[slotIndex]!;
  const rt = s.slotRt[slotIndex]!;
  const base = { slotIndex, title: slot.title, startedAt: rt.startedAt };

  if (slot.kind === 'media') {
    const cur = s.deck.current;
    if (cur !== null && cur.durationMs >= 0) {
      return { ...base, durationMs: cur.durationMs, remaining: mediaRemaining(cur.playing, cur.positionMs, cur.durationMs, cur.at) };
    }
    const planned = slotDuration(s, slot);
    return { ...base, durationMs: planned.ms, remaining: running((rt.startedAt ?? 0) + planned.ms, planned.source) };
  }

  // break
  const block = s.episode.blocks[slot.blockIndex]!;
  const media = s.media;
  if (block.kind === 'break' && block.mediaInput !== null && media !== null && media.input === block.mediaInput && media.durationMs > 0) {
    return { ...base, durationMs: media.durationMs, remaining: mediaRemaining(media.playing, media.cursorMs, media.durationMs, media.at) };
  }
  const end = blockEndsAt(s, slot.blockIndex) ?? (rt.startedAt ?? 0) + slot.plannedDurationMs;
  return { ...base, durationMs: s.blockRt[slot.blockIndex]!.targetMs ?? slot.plannedDurationMs, remaining: running(end, 'planned') };
}

export function computeTiming(s: LiveState, nowIn: MonoMs): TimingSnapshot {
  if (s.t0 === null) return { ...EMPTY };
  const now = s.recPausedAt ?? nowIn;
  const frozenAt = s.recPausedAt;
  // An unresolved ambiguity (R1: a confirmed studio slot with a still-unobserved break/media behind it)
  // degrades exactly like OBS being lost: nothing here has actually been re-observed yet either.
  const lost = s.obs === 'lost' || s.ambiguous;

  const bi = currentBlockIndex(s);
  const last = lastBlockIndex(s);
  const programPlannedEnd = plannedEndAt(s, last)!;
  const endsAt = bi >= 0 ? blockEndsAt(s, bi) : null;
  // A block start is measured only when OBS (or the operator) marked it; a start by time is the plan.
  const blockSource: Source = bi >= 0 && s.blockRt[bi]!.startedBy === 'obs' ? 'measured' : 'planned';

  let delay: TimingSnapshot['delay'] = null;
  let forecast: Remaining | null = null;
  if (bi >= 0 && endsAt !== null) {
    const delayMs = Math.max(endsAt, now) - plannedEndAt(s, bi)!;
    delay = { ms: delayMs, source: lost ? 'estimated' : blockSource };
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
    block: finalize(endsAt === null ? null : running(endsAt, blockSource), frozenAt, lost),
    delay,
    plannedEndAt: programPlannedEnd,
    forecast: finalize(forecast, frozenAt, lost),
    rundownFinished: bi === last && endsAt !== null && now > endsAt,
    segment,
    onAir: onAir === null ? null : { ...onAir, remaining: finalize(onAir.remaining, frozenAt, lost)! },
    returnAt: finalize(returnAt, frozenAt, lost),
    returnBlockIndex,
  };
}
