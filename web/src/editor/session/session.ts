// SPDX-License-Identifier: GPL-2.0-or-later
import { ApiError } from '../../core/http';
import { RundownInvalidError, type CheckIssue, type DocRef, type EditorApi, type EditorDoc, type LiveStatus } from '../api/editor-api';
import { Autosave, SaveError, type AutosaveOptions, type Timers } from '../store/autosave';
import { DocumentStore, type Edit } from '../store/document-store';
import { SelectionStore } from './selection';

export interface SessionSnapshot {
  ref: DocRef | null;
  phase: 'idle' | 'loading' | 'ready' | 'error';
  /** Error code when phase is 'error'. */
  error: string | null;
  /** 'live': the episode is on air; the store is read-only (SPEC §18.7). */
  lock: 'live' | null;
  live: LiveStatus | null;
  /** The server copy changed while this copy has unsaved edits. The director chooses. */
  conflict: EditorDoc | null;
  /** Counts silent refreshes of a clean copy from a newer server copy. */
  refreshed: number;
  /** open() was refused because the open document has unsaved changes. */
  blocked: boolean;
}

export type LoadResult =
  | { ok: true }
  /** 'unsaved': the open episode could not be saved, so loading would load an older copy. */
  | { ok: false; reason: 'unsaved' | 'invalid' | 'network' | string; issues?: CheckIssue[] };

export const browserTimers: Timers = {
  set(fn, ms) {
    const id = setTimeout(fn, ms);
    return () => clearTimeout(id);
  },
  now: () => Date.now(),
};

/** JSON with sorted keys: two documents with the same content compare equal whatever their key order. */
export function stableStringify(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(',')}]`;
  if (v !== null && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o).sort().map((k) => `${JSON.stringify(k)}:${stableStringify(o[k])}`).join(',')}}`;
  }
  return JSON.stringify(v);
}

const firstBlockId = (doc: EditorDoc): string | null => doc.blocks[0]?.id ?? null;

export class EditorSession {
  readonly store = new DocumentStore<EditorDoc | null>(null);
  readonly selection = new SelectionStore();
  readonly autosave: Autosave<EditorDoc | null>;
  private snap: SessionSnapshot = { ref: null, phase: 'idle', error: null, lock: null, live: null, conflict: null, refreshed: 0, blocked: false };
  private readonly listeners = new Set<() => void>();
  /** The document as the server last confirmed it (loaded or saved). */
  private lastSaved: EditorDoc | null = null;
  private openToken = 0;
  private readonly offAutosave: () => void;

  constructor(
    readonly api: EditorApi,
    timers: Timers = browserTimers,
    autosaveOptions: AutosaveOptions = {},
  ) {
    this.autosave = new Autosave(
      this.store,
      async (doc) => {
        const ref = this.snap.ref;
        if (doc === null || ref === null) return;
        try {
          this.lastSaved = await this.api.putDoc(doc, ref.kind);
        } catch (err) {
          throw err instanceof ApiError ? new SaveError(err.status, err.code) : err;
        }
      },
      timers,
      autosaveOptions,
    );
    this.offAutosave = this.autosave.subscribe(() => {
      if (this.autosave.getState().kind === 'locked' && this.snap.lock === null) this.set({ lock: 'live' });
    });
  }

  getSnapshot = (): SessionSnapshot => this.snap;

