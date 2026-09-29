// SPDX-License-Identifier: GPL-2.0-or-later
import { currentBlockIndex } from './rundown';
import { targetForBlockStart } from './timing';
import type { LiveState, MonoMs } from './types';

export function startBlock(s: LiveState, blockIndex: number, at: MonoMs): void {
  const rt = s.blockRt[blockIndex]!;
  if (rt.startedAt !== null) return;
  rt.startedAt = at;
  rt.endedAt = null;
  rt.targetMs = targetForBlockStart(s, blockIndex, at);
}

export function enterSlot(s: LiveState, index: number, at: MonoMs): void {
  const rt = s.slotRt[index]!;
  rt.status = 'onair';
  rt.startedAt = at;
  rt.endedAt = null;
}

export function closeSlot(s: LiveState, index: number, at: MonoMs): void {
  if (index < 0) return;
  const rt = s.slotRt[index]!;
  if (rt.status !== 'onair') return;
  rt.status = 'done';
  rt.endedAt = at;
}

/** Advance the cursor forward to `target`. Skipped slots are closed (studio) or postponed (media, break). */
export function moveTo(s: LiveState, target: number, at: MonoMs): void {
  const from = s.cursor;
  closeSlot(s, from, at);
  for (let j = from + 1; j < target; j++) {
    const rt = s.slotRt[j]!;
    if (rt.status !== 'pending') continue;
    rt.status = s.slots[j]!.kind === 'studio' ? 'done' : 'postponed';
  }
  enterSlot(s, target, at);

  const blockIndex = s.slots[target]!.blockIndex;
  const current = currentBlockIndex(s);
  if (blockIndex > current) {
    for (let b = 0; b < blockIndex; b++) {
      const rt = s.blockRt[b]!;
      if (rt.startedAt !== null && rt.endedAt === null) rt.endedAt = at;
    }
    startBlock(s, blockIndex, at);
  }
  if (s.slots[target]!.kind === 'break') s.media = null;
  s.cursor = target;
}

/** Manual correction to an earlier slot: later slots return to pending and later blocks are un-started. */
export function correctTo(s: LiveState, index: number, at: MonoMs): void {
  for (let j = index + 1; j <= s.cursor; j++) {
    s.slotRt[j] = { status: 'pending', startedAt: null, endedAt: null };
  }
  const blockIndex = s.slots[index]!.blockIndex;
  for (let b = blockIndex + 1; b < s.blockRt.length; b++) {
    s.blockRt[b] = { ...s.blockRt[b]!, startedAt: null, endedAt: null, targetMs: null };
  }
  s.blockRt[blockIndex]!.endedAt = null;
  const rt = s.slotRt[index]!;
  rt.status = 'onair';
  rt.startedAt = rt.startedAt ?? at;
  rt.endedAt = null;
  startBlock(s, blockIndex, at);
  s.cursor = index;
  s.returnSlot = null;
}
