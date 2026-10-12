// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import { Format, presetForMode, rundownDurationMs } from '../src/index';
import { MediaElement } from '../src/model/format';
import { soloFutsalFormat } from '../src/testing/fixtures';

describe('Format schema', () => {
  it('accepts the Solo Futsal fixture', () => {
    expect(Format.safeParse(soloFutsalFormat()).success).toBe(true);
  });

  it('rejects a block shorter than one second', () => {
    const f = soloFutsalFormat();
    f.blocks[0]!.durationMs = 500;
    expect(Format.safeParse(f).success).toBe(false);
  });

  it('rejects a negative media occurrence', () => {
    const f = soloFutsalFormat();
    const b = f.blocks[0]!;
    if (b.kind !== 'studio') throw new Error('fixture changed');
    const m = b.elements[1]!;
    if (m.kind !== 'media') throw new Error('fixture changed');
    m.occurrence = -1;
    expect(Format.safeParse(f).success).toBe(false);
  });

  it('rejects a timeout message shorter than one second', () => {
    const f = soloFutsalFormat();
    f.messages[0]!.dismiss = { kind: 'timeout', ms: 200 };
    expect(Format.safeParse(f).success).toBe(false);
  });
});

describe('presetForMode', () => {
  it('freezes program time on REC pause only for live-to-tape', () => {
    expect(presetForMode('live_to_tape').recPauseFreezesProgram).toBe(true);
    expect(presetForMode('streaming').recPauseFreezesProgram).toBe(false);
    expect(presetForMode('tv').recPauseFreezesProgram).toBe(false);
  });

  it('uses the spec defaults', () => {
    expect(presetForMode('tv')).toEqual({
      mode: 'tv',
      warnMs: 60_000,
      returnImminentMs: 10_000,
      adjustStepMs: 30_000,
      recPauseFreezesProgram: false,
    });
  });
});

describe('rundownDurationMs', () => {
  it('is the sum of block durations', () => {
    expect(rundownDurationMs(soloFutsalFormat())).toBe(1_620_000);
  });
});

describe('MediaElement.durationSource', () => {
  const base = { id: 'm', kind: 'media', title: 'T', path: 'a.mp4', occurrence: 0, plannedDurationMs: 0 };
  it('is optional and accepts the five origins', () => {
    expect(MediaElement.parse(base).durationSource).toBeUndefined();
    for (const s of ['deck', 'file', 'file_rounded', 'manual', 'unknown']) {
      expect(MediaElement.parse({ ...base, durationSource: s }).durationSource).toBe(s);
    }
  });
  it('rejects any other origin', () => {
    expect(MediaElement.safeParse({ ...base, durationSource: 'guess' }).success).toBe(false);
  });
});
