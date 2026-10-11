// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import { soloFutsalEpisode } from '@olc/shared/testing';
import { FakeTime } from '../../src/clock/clock';
import { createLiveState, type EngineInput, type LiveState } from '../../src/engine/index';
import { ObsAdapter } from '../../src/obs/obs-adapter';
import type { WithoutAt } from '../../src/runtime/commands';
import { FakeObsClient } from '../support/fake-obs';
import { makeRuntime } from '../support/runtime';
import { tempDir } from '../support/tmp';

const flush = () => new Promise((r) => setImmediate(r));
const item = (sourceName: string, extra: Record<string, unknown> = {}) => ({
  sourceName, sceneItemEnabled: true, sourceType: 'OBS_SOURCE_TYPE_INPUT', isGroup: false, ...extra,
});

function setup(opts: {
  rec?: boolean;
  runtimeRec?: boolean;
  dispatch?: (input: WithoutAt<EngineInput>) => boolean;
} = {}) {
  const time = new FakeTime();
  const obs = new FakeObsClient();
  const scenes: Record<string, unknown[]> = {
    'CAM 1': [item('Camera 1')],
    PLAYOUT: [item('Deck Media')],
    BREAK: [item('Tappo')],
  };
  let program = 'CAM 1';
  obs.respond('GetSceneList', () => ({ scenes: Object.keys(scenes).map((sceneName) => ({ sceneName })) }));
  obs.respond('GetSceneItemList', (d) => ({ sceneItems: scenes[String(d?.sceneName)] ?? [] }));
  obs.respond('GetGroupSceneItemList', () => ({ sceneItems: [] }));
  obs.respond('GetCurrentProgramScene', () => ({ sceneName: program, currentProgramSceneName: program }));
  obs.respond('GetRecordStatus', () => ({ outputActive: opts.rec ?? false, outputPaused: false }));
  obs.respond('GetStreamStatus', () => ({ outputActive: false }));
  const media = { mediaState: 'OBS_MEDIA_STATE_PLAYING', mediaCursor: 0, mediaDuration: 180_000 };
  obs.respond('GetMediaInputStatus', () => ({ ...media }));
  const state: LiveState = createLiveState(soloFutsalEpisode());
  if (opts.runtimeRec) state.outputs.rec = true;
  const dispatched: Array<Record<string, unknown>> = [];
  const errors: unknown[] = [];
  const record = (input: WithoutAt<EngineInput>): boolean => {
    if (opts.dispatch !== undefined) return opts.dispatch(input);
    dispatched.push(input as Record<string, unknown>);
    return true;
  };
  const adapter = new ObsAdapter({
    client: obs, clock: time, scheduler: time,
    dispatch: record,
    getState: () => state,
    deckSourceName: () => 'Deck Media',
    report: (e) => void errors.push(e),
  });
  return { time, obs, adapter, dispatched, errors, media, setProgram: (p: string) => (program = p), scenes };
}

const types = (d: Array<Record<string, unknown>>) => d.map((x) => x.type);

