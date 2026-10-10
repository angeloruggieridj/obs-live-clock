// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import { FakeTime } from '../../src/clock/clock';
import { ObsAuthError } from '../../src/obs/client';
import { ObsConnection } from '../../src/obs/connection';
import { FakeObsClient } from '../support/fake-obs';

const flush = () => new Promise((r) => setImmediate(r));

function harness(behaviour: Array<'ok' | 'fail' | 'auth'>) {
  const time = new FakeTime();
  const clients: FakeObsClient[] = [];
  const events: string[] = [];
  const errors: unknown[] = [];
  let n = 0;
  const conn = new ObsConnection({
    clock: time,
    scheduler: time,
    clientFactory: () => {
      const c = new FakeObsClient();
      const b = behaviour[Math.min(n++, behaviour.length - 1)];
      if (b === 'fail') c.connectError = new Error('ECONNREFUSED');
      if (b === 'auth') c.connectError = new ObsAuthError('Authentication failed');
      clients.push(c);
      return c;
    },
    hooks: {
      onConnected: () => void events.push('connected'),
      onDisconnected: () => void events.push('disconnected'),
      report: (e) => void errors.push(e),
    },
  });
  return { time, clients, events, errors, conn };
}

/** Mirrors the real obs-websocket-js client, which emits ConnectionClosed during a failed connect. */
class ClosingFailClient extends FakeObsClient {
  override async connect(): Promise<{ obsWebSocketVersion: string; negotiatedRpcVersion: number }> {
    this.emit('ConnectionClosed', { code: 1006 });
    throw new Error('ECONNREFUSED');
  }
}

/** A client whose connect() stays pending until finish() is called. */
class DeferredConnectClient extends FakeObsClient {
  private release!: () => void;
  private readonly gate = new Promise<void>((resolve) => { this.release = resolve; });
  override async connect(): Promise<{ obsWebSocketVersion: string; negotiatedRpcVersion: number }> {
    await this.gate;
    this.connected = true;
    return { obsWebSocketVersion: '5.5.0', negotiatedRpcVersion: 1 };
  }
  finish(): void { this.release(); }
}

/** A client whose disconnect() resolves on a later turn, like a real socket teardown. */
class LateDisconnectClient extends FakeObsClient {
  override async disconnect(): Promise<void> {
    await new Promise<void>((resolve) => setImmediate(resolve));
    this.connected = false;
  }
}

