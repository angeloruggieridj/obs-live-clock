// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import { ApiError } from '../../src/core/http';
import { moveBlock, renameDoc } from '../../src/editor/model/ops';
import { EditorSession, stableStringify } from '../../src/editor/session/session';
import { FakeEditorApi, sampleEpisode, sampleFormat } from '../support/editor';
import { fakeTimers } from '../support/fake-timers';

function setup(live?: FakeEditorApi['live']) {
  const api = new FakeEditorApi();
  api.formats.set('solo-futsal', sampleFormat());
  api.episodes.set('ep-2026-10-12', sampleEpisode());
  if (live !== undefined) api.live = live;
  const time = fakeTimers();
  const session = new EditorSession(api, time.timers);
  return { api, time, session };
}
const FORMAT = { kind: 'format', id: 'solo-futsal' } as const;
const EPISODE = { kind: 'episode', id: 'ep-2026-10-12' } as const;

describe('open', () => {
  it('loads the document, selects the first block and is clean', async () => {
    const { session } = setup();
    expect(await session.open(FORMAT)).toBe(true);
    expect(session.getSnapshot()).toMatchObject({ phase: 'ready', lock: null, ref: FORMAT });
    expect(session.store.getSnapshot().doc?.id).toBe('solo-futsal');
    expect(session.selection.getSnapshot().blockId).toBe('b1');
    expect(session.autosave.getState().kind).toBe('clean');
  });

  it('reports a missing document', async () => {
    const { session } = setup();
    expect(await session.open({ kind: 'format', id: 'nope' })).toBe(false);
    expect(session.getSnapshot()).toMatchObject({ phase: 'error', error: 'not_found' });
  });

  it('a live episode opens read-only with the live lock', async () => {
    const { session } = setup({ episodeId: 'ep-2026-10-12', phase: 'live' });
    await session.open(EPISODE);
    expect(session.getSnapshot().lock).toBe('live');
    expect(session.store.getSnapshot().readOnly).toBe(true);
    expect(session.apply(renameDoc('x'))).toBe(false);
  });

  it('a loaded episode that is only in preshow stays editable', async () => {
    const { session } = setup({ episodeId: 'ep-2026-10-12', phase: 'preshow' });
    await session.open(EPISODE);
    expect(session.getSnapshot().lock).toBeNull();
    expect(session.apply(renameDoc('Nuovo nome'))).toBe(true);
  });

  it('the answer of an older open() is ignored when a newer one started', async () => {
    const { api, session } = setup();
    const release = api.hold('getDoc');
    const first = session.open(FORMAT);
    await Promise.resolve();
    const second = session.open(EPISODE, { discard: true });
    release();
    await Promise.all([first, second]);
    expect(session.getSnapshot().ref).toEqual(EPISODE);
    expect(session.store.getSnapshot().doc?.id).toBe('ep-2026-10-12');
  });

  it('an edit during a slow open still saves the document on screen, not the one loading', async () => {
    const { api, time, session } = setup();
    await session.open(FORMAT);
    const episodeName = api.episodes.get('ep-2026-10-12')!.name;
    const release = api.hold('getDoc');
    const opening = session.open(EPISODE);
    await time.advance(0); // reach the held getDoc
    expect(session.getSnapshot()).toMatchObject({ phase: 'loading', ref: FORMAT });
    session.apply(renameDoc('Editato durante il caricamento'));
    await time.advance(900);
    expect(api.count('putDoc')).toBe(1);
    expect(api.formats.get('solo-futsal')!.name).toBe('Editato durante il caricamento');
    expect(api.episodes.get('ep-2026-10-12')!.name).toBe(episodeName);
    release();
    expect(await opening).toBe(true);
    expect(session.getSnapshot().ref).toEqual(EPISODE);
  });

  it('a failed open keeps the previous document addressed and writable', async () => {
    const { api, time, session } = setup();
    await session.open(FORMAT);
    expect(await session.open({ kind: 'format', id: 'nope' })).toBe(false);
    expect(session.getSnapshot()).toMatchObject({ phase: 'error', error: 'not_found', ref: FORMAT });
    expect(session.store.getSnapshot().doc?.id).toBe('solo-futsal');
    session.apply(renameDoc('Nuovo nome'));
    await time.advance(900);
    expect(api.formats.get('solo-futsal')!.name).toBe('Nuovo nome');
  });
});

