// SPDX-License-Identifier: GPL-2.0-or-later
import { useLayoutEffect, useRef, type RefObject } from 'react';
import { UNKNOWN_TEXT, anchorFrame, type AnchorFrame } from '../core/anchor';
import type { Anchor } from '../core/views';
import { useLive, useSnapshot } from './live-context';

export interface AnchoredTimeProps {
  anchor: Anchor | null;
  className?: string;
  /** Tally for each frame, written as data-tally onto `tallyRef` (or onto the counter itself). */
  tally?: (frame: AnchorFrame) => string;
  tallyRef?: RefObject<HTMLElement | null>;
  /** Ticks shown just before this counter mounted, so the hysteresis continues across a remount. */
  seedTicks?: number | null;
}

const NO_CLOCK: AnchorFrame = { text: UNKNOWN_TEXT, ticks: null, remainingMs: null, source: null, paused: false, stale: false };

/** Sets the text of the element's own text node (the one React rendered), so React and the frame loop share it. */
export function setText(el: HTMLElement, text: string): void {
  const node = el.firstChild;
  if (node !== null && node.nodeType === 3) {
    if (node.nodeValue !== text) node.nodeValue = text;
  } else if (el.textContent !== text) {
    el.textContent = text;
  }
}

function setData(el: HTMLElement, key: string, value: string): void {
  if (el.dataset[key] !== value) el.dataset[key] = value;
}

export function writeFrame(el: HTMLElement, frame: AnchorFrame): void {
  setText(el, frame.text);
  setData(el, 'len', String(frame.text.length));
  setData(el, 'source', frame.source ?? 'unknown');
  setData(el, 'paused', String(frame.paused));
  setData(el, 'stale', String(frame.stale));
}

/**
 * DT-2/DT-7 counter: computed on every animation frame from the anchor and the synced server clock and written
 * straight into the DOM. React renders it once per anchor or staleness change, never per frame.
 */
export function AnchoredTime({ anchor, className, tally, tallyRef, seedTicks = null }: AnchoredTimeProps) {
  const { store, frames } = useLive();
  const snap = useSnapshot();
  const staleSince = snap.stale ? (snap.staleSince ?? Number.NEGATIVE_INFINITY) : null;
  const ref = useRef<HTMLSpanElement>(null);
  const prevTicks = useRef<number | null>(seedTicks);
  const tallyFn = useRef(tally);
  tallyFn.current = tally;

  const frameNow = (): AnchorFrame => {
    const now = store.serverNow();
    return now === null ? NO_CLOCK : anchorFrame(anchor, now, staleSince, prevTicks.current);
  };
  const first = frameNow(); // the first paint, and SSR, already show the right value

  useLayoutEffect(() => {
    const el = ref.current;
    if (el === null) return undefined;
    const paint = () => {
      const frame = frameNow();
      prevTicks.current = frame.ticks;
      writeFrame(el, frame);
      // A parent tallyRef is attached after this child effect on the first commit: it is picked up on the next frame.
      const fn = tallyFn.current;
      const target = tallyRef === undefined ? el : tallyRef.current;
      if (fn !== undefined && target !== null) setData(target, 'tally', fn(frame));
    };
    paint();
    return frames.subscribe(paint);
    // frameNow closes over anchor, staleSince and store, all listed here.
  }, [anchor, staleSince, store, frames, tallyRef]);

  return (
    <span
      ref={ref}
      className={className}
      data-len={first.text.length}
      data-source={first.source ?? 'unknown'}
      data-paused={String(first.paused)}
      data-stale={String(first.stale)}
    >
      {first.text}
    </span>
  );
}
