// SPDX-License-Identifier: GPL-2.0-or-later
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { soloFutsalFormat } from '@olc/shared/testing';
import type { BuiltServer } from '../../src/app/server';
import { FakeTime } from '../../src/clock/clock';
import { ObsRequestError } from '../../src/obs/client';
import { FakeObsClient } from '../support/fake-obs';
import { buildTestServer } from '../support/server';
import { tempDir } from '../support/tmp';

const flush = () => new Promise((resolve) => setImmediate(resolve));

const settle = async (): Promise<void> => {
  for (let i = 0; i < 3; i++) await flush();
};

const SCENES = ['CAM 1', 'CAM 2', 'CAM 3', 'PLAYOUT', 'BREAK'];
const SCENE_ITEMS: Record<string, unknown[]> = {
  'CAM 1': [{ sourceName: 'Camera 1', sceneItemEnabled: true, sourceType: 'OBS_SOURCE_TYPE_INPUT', isGroup: false }],
  'CAM 2': [],
  'CAM 3': [],
  PLAYOUT: [{ sourceName: 'Deck Media', sceneItemEnabled: true, sourceType: 'OBS_SOURCE_TYPE_INPUT', isGroup: false }],
  BREAK: [{ sourceName: 'Tappo', sceneItemEnabled: true, sourceType: 'OBS_SOURCE_TYPE_INPUT', isGroup: false }],
};
const DEFAULT_DECK_ITEMS = [
  { index: 0, path: 'D:/media/servizio1.mp4', title: 'Servizio 1', durationMs: 185_000 },
  { index: 1, path: 'D:/media/servizio2.mp4', title: 'Servizio 2', durationMs: 120_000 },
];

interface FakeConfig {
  /** Scene names returned by `GetSceneList`. Defaults to the full Solo Futsal set. */
  scenes?: string[];
  /** Input names returned by `GetInputList`. Defaults to the Solo Futsal set. */
  inputs?: string[];
  /** Deck items returned by the vendor `GetItems`. */
  deckItems?: typeof DEFAULT_DECK_ITEMS;
  /** When false the vendor answers every `CallVendorRequest` with a 600 error (plugin absent). */
  deckPresent?: boolean;
  /** Plugin version reported by the vendor `GetStatus`. Defaults to `1.4.0` (events). */
  deckVersion?: string;
  /** When true the first client fails to connect once, so the connection starts `disconnected`. */
  failFirstConnect?: boolean;
}

function configure(obs: FakeObsClient, cfg: FakeConfig): void {
  const scenes = cfg.scenes ?? SCENES;
  const inputs = cfg.inputs ?? ['Tappo', 'Deck Media'];
  const deckItems = cfg.deckItems ?? DEFAULT_DECK_ITEMS;
  const deckPresent = cfg.deckPresent ?? true;
  const deckVersion = cfg.deckVersion ?? '1.4.0';
  obs.respond('GetSceneList', () => ({ scenes: scenes.map((sceneName) => ({ sceneName })) }));
  obs.respond('GetSceneItemList', (d) => ({ sceneItems: SCENE_ITEMS[String(d?.sceneName)] ?? [] }));
  obs.respond('GetGroupSceneItemList', () => ({ sceneItems: [] }));
  obs.respond('GetCurrentProgramScene', () => ({ sceneName: 'CAM 1' }));
  obs.respond('GetRecordStatus', () => ({ outputActive: false, outputPaused: false }));
  obs.respond('GetStreamStatus', () => ({ outputActive: false }));
  obs.respond('GetInputList', () => ({ inputs: inputs.map((inputName) => ({ inputName })) }));
  obs.respond('GetMediaInputStatus', () => ({ mediaState: 'OBS_MEDIA_STATE_STOPPED', mediaCursor: 0, mediaDuration: 0 }));
  obs.respond('CallVendorRequest', (d) => {
    if (!deckPresent) throw new ObsRequestError(600, 'vendor not found');
    if (d?.requestType === 'GetStatus') {
      return {
        responseData: {
          ok: true,
          pluginVersion: deckVersion,
          sourceName: 'Deck Media',
          playlistName: 'Puntata',
          currentIndex: -1,
          positionMs: -1,
          durationMs: -1,
          playing: false,
          count: deckItems.length,
        },
      };
    }
    const range = d?.requestData as { from: number; to: number };
    return { responseData: { ok: true, count: deckItems.length, items: deckItems.slice(range.from, range.to + 1) } };
  });
}

