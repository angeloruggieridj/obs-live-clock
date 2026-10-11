// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it, vi } from 'vitest';
import { SOLO_FUTSAL_DECK, soloFutsalEpisode } from '@olc/shared/testing';
import { ObsRequestError } from '../../src/obs/client';
import { ObsService } from '../../src/obs/obs-service';
import type { LiveRuntime } from '../../src/runtime/live-runtime';
import { FakeObsClient } from '../support/fake-obs';
import { makeRuntime } from '../support/runtime';
import { tempDir } from '../support/tmp';

const flush = () => new Promise((r) => setImmediate(r));

/** Wraps a runtime so `SourceRestored` can be refused, leaving the runtime `obs: 'lost'` after a sync. */
function refusingRestoreRuntime(inner: LiveRuntime, firstOnly: boolean): LiveRuntime {
  let refused = false;
  return {
    subscribe: (fn: () => void) => inner.subscribe(fn),
    getState: () => inner.getState(),
    dispatch: (input: Parameters<LiveRuntime['dispatch']>[0]) => {
      if (input.type === 'SourceRestored' && (!firstOnly || !refused)) {
        refused = true;
        return false;
      }
      return inner.dispatch(input);
    },
  } as unknown as LiveRuntime;
}

const item = (sourceName: string) => ({
  sourceName, sceneItemEnabled: true, sourceType: 'OBS_SOURCE_TYPE_INPUT', isGroup: false,
});

/** A client whose `connect` waits for a gate, so the connection can be observed mid-connect. */
class GatedConnectClient extends FakeObsClient {
  constructor(private readonly gate: Promise<void>) {
    super();
  }

  override async connect(url: string, password: string | undefined): Promise<{ obsWebSocketVersion: string; negotiatedRpcVersion: number }> {
    await this.gate;
    return super.connect(url, password);
  }
}

const vendor = (eventType: string, eventData: Record<string, unknown>) => ({
  vendorName: 'obs-playlist-deck', eventType, eventData,
});

interface SetupOpts {
  deckAbsent?: boolean;
  /** When set, the service's runtime refuses `SourceRestored`, so the state can stay lost after a sync. */
  refuseSourceRestored?: 'always' | 'first';
  /** When set, the first client's `connect` waits for this promise, so the connection can be observed mid-connect. */
  firstConnectGate?: Promise<void>;
}

