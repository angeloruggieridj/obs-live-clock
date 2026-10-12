// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import { parseDuration } from '../../src/editor/props/duration-input';

describe('parseDuration', () => {
  it.each([['12:30', 750_000], ['0:05', 5_000], ['1:02:03', 3_723_000], ['90', 90_000], [' 7:00 ', 420_000], ['0', 0]])('%j -> %i', (a, b) => {
    expect(parseDuration(a)).toBe(b);
  });
  it.each([[''], ['abc'], ['12:75'], ['1:60:00'], ['-5'], ['1.5'], ['1:2:3:4'], ['12:'], [':30']])('%j -> null', (a) => {
    expect(parseDuration(a)).toBeNull();
  });
});
