// SPDX-License-Identifier: GPL-2.0-or-later
import type { MediaElement, Rundown, StudioBlock } from '@olc/shared';
import { addMedia, type RundownDoc } from '../model/ops';
import type { Edit } from '../store/document-store';

export interface Candidate {
  title: string;
  path: string;
  /** Position among the playlist items sharing this path (the deck gives it; files: `withOccurrences`). */
  occurrence: number;
  /** -1 = unknown. */
  durationMs: number;
  origin: 'deck' | 'file' | 'file_rounded' | 'unknown';
}

export type PlacementMode = { kind: 'append'; blockId: string } | { kind: 'sequence' };

export interface PlannedAdd {
  blockId: string;
  media: Omit<MediaElement, 'id'>;
}

export interface PlacementPlan {
  adds: PlannedAdd[];
  skippedExisting: number;
  unknownDuration: number;
  error: 'no_studio_block' | 'not_a_studio_block' | null;
}

export const mediaKey = (path: string, occurrence: number): string => `${path}#${occurrence}`;

/** Adds the 0-based count of earlier items with the same path (what the deck reports as `occurrence`). */
export function withOccurrences<T extends { path: string }>(items: readonly T[]): Array<T & { occurrence: number }> {
  const seen = new Map<string, number>();
  return items.map((item) => {
    const occurrence = seen.get(item.path) ?? 0;
    seen.set(item.path, occurrence + 1);
    return { ...item, occurrence };
  });
}

export function existingKeys(doc: Pick<Rundown, 'blocks'>): Set<string> {
  const keys = new Set<string>();
  for (const b of doc.blocks) {
    if (b.kind !== 'studio') continue;
    for (const e of b.elements) if (e.kind === 'media') keys.add(mediaKey(e.path, e.occurrence));
  }
  return keys;
}

export function toMedia(c: Candidate): Omit<MediaElement, 'id'> {
  const known = c.durationMs >= 0 && c.origin !== 'unknown';
  return {
    kind: 'media',
    title: c.title.slice(0, 200),
    path: c.path,
    occurrence: c.occurrence,
    plannedDurationMs: known ? Math.round(c.durationMs) : 0,
    durationSource: known ? c.origin : 'unknown',
  };
}

const mediaMs = (b: StudioBlock) => b.elements.reduce((t, e) => (e.kind === 'media' ? t + e.plannedDurationMs : t), 0);

export function planPlacement(doc: Pick<Rundown, 'blocks' | 'preset'>, items: readonly Candidate[], mode: PlacementMode): PlacementPlan {
  const studios = doc.blocks.filter((b): b is StudioBlock => b.kind === 'studio');
  const empty = (error: PlacementPlan['error']): PlacementPlan => ({ adds: [], skippedExisting: 0, unknownDuration: 0, error });
  if (studios.length === 0) return empty('no_studio_block');
  if (mode.kind === 'append' && !studios.some((b) => b.id === mode.blockId)) return empty('not_a_studio_block');

  const taken = existingKeys(doc);
  const fresh: Candidate[] = [];
  let skippedExisting = 0;
  for (const c of items) {
    const key = mediaKey(c.path, c.occurrence);
    if (taken.has(key)) {
      skippedExisting++;
      continue;
    }
    taken.add(key);
    fresh.push(c);
  }

  const adds: PlannedAdd[] = [];
  if (mode.kind === 'append') {
    for (const c of fresh) adds.push({ blockId: mode.blockId, media: toMedia(c) });
  } else {
    const used = studios.map(mediaMs);
    let bi = 0;
    for (const c of fresh) {
      // The stored duration (0 for an unknown origin), not the raw candidate: an unknown duration never occupies time.
      const dur = toMedia(c).plannedDurationMs;
      while (bi < studios.length - 1 && used[bi]! + dur > studios[bi]!.durationMs - doc.preset.warnMs) bi++;
      adds.push({ blockId: studios[bi]!.id, media: toMedia(c) });
      used[bi]! += dur;
    }
  }
  return { adds, skippedExisting, unknownDuration: fresh.filter((c) => c.durationMs < 0 || c.origin === 'unknown').length, error: null };
}

/** One undo step. Re-checks every add against the document it is applied to, so a stale plan cannot duplicate. */
export function importEdit<D extends RundownDoc>(plan: PlacementPlan): Edit<D> {
  return {
    label: 'import_media',
    apply: (doc) =>
      plan.adds.reduce<D>((d, a) => {
        if (existingKeys(d).has(mediaKey(a.media.path, a.media.occurrence))) return d;
        return addMedia<D>(a.blockId, a.media).apply(d);
      }, doc),
  };
}