async function setup(opts: SetupOpts = {}) {
  const h = makeRuntime(await tempDir());
  const scenes: Record<string, unknown[]> = {
    'CAM 1': [item('Camera 1')],
    PLAYOUT: [item('Deck Media')],
    BREAK: [item('Tappo')],
  };
  let getSceneListCalls = 0;
  let failGetSceneListOn: number | null = null;
  let items = SOLO_FUTSAL_DECK.map((i) => ({ ...i }));

  // Deterministic gates: a responder call whose (type, occurrence) matches a registered hold awaits it, so a
  // test can hold a sync in flight, race a load past it, then release (or reject) it.
  const holds: Array<{ type: string; occurrence: number; promise: Promise<void>; release: () => void; reject: (e: Error) => void }> = [];
  const callCounts: Record<string, number> = {};
  const waitForHold = async (type: string): Promise<void> => {
    const occurrence = (callCounts[type] = (callCounts[type] ?? 0) + 1);
    const held = holds.find((x) => x.type === type && x.occurrence === occurrence);
    if (held !== undefined) await held.promise;
  };
  const hold = (type: string, occurrence: number) => {
    let release!: () => void;
    let reject!: (e: Error) => void;
    const promise = new Promise<void>((res, rej) => {
      release = res;
      reject = rej;
    });
    holds.push({ type, occurrence, promise, release, reject });
    let settled = false;
    return {
      release: () => { if (!settled) { settled = true; release(); } },
      reject: (e: Error) => { if (!settled) { settled = true; reject(e); } },
    };
  };

  const clients: FakeObsClient[] = [];
  const clientFactory = () => {
    const obs =
      opts.firstConnectGate !== undefined && clients.length === 0
        ? new GatedConnectClient(opts.firstConnectGate)
        : new FakeObsClient();
    obs.respond('GetSceneList', async () => {
      getSceneListCalls += 1;
      if (failGetSceneListOn !== null && getSceneListCalls === failGetSceneListOn) throw new Error('socket closed');
      await waitForHold('GetSceneList');
      return { scenes: Object.keys(scenes).map((sceneName) => ({ sceneName })) };
    });
    obs.respond('GetSceneItemList', (d) => ({ sceneItems: scenes[String(d?.sceneName)] ?? [] }));
    obs.respond('GetGroupSceneItemList', () => ({ sceneItems: [] }));
    obs.respond('GetCurrentProgramScene', () => ({ sceneName: 'CAM 1' }));
    obs.respond('GetRecordStatus', () => ({ outputActive: false, outputPaused: false }));
    obs.respond('GetStreamStatus', () => ({ outputActive: false }));
    obs.respond('GetMediaInputStatus', () => ({ mediaState: 'OBS_MEDIA_STATE_PLAYING', mediaCursor: 0, mediaDuration: 180_000 }));
    obs.respond('CallVendorRequest', async (d) => {
      await waitForHold('CallVendorRequest');
      if (opts.deckAbsent) throw new ObsRequestError(600, 'vendor not found');
      if (d?.requestType === 'GetStatus') {
        return {
          responseData: {
            ok: true, pluginVersion: '1.4.0', sourceName: 'Deck Media', playlistName: 'Puntata',
            currentIndex: -1, positionMs: -1, durationMs: -1, playing: false, count: items.length,
          },
        };
      }
      const r = d?.requestData as { from: number; to: number };
      return { responseData: { ok: true, count: items.length, items: items.slice(r.from, r.to + 1) } };
    });
    clients.push(obs);
    return obs;
  };
  const serviceErrors: unknown[] = [];
  const runtime = opts.refuseSourceRestored === undefined
    ? h.runtime
    : refusingRestoreRuntime(h.runtime, opts.refuseSourceRestored === 'first');
  const service = new ObsService({
    runtime,
    clock: h.time,
    scheduler: h.time,
    clientFactory,
    report: (e) => void serviceErrors.push(e),
  });
  return {
    runtime: h.runtime,
    time: h.time,
    runtimeErrors: h.errors,
    service,
    serviceErrors,
    clients,
    hold,
    setItems: (next: typeof items) => (items = next),
    failGetSceneListOn: (n: number | null) => (failGetSceneListOn = n),
    getSceneListCalls: () => getSceneListCalls,
    current: () => clients[clients.length - 1]!,
  };
}

