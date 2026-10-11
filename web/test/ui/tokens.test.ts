// SPDX-License-Identifier: GPL-2.0-or-later
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { COLORS, installTokens, tokensCss } from '../../src/ui/tokens';

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5]
    .map((i) => Number.parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

/** WCAG 2.x contrast ratio. */
function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

describe('colour tokens', () => {
  it('every text colour on black meets WCAG AAA for large text (≥ 4.5:1)', () => {
    for (const key of ['fg', 'fgDim', 'fgOff', 'estimated', 'stale', 'amber', 'red', 'green'] as const) {
      expect(contrast(COLORS[key], COLORS.bg), key).toBeGreaterThanOrEqual(4.5);
    }
    expect(contrast(COLORS.fg, COLORS.msgBg)).toBeGreaterThanOrEqual(4.5);
  });

  it('small-text pairs used by the dock and control view meet WCAG AAA (≥ 7:1)', () => {
    const pairs: Array<[keyof typeof COLORS, keyof typeof COLORS]> = [
      ['fg', 'bg'], ['fgDim', 'bg'], ['amber', 'bg'], ['fg', 'surface'], ['fgDim', 'surface'], ['amber', 'surface'],
    ];
    for (const [fg, bg] of pairs) expect(contrast(COLORS[fg], COLORS[bg]), `${fg} on ${bg}`).toBeGreaterThanOrEqual(7);
  });

  it('matches the documented ratios', () => {
    expect(contrast(COLORS.red, COLORS.bg)).toBeCloseTo(5.92, 1);
    expect(contrast(COLORS.green, COLORS.bg)).toBeCloseTo(10.39, 1);
    expect(contrast(COLORS.estimated, COLORS.bg)).toBeCloseTo(6.25, 1);
  });

  it('renders CSS custom properties once', () => {
    const css = tokensCss();
    expect(css.startsWith(':root{')).toBe(true);
    expect(css).toContain('--fg-dim:#B3B3B3;');
    expect(css).toContain('--msg-bg:#0A3D91;');
    expect(css).toContain("--font:'Inter',");
    installTokens(document);
    installTokens(document);
    const styles = document.head.querySelectorAll('style[data-olc-tokens]');
    expect(styles).toHaveLength(1);
    expect(styles[0]!.textContent).toBe(css);
  });
});

describe('offline assets (NF2)', () => {
  it('no source file or page references a remote URL', () => {
    const root = join(__dirname, '..', '..');
    const files = [
      ...readdirSync(join(root, 'src'), { recursive: true, encoding: 'utf8' }).map((f) => join(root, 'src', f)),
      ...['presenter', 'dock', 'control'].map((p) => join(root, p, 'index.html')),
    ].filter((f) => /\.(tsx?|css|html)$/.test(f));
    expect(files.length).toBeGreaterThan(5);
    for (const file of files) expect(readFileSync(file, 'utf8'), file).not.toMatch(/https?:\/\//);
  });
});
