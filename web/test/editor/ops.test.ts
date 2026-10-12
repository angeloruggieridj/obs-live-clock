// SPDX-License-Identifier: GPL-2.0-or-later
import { Episode, Format, validateRundown, type StudioBlock } from '@olc/shared';
import { soloFutsalEpisode, soloFutsalFormat } from '@olc/shared/testing';
import { describe, expect, it } from 'vitest';
import * as ops from '../../src/editor/model/ops';

const base = () => soloFutsalFormat();
const run = (doc: ReturnType<typeof base>, e: { apply(d: ReturnType<typeof base>): ReturnType<typeof base> }) => e.apply(doc);
const ids = (d: ReturnType<typeof base>) => d.blocks.map((b) => b.id);
const studio = (d: ReturnType<typeof base>, id: string) => d.blocks.find((b) => b.id === id) as StudioBlock;

describe('moveItem / moveBlock', () => {
  it('moveItem puts the item at the FINAL index', () => {
    expect(ops.moveItem(['a', 'b', 'c', 'd'], 0, 2)).toEqual(['b', 'c', 'a', 'd']);
    expect(ops.moveItem(['a', 'b', 'c', 'd'], 3, 0)).toEqual(['d', 'a', 'b', 'c']);
    expect(ops.moveItem(['a', 'b', 'c', 'd'], 1, 2)).toEqual(['a', 'c', 'b', 'd']);
  });
  it('returns the same array for a no-op or an out-of-range index', () => {
    const a = ['a', 'b'];
    expect(ops.moveItem(a, 1, 1)).toBe(a);
    expect(ops.moveItem(a, 5, 0)).toBe(a);
    expect(ops.moveItem(a, 0, 9)).toBe(a);
  });
  it('moveBlock moves to the final index and clamps', () => {
    expect(ids(run(base(), ops.moveBlock(0, 2)))).toEqual(['br1', 'b2', 'b1', 'b3']);
    expect(ids(run(base(), ops.moveBlock(0, 99)))).toEqual(['br1', 'b2', 'b3', 'b1']);
    const d = base();
    expect(run(d, ops.moveBlock(2, 2))).toBe(d);
  });
});

describe('resize and patch', () => {
  it('resize snaps to 5 s and never goes below the minimum', () => {
    expect(run(base(), ops.resizeBlock('b1', 731_000)).blocks[0]!.durationMs).toBe(730_000);
    expect(run(base(), ops.resizeBlock('b1', 100)).blocks[0]!.durationMs).toBe(5_000);
    const d = base();
    expect(run(d, ops.resizeBlock('b1', 720_000))).toBe(d);
    expect(run(d, ops.resizeBlock('nope', 10_000))).toBe(d);
  });
  it('resize edits coalesce per block', () => {
    expect(ops.resizeBlock('b1', 1).coalesceKey).toBe('resize:b1');
    expect(ops.resizeBlock('b2', 1).coalesceKey).toBe('resize:b2');
  });
  it('patchStudio changes only valid fields', () => {
    const d = run(base(), ops.patchStudio('b1', { name: '  Nuovo  ', elastic: false, durationMs: 301_000 }));
    expect(studio(d, 'b1')).toMatchObject({ name: 'Nuovo', elastic: false, durationMs: 300_000 });
    const same = base();
    expect(run(same, ops.patchStudio('b1', { name: '   ' }))).toBe(same);
    expect(run(same, ops.patchStudio('b1', { name: 'Primo blocco' }))).toBe(same);
    expect(run(same, ops.patchStudio('br1', { name: 'x' }))).toBe(same); // wrong kind
  });
  it('patchBreak sets the scene and the optional media input', () => {
    const d = run(base(), ops.patchBreak('br1', { scene: 'PAUSA', mediaInput: '' }));
    expect(d.blocks[1]).toMatchObject({ scene: 'PAUSA', mediaInput: null });
    const same = base();
    expect(run(same, ops.patchBreak('br1', { scene: ' ' }))).toBe(same);
  });
  it('convertBlock switches kinds and keeps the id, name and duration', () => {
    const asBreak = run(base(), ops.convertBlock('b3', 'break')).blocks[3]!;
    expect(asBreak).toMatchObject({ id: 'b3', kind: 'break', name: 'Chiusura', durationMs: 120_000, scene: 'BREAK', mediaInput: null });
    const asStudio = run(base(), ops.convertBlock('br1', 'studio')).blocks[1] as StudioBlock;
    expect(asStudio).toMatchObject({ id: 'br1', kind: 'studio', sceneGroupId: 'studio', elastic: true });
    expect(asStudio.elements).toHaveLength(1);
    const same = base();
    expect(run(same, ops.convertBlock('b1', 'studio'))).toBe(same);
  });
});

