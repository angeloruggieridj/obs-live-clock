// SPDX-License-Identifier: GPL-2.0-or-later
import { validateRundown, type Block, type StudioBlock } from '@olc/shared';
import { soloFutsalFormat } from '@olc/shared/testing';
import { describe, expect, it } from 'vitest';
import { type Candidate, existingKeys, importEdit, planPlacement, toMedia, withOccurrences } from '../../src/editor/import/place';
import { DocumentStore } from '../../src/editor/store/document-store';

const cand = (path: string, durationMs: number, over: Partial<Candidate> = {}): Candidate => ({
  title: path, path, occurrence: 0, durationMs, origin: durationMs < 0 ? 'unknown' : 'deck', ...over,
});
const media = (d: { blocks: Block[] }, blockId: string) =>
  (d.blocks.find((b) => b.id === blockId) as StudioBlock).elements.filter((e) => e.kind === 'media');

describe('withOccurrences / toMedia', () => {
  it('counts earlier items with the same path', () => {
    expect(withOccurrences([{ path: 'a' }, { path: 'b' }, { path: 'a' }, { path: 'a' }]).map((i) => i.occurrence)).toEqual([0, 0, 1, 2]);
  });
  it('keeps a known duration with its origin and marks an unknown one', () => {
    expect(toMedia(cand('a.mp4', 90_000))).toMatchObject({ plannedDurationMs: 90_000, durationSource: 'deck' });
    expect(toMedia(cand('a.mp4', 90_000, { origin: 'file_rounded' })).durationSource).toBe('file_rounded');
    expect(toMedia(cand('a.mp4', -1))).toMatchObject({ plannedDurationMs: 0, durationSource: 'unknown' });
  });
});

describe('append', () => {
  it('adds the new items at the end of the chosen block, in order', () => {
    const f = soloFutsalFormat();
    const plan = planPlacement(f, [cand('D:/n1.mp4', 30_000), cand('D:/n2.mp4', 40_000)], { kind: 'append', blockId: 'b3' });
    expect(plan).toMatchObject({ skippedExisting: 0, unknownDuration: 0, error: null });
    const g = importEdit(plan).apply(f);
    expect(media(g, 'b3').map((e) => (e as { path: string }).path)).toEqual(['D:/n1.mp4', 'D:/n2.mp4']);
  });
  it('rejects a break block or an unknown block', () => {
    const f = soloFutsalFormat();
    expect(planPlacement(f, [cand('x', 1)], { kind: 'append', blockId: 'br1' }).error).toBe('not_a_studio_block');
    expect(planPlacement(f, [cand('x', 1)], { kind: 'append', blockId: 'zz' }).error).toBe('not_a_studio_block');
  });
  it('reports a rundown with no studio block', () => {
    const f = soloFutsalFormat();
    f.blocks = f.blocks.filter((b) => b.kind === 'break');
    expect(planPlacement(f, [cand('x', 1)], { kind: 'append', blockId: 'br1' }).error).toBe('no_studio_block');
  });
});

