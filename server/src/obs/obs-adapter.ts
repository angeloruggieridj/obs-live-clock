// SPDX-License-Identifier: GPL-2.0-or-later
import type { Clock, Scheduler } from '../clock/clock';
import type { EngineInput, LiveState, OutputKind } from '../engine/index';
import type { WithoutAt } from '../runtime/commands';
import type { ObsClient, ObsData, ObsListener } from './client';
import { loadSceneGraph, visibleInputs, type SceneGraphData } from './scene-graph';

/** Output states the adapter understands. Anything else is ignored. */
type OutputState = 'started' | 'stopped' | 'paused' | 'resumed';

/** Lookup table from the obs-websocket output state to the engine's output state. */
const OUTPUT_STATE: Record<string, OutputState> = {
  OBS_WEBSOCKET_OUTPUT_STARTED: 'started',
  OBS_WEBSOCKET_OUTPUT_STOPPED: 'stopped',
  OBS_WEBSOCKET_OUTPUT_PAUSED: 'paused',
  OBS_WEBSOCKET_OUTPUT_RESUMED: 'resumed',
};

const POLL_MS = 250;
const DEBOUNCE_MS = 100;
/** Cursor drift above this (in ms) is a real seek/restart, not clock skew. */
const DRIFT_MS = 500;

interface LastMedia {
  cursorMs: number;
  playing: boolean;
  durationMs: number;
  at: number;
}

export interface ObsAdapterDeps {
  client: ObsClient;
  clock: Clock;
  scheduler: Scheduler;
  dispatch(input: WithoutAt<EngineInput>): boolean;
  getState(): LiveState | null;
  deckSourceName(): string | null;
  report(err: unknown): void;
}

/**
 * Bridges obs-websocket to the live engine: performs the initial sync when OBS connects,
 * translates OBS events into engine inputs, and polls the visible break filler.
 *
 * Every event handler and the poll loop are guarded: a failure is reported and ignored, and
 * a request rejection during the initial sync makes `start()` reject so the connection
 * reconnects with the runtime still marked `obs: 'lost'`.
 */
export class ObsAdapter {
  private sceneGraph: SceneGraphData = { scenes: new Map(), groups: new Map() };
  private scene: string | null = null;
  private listeners: Array<[string, ObsListener]> = [];
  private pollCancel: (() => void) | null = null;
  private debounceCancel: (() => void) | null = null;
  private readonly lastMedia = new Map<string, LastMedia>();
  private readonly failedInputs = new Set<string>();
  private running = false;

  constructor(private readonly deps: ObsAdapterDeps) {}

  get programScene(): string | null {
    return this.scene;
  }

  get graph(): SceneGraphData {
    return this.sceneGraph;
  }

  async start(): Promise<void> {
    this.running = true;
    // The initial sync must observe a real graph: a rejection here is reported and rethrown so
    // start() rejects, the runtime stays obs:'lost' and the connection reconnects.
    let graph: SceneGraphData;
    try {
      graph = await loadSceneGraph(this.deps.client);
    } catch (err) {
      this.deps.report(err);
      throw err;
    }
    this.sceneGraph = graph;

    const current = await this.deps.client.call('GetCurrentProgramScene');
    this.scene = this.readProgramScene(current);

    const rec = await this.deps.client.call('GetRecordStatus');
    const stream = await this.deps.client.call('GetStreamStatus');
    this.reconcileOutputs(rec, stream);

    this.deps.dispatch({ type: 'SourceRestored' });
    if (this.scene !== null) this.dispatchProgram();

    this.attach();
    this.armPoll();
  }

  /** Re-dispatches the Program scene with the current `deckOnProgram` (called when the deck's source changes). */
  refreshProgram(): void {
    this.dispatchProgram();
  }

  stop(): void {
    this.running = false;
    for (const [event, fn] of this.listeners) this.deps.client.off(event, fn);
    this.listeners = [];
    if (this.debounceCancel !== null) {
      this.debounceCancel();
      this.debounceCancel = null;
    }
    if (this.pollCancel !== null) {
      this.pollCancel();
      this.pollCancel = null;
    }
  }

  private readProgramScene(data: ObsData): string | null {
    if (typeof data.sceneName === 'string') return data.sceneName;
    if (typeof data.currentProgramSceneName === 'string') return data.currentProgramSceneName;
    this.deps.report(new Error('GetCurrentProgramScene returned no scene'));
    return null;
  }

  private reconcileOutputs(rec: ObsData, stream: ObsData): void {
    const outputs = this.deps.getState()?.outputs;
    if (outputs === undefined) return;
    this.reconcileOutput('rec', rec.outputActive === true, outputs.rec);
    this.reconcileOutput('stream', stream.outputActive === true, outputs.stream);
    const obsPaused = rec.outputPaused === true;
    if (rec.outputActive === true && obsPaused !== outputs.recPaused) {
      this.deps.dispatch({ type: 'OutputChanged', output: 'rec', state: obsPaused ? 'paused' : 'resumed' });
    }
  }

  private reconcileOutput(output: OutputKind, obsActive: boolean, runtimeActive: boolean): void {
    if (obsActive && !runtimeActive) this.deps.dispatch({ type: 'OutputChanged', output, state: 'started' });
    else if (!obsActive && runtimeActive) this.deps.dispatch({ type: 'OutputChanged', output, state: 'stopped' });
  }

