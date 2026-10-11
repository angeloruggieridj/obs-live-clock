// SPDX-License-Identifier: GPL-2.0-or-later

export const RECONNECT_BASE_MS = 500;
export const RECONNECT_MAX_MS = 5_000;

/** Failure n (0-based) waits min(5 s, 0.5 s · 2^n), jittered to [0.8, 1.2) so many clients do not reconnect in lockstep. */
export function reconnectDelay(failures: number, random: () => number): number {
  const base = Math.min(RECONNECT_MAX_MS, RECONNECT_BASE_MS * 2 ** Math.max(0, failures));
  return Math.round(base * (0.8 + 0.4 * random()));
}
