// SPDX-License-Identifier: GPL-2.0-or-later
import { clearAmbiguity, closeSlot, correctTo, enterSlot, moveTo, startBlock } from './cursor';
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
 * shows still matches the provisional current slot, the guess was right: keep it. Only when Program shows
 * something else does the guess get discarded: return to the pre-loss slot (un-starting the blocks started
 * by time since) and let the normal match below decide from there.
 *
 * A confirmed studio slot is not necessarily the whole story: the estimating loop may have guessed its way
 * through a break or a media slot to get there, and OBS never actually saw that break/media air. That gap
 * is marked `ambiguous` and stays that way — degrading the clock like OBS is still lost — until a later
 * match resolves it: a real media/break observation, or a correction back into the gap.
 */
function resync(s: LiveState, at: MonoMs): void {
  const pre = s.preLossCursor;
  s.preLossCursor = null;
  s.resyncPending = false;
  if (pre === null || pre < 0 || (s.returnSlot ?? s.cursor) <= pre) return;
  const target = classify(s);
  const matchesCurrent = target !== null && s.cursor >= 0 && slotMatches(s, s.slots[s.cursor]!, target);
  if (!matchesCurrent) {
    if (s.returnSlot !== null) closeSlot(s, s.cursor, at);
    correctTo(s, pre, at);
    return;
  }
  if (target!.kind !== 'studio') return; // a media/break match below clears the ambiguity itself
  let ambiguous = false;
  for (let i = pre + 1; i < s.cursor; i++) {
    const rt = s.slotRt[i]!;
    if (s.slots[i]!.kind !== 'studio' && rt.provisional && rt.status !== 'dropped') {
      ambiguous = true;
      break;
    }
  }
  // Only ever SET ambiguity here, never clear it: an unresolved gap from an earlier outage is not resolved
  // just because this outage's own (possibly shorter) gap happens to be clean. Only an actual observation —
  // a media/break match, a correction, or an operator command — earns that.
  if (ambiguous) s.ambiguous = true;
}

/** Whether `index` is the first slot of its block that is not `dropped`: the one that actually opens it. */
function opensBlock(s: LiveState, index: number): boolean {
  const blockIndex = s.slots[index]!.blockIndex;
  for (const slot of s.slots) {
    if (slot.blockIndex !== blockIndex) continue;
    if (s.slotRt[slot.index]!.status === 'dropped') continue;
    return slot.index === index;
  }
  return false;
}

/**
 * A slot the estimating loop guessed its way through (never observed) can still match the target during the
 * backward search: unlike a genuine out-of-order excursion, this is a correction to the truth, not a detour
 * from it. Its block restarts fresh as observed ('obs') only when this slot is what actually opens the block
 * (a break, or the first non-dropped slot of a studio block) — otherwise the block was already legitimately
 * started (by OBS or by an earlier, still-valid time hand-over) and correctTo()'s guarded startBlock leaves
 * that start alone.
 */
function correctProvisional(s: LiveState, index: number, at: MonoMs): void {
  const slot = s.slots[index]!;
  if (slot.kind === 'break' || opensBlock(s, index)) {
    s.blockRt[slot.blockIndex] = { ...s.blockRt[slot.blockIndex]!, startedAt: null, endedAt: null, targetMs: null, startedBy: null };
  }
  s.slotRt[index] = { status: 'pending', startedAt: null, endedAt: null, provisional: false };
  correctTo(s, index, at);
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
    if (target.kind !== 'studio') clearAmbiguity(s);
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
    if (target.kind !== 'studio') clearAmbiguity(s);
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
      if (target.kind !== 'studio') clearAmbiguity(s);
      return;
    }
  }

  for (let i = 0; i < base; i++) {
    const rt = s.slotRt[i]!;
    const slot = s.slots[i]!;
    // A slot the estimating loop only guessed its way through (never observed) is a correction, not an
    // out-of-order excursion: unlike a genuine postponed item, its block restarts fresh as observed.
    if (rt.provisional && (rt.status === 'done' || rt.status === 'postponed') && slotMatches(s, slot, target)) {
      correctProvisional(s, i, at);
      s.offScript = null;
      return;
    }
    if (rt.status === 'postponed' && slotMatches(s, slot, target)) {
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
      if (slot.kind === 'break') {
        startBlock(s, slot.blockIndex, at);
        s.media = null;
      }
      s.offScript = null;
      clearAmbiguity(s); // a real media/break observation, in or out of order, resolves any ambiguity
      return;
    }
  }

  if (target.kind === 'media' && reenterClip(s, target, at)) {
    s.offScript = null;
    clearAmbiguity(s);
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
