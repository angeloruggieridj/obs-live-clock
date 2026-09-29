// SPDX-License-Identifier: GPL-2.0-or-later
import { closeSlot, correctTo, enterSlot, moveTo, startBlock } from './cursor';
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

/**
 * First match after OBS came back: hand-overs made by time during the loss were guesses. If what OBS now
 * shows still matches the provisional current slot, the guess was right: keep it (the block stays
 * 'planned', not 'measured' — nothing was actually observed). Only when Program shows something else does
 * the guess get discarded: return to the pre-loss slot (un-starting the blocks started by time since) and
 * let the normal match below decide from there.
 */
function resync(s: LiveState, at: MonoMs): void {
  const pre = s.preLossCursor;
  s.preLossCursor = null;
  s.resyncPending = false;
  if (pre === null || pre < 0 || (s.returnSlot ?? s.cursor) <= pre) return;
  const target = classify(s);
  if (target !== null && s.cursor >= 0 && slotMatches(s, s.slots[s.cursor]!, target)) return;
  if (s.returnSlot !== null) closeSlot(s, s.cursor, at);
  correctTo(s, pre, at);
}

/** Align the cursor with what OBS shows on Program. Mutates `s`. */
export function match(s: LiveState, at: MonoMs): void {
  if (s.resyncPending) resync(s, at);
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

  if (target.kind === 'media' && reenterClip(s, target, at)) {
    s.offScript = null;
    return;
  }

  markOffScript(s, at);
}

/**
 * Brief cutaway to studio during a clip: the clip was closed by the cut, but the same deck item is still
 * playing. Re-open the most recently closed media slot and treat the studio slot as interrupted.
 */
function reenterClip(s: LiveState, target: Target, at: MonoMs): boolean {
  const cur = s.deck.current;
  if (s.cursor < 0 || s.returnSlot !== null || s.slots[s.cursor]!.kind !== 'studio') return false;
  if (cur === null || !cur.playing) return false;
  const position = cur.positionMs + (at - cur.at);
  if (cur.durationMs >= 0 && position >= cur.durationMs) return false;

  let last = -1;
  for (let i = 0; i < s.slots.length; i++) {
    const rt = s.slotRt[i]!;
    if (s.slots[i]!.kind !== 'media' || rt.status !== 'done' || rt.endedAt === null) continue;
    if (last < 0 || rt.endedAt >= s.slotRt[last]!.endedAt!) last = i;
  }
  if (last < 0 || !slotMatches(s, s.slots[last]!, target)) return false;

  const rt = s.slotRt[last]!;
  rt.status = 'onair';
  rt.endedAt = null;
  s.returnSlot = s.cursor; // the studio slot stays on air and resumes on the next studio cut
  s.cursor = last;
  return true;
}
