// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import { SCHEMA_VERSION } from '@olc/shared';
import { ENGINE_VERSION } from '../src/engine/index';

describe('server package', () => {
  it('resolves the shared workspace package', () => {
    expect(SCHEMA_VERSION).toBe(1);
    expect(ENGINE_VERSION).toBe(1);
  });
});
