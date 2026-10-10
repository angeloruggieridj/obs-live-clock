// SPDX-License-Identifier: GPL-2.0-or-later
import { Episode, type ClientCommand } from '@olc/shared';
import type { Clock, Scheduler } from '../clock/clock';
import {
  controlView,
  createLiveState,
  nextTickAt,
  presenterView,
  reduce,
  type ControlView,
  type EngineInput,
  type LiveState,
  type PresenterView,
} from '../engine/index';
import type { LiveJournal } from '../persistence/journal';
import type { SnapshotStore } from '../persistence/snapshot-store';
import { commandToInput, type WithoutAt } from './commands';

export class NoEpisodeError extends Error {
  constructor() {
    super('No episode is loaded');
    this.name = 'NoEpisodeError';
  }
}

export class LiveRunningError extends Error {
  constructor(readonly episodeId: string) {
    super(`Episode "${episodeId}" is live`);
    this.name = 'LiveRunningError';
  }
}

export interface RuntimeDeps {
  clock: Clock;
  scheduler: Scheduler;
  snapshots: SnapshotStore;
  journalFor(episodeId: string): LiveJournal;
  onError?(err: unknown): void;
}

/** Sole owner of the live state: stamps inputs, runs the engine, persists, schedules ticks, notifies. */
export class LiveRuntime {
  private state: LiveState | null = null;
  private journal: LiveJournal | null = null;
  private cancelTick: (() => void) | null = null;
  private disposed = false;
  private readonly listeners = new Set<() => void>();
  private persisting: Promise<void> = Promise.resolve();
  /** True while a snapshot save is queued but has not started; further changes coalesce into it. */
  private snapshotQueued = false;
  /** Cached `wall - now` offset; keeps wall times integer and stable across projection calls. */
  private wallOffset: number | null = null;

  constructor(private readonly deps: RuntimeDeps) {}

  readonly toWall = (mono: number): number => {
    const measured = this.deps.clock.wall() - this.deps.clock.now();
    if (this.wallOffset === null) this.wallOffset = measured;
    else if (Math.abs(measured - this.wallOffset) > 50) {
      this.report(new Error(`Wall clock offset changed by ${measured - this.wallOffset} ms; re-sampling`));
      this.wallOffset = measured;
    }
    return Math.round(mono + this.wallOffset);
  };

  get episodeId(): string | null {
    return this.state?.episode.id ?? null;
  }

  get phase(): LiveState['phase'] | null {
    return this.state?.phase ?? null;
  }

  getState(): LiveState | null {
    return this.state;
  }