interface Harness extends BuiltServer {
  dir: string;
  time: FakeTime;
  clients: FakeObsClient[];
  current(): FakeObsClient;
}

const apps: Array<{ close(): Promise<unknown> }> = [];
afterEach(async () => {
  while (apps.length > 0) await apps.pop()!.close();
});

async function boot(cfg: FakeConfig = {}, options: { connect?: boolean } = {}): Promise<Harness> {
  const connect = options.connect ?? true;
  const dir = await tempDir();
  const time = new FakeTime();
  const clients: FakeObsClient[] = [];
  let attempts = 0;
  const factory = (): FakeObsClient => {
    const client = new FakeObsClient();
    configure(client, cfg);
    if (cfg.failFirstConnect === true && attempts++ === 0) client.connectError = new Error('connection refused');
    clients.push(client);
    return client;
  };
  const server = await buildTestServer({
    dataDir: dir,
    clock: time,
    scheduler: time,
    heartbeatMs: 40,
    obsClientFactory: factory,
  });
  apps.push(server.app);
  const h: Harness = { ...server, dir, time, clients, current: () => clients[clients.length - 1]! };
  await createEpisode(server.app);
  if (connect) {
    // The runtime must hold an episode before OBS connects, or `DeckPlaylistChanged` is refused and the deck
    // items stay unknown.
    await server.app.inject({ method: 'POST', url: '/api/live/load', payload: { episodeId: 'ep-1' } });
    await postCredentials(h);
  }
  await settle();
  return h;
}

async function postCredentials(h: Harness): Promise<void> {
  const token = (await readFile(join(h.dir, 'secret.token'), 'utf8')).trim();
  const res = await h.app.inject({
    method: 'POST',
    url: '/api/internal/obs-credentials',
    headers: { authorization: `Bearer ${token}` },
    payload: { host: '127.0.0.1', port: 4455 },
  });
  expect(res.statusCode).toBe(204);
  await settle();
}

async function createEpisode(app: BuiltServer['app'], id = 'ep-1'): Promise<void> {
  await app.inject({ method: 'POST', url: '/api/formats', payload: soloFutsalFormat() });
  await app.inject({
    method: 'POST',
    url: '/api/formats/solo-futsal/episodes',
    payload: { id, date: '2026-10-12', plannedStart: null, playlistName: null },
  });
}

describe('GET /api/obs/status', () => {
  it('reports the connection while disconnected and then connected', async () => {
    const h = await boot({ failFirstConnect: true }, { connect: false });
    await postCredentials(h);
    const before = (await h.app.inject({ method: 'GET', url: '/api/obs/status' })).json();
    expect(before).toEqual({ connection: 'disconnected', obsWebSocketVersion: null, programScene: null, deck: null });

    h.time.advance(500);
    await settle();

    const after = (await h.app.inject({ method: 'GET', url: '/api/obs/status' })).json();
    expect(after).toEqual({
      connection: 'connected',
      obsWebSocketVersion: '5.5.0',
      programScene: 'CAM 1',
      deck: { capability: 'events', version: '1.4.0', sourceName: 'Deck Media', playlistName: 'Puntata' },
    });
  });
});

describe('GET /api/obs/scenes', () => {
  it('returns 409 before connecting and lists the scenes once connected', async () => {
    const h = await boot({}, { connect: false });
    const before = await h.app.inject({ method: 'GET', url: '/api/obs/scenes' });
    expect(before.statusCode).toBe(409);
    expect(before.json()).toEqual({ error: 'obs_not_connected' });

    await postCredentials(h);

    const after = await h.app.inject({ method: 'GET', url: '/api/obs/scenes' });
    expect(after.statusCode).toBe(200);
    expect(after.json()).toEqual({ scenes: SCENES });
  });
});

