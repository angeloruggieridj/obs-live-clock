// SPDX-License-Identifier: GPL-2.0-or-later
import { act, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { HotkeyPending } from '../../src/core/http';
import { HOTKEY_POLL_MS, HotkeyHint } from '../../src/ui/control/HotkeyHint';
import { fakeApi } from '../support/api';
import { renderLive } from '../support/render';
import { StaticStore, snapshotOf } from '../support/store';

afterEach(() => {
  vi.useRealTimers();
});

function hint(initial: HotkeyPending | null, lang: 'it' | 'en' = 'it') {
  vi.useFakeTimers();
  let current: HotkeyPending | null | Error = initial;
  const api = fakeApi({
    hotkeyPending: async () => {
      if (current instanceof Error) throw current;
      return current;
    },
  });
  const utils = renderLive(<HotkeyHint api={api} />, new StaticStore(snapshotOf<'control'>(null)), lang);
  return { ...utils, set: (v: HotkeyPending | null | Error) => (current = v) };
}

describe('<HotkeyHint>', () => {
  it('shows nothing when no emergency hotkey is waiting for its second press', async () => {
    const h = hint(null);
    await act(async () => {});
    expect(h.container.querySelector('.hotkey-hint')).toBeNull();
  });

  it('asks for the second press by name', async () => {
    const h = hint({ slot: 'next', remainingMs: 800 });
    await act(async () => {});
    expect(screen.getByRole('alert').textContent).toBe('PREMI DI NUOVO NEXT PER CONFERMARE');
    h.unmount();
    const en = hint({ slot: 'time-plus', remainingMs: 800 }, 'en');
    await act(async () => {});
    expect(screen.getByRole('alert').textContent).toBe('PRESS +time AGAIN TO CONFIRM');
    en.unmount();
  });

  it('names every emergency slot, and shows an unknown slot id as it is', async () => {
    for (const [slot, label] of [['prev', 'PREV'], ['time-minus', '−tempo'], ['control-toggle', 'MANUALE/AUTO'], ['future-slot', 'future-slot']] as const) {
      const h = hint({ slot, remainingMs: 500 });
      await act(async () => {});
      expect(screen.getByRole('alert').textContent).toContain(label);
      h.unmount();
    }
  });

  it('follows the server: it disappears once the confirmation is gone, and on an error', async () => {
    const h = hint({ slot: 'next', remainingMs: 800 });
    await act(async () => {});
    expect(screen.queryByRole('alert')).not.toBeNull();
    h.set(null);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(HOTKEY_POLL_MS);
    });
    expect(screen.queryByRole('alert')).toBeNull();
    h.set({ slot: 'prev', remainingMs: 900 });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(HOTKEY_POLL_MS);
    });
    expect(screen.queryByRole('alert')).not.toBeNull();
    h.set(new Error('offline'));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(HOTKEY_POLL_MS);
    });
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('stops polling when it is removed', async () => {
    vi.useFakeTimers();
    const hotkeyPending = vi.fn(async () => null);
    const utils = renderLive(<HotkeyHint api={fakeApi({ hotkeyPending })} />, new StaticStore(snapshotOf<'control'>(null)));
    await act(async () => {});
    utils.unmount();
    const calls = hotkeyPending.mock.calls.length;
    await vi.advanceTimersByTimeAsync(5 * HOTKEY_POLL_MS);
    expect(hotkeyPending.mock.calls.length).toBe(calls);
  });
});
