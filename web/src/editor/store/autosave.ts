// SPDX-License-Identifier: GPL-2.0-or-later
import { AUTOSAVE_DEBOUNCE_MS } from '../model/constants';
import type { DocumentStore } from './document-store';

export class SaveError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(`HTTP ${status}: ${code}`);
    this.name = 'SaveError';
  }
}

export type SaveState =
  | { kind: 'clean' }
  | { kind: 'dirty' }
  | { kind: 'saving' }
  /** Network or server failure: the director must SEE this. Retries automatically with backoff. */
  | { kind: 'error'; code: string; attempt: number }
  /** The server rejected the content (400): retrying cannot help; the next edit tries again. */
  | { kind: 'invalid'; code: string }
  /** The episode is live (409 episode_live): saving stopped for good, the store is read-only. */
  | { kind: 'locked' };

export interface Timers {
  /** Schedules `fn` after `ms`; returns the cancel function. */
  set(fn: () => void, ms: number): () => void;
  now(): number;
}

export interface AutosaveOptions {
  debounceMs?: number; // default 800
  maxWaitMs?: number; // default 5000: continuous editing still saves
  retryBaseMs?: number; // default 1000
  retryMaxMs?: number; // default 10000
}

/**
 * Saves the store's document through `save` after edits settle. At most ONE save is in flight, so writes reach the
 * server in order. A document is "saved" only when the save of exactly the current revision succeeded.
 */
export class Autosave<T> {
  private state: SaveState = { kind: 'clean' };
  private savedRev: number;
  private cancelTimer: (() => void) | null = null;
  private inflight: Promise<void> | null = null;
  private firstDirtyAt: number | null = null;
  private failures = 0;
  private readonly listeners = new Set<() => void>();
  private readonly o: Required<AutosaveOptions>;
  private readonly unsubscribe: () => void;

  constructor(
    private readonly store: DocumentStore<T>,
    private readonly save: (doc: T) => Promise<void>,
    private readonly timers: Timers,
    opts: AutosaveOptions = {},
  ) {
    this.o = { debounceMs: AUTOSAVE_DEBOUNCE_MS, maxWaitMs: 5000, retryBaseMs: 1000, retryMaxMs: 10_000, ...opts };
    this.savedRev = store.getSnapshot().rev;
    this.unsubscribe = store.subscribe(() => this.onStoreChange());
  }

  getState = (): SaveState => this.state;

  subscribe = (l: () => void): (() => void) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };

  /** Declares the current document as already persisted (after load, or after a "take theirs" reload). */
  markSaved(): void {
    this.cancel();
    this.savedRev = this.store.getSnapshot().rev;
    this.failures = 0;
    this.firstDirtyAt = null;
    this.set({ kind: 'clean' });
  }

  /** Saves now (cancelling the debounce); resolves when no unsaved change is left or saving cannot proceed. */
  async flush(): Promise<void> {
    this.cancel();
    for (;;) {
      if (this.inflight !== null) await this.inflight;
      const s = this.state.kind;
      if (this.store.getSnapshot().rev === this.savedRev || s === 'locked' || s === 'error' || s === 'invalid') return;
      await this.run();
    }
  }

  /** "Retry now" button. After a failure it runs one attempt immediately. */
  async retryNow(): Promise<void> {
    if (this.state.kind === 'locked') return;
    this.cancel();
    if (this.inflight !== null) await this.inflight;
    await this.run();
  }

  dispose(): void {
    this.cancel();
    this.unsubscribe();
  }

  private onStoreChange(): void {
    if (this.state.kind === 'locked') return;
    const rev = this.store.getSnapshot().rev;
    if (rev === this.savedRev) return;
    if (this.state.kind === 'clean' || this.state.kind === 'invalid') {
      this.firstDirtyAt = this.timers.now();
      this.set({ kind: 'dirty' });
    }
    this.firstDirtyAt ??= this.timers.now();
    if (this.inflight !== null) return; // the finishing save reschedules
    const waited = this.timers.now() - this.firstDirtyAt;
    this.schedule(Math.max(0, Math.min(this.o.debounceMs, this.o.maxWaitMs - waited)));
  }

  private schedule(ms: number): void {
    this.cancel();
    this.cancelTimer = this.timers.set(() => {
      this.cancelTimer = null;
      void this.run();
    }, ms);
  }

  private cancel(): void {
    this.cancelTimer?.();
    this.cancelTimer = null;
  }

  private run(): Promise<void> {
    if (this.inflight !== null) return this.inflight;
    const { doc, rev } = this.store.getSnapshot();
    if (rev === this.savedRev) return Promise.resolve();
    this.set({ kind: 'saving' });
    const attempt = (async () => {
      try {
        await this.save(doc);
        this.savedRev = rev;
        this.failures = 0;
        this.firstDirtyAt = null;
        if (this.store.getSnapshot().rev === this.savedRev) this.set({ kind: 'clean' });
        else {
          this.set({ kind: 'dirty' });
          this.firstDirtyAt = this.timers.now();
          this.schedule(this.o.debounceMs);
        }
      } catch (err) {
        const status = err instanceof SaveError ? err.status : 0;
        const code = err instanceof SaveError ? err.code : 'network';
        if (status === 409 && code === 'episode_live') {
          this.set({ kind: 'locked' });
          this.store.setReadOnly(true);
        } else if (status === 400) {
          this.set({ kind: 'invalid', code });
        } else {
          this.failures += 1;
          this.set({ kind: 'error', code, attempt: this.failures });
          this.schedule(Math.min(this.o.retryBaseMs * 2 ** (this.failures - 1), this.o.retryMaxMs));
        }
      } finally {
        this.inflight = null;
      }
    })();
    this.inflight = attempt;
    return attempt;
  }

  private set(next: SaveState): void {
    this.state = next;
    for (const l of [...this.listeners]) l();
  }
}
