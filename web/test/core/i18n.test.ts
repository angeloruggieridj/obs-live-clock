// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import { EN, IT, createT, type MessageKey } from '../../src/core/i18n';

const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe('i18n', () => {
  it('has the same keys and placeholders in every language', () => {
    expect(Object.keys(EN).sort()).toEqual(Object.keys(IT).sort());
    for (const key of Object.keys(IT) as MessageKey[]) {
      expect(placeholders(EN[key]), key).toEqual(placeholders(IT[key]));
      expect(IT[key].length, key).toBeGreaterThan(0);
    }
  });

  it('interpolates parameters and leaves missing ones visible', () => {
    const t = createT('it');
    expect(t('block', { n: 2, name: 'Secondo blocco' })).toBe('BLOCCO 2 · Secondo blocco');
    expect(t('returnTo', {})).toBe('RIENTRO: {name}');
    expect(t('reconnecting')).toBe('RICONNESSIONE…');
    expect(createT('en')('obsLost')).toBe('⚠ OBS NOT CONNECTED');
  });
});
