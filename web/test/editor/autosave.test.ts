// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import { Autosave, SaveError } from '../../src/editor/store/autosave';
import { DocumentStore, type Edit } from '../../src/editor/store/document-store';
import { fakeTimers } from '../support/fake-timers';

const inc: Edit<number> = { label: 'inc', apply: (d) => d + 1 };

function setup() {
  const f = fakeTimers();
  const store = new DocumentStore(0);
  const saved: number[] = [];
  const ctl = { fail: null as Error | null, hold: null as null | { release: () => void } };
  const save = async (doc: number) => {
    if (ctl.fail !== null) throw ctl.fail;
    if (ctl.hold !== null) {
      await new Promise<void>((resolve) => (ctl.hold = { release: resolve }));
    }
    saved.push(doc);
  };
  const autosave = new Autosave(store, save, f.timers);
  return { f, store, saved, ctl, autosave };
}

describe('Autosave', () => {
  it('waits for the edits to settle, then saves once', async () => {
    const { f, store, saved, autosave } = setup();
    store.edit(inc);
    store.edit(inc);
    expect(autosave.getState().kind).toBe('dirty');
    await f.advance(799);
    expect(saved).toEqual([]);
    await f.advance(2);
    expect(saved).toEqual([2]);
    expect(autosave.getState().kind).toBe('clean');
  });

  it('keeps saving during continuous editing (max wait)', async () => {
    const { f, store, saved } = setup();
    for (let i = 0; i < 20; i++) {
      store.edit(inc);
      await f.advance(500); // never quiet for the 800 ms debounce
    }
    expect(saved.length).toBeGreaterThanOrEqual(1);
  });

  it('shows an error, retries with backoff and recovers', async () => {
    const { f, store, saved, ctl, autosave } = setup();
    ctl.fail = new SaveError(500, 'internal');
    store.edit(inc);
    await f.advance(900);
    expect(autosave.getState()).toEqual({ kind: 'error', code: 'internal', attempt: 1 });
    await f.advance(1_000);
    expect(autosave.getState()).toMatchObject({ kind: 'error', attempt: 2 });
    await f.advance(2_000);
    expect(autosave.getState()).toMatchObject({ kind: 'error', attempt: 3 });
    ctl.fail = null;
    await f.advance(4_000);
    expect(saved).toEqual([1]);
    expect(autosave.getState().kind).toBe('clean');
  });

  it('treats a network failure as an error with code "network"', async () => {
    const { f, store, ctl, autosave } = setup();
    ctl.fail = new TypeError('fetch failed');
    store.edit(inc);
    await f.advance(900);
    expect(autosave.getState()).toMatchObject({ kind: 'error', code: 'network' });
  });

  it('never reports clean while a newer revision exists: an edit during a save is saved afterwards', async () => {
    const { f, store, saved, ctl, autosave } = setup();
    ctl.hold = { release: () => {} };
    store.edit(inc);
    await f.advance(900);
    expect(autosave.getState().kind).toBe('saving');
    store.edit(inc);
    ctl.hold.release();
    await f.advance(0);
    expect(saved).toEqual([1]);
    expect(autosave.getState().kind).toBe('dirty');
    await f.advance(900);
    expect(autosave.getState().kind).toBe('saving');
    ctl.hold.release();
    await f.advance(0);
    expect(saved).toEqual([1, 2]);
    expect(autosave.getState().kind).toBe('clean');
  });

  it('undo after a failed save is saved once the server is back', async () => {
    const { f, store, saved, ctl, autosave } = setup();
    store.edit(inc);
    await f.advance(900);
    expect(saved).toEqual([1]);
    ctl.fail = new SaveError(500, 'internal');
    store.edit(inc);
    await f.advance(900);
    expect(autosave.getState().kind).toBe('error');
    store.undo(); // the screen now shows 1 again
    ctl.fail = null;
    await f.advance(1_000);
    expect(saved).toEqual([1, 1]); // the file ends equal to what the screen shows
    expect(autosave.getState().kind).toBe('clean');
    expect(store.getSnapshot().doc).toBe(1);
  });

  it('locks on 409 episode_live: read-only, no more saves, no retry', async () => {
    const { f, store, ctl, autosave } = setup();
    ctl.fail = new SaveError(409, 'episode_live');
    store.edit(inc);
    await f.advance(900);
    expect(autosave.getState().kind).toBe('locked');
    expect(store.getSnapshot().readOnly).toBe(true);
    expect(store.edit(inc)).toBe(false);
    await f.advance(60_000);
    expect(autosave.getState().kind).toBe('locked');
  });

  it('a 400 stops retrying; the next edit tries again', async () => {
    const { f, store, saved, ctl, autosave } = setup();
    ctl.fail = new SaveError(400, 'invalid_body');
    store.edit(inc);
    await f.advance(900);
    expect(autosave.getState()).toEqual({ kind: 'invalid', code: 'invalid_body' });
    await f.advance(30_000);
    expect(autosave.getState().kind).toBe('invalid');
    ctl.fail = null;
    store.edit(inc);
    await f.advance(900);
    expect(saved).toEqual([2]);
    expect(autosave.getState().kind).toBe('clean');
  });

  it('flush() saves immediately and resolves when clean', async () => {
    const { store, saved, autosave } = setup();
    store.edit(inc);
    await autosave.flush();
    expect(saved).toEqual([1]);
    expect(autosave.getState().kind).toBe('clean');
  });

  it('flush() resolves with the error state when the save fails', async () => {
    const { store, ctl, autosave } = setup();
    ctl.fail = new SaveError(500, 'internal');
    store.edit(inc);
    await autosave.flush();
    expect(autosave.getState().kind).toBe('error');
  });

  it('retryNow() runs an attempt without waiting for the backoff', async () => {
    const { f, store, saved, ctl, autosave } = setup();
    ctl.fail = new SaveError(503, 'down');
    store.edit(inc);
    await f.advance(900);
    ctl.fail = null;
    await autosave.retryNow();
    expect(saved).toEqual([1]);
    expect(autosave.getState().kind).toBe('clean');
  });

  it('markSaved() declares a freshly loaded document clean', async () => {
    const { store, autosave } = setup();
    store.replace(7);
    autosave.markSaved();
    expect(autosave.getState().kind).toBe('clean');
  });
});
