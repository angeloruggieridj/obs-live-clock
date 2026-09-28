// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import { SHARED_PACKAGE } from '@olc/shared';
import { ENGINE_VERSION } from '../src/engine/index';

describe('server package', () => {
  it('resolves the shared workspace package', () => {
    expect(SHARED_PACKAGE).toBe('@olc/shared');
    expect(ENGINE_VERSION).toBe(1);
  });
});