describe('ObsService', () => {
  it('connects, starts the deck and reports the Program scene', async () => {
    const h = await setup();
    await h.runtime.load(soloFutsalEpisode());
    h.service.setCredentials({ host: '127.0.0.1', port: 4455 });
    await flush();
    await flush();

    expect(h.service.status().connection).toBe('connected');
    expect(h.service.status().obsWebSocketVersion).toBe('5.5.0');
    expect(h.runtime.getState()?.obs).toBe('ok');
    expect(h.service.deckItems()).toEqual([
      { index: 0, path: 'D:/media/servizio1.mp4', title: 'Servizio 1', durationMs: 185_000 },
      { index: 1, path: 'D:/media/servizio2.mp4', title: 'Servizio 2', durationMs: 120_000 },
    ]);
    expect(h.service.status().deck?.capability).toBe('events');
    expect(h.runtime.getState()?.program.scene).toBe('CAM 1');
    expect(h.service.status().programScene).toBe('CAM 1');
    expect(h.service.sceneNames()).toEqual(['CAM 1', 'PLAYOUT', 'BREAK']);
  });

  it('matches the deck item when Program shows the deck source while live', async () => {
    const h = await setup();
    await h.runtime.load(soloFutsalEpisode());
    h.service.setCredentials({ host: '127.0.0.1', port: 4455 });
    await flush();
    await flush();

    h.current().emit('RecordStateChanged', { outputActive: true, outputState: 'OBS_WEBSOCKET_OUTPUT_STARTED' });
    expect(h.runtime.getState()?.phase).toBe('live');
    expect(h.runtime.getState()?.cursor).toBe(0);

    h.current().emit('CurrentProgramSceneChanged', { sceneName: 'PLAYOUT' });
    h.current().emit('VendorEvent', vendor('item-started', {
      index: 0, title: 'Servizio 1', path: 'D:/media/servizio1.mp4', durationMs: 185_000,
    }));

    expect(h.runtime.getState()?.cursor).toBe(1);
  });

  it('dispatches SourceLost and reports the estimated anchor when OBS disconnects', async () => {
    const h = await setup();
    await h.runtime.load(soloFutsalEpisode());
    h.service.setCredentials({ host: '127.0.0.1', port: 4455 });
    await flush();
    await flush();

    h.current().emit('RecordStateChanged', { outputActive: true, outputState: 'OBS_WEBSOCKET_OUTPUT_STARTED' });
    h.current().emit('ConnectionClosed', { code: 1001 });
    await flush();

    expect(h.runtime.getState()?.obs).toBe('lost');
    expect(h.runtime.presenterView()?.block?.anchor).toMatchObject({ source: 'estimated' });
    expect(h.service.status().connection).toBe('disconnected');
    // The adapters are gone until the reconnect: nothing stale is exposed.
    expect(h.service.client()).toBeNull();
    expect(h.service.sceneNames()).toBeNull();
    expect(h.service.deckItems()).toBeNull();
    expect(h.service.status().programScene).toBeNull();
  });

  it('reconnects after 500 ms with fresh adapters and restores obs', async () => {
    const h = await setup();
    await h.runtime.load(soloFutsalEpisode());
    h.service.setCredentials({ host: '127.0.0.1', port: 4455 });
    await flush();
    await flush();

    const first = h.current();
    first.emit('ConnectionClosed', { code: 1001 });
    await flush();
    expect(h.service.status().connection).toBe('disconnected');

    h.time.advance(500);
    await flush();
    await flush();

    expect(h.service.status().connection).toBe('connected');
    expect(h.runtime.getState()?.obs).toBe('ok');
    expect(h.clients.length).toBe(2);
    expect(h.current()).not.toBe(first);
    expect(h.service.deckItems()).not.toBeNull();
  });

  it('connects without the deck vendor and still reports the Program scene', async () => {
    const h = await setup({ deckAbsent: true });
    await h.runtime.load(soloFutsalEpisode());
    h.service.setCredentials({ host: '127.0.0.1', port: 4455 });
    await flush();
    await flush();

    expect(h.service.status().connection).toBe('connected');
    expect(h.service.status().deck?.capability).toBe('absent');
    expect(h.service.deckItems()).toBeNull();
    expect(h.runtime.getState()?.obs).toBe('ok');
    expect(h.runtime.getState()?.program.scene).toBe('CAM 1');
  });

  it('resyncs the adapters when an episode is loaded while connected', async () => {
    const h = await setup();
    await h.runtime.load(soloFutsalEpisode());
    h.service.setCredentials({ host: '127.0.0.1', port: 4455 });
    await flush();
    await flush();
    expect(h.runtime.getState()?.obs).toBe('ok');

    // load() resets the runtime to obs:'lost' (while OBS stays connected); the service's subscription
    // resyncs the adapters, so the state is reconciled again by the time load() resolves.
    await h.runtime.load(soloFutsalEpisode());
    await flush();
    await flush();
    expect(h.runtime.getState()?.obs).toBe('ok');
    expect(h.runtime.getState()?.program.scene).toBe('CAM 1');
    expect(h.service.deckItems()).not.toBeNull();
  });

  it('forces a reconnect when an episode-load resync fails, so obs cannot stay lost', async () => {
    const h = await setup();
    await h.runtime.load(soloFutsalEpisode());
    h.service.setCredentials({ host: '127.0.0.1', port: 4455 });
    await flush();
    await flush();
    expect(h.runtime.getState()?.obs).toBe('ok');
    expect(h.getSceneListCalls()).toBe(1);

    h.failGetSceneListOn(2);
    await h.runtime.load(soloFutsalEpisode());
    await flush();
    await flush();
    await flush();

    expect(h.clients.length).toBe(2);
    expect(h.service.status().connection).toBe('connected');
    expect(h.runtime.getState()?.obs).toBe('ok');
    expect(h.runtime.getState()?.program.scene).toBe('CAM 1');
    expect(h.getSceneListCalls()).toBe(3);
  });

  it('stops the connection and adapters and dispatches nothing afterwards', async () => {
    const h = await setup();
    await h.runtime.load(soloFutsalEpisode());
    h.service.setCredentials({ host: '127.0.0.1', port: 4455 });
    await flush();
    await flush();

    await h.service.stop();
    expect(h.service.status().connection).toBe('idle');
    expect(h.time.pending).toBe(0);

    const before = h.runtime.getState();
    h.current().emit('RecordStateChanged', { outputActive: true, outputState: 'OBS_WEBSOCKET_OUTPUT_STARTED' });
    h.current().emit('CurrentProgramSceneChanged', { sceneName: 'BREAK' });
    await flush();
    expect(h.runtime.getState()).toBe(before);
  });

  it('resyncs an episode loaded while the adapter is starting', async () => {
    const h = await setup();
    await h.runtime.load(soloFutsalEpisode());
    const held = h.hold('GetSceneList', 1); // hold the initial sync
    h.service.setCredentials({ host: '127.0.0.1', port: 4455 });
    await flush();
    await h.runtime.load(soloFutsalEpisode()); // a load races the start
    await flush();
    held.release();
    await flush();
    await flush();

    expect(h.runtime.getState()?.obs).toBe('ok');
    expect(h.runtime.getState()?.program.scene).toBe('CAM 1');
    expect(h.service.deckItems()).not.toBeNull();
  });

  it('re-checks after the start and resyncs when the runtime is still lost', async () => {
    const h = await setup({ refuseSourceRestored: 'first' });
    await h.runtime.load(soloFutsalEpisode());
    const held = h.hold('GetSceneList', 1);
    h.service.setCredentials({ host: '127.0.0.1', port: 4455 });
    await flush();
    await h.runtime.load(soloFutsalEpisode()); // the load that the start's sync did not reconcile
    await flush();
    held.release();
    await flush();
    await flush();

    expect(h.runtime.getState()?.obs).toBe('ok');
    expect(h.runtime.getState()?.program.scene).toBe('CAM 1');
  });

  it('resyncs again when another episode is loaded while a resync is running', async () => {
    const h = await setup();
    await h.runtime.load(soloFutsalEpisode());
    h.service.setCredentials({ host: '127.0.0.1', port: 4455 });
    await flush();
    await flush();
    expect(h.runtime.getState()?.obs).toBe('ok');

    const held = h.hold('CallVendorRequest', 3); // the first resync's deck half
    await h.runtime.load(soloFutsalEpisode());
    await flush();
    await h.runtime.load(soloFutsalEpisode()); // a second load while the resync is in flight
    await flush();
    held.release();
    await flush();
    await flush();

    expect(h.runtime.getState()?.obs).toBe('ok');
    expect(h.runtime.getState()?.program.scene).toBe('CAM 1');
  });

  it('does not loop when the runtime stays lost after a resync', async () => {
    const h = await setup({ refuseSourceRestored: 'always' });
    await h.runtime.load(soloFutsalEpisode());
    h.service.setCredentials({ host: '127.0.0.1', port: 4455 });
    await flush();
    await flush();

    // The initial start sync plus exactly one follow-up resync, then it stops and reports once.
    expect(h.getSceneListCalls()).toBe(2);
    expect(h.serviceErrors.some((e) => e instanceof Error && e.message.includes('still lost'))).toBe(true);
  });

  it('does not resync when the adapter start rejected', async () => {
    const h = await setup();
    await h.runtime.load(soloFutsalEpisode());
    h.failGetSceneListOn(1);
    h.service.setCredentials({ host: '127.0.0.1', port: 4455 });
    await flush();
    await flush();
    await flush();

    // The failed start is not followed by a resync: only the initial (rejected) graph read happened.
    expect(h.getSceneListCalls()).toBe(1);
    expect(h.runtime.getState()?.obs).toBe('lost');
  });

  it('ignores a stale rejected resync so a fast reconnect is not disturbed', async () => {
    const h = await setup();
    await h.runtime.load(soloFutsalEpisode());
    h.service.setCredentials({ host: '127.0.0.1', port: 4455 });
    await flush();
    await flush();
    expect(h.runtime.getState()?.obs).toBe('ok');

    const first = h.current();
    const held = h.hold('GetSceneList', 2); // the resync's own sync
    await h.runtime.load(soloFutsalEpisode());
    await flush();

    first.emit('ConnectionClosed', { code: 1001 });
    await flush();
    h.time.advance(500);
    await flush();
    await flush();
    expect(h.service.status().connection).toBe('connected');
    expect(h.clients.length).toBe(2);

    held.reject(new Error('socket closed')); // the old resync now fails against a dead connection
    await flush();
    await flush();

    expect(h.clients.length).toBe(2);
    expect(h.service.status().connection).toBe('connected');
    expect(h.runtime.getState()?.obs).toBe('ok');
  });

  it('a stale resync does not suppress a resync on a new connection', async () => {
    const h = await setup();
    await h.runtime.load(soloFutsalEpisode());
    h.service.setCredentials({ host: '127.0.0.1', port: 4455 });
    await flush();
    await flush();
    expect(h.runtime.getState()?.obs).toBe('ok');

    const first = h.current();
    const held = h.hold('GetSceneList', 2);
    await h.runtime.load(soloFutsalEpisode());
    await flush();

    first.emit('ConnectionClosed', { code: 1001 });
    await flush();
    h.time.advance(500);
    await flush();
    await flush();
    expect(h.clients.length).toBe(2);
    expect(h.runtime.getState()?.obs).toBe('ok');

    // A load on the new connection must still trigger a resync, not be suppressed by the stale one.
    await h.runtime.load(soloFutsalEpisode());
    await flush();
    await flush();
    expect(h.runtime.getState()?.obs).toBe('ok');

    held.release();
    await flush();
  });

  it('reports a runtime read failure instead of throwing out of the subscription', async () => {
    const h = await setup();
    await h.runtime.load(soloFutsalEpisode());
    h.service.setCredentials({ host: '127.0.0.1', port: 4455 });
    await flush();
    await flush();

    const boom = new Error('getState exploded');
    const spy = vi.spyOn(h.runtime, 'getState').mockImplementation(() => {
      throw boom;
    });
    h.runtime.dispatch({ type: 'ProgramSceneChanged', scene: 'BREAK', deckOnProgram: false });
    await flush();
    spy.mockRestore();

    expect(h.serviceErrors).toContain(boom);
  });

  it('never includes the password in the status snapshot', async () => {
    const h = await setup();
    await h.runtime.load(soloFutsalEpisode());
    h.service.setCredentials({ host: '127.0.0.1', port: 4455, password: 'hunter2-secret' });
    await flush();
    await flush();

    expect(JSON.stringify(h.service.status())).not.toContain('hunter2-secret');
  });

  it('ignores identical credentials while connected so the connection is not dropped', async () => {
    const h = await setup();
    await h.runtime.load(soloFutsalEpisode());
    h.service.setCredentials({ host: '127.0.0.1', port: 4455, password: 'pw' });
    await flush();
    await flush();
    expect(h.service.status().connection).toBe('connected');
    const first = h.current();
    const before = h.clients.length;

    h.service.setCredentials({ host: '127.0.0.1', port: 4455, password: 'pw' });
    await flush();
    await flush();

    expect(h.service.status().connection).toBe('connected');
    expect(h.clients.length).toBe(before);
    expect(h.current()).toBe(first);
    expect(h.runtime.getState()?.obs).toBe('ok');
  });

  it('ignores identical credentials while connecting so the attempt is not restarted', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const h = await setup({ firstConnectGate: gate });
    await h.runtime.load(soloFutsalEpisode());
    h.service.setCredentials({ host: '127.0.0.1', port: 4455 });
    await flush();
    expect(h.service.status().connection).toBe('connecting');
    expect(h.clients.length).toBe(1);

    h.service.setCredentials({ host: '127.0.0.1', port: 4455 });
    await flush();
    expect(h.clients.length).toBe(1);

    release();
    await flush();
    await flush();
    expect(h.service.status().connection).toBe('connected');
    expect(h.runtime.getState()?.obs).toBe('ok');
  });
});
