// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import { PROTOCOL_VERSION } from '@olc/shared';
import { CommandError, LiveClient, wsUrl } from '../../src/core/ws-client';
import { FakeScheduler } from '../support/fake-time';
import { FakeSocket } from '../support/fake-socket';
import { studioView } from '../support/views';

const WELCOME = { type: 'welcome', serverVersion: '0.1.0', instanceId: 'i-1', protocol: PROTOCOL_VERSION };

function setup<R extends 'presenter' | 'control'>(role: R) {
  const time = new FakeScheduler();
  const sockets: FakeSocket[] = [];
  const errors: unknown[] = [];
  const client = new LiveClient({
    url: 'ws://127.0.0.1:4460/ws',
    role,
    createSocket: (url) => {
      const s = new FakeSocket(url);
      sockets.push(s);
      return s;
    },
    local: time.local,
    scheduler: time,
    random: () => 0.5,
    report: (e) => errors.push(e),
  });
  const last = () => sockets[sockets.length - 1]!;
  /** Opens the newest socket and answers its hello with a welcome. */
  const welcome = (instanceId = 'i-1') => {
    last().open();
    last().receive({ ...WELCOME, instanceId });
  };
  return { time, sockets, errors, client, last, welcome };
}

describe('LiveClient', () => {
  it('starts stale with no view and says hello with its role on open', () => {
    const { client, last } = setup('presenter');
    client.start();
    expect(client.getSnapshot()).toMatchObject({ connection: 'connecting', hasView: false, stale: true, synced: false, view: null });
    expect(last().url).toBe('ws://127.0.0.1:4460/ws');
    last().open();
    expect(last().sent).toEqual([{ type: 'hello', role: 'presenter', protocol: PROTOCOL_VERSION }]);
  });

  it('syncs the clock: one ping at once, a burst of four, then one every 5 s', () => {
    const { client, last, welcome, time } = setup('presenter');
    client.start();
    welcome();
    expect(client.getSnapshot().connection).toBe('open');
    expect(last().sentOfType('time.ping')).toEqual([{ type: 'time.ping', t0: 1_000 }]);
    time.advance(40);
    last().receive({ type: 'time.pong', t0: 1_000, serverWall: 5_000_000 });
    expect(client.getSnapshot().synced).toBe(true);
    expect(client.serverNow()).toBe(5_000_020);
    time.advance(710); // 1750: pings at 1250, 1500, 1750
    expect(last().sentOfType('time.ping')).toHaveLength(4);
    time.advance(4_250); // 6000: the 5 s loop
    expect(last().sentOfType('time.ping')).toHaveLength(5);
    time.advance(5_000);
    expect(last().sentOfType('time.ping')).toHaveLength(6);
  });

  it('stores a valid view, then goes stale 2 s after the last fresh message, frozen at that instant', () => {
    const { client, last, welcome, time } = setup('presenter');
    client.start();
    welcome();
    time.advance(40);
    last().receive({ type: 'time.pong', t0: 1_000, serverWall: 5_000_000 }); // offset 4_998_980
    const view = studioView();
    last().receive({ type: 'view', rev: 1, role: 'presenter', view });
    expect(client.getSnapshot()).toMatchObject({ hasView: true, stale: false, staleSince: null, view });
    time.advance(960); // 2000
    last().receive({ type: 'heartbeat', rev: 1, serverWall: 5_001_000 });
    time.advance(2_000); // 4000: exactly 2 s, still fresh
    expect(client.getSnapshot().stale).toBe(false);
    time.advance(250); // 4250
    expect(client.getSnapshot()).toMatchObject({ stale: true, staleSince: 4_000 + 4_998_980 });
    last().receive({ type: 'heartbeat', rev: 1, serverWall: 5_004_000 });
    expect(client.getSnapshot()).toMatchObject({ stale: false, staleSince: null });
  });

  it('goes stale with an unknown instant when the clock was never synced', () => {
    const { client, last, welcome, time } = setup('presenter');
    client.start();
    welcome();
    last().receive({ type: 'view', rev: 1, role: 'presenter', view: studioView() });
    time.advance(2_250);
    expect(client.getSnapshot()).toMatchObject({ stale: true, staleSince: null });
  });

  it('ignores heartbeats until this connection has delivered a view', () => {
    const { client, last, welcome } = setup('presenter');
    client.start();
    welcome();
    last().receive({ type: 'heartbeat', rev: 0, serverWall: 1 });
    expect(client.getSnapshot().stale).toBe(true);
  });

  it('keeps an invalid view out of the snapshot, reports it, and lets the data go stale', () => {
    const { client, last, welcome, time, errors } = setup('presenter');
    client.start();
    welcome();
    const view = studioView();
    last().receive({ type: 'view', rev: 1, role: 'presenter', view });
    last().receive({ type: 'view', rev: 2, role: 'presenter', view: { phase: 'bogus' } });
    expect(client.getSnapshot()).toMatchObject({ view, problem: 'invalid_view' });
    expect(errors).toHaveLength(1);
    for (let i = 0; i < 3; i++) {
      time.advance(1_000);
      last().receive({ type: 'heartbeat', rev: 2, serverWall: 1 });
    }
    expect(client.getSnapshot().stale).toBe(true);
    expect(last().closed).toBeNull();
  });

  it('rejects a view addressed to the other role', () => {
    const { client, last, welcome } = setup('presenter');
    client.start();
    welcome();
    last().receive({ type: 'view', rev: 1, role: 'control', view: null });
    expect(client.getSnapshot()).toMatchObject({ hasView: false, problem: 'invalid_view' });
  });

  it('resynchronises with a new connection when a heartbeat reports an unseen rev', () => {
    const { client, sockets, last, welcome, time } = setup('presenter');
    client.start();
    welcome();
    last().receive({ type: 'view', rev: 3, role: 'presenter', view: studioView() });
    last().receive({ type: 'heartbeat', rev: 4, serverWall: 1 });
    expect(sockets[0]!.closed).toEqual({ code: 4000, reason: 'resync' });
    expect(client.getSnapshot().problem).toBe('rev_mismatch');
    time.advance(500);
    expect(sockets).toHaveLength(2);
  });

  it('reconnects with jittered exponential backoff capped at 5 s', () => {
    const { client, sockets, last, time } = setup('presenter');
    client.start();
    for (const delay of [500, 1_000, 2_000, 4_000, 5_000, 5_000]) {
      const count = sockets.length;
      last().drop();
      expect(client.getSnapshot().connection).toBe('reconnecting');
      time.advance(delay - 1);
      expect(sockets).toHaveLength(count);
      time.advance(1);
      expect(sockets).toHaveLength(count + 1);
    }
  });

  it('does not reset the backoff for connections that drop right after welcome (no reconnect storm)', () => {
    const { client, sockets, last, welcome, time } = setup('presenter');
    client.start();
    for (const delay of [500, 1_000, 2_000]) {
      welcome();
      last().drop();
      const count = sockets.length;
      time.advance(delay - 1);
      expect(sockets).toHaveLength(count);
      time.advance(1);
      expect(sockets).toHaveLength(count + 1);
    }
    welcome();
    time.advance(10_000); // stable for 10 s: the backoff starts over
    last().drop();
    const count = sockets.length;
    time.advance(499);
    expect(sockets).toHaveLength(count);
    time.advance(1);
    expect(sockets).toHaveLength(count + 1);
  });

  it('stops for good on a protocol mismatch', () => {
    const { client, sockets, last, time } = setup('presenter');
    client.start();
    last().open();
    last().receive({ ...WELCOME, protocol: 99 });
    expect(client.getSnapshot().connection).toBe('incompatible');
    expect(sockets[0]!.closed?.code).toBe(4001);
    time.advance(60_000);
    expect(sockets).toHaveLength(1);

    const other = setup('presenter');
    other.client.start();
    other.last().open();
    other.last().drop(4001);
    expect(other.client.getSnapshot().connection).toBe('incompatible');
    other.time.advance(60_000);
    expect(other.sockets).toHaveLength(1);
  });

  it('resolves a command on ack and rejects it on error, timeout and disconnect', async () => {
    const { client, last, welcome, time } = setup('control');
    client.start();
    await expect(client.sendCommand({ name: 'next' })).rejects.toMatchObject({ code: 'disconnected' });
    welcome();
    const ok = client.sendCommand({ name: 'next' });
    expect(last().sentOfType('command')).toEqual([{ type: 'command', id: 'c1', command: { name: 'next' } }]);
    last().receive({ type: 'ack', id: 'c1', changed: false });
    await expect(ok).resolves.toEqual({ changed: false });
    const bad = client.sendCommand({ name: 'prev' });
    last().receive({ type: 'error', id: 'c2', code: 'no_episode', message: 'No episode is loaded' });
    await expect(bad).rejects.toBeInstanceOf(CommandError);
    await expect(bad).rejects.toMatchObject({ code: 'no_episode' });
    const slow = client.sendCommand({ name: 'clear_message' });
    time.advance(3_000);
    await expect(slow).rejects.toMatchObject({ code: 'timeout' });
    const cut = client.sendCommand({ name: 'clear_message' });
    last().drop();
    await expect(cut).rejects.toMatchObject({ code: 'disconnected' });
  });

  it('stop closes the socket, rejects pending commands and never reconnects', async () => {
    const { client, sockets, welcome, time } = setup('control');
    client.start();
    welcome();
    const pending = client.sendCommand({ name: 'next' });
    client.stop();
    await expect(pending).rejects.toMatchObject({ code: 'disconnected' });
    expect(sockets[0]!.closed?.code).toBe(1000);
    time.advance(60_000);
    expect(sockets).toHaveLength(1);
  });

  it('survives malformed frames and a throwing socket factory', () => {
    const time = new FakeScheduler();
    const errors: unknown[] = [];
    const sockets: FakeSocket[] = [];
    let calls = 0;
    const client = new LiveClient({
      url: 'ws://x/ws',
      role: 'presenter',
      local: time.local,
      scheduler: time,
      random: () => 0.5,
      report: (e) => errors.push(e),
      createSocket: (url) => {
        calls += 1;
        if (calls === 1) throw new Error('boom');
        const s = new FakeSocket(url);
        sockets.push(s);
        return s;
      },
    });
    client.start();
    expect(errors).toHaveLength(1);
    time.advance(500);
    expect(sockets).toHaveLength(1);
    sockets[0]!.open();
    sockets[0]!.receiveRaw('not json');
    expect(client.getSnapshot().problem).toBe('invalid_message');
    sockets[0]!.receive({ type: 'nope' });
    expect(client.getSnapshot().problem).toBe('invalid_message');
  });

  it('forgets the clock offset when a different server instance answers', () => {
    const { client, last, welcome, time } = setup('presenter');
    client.start();
    welcome('i-1');
    last().receive({ type: 'time.pong', t0: 1_000, serverWall: 5_000_000 });
    expect(client.getSnapshot().synced).toBe(true);
    last().drop();
    time.advance(500);
    welcome('i-1');
    // Every close drops the old samples (an old minimum-RTT sample may be a lie after a suspend): even the same
    // server instance is unsynced until a fresh pong arrives on the new connection.
    expect(client.getSnapshot().synced).toBe(false);
    last().receive({ type: 'time.pong', t0: 1_500, serverWall: 5_000_000 });
    expect(client.getSnapshot().synced).toBe(true);
    last().drop();
    time.advance(1_000);
    welcome('i-2');
    expect(client.getSnapshot().synced).toBe(false);
    expect(client.serverNow()).toBeNull();
  });

  it('adopts the shifted server clock after a reconnect across a long gap', () => {
    const { client, last, welcome, time } = setup('presenter');
    client.start();
    welcome('i-1');
    time.advance(40);
    last().receive({ type: 'time.pong', t0: 1_000, serverWall: 5_000_000 }); // offset 4_998_980
    expect(client.serverNow()).toBe(5_000_020);
    last().drop();
    time.advance(500); // the server clock has moved on by the time the client is back
    welcome('i-1');
    expect(client.getSnapshot().synced).toBe(false);
    time.advance(40);
    last().receive({ type: 'time.pong', t0: 1_540, serverWall: 9_000_000 });
    expect(client.serverNow()).toBe(9_000_020);
  });

  it('replaces the ping timers on a second welcome instead of leaking a loop', () => {
    const { client, last, welcome, time } = setup('presenter');
    client.start();
    welcome(); // ping at 1000, burst at 1250/1500/1750, loop at 6000
    time.advance(250); // 1250: the second burst ping
    expect(last().sentOfType('time.ping')).toHaveLength(2);
    last().receive({ ...WELCOME }); // a second welcome on the same connection
    expect(last().sentOfType('time.ping')).toHaveLength(3);
    time.advance(5_000); // 6250
    // 3 so far + burst at 1500/1750/2000 + the single 5 s loop tick at 6250
    expect(last().sentOfType('time.ping')).toHaveLength(7);
  });

  it('closes the socket with 4001 when the server reports a protocol mismatch', () => {
    const { client, last, welcome } = setup('presenter');
    client.start();
    welcome();
    last().receive({ type: 'error', id: null, code: 'protocol_mismatch', message: 'Protocol mismatch' });
    expect(client.getSnapshot()).toMatchObject({ connection: 'incompatible', problem: 'protocol_mismatch' });
    expect(last().closed).toEqual({ code: 4001, reason: 'protocol_mismatch' });
  });

  it('notifies subscribers only on real changes', () => {
    const { client, last, welcome } = setup('presenter');
    let calls = 0;
    const unsubscribe = client.subscribe(() => { calls += 1; });
    client.start();
    welcome();
    const before = calls;
    last().receive({ type: 'time.pong', t0: 1_000, serverWall: 5_000_000 });
    last().receive({ type: 'time.pong', t0: 1_000, serverWall: 5_000_000 });
    expect(calls).toBe(before + 1); // synced flips once
    unsubscribe();
  });

  it('builds the socket URL from the page location', () => {
    expect(wsUrl({ protocol: 'http:', host: '127.0.0.1:4460' })).toBe('ws://127.0.0.1:4460/ws');
    expect(wsUrl({ protocol: 'https:', host: 'regia.local' })).toBe('wss://regia.local/ws');
  });
});
