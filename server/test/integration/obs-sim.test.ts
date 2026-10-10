// SPDX-License-Identifier: GPL-2.0-or-later
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { soloFutsalFormat } from '@olc/shared/testing';
import { startObsSim, type ObsSim } from '@olc/obs-sim';
import type { BuiltServer } from '../../src/app/server';
import { FakeTime } from '../../src/clock/clock';
import { createObsClient, ObsAuthError, ObsRequestError } from '../../src/obs/client';
import { ObsConnection } from '../../src/obs/connection';
import { buildTestServer } from '../support/server';
import { tempDir } from '../support/tmp';

/** The Solo Futsal scene set the simulator is configured with: the deck's source must be on PLAYOUT. */
const SCENES = {
  'CAM 1': [],
  'CAM 2': [],
  'CAM 3': [],
  PLAYOUT: [{ sourceName: 'Deck Media', kind: 'input' as const }],
  BREAK: [{ sourceName: 'Tappo', kind: 'input' as const }],
};

const DECK = {
  version: '1.4.0',
  sourceName: 'Deck Media',
  items: [
    { title: 'Servizio 1', path: 'D:/media/servizio1.mp4', durationMs: 185_000 },
    { title: 'Servizio 2', path: 'D:/media/servizio2.mp4', durationMs: 120_000 },
  ],
};

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Bounded polling helper: retries `probe` every 50 ms until it returns a truthy value, or throws with a clear
 * message after 5 s. Every wait in this test goes through it so no assertion relies on a fixed sleep.
 */
async function waitFor<T>(label: string, probe: () => Promise<T | null | undefined>): Promise<T> {
  const deadline = Date.now() + 5_000;
  for (;;) {
    const value = await probe();
    if (value) return value;
    if (Date.now() >= deadline) throw new Error(`Timed out after 5 s waiting for ${label}`);
    await delay(50);
  }
}

/** Creates the Solo Futsal format + episode and loads it, asserting the status of every setup call. */
async function setupEpisode(app: BuiltServer['app'], id = 'ep-1'): Promise<void> {
  const format = await app.inject({ method: 'POST', url: '/api/formats', payload: soloFutsalFormat() });
  expect(format.statusCode).toBe(201);
  const episode = await app.inject({
    method: 'POST',
    url: '/api/formats/solo-futsal/episodes',
    payload: { id, date: '2026-10-12', plannedStart: null, playlistName: null },
  });
  expect(episode.statusCode).toBe(201);
  const load = await app.inject({ method: 'POST', url: '/api/live/load', payload: { episodeId: id } });
  expect(load.statusCode).toBe(200);
}

/** The options every simulator in this file shares; `port`/`password` are per-test. */
const SIM_OPTS = { scenes: SCENES, inputs: ['Deck Media', 'Tappo'], program: 'CAM 1', deck: DECK };

interface PresenterView {
  phase: string;
  segment: string | null;
  block: { anchor: { source: string } } | null;
  status: { obs: string };
}

const sims: ObsSim[] = [];
const apps: Array<{ close(): Promise<unknown> }> = [];

afterEach(async () => {
  while (apps.length > 0) await apps.pop()!.close();
  while (sims.length > 0) await sims.pop()!.close();
});

