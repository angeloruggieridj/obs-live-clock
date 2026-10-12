// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import { EDITOR_MODULES, createEditorT } from '../../src/editor/i18n';

const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe('editor dictionaries', () => {
  for (const [name, mod] of Object.entries(EDITOR_MODULES)) {
    describe(name, () => {
      it('has the same keys in Italian and English', () => {
        expect(Object.keys(mod.en).sort()).toEqual(Object.keys(mod.it).sort());
      });
      it('namespaces every key with the module name', () => {
        for (const key of Object.keys(mod.it)) expect(key.startsWith(`${name}.`)).toBe(true);
      });
      it('has no empty text and the same placeholders in both languages', () => {
        for (const [key, it] of Object.entries(mod.it)) {
          const en = (mod.en as Record<string, string>)[key]!;
          expect(it.trim(), key).not.toBe('');
          expect(en.trim(), key).not.toBe('');
          expect(placeholders(en), key).toEqual(placeholders(it));
        }
      });
    });
  }

  it('merges the modules without a key defined twice', () => {
    const total = Object.values(EDITOR_MODULES).reduce((n, m) => n + Object.keys(m.it).length, 0);
    const merged = new Set(Object.values(EDITOR_MODULES).flatMap((m) => Object.keys(m.it)));
    expect(merged.size).toBe(total);
  });

  it('interpolates parameters and leaves a missing one visible', () => {
    // Uses the translator on a key that exists in every build of this plan: the module list is checked above.
    const t = createEditorT('it') as (k: string, p?: Record<string, string | number>) => string;
    const first = Object.entries(EDITOR_MODULES).flatMap(([, m]) => Object.entries(m.it)).find(([, v]) => v.includes('{'));
    if (first === undefined) return; // no parameterised text yet (empty scaffold)
    const [key, text] = first;
    const name = /\{(\w+)\}/.exec(text)![1]!;
    expect(t(key, { [name]: 'X' })).not.toContain(`{${name}}`);
    expect(t(key)).toContain(`{${name}}`);
  });
});
