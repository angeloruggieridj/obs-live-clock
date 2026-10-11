// SPDX-License-Identifier: GPL-2.0-or-later
import { stableTicks } from './stable-ticks';
import { tickText } from './time-format';
import type { Anchor, Source } from './views';

/** After this long stale, a frozen counter gives up and shows "—". */
export const STALE_BLANK_MS = 10_000;
export const UNKNOWN_TEXT = '—';

export interface AnchorFrame {
  text: string;
  /** Displayed tick; null when the text is "—". */
  ticks: number | null;
  remainingMs: number | null;
  /** null for an unknown or missing anchor. */
  source: Source | null;
  /** A frozen anchor: media paused or REC pause (shown with "PAUSA"). */
  paused: boolean;
  stale: boolean;
}

/** Signed remaining time of an anchor at server time `now`; null when unknown. */
export function remainingAt(anchor: Anchor, now: number): number | null {
  switch (anchor.kind) {
    case 'countdown':
      return anchor.endsAt - now;
    case 'frozen':
      return anchor.valueMs;
    case 'unknown':
      return null;
  }
}

/**
 * What a counter shows at server time `now`. `staleSince` is the server time at which the data went stale (null
 * while fresh; -Infinity when it went stale before the clock was synced). Stale counters freeze at that instant,
 * never counting on as if fresh, and show "—" once STALE_BLANK_MS have passed.
 */
export function anchorFrame(anchor: Anchor | null, now: number, staleSince: number | null, prevTicks: number | null): AnchorFrame {
  const stale = staleSince !== null;
  if (
    anchor === null ||
    anchor.kind === 'unknown' ||
    !Number.isFinite(now) ||
    (staleSince !== null && (Number.isNaN(staleSince) || now - staleSince > STALE_BLANK_MS))
  ) {
    const source = anchor !== null && anchor.kind !== 'unknown' ? anchor.source : null;
    return { text: UNKNOWN_TEXT, ticks: null, remainingMs: null, source, paused: false, stale };
  }
  const remainingMs = remainingAt(anchor, staleSince ?? now)!;
  if (!Number.isFinite(remainingMs)) {
    return { text: UNKNOWN_TEXT, ticks: null, remainingMs: null, source: anchor.source, paused: false, stale };
  }
  const ticks = stableTicks(prevTicks, remainingMs);
  return { text: tickText(ticks), ticks, remainingMs, source: anchor.source, paused: anchor.kind === 'frozen', stale };
}
