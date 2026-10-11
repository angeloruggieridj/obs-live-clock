// SPDX-License-Identifier: GPL-2.0-or-later
import { useLayoutEffect, useRef } from 'react';
import { remainingAt } from '../core/anchor';
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
  const staleSince = snap.stale ? snap.staleSince : null;
  const ref = useRef<HTMLDivElement>(null);
  const at = (): number | null => {
    const now = store.serverNow();
    return now === null ? null : (staleSince ?? now);
  };
  const first = progressAt(anchor, durationMs, at());

  useLayoutEffect(() => {
    const el = ref.current;
    if (el === null) return undefined;
    const paint = () => {
      const p = progressAt(anchor, durationMs, at());
      const transform = transformOf(p);
      if (el.style.transform !== transform) el.style.transform = transform;
      const known = String(p !== null);
      if (el.dataset.known !== known) el.dataset.known = known;
    };
    paint();
    return frames.subscribe(paint);
  }, [anchor, durationMs, staleSince, store, frames]);

  return (
    <div className="progress" aria-hidden="true">
      <div ref={ref} className="progress-fill" data-known={String(first !== null)} style={{ transform: transformOf(first) }} />
    </div>
  );
}
