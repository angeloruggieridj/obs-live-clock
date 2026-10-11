// SPDX-License-Identifier: GPL-2.0-or-later
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const presenterCss = readFileSync(join(__dirname, '../../src/presenter/presenter.css'), 'utf8');
const baseCss = readFileSync(join(__dirname, '../../src/ui/base.css'), 'utf8');

/** The declaration block of `selector` (written exactly as `<selector> {` in the stylesheet). */
function rule(css: string, selector: string): string {
  const start = css.indexOf(`${selector} {`);
  expect(start, selector).toBeGreaterThanOrEqual(0);
  return css.slice(start, css.indexOf('}', start));
}

describe('presenter layout rules', () => {
  it('AC10: the main digits are at least 20 % of the screen height on 16:9 and 4:3', () => {
    const m = /--p-main:\s*min\((\d+(?:\.\d+)?)vh,\s*(\d+(?:\.\d+)?)vw\)/.exec(presenterCss);
    expect(m).not.toBeNull();
    const [vh, vw] = [Number(m![1]), Number(m![2])];
    const INTER_FIGURE_HEIGHT_EM = 0.727;
    for (const aspect of [16 / 9, 4 / 3]) {
      const fontVh = Math.min(vh, vw * aspect);
      expect(fontVh * INTER_FIGURE_HEIGHT_EM, `aspect ${aspect.toFixed(2)}`).toBeGreaterThanOrEqual(20);
    }
  });

  it('never overflows: a hidden-overflow grid of shrinkable tiles, ellipsis and 2-line clamps', () => {
    const root = rule(presenterCss, '.p-root');
    expect(root).toContain('overflow: hidden');
    expect(root).toContain('cursor: none');
    expect(root).toContain('grid-template-columns: minmax(0, 2fr) minmax(0, 1fr)');
    expect(root).toContain('font-variant-numeric: tabular-nums');
    const tile = rule(presenterCss, '.p-root .tile');
    expect(tile).toContain('min-width: 0');
    expect(tile).toContain('overflow: hidden');
    expect(rule(presenterCss, '.p-next-title')).toContain('-webkit-line-clamp: 2');
    expect(rule(presenterCss, '.p-msg')).toContain('-webkit-line-clamp: 2');
    expect(rule(baseCss, '.label-text')).toContain('text-overflow: ellipsis');
    expect(rule(baseCss, '.counter')).toContain('white-space: nowrap');
  });

  it('steps long counters down by length', () => {
    for (const len of ['6', '7', '8']) expect(presenterCss).toContain(`.p-main-counter[data-len='${len}']`);
  });

  it('uses only colour tokens (no literal colours) for tallies', () => {
    expect(presenterCss).not.toMatch(/#[0-9a-fA-F]{3,6}\b/);
    expect(presenterCss).toContain("[data-tally='warn']");
    expect(presenterCss).toContain("[data-tally='over']");
    expect(presenterCss).toContain("[data-tally='imminent']");
  });

  it('dims a stale progress fill with the same token as a stale counter', () => {
    expect(rule(presenterCss, ".progress-fill[data-stale='true']")).toContain('var(--stale)');
  });
});
