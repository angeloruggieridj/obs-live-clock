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

/** The persisted identity of a document, taken from the document itself (never from a ref that may have moved on). */
const docRef = (doc: EditorDoc): DocRef => ({ kind: 'formatId' in doc ? 'episode' : 'format', id: doc.id });

export class EditorSession {
  readonly store = new DocumentStore<EditorDoc | null>(null);
  readonly selection = new SelectionStore();
  readonly autosave: Autosave<EditorDoc | null>;
  private snap: SessionSnapshot = { ref: null, phase: 'idle', error: null, lock: null, live: null, conflict: null, refreshed: 0, blocked: false };
  private readonly listeners = new Set<() => void>();
  /** The document as the server last confirmed it (loaded or saved). */
  private lastSaved: EditorDoc | null = null;
  private openToken = 0;
  /**
   * While a conflict is pending the save is held (no write) until the director chooses. The held save awaits this
   * promise; `endConflictHold()` releases it whenever the conflict is resolved or the document is forgotten.
   */
  private conflictHold: Promise<void> | null = null;
  private releaseConflictHold: (() => void) | null = null;
  private readonly offAutosave: () => void;

  constructor(
    readonly api: EditorApi,
    timers: Timers = browserTimers,
    autosaveOptions: AutosaveOptions = {},
  ) {
    this.autosave = new Autosave(
      this.store,
      async (doc) => {
        if (doc === null) return;
        // The target comes from the document, so a save that started before open()/forget() moved on still writes to
        // the document it captured (and a stale tab never overwrites the copy the conflict is showing).
        const target = docRef(doc);
        const token = this.openToken;
        if (this.snap.conflict !== null) {
          await this.holdForConflict();
          // The conflict was resolved (or the session moved on) while we waited: only keepMine() ends up here with
          // the same document still in the store, which is exactly the document that must now be written.
          if (token !== this.openToken || this.snap.conflict !== null) return;
          if (!Object.is(this.store.getSnapshot().doc, doc)) return; // resolved by takeTheirs()/discard, or edited since
        }
        let saved: EditorDoc;
        try {
          saved = await this.api.putDoc(doc, target.kind);
        } catch (err) {
          // A failure that lands after forget()/a different open() belongs to a document no one is looking at: drop it
          // instead of lighting up the error state of the document that replaced it.
          if (token !== this.openToken) return;
          throw err instanceof ApiError ? new SaveError(err.status, err.code) : err;
        }
        if (token !== this.openToken) return; // late success: do not adopt it as lastSaved
        this.lastSaved = saved;
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
      // A pending conflict must be resolved by the director first: flushing would either write the stale copy the
      // conflict is warning about, or wait on the held save forever.
      if (this.snap.conflict !== null) {
        this.set({ blocked: true });
        return false;
      }
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
    // The ref and the store stay on the previous document until the new one is loaded, so an edit made while the load
    // is in flight is still saved to the document on screen; a failed open then leaves that document addressed.
    this.set({ phase: 'loading', error: null, blocked: false });
    try {
      const [doc, live] = await Promise.all([this.api.getDoc(ref), this.api.liveStatus().catch(() => null)]);
      if (token !== this.openToken) return false; // a newer open() won
      const lock = ref.kind === 'episode' && live !== null && live.episodeId === ref.id && live.phase === 'live' ? 'live' : null;
      this.store.replace(doc, { readOnly: lock !== null });
      this.autosave.markSaved();
      this.lastSaved = doc;
      this.selection.select(firstBlockId(doc));
      this.set({ ref, phase: 'ready', live, lock, conflict: null });
      this.endConflictHold();
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
    this.endConflictHold();
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
    this.endConflictHold();
  }

  /** Keeps the local copy: from now on the server copy is the one the next save overwrites. */
  keepMine(): void {
    const theirs = this.snap.conflict;
    if (theirs === null) return;
    this.lastSaved = theirs;
    this.set({ conflict: null });
    // The held save (if any) is the one that must now write the local copy: release it before flushing.
    this.endConflictHold();
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
      // An unresolved conflict means the local copy is not what the director confirmed: loading would run an older
      // copy (and flushing would wait on the held save). The switch is refused.
      if (this.snap.conflict !== null) return { ok: false, reason: 'unsaved' };
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
    this.endConflictHold();
  }

  private set(patch: Partial<SessionSnapshot>): void {
    this.snap = { ...this.snap, ...patch };
    for (const l of [...this.listeners]) l();
  }

  /** Returns the promise a held save awaits; created on first use until the conflict is resolved. */
  private holdForConflict(): Promise<void> {
    this.conflictHold ??= new Promise<void>((resolve) => {
      this.releaseConflictHold = resolve;
    });
    return this.conflictHold;
  }

  /** Releases a held save. Callers clear `conflict` first, so the resumed save can tell what the director chose. */
  private endConflictHold(): void {
    const release = this.releaseConflictHold;
    this.conflictHold = null;
    this.releaseConflictHold = null;
    release?.();
  }
}
