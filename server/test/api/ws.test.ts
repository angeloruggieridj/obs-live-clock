// SPDX-License-Identifier: GPL-2.0-or-later
import websocket from '@fastify/websocket';
import Fastify from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { PROTOCOL_VERSION, type ServerMessage } from '@olc/shared';
import { soloFutsalEpisode } from '@olc/shared/testing';
import { registerWs, safeSend, type WsContext } from '../../src/api/ws';
import { makeRuntime } from '../support/runtime';
import { tempDir } from '../support/tmp';
import { connect } from '../support/ws-client';

const closers: Array<() => Promise<void>> = [];
afterEach(async () => {
  while (closers.length > 0) await closers.pop()!();
});

async function start(heartbeatMs = 40, extra: Partial<WsContext> = {}) {
  const h = makeRuntime(await tempDir());
  const app = Fastify();
  await app.register(websocket);
  registerWs(app, {
    runtime: h.runtime,
    clock: h.time,
    version: '0.1.0-test',
    instanceId: 'i-1',
    heartbeatMs,
    ...extra,
  });
  await app.listen({ port: 0, host: '127.0.0.1' });
  closers.push(() => app.close());
  const port = (app.server.address() as { port: number }).port;
  return { ...h, app, url: `ws://127.0.0.1:${port}/ws` };
}

const is = (type: ServerMessage['type']) => (m: ServerMessage) => m.type === type;

type ViewMsg = Extract<ServerMessage, { type: 'view' }>;
type HeartbeatMsg = Extract<ServerMessage, { type: 'heartbeat' }>;

function fakeTarget(over: Partial<{ readyState: number; bufferedAmount: number; send: (d: string) => void }> = {}) {
  const sent: string[] = [];
  let terminated = 0;
  return {
    sent,
    get terminated() { return terminated; },
    target: {
      readyState: over.readyState ?? 1,
      OPEN: 1,
      bufferedAmount: over.bufferedAmount ?? 0,
      send: over.send ?? ((d: string) => { sent.push(d); }),
      terminate: () => { terminated += 1; },
    },
  };
}

describe('safeSend', () => {
  const msg: ServerMessage = { type: 'ack', id: 'c1', changed: true };

  it('sends JSON to an open, draining socket', () => {
    const f = fakeTarget();
    expect(safeSend(f.target, msg, 1_000, () => {})).toBe(true);
    expect(f.sent).toEqual([JSON.stringify(msg)]);
  });

  it('skips a socket that is not open', () => {
    const f = fakeTarget({ readyState: 3 });
    expect(safeSend(f.target, msg, 1_000, () => {})).toBe(false);
    expect(f.sent).toEqual([]);
  });

  it('terminates a peer whose buffer is over the cap instead of queueing more', () => {
    const reports: unknown[] = [];
    const f = fakeTarget({ bufferedAmount: 1_001 });
    expect(safeSend(f.target, msg, 1_000, (e) => reports.push(e))).toBe(false);
    expect(f.terminated).toBe(1);
    expect(f.sent).toEqual([]);
    expect(reports).toHaveLength(1);
  });

  it('never throws when send throws', () => {
    const reports: unknown[] = [];
    const f = fakeTarget({ send: () => { throw new Error('EPIPE'); } });
    expect(safeSend(f.target, msg, 1_000, (e) => reports.push(e))).toBe(false);
    expect(reports).toHaveLength(1);
  });
});

