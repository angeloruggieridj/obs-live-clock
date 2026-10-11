// SPDX-License-Identifier: GPL-2.0-or-later

/** One animation-frame loop shared by every counter on the page. */
export interface FrameLoop {
  subscribe(fn: () => void): () => void;
}

/** requestAnimationFrame loop that runs only while something listens. A throwing subscriber is reported, never fatal. */
export function browserFrameLoop(
  raf: (cb: () => void) => number = (cb) => requestAnimationFrame(cb),
  caf: (handle: number) => void = (handle) => cancelAnimationFrame(handle),
  report: (err: unknown) => void = (err) => console.error(err),
): FrameLoop {
  const subscribers = new Set<() => void>();
  let handle: number | null = null;
  const tick = () => {
    handle = null;
    for (const fn of [...subscribers]) {
      try {
        fn();
      } catch (err) {
        report(err);
      }
    }
    // A subscriber added from inside the tick already scheduled the next frame; do not schedule a second one.
    if (handle === null && subscribers.size > 0) handle = raf(tick);
  };
  return {
    subscribe(fn) {
      subscribers.add(fn);
      if (handle === null) handle = raf(tick);
      return () => {
        subscribers.delete(fn);
        if (subscribers.size === 0 && handle !== null) {
          caf(handle);
          handle = null;
        }
      };
    },
  };
}