describe('GET /api/deck/items', () => {
  it('returns the items with their per-path occurrence', async () => {
    const h = await boot({
      deckItems: [
        { index: 0, path: 'D:/media/a.mp4', title: 'A 1', durationMs: 1_000 },
        { index: 1, path: 'D:/media/a.mp4', title: 'A 2', durationMs: 2_000 },
        { index: 2, path: 'D:/media/b.mp4', title: 'B 1', durationMs: 3_000 },
      ],
    });
    const res = await h.app.inject({ method: 'GET', url: '/api/deck/items' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      items: [
        { index: 0, path: 'D:/media/a.mp4', title: 'A 1', durationMs: 1_000, occurrence: 0 },
        { index: 1, path: 'D:/media/a.mp4', title: 'A 2', durationMs: 2_000, occurrence: 1 },
        { index: 2, path: 'D:/media/b.mp4', title: 'B 1', durationMs: 3_000, occurrence: 0 },
      ],
    });
  });

  it('returns 409 while OBS is not connected', async () => {
    const h = await boot({}, { connect: false });
    const res = await h.app.inject({ method: 'GET', url: '/api/deck/items' });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ error: 'obs_not_connected' });
  });

  it('returns 404 when the deck plugin is absent', async () => {
    const h = await boot({ deckPresent: false });
    const res = await h.app.inject({ method: 'GET', url: '/api/deck/items' });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: 'deck_absent' });
  });

  it('returns 409 deck_not_ready when the deck is present but its items are not read yet', async () => {
    // Connect without loading an episode first: `DeckPlaylistChanged` is refused, so the items stay unknown
    // even though the plugin is present.
    const h = await boot({}, { connect: false });
    await postCredentials(h);
    const res = await h.app.inject({ method: 'GET', url: '/api/deck/items' });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ error: 'deck_not_ready' });
  });
});

