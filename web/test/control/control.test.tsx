// SPDX-License-Identifier: GPL-2.0-or-later
import { act, fireEvent, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ControlScreen } from '../../src/control/ControlScreen';
import { ApiError, type ApiClient } from '../../src/core/http';
import type { ControlView } from '../../src/core/views';
import { fakeApi } from '../support/api';
import { renderLive } from '../support/render';
import { StaticStore, snapshotOf } from '../support/store';
import { controlView, studioView } from '../support/views';

async function control(view: ControlView | null = controlView(), api: ApiClient = fakeApi()) {
  const store = new StaticStore(snapshotOf<'control'>(view));
  const utils = renderLive(<ControlScreen api={api} />, store);
  await act(async () => {});
  const rows = () => [...utils.container.querySelectorAll<HTMLTableRowElement>('table.rundown tbody tr')];
  const col = (cls: string) => rows().map((r) => r.querySelector(`.${cls}`)!.textContent);
  return { ...utils, store, rows, col };
}

describe('<ControlScreen> rundown', () => {
  it('lists every slot with block, item, status, planned and real times and durations', async () => {
    const c = await control();
    expect(c.rows()).toHaveLength(8);
    expect(c.col('c-slot')).toEqual(['1', '2', '3', '4', '5', '6', '7', '8']);
    expect(c.col('c-block')).toEqual(['Primo blocco', '', '', 'Break 1', 'Secondo blocco', '', '', 'Chiusura']);
    expect(c.col('c-item')).toEqual(['Studio', 'Servizio · Servizio 1', 'Studio', 'Break', 'Studio', 'Servizio · Servizio 2', 'Studio', 'Studio']);
    expect(c.col('c-status')).toEqual(['andato', 'andato', 'andato', 'andato', 'in onda', 'in attesa', 'in attesa', 'in attesa']);
    expect(c.col('c-planned')).toEqual(['13:56:40', '', '', '14:08:40', '14:11:40', '', '', '14:21:40']);
    expect(c.col('c-start')[4]).toBe('14:11:20');
    expect(c.col('c-end')[4]).toBe('—');
    expect(c.col('c-duration')).toEqual(['—', '3:05', '—', '3:00PIAN.', '—', '2:00', '—', '—']);
    expect(c.rows()[4]!.getAttribute('aria-current')).toBe('true');
    expect(c.rows()[4]!.dataset.status).toBe('onair');
  });

  it('shows provisional, postponed, dropped, the return slot and estimated durations', async () => {
    const base = controlView();
    const rows = base.rows.map((r) => ({ ...r }));
    rows[1] = { ...rows[1]!, status: 'postponed' };
    rows[5] = { ...rows[5]!, status: 'dropped', durationSource: 'estimated' };
    rows[6] = { ...rows[6]!, provisional: true };
    const c = await control(controlView({ rows, returnSlot: 4 }));
    expect(c.col('c-status')[1]).toBe('rimandato');
    expect(c.col('c-status')[4]).toBe('in onda ↩');
    expect(c.col('c-status')[5]).toBe('eliminato');
    expect(c.col('c-status')[6]).toBe('in attesa · provvisorio');
    expect(c.col('c-duration')[5]).toBe('2:00STIMATO');
  });

  it('jumps to a slot with a confirmed VAI, never on the current row', async () => {
    const c = await control();
    expect(within(c.rows()[4]!).queryByRole('button', { name: 'VAI' })).toBeNull();
    const go = within(c.rows()[6]!).getByRole('button', { name: 'VAI' });
    fireEvent.click(go);
    expect(c.store.commands).toEqual([]);
    fireEvent.click(go);
    expect(c.store.commands).toEqual([{ name: 'goto', slot: 6 }]);
  });

  it('offers the same commands as the dock', async () => {
    await control();
    expect(screen.getByRole('button', { name: 'NEXT' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '1 · STRINGI' })).toBeTruthy();
    expect(screen.getByRole('textbox', { name: 'Testo libero' })).toBeTruthy();
  });
});

describe('<ControlScreen> event feed', () => {
  it('logs what changes, newest first, with the server time', async () => {
    const c = await control();
    const feed = () => [...c.container.querySelectorAll('.feed-list li')].map((li) => li.textContent);
    expect(feed()).toEqual(['14:13:20 Puntata caricata: Solo Futsal · 12/10/2026']);
    c.update({ view: controlView({ presenter: studioView({ message: { text: 'STRINGI' } }) }) });
    expect(feed()[0]).toBe('14:13:20 Messaggio: STRINGI');
    expect(screen.getByText('EVENTI (questa sessione)')).toBeTruthy();
  });
});

describe('<ControlScreen> episode picker', () => {
  const episodes = [
    { id: 'ep-2026-10-12', name: 'Solo Futsal · 12/10/2026', date: '2026-10-12' },
    { id: 'ep-prova', name: 'Prova pomeriggio', date: '2026-10-11' },
  ];

  it('lists episodes and loads one; the loaded one cannot be reloaded', async () => {
    const loadEpisode = vi.fn(async () => {});
    const c = await control(controlView(), fakeApi({ listEpisodes: async () => episodes, loadEpisode }));
    const items = [...c.container.querySelectorAll<HTMLLIElement>('.episode-list li')];
    expect(items.map((li) => li.querySelector('.label-text')!.textContent)).toEqual(['Solo Futsal · 12/10/2026', 'Prova pomeriggio']);
    expect((within(items[0]!).getByRole('button', { name: 'CARICA' }) as HTMLButtonElement).disabled).toBe(true);
    await act(async () => {
      fireEvent.click(within(items[1]!).getByRole('button', { name: 'CARICA' }));
    });
    expect(loadEpisode).toHaveBeenCalledWith('ep-prova');
  });

  it('explains why a load was refused', async () => {
    const c = await control(
      controlView(),
      fakeApi({
        listEpisodes: async () => episodes,
        loadEpisode: async () => {
          throw new ApiError(409, 'live_running');
        },
      }),
    );
    const items = [...c.container.querySelectorAll<HTMLLIElement>('.episode-list li')];
    await act(async () => {
      fireEvent.click(within(items[1]!).getByRole('button', { name: 'CARICA' }));
    });
    expect(c.container.querySelector('.episodes .alert')!.textContent).toBe("Live in corso: impossibile caricare un'altra puntata");
  });

  it('says when there is nothing to load, and works without a loaded episode', async () => {
    const c = await control(null);
    expect(c.container.querySelector('.episodes .empty')!.textContent).toBe('Nessuna puntata salvata');
    expect(c.container.querySelector('.c-header h1')!.textContent).toBe('NESSUNA PUNTATA CARICATA');
    expect(c.container.querySelector('table.rundown')).toBeNull();
  });
});
