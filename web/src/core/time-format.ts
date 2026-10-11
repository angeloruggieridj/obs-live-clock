// SPDX-License-Identifier: GPL-2.0-or-later

/** U+2212 MINUS SIGN: as wide as "+" in tabular figures, unlike "-". */
export const MINUS = '−';

/**
 * The tick a counter displays for a signed remaining time: ceil to whole seconds. 10_000 → 10, 9_001 → 10,
 * 1 → 1, 0 → 0, -999 → 0, -1_000 → -1. Positive ticks count down; zero and negative ticks are the overrun,
 * shown counting up ("+0:00", "+0:01"). Each tick lasts exactly one second and changes on the boundary.
 */
export function ticksOf(remainingMs: number): number {
  const t = Math.ceil(remainingMs / 1000);
  return t === 0 ? 0 : t; // never -0
}

/** "m:ss" under one hour, "h:mm:ss" from one hour. `seconds` is a non-negative integer. */
export function clockText(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const ss = String(seconds % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

/** "8:42" counting down; "+0:00", "+1:12" past zero (SPEC §7 SFORAMENTO, OLTRE SCALETTA). */
export function tickText(ticks: number): string {
  return ticks > 0 ? clockText(ticks) : `+${clockText(-ticks)}`;
}

/** A plain duration, rounded to the nearest second ("3:04"). Durations are never negative. */
export function durationText(ms: number): string {
  return clockText(Math.max(0, Math.round(ms / 1000)));
}

/** A signed offset (delay, final offset) rounded to the nearest second: "+0:42", "−0:15", "0:00". */
export function signedText(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s === 0) return '0:00';
  return `${s > 0 ? '+' : MINUS}${clockText(Math.abs(s))}`;
}

const wallFormats = new Map<string, Intl.DateTimeFormat>();

/** "19:58:40", 24-hour. `timeZone` is for tests; the browser's own zone is used otherwise. */
export function wallText(wallMs: number, timeZone?: string): string {
  const key = timeZone ?? '';
  let format = wallFormats.get(key);
  if (format === undefined) {
    format = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23', timeZone });
    wallFormats.set(key, format);
  }
  return format.format(wallMs);
}
