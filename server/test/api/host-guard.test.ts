// SPDX-License-Identifier: GPL-2.0-or-later
import { afterEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { buildServer } from '../../src/app/server';
import { FakeTime } from '../../src/clock/clock';
import { tempDir } from '../support/tmp';

const apps: Array<{ close(): Promise<unknown> }> = [];
afterEach(async () => {
  while (apps.length > 0) await apps.pop()!.close();
});

async function boot() {
  const time = new FakeTime();
  const server = await buildServer({ dataDir: await tempDir(), clock: time, scheduler: time, heartbeatMs: 40 });
  apps.push(server.app);
  return server;
}

describe('host and origin guard', () => {
  it('refuses an unlisted Host', async () => {
    const { app } = await boot();
    const res = await app.inject({ method: 'GET', url: '/api/health', headers: { host: 'attacker.example' } });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ error: 'forbidden_host' });
  });

  it('refuses a cross-site Origin with an allowed Host', async () => {
    const { app } = await boot();
    const res = await app.inject({ method: 'GET', url: '/api/health', headers: { origin: 'https://evil.example' } });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ error: 'forbidden_origin' });
  });

  it('allows an allowed Origin and a request with no Origin', async () => {
    const { app } = await boot();
    const allowed = await app.inject({ method: 'GET', url: '/api/health', headers: { origin: 'http://localhost:4460' } });
    expect(allowed.statusCode).toBe(200);
    const none = await app.inject({ method: 'GET', url: '/api/health' });
    expect(none.statusCode).toBe(200);
  });

  it('refuses a websocket upgrade from a cross-site Origin', async () => {
    const { app } = await boot();
    await app.listen({ port: 0, host: '127.0.0.1' });
    const port = (app.server.address() as { port: number }).port;
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, { headers: { Origin: 'https://evil.example' } });
    const messages: unknown[] = [];
    ws.on('message', (raw) => messages.push(JSON.parse(raw.toString())));
    const outcome = await new Promise<string>((resolve) => {
      ws.once('open', () => resolve('open'));
      ws.once('error', () => resolve('error'));
      ws.once('close', () => resolve('close'));
    });
    expect(outcome).not.toBe('open');
    expect(messages).toHaveLength(0);
    ws.terminate();
  });

  it('allows an unbracketed IPv6 interface address when LAN access is enabled', async () => {
    const time = new FakeTime();
    const server = await buildServer({
      dataDir: await tempDir(),
      clock: time,
      scheduler: time,
      heartbeatMs: 40,
      lanAccess: true,
      networkAddresses: () => ['2001:db8::5'],
      hostname: () => 'studio-host',
    });
    apps.push(server.app);
    const res = await server.app.inject({
      method: 'GET',
      url: '/api/health',
      headers: { host: '[2001:db8::5]:4460' },
    });
    expect(res.statusCode).toBe(200);
  });
});
