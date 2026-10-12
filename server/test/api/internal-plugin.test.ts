// SPDX-License-Identifier: GPL-2.0-or-later
import { Writable } from 'node:stream';
import Fastify, { type FastifyInstance } from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import { registerInternal } from '../../src/api/internal';
import type { HotkeyResult } from '../../src/hotkeys/hotkey-service';
import type { ScreenInfo } from '../../src/kiosk/screens';

const TOKEN = 'shared-secret-token';
const AUTH = { authorization: `Bearer ${TOKEN}` };
const SCREEN: ScreenInfo = { name: 'DISPLAY2', x: 1920, y: 0, width: 1920, height: 1080, devicePixelRatio: 1, primary: false };

function setup(logger: boolean | object = false) {
  const press = vi.fn<(slot: string, source: { session?: string; seq?: number }) => HotkeyResult>(() => ({
    result: 'pending',
    slot: 'next',
    remainingMs: 1000,
  }));
  const set = vi.fn();
  const app: FastifyInstance = Fastify({ logger: logger as never });
  registerInternal(app, { token: TOKEN, obs: { setCredentials: vi.fn() }, hotkeys: { press: press as never }, screens: { set } });
  return { app, press, set };
}

describe('POST /api/internal/hotkey', () => {
  it('passes the slot, session and seq to the service and returns its answer', async () => {
    const { app, press } = setup();
    const res = await app.inject({ method: 'POST', url: '/api/internal/hotkey', headers: AUTH, payload: { slot: 'next', session: 's1', seq: 4 } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ result: 'pending', slot: 'next', remainingMs: 1000 });
    expect(press).toHaveBeenCalledWith('next', { session: 's1', seq: 4 });
  });

  it('session and seq are optional', async () => {
    const { app, press } = setup();
    await app.inject({ method: 'POST', url: '/api/internal/hotkey', headers: AUTH, payload: { slot: 'clear' } });
    expect(press).toHaveBeenCalledWith('clear', { session: undefined, seq: undefined });
  });

  it.each([
    ['an unknown slot', { slot: 'self-destruct' }],
    ['a missing slot', {}],
    ['a negative seq', { slot: 'next', seq: -1 }],
    ['a fractional seq', { slot: 'next', seq: 1.5 }],
    ['an over-long session', { slot: 'next', session: 'x'.repeat(65) }],
  ])('rejects %s with 400 and does not press anything', async (_label, payload) => {
    const { app, press } = setup();
    const res = await app.inject({ method: 'POST', url: '/api/internal/hotkey', headers: AUTH, payload });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'invalid_body' });
    expect(press).not.toHaveBeenCalled();
  });

  it('needs the bearer token (401) and refuses non-loopback callers even with it (403)', async () => {
    const { app, press } = setup();
    const noAuth = await app.inject({ method: 'POST', url: '/api/internal/hotkey', payload: { slot: 'next' } });
    expect(noAuth.statusCode).toBe(401);
    const wrong = await app.inject({ method: 'POST', url: '/api/internal/hotkey', headers: { authorization: 'Bearer nope' }, payload: { slot: 'next' } });
    expect(wrong.statusCode).toBe(401);
    const lan = await app.inject({ method: 'POST', url: '/api/internal/hotkey', headers: AUTH, payload: { slot: 'next' }, remoteAddress: '192.168.1.20' });
    expect(lan.statusCode).toBe(403);
    expect(press).not.toHaveBeenCalled();
  });
});

describe('POST /api/internal/screens', () => {
  it('stores the list the plugin reports', async () => {
    const { app, set } = setup();
    const res = await app.inject({ method: 'POST', url: '/api/internal/screens', headers: AUTH, payload: { screens: [SCREEN] } });
    expect(res.statusCode).toBe(204);
    expect(set).toHaveBeenCalledWith([SCREEN]);
  });

  it('rejects a bad list, and anything without the token or from the LAN', async () => {
    const { app, set } = setup();
    const bad = await app.inject({ method: 'POST', url: '/api/internal/screens', headers: AUTH, payload: { screens: [{ ...SCREEN, width: 0 }] } });
    expect(bad.statusCode).toBe(400);
    const noAuth = await app.inject({ method: 'POST', url: '/api/internal/screens', payload: { screens: [SCREEN] } });
    expect(noAuth.statusCode).toBe(401);
    const lan = await app.inject({ method: 'POST', url: '/api/internal/screens', headers: AUTH, payload: { screens: [SCREEN] }, remoteAddress: '10.1.1.1' });
    expect(lan.statusCode).toBe(403);
    expect(set).not.toHaveBeenCalled();
  });
});

describe('the internal routes never leak secrets', () => {
  it('writes neither the token nor a request body to the log', async () => {
    const chunks: string[] = [];
    const stream = new Writable({
      write(chunk: Buffer | string, _enc, cb) {
        chunks.push(chunk.toString());
        cb();
      },
    });
    const { app } = setup({ level: 'info', stream });
    await app.ready();
    await app.inject({ method: 'POST', url: '/api/internal/hotkey', headers: AUTH, payload: { slot: 'next', session: 'secret-session-id' } });
    await app.inject({ method: 'POST', url: '/api/internal/hotkey', headers: AUTH, payload: { slot: 'bogus', session: 'secret-session-id' } });
    await app.close();
    const log = chunks.join('');
    expect(log.length).toBeGreaterThan(0);
    expect(log).not.toContain(TOKEN);
    expect(log).not.toContain('secret-session-id');
  });
});
