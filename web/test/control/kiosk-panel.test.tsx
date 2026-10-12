// SPDX-License-Identifier: GPL-2.0-or-later
import { act, fireEvent, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ApiClient, KioskConfig, KioskStatusLite } from '../../src/core/http';
import { KioskPanel } from '../../src/control/KioskPanel';
import { fakeApi } from '../support/api';
import { renderLive } from '../support/render';
import { StaticStore, snapshotOf } from '../support/store';

afterEach(() => {
  vi.useRealTimers();
});

const status = (state: string): KioskStatusLite => ({ state, enabled: true, pid: null, restarts: 0, browser: null, screen: null });
const SCREENS = [
  { name: 'DISPLAY1', width: 1920, height: 1080, primary: true },
  { name: 'DISPLAY2', width: 1920, height: 1080, primary: false },
];

async function panel(over: Partial<ApiClient> = {}) {
  const api = fakeApi({ screens: async () => ({ screens: SCREENS, live: true }), kioskStatus: async () => status('stopped'), ...over });
  const utils = renderLive(<KioskPanel api={api} />, new StaticStore(snapshotOf<'control'>(null)));
  await act(async () => {});
  return { ...utils, api };
}
const select = () => screen.getByRole('combobox') as HTMLSelectElement;
const button = (name: string) => screen.getByRole('button', { name }) as HTMLButtonElement;

describe('<KioskPanel>', () => {
  it('lists the primary screen and the monitors OBS reported, and shows the status', async () => {
    await panel();
    expect([...select().options].map((o) => o.textContent)).toEqual(['Schermo principale', 'DISPLAY1 · 1920×1080', 'DISPLAY2 · 1920×1080']);
    expect(screen.getByText('Stato: chiuso')).toBeTruthy();
  });

  it('saves exactly what was chosen, and only when something changed', async () => {
    const saved: KioskConfig[] = [];
    await panel({ saveKioskConfig: async (k) => (saved.push(k), k) });
    expect(button('Salva').disabled).toBe(true);
    fireEvent.change(select(), { target: { value: 'name:DISPLAY2' } });
    fireEvent.click(screen.getByLabelText('Apri il monitor automaticamente'));
    expect(button('Salva').disabled).toBe(false);
    await act(async () => {
      fireEvent.click(button('Salva'));
    });
    expect(saved).toEqual([{ enabled: true, screen: { kind: 'name', name: 'DISPLAY2' }, restart: true }]);
    expect(button('Salva').disabled).toBe(true);
  });

  it('Open and Reopen are not offered while the draft is unsaved: the server would use the old monitor', async () => {
    await panel();
    expect(button('Apri').disabled).toBe(false);
    expect(button('Riapri').disabled).toBe(false);
    fireEvent.change(select(), { target: { value: 'name:DISPLAY2' } });
    expect(button('Apri').disabled).toBe(true);
    expect(button('Riapri').disabled).toBe(true);
    await act(async () => {
      fireEvent.click(button('Salva'));
    });
    expect(button('Apri').disabled).toBe(false);
    expect(button('Riapri').disabled).toBe(false);
  });

  it('a configured monitor that is not connected stays visible and is marked, never silently swapped', async () => {
    await panel({ kioskConfig: async () => ({ enabled: true, screen: { kind: 'name', name: 'TV-SALA' }, restart: true }) });
    expect(select().value).toBe('name:TV-SALA');
    expect([...select().options].map((o) => o.textContent)).toContain('TV-SALA (non collegato)');
  });

  it('a fixed position set in the settings file is shown and kept', async () => {
    await panel({ kioskConfig: async () => ({ enabled: true, screen: { kind: 'position', x: 1920, y: 0 }, restart: true }) });
    expect(select().value).toBe('fixed');
    expect([...select().options].map((o) => o.textContent)).toContain('Posizione fissa 1920,0');
  });

  it('shows a plain explanation for every state, and the warning ones in the alert colour', async () => {
    const { container } = await panel({ kioskStatus: async () => status('screen_missing') });
    expect(screen.getByText('Stato: schermo non trovato: non apro nulla')).toBeTruthy();
    expect(container.querySelector('.kiosk-status')?.getAttribute('data-state')).toBe('screen_missing');
  });

  it('Open, Reopen and Close call the server and show the answer', async () => {
    const kioskAction = vi.fn(async (a: 'start' | 'stop' | 'restart') => status(a === 'stop' ? 'stopped' : 'running'));
    await panel({ kioskAction });
    await act(async () => {
      fireEvent.click(button('Apri'));
    });
    expect(kioskAction).toHaveBeenLastCalledWith('start');
    expect(screen.getByText('Stato: aperto')).toBeTruthy();
    await act(async () => {
      fireEvent.click(button('Riapri'));
    });
    expect(kioskAction).toHaveBeenLastCalledWith('restart');
    await act(async () => {
      fireEvent.click(button('Chiudi'));
    });
    expect(kioskAction).toHaveBeenLastCalledWith('stop');
    expect(screen.getByText('Stato: chiuso')).toBeTruthy();
  });

  it('a failed save is shown and the draft is kept', async () => {
    await panel({ saveKioskConfig: async () => Promise.reject(new Error('409')) });
    fireEvent.click(screen.getByLabelText('Riapri se si chiude'));
    await act(async () => {
      fireEvent.click(button('Salva'));
    });
    expect(screen.getByText('Impostazioni non salvate')).toBeTruthy();
    expect(button('Salva').disabled).toBe(false);
  });

  it('refreshes the status every five seconds', async () => {
    vi.useFakeTimers();
    const kioskStatus = vi.fn(async () => status('running'));
    renderLive(<KioskPanel api={fakeApi({ kioskStatus })} />, new StaticStore(snapshotOf<'control'>(null)));
    await act(async () => {});
    const first = kioskStatus.mock.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    expect(kioskStatus.mock.calls.length).toBe(first + 1);
  });

  it('renders nothing until the settings are known (no guessed defaults)', async () => {
    const { container } = await panel({ kioskConfig: async () => Promise.reject(new Error('offline')) });
    expect(container.querySelector('.kiosk')).toBeNull();
  });
});