  subscribe = (l: () => void): (() => void) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };

  /**
   * Opens a document. First flushes the one that is open: if it still has unsaved changes (the save failed) the
   * switch is REFUSED (`blocked`), so edits are never dropped silently. `discard` overrides that on purpose.
   */
  async open(ref: DocRef, opts: { discard?: boolean } = {}): Promise<boolean> {
    if (this.snap.ref !== null && !opts.discard) {
      // `flush()` while the save is in `error` would cancel the backoff retry and return without saving (Task 3),
      // so a refused switch must leave the pending retry running instead of calling it.
      if (this.autosave.getState().kind !== 'error') await this.autosave.flush();
      const kind = this.autosave.getState().kind;
      if (kind !== 'clean' && kind !== 'locked') {
        this.set({ blocked: true });
        return false;
      }
    }
    const token = ++this.openToken;
    this.set({ ref, phase: 'loading', error: null, lock: null, conflict: null, blocked: false });
    try {
      const [doc, live] = await Promise.all([this.api.getDoc(ref), this.api.liveStatus().catch(() => null)]);
      if (token !== this.openToken) return false; // a newer open() won
      const lock = ref.kind === 'episode' && live !== null && live.episodeId === ref.id && live.phase === 'live' ? 'live' : null;
      this.store.replace(doc, { readOnly: lock !== null });
      this.autosave.markSaved();
      this.lastSaved = doc;
      this.selection.select(firstBlockId(doc));
      this.set({ phase: 'ready', live, lock });
      return true;
    } catch (err) {
      if (token === this.openToken) this.set({ phase: 'error', error: err instanceof ApiError ? err.code : 'network' });
      return false;
    }
  }

  /** Forgets the open document without saving (it was deleted, or the director chose to discard). */
  forget(): void {
    this.openToken++;
    this.store.replace(null);
    this.autosave.markSaved();
    this.lastSaved = null;
    this.selection.select(null);
    this.set({ ref: null, phase: 'idle', error: null, lock: null, conflict: null, blocked: false });
  }

  apply(e: Edit<EditorDoc>): boolean {
    return this.store.edit({ label: e.label, coalesceKey: e.coalesceKey, apply: (d) => (d === null ? d : e.apply(d)) });
  }
  undo(): boolean {
    return this.store.undo();
  }
  redo(): boolean {
    return this.store.redo();
  }
  seal(): void {
    this.store.seal();
  }

  /** Polls the live status; an open episode that is on air becomes read-only. */
  async refreshLive(): Promise<void> {
    let live: LiveStatus;
    try {
      live = await this.api.liveStatus();
    } catch {
      return;
    }
    const ref = this.snap.ref;
    const onAir = ref !== null && ref.kind === 'episode' && live.episodeId === ref.id && live.phase === 'live';
    if (onAir) this.store.setReadOnly(true);
    this.set({ live, lock: onAir ? 'live' : this.snap.lock });
  }

  /**
   * Looks for a newer server copy (other tab, other machine). Clean local copy: refreshed silently. Unsaved local
   * edits: `conflict` is set and the director chooses. Skipped while a save is in flight (its own write would look
   * like a foreign change) and while locked.
   */
  async checkExternal(): Promise<void> {
    const ref = this.snap.ref;
    const kind = this.autosave.getState().kind;
    if (ref === null || this.snap.phase !== 'ready' || this.snap.lock !== null || kind === 'saving' || this.snap.conflict !== null) return;
    let remote: EditorDoc;
    try {
      remote = await this.api.getDoc(ref);
    } catch {
      return;
    }
    if (this.snap.ref !== ref || this.autosave.getState().kind === 'saving') return;
    if (this.lastSaved !== null && stableStringify(remote) === stableStringify(this.lastSaved)) return;
    if (this.autosave.getState().kind === 'clean') {
      this.store.replace(remote);
      this.autosave.markSaved();
      this.lastSaved = remote;
      this.set({ refreshed: this.snap.refreshed + 1 });
    } else {
      this.set({ conflict: remote });
    }
  }

  takeTheirs(): void {
    const theirs = this.snap.conflict;
    if (theirs === null) return;
    this.store.replace(theirs);
    this.autosave.markSaved();
    this.lastSaved = theirs;
    this.set({ conflict: null });
  }

  /** Keeps the local copy: from now on the server copy is the one the next save overwrites. */
  keepMine(): void {
    const theirs = this.snap.conflict;
    if (theirs === null) return;
    this.lastSaved = theirs;
    this.set({ conflict: null });
    // As in open(): flush() in `error` would cancel the backoff retry, so leave the retry running.
    if (this.autosave.getState().kind !== 'error') void this.autosave.flush();
  }

  /**
   * "Load for live". If this episode is the open one it is saved first (the server loads what is on disk); if the
   * save fails nothing is loaded. The server refuses a rundown with errors (`invalid`, with the issues).
   */
  async loadForLive(episodeId: string): Promise<LoadResult> {
    const ref = this.snap.ref;
    if (ref !== null && ref.kind === 'episode' && ref.id === episodeId) {
      // As in open(): flush() in `error` would cancel the backoff retry, so leave the retry running.
      if (this.autosave.getState().kind !== 'error') await this.autosave.flush();
      if (this.autosave.getState().kind !== 'clean') return { ok: false, reason: 'unsaved' };
    }
    try {
      await this.api.loadLive(episodeId);
    } catch (err) {
      if (err instanceof RundownInvalidError) return { ok: false, reason: 'invalid', issues: err.issues };
      return { ok: false, reason: err instanceof ApiError ? err.code : 'network' };
    }
    await this.refreshLive();
    return { ok: true };
  }

  dispose(): void {
    this.offAutosave();
    this.autosave.dispose();
  }

  private set(patch: Partial<SessionSnapshot>): void {
    this.snap = { ...this.snap, ...patch };
    for (const l of [...this.listeners]) l();
  }
}
