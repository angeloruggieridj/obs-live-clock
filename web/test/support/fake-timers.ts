// SPDX-License-Identifier: GPL-2.0-or-later
import type { Timers } from '../../src/editor/store/autosave';

/** Deterministic timers: `advance(ms)` runs due callbacks in order and lets promise chains settle between them. */
export function fakeTimers() {
  let now = 0;
  const queue: Array<{ at: number; fn: () => void }> = [];
  const timers: Timers = {
    now: () => now,
    set(fn, ms) {
      const entry = { at: now + ms, fn };
      queue.push(entry);
      return () => {
        const i = queue.indexOf(entry);
        if (i >= 0) queue.splice(i, 1);
      };
    },
  };
  const settle = async () => {
    for (let i = 0; i < 6; i++) await Promise.resolve();
  };
  const advance = async (ms: number) => {
    const end = now + ms;
    for (;;) {
      queue.sort((a, b) => a.at - b.at);
      const next = queue[0];
      if (next === undefined || next.at > end) break;
      queue.shift();
      now = next.at;
      next.fn();
      await settle();
    }
    now = end;
    await settle();
  };
  return { timers, advance, pending: () => queue.length };
}
