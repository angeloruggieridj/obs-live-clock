// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import { ControlView, PresenterView } from '@olc/shared';
import { breakView, controlView, endedView, mediaView, preshowView, studioView } from './support/views';

describe('test fixtures are valid views', () => {
  it.each([
    ['studio', studioView()],
    ['preshow', preshowView()],
    ['media', mediaView()],
    ['break', breakView()],
    ['ended', endedView()],
  ])('%s', (_label, view) => expect(PresenterView.parse(view)).toEqual(view));

  it('control', () => {
    const v = controlView();
    expect(ControlView.parse(v)).toEqual(v);
    expect(v.rows).toHaveLength(8);
  });
});