describe('autosave through the session', () => {
  it('saves the edited document to the server and ends clean', async () => {
    const { api, time, session } = setup();
    await session.open(FORMAT);
    session.apply(moveBlock(0, 2));
    await time.advance(900);
    expect(api.formats.get('solo-futsal')!.blocks.map((b) => b.id)).toEqual(['br1', 'b2', 'b1', 'b3']);
    expect(session.autosave.getState().kind).toBe('clean');
  });

  it('an edit after a save is its own undo step, so undo returns the saved name', async () => {
    const { api, time, session } = setup();
    await session.open(FORMAT);
    session.apply(renameDoc('A'));
    await time.advance(900); // the save starts and ends the coalescing run
    expect(api.formats.get('solo-futsal')!.name).toBe('A');
    session.apply(renameDoc('B'));
    session.undo();
    expect(session.store.getSnapshot().doc?.name).toBe('A');
  });

  it('shows the failure, retries, and the server ends equal to the screen', async () => {
    const { api, time, session } = setup();
    await session.open(FORMAT);
    api.failNext('putDoc', new TypeError('fetch failed'));
    session.apply(renameDoc('Nuovo nome'));
    await time.advance(900);
    expect(session.autosave.getState()).toMatchObject({ kind: 'error', code: 'network' });
    expect(api.formats.get('solo-futsal')!.name).toBe('Solo Futsal');
    await time.advance(1_000);
    expect(session.autosave.getState().kind).toBe('clean');
    expect(api.formats.get('solo-futsal')!.name).toBe('Nuovo nome');
  });

  it('undo after a failed save: the retry carries the undone document', async () => {
    const { api, time, session } = setup();
    await session.open(FORMAT);
    api.failNext('putDoc', new ApiError(500, 'internal'));
    session.apply(renameDoc('Nuovo nome'));
    await time.advance(900);
    expect(session.autosave.getState().kind).toBe('error');
    session.undo();
    await time.advance(1_000);
    expect(api.formats.get('solo-futsal')!.name).toBe('Solo Futsal');
    expect(session.store.getSnapshot().doc?.name).toBe('Solo Futsal');
  });

  it('a 409 episode_live on save locks the session', async () => {
    const { api, time, session } = setup({ episodeId: null, phase: null });
    await session.open(EPISODE);
    api.live = { episodeId: 'ep-2026-10-12', phase: 'live' }; // went live in another tab after we opened it
    session.apply(renameDoc('Nuovo nome'));
    await time.advance(900);
    expect(session.getSnapshot().lock).toBe('live');
    expect(session.store.getSnapshot().readOnly).toBe(true);
  });

  it('refreshLive() locks an open episode that went on air', async () => {
    const { api, session } = setup();
    await session.open(EPISODE);
    api.live = { episodeId: 'ep-2026-10-12', phase: 'live' };
    await session.refreshLive();
    expect(session.getSnapshot().lock).toBe('live');
    expect(session.store.getSnapshot().readOnly).toBe(true);
  });
});

describe('switching documents never drops edits', () => {
  it('flushes pending edits before opening another document', async () => {
    const { api, session } = setup();
    await session.open(FORMAT);
    session.apply(renameDoc('Nuovo nome'));
    expect(await session.open(EPISODE)).toBe(true);
    expect(api.formats.get('solo-futsal')!.name).toBe('Nuovo nome');
  });

  it('refuses to switch while the save keeps failing, and discard overrides on purpose', async () => {
    const { api, session } = setup();
    await session.open(FORMAT);
    api.failNext('putDoc', new TypeError('down'));
    session.apply(renameDoc('Nuovo nome'));
    expect(await session.open(EPISODE)).toBe(false);
    expect(session.getSnapshot()).toMatchObject({ blocked: true, ref: FORMAT });
    expect(session.store.getSnapshot().doc?.name).toBe('Nuovo nome');
    expect(await session.open(EPISODE, { discard: true })).toBe(true);
    expect(session.getSnapshot().blocked).toBe(false);
  });

  it('keeps the backoff retry alive when a switch is refused while the save is in error', async () => {
    const { api, time, session } = setup();
    await session.open(FORMAT);
    api.failNext('putDoc', new TypeError('down'));
    session.apply(renameDoc('Nuovo nome'));
    await time.advance(900); // the save fails once: error, backoff armed
    expect(session.autosave.getState()).toMatchObject({ kind: 'error', code: 'network' });
    expect(await session.open(EPISODE)).toBe(false); // refused: flush() must not cancel the pending retry
    expect(session.getSnapshot()).toMatchObject({ blocked: true, ref: FORMAT });
    await time.advance(1_000); // the still-armed retry runs and succeeds
    expect(session.autosave.getState().kind).toBe('clean');
    expect(api.formats.get('solo-futsal')!.name).toBe('Nuovo nome');
  });
});