  isLive(episodeId: string): boolean {
    return this.state !== null && this.state.episode.id === episodeId && this.state.phase === 'live';
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  async load(episode: Episode): Promise<void> {
    if (this.disposed) throw new Error('Runtime disposed');
    if (this.state?.phase === 'live') throw new LiveRunningError(this.state.episode.id);
    this.state = createLiveState(episode);
    this.journal = this.deps.journalFor(episode.id);
    this.requestSnapshot();
    this.reschedule();
    this.notify();
    await this.flush();
  }

  /**
   * Apply an edited rundown to the loaded episode without losing live runtime state. Only a loaded episode
   * still in preshow is reloaded: a live episode is refused before this is reached, and an ended show keeps
   * its as-run state. Only `episode`, `slots`, `slotRt` and `blockRt` are rebuilt; everything else the
   * engine carried from OBS or the operator is copied over so the message, outputs, program, deck, media,
   * control and decisions survive an edit. The journal is unchanged: it is the same episode.
   */
  async reloadEpisode(episode: Episode): Promise<void> {
    const prev = this.state;
    if (prev === null || prev.episode.id !== episode.id || prev.phase !== 'preshow') return;
    const next = createLiveState(episode);
    next.obs = prev.obs;
    next.outputs = prev.outputs;
    next.recPausedAt = prev.recPausedAt;
    next.control = prev.control;
    next.program = prev.program;
    next.deck = prev.deck;
    next.media = prev.media;
    next.offScript = prev.offScript;
    next.message = prev.message;
    next.decisions = prev.decisions;
    next.nextDecisionId = prev.nextDecisionId;
    this.state = next;
    this.requestSnapshot();
    this.reschedule();
    this.notify();
    await this.flush();
  }

  async unload(): Promise<void> {
    if (this.state?.phase === 'live') throw new LiveRunningError(this.state.episode.id);
    this.cancel();
    this.state = null;
    this.journal = null;
    this.enqueue(() => this.deps.snapshots.clear());
    this.notify();
    await this.flush();
  }

  async resume(): Promise<boolean> {
    if (this.disposed) throw new Error('Runtime disposed');
    if (this.state !== null) return false;
    let snapshot;
    try {
      snapshot = await this.deps.snapshots.load();
    } catch (err) {
      this.report(err);
      return false;
    }
    if (this.disposed) return false;
    // A `load()` may have landed while the snapshot was being read: never clobber it.
    if (this.state !== null) return false;
    if (snapshot === undefined) return false;
    // A finished show is not resumed: its snapshot stays on disk but the runtime starts empty.
    if (snapshot.state.phase === 'ended') return false;
    const input: EngineInput = { type: 'SourceLost', at: this.deps.clock.now() };
    let state: LiveState;
    let changed: boolean;
    try {
      const result = reduce(snapshot.state, input);
      // A shallow snapshot can pass the store's shape check yet still be unusable. Touch what the owning
      // runtime will need (scheduling) before committing to it, so a bad restore never poisons `this.state`.
      nextTickAt(result.state);
      // ...but shape-valid states can still be broken: validate the episode and the rundown runtime arrays
      // the views rely on, and that the snapshot actually describes the episode it claims to.
      if (!Episode.safeParse(result.state.episode).success) {
        throw new Error(`Snapshot state holds an invalid episode (episodeId "${snapshot.episodeId}")`);
      }
      if (result.state.episode.id !== snapshot.episodeId) {
        throw new Error(
          `Snapshot episodeId "${snapshot.episodeId}" does not match state episode "${result.state.episode.id}"`,
        );
      }
      const { slots, slotRt, blockRt } = result.state;
      if (!Array.isArray(slots) || !Array.isArray(slotRt) || !Array.isArray(blockRt)) {
        throw new Error('Snapshot state is missing its rundown runtime arrays');
      }
      if (slotRt.length !== slots.length) {
        throw new Error('Snapshot state slotRt does not line up with slots');
      }
      if (blockRt.length !== result.state.episode.blocks.length) {
        throw new Error('Snapshot state blockRt does not line up with episode blocks');
      }
      // Project both views on the local state (controlView calls presenterView internally); discard the
      // result, but any throw here must reject the snapshot before it is committed.
      controlView(result.state, this.deps.clock.now(), this.toWall);
      state = result.state;
      changed = result.changed;
    } catch (err) {
      this.report(err);
      return false;
    }
    this.state = state;
    this.journal = this.deps.journalFor(snapshot.episodeId);
    if (changed) this.persist(input, this.deps.clock.wall());
    this.reschedule();
    this.notify();
    return true;
  }

  dispatch(partial: WithoutAt<EngineInput>): boolean {
    if (this.disposed || this.state === null) return false;
    const input = { ...partial, at: this.deps.clock.now() } as EngineInput;
    const result = reduce(this.state, input);
    if (!result.changed) return false;
    this.state = result.state;
    this.persist(input, this.deps.clock.wall());
    try {
      this.reschedule();
    } catch (err) {
      this.report(err);
    }
    this.notify();
    return true;
  }

  command(c: ClientCommand): boolean {
    if (this.state === null) throw new NoEpisodeError();
    return this.dispatch(commandToInput(c));
  }

  presenterView(): PresenterView | null {
    return this.state === null ? null : presenterView(this.state, this.deps.clock.now(), this.toWall);
  }

  controlView(): ControlView | null {
    return this.state === null ? null : controlView(this.state, this.deps.clock.now(), this.toWall);
  }

  /** Resolves once every queued persistence job has finished. */
  flush(): Promise<void> {
    return this.persisting;
  }

  dispose(): void {
    this.cancel();
    this.listeners.clear();
    this.disposed = true;
  }

  private saveSnapshot(): Promise<void> {
    const s = this.state;
    if (s === null) return Promise.resolve();
    return this.deps.snapshots.save({ schemaVersion: 1, episodeId: s.episode.id, wallAt: this.deps.clock.wall(), state: s });
  }

  /**
   * Queue the journal append (one per input, in order) and request a snapshot save. The append and the save
   * are independent: a throwing append is reported but must never stop the snapshot, or a restart would resume
   * a stale state.
   */
  private persist(input: EngineInput, wallAt: number): void {
    const journal = this.journal;
    this.enqueue(async () => {
      try {
        await journal?.append(input, wallAt);
      } catch (err) {
        this.report(err);
      }
    });
    this.requestSnapshot();
  }

  /**
   * Queue at most one trailing snapshot save. While a save is already queued and has not started, further
   * changes coalesce into it: the save reads `this.state` when it runs, so it always writes the latest state.
   */
  private requestSnapshot(): void {
    if (this.snapshotQueued) return;
    this.snapshotQueued = true;
    this.enqueue(async () => {
      this.snapshotQueued = false;
      await this.saveSnapshot();
    });
  }

  private enqueue(job: () => Promise<void>): void {
    this.persisting = this.persisting.then(job).catch((err: unknown) => this.report(err));
  }

  private report(err: unknown): void {
    if (this.deps.onError) this.deps.onError(err);
    else console.error('[obs-live-clock]', err);
  }

  private cancel(): void {
    this.cancelTick?.();
    this.cancelTick = null;
  }

  private reschedule(): void {
    this.cancel();
    if (this.state === null) return;
    const at = nextTickAt(this.state);
    if (at === null) return;
    this.cancelTick = this.deps.scheduler.setTimer(at, () => {
      this.cancelTick = null;
      try {
        if (this.dispatch({ type: 'Tick' })) return;
        const due = this.state === null ? null : nextTickAt(this.state);
        if (due !== null && due <= this.deps.clock.now()) {
          this.report(new Error(`Tick due at ${due} changed nothing; not rescheduling`));
          return;
        }
        this.reschedule();
      } catch (err) {
        // Keep the previous state and stop: a broken tick must never crash the process or loop.
        this.report(err);
      }
    });
  }

  private notify(): void {
    for (const fn of [...this.listeners]) {
      try {
        fn();
      } catch (err) {
        this.report(err);
      }
    }
  }
}
