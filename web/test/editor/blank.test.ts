// SPDX-License-Identifier: GPL-2.0-or-later
import { Format, validateRundown } from '@olc/shared';
import { describe, expect, it } from 'vitest';
import { blankFormat } from '../../src/editor/library/blank';

describe('blank', () => {
  it('blankFormat is a valid format with no validation error', () => {
    const f = blankFormat('Notte Basket', 'notte-basket');
    expect(Format.safeParse(f).success).toBe(true);
    expect(validateRundown(f).filter((i) => i.severity === 'error')).toEqual([]);
  });
});
