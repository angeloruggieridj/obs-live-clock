// SPDX-License-Identifier: GPL-2.0-or-later
import OBSWebSocket from 'obs-websocket-js/json';
import { afterEach, describe, expect, it } from 'vitest';
import { startObsSim, type ObsSim, type ObsSimOptions } from '../src/index';

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

const sims: ObsSim[] = [];
const clients: OBSWebSocket[] = [];

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(cond: () => boolean, label: string): Promise<void> {
  const deadline = Date.now() + 2_000;
  while (!cond()) {
    if (Date.now() >= deadline) throw new Error(`timed out waiting for ${label}`);
    await delay(10);
  }
}

async function start(overrides: Partial<ObsSimOptions> = {}): Promise<ObsSim> {
  const sim = await startObsSim({
    port: 0,
    scenes: SCENES,
    inputs: ['Deck Media', 'Tappo'],
    program: 'CAM 1',
    deck: DECK,
    ...overrides,
  });
  sims.push(sim);
  return sim;
}

async function connected(sim: ObsSim, password?: string): Promise<OBSWebSocket> {
  const obs = new OBSWebSocket();
  clients.push(obs);
  await obs.connect(`ws://127.0.0.1:${sim.port}`, password);
  return obs;
}

/** The strongly-typed `call` rejects unknown request names at compile time; the sim must still answer them. */
function rawCall(obs: OBSWebSocket, requestType: string, requestData?: Record<string, unknown>): Promise<Record<string, unknown>> {
  const call = obs.call.bind(obs) as unknown as (t: string, d?: Record<string, unknown>) => Promise<Record<string, unknown>>;
  return call(requestType, requestData);
}

afterEach(async () => {
  while (clients.length > 0) await clients.pop()!.disconnect().catch(() => undefined);
  while (sims.length > 0) await sims.pop()!.close();
});

describe('obs-sim', () => {
  it('connects without a password and negotiates rpc version 1', async () => {
    const sim = await start();
    const obs = new OBSWebSocket();
    clients.push(obs);
    const hello = await obs.connect(`ws://127.0.0.1:${sim.port}`);
    expect(hello.obsWebSocketVersion).toBe('5.5.0');
    expect(hello.negotiatedRpcVersion).toBe(1);
  });

  it('authenticates with the right password', async () => {
    const sim = await start({ password: 'pw' });
    const obs = new OBSWebSocket();
    clients.push(obs);
    const hello = await obs.connect(`ws://127.0.0.1:${sim.port}`, 'pw');
    expect(hello.obsWebSocketVersion).toBe('5.5.0');
    expect(hello.negotiatedRpcVersion).toBe(1);
  });

  it('rejects a wrong password with close code 4009', async () => {
    const sim = await start({ password: 'pw' });
    const obs = new OBSWebSocket();
    clients.push(obs);
    await expect(obs.connect(`ws://127.0.0.1:${sim.port}`, 'wrong')).rejects.toMatchObject({ code: 4009 });
  });

  it('answers GetSceneList and GetCurrentProgramScene', async () => {
    const sim = await start();
    const obs = await connected(sim);
    const list = await obs.call('GetSceneList');
    expect(list.scenes.map((s) => s.sceneName)).toEqual(['CAM 1', 'CAM 2', 'CAM 3', 'PLAYOUT', 'BREAK']);
    const current = await obs.call('GetCurrentProgramScene');
    expect(current.sceneName).toBe('CAM 1');
  });

  it('emits CurrentProgramSceneChanged after setProgram', async () => {
    const sim = await start();
    const obs = await connected(sim);
    const seen: string[] = [];
    obs.on('CurrentProgramSceneChanged', (data) => seen.push(data.sceneName));
    sim.setProgram('CAM 2');
    await waitFor(() => seen.length > 0, 'CurrentProgramSceneChanged');
    expect(seen).toEqual(['CAM 2']);
  });

  it('round-trips a vendor GetItems request', async () => {
    const sim = await start();
    const obs = await connected(sim);
    const res = await obs.call('CallVendorRequest', {
      vendorName: 'obs-playlist-deck',
      requestType: 'GetItems',
      requestData: { from: 0, to: 199 },
    });
    const data = res.responseData as { ok: boolean; count: number; items: unknown[] };
    expect(data.ok).toBe(true);
    expect(data.count).toBe(2);
    expect(data.items).toHaveLength(2);
  });

  it('fails an unknown request with code 204 and an absent vendor with code 600', async () => {
    const sim = await start({ deck: null });
    const obs = await connected(sim);
    await expect(rawCall(obs, 'NoSuchRequest')).rejects.toMatchObject({ code: 204 });
    await expect(
      rawCall(obs, 'CallVendorRequest', { vendorName: 'obs-playlist-deck', requestType: 'GetStatus' }),
    ).rejects.toMatchObject({ code: 600 });
  });

  it('dropConnections terminates client sockets with ConnectionClosed', async () => {
    const sim = await start();
    const obs = await connected(sim);
    const closed = new Promise<number>((resolve) => obs.on('ConnectionClosed', (error) => resolve(error.code)));
    sim.dropConnections();
    expect(await closed).toBe(1006);
  });
});
