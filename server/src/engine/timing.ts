// SPDX-License-Identifier: GPL-2.0-or-later
import { isElastic, studioTimeMs } from './rundown';
import type { LiveState, MonoMs } from './types';

export function plannedStartAt(s: LiveState, blockIndex: number): MonoMs | null {
  if (s.t0 === null) return null;
  let t = s.t0;
  for (let j = 0; j < blockIndex; j++) t += s.episode.blocks[j]!.durationMs;
  return t;
}

export function plannedEndAt(s: LiveState, blockIndex: number): MonoMs | null {
  const start = plannedStartAt(s, blockIndex);
  return start === null ? null : start + s.episode.blocks[blockIndex]!.durationMs;
}

/** Duration the presenter gets for a block that starts at `at` (recovery policy: next_elastic, early: keep). */
export function targetForBlockStart(s: LiveState, blockIndex: number, at: MonoMs): number {
  const base = s.episode.blocks[blockIndex]!.durationMs + s.blockRt[blockIndex]!.adjustMs;
  const plannedStart = plannedStartAt(s, blockIndex);
  if (plannedStart === null || !isElastic(s, blockIndex)) return base;
  const late = at - plannedStart;
  if (late <= 0) return base;
  return base - Math.min(late, studioTimeMs(s, blockIndex));
}

export function blockEndsAt(s: LiveState, blockIndex: number): MonoMs | null {
  const rt = s.blockRt[blockIndex];
  if (rt === undefined || rt.startedAt === null || rt.targetMs === null) return null;
  return rt.startedAt + rt.targetMs;
}
