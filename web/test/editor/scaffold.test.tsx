// SPDX-License-Identifier: GPL-2.0-or-later
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { EditorApp } from '../../src/editor/EditorApp';
import { AUTOSAVE_DEBOUNCE_MS, COALESCE_MS, MIN_BLOCK_MS, SNAP_MS, UNDO_LIMIT } from '../../src/editor/model/constants';

describe('editor scaffold', () => {
  it('renders the five layout regions', () => {
    render(<EditorApp lang="it" />);
    for (const region of ['library', 'timeline', 'properties', 'settings', 'validation']) {
      expect(screen.getByTestId(`region-${region}`)).toBeTruthy();
    }
  });

  it('fixes the editing constants', () => {
    expect([SNAP_MS, MIN_BLOCK_MS, UNDO_LIMIT, COALESCE_MS, AUTOSAVE_DEBOUNCE_MS]).toEqual([5_000, 5_000, 100, 600, 800]);
  });
});
