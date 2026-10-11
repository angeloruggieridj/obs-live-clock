// SPDX-License-Identifier: GPL-2.0-or-later
import { ticksOf } from './time-format';

/** How far past a boundary a one-tick step backwards must go before the display accepts it. */
export const TICK_HYSTERESIS_MS = 250;

/**
 * Ticks to display for `remainingMs`, given the ticks shown on the previous frame (null on the first one).
 * Countdowns only move forward in time, so a one-tick step back (shown 41, now 42) is almost always jitter: an
 * endsAt re-anchored by a deck update, or a new clock sample, a few ms across the boundary. Such a step is held
 * until it is more than TICK_HYSTERESIS_MS past the boundary; every other change is shown at once.
 */
export function stableTicks(prev: number | null, remainingMs: number): number {
  const next = ticksOf(remainingMs);
  if (prev === null || next !== prev + 1) return next;
  // next === prev + 1 means remainingMs > prev * 1000: hold until it is clearly past that boundary.
  return remainingMs - prev * 1000 > TICK_HYSTERESIS_MS ? next : prev;
}
