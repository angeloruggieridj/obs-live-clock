// SPDX-License-Identifier: GPL-2.0-or-later
import { COALESCE_MS, UNDO_LIMIT } from '../model/constants';

export interface Edit<T> {
  /** Stable identifier of the operation, shown in the undo tooltip through the shell dictionary. */
  label: string;
  /** Edits with the same key within `coalesceMs` of each other merge into ONE undo step (drag-resize, typing). */
  coalesceKey?: string;
  apply(doc: T): T;
}

interface Entry<T> {
  before: T;
  label: string;
  key: string | null;
  at: number;
}

export interface StoreSnapshot<T> {
  doc: T;
  /** Increments on every change of `doc` (edit, undo, redo, replace). Autosave compares revisions, never documents. */
  rev: number;
  canUndo: boolean;
  canRedo: boolean;
  undoLabel: string | null;
  redoLabel: string | null;
  readOnly: boolean;
}

export interface DocumentStoreOptions {
  limit?: number; // default UNDO_LIMIT (100)
  coalesceMs?: number; // default COALESCE_MS (600)
  now?: () => number;
}

/**
 * Framework-free document store with a bounded undo/redo history. Documents are immutable values: a history entry
 * is just the previous document (structural sharing keeps it cheap).
 */
export class DocumentStore<T> {
  private doc: T;
  private past: Entry<T>[] = [];
  private future: Entry<T>[] = [];
  private rev = 0;
  private readOnly = false;
  /** True only right after an edit: undo, redo, replace and seal() end a coalescing run. */
  private coalescible = false;
  private snap: StoreSnapshot<T>;
  private readonly listeners = new Set<() => void>();
  private readonly limit: number;
  private readonly coalesceMs: number;
  private readonly now: () => number;

  constructor(initial: T, opts: DocumentStoreOptions = {}) {
    this.doc = initial;
    this.limit = opts.limit ?? UNDO_LIMIT;
    this.coalesceMs = opts.coalesceMs ?? COALESCE_MS;
    this.now = opts.now ?? (() => Date.now());
    this.snap = this.build();
  }

  getSnapshot = (): StoreSnapshot<T> => this.snap;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  /** Applies an edit. Returns false (recording nothing) when read-only or when `apply` returns the same document. */
  edit(e: Edit<T>): boolean {
    if (this.readOnly) return false;
    const next = e.apply(this.doc);
    if (Object.is(next, this.doc)) return false;
    const at = this.now();
    const top = this.past[this.past.length - 1];
    const key = e.coalesceKey ?? null;
    if (key !== null && this.coalescible && top !== undefined && top.key === key && at - top.at <= this.coalesceMs) {
      top.at = at; // sliding window; `before` stays the state before the whole run
    } else {
      this.past.push({ before: this.doc, label: e.label, key, at });
      if (this.past.length > this.limit) this.past.shift();
    }
    this.future = [];
    this.doc = next;
    this.coalescible = true;
    this.rev += 1;
    this.emit();
    return true;
  }

  undo(): boolean {
    if (this.readOnly) return false;
    const entry = this.past.pop();
    if (entry === undefined) return false;
    this.future.push({ ...entry, before: this.doc });
    this.doc = entry.before;
    this.coalescible = false;
    this.rev += 1;
    this.emit();
    return true;
  }

  redo(): boolean {
    if (this.readOnly) return false;
    const entry = this.future.pop();
    if (entry === undefined) return false;
    this.past.push({ ...entry, before: this.doc });
    this.doc = entry.before;
    this.coalescible = false;
    this.rev += 1;
    this.emit();
    return true;
  }

  /** Ends the current coalescing run (call on pointer-up and on blur). */
  seal(): void {
    this.coalescible = false;
  }

  /** Loads a different document: history is cleared. Not an edit. */
  replace(doc: T, opts: { readOnly?: boolean } = {}): void {
    this.doc = doc;
    this.past = [];
    this.future = [];
    this.coalescible = false;
    this.readOnly = opts.readOnly ?? false;
    this.rev += 1;
    this.emit();
  }

  setReadOnly(value: boolean): void {
    if (this.readOnly === value) return;
    this.readOnly = value;
    this.emit();
  }

  private build(): StoreSnapshot<T> {
    const u = this.past[this.past.length - 1];
    const r = this.future[this.future.length - 1];
    return {
      doc: this.doc,
      rev: this.rev,
      canUndo: u !== undefined && !this.readOnly,
      canRedo: r !== undefined && !this.readOnly,
      undoLabel: u?.label ?? null,
      redoLabel: r?.label ?? null,
      readOnly: this.readOnly,
    };
  }

  private emit(): void {
    this.snap = this.build();
    for (const l of [...this.listeners]) {
      try {
        l();
      } catch {
        // A misbehaving listener must never stop the others, nor the edit that triggered the notification.
      }
    }
  }
}