describe('loadForLive', () => {
  it('saves the open episode first, then loads it', async () => {
    const { api, session } = setup();
    await session.open(EPISODE);
    session.apply(renameDoc('Nuovo nome'));
    expect(await session.loadForLive('ep-2026-10-12')).toEqual({ ok: true });
    expect(api.episodes.get('ep-2026-10-12')!.name).toBe('Nuovo nome');
    expect(api.live).toEqual({ episodeId: 'ep-2026-10-12', phase: 'preshow' });
    expect(session.getSnapshot().live?.episodeId).toBe('ep-2026-10-12');
  });

  it('loads nothing when the open episode cannot be saved', async () => {
    const { api, session } = setup();
    await session.open(EPISODE);
    api.failNext('putDoc', new TypeError('down'));
    session.apply(renameDoc('Nuovo nome'));
    expect(await session.loadForLive('ep-2026-10-12')).toEqual({ ok: false, reason: 'unsaved' });
    expect(api.count('loadLive')).toBe(0);
  });

  it('returns the server issues when the rundown has errors', async () => {
    const { api, session } = setup();
    const ep = api.episodes.get('ep-2026-10-12')!;
    (ep.blocks[0] as { elements: Array<{ plannedDurationMs?: number }> }).elements[1]!.plannedDurationMs = 9_999_999;
    const result = await session.loadForLive('ep-2026-10-12');
    expect(result).toMatchObject({ ok: false, reason: 'invalid' });
    expect(result.ok === false && result.issues?.[0]).toMatchObject({ code: 'media_exceeds_block', blockId: 'b1' });
  });

  it('passes on the other refusals', async () => {
    const { api, session } = setup();
    expect(await session.loadForLive('nope')).toEqual({ ok: false, reason: 'not_found' });
    api.failNext('loadLive', new TypeError('down'));
    expect(await session.loadForLive('ep-2026-10-12')).toEqual({ ok: false, reason: 'network' });
  });

  it('does not cancel the pending retry when loading while the save is in error', async () => {
    const { api, time, session } = setup();
    await session.open(EPISODE);
    api.failNext('putDoc', new TypeError('down'));
    session.apply(renameDoc('Nuovo nome'));
    await time.advance(900); // fails once: error, backoff armed
    expect(session.autosave.getState()).toMatchObject({ kind: 'error' });
    expect(await session.loadForLive('ep-2026-10-12')).toEqual({ ok: false, reason: 'unsaved' });
    expect(api.count('loadLive')).toBe(0);
    await time.advance(1_000); // the still-armed retry runs and saves
    expect(session.autosave.getState().kind).toBe('clean');
    expect(api.episodes.get('ep-2026-10-12')!.name).toBe('Nuovo nome');
  });
});

describe('late save results', () => {
  it('ignores a save that lands after forget()', async () => {
    const { api, time, session } = setup();
    await session.open(FORMAT);
    const release = api.hold('putDoc');
    session.apply(renameDoc('Nuovo nome'));
    await time.advance(900); // the save is in flight
    expect(session.autosave.getState().kind).toBe('saving');
    session.forget();
    api.failNext('putDoc', new TypeError('down'));
    release();
    await time.advance(0);
    expect(session.getSnapshot()).toMatchObject({ ref: null, phase: 'idle' });
    expect(session.autosave.getState().kind).toBe('clean');
  });

  it('ignores a save of the previous document that lands after a new open', async () => {
    const { api, time, session } = setup();
    await session.open(FORMAT);
    const release = api.hold('putDoc');
    session.apply(renameDoc('Nuovo nome'));
    await time.advance(900); // the save is in flight
    expect(session.autosave.getState().kind).toBe('saving');
    const opening = session.open(EPISODE, { discard: true });
    await time.advance(0); // the new document is open before the old save lands
    expect(session.getSnapshot().ref).toEqual(EPISODE);
    release();
    expect(await opening).toBe(true);
    await time.advance(0);
    await session.checkExternal();
    expect(session.getSnapshot().refreshed).toBe(0);
  });
});

