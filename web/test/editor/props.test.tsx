// SPDX-License-Identifier: GPL-2.0-or-later
import { fireEvent, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { StudioBlock } from '@olc/shared';
import { PropertiesPanel } from '../../src/editor/props/PropertiesPanel';
import { FakeEditorApi, renderWithSession, sampleEpisode, sampleFormat } from '../support/editor';

const FORMAT = { kind: 'format', id: 'solo-futsal' } as const;
const blocks = (s: { store: { getSnapshot(): { doc: { blocks: unknown[] } | null } } }) => s.store.getSnapshot().doc!.blocks as Array<Record<string, any>>;

async function setup(select: string | null = 'b1', prepare?: (f: ReturnType<typeof sampleFormat>) => void, api = new FakeEditorApi()) {
  const f = sampleFormat();
  prepare?.(f);
  api.formats.set('solo-futsal', f);
  const r = await renderWithSession(<PropertiesPanel />, { open: FORMAT, api });
  r.session.selection.select(select);
  return r;
}
const commit = (el: HTMLElement, value: string) => {
  fireEvent.change(el, { target: { value } });
  fireEvent.blur(el);
};

describe('block fields', () => {
  it('asks for a selection', async () => {
    await setup(null);
    expect(screen.getByText('Seleziona un blocco')).toBeTruthy();
  });

  it('shows the selected studio block and its studio time', async () => {
    await setup('b1');
    expect((screen.getByRole('textbox', { name: 'Nome' }) as HTMLInputElement).value).toBe('Primo blocco');
    expect((screen.getByRole('textbox', { name: 'Durata' }) as HTMLInputElement).value).toBe('12:00');
    expect((screen.getByRole('checkbox', { name: 'Elastico' }) as HTMLInputElement).checked).toBe(true);
    expect(screen.getByTestId('studio-time').textContent).toBe('Tempo studio: 9:00');
  });

  it('commits a rename on blur as one edit, and refuses an empty name', async () => {
    const { session } = await setup('b1');
    commit(screen.getByRole('textbox', { name: 'Nome' }), 'Apertura');
    expect(blocks(session)[0]!.name).toBe('Apertura');
    commit(screen.getByRole('textbox', { name: 'Nome' }), '   ');
    expect(blocks(session)[0]!.name).toBe('Apertura');
    expect((screen.getByRole('textbox', { name: 'Nome' }) as HTMLInputElement).value).toBe('Apertura');
  });

  it('accepts a valid duration (snapped to 5 s) and flags an invalid one without editing', async () => {
    const { session } = await setup('b3');
    commit(screen.getByRole('textbox', { name: 'Durata' }), '3:02');
    expect(blocks(session)[3]!.durationMs).toBe(180_000);
    commit(screen.getByRole('textbox', { name: 'Durata' }), '12:75');
    expect(screen.getByRole('textbox', { name: 'Durata' }).getAttribute('aria-invalid')).toBe('true');
    expect(screen.getByText('Durata non valida (es. 12:30)')).toBeTruthy();
    expect(blocks(session)[3]!.durationMs).toBe(180_000);
  });

  it('toggles elastic and changes the scene group', async () => {
    const { session } = await setup('b1', (f) => f.sceneGroups.push({ id: 'ospiti', name: 'Ospiti', scenes: ['CAM 4'] }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Elastico' }));
    expect(blocks(session)[0]!.elastic).toBe(false);
    fireEvent.change(screen.getByRole('combobox', { name: 'Gruppo di scene' }), { target: { value: 'ospiti' } });
    expect(blocks(session)[0]!.sceneGroupId).toBe('ospiti');
  });

  it('converts a studio block to a break and back', async () => {
    const { session } = await setup('b3');
    fireEvent.change(screen.getByRole('combobox', { name: 'Tipo' }), { target: { value: 'break' } });
    expect(blocks(session)[3]).toMatchObject({ id: 'b3', kind: 'break', scene: 'BREAK' });
    expect(await screen.findByRole('textbox', { name: 'Scena del break' })).toBeTruthy();
    fireEvent.change(screen.getByRole('combobox', { name: 'Tipo' }), { target: { value: 'studio' } });
    expect(blocks(session)[3]!.kind).toBe('studio');
  });

  it('edits a break scene and clears its optional media input', async () => {
    const { session } = await setup('br1');
    commit(screen.getByRole('textbox', { name: 'Scena del break' }), 'PAUSA');
    commit(screen.getByRole('textbox', { name: 'Sorgente media del break (facoltativa)' }), '');
    expect(blocks(session)[1]).toMatchObject({ scene: 'PAUSA', mediaInput: null });
  });

  it('offers the OBS scenes in a datalist when OBS is connected', async () => {
    await setup('br1');
    const list = document.querySelector('datalist')!;
    expect([...list.querySelectorAll('option')].map((o) => o.getAttribute('value'))).toContain('PLAYOUT');
  });

  it('warns when the studio time is under the threshold and errors when media exceed the block', async () => {
    const { session } = await setup('b3');
    commit(screen.getByRole('textbox', { name: 'Durata' }), '1:30'); // 90 s, no media: 90 s >= 60 s threshold
    expect(screen.getByTestId('studio-time').className).not.toMatch(/is-warn|is-error/);
    commit(screen.getByRole('textbox', { name: 'Durata' }), '0:30');
    expect(screen.getByTestId('studio-time').className).toContain('is-warn');
    expect(screen.getByTestId('studio-time').textContent).toContain('sotto la soglia di 1:00');
    session.selection.select('b1');
    commit(await screen.findByRole('textbox', { name: 'Durata' }), '2:00'); // 120 s block with 180 s media
    expect(screen.getByTestId('studio-time').className).toContain('is-error');
    expect(screen.getByText(/I servizi superano il blocco di 1:00/)).toBeTruthy();
  });

  it('disables everything when the episode is live', async () => {
    const api = new FakeEditorApi();
    api.live = { episodeId: 'ep-2026-10-12', phase: 'live' };
    api.episodes.set('ep-2026-10-12', sampleEpisode());
    await renderWithSession(<PropertiesPanel />, { open: { kind: 'episode', id: 'ep-2026-10-12' }, api });
    expect((screen.getByRole('textbox', { name: 'Nome' }) as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByRole('checkbox', { name: 'Elastico' }) as HTMLInputElement).disabled).toBe(true);
  });
});

describe('elements', () => {
  it('lists the elements with their origin and duration', async () => {
    await setup('b1', (f) => {
      const b = f.blocks[0] as StudioBlock;
      b.elements[1] = { ...(b.elements[1] as object), durationSource: 'deck' } as never;
    });
    const list = screen.getByRole('list', { name: 'Elementi' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(3);
    expect(within(screen.getByTestId('el-b1-s1')).getByText('Parte studio')).toBeTruthy();
    expect((screen.getByRole('textbox', { name: 'Titolo 2' }) as HTMLInputElement).value).toBe('Servizio 1');
    expect((screen.getByRole('textbox', { name: 'Durata 2' }) as HTMLInputElement).value).toBe('3:00');
    expect(screen.getByTestId('origin-b1-m1').textContent).toBe('DECK');
  });

  it('shows an unknown duration as a dash with a warning badge, never 0:00', async () => {
    await setup('b1', (f) => {
      const b = f.blocks[0] as StudioBlock;
      b.elements[1] = { ...(b.elements[1] as object), plannedDurationMs: 0, durationSource: 'unknown' } as never;
    });
    const input = screen.getByRole('textbox', { name: 'Durata 2' }) as HTMLInputElement;
    expect(input.value).toBe('');
    expect(input.placeholder).toBe('—');
    expect(screen.getByTestId('origin-b1-m1').textContent).toBe('DURATA IGNOTA');
    expect(screen.getByTestId('origin-b1-m1').className).toContain('is-warn');
  });

  it('a typed duration becomes MANUALE and moves the studio time', async () => {
    const { session } = await setup('b1');
    commit(screen.getByRole('textbox', { name: 'Durata 2' }), '4:00');
    expect(blocks(session)[0]!.elements[1]).toMatchObject({ plannedDurationMs: 240_000, durationSource: 'manual' });
    expect(screen.getByTestId('origin-b1-m1').textContent).toBe('MANUALE');
    expect(screen.getByTestId('studio-time').textContent).toBe('Tempo studio: 8:00');
  });

  it('removes, moves, and keeps the last element', async () => {
    const { session } = await setup('b1');
    fireEvent.click(screen.getByRole('button', { name: 'Giù 1' }));
    expect(blocks(session)[0]!.elements.map((e: { id: string }) => e.id)).toEqual(['b1-m1', 'b1-s1', 'b1-s2']);
    fireEvent.click(screen.getByRole('button', { name: 'Rimuovi 1' }));
    expect(blocks(session)[0]!.elements).toHaveLength(2);
    session.selection.select('b3');
    const only = await screen.findByRole('button', { name: 'Rimuovi 1' });
    expect((only as HTMLButtonElement).disabled).toBe(true);
    expect(only.getAttribute('title')).toBe('Un blocco studio ha almeno un elemento');
  });

  it('adds a studio part and a manual item with the next occurrence of its path', async () => {
    const { session, user } = await setup('b3');
    fireEvent.click(screen.getByRole('button', { name: 'Aggiungi parte studio' }));
    expect(blocks(session)[3]!.elements).toHaveLength(2);
    await user.click(screen.getByRole('button', { name: 'Aggiungi servizio' }));
    await user.type(screen.getByRole('textbox', { name: 'Titolo servizio' }), 'Ripetuto');
    await user.type(screen.getByRole('textbox', { name: 'Percorso file' }), 'D:/media/servizio1.mp4');
    await user.type(screen.getByRole('textbox', { name: 'Durata servizio' }), '0:45');
    await user.click(screen.getByRole('button', { name: 'Aggiungi' }));
    expect(blocks(session)[3]!.elements.at(-1)).toMatchObject({
      kind: 'media', title: 'Ripetuto', path: 'D:/media/servizio1.mp4', occurrence: 1, plannedDurationMs: 45_000, durationSource: 'manual',
    });
  });

  it('an item added without a duration is unknown, not zero', async () => {
    const { session, user } = await setup('b3');
    await user.click(screen.getByRole('button', { name: 'Aggiungi servizio' }));
    await user.type(screen.getByRole('textbox', { name: 'Titolo servizio' }), 'Senza');
    await user.type(screen.getByRole('textbox', { name: 'Percorso file' }), 'D:/x.mp4');
    await user.click(screen.getByRole('button', { name: 'Aggiungi' }));
    expect(blocks(session)[3]!.elements.at(-1)).toMatchObject({ plannedDurationMs: 0, durationSource: 'unknown' });
  });
});
