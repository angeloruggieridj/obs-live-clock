// SPDX-License-Identifier: GPL-2.0-or-later
import { fireEvent, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ApiError } from '../../src/core/http';
import { LibraryPanel } from '../../src/editor/library/LibraryPanel';
import { toIsoWithOffset } from '../../src/editor/model/time';
import { FakeEditorApi, renderWithSession, sampleEpisode, sampleFormat } from '../support/editor';

const NOW = () => new Date(2026, 9, 20, 10, 0);
const EP = 'ep-2026-10-12';

async function setup(prepare?: (api: FakeEditorApi) => void) {
  const api = new FakeEditorApi();
  api.formats.set('solo-futsal', sampleFormat());
  api.episodes.set(EP, sampleEpisode());
  prepare?.(api);
  const r = await renderWithSession(<LibraryPanel now={NOW} />, { api });
  await screen.findByTestId('fmt-solo-futsal');
  return r;
}

describe('LibraryPanel', () => {
  it('lists formats and episodes, with links to the other pages', async () => {
    await setup();
    expect(within(screen.getByTestId('fmt-solo-futsal')).getByText('Solo Futsal')).toBeTruthy();
    expect(within(screen.getByTestId(`ep-${EP}`)).getByText('Solo Futsal · 12/10/2026')).toBeTruthy();
    const nav = screen.getByRole('navigation', { name: 'Apri' });
    expect(within(nav).getByRole('link', { name: 'Dock' }).getAttribute('href')).toBe('/dock');
    expect(within(nav).getByRole('link', { name: 'Control' }).getAttribute('href')).toBe('/control');
    expect(within(nav).getByRole('link', { name: 'Presenter' }).getAttribute('href')).toBe('/presenter');
  });

  it('opens a document on click and marks it', async () => {
    const { session, user } = await setup();
    await user.click(within(screen.getByTestId('fmt-solo-futsal')).getByRole('button', { name: 'Solo Futsal' }));
    expect(session.getSnapshot().ref).toEqual({ kind: 'format', id: 'solo-futsal' });
    expect(within(screen.getByTestId('fmt-solo-futsal')).getByRole('button', { name: 'Solo Futsal' }).getAttribute('aria-current')).toBe('true');
  });

  it('creates a format with a lowercase slug id, opens it, and avoids an existing id', async () => {
    const { api, session, user } = await setup();
    await user.click(screen.getByRole('button', { name: 'Nuovo format' }));
    await user.type(screen.getByRole('textbox', { name: 'Nome' }), 'Notte Basket{Enter}');
    expect(await screen.findByTestId('fmt-notte-basket')).toBeTruthy();
    expect(api.formats.get('notte-basket')!.name).toBe('Notte Basket');
    expect(session.getSnapshot().ref).toEqual({ kind: 'format', id: 'notte-basket' });
    await user.click(screen.getByRole('button', { name: 'Nuovo format' }));
    await user.type(screen.getByRole('textbox', { name: 'Nome' }), 'Solo Futsal{Enter}');
    expect(await screen.findByTestId('fmt-solo-futsal-2')).toBeTruthy();
  });

  it('shows "exists" when the server refuses the id', async () => {
    const { api, user } = await setup();
    api.failNext('createFormat', new ApiError(409, 'exists'));
    await user.click(screen.getByRole('button', { name: 'Nuovo format' }));
    await user.type(screen.getByRole('textbox', { name: 'Nome' }), 'Altro{Enter}');
    expect((await screen.findByTestId('lib-status')).textContent).toContain('Esiste già');
  });

  it('duplicates a format and an episode', async () => {
    const { api, user } = await setup();
    await user.click(screen.getByRole('button', { name: 'Duplica Solo Futsal' }));
    expect(await screen.findByTestId('fmt-solo-futsal-copia')).toBeTruthy();
    expect(api.formats.get('solo-futsal-copia')!.name).toBe('Solo Futsal (copia)');
    await user.click(screen.getByRole('button', { name: 'Duplica Solo Futsal · 12/10/2026' }));
    expect(api.episodes.size).toBe(2);
  });

  it('renames a stored document without opening it; the id stays', async () => {
    const { api, user } = await setup();
    await user.click(screen.getByRole('button', { name: 'Rinomina Solo Futsal' }));
    const input = screen.getByRole('textbox', { name: 'Nome' });
    await user.clear(input);
    await user.type(input, 'Calcio a 5{Enter}');
    await screen.findByText('Calcio a 5');
    expect(api.formats.get('solo-futsal')!.name).toBe('Calcio a 5');
  });

  it('deletes only after a second click, and forgets the open document', async () => {
    const { api, session, user } = await setup();
    await user.click(within(screen.getByTestId('fmt-solo-futsal')).getByRole('button', { name: 'Solo Futsal' }));
    await user.click(screen.getByRole('button', { name: 'Elimina Solo Futsal' }));
    expect(api.formats.has('solo-futsal')).toBe(true);
    await user.click(screen.getByRole('button', { name: 'Conferma eliminazione Solo Futsal' }));
    expect(api.formats.has('solo-futsal')).toBe(false);
    expect(session.getSnapshot().ref).toBeNull();
  });

  it('refuses to delete the loaded episode and says why', async () => {
    const { api, user } = await setup((a) => {
      a.live = { episodeId: EP, phase: 'preshow' };
    });
    const name = 'Solo Futsal · 12/10/2026';
    await user.click(screen.getByRole('button', { name: `Elimina ${name}` }));
    await user.click(screen.getByRole('button', { name: `Conferma eliminazione ${name}` }));
    expect((await screen.findByTestId('lib-status')).textContent).toContain('non eliminabile');
    expect(api.episodes.has(EP)).toBe(true);
  });

  it('creates an episode from a format with date, planned start and playlist name, then opens it', async () => {
    const { api, session, user } = await setup();
    await user.click(screen.getByRole('button', { name: 'Nuova puntata Solo Futsal' }));
    const dialog = screen.getByRole('dialog', { name: 'Nuova puntata' });
    expect((within(dialog).getByLabelText('Data') as HTMLInputElement).value).toBe('2026-10-20');
    fireEvent.change(within(dialog).getByLabelText('Inizio previsto'), { target: { value: '19:30' } });
    await user.type(within(dialog).getByLabelText('Nome playlist'), 'Puntata del 20/10');
    await user.click(within(dialog).getByRole('button', { name: 'Crea' }));
    const id = 'solo-futsal-2026-10-20';
    expect(await screen.findByTestId(`ep-${id}`)).toBeTruthy();
    const ep = api.episodes.get(id)!;
    expect(ep).toMatchObject({ formatId: 'solo-futsal', date: '2026-10-20', playlistName: 'Puntata del 20/10', plannedStart: toIsoWithOffset('2026-10-20', '19:30') });
    expect(session.getSnapshot().ref).toEqual({ kind: 'episode', id });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('sends nulls when the optional fields are empty', async () => {
    const { api, user } = await setup();
    await user.click(screen.getByRole('button', { name: 'Nuova puntata Solo Futsal' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Crea' }));
    await screen.findByTestId('ep-solo-futsal-2026-10-20');
    expect(api.episodes.get('solo-futsal-2026-10-20')).toMatchObject({ plannedStart: null, playlistName: null });
  });

  it('loads an episode for the live and tags it', async () => {
    const { api, user } = await setup();
    await user.click(screen.getByRole('button', { name: 'Carica per la live Solo Futsal · 12/10/2026' }));
    expect((await screen.findByTestId('lib-status')).textContent).toContain('Puntata caricata per la live');
    expect(api.live.episodeId).toBe(EP);
    expect(within(await screen.findByTestId(`ep-${EP}`)).getByText('CARICATA')).toBeTruthy();
  });

  it('tags the episode that is on air', async () => {
    await setup((a) => {
      a.live = { episodeId: EP, phase: 'live' };
    });
    await screen.findByTestId(`ep-${EP}`);
    expect(within(screen.getByTestId(`ep-${EP}`)).getByText('IN ONDA')).toBeTruthy();
  });

  it('explains a refused load (errors in the rundown)', async () => {
    const { user } = await setup((a) => {
      const ep = a.episodes.get(EP)!;
      (ep.blocks[0] as { elements: Array<{ plannedDurationMs?: number }> }).elements[1]!.plannedDurationMs = 9_999_999;
    });
    await user.click(screen.getByRole('button', { name: 'Carica per la live Solo Futsal · 12/10/2026' }));
    expect((await screen.findByTestId('lib-status')).textContent).toContain('Rundown con errori');
  });
});
