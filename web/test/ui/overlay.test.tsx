// SPDX-License-Identifier: GPL-2.0-or-later
import { act, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConnectionOverlay } from '../../src/ui/ConnectionOverlay';
import { renderLive } from '../support/render';
import { StaticStore, snapshotOf } from '../support/store';
import { studioView } from '../support/views';

afterEach(() => {
  vi.useRealTimers();
});

describe('<ConnectionOverlay>', () => {
  it('says CONNESSIONE… until a view has arrived and the clock is synced', () => {
    const s = new StaticStore(snapshotOf<'presenter'>(null, { hasView: false, synced: false, stale: true }));
    const { update, container } = renderLive(<ConnectionOverlay />, s);
    expect(screen.getByRole('status').textContent).toBe('CONNESSIONE…');
    update({ hasView: true, stale: false });
    expect(screen.getByRole('status').textContent).toBe('CONNESSIONE…');
    update({ synced: true });
    expect(container.textContent).toBe('');
  });

  it('shows RICONNESSIONE… while stale, in the chosen language', () => {
    const s = new StaticStore(snapshotOf<'presenter'>(studioView(), { stale: true, staleSince: 1 }));
    renderLive(<ConnectionOverlay />, s, 'en');
    expect(screen.getByRole('alert').textContent).toBe('RECONNECTING…');
  });

  it('asks for a reload on an incompatible server and reloads after 10 s', () => {
    vi.useFakeTimers();
    const reload = vi.fn();
    const s = new StaticStore(snapshotOf<'presenter'>(studioView(), { connection: 'incompatible' }));
    renderLive(<ConnectionOverlay reload={reload} />, s);
    expect(screen.getByRole('alert').textContent).toBe('VERSIONE NON COMPATIBILE · RICARICA');
    act(() => vi.advanceTimersByTime(9_999));
    expect(reload).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('does not restart the reload timer when the parent re-renders with a new reload identity', () => {
    vi.useFakeTimers();
    const reload = vi.fn();
    const s = new StaticStore(snapshotOf<'presenter'>(studioView(), { connection: 'incompatible' }));
    const { rerender } = renderLive(<ConnectionOverlay reload={() => reload()} />, s);
    for (let i = 0; i < 3; i++) {
      act(() => vi.advanceTimersByTime(3_000));
      rerender(<ConnectionOverlay reload={() => reload()} />);
    }
    expect(reload).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1_000));
    expect(reload).toHaveBeenCalledTimes(1);
  });
});