describe('add, duplicate, delete, split', () => {
  it('addBlock inserts at the index with unique ids', () => {
    const d = run(base(), ops.addBlock('studio', 1, 'Nuovo'));
    expect(d.blocks[1]).toMatchObject({ id: 'blk-1', kind: 'studio', name: 'Nuovo', durationMs: 300_000 });
    expect(new Set(d.blocks.flatMap((b) => [b.id, ...(b.kind === 'studio' ? b.elements.map((e) => e.id) : [])])).size).toBe(
      d.blocks.length + d.blocks.reduce((n, b) => n + (b.kind === 'studio' ? b.elements.length : 0), 0),
    );
    const d2 = run(d, ops.addBlock('break', 99, 'Pausa'));
    expect(d2.blocks.at(-1)).toMatchObject({ id: 'blk-2', kind: 'break', scene: 'BREAK' });
  });
  it('addBlock produces a document the schema accepts', () => {
    const d = run(run(base(), ops.addBlock('studio', 0, 'A')), ops.addBlock('break', 2, 'B'));
    expect(Format.safeParse(d).success).toBe(true);
  });
  it('duplicateBlock copies the studio parts and NOT the media', () => {
    const d = run(base(), ops.duplicateBlock('b1', 'Primo blocco (copia)'));
    expect(ids(d)).toEqual(['b1', 'blk-1', 'br1', 'b2', 'b3']);
    const copy = studio(d, 'blk-1');
    expect(copy.elements.map((e) => e.kind)).toEqual(['studio', 'studio']);
    expect(copy.durationMs).toBe(720_000);
    expect(new Set(d.blocks.flatMap((b) => (b.kind === 'studio' ? b.elements.map((e) => e.id) : []))).size).toBe(
      d.blocks.reduce((n, b) => n + (b.kind === 'studio' ? b.elements.length : 0), 0),
    );
    expect(validateRundown(d).filter((i) => i.severity === 'error')).toEqual([]);
  });
  it('duplicateBlock of a block with media only keeps a studio part', () => {
    const f = base();
    const b = f.blocks[2] as StudioBlock;
    b.elements = [b.elements[1]!]; // media only
    const d = run(f, ops.duplicateBlock('b2', 'copia'));
    expect(studio(d, 'blk-1').elements).toHaveLength(1);
    expect(studio(d, 'blk-1').elements[0]!.kind).toBe('studio');
  });
  it('deleteBlock removes it; unknown id is a no-op', () => {
    expect(ids(run(base(), ops.deleteBlock('br1')))).toEqual(['b1', 'b2', 'b3']);
    const d = base();
    expect(run(d, ops.deleteBlock('zz'))).toBe(d);
  });
  it('splitBlock cuts a studio block in two and keeps the total', () => {
    const d = run(base(), ops.splitBlock('b1', 300_000, 'Seconda parte'));
    expect(ids(d)).toEqual(['b1', 'blk-1', 'br1', 'b2', 'b3']);
    expect(d.blocks[0]!.durationMs).toBe(300_000);
    expect(d.blocks[1]).toMatchObject({ name: 'Seconda parte', durationMs: 420_000, elastic: true, sceneGroupId: 'studio' });
    expect(studio(d, 'b1').elements).toHaveLength(3); // the first part keeps its elements
    expect(d.blocks.reduce((t, b) => t + b.durationMs, 0)).toBe(1_620_000);
  });
  it('splitBlock refuses a cut that leaves less than 5 s on either side, and breaks', () => {
    const d = base();
    expect(run(d, ops.splitBlock('b1', 2_000, 'x'))).toBe(d);
    expect(run(d, ops.splitBlock('b1', 718_000, 'x'))).toBe(d);
    expect(run(d, ops.splitBlock('br1', 60_000, 'x'))).toBe(d);
  });
});

