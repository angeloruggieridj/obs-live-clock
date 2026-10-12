// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import { DocumentStore, type Edit } from '../../src/editor/store/document-store';

const inc = (n = 1, key?: string): Edit<number> => ({ label: 'inc', coalesceKey: key, apply: (d) => d + n });

describe('DocumentStore', () => {
  it('undoes and redoes, records no-ops nowhere, and clears redo on a new edit', () => {
    const s = new DocumentStore(0);
    expect(s.edit({ label: 'noop', apply: (d) => d })).toBe(false);
    expect(s.getSnapshot().canUndo).toBe(false);
    s.edit(inc());
    s.edit(inc());
    expect(s.getSnapshot().doc).toBe(2);
    s.undo();
    expect(s.getSnapshot().doc).toBe(1);
    s.redo();
    expect(s.getSnapshot().doc).toBe(2);
    s.undo();
    s.edit(inc(10));
    expect(s.getSnapshot().canRedo).toBe(false);
    expect(s.getSnapshot().doc).toBe(11);
  });

  it('exposes the labels of the next undo and redo', () => {
    const s = new DocumentStore(0);
    s.edit({ label: 'move_block', apply: (d) => d + 1 });
    expect(s.getSnapshot().undoLabel).toBe('move_block');
    s.undo();
    expect(s.getSnapshot()).toMatchObject({ undoLabel: null, redoLabel: 'move_block' });
  });

  it('merges rapid edits with the same key into one undo step', () => {
    let t = 0;
    const s = new DocumentStore(0, { now: () => t });
    s.edit(inc(1, 'k'));
    t = 100;
    s.edit(inc(1, 'k'));
    t = 200;
    s.edit(inc(1, 'k'));
    expect(s.getSnapshot().doc).toBe(3);
    s.undo();
    expect(s.getSnapshot().doc).toBe(0);
    s.redo();
    expect(s.getSnapshot().doc).toBe(3);
  });

  it('starts a new step after the window, and never merges into a run that an undo ended', () => {
    let t = 0;
    const s = new DocumentStore(0, { now: () => t });
    s.edit(inc(1, 'k'));
    t = 5_000;
    s.edit(inc(1, 'k')); // window expired: own step
    s.undo();
    expect(s.getSnapshot().doc).toBe(1);
    t = 5_100;
    s.edit(inc(1, 'k')); // right after an undo: must not merge with the older run
    s.undo();
    expect(s.getSnapshot().doc).toBe(1);
    s.undo();
    expect(s.getSnapshot().doc).toBe(0);
  });

  it('seal() ends a run; edits with different keys never merge', () => {
    let t = 0;
    const s = new DocumentStore(0, { now: () => t });
    s.edit(inc(1, 'a'));
    s.seal();
    t = 10;
    s.edit(inc(1, 'a'));
    s.undo();
    expect(s.getSnapshot().doc).toBe(1);
    s.edit(inc(1, 'b'));
    t = 20;
    s.edit(inc(1, 'c'));
    s.undo();
    expect(s.getSnapshot().doc).toBe(2);
  });

  it('keeps at most `limit` steps', () => {
    const s = new DocumentStore(0, { limit: 3 });
    for (let i = 0; i < 10; i++) s.edit(inc());
    let n = 0;
    while (s.undo()) n++;
    expect(n).toBe(3);
    expect(s.getSnapshot().doc).toBe(7);
  });

  it('is read-only on demand: no edits, no undo, no redo', () => {
    const s = new DocumentStore(0);
    s.edit(inc());
    s.setReadOnly(true);
    expect(s.edit(inc())).toBe(false);
    expect(s.undo()).toBe(false);
    expect(s.getSnapshot()).toMatchObject({ canUndo: false, canRedo: false, readOnly: true, doc: 1 });
  });

  it('replace() loads a document, clears history and bumps the revision', () => {
    const s = new DocumentStore(0);
    s.edit(inc());
    const before = s.getSnapshot().rev;
    s.replace(50, { readOnly: true });
    expect(s.getSnapshot()).toMatchObject({ doc: 50, canUndo: false, readOnly: true });
    expect(s.getSnapshot().rev).toBeGreaterThan(before);
  });

  it('notifies subscribers and hands out a stable snapshot between changes', () => {
    const s = new DocumentStore(0);
    let calls = 0;
    const off = s.subscribe(() => calls++);
    const a = s.getSnapshot();
    expect(s.getSnapshot()).toBe(a);
    s.edit(inc());
    expect(calls).toBe(1);
    expect(s.getSnapshot()).not.toBe(a);
    off();
    s.edit(inc());
    expect(calls).toBe(1);
  });

  it('keeps running the other listeners when one throws', () => {
    const s = new DocumentStore(0);
    const seen: string[] = [];
    s.subscribe(() => seen.push('a'));
    s.subscribe(() => {
      seen.push('b');
      throw new Error('listener b failed');
    });
    s.subscribe(() => seen.push('c'));
    expect(() => s.edit(inc())).not.toThrow();
    expect(seen).toEqual(['a', 'b', 'c']);
  });
});
