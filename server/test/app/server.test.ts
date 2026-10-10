// SPDX-License-Identifier: GPL-2.0-or-later
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { PROTOCOL_VERSION, type ServerMessage } from '@olc/shared';
import { soloFutsalFormat } from '@olc/shared/testing';
import { FakeTime } from '../../src/clock/clock';
import { buildTestServer } from '../support/server';
import { tempDir } from '../support/tmp';
import { connect } from '../support/ws-client';

const apps: Array<{ close(): Promise<unknown> }> = [];
afterEach(async () => {
  while (apps.length > 0) await apps.pop()!.close();
});

async function boot(dataDir: string, time: FakeTime) {
  const server = await buildTestServer({ dataDir, clock: time, scheduler: time, heartbeatMs: 40 });
  apps.push(server.app);
  return server;
}

describe('buildServer', () => {
  it('creates the secret token and serves health', async () => {
    const dir = await tempDir();
    const { app } = await boot(dir, new FakeTime());
    expect((await readFile(join(dir, 'secret.token'), 'utf8')).trim()).toMatch(/^[0-9a-f]{64}$/);
    const health = (await app.inject({ method: 'GET', url: '/api/health' })).json();
    expect(health).toMatchObject({ version: '0.1.0', protocol: PROTOCOL_VERSION });
  });

  it('end to end: format → episode → load → live over HTTP and WebSocket', async () => {
    const { app, runtime } = await boot(await tempDir(), new FakeTime());
    await app.inject({ method: 'POST', url: '/api/formats', payload: soloFutsalFormat() });
    await app.inject({
      method: 'POST',
      url: '/api/formats/solo-futsal/episodes',
      payload: { id: 'ep-1', date: '2026-10-12', plannedStart: null, playlistName: null },
    });
    await app.inject({ method: 'POST', url: '/api/live/load', payload: { episodeId: 'ep-1' } });

    await app.listen({ port: 0, host: '127.0.0.1' });
    const port = (app.server.address() as { port: number }).port;
    const c = await connect(`ws://127.0.0.1:${port}/ws`);
    c.send({ type: 'hello', role: 'presenter', protocol: PROTOCOL_VERSION });
    await c.next((m) => m.type === 'view');

    runtime.dispatch({ type: 'SourceRestored' });
    runtime.dispatch({ type: 'ProgramSceneChanged', scene: 'CAM 1', deckOnProgram: false });
    runtime.dispatch({ type: 'OutputChanged', output: 'rec', state: 'started' });
    const live = (await c.next(
      (m) => m.type === 'view' && (m.view as { phase: string }).phase === 'live',
    )) as Extract<ServerMessage, { type: 'view' }>;
    expect((live.view as { block: { name: string } }).block.name).toBe('Primo blocco');
    c.close();
  });

  it('closes websocket clients with 1001 on shutdown', async () => {
    const { app } = await boot(await tempDir(), new FakeTime());
    await app.listen({ port: 0, host: '127.0.0.1' });
    const port = (app.server.address() as { port: number }).port;
    const c = await connect(`ws://127.0.0.1:${port}/ws`);
    c.send({ type: 'hello', role: 'presenter', protocol: PROTOCOL_VERSION });
    await c.next((m) => m.type === 'welcome');
    await app.close();
    apps.pop();
    expect(await c.closed).toBe(1001);
  });

  it('restart mid-show: resumes the live episode with OBS lost', async () => {
    const dir = await tempDir();
    const time = new FakeTime();
    const first = await boot(dir, time);
    await first.app.inject({ method: 'POST', url: '/api/formats', payload: soloFutsalFormat() });
    await first.app.inject({
      method: 'POST',
      url: '/api/formats/solo-futsal/episodes',
      payload: { id: 'ep-1', date: '2026-10-12', plannedStart: null, playlistName: null },
    });
    await first.app.inject({ method: 'POST', url: '/api/live/load', payload: { episodeId: 'ep-1' } });
    first.runtime.dispatch({ type: 'SourceRestored' });
    first.runtime.dispatch({ type: 'OutputChanged', output: 'rec', state: 'started' });
    await first.app.close();
    apps.pop();

    time.advance(30_000);
    const second = await boot(dir, time);
    expect(second.runtime.phase).toBe('live');
    const view = (await second.app.inject({ method: 'GET', url: '/api/live/view?role=presenter' })).json();
    expect(view.status.obs).toBe('lost');
    expect(view.block.anchor.source).toBe('estimated');
  });
});
