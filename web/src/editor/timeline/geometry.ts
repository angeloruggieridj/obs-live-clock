// SPDX-License-Identifier: GPL-2.0-or-later
import { MIN_BLOCK_MS, SNAP_MS } from '../model/constants';

/** Narrowest a block is drawn, so a 5 s block stays clickable. Positions accumulate the drawn widths. */
export const MIN_BLOCK_PX = 56;
export const MIN_SCALE = 0.0002; // px per ms: 0.2 px per second (a 3 h show fits in 2160 px)
export const MAX_SCALE = 0.2; // 200 px per second
export const DEFAULT_SCALE = 0.02;

export function snapMs(ms: number, step: number = SNAP_MS): number {
  return Math.round(ms / step) * step;
}

export function clampDuration(ms: number): number {
  if (!Number.isFinite(ms)) return MIN_BLOCK_MS; // a non-finite duration is unusable: clamp it to the minimum
  return Math.max(MIN_BLOCK_MS, snapMs(ms));
}

export interface Slot {
  id: string;
  x: number;
  w: number;
}

export function layout(
  blocks: ReadonlyArray<{ id: string; durationMs: number }>,
  pxPerMs: number,
  minPx: number = MIN_BLOCK_PX,
  gap = 0,
): Slot[] {
  let x = 0;
  return blocks.map((b) => {
    const raw = b.durationMs * pxPerMs;
    const w = Number.isFinite(raw) ? Math.max(minPx, raw) : minPx; // a non-finite width falls back to the minimum
    const slot = { id: b.id, x, w };
    x += w + gap;
    return slot;
  });
}

/** Scale (px per ms) that makes the whole rundown fit `availablePx`, within the zoom limits. */
export function fitScale(totalMs: number, availablePx: number): number {
  if (!Number.isFinite(totalMs) || !Number.isFinite(availablePx) || totalMs <= 0 || availablePx <= 0) return DEFAULT_SCALE;
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, availablePx / totalMs));
}

/** Final index of the dragged block after moving it by `deltaX` px. Unknown id: -1. */
export function dropIndex(slots: readonly Slot[], draggedId: string, deltaX: number): number {
  const dragged = slots.find((s) => s.id === draggedId);
  if (dragged === undefined) return -1;
  if (!Number.isFinite(deltaX)) return slots.findIndex((s) => s.id === draggedId); // no movement: keep the index
  const centre = dragged.x + dragged.w / 2 + deltaX;
  let index = 0;
  for (const s of slots) {
    if (s.id === draggedId) continue;
    if (s.x + s.w / 2 < centre) index++;
  }
  return index;
}

/** New duration after dragging the right handle by `deltaPx`: snapped to 5 s, never below the minimum. */
export function resizeDuration(startMs: number, deltaPx: number, pxPerMs: number): number {
  if (!Number.isFinite(deltaPx) || !(pxPerMs > 0)) return startMs; // a non-finite delta leaves the duration unchanged
  return clampDuration(startMs + deltaPx / pxPerMs);
}

export type BlockIntent =
  | { type: 'select'; delta: -1 | 1 }
  | { type: 'move'; delta: -1 | 1 }
  | { type: 'resize'; deltaMs: number }
  | { type: 'delete' }
  | { type: 'duplicate' };

export interface KeyLike {
  key: string;
  shiftKey: boolean;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
}

/**
 * Keyboard map of a focused block.
 * Arrow: select neighbour · Alt+Arrow: move · Shift+Arrow: resize ±5 s · Ctrl/Cmd+Shift+Arrow: resize ±60 s ·
 * Delete: delete · Ctrl/Cmd+D: duplicate. Anything else: null (the browser keeps its default).
 */
export function blockKeyIntent(e: KeyLike): BlockIntent | null {
  const mod = e.ctrlKey || e.metaKey;
  const dir = e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowRight' ? 1 : 0;
  if (dir !== 0) {
    if (e.shiftKey && mod) return { type: 'resize', deltaMs: dir * 60_000 };
    if (e.shiftKey) return { type: 'resize', deltaMs: dir * SNAP_MS };
    if (e.altKey) return { type: 'move', delta: dir };
    if (mod) return null;
    return { type: 'select', delta: dir };
  }
  if (e.key === 'Delete' && !mod && !e.altKey) return { type: 'delete' };
  if ((e.key === 'd' || e.key === 'D') && mod && !e.shiftKey && !e.altKey) return { type: 'duplicate' };
  return null;
}
