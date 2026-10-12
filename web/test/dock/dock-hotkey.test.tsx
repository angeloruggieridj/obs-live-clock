// SPDX-License-Identifier: GPL-2.0-or-later
import { act, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DockScreen } from '../../src/dock/DockScreen';
import { fakeApi } from '../support/api';
import { renderLive } from '../support/render';
import { StaticStore, snapshotOf } from '../support/store';
import { controlView } from '../support/views';

afterEach(() => {
  vi.useRealTimers();
});

describe('<DockScreen> hotkey confirmation (DT-9)', () => {
  it('says "press again to confirm" while an emergency hotkey waits for its second press', async () => {
    const api = fakeApi({ hotkeyPending: async () => ({ slot: 'next', remainingMs: 700 }) });
    renderLive(<DockScreen api={api} search="" />, new StaticStore(snapshotOf<'control'>(controlView())));
    await act(async () => {});
    expect(screen.getByRole('alert').textContent).toBe('PREMI DI NUOVO NEXT PER CONFERMARE');
  });

  it('shows nothing extra when no hotkey is pending', async () => {
    renderLive(<DockScreen api={fakeApi()} search="" />, new StaticStore(snapshotOf<'control'>(controlView())));
    await act(async () => {});
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
