// SPDX-License-Identifier: GPL-2.0-or-later
import { useLayoutEffect, useRef } from 'react';
import { UNKNOWN_TEXT } from '../core/anchor';
import { wallText } from '../core/time-format';
import { setText } from './AnchoredTime';
import { useLive } from './live-context';

/** The server's wall clock (NF4: the server is the only source of time), repainted per frame. */
export function AnchoredWall({ className }: { className?: string }) {
  const { store, frames, timeZone } = useLive();
  const ref = useRef<HTMLSpanElement>(null);
  const text = (): string => {
    const now = store.serverNow();
    return now === null ? UNKNOWN_TEXT : wallText(now, timeZone);
  };
  const first = text();

  useLayoutEffect(() => {
    const el = ref.current;
    if (el === null) return undefined;
    const paint = () => setText(el, text());
    paint();
    return frames.subscribe(paint);
  }, [store, frames, timeZone]);

  return (
    <span ref={ref} className={className}>
      {first}
    </span>
  );
}
