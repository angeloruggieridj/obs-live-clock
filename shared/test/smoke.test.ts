// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import { SHARED_PACKAGE } from '../src/index';

describe('shared package', () => {
  it('is importable', () => {
    expect(SHARED_PACKAGE).toBe('@olc/shared');
  });
});