describe('elements', () => {
  it('adds a studio part and media at an index', () => {
    let d = run(base(), ops.addStudioPart('b3', 0));
    expect(studio(d, 'b3').elements.map((e) => e.id)).toEqual(['el-1', 'b3-s1']);
    d = run(d, ops.addMedia('b3', { kind: 'media', title: 'T', path: 'x.mp4', occurrence: 0, plannedDurationMs: 0, durationSource: 'unknown' }));
    const last = studio(d, 'b3').elements.at(-1)!;
    expect(last).toMatchObject({ kind: 'media', id: 'el-2', durationSource: 'unknown' });
  });
  it('never removes the last element of a studio block', () => {
    const d = base();
    expect(run(d, ops.removeElement('b3', 'b3-s1'))).toBe(d);
    expect(studio(run(d, ops.removeElement('b1', 'b1-m1')), 'b1').elements.map((e) => e.id)).toEqual(['b1-s1', 'b1-s2']);
  });
  it('moves an element to the final index', () => {
    expect(studio(run(base(), ops.moveElement('b1', 0, 2)), 'b1').elements.map((e) => e.id)).toEqual(['b1-m1', 'b1-s2', 'b1-s1']);
  });
  it('patchMedia marks a hand-typed duration as manual and keeps the title cap', () => {
    const d = run(base(), ops.patchMedia('b1', 'b1-m1', { plannedDurationMs: 200_000 }));
    expect(studio(d, 'b1').elements[1]).toMatchObject({ plannedDurationMs: 200_000, durationSource: 'manual' });
    const e = run(base(), ops.patchMedia('b1', 'b1-m1', { title: 'x'.repeat(300) }));
    expect((studio(e, 'b1').elements[1] as { title: string }).title).toHaveLength(200);
    const same = base();
    expect(run(same, ops.patchMedia('b1', 'b1-m1', { plannedDurationMs: -5 }))).toBe(same);
    expect(run(same, ops.patchMedia('b1', 'b1-s1', { title: 'q' }))).toBe(same); // not a media element
  });
});

