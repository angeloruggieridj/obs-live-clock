// SPDX-License-Identifier: GPL-2.0-or-later
import { plannedStudioTimeMs, type Block, type StudioBlock } from '@olc/shared';

export function blockOffsets(blocks: ReadonlyArray<Pick<Block, 'durationMs'>>): number[] {
  let t = 0;
  return blocks.map((b) => {
    const offset = t;
    t += b.durationMs;
    return offset;
  });
}

export function totalMs(blocks: ReadonlyArray<Pick<Block, 'durationMs'>>): number {
  return blocks.reduce((t, b) => t + b.durationMs, 0);
}

/** Epoch ms of the planned end (planned start + total), or null when there is no valid planned start. */
export function plannedEndMs(plannedStart: string | null, total: number): number | null {
  if (plannedStart === null) return null;
  const start = Date.parse(plannedStart);
  return Number.isNaN(start) ? null : start + total;
}

export function mediaTotalMs(block: StudioBlock): number {
  return block.elements.reduce((t, e) => (e.kind === 'media' ? t + e.plannedDurationMs : t), 0);
}

/** Local calendar date as `YYYY-MM-DD`. */
export function localDate(now: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

/** `2026-10-12` + `19:30` in the browser's time zone → `2026-10-12T19:30:00+02:00` (ISO 8601 with offset, as the schema requires). */
export function toIsoWithOffset(date: string, time: string): string {
  const [y, mo, d] = date.split('-').map(Number) as [number, number, number];
  const [h, mi] = time.split(':').map(Number) as [number, number];
  const local = new Date(y, mo - 1, d, h, mi, 0);
  const offset = -local.getTimezoneOffset();
  const sign = offset >= 0 ? '+' : '-';
  const p = (n: number) => String(Math.trunc(n)).padStart(2, '0');
  return `${date}T${p(h)}:${p(mi)}:00${sign}${p(Math.abs(offset) / 60)}:${p(Math.abs(offset) % 60)}`;
}

/** `HH:MM` in the browser's time zone of an ISO datetime; null when absent or invalid. */
export function timeOfDay(iso: string | null): string | null {
  if (iso === null) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  const d = new Date(t);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}`;
}

export interface BlockTiming {
  id: string;
  startMs: number;
  endMs: number;
  /** Duration minus media; null for a break. Negative = media exceed the block (an error). */
  studioMs: number | null;
  /** Media elements whose duration is unknown (counted as 0 above, flagged in the UI). */
  unknownMedia: number;
}

export function blockTimings(blocks: ReadonlyArray<Block>): BlockTiming[] {
  const offsets = blockOffsets(blocks);
  return blocks.map((b, i) => ({
    id: b.id,
    startMs: offsets[i]!,
    endMs: offsets[i]! + b.durationMs,
    studioMs: b.kind === 'studio' ? plannedStudioTimeMs(b) : null,
    unknownMedia: b.kind === 'studio' ? b.elements.filter((e) => e.kind === 'media' && e.durationSource === 'unknown').length : 0,
  }));
}
