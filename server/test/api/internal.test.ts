// SPDX-License-Identifier: GPL-2.0-or-later
import { Writable } from 'node:stream';
import Fastify, { type FastifyInstance } from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import { registerInternal } from '../../src/api/internal';
import type { ObsService } from '../../src/obs/obs-service';

const TOKEN = 'shared-secret-token';
const URL = '/api/internal/obs-credentials';

type Obs = Pick<ObsService, 'setCredentials'>;

function newObs(): { obs: Obs; setCredentials: ReturnType<typeof vi.fn> } {
  const setCredentials = vi.fn();
  return { obs: { setCredentials }, setCredentials };
}

function makeApp(obs: Obs, logger: boolean | object = false): FastifyInstance {
  const app = Fastify({ logger: logger as never });
  registerInternal(app, { token: TOKEN, obs });
  return app;
}

async function readyApp(obs: Obs): Promise<FastifyInstance> {
  const app = makeApp(obs);
  await app.ready();
  return app;
}

describe('POST /api/internal/obs-credentials', () => {
  it('accepts a valid request and hands the credentials to the service', async () => {
    const { obs, setCredentials } = newObs();
    const app = await readyApp(obs);
    const res = await app.inject({
      method: 'POST',
      url: URL,
      headers: { authorization: `Bearer ${TOKEN}` },
      payload: { port: 4455, password: 'pw' },
    });
    expect(res.statusCode).toBe(204);
    expect(setCredentials).toHaveBeenCalledWith({ host: '127.0.0.1', port: 4455, password: 'pw' });
  });

  it.each([
    ['a wrong token of the same length', 'x'.repeat(TOKEN.length)],
    ['a token of a different length', `${TOKEN}-extra`],
  ])('rejects %s with 401', async (_label, token) => {
    const { obs, setCredentials } = newObs();
    const app = await readyApp(obs);
    const res = await app.inject({
      method: 'POST',
      url: URL,
      headers: { authorization: `Bearer ${token}` },
      payload: { port: 4455 },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ error: 'unauthorized' });
    expect(setCredentials).not.toHaveBeenCalled();
  });

  it('rejects a missing Authorization header with 401', async () => {
    const { obs } = newObs();
    const app = await readyApp(obs);
    const res = await app.inject({ method: 'POST', url: URL, payload: { port: 4455 } });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ error: 'unauthorized' });
  });

  it('rejects a non-loopback request even with the right token', async () => {
    const { obs, setCredentials } = newObs();
    const app = await readyApp(obs);
    const res = await app.inject({
      method: 'POST',
      url: URL,
      headers: { authorization: `Bearer ${TOKEN}` },
      payload: { port: 4455 },
      remoteAddress: '192.168.1.20',
    });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ error: 'forbidden' });
    expect(setCredentials).not.toHaveBeenCalled();
  });

  it('rejects an invalid body without echoing the password', async () => {
    const { obs, setCredentials } = newObs();
    const app = await readyApp(obs);
    const res = await app.inject({
      method: 'POST',
      url: URL,
      headers: { authorization: `Bearer ${TOKEN}` },
      payload: { port: 'x', password: 'pw' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'invalid_body' });
    expect(res.body).not.toContain('pw');
    expect(setCredentials).not.toHaveBeenCalled();
  });

  it('never writes the password to the logger', async () => {
    const chunks: string[] = [];
    const stream = new Writable({
      write(chunk: Buffer | string, _enc, cb) {
        chunks.push(chunk.toString());
        cb();
      },
    });
    const { obs } = newObs();
    const app = makeApp(obs, { level: 'info', stream });
    await app.ready();
    await app.inject({
      method: 'POST',
      url: URL,
      headers: { authorization: `Bearer ${TOKEN}` },
      payload: { port: 4455, password: 'pw' },
    });
    await app.inject({
      method: 'POST',
      url: URL,
      headers: { authorization: `Bearer ${TOKEN}` },
      payload: { port: 'x', password: 'pw' },
    });
    await app.close();
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks.join('')).not.toContain('pw');
  });
});