describe('ObsAdapter', () => {
  it('syncs, then restores the source, then reports the Program scene', async () => {
    const h = setup();
    await h.adapter.start();
    expect(types(h.dispatched)).toEqual(['SourceRestored', 'ProgramSceneChanged']);
    expect(h.dispatched[1]).toEqual({ type: 'ProgramSceneChanged', scene: 'CAM 1', deckOnProgram: false });
  });

  it('reconciles outputs: OBS recording while the runtime is not, and the reverse', async () => {
    const a = setup({ rec: true });
    await a.adapter.start();
    expect(a.dispatched[0]).toEqual({ type: 'OutputChanged', output: 'rec', state: 'started' });
    const b = setup({ rec: false, runtimeRec: true });
    await b.adapter.start();
    expect(b.dispatched[0]).toEqual({ type: 'OutputChanged', output: 'rec', state: 'stopped' });
  });

  it('maps scene and output events, computing deckOnProgram from the scene graph', async () => {
    const h = setup();
    await h.adapter.start();
    h.dispatched.length = 0;
    h.obs.emit('CurrentProgramSceneChanged', { sceneName: 'PLAYOUT' });
    h.obs.emit('RecordStateChanged', { outputActive: true, outputState: 'OBS_WEBSOCKET_OUTPUT_STARTING' });
    h.obs.emit('RecordStateChanged', { outputActive: true, outputState: 'OBS_WEBSOCKET_OUTPUT_STARTED' });
    h.obs.emit('StreamStateChanged', { outputActive: false, outputState: 'OBS_WEBSOCKET_OUTPUT_STOPPED' });
    expect(h.dispatched).toEqual([
      { type: 'ProgramSceneChanged', scene: 'PLAYOUT', deckOnProgram: true },
      { type: 'OutputChanged', output: 'rec', state: 'started' },
      { type: 'OutputChanged', output: 'stream', state: 'stopped' },
    ]);
  });

  it('reloads the graph (debounced) when scene items change and re-reports Program', async () => {
    const h = setup();
    await h.adapter.start();
    h.dispatched.length = 0;
    h.scenes['CAM 1'] = [item('Camera 1'), item('Deck Media')];
    h.obs.emit('SceneItemEnableStateChanged', { sceneName: 'CAM 1', sceneItemId: 2, sceneItemEnabled: true });
    h.obs.emit('SceneItemCreated', { sceneName: 'CAM 1', sourceName: 'Deck Media' });
    h.time.advance(100);
    await flush();
    await flush();
    expect(h.dispatched).toEqual([{ type: 'ProgramSceneChanged', scene: 'CAM 1', deckOnProgram: true }]);
  });

  it('does not re-dispatch ProgramSceneChanged when a graph reload leaves deckOnProgram unchanged', async () => {
    const h = setup();
    await h.adapter.start();
    h.dispatched.length = 0;
    // A change to an item that is not the deck source leaves deckOnProgram at false.
    h.obs.emit('SceneItemEnableStateChanged', { sceneName: 'CAM 1', sceneItemId: 1, sceneItemEnabled: false });
    h.time.advance(100);
    await flush();
    await flush();
    expect(h.dispatched).toEqual([]);
  });

  it('polls the visible break filler and deduplicates by extrapolation', async () => {
    const h = setup();
    await h.adapter.start();
    h.obs.emit('CurrentProgramSceneChanged', { sceneName: 'BREAK' });
    h.dispatched.length = 0;
    h.time.advance(250);
    await flush();
    expect(h.dispatched).toEqual([{ type: 'MediaStatus', input: 'Tappo', playing: true, cursorMs: 0, durationMs: 180_000 }]);
    for (let i = 1; i <= 8; i++) {
      h.media.mediaCursor = i * 250;
      h.time.advance(250);
      await flush();
    }
    expect(h.dispatched).toHaveLength(1);
    h.media.mediaCursor = 10_000;
    h.time.advance(250);
    await flush();
    expect(h.dispatched).toHaveLength(2);
    h.media.mediaState = 'OBS_MEDIA_STATE_PAUSED';
    h.time.advance(250);
    await flush();
    expect(h.dispatched.at(-1)).toMatchObject({ type: 'MediaStatus', playing: false });
  });

  it('never dispatches guessed media values and never crashes on bad data', async () => {
    const h = setup();
    await h.adapter.start();
    h.obs.emit('CurrentProgramSceneChanged', { sceneName: 'BREAK' });
    h.dispatched.length = 0;
    h.media.mediaCursor = null as unknown as number;
    h.time.advance(250);
    await flush();
    h.obs.emit('CurrentProgramSceneChanged', { nope: true });
    h.obs.emit('RecordStateChanged', {});
    expect(h.dispatched).toEqual([]);
  });

  it('stop() detaches listeners and timers', async () => {
    const h = setup();
    await h.adapter.start();
    h.adapter.stop();
    expect(h.obs.listenerCount('CurrentProgramSceneChanged')).toBe(0);
    expect(h.time.pending).toBe(0);
  });

  it('dispatches nothing and attaches nothing when stopped while the initial sync is pending', async () => {
    const h = setup();
    let releaseRecord: (value: Record<string, unknown>) => void = () => {};
    h.obs.respond('GetRecordStatus', () => new Promise<Record<string, unknown>>((resolve) => { releaseRecord = resolve; }));
    const started = h.adapter.start();
    await flush();
    await flush();
    h.adapter.stop();
    releaseRecord({ outputActive: false, outputPaused: false });
    await started;
    expect(h.dispatched).toEqual([]);
    expect(h.obs.listenerCount('CurrentProgramSceneChanged')).toBe(0);
    expect(h.time.pending).toBe(0);
  });

  it('does not dispatch a media status that resolves after stop()', async () => {
    const h = setup();
    await h.adapter.start();
    h.obs.emit('CurrentProgramSceneChanged', { sceneName: 'BREAK' });
    h.dispatched.length = 0;
    let releaseMedia: (value: Record<string, unknown>) => void = () => {};
    h.obs.respond('GetMediaInputStatus', () => new Promise<Record<string, unknown>>((resolve) => { releaseMedia = resolve; }));
    h.time.advance(250);
    await flush();
    h.adapter.stop();
    releaseMedia({ mediaState: 'OBS_MEDIA_STATE_PLAYING', mediaCursor: 0, mediaDuration: 180_000 });
    await flush();
    await flush();
    expect(h.dispatched).toEqual([]);
  });

  it('treats a missing Program scene name as a failed sync', async () => {
    const h = setup();
    h.obs.respond('GetCurrentProgramScene', () => ({}));
    await expect(h.adapter.start()).rejects.toThrow();
    expect(h.dispatched).toEqual([]);
    expect(h.errors).toHaveLength(1);
    expect(h.obs.listenerCount('CurrentProgramSceneChanged')).toBe(0);
    expect(h.time.pending).toBe(0);
  });

  it('resets running when start rejects, so a later resync is a no-op', async () => {
    const h = setup();
    h.obs.respond('GetCurrentProgramScene', () => ({}));
    await expect(h.adapter.start()).rejects.toThrow();
    h.obs.respond('GetCurrentProgramScene', () => ({ sceneName: 'CAM 1' }));

    await h.adapter.resync();

    expect(h.dispatched).toEqual([]);
    expect(h.obs.listenerCount('CurrentProgramSceneChanged')).toBe(0);
    expect(h.time.pending).toBe(0);
  });

  it('records lastMedia only when the dispatch is accepted', async () => {
    let drop = true;
    const accepted: Array<Record<string, unknown>> = [];
    const h = setup({
      dispatch: (input) => {
        if (input.type === 'MediaStatus') {
          if (drop) {
            drop = false;
            return false;
          }
          accepted.push(input as Record<string, unknown>);
        }
        return true;
      },
    });
    await h.adapter.start();
    h.obs.emit('CurrentProgramSceneChanged', { sceneName: 'BREAK' });
    h.time.advance(250);
    await flush();
    expect(accepted).toEqual([]);
    h.time.advance(250);
    await flush();
    expect(accepted).toEqual([{ type: 'MediaStatus', input: 'Tappo', playing: true, cursorMs: 0, durationMs: 180_000 }]);
  });

  it('resync re-runs the sync without re-attaching and clears lastMedia', async () => {
    const h = makeRuntime(await tempDir());
    const obs = new FakeObsClient();
    const scenes: Record<string, unknown[]> = {
      'CAM 1': [item('Camera 1')],
      BREAK: [item('Tappo')],
    };
    obs.respond('GetSceneList', () => ({ scenes: Object.keys(scenes).map((sceneName) => ({ sceneName })) }));
    obs.respond('GetSceneItemList', (d) => ({ sceneItems: scenes[String(d?.sceneName)] ?? [] }));
    obs.respond('GetGroupSceneItemList', () => ({ sceneItems: [] }));
    obs.respond('GetCurrentProgramScene', () => ({ sceneName: 'BREAK' }));
    let recActive = false;
    obs.respond('GetRecordStatus', () => ({ outputActive: recActive, outputPaused: false }));
    obs.respond('GetStreamStatus', () => ({ outputActive: false }));
    obs.respond('GetMediaInputStatus', () => ({ mediaState: 'OBS_MEDIA_STATE_PLAYING', mediaCursor: 0, mediaDuration: 180_000 }));
    const mediaInputs: string[] = [];
    const adapter = new ObsAdapter({
      client: obs, clock: h.time, scheduler: h.time,
      dispatch: (input) => {
        if (input.type === 'MediaStatus') mediaInputs.push(input.input);
        return h.runtime.dispatch(input);
      },
      getState: () => h.runtime.getState(),
      deckSourceName: () => 'Deck Media',
      report: (e) => void h.errors.push(e),
    });

    await h.runtime.load(soloFutsalEpisode());
    expect(h.runtime.getState()?.obs).toBe('lost');

    await adapter.start();
    expect(h.runtime.getState()?.obs).toBe('ok');
    expect(h.runtime.getState()?.program.scene).toBe('BREAK');
    h.time.advance(250);
    await flush();
    expect(mediaInputs).toEqual(['Tappo']);

    // A fresh episode load resets the runtime to obs:'lost' while OBS stays connected: resync must restore it.
    await h.runtime.load(soloFutsalEpisode());
    expect(h.runtime.getState()?.obs).toBe('lost');
    expect(h.runtime.getState()?.program.scene).toBeNull();
    recActive = true;
    await adapter.resync();

    expect(h.runtime.getState()?.obs).toBe('ok');
    expect(h.runtime.getState()?.program.scene).toBe('BREAK');
    expect(h.runtime.getState()?.outputs.rec).toBe(true);
    h.time.advance(250);
    await flush();
    expect(mediaInputs).toEqual(['Tappo', 'Tappo']);
    // resync never re-attaches listeners.
    expect(obs.listenerCount('CurrentProgramSceneChanged')).toBe(1);
  });
});
