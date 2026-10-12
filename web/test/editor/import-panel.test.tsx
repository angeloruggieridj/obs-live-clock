// SPDX-License-Identifier: GPL-2.0-or-later
import { act, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { EditorDoc } from '../../src/editor/api/editor-api';
import { ImportPanel } from '../../src/editor/import/ImportPanel';
import { convertBlock } from '../../src/editor/model/ops';
import { FakeEditorApi, renderWithSession, sampleEpisode } from '../support/editor';

const FORMAT = { kind: 'format', id: 'solo-futsal' } as const;
const media = (s: { store: { getSnapshot(): { doc: any } } }, blockId: string) =>
  s.store.getSnapshot().doc.blocks.find((b: { id: string }) => b.id === blockId).elements.filter((e: { kind: string }) => e.kind === 'media');

const DECK = {
  state: 'ok' as const,
  items: [
    { index: 0, path: 'D:/media/nuovo1.mp4', title: 'Nuovo 1', durationMs: 90_000, occurrence: 0 },
    { index: 1, path: 'D:/media/ignoto.mp4', title: 'Ignoto', durationMs: -1, occurrence: 0 },
  ],
};

async function setup(prepare?: (api: FakeEditorApi) => void, select: string | null = 'b3') {
  const api = new FakeEditorApi();
  prepare?.(api);
  const r = await renderWithSession(<ImportPanel />, { open: FORMAT, api });
  r.session.selection.select(select);
  return r;
}

describe('deck source', () => {
  it.each([
    ['obs_not_connected', 'OBS non connesso'],
    ['deck_absent', 'Playlist Deck non installato'],
    ['deck_not_ready', 'Playlist Deck non ancora pronto: riprova'],
  ] as const)('explains %s', async (reason, text) => {
    const { user } = await setup((a) => {
      a.deck = { state: 'unavailable', reason };
    });
    await user.click(screen.getByRole('button', { name: 'Leggi playlist' }));
    expect((await screen.findByRole('status')).textContent).toContain(text);
  });

  it('previews the deck items with origin and an unknown duration shown as a dash', async () => {
    const { user } = await setup((a) => {
      a.deck = DECK;
    });
    await user.click(screen.getByRole('button', { name: 'Leggi playlist' }));
    expect(await screen.findByText('2 servizi trovati')).toBeTruthy();
    expect(within(screen.getByTestId('imp-row-0')).getByText('1:30')).toBeTruthy();
    expect(within(screen.getByTestId('imp-row-0')).getByText('DECK')).toBeTruthy();
    const unknown = screen.getByTestId('imp-row-1');
    expect(within(unknown).getByText('—')).toBeTruthy();
    expect(within(unknown).getByText('Durata ignota: da inserire a mano')).toBeTruthy();
  });

  it('imports into the chosen block as media with their origin, one undo step', async () => {
    const { session, user } = await setup((a) => {
      a.deck = DECK;
    });
    await user.click(screen.getByRole('button', { name: 'Leggi playlist' }));
    await user.click(await screen.findByRole('button', { name: 'Importa 2 servizi' }));
    const added = media(session, 'b3');
    expect(added.map((e: { title: string }) => e.title)).toEqual(['Nuovo 1', 'Ignoto']);
    expect(added[0]).toMatchObject({ plannedDurationMs: 90_000, durationSource: 'deck', occurrence: 0 });
    expect(added[1]).toMatchObject({ plannedDurationMs: 0, durationSource: 'unknown' });
    expect(screen.getByTestId('imp-result').textContent).toBe('Aggiunti 2 · già presenti 0 · senza durata 1');
    session.undo();
    expect(media(session, 'b3')).toHaveLength(0);
  });

  it('a second click adds nothing (importing twice must not duplicate)', async () => {
    const { session, user } = await setup((a) => {
      a.deck = DECK;
    });
    await user.click(screen.getByRole('button', { name: 'Leggi playlist' }));
    const button = await screen.findByRole('button', { name: 'Importa 2 servizi' });
    await user.click(button);
    await user.click(button);
    expect(media(session, 'b3')).toHaveLength(2);
    expect(screen.getByTestId('imp-result').textContent).toBe('Nessun servizio nuovo: tutti già presenti');
  });

  it('defaults the target to the selected studio block and can distribute in sequence', async () => {
    const { session, user } = await setup((a) => {
      a.deck = { state: 'ok', items: [{ index: 0, path: 'D:/m/a.mp4', title: 'A', durationMs: 400_000, occurrence: 0 }, { index: 1, path: 'D:/m/b.mp4', title: 'B', durationMs: 400_000, occurrence: 0 }] };
    }, 'b2');
    expect((screen.getByRole('combobox', { name: 'Blocco di destinazione' }) as HTMLSelectElement).value).toBe('b2');
    await user.click(screen.getByRole('button', { name: 'Leggi playlist' }));
    await user.click(await screen.findByRole('radio', { name: 'Distribuisci nei blocchi studio' }));
    await user.click(screen.getByRole('button', { name: 'Importa 2 servizi' }));
    expect(media(session, 'b1').map((e: { title: string }) => e.title)).toEqual(['Servizio 1', 'A']);
    expect(media(session, 'b2').map((e: { title: string }) => e.title)).toEqual(['Servizio 2', 'B']);
  });

  it('reports a deck with no items instead of appearing to do nothing', async () => {
    const { user } = await setup((a) => {
      a.deck = { state: 'ok', items: [] };
    });
    await user.click(screen.getByRole('button', { name: 'Leggi playlist' }));
    expect(await screen.findByText('0 servizi trovati')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Importa/ })).toBeNull();
  });

  it('falls back to a valid studio block when the chosen target is no longer one (never claims nothing was added)', async () => {
    const { session, user } = await setup((a) => {
      a.deck = DECK;
    });
    await user.selectOptions(screen.getByRole('combobox', { name: 'Blocco di destinazione' }), 'b2');
    await user.click(screen.getByRole('button', { name: 'Leggi playlist' }));
    expect(await screen.findByText('2 servizi trovati')).toBeTruthy();
    // b2 stops being a studio block while the panel stays open (timeline edit, another tab).
    await act(async () => {
      session.apply(convertBlock<EditorDoc>('b2', 'break'));
    });
    expect(session.store.getSnapshot().doc?.blocks.find((b) => b.id === 'b2')?.kind).toBe('break');
    await user.click(screen.getByRole('button', { name: 'Importa 2 servizi' }));
    expect(screen.getByTestId('imp-result').textContent).toBe('Aggiunti 2 · già presenti 0 · senza durata 1');
    expect(media(session, 'b3').map((e: { title: string }) => e.title)).toEqual(['Nuovo 1', 'Ignoto']);
  });
});

