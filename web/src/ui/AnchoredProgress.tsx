// SPDX-License-Identifier: GPL-2.0-or-later
import { useLayoutEffect, useRef } from 'react';
import { STALE_BLANK_MS, remainingAt } from '../core/anchor';
import type { Anchor } from '../core/views';
import { useLive, useSnapshot } from './live-context';

/** Fraction elapsed of an on-air item, or null when it cannot be known (no duration, unknown anchor, no clock). */
export function progressAt(anchor: Anchor, durationMs: number | null, now: number | null): number | null {
  if (now === null || durationMs === null || durationMs <= 0) return null;
  const r = remainingAt(anchor, now);
  if (r === null) return null;
  return Math.min(1, Math.max(0, 1 - r / durationMs));
}

const transformOf = (p: number | null): string => `scaleX(${(p ?? 0).toFixed(4)})`;

/** Progress bar of the on-air item, repainted per frame as a scaleX transform (no React render). */
export function AnchoredProgress({ anchor, durationMs }: { anchor: Anchor; durationMs: number | null }) {
  const { store, frames } = useLive();
  const snap = useSnapshot();
  const staleSince = snap.stale ? (snap.staleSince ?? Number.NEGATIVE_INFINITY) : null;
  const ref = useRef<HTMLDivElement>(null);
  /**
   * Frozen at the stale instant while stale (never counting on as if fresh), and unknown once the data has been
   * stale longer than STALE_BLANK_MS — a frozen bar on a stale feed is a confident wrong value (same rule as
   * anchorFrame).
   */
  const progressNow = (): number | null => {
    const now = store.serverNow();
    if (now === null || !Number.isFinite(now)) return null;
    if (staleSince !== null && (Number.isNaN(staleSince) || now - staleSince > STALE_BLANK_MS)) return null;
    return progressAt(anchor, durationMs, staleSince ?? now);
  };
  const first = progressNow();

  useLayoutEffect(() => {
    const el = ref.current;
    if (el === null) return undefined;
    const paint = () => {
      const p = progressNow();
      const transform = transformOf(p);
      if (el.style.transform !== transform) el.style.transform = transform;
      const known = String(p !== null);
      if (el.dataset.known !== known) el.dataset.known = known;
      const stale = String(staleSince !== null);
      if (el.dataset.stale !== stale) el.dataset.stale = stale;
    };
    paint();
    return frames.subscribe(paint);
  }, [anchor, durationMs, staleSince, store, frames]);

  return (
    <div className="progress" aria-hidden="true">
      <div
        ref={ref}
        className="progress-fill"
        data-known={String(first !== null)}
        data-stale={String(staleSince !== null)}
        style={{ transform: transformOf(first) }}
      />
    </div>
  );
}
