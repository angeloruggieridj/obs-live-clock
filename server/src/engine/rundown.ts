// SPDX-License-Identifier: GPL-2.0-or-later
import type { Episode } from '@olc/shared';
import type { DeckItem, LiveState, Slot, Source } from './types';

export interface TimedValue {
  ms: number;
  source: Source;
}

const SOURCE_RANK: Record<Source, number> = { measured: 0, planned: 1, estimated: 2 };

export function worstSource(a: Source, b: Source): Source {
  return SOURCE_RANK[a] >= SOURCE_RANK[b] ? a : b;
}

export function buildSlots(ep: Episode): Slot[] {
  const slots: Slot[] = [];
  ep.blocks.forEach((block, blockIndex) => {
    if (block.kind === 'break') {
      slots.push({
        index: slots.length, blockIndex, kind: 'break', elementId: null, title: block.name,
        path: null, occurrence: 0, plannedDurationMs: block.durationMs,
      });
      return;
    }
    for (const e of block.elements) {
      if (e.kind === 'studio') {
        slots.push({
          index: slots.length, blockIndex, kind: 'studio', elementId: e.id, title: block.name,
          path: null, occurrence: 0, plannedDurationMs: 0,
        });
      } else {
        slots.push({
          index: slots.length, blockIndex, kind: 'media', elementId: e.id, title: e.title,
          path: e.path, occurrence: e.occurrence, plannedDurationMs: e.plannedDurationMs,
        });
      }
    }
  });
  return slots;
}

/** Playlist index of a media slot: the n-th item with the same path. */
export function resolveDeckIndex(items: DeckItem[] | null, slot: Slot): number | null {
  if (items === null || slot.kind !== 'media' || slot.path === null) return null;
  let seen = 0;
  for (const item of items) {
    if (item.path !== slot.path) continue;
    if (seen === slot.occurrence) return item.index;
    seen++;
  }
  return null;
}

export function slotDuration(s: LiveState, slot: Slot): TimedValue {
  if (slot.kind === 'media') {
    const idx = resolveDeckIndex(s.deck.items, slot);
    const item = idx === null ? undefined : s.deck.items?.find((i) => i.index === idx);
    if (item !== undefined && item.durationMs >= 0) return { ms: item.durationMs, source: 'measured' };
  }
  return { ms: slot.plannedDurationMs, source: 'planned' };
}

/** Studio time of a block: its duration minus the media it still contains (never negative). */
export function studioTimeMs(s: LiveState, blockIndex: number): number {
  const block = s.episode.blocks[blockIndex];
  if (block === undefined || block.kind !== 'studio') return 0;
  const media = s.slots
    .filter((sl) => sl.blockIndex === blockIndex && sl.kind === 'media' && s.slotRt[sl.index]!.status !== 'dropped')
    .reduce((t, sl) => t + slotDuration(s, sl).ms, 0);
  return Math.max(0, block.durationMs - media);
}

export function firstSlotOfBlock(s: LiveState, blockIndex: number): number {
  return s.slots.findIndex((sl) => sl.blockIndex === blockIndex);
}

/** Highest block that has started, or -1. */
export function currentBlockIndex(s: LiveState): number {
  for (let i = s.blockRt.length - 1; i >= 0; i--) {
    if (s.blockRt[i]!.startedAt !== null) return i;
  }
  return -1;
}

export function lastBlockIndex(s: LiveState): number {
  return s.episode.blocks.length - 1;
}

export function isElastic(s: LiveState, blockIndex: number): boolean {
  const b = s.episode.blocks[blockIndex];
  return b !== undefined && b.kind === 'studio' && b.elastic;
}