describe('file source', () => {
  const file = (text: string, name: string) => new File([text], name, { type: 'text/plain' });

  it('reads a JSON export, flags relative paths and skipped rows, and imports with the FILE origin', async () => {
    const json = JSON.stringify({ version: 1, name: 'P', items: [{ path: 'D:/m/a.mp4', title: 'A', duration: 61000 }, { path: 'rel/b.mp4', title: 'B', duration: -1 }, { title: 'senza percorso' }] });
    const { session, user } = await setup();
    await user.upload(screen.getByLabelText('Scegli file playlist'), file(json, 'p.json'));
    expect(await screen.findByText('2 servizi trovati')).toBeTruthy();
    expect(within(screen.getByTestId('imp-row-0')).getByText('FILE')).toBeTruthy();
    expect(within(screen.getByTestId('imp-row-1')).getByText(/percorso relativo/)).toBeTruthy();
    expect(screen.getByText('1 righe senza percorso ignorate')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Importa 2 servizi' }));
    expect(media(session, 'b3')[0]).toMatchObject({ path: 'D:/m/a.mp4', plannedDurationMs: 61_000, durationSource: 'file' });
    expect(media(session, 'b3')[1]).toMatchObject({ durationSource: 'unknown' });
  });

  it('marks M3U durations as whole seconds', async () => {
    const { user } = await setup();
    await user.upload(screen.getByLabelText('Scegli file playlist'), file('#EXTM3U\n#EXTINF:185,Servizio\nD:\\m\\s.mp4\n', 'p.m3u'));
    expect(within(await screen.findByTestId('imp-row-0')).getByText('FILE (s)')).toBeTruthy();
    expect(within(screen.getByTestId('imp-row-0')).getByText('3:05')).toBeTruthy();
  });

  it('numbers repeated paths with their occurrence', async () => {
    const csv = 'title,path,duration_ms\nUno,D:/m/x.mp4,1000\nDue,D:/m/x.mp4,2000\n';
    const { session, user } = await setup();
    await user.upload(screen.getByLabelText('Scegli file playlist'), file(csv, 'p.csv'));
    await user.click(await screen.findByRole('button', { name: 'Importa 2 servizi' }));
    expect(media(session, 'b3').map((e: { occurrence: number }) => e.occurrence)).toEqual([0, 1]);
  });

  it.each([
    ['', 'p.json', 'File vuoto'],
    ['{"a":1}', 'p.json', 'Formato non riconosciuto (JSON, CSV o M3U)'],
    ['{"items":[]}', 'p.json', 'Nessun servizio nel file'],
  ])('reports an unusable file %j', async (text, name, message) => {
    const { user } = await setup();
    await user.upload(screen.getByLabelText('Scegli file playlist'), file(text, name));
    expect((await screen.findByRole('status')).textContent).toContain(message);
    expect(screen.queryByRole('button', { name: /^Importa/ })).toBeNull();
  });

  it('lets the same file be chosen again (the input is cleared after a read)', async () => {
    const { user } = await setup();
    const input = screen.getByLabelText('Scegli file playlist');
    let reads = 0;
    input.addEventListener('change', () => {
      reads += 1;
    });
    const f = file(JSON.stringify({ version: 1, name: 'P', items: [{ path: 'D:/m/a.mp4', title: 'A', duration: 1000 }] }), 'p.json');
    await user.upload(input, f);
    await user.upload(input, f);
    expect(reads).toBe(2);
  });
});

describe('guards', () => {
  it('is disabled for a live episode', async () => {
    const api = new FakeEditorApi();
    api.live = { episodeId: 'ep-2026-10-12', phase: 'live' };
    api.deck = DECK;
    api.episodes.set('ep-2026-10-12', sampleEpisode());
    await renderWithSession(<ImportPanel />, { open: { kind: 'episode', id: 'ep-2026-10-12' }, api });
    expect((screen.getByLabelText('Scegli file playlist') as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Leggi playlist' }) as HTMLButtonElement).disabled).toBe(true);
  });
});