describe('importing twice (Review Focus 4)', () => {
  it('skips what is already in the rundown and counts it', () => {
    const f = soloFutsalFormat();
    const items = [cand('D:/media/servizio1.mp4', 180_000), cand('D:/new.mp4', 10_000)]; // the first one is already in b1
    const plan = planPlacement(f, items, { kind: 'append', blockId: 'b3' });
    expect(plan.skippedExisting).toBe(1);
    expect(plan.adds).toHaveLength(1);
  });
  it('importing the same items twice adds nothing the second time', () => {
    const store = new DocumentStore(soloFutsalFormat());
    const items = [cand('D:/n1.mp4', 30_000), cand('D:/n1.mp4', 30_000, { occurrence: 1 })];
    for (let i = 0; i < 2; i++) {
      const plan = planPlacement(store.getSnapshot().doc, items, { kind: 'append', blockId: 'b3' });
      store.edit(importEdit(plan));
    }
    expect(media(store.getSnapshot().doc, 'b3')).toHaveLength(2);
  });
  it('a stale plan applied twice still adds nothing the second time', () => {
    const f = soloFutsalFormat();
    const plan = planPlacement(f, [cand('D:/n1.mp4', 30_000)], { kind: 'append', blockId: 'b3' });
    const once = importEdit(plan).apply(f);
    const twice = importEdit(plan).apply(once);
    expect(media(twice, 'b3')).toHaveLength(1);
    expect(twice).toBe(once);
  });
  it('the same path with another occurrence is a different item', () => {
    const f = soloFutsalFormat();
    const plan = planPlacement(f, [cand('D:/media/servizio1.mp4', 180_000, { occurrence: 1 })], { kind: 'append', blockId: 'b3' });
    expect(plan.adds).toHaveLength(1);
    expect([...existingKeys(f)]).toContain('D:/media/servizio1.mp4#0');
  });
  it('the whole import is one undo step', () => {
    const store = new DocumentStore(soloFutsalFormat());
    const before = store.getSnapshot().doc;
    store.edit(importEdit(planPlacement(before, [cand('a', 1_000), cand('b', 1_000), cand('c', 1_000)], { kind: 'append', blockId: 'b3' })));
    expect(media(store.getSnapshot().doc, 'b3')).toHaveLength(3);
    store.undo();
    expect(store.getSnapshot().doc).toBe(before);
  });
});

describe('sequence', () => {
  // warnMs 60 000. b1 (720 s, 180 s media) -> room 720-60-180 = 480 s. b2 (600 s, 120 s) -> 420 s. b3 (120 s, 0) -> 60 s.
  it('fills the studio blocks in order, keeping the warning threshold of studio time', () => {
    const f = soloFutsalFormat();
    const items = [cand('a', 400_000), cand('b', 100_000), cand('c', 400_000), cand('d', 50_000), cand('e', 50_000)];
    const plan = planPlacement(f, items, { kind: 'sequence' });
    // a: 180+400=580 <= 660 -> b1 ; b: 580+100=680 > 660 -> b2 (120+100=220 <= 540) ; c: 220+400=620 > 540 -> b3 (0+400 > 60 but last) ;
    // d: b3 (last block takes the rest) ; e: b3
    expect(plan.adds.map((a) => [a.media.path, a.blockId])).toEqual([['a', 'b1'], ['b', 'b2'], ['c', 'b3'], ['d', 'b3'], ['e', 'b3']]);
  });
  it('lets the last block take the overflow, which validation then reports as an error', () => {
    const f = soloFutsalFormat();
    const g = importEdit(planPlacement(f, [cand('big', 900_000)], { kind: 'sequence' })).apply(f);
    expect(validateRundown(g).some((i) => i.code === 'media_exceeds_block' && i.blockId === 'b3')).toBe(true);
  });
  it('counts an unknown duration as zero for placement and reports it', () => {
    const f = soloFutsalFormat();
    const plan = planPlacement(f, [cand('u', -1)], { kind: 'sequence' });
    expect(plan.unknownDuration).toBe(1);
    expect(plan.adds[0]).toMatchObject({ blockId: 'b1', media: { plannedDurationMs: 0, durationSource: 'unknown' } });
  });
});

describe('result validity', () => {
  it('produces unique element ids and keeps the origin of every duration', () => {
    const f = soloFutsalFormat();
    const g = importEdit(planPlacement(f, [cand('a', 1_000), cand('b', -1, { origin: 'unknown' })], { kind: 'append', blockId: 'b3' })).apply(f);
    const ids = g.blocks.flatMap((b) => (b.kind === 'studio' ? b.elements.map((e) => e.id) : []));
    expect(new Set(ids).size).toBe(ids.length);
    expect(media(g, 'b3').map((e) => (e as { durationSource: string }).durationSource)).toEqual(['deck', 'unknown']);
    expect(validateRundown(g).some((i) => i.code === 'duplicate_id')).toBe(false);
  });
});
