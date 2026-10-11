// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import { parseView } from '../../src/core/views';
import { controlView, studioView } from '../support/views';

describe('parseView', () => {
  it('accepts a valid view for the role, and null (no episode loaded)', () => {
    expect(parseView('presenter', studioView())).toEqual({ ok: true, view: studioView() });
    expect(parseView('control', controlView())).toEqual({ ok: true, view: controlView() });
    expect(parseView('presenter', null)).toEqual({ ok: true, view: null });
  });

  it('rejects a view of the wrong shape', () => {
    expect(parseView('presenter', { phase: 'bogus' }).ok).toBe(false);
    expect(parseView('control', studioView()).ok).toBe(false);
  });
});