describe('document level', () => {
  it('renames within 1..120 characters', () => {
    expect(run(base(), ops.renameDoc('  Nuovo nome ')).name).toBe('Nuovo nome');
    const d = base();
    expect(run(d, ops.renameDoc(''))).toBe(d);
    expect(run(d, ops.renameDoc('x'.repeat(121)))).toBe(d);
  });
  it('setPreset validates and applyMode replaces the whole preset', () => {
    const d = base();
    expect(run(d, ops.setPreset({ adjustStepMs: 500 }))).toBe(d);
    expect(run(d, ops.setPreset({ warnMs: 90_000 })).preset.warnMs).toBe(90_000);
    expect(run(d, ops.applyMode('streaming')).preset).toMatchObject({ mode: 'streaming', recPauseFreezesProgram: false });
  });
  it('scene groups: add (unique id), patch (non-empty scenes), remove (refused while used)', () => {
    let d = run(base(), ops.addSceneGroup('Studio', 'SCENA'));
    expect(d.sceneGroups.map((g) => g.id)).toEqual(['studio', 'studio-2']);
    d = run(d, ops.patchSceneGroup('studio-2', { scenes: ['CAM 4', 'CAM 5'] }));
    expect(d.sceneGroups[1]!.scenes).toEqual(['CAM 4', 'CAM 5']);
    expect(run(d, ops.patchSceneGroup('studio-2', { scenes: [] }))).toBe(d);
    expect(run(d, ops.removeSceneGroup('studio'))).toBe(d); // used by b1
    expect(run(d, ops.removeSceneGroup('studio-2')).sceneGroups.map((g) => g.id)).toEqual(['studio']);
  });
  it('messages: add, patch, remove; timeout at least 1 s', () => {
    let d = run(base(), ops.addMessage('PAUSA'));
    expect(d.messages.at(-1)).toMatchObject({ id: 'pausa', text: 'PAUSA', dismiss: { kind: 'timeout', ms: 10_000 } });
    expect(run(d, ops.patchMessage('pausa', { dismiss: { kind: 'timeout', ms: 500 } }))).toBe(d);
    d = run(d, ops.patchMessage('pausa', { dismiss: { kind: 'manual' } }));
    expect(d.messages.at(-1)!.dismiss).toEqual({ kind: 'manual' });
    expect(run(d, ops.removeMessage('pausa')).messages.map((m) => m.id)).toEqual(['stringi', 'cam2']);
    expect(run(d, ops.addMessage('x'.repeat(81)))).toBe(d);
  });
  it('patchEpisodeMeta edits an episode, validates, and ignores a format', () => {
    const ep = soloFutsalEpisode();
    const asEp = (e: { apply(d: typeof ep): typeof ep }) => e.apply(ep);
    expect(asEp(ops.patchEpisodeMeta({ plannedStart: '2026-10-12T20:30:00+02:00' })).plannedStart).toBe('2026-10-12T20:30:00+02:00');
    expect(asEp(ops.patchEpisodeMeta({ plannedStart: null })).plannedStart).toBeNull();
    expect(asEp(ops.patchEpisodeMeta({ playlistName: '' })).playlistName).toBeNull();
    expect(asEp(ops.patchEpisodeMeta({ date: '2026-11-01' })).date).toBe('2026-11-01');
    expect(asEp(ops.patchEpisodeMeta({ date: '1/11/2026' }))).toBe(ep);
    expect(asEp(ops.patchEpisodeMeta({ plannedStart: '20:30' }))).toBe(ep);
    expect(Episode.safeParse(asEp(ops.patchEpisodeMeta({ plannedStart: '2026-10-12T20:30:00Z' }))).success).toBe(true);
    const f = base();
    expect(run(f, ops.patchEpisodeMeta({ date: '2026-11-01' }))).toBe(f);
  });
  it('OP_LABELS covers every label an operation can emit', () => {
    const labels = new Set<string>();
    const d = base();
    const edits = [
      ops.moveBlock(0, 1), ops.resizeBlock('b1', 1), ops.patchStudio('b1', {}), ops.patchBreak('br1', {}), ops.convertBlock('b1', 'break'),
      ops.addBlock('studio', 0, 'x'), ops.duplicateBlock('b1', 'x'), ops.deleteBlock('b1'), ops.splitBlock('b1', 1, 'x'),
      ops.addStudioPart('b1'), ops.removeElement('b1', 'x'), ops.moveElement('b1', 0, 1), ops.patchMedia('b1', 'b1-m1', {}),
      ops.renameDoc('x'), ops.setPreset({}), ops.applyMode('tv'), ops.addSceneGroup('x', 's'), ops.patchSceneGroup('x', {}),
      ops.removeSceneGroup('x'), ops.addMessage('x'), ops.patchMessage('x', {}), ops.removeMessage('x'),
      ops.patchEpisodeMeta({}),
    ];
    for (const e of edits) labels.add(e.label);
    for (const l of labels) expect(ops.OP_LABELS).toContain(l);
    void d;
  });
});