describe('obs-sim integration', () => {
  it('drives the server end to end through the real obs-websocket client', async () => {
    // 1. Simulator (password-protected) and a server on a temp data dir.
    const sim = await startObsSim({ port: 0, password: 'pw', ...SIM_OPTS });
    sims.push(sim);
    const dir = await tempDir();
    const server = await buildTestServer({ dataDir: dir, heartbeatMs: 40 });
    apps.push(server.app);

    const presenter = async (): Promise<PresenterView> =>
      (await server.app.inject({ method: 'GET', url: '/api/live/view?role=presenter' })).json() as PresenterView;
    const obsStatus = async (): Promise<{ connection: string }> =>
      (await server.app.inject({ method: 'GET', url: '/api/obs/status' })).json() as { connection: string };

    // 2. Solo Futsal format + episode through HTTP, then load it.
    await setupEpisode(server.app);

    // 3. Hand the simulator's credentials over with the shared secret from the data dir.
    const token = (await readFile(join(dir, 'secret.token'), 'utf8')).trim();
    const creds = await server.app.inject({
      method: 'POST',
      url: '/api/internal/obs-credentials',
      headers: { authorization: `Bearer ${token}` },
      payload: { host: '127.0.0.1', port: sim.port, password: 'pw' },
    });
    expect(creds.statusCode).toBe(204);

    // 4. Connected and the presenter view sees OBS as ok.
    await waitFor('OBS connected and presenter obs ok', async () => {
      if ((await obsStatus()).connection !== 'connected') return null;
      const view = await presenter();
      return view.status.obs === 'ok' ? view : null;
    });

    // 5. REC starts: the view goes live.
    sim.setRecord('started');
    await waitFor('view phase live', async () => {
      const view = await presenter();
      return view.phase === 'live' ? view : null;
    });

    // 6. PLAYOUT on program plus a deck item: the segment becomes media.
    sim.setProgram('PLAYOUT');
    sim.deckPlay(0);
    await waitFor('view segment media', async () => {
      const view = await presenter();
      return view.segment === 'media' ? view : null;
    });

    // 7. The simulator drops every socket: OBS is lost and the block anchor degrades to estimated.
    sim.dropConnections();
    await waitFor('OBS lost and estimated anchor', async () => {
      const view = await presenter();
      return view.status.obs === 'lost' && view.block?.anchor.source === 'estimated' ? view : null;
    });

    // 8. The simulator keeps listening, so the server reconnects on its own and OBS is ok again.
    await waitFor('OBS reconnected and presenter obs ok', async () => {
      if ((await obsStatus()).connection !== 'connected') return null;
      const view = await presenter();
      return view.status.obs === 'ok' ? view : null;
    });

    // 9. Check OBS finds no issues.
    const check = await server.app.inject({ method: 'POST', url: '/api/obs/check', payload: { episodeId: 'ep-1' } });
    expect(check.statusCode).toBe(200);
    expect(check.json()).toMatchObject({ connected: true, issues: [] });
  });

  it('keeps auth_failed after a wrong password hand-off, then connects with the right one', async () => {
    const sim = await startObsSim({ port: 0, password: 'pw', ...SIM_OPTS });
    sims.push(sim);
    const dir = await tempDir();
    const server = await buildTestServer({ dataDir: dir, heartbeatMs: 40 });
    apps.push(server.app);
    await setupEpisode(server.app);

    const token = (await readFile(join(dir, 'secret.token'), 'utf8')).trim();
    const postCredentials = (password: string) =>
      server.app.inject({
        method: 'POST',
        url: '/api/internal/obs-credentials',
        headers: { authorization: `Bearer ${token}` },
        payload: { host: '127.0.0.1', port: sim.port, password },
      });
    const connection = async (): Promise<string> =>
      ((await server.app.inject({ method: 'GET', url: '/api/obs/status' })).json() as { connection: string }).connection;

    const bad = await postCredentials('wrong');
    expect(bad.statusCode).toBe(204);
    await waitFor('auth_failed', async () => ((await connection()) === 'auth_failed' ? true : null));
    const attempts = sim.connections;
    expect(attempts).toBe(1);

    // Wait well past the 500 ms minimum backoff: any retry would open a second connection to the sim.
    await delay(1_500);
    expect(await connection()).toBe('auth_failed');
    expect(sim.connections).toBe(attempts);

    const good = await postCredentials('pw');
    expect(good.statusCode).toBe(204);
    await waitFor('connected', async () => ((await connection()) === 'connected' ? true : null));
  });

  it('rejects the wrong password as ObsAuthError through the real client', async () => {
    const sim = await startObsSim({ port: 0, password: 'pw', ...SIM_OPTS });
    sims.push(sim);
    const client = createObsClient();
    const err = await client.connect(`ws://127.0.0.1:${sim.port}`, 'wrong').then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(ObsAuthError);
  });

  it('maps unknown request and absent vendor errors through the real client', async () => {
    const sim = await startObsSim({ port: 0, ...SIM_OPTS, deck: null });
    sims.push(sim);
    const client = createObsClient();
    await client.connect(`ws://127.0.0.1:${sim.port}`, undefined);

    const unknown = await client.call('NoSuchRequest').then(
      () => null,
      (e: unknown) => e,
    );
    expect(unknown).toBeInstanceOf(ObsRequestError);
    expect((unknown as ObsRequestError).code).toBe(204);

    const absent = await client
      .call('CallVendorRequest', { vendorName: 'obs-playlist-deck', requestType: 'GetStatus' })
      .then(
        () => null,
        (e: unknown) => e,
      );
    expect(absent).toBeInstanceOf(ObsRequestError);
    expect((absent as ObsRequestError).code).toBe(600);
    await client.disconnect();
  });

  it('does not double-schedule after a failed connect through the real client', async () => {
    const sim = await startObsSim({ port: 0, password: 'pw', ...SIM_OPTS });
    sims.push(sim);
    const time = new FakeTime();
    let closed = 0;
    const conn = new ObsConnection({
      clock: time,
      scheduler: time,
      clientFactory: () => {
        const client = createObsClient();
        client.on('ConnectionClosed', () => {
          closed += 1;
        });
        return client;
      },
      hooks: { onConnected: () => undefined, onDisconnected: () => undefined, report: () => undefined },
    });
    conn.setCredentials({ host: '127.0.0.1', port: sim.port, password: 'wrong' });
    await waitFor('auth_failed', async () => (conn.state === 'auth_failed' ? true : null));
    expect(closed).toBeLessThanOrEqual(1);
    expect(time.pending).toBe(0);
    await conn.stop();
  });
});
