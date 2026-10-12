// SPDX-License-Identifier: GPL-2.0-or-later
import { fireEvent, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { toIsoWithOffset } from '../../src/editor/model/time';
import { SettingsPanel } from '../../src/editor/settings/SettingsPanel';
import { FakeEditorApi, renderWithSession, sampleEpisode, sampleFormat } from '../support/editor';

const FORMAT = { kind: 'format', id: 'solo-futsal' } as const;
const EPISODE = { kind: 'episode', id: 'ep-2026-10-12' } as const;
const doc = (s: { store: { getSnapshot(): { doc: any } } }) => s.store.getSnapshot().doc;
const commit = (el: HTMLElement, value: string) => {
  fireEvent.change(el, { target: { value } });
  fireEvent.blur(el);
};

async function setup(open = FORMAT as typeof FORMAT | typeof EPISODE, api = new FakeEditorApi()) {
  api.formats.set('solo-futsal', sampleFormat());
  api.episodes.set('ep-2026-10-12', sampleEpisode());
  return renderWithSession(<SettingsPanel />, { open, api });
}

describe('document and episode fields', () => {
  it('renames the document', async () => {
    const r = await setup();
    commit(screen.getByRole('textbox', { name: 'Nome del documento' }), 'Calcio a 5');
    expect(doc(r.session).name).toBe('Calcio a 5');
  });

  it('shows the episode fieldset only for an episode and edits date, planned start and playlist', async () => {
    const f = await setup(FORMAT);
    expect(screen.queryByLabelText('Inizio previsto')).toBeNull();
    f.unmount();
    const r = await setup(EPISODE);
    commit(screen.getByLabelText('Data'), '2026-11-02');
    expect(doc(r.session).date).toBe('2026-11-02');
    commit(screen.getByLabelText('Inizio previsto'), '20:15');
    expect(doc(r.session).plannedStart).toBe(toIsoWithOffset('2026-11-02', '20:15'));
    commit(screen.getByLabelText('Inizio previsto'), '');
    expect(doc(r.session).plannedStart).toBeNull();
    commit(screen.getByRole('textbox', { name: 'Nome playlist' }), 'Serata');
    expect(doc(r.session).playlistName).toBe('Serata');
  });
});

describe('preset', () => {
  it('changing the mode resets the preset, and undo restores it', async () => {
    const r = await setup();
    expect((screen.getByRole('combobox', { name: 'Modalità di produzione' }) as HTMLSelectElement).value).toBe('live_to_tape');
    fireEvent.change(screen.getByRole('combobox', { name: 'Modalità di produzione' }), { target: { value: 'tv' } });
    expect(doc(r.session).preset).toMatchObject({ mode: 'tv', recPauseFreezesProgram: false });
    r.session.undo();
    expect(doc(r.session).preset.mode).toBe('live_to_tape');
  });

  it('edits the thresholds in seconds and refuses a step under one second', async () => {
    const r = await setup();
    expect((screen.getByRole('spinbutton', { name: 'Soglia di avviso studio (s)' }) as HTMLInputElement).value).toBe('60');
    commit(screen.getByRole('spinbutton', { name: 'Soglia di avviso studio (s)' }), '90');
    expect(doc(r.session).preset.warnMs).toBe(90_000);
    commit(screen.getByRole('spinbutton', { name: 'Rientro imminente (s)' }), '15');
    expect(doc(r.session).preset.returnImminentMs).toBe(15_000);
    commit(screen.getByRole('spinbutton', { name: 'Passo ±tempo (s)' }), '0.5');
    expect(doc(r.session).preset.adjustStepMs).toBe(30_000);
    expect((screen.getByRole('spinbutton', { name: 'Passo ±tempo (s)' }) as HTMLInputElement).value).toBe('30');
  });

  it('toggles the REC pause rule', async () => {
    const r = await setup();
    fireEvent.click(screen.getByRole('checkbox', { name: 'La pausa REC congela il programma' }));
    expect(doc(r.session).preset.recPauseFreezesProgram).toBe(false);
  });
});

describe('scene groups', () => {
  it('renames a group, adds a scene typed by hand or picked from OBS, and removes one', async () => {
    const r = await setup();
    commit(screen.getByRole('textbox', { name: 'Nome gruppo studio' }), 'Studio principale');
    expect(doc(r.session).sceneGroups[0].name).toBe('Studio principale');
    commit(screen.getByRole('textbox', { name: 'Nome scena studio' }), 'PLAYOUT');
    fireEvent.click(screen.getByRole('button', { name: 'Aggiungi scena studio' }));
    expect(doc(r.session).sceneGroups[0].scenes).toEqual(['CAM 1', 'CAM 2', 'CAM 3', 'PLAYOUT']);
    fireEvent.click(screen.getByRole('button', { name: 'Rimuovi scena CAM 2' }));
    expect(doc(r.session).sceneGroups[0].scenes).toEqual(['CAM 1', 'CAM 3', 'PLAYOUT']);
  });

  it('offers the OBS scenes in a datalist and marks a scene OBS does not have', async () => {
    const api = new FakeEditorApi();
    api.scenes = ['CAM 1', 'CAM 2', 'PLAYOUT'];
    await setup(FORMAT, api);
    const options = [...document.querySelectorAll('datalist option')].map((o) => o.getAttribute('value'));
    expect(options).toContain('PLAYOUT');
    await screen.findByTestId('group-studio');
    expect(within(screen.getByTestId('group-studio')).getByText('CAM 3').className).toContain('is-warn');
    expect(within(screen.getByTestId('group-studio')).getByText('CAM 1').className).not.toContain('is-warn');
  });

  it('says OBS is offline and still lets the director type', async () => {
    const api = new FakeEditorApi();
    api.scenes = null;
    await setup(FORMAT, api);
    expect(await screen.findByText('OBS non connesso: scrivi i nomi delle scene a mano')).toBeTruthy();
  });

  it('keeps a group that a block uses and the last scene of a group; removes an unused group', async () => {
    const r = await setup();
    expect((screen.getByRole('button', { name: 'Rimuovi gruppo studio' }) as HTMLButtonElement).disabled).toBe(true);
    commit(screen.getByRole('textbox', { name: 'Nome nuovo gruppo' }), 'Ospiti');
    fireEvent.click(screen.getByRole('button', { name: 'Nuovo gruppo' }));
    expect(doc(r.session).sceneGroups.map((g: { id: string }) => g.id)).toEqual(['studio', 'ospiti']);
    expect((screen.getByRole('button', { name: 'Rimuovi scena SCENA 1' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Rimuovi gruppo ospiti' }));
    expect(doc(r.session).sceneGroups).toHaveLength(1);
  });
});

describe('messages', () => {
  it('edits, switches the dismissal mode, adds and removes messages', async () => {
    const r = await setup();
    commit(screen.getByRole('textbox', { name: 'Testo messaggio stringi' }), 'STRINGERE');
    expect(doc(r.session).messages[0].text).toBe('STRINGERE');
    expect((screen.getByRole('spinbutton', { name: 'Secondi stringi' }) as HTMLInputElement).value).toBe('10');
    commit(screen.getByRole('spinbutton', { name: 'Secondi stringi' }), '5');
    expect(doc(r.session).messages[0].dismiss).toEqual({ kind: 'timeout', ms: 5_000 });
    fireEvent.change(screen.getByRole('combobox', { name: 'Chiusura stringi' }), { target: { value: 'manual' } });
    expect(doc(r.session).messages[0].dismiss).toEqual({ kind: 'manual' });
    expect(screen.queryByRole('spinbutton', { name: 'Secondi stringi' })).toBeNull();
    commit(screen.getByRole('textbox', { name: 'Testo nuovo messaggio' }), 'PAUSA');
    fireEvent.click(screen.getByRole('button', { name: 'Nuovo messaggio' }));
    expect(doc(r.session).messages.map((m: { id: string }) => m.id)).toEqual(['stringi', 'cam2', 'pausa']);
    fireEvent.click(screen.getByRole('button', { name: 'Rimuovi messaggio cam2' }));
    expect(doc(r.session).messages.map((m: { id: string }) => m.id)).toEqual(['stringi', 'pausa']);
  });

  it('is read-only when the episode is live', async () => {
    const api = new FakeEditorApi();
    api.live = { episodeId: 'ep-2026-10-12', phase: 'live' };
    await setup(EPISODE, api);
    expect((screen.getByRole('textbox', { name: 'Testo messaggio stringi' }) as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByRole('checkbox', { name: 'La pausa REC congela il programma' }) as HTMLInputElement).disabled).toBe(true);
  });
});
