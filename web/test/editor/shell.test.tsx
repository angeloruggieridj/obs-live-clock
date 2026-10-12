// SPDX-License-Identifier: GPL-2.0-or-later
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { ApiError } from '../../src/core/http';
import { EditorApp } from '../../src/editor/EditorApp';
import { EDITOR_MODULES } from '../../src/editor/i18n';
import { OP_LABELS, moveBlock, renameDoc } from '../../src/editor/model/ops';
import { EditorSession } from '../../src/editor/session/session';
import { FakeEditorApi, sampleEpisode, sampleFormat } from '../support/editor';
import { fakeTimers } from '../support/fake-timers';

const FORMAT = { kind: 'format', id: 'solo-futsal' } as const;
const EPISODE = { kind: 'episode', id: 'ep-2026-10-12' } as const;

function boot(prepare?: (api: FakeEditorApi) => void, props: { lang?: 'it' | 'en'; pollLiveMs?: number; pollExternalMs?: number } = {}) {
  const api = new FakeEditorApi();
  api.formats.set('solo-futsal', sampleFormat());
  api.episodes.set('ep-2026-10-12', sampleEpisode());
  prepare?.(api);
  const time = fakeTimers();
  const session = new EditorSession(api, time.timers);
  const utils = render(<EditorApp lang={props.lang ?? 'it'} session={session} pollLiveMs={props.pollLiveMs ?? 0} pollExternalMs={props.pollExternalMs ?? 0} />);
  const open = (ref: typeof FORMAT | typeof EPISODE) => act(async () => void (await session.open(ref)));
  return { api, session, ...utils, open, user: userEvent.setup(), advance: (ms: number) => act(async () => time.advance(ms)) };
}
const saveState = () => screen.getByTestId('save-state');

describe('EditorApp layout', () => {
  it('shows the five regions and the prompt when nothing is open', async () => {
    boot();
    for (const r of ['library', 'timeline', 'properties', 'settings', 'validation']) expect(screen.getByTestId(`region-${r}`)).toBeTruthy();
    expect(screen.getByText('Apri o crea un format dal pannello a sinistra')).toBeTruthy();
    expect(screen.queryByTestId('timeline')).toBeNull();
  });

  it('opens a document from the library and shows the timeline and its title', async () => {
    const { user, session } = boot();
    await user.click(await screen.findByRole('button', { name: 'Solo Futsal' }));
    expect(await screen.findByTestId('timeline')).toBeTruthy();
    expect(screen.getByTestId('doc-title').textContent).toBe('Format: Solo Futsal');
    expect(session.getSnapshot().ref).toEqual(FORMAT);
  });

  it('speaks English with ?lang=en', async () => {
    const { open } = boot(undefined, { lang: 'en' });
    await open(FORMAT);
    expect(saveState().textContent).toBe('Saved');
    expect(screen.getByRole('button', { name: 'Undo' })).toBeTruthy();
  });
});

describe('undo and redo', () => {
  it('buttons follow the history and the tooltip names the operation', async () => {
    const { open, session } = boot();
    await open(FORMAT);
    const undo = screen.getByRole('button', { name: 'Annulla' }) as HTMLButtonElement;
    const redo = screen.getByRole('button', { name: 'Ripristina' }) as HTMLButtonElement;
    expect(undo.disabled).toBe(true);
    act(() => void session.apply(moveBlock(0, 1)));
    expect(undo.disabled).toBe(false);
    expect(undo.title).toBe('Annulla: spostamento blocco');
    fireEvent.click(undo);
    expect(redo.disabled).toBe(false);
    expect(redo.title).toBe('Ripristina: spostamento blocco');
    fireEvent.click(redo);
    expect(session.store.getSnapshot().doc!.blocks[0]!.id).toBe('br1');
  });

  it('Ctrl+Z, Ctrl+Shift+Z and Ctrl+Y work, except inside a text field', async () => {
    const { open, session } = boot();
    await open(FORMAT);
    act(() => void session.apply(moveBlock(0, 1)));
    fireEvent.keyDown(window, { key: 'z', ctrlKey: true });
    expect(session.store.getSnapshot().doc!.blocks[0]!.id).toBe('b1');
    fireEvent.keyDown(window, { key: 'z', ctrlKey: true, shiftKey: true });
    expect(session.store.getSnapshot().doc!.blocks[0]!.id).toBe('br1');
    fireEvent.keyDown(window, { key: 'z', ctrlKey: true });
    fireEvent.keyDown(window, { key: 'y', ctrlKey: true });
    expect(session.store.getSnapshot().doc!.blocks[0]!.id).toBe('br1');
    const field = screen.getByRole('textbox', { name: 'Nome del documento' });
    fireEvent.keyDown(field, { key: 'z', ctrlKey: true, bubbles: true });
    expect(session.store.getSnapshot().doc!.blocks[0]!.id).toBe('br1'); // untouched
  });

  it('every operation label has a translation in both languages', () => {
    for (const label of OP_LABELS) {
      expect(`shell.op.${label}` in EDITOR_MODULES.shell.it, label).toBe(true);
      expect(`shell.op.${label}` in EDITOR_MODULES.shell.en, label).toBe(true);
    }
  });
});

