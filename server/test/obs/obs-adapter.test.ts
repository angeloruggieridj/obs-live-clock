// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import { soloFutsalEpisode } from '@olc/shared/testing';
import { FakeTime } from '../../src/clock/clock';
import { createLiveState, type LiveState } from '../../src/engine/index';
import { ObsAdapter } from '../../src/obs/obs-adapter';
import { FakeObsClient } from '../support/fake-obs';

const flush = () => new Promise((r) => setImmediate(r));
const item = (sourceName: string, extra: Record<string, unknown> = {}) => ({
  sourceName, sceneItemEnabled: true, sourceType: 'OBS_SOURCE_TYPE_INPUT', isGroup: false, ...extra,
});

function setup(opts: { rec?: boolean; runtimeRec?: boolean } = {}) {
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
  const adapter = new ObsAdapter({
    client: obs, clock: time, scheduler: time,
    dispatch: (i) => { dispatched.push(i as Record<string, unknown>); return true; },
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
});