  private dispatchProgram(): void {
    const scene = this.scene;
    if (scene === null) return;
    const src = this.deps.deckSourceName();
    const deckOnProgram = src !== null && visibleInputs(this.sceneGraph, scene).has(src);
    this.deps.dispatch({ type: 'ProgramSceneChanged', scene, deckOnProgram });
  }

  private attach(): void {
    const add = (event: string, fn: ObsListener) => {
      this.deps.client.on(event, fn);
      this.listeners.push([event, fn]);
    };
    add('CurrentProgramSceneChanged', (d) => this.guard(() => this.onProgramScene(d)));
    const reload = () => this.guard(() => this.scheduleGraphReload());
    add('SceneItemEnableStateChanged', reload);
    add('SceneItemCreated', reload);
    add('SceneItemRemoved', reload);
    add('SceneListChanged', reload);
    add('RecordStateChanged', (d) => this.guard(() => this.onOutput('rec', d)));
    add('StreamStateChanged', (d) => this.guard(() => this.onOutput('stream', d)));
    add('MediaInputPlaybackStarted', (d) => this.guard(() => this.onPlayback(d)));
    add('MediaInputPlaybackEnded', (d) => this.guard(() => this.onPlayback(d)));
  }

  private guard(fn: () => void): void {
    try {
      fn();
    } catch (err) {
      this.deps.report(err);
    }
  }

  private onProgramScene(data: ObsData): void {
    if (typeof data.sceneName !== 'string') {
      this.deps.report(new Error('CurrentProgramSceneChanged without sceneName'));
      return;
    }
    this.scene = data.sceneName;
    this.dispatchProgram();
  }

  private onOutput(output: OutputKind, data: ObsData): void {
    if (typeof data.outputState !== 'string') {
      this.deps.report(new Error(`${output === 'rec' ? 'RecordStateChanged' : 'StreamStateChanged'} without outputState`));
      return;
    }
    const state = OUTPUT_STATE[data.outputState];
    if (state === undefined) return;
    if (output === 'stream' && (state === 'paused' || state === 'resumed')) return;
    this.deps.dispatch({ type: 'OutputChanged', output, state });
  }

  private onPlayback(data: ObsData): void {
    const input = data.inputName;
    if (typeof input !== 'string') {
      this.deps.report(new Error('MediaInputPlayback event without inputName'));
      return;
    }
    if (!this.isPolledInput(input)) return;
    void this.pollInput(input, this.deps.clock.now()).catch((err) => this.deps.report(err));
  }

  private scheduleGraphReload(): void {
    if (this.debounceCancel !== null) this.debounceCancel();
    this.debounceCancel = this.deps.scheduler.setTimer(this.deps.clock.now() + DEBOUNCE_MS, () => {
      this.debounceCancel = null;
      void this.reloadGraph();
    });
  }

  private async reloadGraph(): Promise<void> {
    let graph: SceneGraphData;
    try {
      graph = await loadSceneGraph(this.deps.client);
    } catch (err) {
      this.deps.report(err);
      return;
    }
    if (!this.running) return;
    this.sceneGraph = graph;
    this.dispatchProgram();
  }

  private armPoll(): void {
    this.pollCancel = this.deps.scheduler.setTimer(this.deps.clock.now() + POLL_MS, () => {
      this.pollCancel = null;
      void this.poll();
    });
  }

  private async poll(): Promise<void> {
    try {
      await this.pollOnce();
    } catch (err) {
      this.deps.report(err);
    } finally {
      if (this.running) this.armPoll();
    }
  }

  private async pollOnce(): Promise<void> {
    const state = this.deps.getState();
    const scene = this.scene;
    if (state === null || scene === null) return;
    const visible = visibleInputs(this.sceneGraph, scene);
    const now = this.deps.clock.now();
    for (const input of this.breakInputs(state)) {
      if (visible.has(input)) await this.pollInput(input, now);
    }
  }

  private breakInputs(state: LiveState): string[] {
    return state.episode.blocks.flatMap((b) =>
      b.kind === 'break' && b.mediaInput !== null ? [b.mediaInput] : [],
    );
  }

  private isPolledInput(input: string): boolean {
    const state = this.deps.getState();
    const scene = this.scene;
    if (state === null || scene === null) return false;
    return this.breakInputs(state).includes(input) && visibleInputs(this.sceneGraph, scene).has(input);
  }

  private async pollInput(input: string, now: number): Promise<void> {
    let status: ObsData;
    try {
      status = await this.deps.client.call('GetMediaInputStatus', { inputName: input });
      this.failedInputs.delete(input);
    } catch (err) {
      if (!this.failedInputs.has(input)) {
        this.failedInputs.add(input);
        this.deps.report(err);
      }
      return;
    }
    const cursorMs = status.mediaCursor;
    const durationMs = status.mediaDuration;
    if (!isFiniteNumber(cursorMs) || !isFiniteNumber(durationMs)) return;
    const playing = status.mediaState === 'OBS_MEDIA_STATE_PLAYING';
    const last = this.lastMedia.get(input);
    if (last !== undefined && last.playing === playing && last.durationMs === durationMs) {
      const expected = last.cursorMs + (last.playing ? now - last.at : 0);
      if (Math.abs(cursorMs - expected) <= DRIFT_MS) return;
    }
    this.lastMedia.set(input, { cursorMs, playing, durationMs, at: now });
    this.deps.dispatch({ type: 'MediaStatus', input, playing, cursorMs, durationMs });
  }
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}
