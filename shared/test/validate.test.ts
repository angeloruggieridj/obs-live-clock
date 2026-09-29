// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import { plannedStudioTimeMs, validateRundown, type StudioBlock } from '../src/index';
import { soloFutsalFormat } from '../src/testing/fixtures';

const codes = (r: ReturnType<typeof soloFutsalFormat>) => validateRundown(r).map((i) => i.code);
const studio = (f: ReturnType<typeof soloFutsalFormat>, i: number) => f.blocks[i] as StudioBlock;

describe('validateRundown', () => {
  it('reports only the shared scene-group warning for the fixture', () => {
    const issues = validateRundown(soloFutsalFormat());
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ severity: 'warning', code: 'scene_group_shared', blockId: null });
  });

  it('flags an empty rundown', () => {
    const f = soloFutsalFormat();
    f.blocks = [];
    expect(validateRundown(f)).toEqual([
      { severity: 'error', code: 'empty_rundown', blockId: null, message: 'The rundown has no blocks' },
    ]);
  });

  it('flags duplicate ids across blocks and elements', () => {
    const f = soloFutsalFormat();
    studio(f, 2).elements[0]!.id = 'b1-s1';
    expect(codes(f)).toContain('duplicate_id');
  });

  it('flags a missing scene group', () => {
    const f = soloFutsalFormat();
    studio(f, 0).sceneGroupId = 'nope';
    const issue = validateRundown(f).find((i) => i.code === 'scene_group_missing');
    expect(issue).toMatchObject({ severity: 'error', blockId: 'b1' });
  });

  it('flags media that exceed the block', () => {
    const f = soloFutsalFormat();
    studio(f, 3).durationMs = 60_000;
    studio(f, 3).elements.push({
      id: 'b3-m1', kind: 'media', title: 'Lungo', path: 'D:/media/lungo.mp4', occurrence: 0, plannedDurationMs: 90_000,
    });
    const issue = validateRundown(f).find((i) => i.code === 'media_exceeds_block');
    expect(issue).toMatchObject({ severity: 'error', blockId: 'b3' });
  });

  it('warns when studio time is below the warning threshold', () => {
    const f = soloFutsalFormat();
    studio(f, 0).durationMs = 220_000; // 220 000 - 180 000 = 40 000 < 60 000
    const issue = validateRundown(f).find((i) => i.code === 'studio_below_threshold');
    expect(issue).toMatchObject({ severity: 'warning', blockId: 'b1' });
  });
});

describe('plannedStudioTimeMs', () => {
  it('is block duration minus planned media', () => {
    expect(plannedStudioTimeMs(studio(soloFutsalFormat(), 0))).toBe(540_000);
  });
});