describe('ObsConnection', () => {
  it('connects with the given credentials', async () => {
    const h = harness(['ok']);
    h.conn.setCredentials({ host: '127.0.0.1', port: 4455, password: 'secret' });
    await flush();
    expect(h.conn.state).toBe('connected');
    expect(h.events).toEqual(['connected']);
  });

  it('retries with exponential backoff capped at 5 s', async () => {
    const h = harness(['fail', 'fail', 'fail', 'fail', 'fail', 'ok']);
    h.conn.setCredentials({ host: '127.0.0.1', port: 4455 });
    await flush();
    expect(h.conn.state).toBe('disconnected');
    const waits = [500, 1000, 2000, 4000, 5000];
    for (const w of waits) {
      h.time.advance(w - 1);
      await flush();
      const before = h.clients.length;
      h.time.advance(1);
      await flush();
      expect(h.clients.length).toBe(before + 1);
    }
    expect(h.conn.state).toBe('connected');
  });

  it('stops retrying after an authentication failure until new credentials arrive', async () => {
    const h = harness(['auth', 'ok']);
    h.conn.setCredentials({ host: '127.0.0.1', port: 4455, password: 'wrong-password' });
    await flush();
    expect(h.conn.state).toBe('auth_failed');
    h.time.advance(60_000);
    await flush();
    expect(h.clients.length).toBe(1);
    expect(JSON.stringify(h.errors.map(String))).not.toContain('wrong-password');
    h.conn.setCredentials({ host: '127.0.0.1', port: 4455, password: 'right' });
    await flush();
    expect(h.conn.state).toBe('connected');
  });

  it('reports a lost connection once, then reconnects', async () => {
    const h = harness(['ok', 'ok']);
    h.conn.setCredentials({ host: '127.0.0.1', port: 4455 });
    await flush();
    h.clients[0]!.emit('ExitStarted', {});
    h.clients[0]!.emit('ConnectionClosed', { code: 1001 });
    await flush();
    expect(h.events).toEqual(['connected', 'disconnected']);
    h.time.advance(500);
    await flush();
    expect(h.events).toEqual(['connected', 'disconnected', 'connected']);
  });

  it('ignores ConnectionClosed emitted by a failed connect so it schedules exactly one retry', async () => {
    const time = new FakeTime();
    const clients: FakeObsClient[] = [];
    const events: string[] = [];
    const errors: unknown[] = [];
    const conn = new ObsConnection({
      clock: time,
      scheduler: time,
      clientFactory: () => {
        const c = new ClosingFailClient();
        clients.push(c);
        return c;
      },
      hooks: {
        onConnected: () => void events.push('connected'),
        onDisconnected: () => void events.push('disconnected'),
        report: (e) => void errors.push(e),
      },
    });
    conn.setCredentials({ host: '127.0.0.1', port: 4455 });
    await flush();
    await flush();
    expect(clients.length).toBe(1);
    expect(time.pending).toBe(1);
    expect(events).toEqual([]);
    expect(errors.length).toBe(1);
  });

  it('stop() cancels everything', async () => {
    const h = harness(['fail']);
    h.conn.setCredentials({ host: '127.0.0.1', port: 4455 });
    await flush();
    await h.conn.stop();
    expect(h.time.pending).toBe(0);
    expect(h.conn.state).toBe('idle');
  });

  it('reports and schedules a retry when the client factory throws', async () => {
    const time = new FakeTime();
    const errors: unknown[] = [];
    const conn = new ObsConnection({
      clock: time,
      scheduler: time,
      clientFactory: () => { throw new Error('factory boom'); },
      hooks: {
        onConnected: () => undefined,
        onDisconnected: () => undefined,
        report: (e) => void errors.push(e),
      },
    });
    conn.setCredentials({ host: '127.0.0.1', port: 4455 });
    await flush();
    expect(conn.state).toBe('disconnected');
    expect(errors.length).toBe(1);
    expect(time.pending).toBe(1);
  });

  it('keeps retrying without an unhandled rejection when report throws', async () => {
    const time = new FakeTime();
    const unhandled: unknown[] = [];
    const onUnhandled = (err: unknown) => void unhandled.push(err);
    process.on('unhandledRejection', onUnhandled);
    try {
      const conn = new ObsConnection({
        clock: time,
        scheduler: time,
        clientFactory: () => {
          const c = new FakeObsClient();
          c.connectError = new Error('ECONNREFUSED');
          return c;
        },
        hooks: {
          onConnected: () => undefined,
          onDisconnected: () => undefined,
          report: () => { throw new Error('report boom'); },
        },
      });
      conn.setCredentials({ host: '127.0.0.1', port: 4455 });
      await flush();
      await flush();
      expect(conn.state).toBe('disconnected');
      expect(time.pending).toBe(1);
      expect(unhandled).toEqual([]);
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }
  });

  it('emits disconnected before connected when credentials change while connected', async () => {
    const time = new FakeTime();
    const events: string[] = [];
    const clients: FakeObsClient[] = [];
    let n = 0;
    const conn = new ObsConnection({
      clock: time,
      scheduler: time,
      clientFactory: () => {
        const c = n++ === 0 ? new LateDisconnectClient() : new FakeObsClient();
        clients.push(c);
        return c;
      },
      hooks: {
        onConnected: () => void events.push('connected'),
        onDisconnected: () => void events.push('disconnected'),
        report: () => undefined,
      },
    });
    conn.setCredentials({ host: '127.0.0.1', port: 4455, password: 'a' });
    await flush();
    expect(events).toEqual(['connected']);
    conn.setCredentials({ host: '127.0.0.1', port: 4456, password: 'b' });
    await flush();
    await flush();
    expect(events).toEqual(['connected', 'disconnected', 'connected']);
    expect(clients.length).toBe(2);
  });

  it('disconnects the in-flight client when credentials change mid-connect', async () => {
    const time = new FakeTime();
    const current = new DeferredConnectClient();
    const next = new FakeObsClient();
    const events: string[] = [];
    let n = 0;
    const conn = new ObsConnection({
      clock: time,
      scheduler: time,
      clientFactory: () => (n++ === 0 ? current : next),
      hooks: {
        onConnected: () => void events.push('connected'),
        onDisconnected: () => void events.push('disconnected'),
        report: () => undefined,
      },
    });
    conn.setCredentials({ host: '127.0.0.1', port: 4455 });
    await flush();
    expect(conn.state).toBe('connecting');
    conn.setCredentials({ host: '127.0.0.1', port: 4455, password: 'b' });
    await flush();
    expect(conn.state).toBe('connected');
    expect(events).toEqual(['connected']);
    current.finish();
    await flush();
    await flush();
    expect(current.connected).toBe(false);
    expect(next.connected).toBe(true);
    expect(events).toEqual(['connected']);
  });

  it('disconnects the in-flight client when stopped mid-connect', async () => {
    const time = new FakeTime();
    const current = new DeferredConnectClient();
    const conn = new ObsConnection({
      clock: time,
      scheduler: time,
      clientFactory: () => current,
      hooks: {
        onConnected: () => undefined,
        onDisconnected: () => undefined,
        report: () => undefined,
      },
    });
    conn.setCredentials({ host: '127.0.0.1', port: 4455 });
    await flush();
    expect(conn.state).toBe('connecting');
    await conn.stop();
    expect(conn.state).toBe('idle');
    current.finish();
    await flush();
    await flush();
    expect(current.connected).toBe(false);
    expect(time.pending).toBe(0);
  });

  it('fires onDisconnected once when credentials are cleared while connected', async () => {
    const h = harness(['ok']);
    h.conn.setCredentials({ host: '127.0.0.1', port: 4455 });
    await flush();
    expect(h.events).toEqual(['connected']);
    h.conn.setCredentials(null);
    await flush();
    expect(h.events).toEqual(['connected', 'disconnected']);
    expect(h.conn.state).toBe('idle');
  });
});
