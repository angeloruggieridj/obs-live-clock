// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import { nextId, slugify, uniqueSlug } from '../../src/editor/model/ids';

const SAFE_ID = /^[a-z0-9][a-z0-9._-]{0,99}$/;
const RESERVED_ID = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\.|$)/;

describe('slugify', () => {
  it.each([
    ['Solo Futsal', 'solo-futsal'],
    ['  Così è la Vita!  ', 'cosi-e-la-vita'],
    ['Puntata del 12/10/2026', 'puntata-del-12-10-2026'],
    ['---', 'senza-nome'],
    ['', 'senza-nome'],
    ['ÀÉÎÕÜ', 'aeiou'],
    ['CON', 'con-1'],
    ['com1', 'com1-1'],
    ['lpt9', 'lpt9-1'],
    ['nul', 'nul-1'],
    ['Console', 'console'],
  ])('%j -> %j', (input, expected) => {
    expect(slugify(input)).toBe(expected);
  });

  it('always satisfies the server id rule, even for hostile input', () => {
    for (const s of ['x'.repeat(500), '../../etc/passwd', 'C:\\Windows\\System32', 'a.b.c', '日本語', '\u0000\u0001', 'Aux.txt', 'a'.repeat(79) + ' b']) {
      const id = slugify(s);
      expect(SAFE_ID.test(id), id).toBe(true);
      expect(RESERVED_ID.test(id), id).toBe(false);
      expect(id.includes('..')).toBe(false);
    }
  });
});

describe('uniqueSlug and nextId', () => {
  it('appends -2, -3 … when taken', () => {
    expect(uniqueSlug('Solo Futsal', new Set())).toBe('solo-futsal');
    expect(uniqueSlug('Solo Futsal', new Set(['solo-futsal']))).toBe('solo-futsal-2');
    expect(uniqueSlug('Solo Futsal', new Set(['solo-futsal', 'solo-futsal-2']))).toBe('solo-futsal-3');
  });
  it('nextId takes the first free number', () => {
    expect(nextId('blk', new Set())).toBe('blk-1');
    expect(nextId('blk', new Set(['blk-1', 'blk-3']))).toBe('blk-2');
  });
});
