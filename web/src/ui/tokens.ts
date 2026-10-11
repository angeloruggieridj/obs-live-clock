// SPDX-License-Identifier: GPL-2.0-or-later

/**
 * Colour tokens (SPEC §7: black background, colour only as tally). Contrast on black, WCAG 2.x:
 * fg 21, fgDim 10.0, fgOff 4.9, estimated/stale 6.3, amber 11.5, red 5.9, green 10.4; fg on msgBg 10.1;
 * on surface: fg 18.4, fgDim 8.8, amber 10.1. Checked by web/test/ui/tokens.test.ts.
 */
export const COLORS = {
  bg: '#000000',
  surface: '#141414',
  fg: '#FFFFFF',
  fgDim: '#B3B3B3',
  fgOff: '#7A7A7A',
  estimated: '#8C8C8C',
  stale: '#8C8C8C',
  amber: '#FFB000',
  red: '#FF3B30',
  green: '#30D158',
  msgBg: '#0A3D91',
  tileBorder: '#3A3A3A',
} as const;

export const FONT_STACK = "'Inter', system-ui, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif";

/** `fgDim` → `--fg-dim`. */
export function cssVarName(key: string): string {
  return `--${key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`;
}

export function tokensCss(): string {
  const vars = Object.entries(COLORS).map(([k, v]) => `${cssVarName(k)}:${v};`).join('');
  return `:root{${vars}--font:${FONT_STACK};}`;
}

/** Installs the tokens once per document. */
export function installTokens(doc: Document = document): void {
  if (doc.head.querySelector('style[data-olc-tokens]') !== null) return;
  const style = doc.createElement('style');
  style.dataset.olcTokens = '';
  style.textContent = tokensCss();
  doc.head.append(style);
}
