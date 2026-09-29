// SPDX-License-Identifier: GPL-2.0-or-later
import { closeSlot, enterSlot, moveTo, startBlock } from './cursor';
import { resolveDeckIndex } from './rundown';
import type { LiveState, MonoMs, Slot } from './types';

export type Target =
  | { kind: 'media'; index: number; path: string }
  | { kind: 'break'; scene: string }
  | { kind: 'studio'; scene: string };

export function classify(s: LiveState): Target | null {
  const cur = s.deck.current;
  if (s.program.deckOnProgram && cur !== null) return { kind: 'media', index: cur.index, path: cur.path };
  const scene = s.program.scene;
  if (scene === null) return null;
  if (s.episode.blocks.some((b) => b.kind === 'break' && b.scene === scene)) return { kind: 'break', scene };
  if (s.episode.sceneGroups.some((g) => g.scenes.includes(scene))) return { kind: 'studio', scene };
  return null;
}

export function slotMatches(s: LiveState, slot: Slot, t: Target): boolean {
  const block = s.episode.blocks[slot.blockIndex]!;
  switch (t.kind) {
    case 'media': {
      if (slot.kind !== 'media') return false;
      if (s.deck.items !== null) return resolveDeckIndex(s.deck.items, slot) === t.index;
      return slot.path === t.path;
    }
    case 'break':
      return slot.kind === 'break' && block.kind === 'break' && block.scene === t.scene;
    case 'studio': {
      if (slot.kind !== 'studio' || block.kind !== 'studio') return false;
      const group = s.episode.sceneGroups.find((g) => g.id === block.sceneGroupId);
      return group !== undefined && group.scenes.includes(t.scene);
    }
  }
}

function markOffScript(s: LiveState, at: MonoMs): void {
  const scene = s.program.scene ?? '';
  if (s.offScript === null || s.offScript.scene !== scene) s.offScript = { scene, since: at };
}

/** Align the cursor with what OBS shows on Program. Mutates `s`. */
export function match(s: LiveState, at: MonoMs): void {
  const target = classify(s);
  if (target === null) {
    markOffScript(s, at);
    return;
  }

  const current = s.cursor >= 0 ? s.slots[s.cursor]! : null;
  if (current !== null && slotMatches(s, current, target)) {
    s.offScript = null;
    return;
  }

  if (
    s.returnSlot !== null &&
    s.slotRt[s.returnSlot]!.status === 'onair' &&
    slotMatches(s, s.slots[s.returnSlot]!, target)
  ) {
    closeSlot(s, s.cursor, at);
    s.cursor = s.returnSlot;
    s.returnSlot = null;
    s.offScript = null;
    return;
  }

  const base = s.returnSlot ?? s.cursor;
  for (let i = base + 1; i < s.slots.length; i++) {
    const status = s.slotRt[i]!.status;
    if ((status === 'pending' || status === 'postponed') && slotMatches(s, s.slots[i]!, target)) {
      if (s.returnSlot !== null) {
        closeSlot(s, s.cursor, at);
        s.cursor = s.returnSlot;
        s.returnSlot = null;
      }
      moveTo(s, i, at);
      s.offScript = null;
      return;
    }
  }

  for (let i = 0; i < base; i++) {
    if (s.slotRt[i]!.status === 'postponed' && slotMatches(s, s.slots[i]!, target)) {
      if (s.returnSlot === null) {
        s.returnSlot = s.cursor;
        // A studio slot being interrupted stays 'onair' (paused, resumed later); a media or break slot
        // being interrupted is really over now, so it must be closed here rather than absorbing the
        // out-of-order clip's airtime when the matcher eventually reaches it again.
        if (s.cursor >= 0 && s.slots[s.cursor]!.kind !== 'studio') closeSlot(s, s.cursor, at);
      } else {
        closeSlot(s, s.cursor, at);
      }
      enterSlot(s, i, at);
      s.cursor = i;
      const slot = s.slots[i]!;
      if (slot.kind === 'break') {
        startBlock(s, slot.blockIndex, at);
        s.media = null;
      }
      s.offScript = null;
      return;
    }
  }

  markOffScript(s, at);
}