describe('external changes (another tab)', () => {
  it('does nothing when the server copy is unchanged', async () => {
    const { session } = setup();
    await session.open(FORMAT);
    await session.checkExternal();
    expect(session.getSnapshot()).toMatchObject({ refreshed: 0, conflict: null });
  });

  it('reloads silently when the local copy is clean', async () => {
    const { api, session } = setup();
    await session.open(FORMAT);
    api.formats.set('solo-futsal', { ...sampleFormat(), name: 'Cambiato altrove' });
    await session.checkExternal();
    expect(session.store.getSnapshot().doc?.name).toBe('Cambiato altrove');
    expect(session.getSnapshot().refreshed).toBe(1);
    expect(session.autosave.getState().kind).toBe('clean');
  });

  it('asks when the local copy has unsaved edits; take theirs replaces, keep mine overwrites', async () => {
    const { api, time, session } = setup();
    await session.open(FORMAT);
    session.apply(renameDoc('Mia modifica'));
    api.formats.set('solo-futsal', { ...sampleFormat(), name: 'Loro modifica' });
    await session.checkExternal();
    expect(session.getSnapshot().conflict?.name).toBe('Loro modifica');
    expect(session.store.getSnapshot().doc?.name).toBe('Mia modifica');

    session.takeTheirs();
    expect(session.store.getSnapshot().doc?.name).toBe('Loro modifica');
    expect(session.autosave.getState().kind).toBe('clean');

    session.apply(renameDoc('Mia seconda'));
    api.formats.set('solo-futsal', { ...sampleFormat(), name: 'Loro seconda' });
    await session.checkExternal();
    session.keepMine();
    await time.advance(900);
    expect(api.formats.get('solo-futsal')!.name).toBe('Mia seconda');
  });

  it('ignores the check while its own save is in flight (its own write is not a foreign change)', async () => {
    const { api, time, session } = setup();
    await session.open(FORMAT);
    const release = api.hold('putDoc');
    session.apply(renameDoc('Nuovo nome'));
    await time.advance(900);
    expect(session.autosave.getState().kind).toBe('saving');
    await session.checkExternal();
    expect(session.getSnapshot().conflict).toBeNull();
    release();
    await time.advance(0);
    expect(session.autosave.getState().kind).toBe('clean');
  });

  it('holds the save while a conflict is pending, so the newer server copy is not overwritten', async () => {
    const { api, time, session } = setup();
    await session.open(FORMAT);
    session.apply(renameDoc('Mia modifica'));
    api.formats.set('solo-futsal', { ...sampleFormat(), name: 'Loro modifica' });
    await session.checkExternal();
    expect(session.getSnapshot().conflict?.name).toBe('Loro modifica');
    await time.advance(5_000); // well past the debounce
    expect(api.formats.get('solo-futsal')!.name).toBe('Loro modifica');
    expect(api.count('putDoc')).toBe(0);
    expect(session.autosave.getState().kind).not.toBe('clean');
    session.keepMine();
    await time.advance(5_000);
    expect(api.formats.get('solo-futsal')!.name).toBe('Mia modifica');
    expect(session.autosave.getState().kind).toBe('clean');
  });

  it('take theirs while a save is held replaces the copy without writing', async () => {
    const { api, time, session } = setup();
    await session.open(FORMAT);
    session.apply(renameDoc('Mia modifica'));
    api.formats.set('solo-futsal', { ...sampleFormat(), name: 'Loro modifica' });
    await session.checkExternal();
    await time.advance(5_000);
    expect(api.count('putDoc')).toBe(0);
    session.takeTheirs();
    await time.advance(5_000);
    expect(session.store.getSnapshot().doc?.name).toBe('Loro modifica');
    expect(api.count('putDoc')).toBe(0);
    expect(api.formats.get('solo-futsal')!.name).toBe('Loro modifica');
    expect(session.autosave.getState().kind).toBe('clean');
  });

  it('does not cancel the pending retry when keeping mine while the save is in error', async () => {
    const { api, time, session } = setup();
    await session.open(FORMAT);
    api.failNext('putDoc', new TypeError('down'));
    session.apply(renameDoc('Mia modifica'));
    await time.advance(900); // fails once: error, backoff armed
    expect(session.autosave.getState()).toMatchObject({ kind: 'error' });
    api.formats.set('solo-futsal', { ...sampleFormat(), name: 'Loro modifica' });
    await session.checkExternal();
    expect(session.getSnapshot().conflict?.name).toBe('Loro modifica');
    session.keepMine();
    await time.advance(1_000); // the still-armed retry runs and saves
    expect(session.autosave.getState().kind).toBe('clean');
    expect(api.formats.get('solo-futsal')!.name).toBe('Mia modifica');
  });
});

describe('stableStringify', () => {
  it('ignores key order', () => {
    expect(stableStringify({ a: 1, b: [{ d: 1, c: 2 }] })).toBe(stableStringify({ b: [{ c: 2, d: 1 }], a: 1 }));
    expect(stableStringify({ a: 1 })).not.toBe(stableStringify({ a: 2 }));
  });
});
