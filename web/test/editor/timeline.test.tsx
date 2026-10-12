// SPDX-License-Identifier: GPL-2.0-or-later
import { fireEvent, screen, within } from '@testing-library/react';
import { beforeAll, describe, expect, it } from 'vitest';
import { TimelinePanel } from '../../src/editor/timeline/TimelinePanel';
import { FakeEditorApi, renderWithSession, sampleFormat } from '../support/editor';

beforeAll(() => {
  // jsdom without PointerEvent: a MouseEvent carries clientX/clientY, which is all the gestures read.
  (window as unknown as { PointerEvent?: unknown }).PointerEvent ??= MouseEvent;
});

const FORMAT = { kind: 'format', id: 'solo-futsal' } as const;
const EPISODE = { kind: 'episode', id: 'ep-2026-10-12' } as const;
const ids = (s: { store: { getSnapshot(): { doc: { blocks: Array<{ id: string }> } | null } } }) => s.store.getSnapshot().doc!.blocks.map((b) => b.id);
const block = (id: string) => screen.getByTestId(`block-${id}`);

async function setup(open = FORMAT as typeof FORMAT | typeof EPISODE) {
  const r = await renderWithSession(<TimelinePanel widthPx={1000} timeZone="UTC" />, { open });
  return r;
}

describe('TimelinePanel rendering', () => {
  it('shows every block with its name, duration, studio time and kind', async () => {
    await setup();
    expect(block('b1').getAttribute('aria-label')).toBe('Blocco 1: Primo blocco, 12:00');
    expect(within(block('b1')).getByText('Studio 9:00')).toBeTruthy();
    expect(within(block('b1')).getByText('1 servizi')).toBeTruthy();
    expect(within(block('br1')).getByText('BREAK')).toBeTruthy();
    expect(within(block('b3')).getByText('Studio 2:00')).toBeTruthy();
  });

  it('shows total duration, and the planned end only for an episode', async () => {
    const f = await setup(FORMAT);
    expect(screen.getByText('Durata totale 27:00')).toBeTruthy();
    expect(screen.queryByText(/Fine prevista/)).toBeNull();
    f.unmount();
    await setup(EPISODE);
    expect(screen.getByText('Fine prevista 17:27:00')).toBeTruthy(); // 19:00+02:00 + 27 min, in UTC
  });

  it('flags a block whose media exceed it and one with unknown media', async () => {
    const api = new FakeEditorApi();
    const f = sampleFormat();
    (f.blocks[0] as { elements: Array<Record<string, unknown>> }).elements[1] = {
      id: 'b1-m1', kind: 'media', title: 'S', path: 'x', occurrence: 0, plannedDurationMs: 800_000, durationSource: 'unknown',
    };
    api.formats.set('solo-futsal', f);
    await renderWithSession(<TimelinePanel widthPx={1000} />, { open: FORMAT, api });
    expect(within(block('b1')).getByText(/media oltre il blocco/)).toBeTruthy();
    expect(within(block('b1')).getByText('1 senza durata')).toBeTruthy();
  });

  it('shows an empty state', async () => {
    const api = new FakeEditorApi();
    const f = sampleFormat();
    f.blocks = [];
    api.formats.set('solo-futsal', f);
    await renderWithSession(<TimelinePanel widthPx={1000} />, { open: FORMAT, api });
    expect(screen.getByText('Nessun blocco: aggiungine uno')).toBeTruthy();
  });

  it('shows read-only mode for a live episode', async () => {
    const api = new FakeEditorApi();
    api.live = { episodeId: 'ep-2026-10-12', phase: 'live' };
    await renderWithSession(<TimelinePanel widthPx={1000} />, { open: EPISODE, api });
    expect(screen.getByText('Sola lettura')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Aggiungi studio' }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('selection and keyboard', () => {
  it('selects on click and moves the selection with the arrows', async () => {
    const { user } = await setup();
    await user.click(block('b2'));
    expect(block('b2').getAttribute('aria-current')).toBe('true');
    block('b2').focus();
    await user.keyboard('{ArrowLeft}');
    expect(block('br1').getAttribute('aria-current')).toBe('true');
  });

  it('Alt+Arrow moves the block to the next index', async () => {
    const { session, user } = await setup();
    block('b1').focus();
    await user.keyboard('{Alt>}{ArrowRight}{/Alt}');
    expect(ids(session)).toEqual(['br1', 'b1', 'b2', 'b3']);
  });

  it('Shift+Arrow resizes by 5 s and Ctrl+Shift+Arrow by 1 min; undo reverts the last key press', async () => {
    const { session, user } = await setup();
    block('b3').focus();
    await user.keyboard('{Shift>}{ArrowRight}{ArrowRight}{/Shift}');
    expect(session.store.getSnapshot().doc!.blocks[3]!.durationMs).toBe(130_000);
    await user.keyboard('{Control>}{Shift>}{ArrowLeft}{/Shift}{/Control}');
    expect(session.store.getSnapshot().doc!.blocks[3]!.durationMs).toBe(70_000);
    session.undo();
    expect(session.store.getSnapshot().doc!.blocks[3]!.durationMs).toBe(130_000);
  });

  it('Delete removes the block and Ctrl+D duplicates it; undo brings it back', async () => {
    const { session, user } = await setup();
    block('br1').focus();
    await user.keyboard('{Delete}');
    expect(ids(session)).toEqual(['b1', 'b2', 'b3']);
    session.undo();
    expect(ids(session)).toEqual(['b1', 'br1', 'b2', 'b3']);
    block('b3').focus();
    await user.keyboard('{Control>}d{/Control}');
    expect(ids(session)).toEqual(['b1', 'br1', 'b2', 'b3', 'blk-1']);
    expect(session.store.getSnapshot().doc!.blocks[4]!.name).toBe('Chiusura (copia)');
  });
});

describe('pointer gestures', () => {
  // 1000 px for 1 620 s => 0.000617 px/ms: b1 444 px, br1 111, b2 370, b3 74.
  it('dragging a block past the next one reorders (same result as the keyboard)', async () => {
    const { session } = await setup();
    const b1 = block('b1');
    fireEvent.pointerDown(b1, { clientX: 100, clientY: 5, pointerId: 1, button: 0, isPrimary: true });
    fireEvent.pointerMove(b1, { clientX: 400, clientY: 5, pointerId: 1, isPrimary: true });
    expect(screen.getByTestId('drop-marker').getAttribute('data-index')).toBe('1');
    fireEvent.pointerUp(b1, { clientX: 400, clientY: 5, pointerId: 1, isPrimary: true });
    expect(ids(session)).toEqual(['br1', 'b1', 'b2', 'b3']);
  });

  it('a small movement is a click, not a drag', async () => {
    const { session } = await setup();
    const b2 = block('b2');
    fireEvent.pointerDown(b2, { clientX: 600, clientY: 5, pointerId: 1, button: 0, isPrimary: true });
    fireEvent.pointerMove(b2, { clientX: 602, clientY: 5, pointerId: 1, isPrimary: true });
    fireEvent.pointerUp(b2, { clientX: 602, clientY: 5, pointerId: 1, isPrimary: true });
    expect(ids(session)).toEqual(['b1', 'br1', 'b2', 'b3']);
    expect(b2.getAttribute('aria-current')).toBe('true');
  });

  it('Escape aborts a drag', async () => {
    const { session } = await setup();
    const b1 = block('b1');
    fireEvent.pointerDown(b1, { clientX: 100, clientY: 5, pointerId: 1, button: 0, isPrimary: true });
    fireEvent.pointerMove(b1, { clientX: 400, clientY: 5, pointerId: 1, isPrimary: true });
    fireEvent.keyDown(b1, { key: 'Escape' });
    fireEvent.pointerUp(b1, { clientX: 400, clientY: 5, pointerId: 1, isPrimary: true });
    expect(ids(session)).toEqual(['b1', 'br1', 'b2', 'b3']);
  });

  it('dragging the handle resizes with a 5 s snap, as one undo step', async () => {
    const { session } = await setup();
    const handle = screen.getByTestId('resize-b1');
    fireEvent.pointerDown(handle, { clientX: 444, clientY: 5, pointerId: 1, button: 0, isPrimary: true });
    for (const x of [470, 490, 506]) fireEvent.pointerMove(handle, { clientX: x, clientY: 5, pointerId: 1, isPrimary: true });
    fireEvent.pointerUp(handle, { clientX: 506, clientY: 5, pointerId: 1, isPrimary: true });
    expect(session.store.getSnapshot().doc!.blocks[0]!.durationMs).toBe(820_000); // +62 px = +100.4 s -> snapped
    session.undo();
    expect(session.store.getSnapshot().doc!.blocks[0]!.durationMs).toBe(720_000);
  });

  it('ignores gestures when read-only', async () => {
    const api = new FakeEditorApi();
    api.live = { episodeId: 'ep-2026-10-12', phase: 'live' };
    const { session } = await renderWithSession(<TimelinePanel widthPx={1000} />, { open: EPISODE, api });
    const b1 = block('b1');
    fireEvent.pointerDown(b1, { clientX: 100, clientY: 5, pointerId: 1, button: 0, isPrimary: true });
    fireEvent.pointerMove(b1, { clientX: 400, clientY: 5, pointerId: 1, isPrimary: true });
    fireEvent.pointerUp(b1, { clientX: 400, clientY: 5, pointerId: 1, isPrimary: true });
    expect(ids(session)).toEqual(['b1', 'br1', 'b2', 'b3']);
  });
});

describe('toolbar', () => {
  it('adds a studio block after the selection and selects it', async () => {
    const { session, user } = await setup();
    await user.click(block('b1'));
    await user.click(screen.getByRole('button', { name: 'Aggiungi studio' }));
    expect(ids(session)).toEqual(['b1', 'blk-1', 'br1', 'b2', 'b3']);
    expect(session.selection.getSnapshot().blockId).toBe('blk-1');
    expect(session.store.getSnapshot().doc!.blocks[1]!.name).toBe('Blocco 5');
  });

  it('adds a break at the end when nothing is selected', async () => {
    const { session, user } = await setup();
    session.selection.select(null);
    await user.click(screen.getByRole('button', { name: 'Aggiungi break' }));
    expect(session.store.getSnapshot().doc!.blocks.at(-1)).toMatchObject({ kind: 'break', name: 'Break 5' });
  });

  it('splits the selected studio block in two halves, and not a break', async () => {
    const { session, user } = await setup();
    await user.click(block('b2'));
    await user.click(screen.getByRole('button', { name: 'Dividi' }));
    expect(session.store.getSnapshot().doc!.blocks.slice(2, 4).map((b) => b.durationMs)).toEqual([300_000, 300_000]);
    await user.click(block('br1'));
    expect((screen.getByRole('button', { name: 'Dividi' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('click-to-focus: a reveal request focuses the block', async () => {
    const { session } = await setup();
    session.selection.select('b3', { reveal: true });
    await screen.findByTestId('block-b3');
    expect(document.activeElement).toBe(block('b3'));
  });
});