describe('WebSocket hub', () => {
  it('greets a presenter and pushes the current view, then updates', async () => {
    const s = await start();
    const c = await connect(s.url);
    c.send({ type: 'hello', role: 'presenter', protocol: PROTOCOL_VERSION });
    expect(await c.next(is('welcome'))).toEqual({ type: 'welcome', serverVersion: '0.1.0-test', instanceId: 'i-1', protocol: 1 });
    expect(await c.next(is('view'))).toMatchObject({ type: 'view', role: 'presenter', view: null });
    await s.runtime.load(soloFutsalEpisode());
    const v = (await c.next((m) => m.type === 'view' && m.view !== null)) as Extract<ServerMessage, { type: 'view' }>;
    expect((v.view as { phase: string }).phase).toBe('preshow');
    c.close();
  });

  it('serves the control view to control clients', async () => {
    const s = await start();
    await s.runtime.load(soloFutsalEpisode());
    const c = await connect(s.url);
    c.send({ type: 'hello', role: 'control', protocol: PROTOCOL_VERSION });
    const v = (await c.next(is('view'))) as Extract<ServerMessage, { type: 'view' }>;
    expect((v.view as { rows: unknown[] }).rows).toHaveLength(8);
    c.close();
  });

  it('refuses a protocol mismatch with close code 4001', async () => {
    const s = await start();
    const c = await connect(s.url);
    c.send({ type: 'hello', role: 'presenter', protocol: 99 });
    expect(await c.next(is('error'))).toMatchObject({ code: 'protocol_mismatch' });
    expect(await c.closed).toBe(4001);
  });

  it('answers misbehaving clients with typed errors and stays up', async () => {
    const s = await start();
    const c = await connect(s.url);
    c.sendRaw('{ not json');
    expect(await c.next(is('error'))).toMatchObject({ code: 'invalid_message', id: null });
    c.send({ type: 'command', id: 'c1', command: { name: 'next' } });
    expect(await c.next((m) => m.type === 'error' && m.code === 'hello_required')).toMatchObject({ id: 'c1' });
    c.send({ type: 'hello', role: 'control', protocol: PROTOCOL_VERSION });
    await c.next(is('welcome'));
    c.send({ type: 'command', id: 'c2', command: { name: 'next' } });
    expect(await c.next((m) => m.type === 'error' && m.code === 'no_episode')).toMatchObject({ id: 'c2' });
    c.send({ type: 'shout' });
    expect(await c.next((m) => m.type === 'error' && m.code === 'invalid_message')).toBeTruthy();
    c.close();
  });

  it('runs commands with an ack and pushes the resulting view', async () => {
    const s = await start();
    await s.runtime.load(soloFutsalEpisode());
    const c = await connect(s.url);
    c.send({ type: 'hello', role: 'control', protocol: PROTOCOL_VERSION });
    await c.next(is('view'));
    c.send({ type: 'command', id: 'm1', command: { name: 'send_message', text: 'STRINGI', dismiss: { kind: 'manual' } } });
    const v = (await c.next(
      (m) => m.type === 'view' && (m.view as { presenter: { message: unknown } }).presenter.message !== null,
    )) as Extract<ServerMessage, { type: 'view' }>;
    expect((v.view as { presenter: { message: unknown } }).presenter.message).toEqual({ text: 'STRINGI' });
    expect(await c.next(is('ack'))).toEqual({ type: 'ack', id: 'm1', changed: true });
    c.close();
  });

  it('acks a no-op command with changed: false', async () => {
    const s = await start();
    await s.runtime.load(soloFutsalEpisode());
    const c = await connect(s.url);
    c.send({ type: 'hello', role: 'control', protocol: PROTOCOL_VERSION });
    await c.next(is('view'));
    c.send({ type: 'command', id: 'n1', command: { name: 'next' } });
    expect(await c.next(is('ack'))).toEqual({ type: 'ack', id: 'n1', changed: false });
    c.close();
  });

  it('refuses commands from a presenter', async () => {
    const s = await start();
    await s.runtime.load(soloFutsalEpisode());
    const c = await connect(s.url);
    c.send({ type: 'hello', role: 'presenter', protocol: PROTOCOL_VERSION });
    await c.next(is('view'));
    c.send({ type: 'command', id: 'p1', command: { name: 'send_message', text: 'NOPE', dismiss: { kind: 'manual' } } });
    expect(await c.next(is('error'))).toMatchObject({ type: 'error', id: 'p1', code: 'forbidden' });
    expect(s.runtime.presenterView()?.message).toBeNull();
    c.close();
  });

  it('answers time pings with the server wall clock', async () => {
    const s = await start();
    const c = await connect(s.url);
    c.send({ type: 'hello', role: 'presenter', protocol: PROTOCOL_VERSION });
    c.send({ type: 'time.ping', t0: 12.5 });
    expect(await c.next(is('time.pong'))).toEqual({ type: 'time.pong', t0: 12.5, serverWall: s.time.wall() });
    c.close();
  });

  it('survives a command that throws and answers with an internal error', async () => {
    const s = await start();
    await s.runtime.load(soloFutsalEpisode());
    const c = await connect(s.url);
    c.send({ type: 'hello', role: 'control', protocol: PROTOCOL_VERSION });
    await c.next(is('welcome'));
    await c.next(is('view'));
    s.runtime.command = () => {
      throw new TypeError('boom');
    };
    c.send({ type: 'command', id: 'x', command: { name: 'next' } });
    expect(await c.next(is('error'))).toMatchObject({ type: 'error', id: 'x', code: 'internal' });
    c.send({ type: 'time.ping', t0: 7 });
    expect(await c.next(is('time.pong'))).toMatchObject({ type: 'time.pong', t0: 7 });
    c.close();
  });

  it('isolates a throwing projection so the other role and the hub survive', async () => {
    const s = await start(30);
    await s.runtime.load(soloFutsalEpisode());
    const presenter = await connect(s.url);
    const control = await connect(s.url);
    presenter.send({ type: 'hello', role: 'presenter', protocol: PROTOCOL_VERSION });
    control.send({ type: 'hello', role: 'control', protocol: PROTOCOL_VERSION });
    await presenter.next(is('view'));
    await control.next(is('view'));
    s.runtime.presenterView = () => {
      throw new Error('boom');
    };
    s.runtime.command({ name: 'send_message', text: 'HELLO', dismiss: { kind: 'manual' } });
    const v = (await control.next(
      (m) => m.type === 'view' && (m.view as { presenter: { message: unknown } }).presenter.message != null,
    )) as Extract<ServerMessage, { type: 'view' }>;
    expect((v.view as { presenter: { message: unknown } }).presenter.message).toEqual({ text: 'HELLO' });
    expect(await presenter.next(is('heartbeat'))).toBeTruthy();
    presenter.close();
    control.close();
  });

  it('keeps the id of a schema-invalid command', async () => {
    const s = await start();
    const c = await connect(s.url);
    c.send({ type: 'command', id: 'bad', command: { name: 'goto', slot: -1 } });
    expect(await c.next(is('error'))).toMatchObject({ type: 'error', id: 'bad', code: 'invalid_message' });
    c.close();
  });

  it("carries each client's own view rev on heartbeats", async () => {
    const s = await start(30);
    await s.runtime.load(soloFutsalEpisode());
    const presenter = await connect(s.url);
    presenter.send({ type: 'hello', role: 'presenter', protocol: PROTOCOL_VERSION });
    const pv = (await presenter.next(is('view'))) as ViewMsg;
    const control = await connect(s.url);
    control.send({ type: 'hello', role: 'control', protocol: PROTOCOL_VERSION });
    const cv = (await control.next(is('view'))) as ViewMsg;
    expect(cv.rev).toBeGreaterThan(pv.rev);
    // Only heartbeats sent after the control view exists prove the rev is per client: skip the first one,
    // which may have left the server before the control view did, and check the second.
    const mark = presenter.messages.length;
    const after = (m: ServerMessage) => m.type === 'heartbeat' && presenter.messages.indexOf(m) >= mark;
    await presenter.next(after);
    const hb = (await presenter.next(after)) as HeartbeatMsg;
    expect(hb.rev).toBe(pv.rev);
    presenter.close();
    control.close();
  });

  it('sends heartbeats and never resends an unchanged view', async () => {
    const s = await start(30);
    await s.runtime.load(soloFutsalEpisode());
    const c = await connect(s.url);
    c.send({ type: 'hello', role: 'presenter', protocol: PROTOCOL_VERSION });
    await c.next(is('view'));
    await c.next(is('heartbeat'));
    await c.next(is('heartbeat'));
    await c.next(is('heartbeat'));
    expect(c.messages.filter((m) => m.type === 'view')).toHaveLength(1);
    const hb = c.messages.find((m) => m.type === 'heartbeat') as Extract<ServerMessage, { type: 'heartbeat' }>;
    expect(hb.serverWall).toBe(s.time.wall());
    c.close();
  });

  it('closes client sockets when the server closes', async () => {
    const s = await start();
    const c = await connect(s.url);
    c.send({ type: 'hello', role: 'presenter', protocol: PROTOCOL_VERSION });
    await c.next(is('welcome'));
    await s.app.close();
    closers.pop();
    // Fastify runs preClose hooks in registration order, so the websocket plugin's defaultPreClose
    // (registered first) sends its empty close frame, which the client sees as 1005. Our own preClose
    // hook (1001) is too late; if the socket is terminated instead the client sees 1006.
    expect([1001, 1005, 1006]).toContain(await c.closed);
  });

  it('terminates a peer that stops answering pings (half-open tablet)', async () => {
    const s = await start(1_000, { pingIntervalMs: 50 });
    const dead = new WebSocket(s.url, { autoPong: false });
    await new Promise<void>((resolve) => dead.once('open', () => resolve()));
    const code = await new Promise<number>((resolve) => dead.once('close', (c: number) => resolve(c)));
    expect(code).toBe(1006);
  });

  it('keeps a peer that answers pings', async () => {
    const s = await start(1_000, { pingIntervalMs: 50 });
    const c = await connect(s.url);
    c.send({ type: 'hello', role: 'presenter', protocol: PROTOCOL_VERSION });
    await c.next(is('welcome'));
    const outcome = await Promise.race([
      c.closed.then(() => 'closed'),
      new Promise<string>((resolve) => setTimeout(() => resolve('open'), 400)),
    ]);
    expect(outcome).toBe('open');
    c.close();
  });
});
