// SPDX-License-Identifier: GPL-2.0-or-later
import type { ClientCommand, Episode } from '@olc/shared';
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
  private readonly listeners = new Set<() => void>();
  private persisting: Promise<void> = Promise.resolve();

  constructor(private readonly deps: RuntimeDeps) {}

  readonly toWall = (mono: number): number => mono + (this.deps.clock.wall() - this.deps.clock.now());

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
    if (this.state?.phase === 'live') throw new LiveRunningError(this.state.episode.id);
    this.state = createLiveState(episode);
    this.journal = this.deps.journalFor(episode.id);
    this.enqueue(() => this.saveSnapshot());
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
    let snapshot;
    try {
      snapshot = await this.deps.snapshots.load();
    } catch (err) {
      this.report(err);
      return false;
    }
    if (snapshot === undefined) return false;
    this.state = snapshot.state;
    this.journal = this.deps.journalFor(snapshot.episodeId);
    // OBS is unknown until the adapter reconnects: everything is estimated meanwhile.
    this.dispatch({ type: 'SourceLost' });
    this.reschedule();
    this.notify();
    return true;
  }

  dispatch(partial: WithoutAt<EngineInput>): boolean {
    if (this.state === null) return false;
    const input = { ...partial, at: this.deps.clock.now() } as EngineInput;
    const result = reduce(this.state, input);
    if (!result.changed) return false;
    this.state = result.state;
    const journal = this.journal;
    const wallAt = this.deps.clock.wall();
    this.enqueue(async () => {
      await journal?.append(input, wallAt);
      await this.saveSnapshot();
    });
    this.reschedule();
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
  }

  private saveSnapshot(): Promise<void> {
    const s = this.state;
    if (s === null) return Promise.resolve();
    return this.deps.snapshots.save({ schemaVersion: 1, episodeId: s.episode.id, wallAt: this.deps.clock.wall(), state: s });
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
      if (this.dispatch({ type: 'Tick' })) return;
      const due = this.state === null ? null : nextTickAt(this.state);
      if (due !== null && due <= this.deps.clock.now()) {
        this.report(new Error(`Tick due at ${due} changed nothing; not rescheduling`));
        return;
      }
      this.reschedule();
    });
  }

  private notify(): void {
    for (const fn of [...this.listeners]) fn();
  }
}