describe('save indicator (Review Focus 1)', () => {
  it('goes unsaved -> saving -> saved', async () => {
    const { open, session, advance } = boot();
    await open(FORMAT);
    expect(saveState().getAttribute('data-state')).toBe('clean');
    act(() => void session.apply(renameDoc('Nuovo nome')));
    expect(saveState().textContent).toBe('Modifiche non salvate');
    await advance(900);
    expect(saveState().textContent).toBe('Salvato');
  });

  it('shows a loud error with a retry button, and never claims "Salvato" while it failed', async () => {
    const { open, session, api, advance } = boot();
    await open(FORMAT);
    api.failNext('putDoc', new ApiError(500, 'internal'));
    act(() => void session.apply(renameDoc('Nuovo nome')));
    await advance(900);
    expect(saveState().getAttribute('data-state')).toBe('error');
    expect(saveState().textContent).toContain('SALVATAGGIO NON RIUSCITO (internal)');
    expect(saveState().textContent).not.toContain('Salvato');
    fireEvent.click(within(saveState()).getByRole('button', { name: 'Riprova ora' }));
    await waitFor(() => expect(saveState().getAttribute('data-state')).toBe('clean'));
    expect(api.formats.get('solo-futsal')!.name).toBe('Nuovo nome');
  });

  it('asks the browser to confirm leaving while there is anything unsaved', async () => {
    const { open, session, advance } = boot();
    await open(FORMAT);
    const clean = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(clean);
    expect(clean.defaultPrevented).toBe(false);
    act(() => void session.apply(renameDoc('Nuovo nome')));
    const dirty = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(dirty);
    expect(dirty.defaultPrevented).toBe(true);
    await advance(900);
    const saved = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(saved);
    expect(saved.defaultPrevented).toBe(false);
  });

  it('asks the browser to confirm leaving while a conflict is pending', async () => {
    const { open, session, api, advance } = boot();
    await open(FORMAT);
    act(() => void session.apply(renameDoc('Mia modifica')));
    api.formats.set('solo-futsal', { ...sampleFormat(), name: 'Loro modifica' });
    await advance(900); // the save sees the foreign change before writing: conflict set, nothing written
    expect(session.getSnapshot().conflict).not.toBeNull();
    expect(api.count('putDoc')).toBe(0);
    // Even if the autosave momentarily looks clean, a pending conflict alone must warn before leaving.
    session.autosave.markSaved();
    const e = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(e);
    expect(e.defaultPrevented).toBe(true);
  });
});

describe('banners', () => {
  it('shows the live lock for an episode on air', async () => {
    const { open } = boot((a) => {
      a.live = { episodeId: 'ep-2026-10-12', phase: 'live' };
    });
    await open(EPISODE);
    expect(screen.getByText('Puntata IN ONDA: sola lettura')).toBeTruthy();
  });

  it('polling locks an open episode that goes on air in another tab (Review Focus 5)', async () => {
    const { open, api } = boot(undefined, { pollLiveMs: 20 });
    await open(EPISODE);
    expect(screen.queryByText('Puntata IN ONDA: sola lettura')).toBeNull();
    api.live = { episodeId: 'ep-2026-10-12', phase: 'live' };
    expect(await screen.findByText('Puntata IN ONDA: sola lettura')).toBeTruthy();
    expect((screen.getByRole('textbox', { name: 'Nome del documento' }) as HTMLInputElement).disabled).toBe(true);
  });

  it('tells the director when the open episode is the one loaded for the live', async () => {
    const { open } = boot((a) => {
      a.live = { episodeId: 'ep-2026-10-12', phase: 'preshow' };
    });
    await open(EPISODE);
    expect(screen.getByText(/Puntata caricata per la live: le modifiche valgono/)).toBeTruthy();
  });

  it('offers a choice when another tab changed the document and this one has unsaved edits', async () => {
    const { open, session, api, user } = boot();
    await open(FORMAT);
    act(() => void session.apply(renameDoc('Mia modifica')));
    api.formats.set('solo-futsal', { ...sampleFormat(), name: 'Loro modifica' });
    fireEvent(window, new Event('focus'));
    expect(await screen.findByText('Questo documento è stato modificato altrove.')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Usa la versione del server' }));
    expect(session.store.getSnapshot().doc!.name).toBe('Loro modifica');
    expect(screen.queryByText('Questo documento è stato modificato altrove.')).toBeNull();
  });

  it('refreshes silently, with a toast, when the local copy is clean', async () => {
    const { open, session, api } = boot();
    await open(FORMAT);
    api.formats.set('solo-futsal', { ...sampleFormat(), name: 'Cambiato altrove' });
    fireEvent(window, new Event('focus'));
    expect(await screen.findByText("Aggiornato da un'altra sessione")).toBeTruthy();
    expect(session.store.getSnapshot().doc!.name).toBe('Cambiato altrove');
  });

  it('refuses to switch documents while the save fails, and lets the director discard on purpose', async () => {
    const { open, session, api, user } = boot();
    await open(FORMAT);
    api.failNext('putDoc', new TypeError('down'));
    act(() => void session.apply(renameDoc('Nuovo nome')));
    const row = await screen.findByTestId('ep-ep-2026-10-12');
    await user.click(within(row).getByRole('button', { name: 'Solo Futsal · 12/10/2026' }));
    expect(await screen.findByText('Impossibile cambiare documento: le modifiche non sono state salvate.')).toBeTruthy();
    expect(session.getSnapshot().ref).toEqual(FORMAT);
    await user.click(screen.getByRole('button', { name: 'Scarta le modifiche' }));
    expect(session.getSnapshot().ref).toBeNull();
    expect(screen.getByText('Apri o crea un format dal pannello a sinistra')).toBeTruthy();
  });
});