describe('POST /api/obs/check', () => {
  it('returns no issues against a complete OBS', async () => {
    const h = await boot();
    const res = await h.app.inject({ method: 'POST', url: '/api/obs/check', payload: { episodeId: 'ep-1' } });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.connected).toBe(true);
    expect(body.obsWebSocketVersion).toBe('5.5.0');
    expect(body.deck).toMatchObject({ capability: 'events' });
    expect(body.issues).toEqual([]);
  });

  it('reports a missing break scene on its block', async () => {
    const h = await boot({ scenes: ['CAM 1', 'CAM 2', 'CAM 3', 'PLAYOUT'] });
    const body = (
      await h.app.inject({ method: 'POST', url: '/api/obs/check', payload: { episodeId: 'ep-1' } })
    ).json();
    expect(body.issues).toEqual([
      { severity: 'error', code: 'scene_missing', blockId: 'br1', message: expect.any(String) },
    ]);
  });

  it('reports a playlist item missing from the deck on its block', async () => {
    const h = await boot({
      deckItems: [{ index: 0, path: 'D:/media/servizio1.mp4', title: 'Servizio 1', durationMs: 185_000 }],
    });
    const body = (
      await h.app.inject({ method: 'POST', url: '/api/obs/check', payload: { episodeId: 'ep-1' } })
    ).json();
    expect(body.issues).toEqual([
      { severity: 'error', code: 'deck_item_missing', blockId: 'b2', message: expect.any(String) },
    ]);
  });

  it('reports only obs_not_connected when OBS is disconnected', async () => {
    const h = await boot({}, { connect: false });
    const body = (
      await h.app.inject({ method: 'POST', url: '/api/obs/check', payload: { episodeId: 'ep-1' } })
    ).json();
    expect(body).toMatchObject({ connected: false, obsWebSocketVersion: null, deck: null });
    expect(body.issues).toEqual([
      { severity: 'error', code: 'obs_not_connected', blockId: null, message: expect.any(String) },
    ]);
  });

  it('returns 404 for an unknown episode', async () => {
    const h = await boot();
    const res = await h.app.inject({ method: 'POST', url: '/api/obs/check', payload: { episodeId: 'nope' } });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: 'not_found' });
  });

  it('returns 400 for an invalid episode id', async () => {
    const h = await boot();
    const res = await h.app.inject({ method: 'POST', url: '/api/obs/check', payload: { episodeId: '' } });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'invalid_body' });
  });

  it('returns 400 for an invalid body', async () => {
    const h = await boot();
    const res = await h.app.inject({ method: 'POST', url: '/api/obs/check', payload: {} });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'invalid_body' });
  });

  it('reports a missing media input on its block', async () => {
    const h = await boot({ inputs: [] });
    const body = (
      await h.app.inject({ method: 'POST', url: '/api/obs/check', payload: { episodeId: 'ep-1' } })
    ).json();
    expect(body.issues).toEqual([
      { severity: 'error', code: 'media_input_missing', blockId: 'br1', message: expect.any(String) },
    ]);
  });

  it('treats a rejecting GetInputList as unverifiable and answers normally', async () => {
    const h = await boot({ inputs: [] });
    h.current().respond('GetInputList', () => {
      throw new ObsRequestError(500, 'input list failed');
    });
    const res = await h.app.inject({ method: 'POST', url: '/api/obs/check', payload: { episodeId: 'ep-1' } });
    expect(res.statusCode).toBe(200);
    expect(res.json().issues).toEqual([]);
  });

  it('times out an unresponsive GetInputList and does not report media_input_missing', async () => {
    const h = await boot();
    h.current().respond('GetInputList', () => {
      // The timeout timer is armed right after this returns: advance FakeTime on the next microtask so the
      // 4000 ms read timeout is what settles the call.
      queueMicrotask(() => h.time.advance(4_000));
      return new Promise<never>(() => {});
    });
    const res = await h.app.inject({ method: 'POST', url: '/api/obs/check', payload: { episodeId: 'ep-1' } });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.connected).toBe(true);
    expect(body.issues).toEqual([]);
  });

  it('answers obs_not_connected only when OBS drops while reading inputs', async () => {
    const h = await boot();
    const client = h.current();
    client.respond('GetInputList', () => {
      // Drop the connection while the input read is in flight: the Check must not answer from the stale
      // connected snapshot.
      client.emit('ConnectionClosed', { code: 1006 });
      return { inputs: [] };
    });
    const res = await h.app.inject({ method: 'POST', url: '/api/obs/check', payload: { episodeId: 'ep-1' } });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.connected).toBe(false);
    expect(body.issues).toEqual([
      { severity: 'error', code: 'obs_not_connected', blockId: null, message: expect.any(String) },
    ]);
  });

  it('reports deck_absent when the plugin is missing and the episode uses media', async () => {
    const h = await boot({ deckPresent: false });
    const body = (
      await h.app.inject({ method: 'POST', url: '/api/obs/check', payload: { episodeId: 'ep-1' } })
    ).json();
    expect(body.issues).toEqual([
      { severity: 'error', code: 'deck_absent', blockId: null, message: expect.any(String) },
    ]);
  });

  it('warns about a legacy deck plugin', async () => {
    const h = await boot({ deckVersion: '1.3.0' });
    const body = (
      await h.app.inject({ method: 'POST', url: '/api/obs/check', payload: { episodeId: 'ep-1' } })
    ).json();
    expect(body.issues).toEqual([
      { severity: 'warning', code: 'deck_legacy', blockId: null, message: expect.any(String) },
    ]);
  });

  it('warns about a deck item with an unknown duration', async () => {
    const h = await boot({
      deckItems: [
        { index: 0, path: 'D:/media/servizio1.mp4', title: 'Servizio 1', durationMs: -1 },
        { index: 1, path: 'D:/media/servizio2.mp4', title: 'Servizio 2', durationMs: 120_000 },
      ],
    });
    const body = (
      await h.app.inject({ method: 'POST', url: '/api/obs/check', payload: { episodeId: 'ep-1' } })
    ).json();
    expect(body.issues).toEqual([
      { severity: 'warning', code: 'deck_duration_unknown', blockId: 'b1', message: expect.any(String) },
    ]);
  });
});
