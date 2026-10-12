// SPDX-License-Identifier: GPL-2.0-or-later

export const RECONNECT_BASE_MS = 500;
export const RECONNECT_MAX_MS = 5_000;

/** Failure n (0-based) waits min(5 s, 0.5 s · 2^n), jittered to [0.8, 1.2) so many clients do not reconnect in lockstep. */
export function reconnectDelay(failures: number, random: () => number): number {
  const n = Number.isFinite(failures) ? Math.max(0, failures) : 0;
  const base = Math.min(RECONNECT_MAX_MS, RECONNECT_BASE_MS * 2 ** n);
  const r = random();
  // A broken random (or failure count) must not turn the reconnect timer into NaN.
  return Math.round(base * (Number.isFinite(r) ? 0.8 + 0.4 * r : 1));
}
