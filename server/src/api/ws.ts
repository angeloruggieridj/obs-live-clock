// SPDX-License-Identifier: GPL-2.0-or-later
import type { FastifyInstance } from 'fastify';
import type { WebSocket } from 'ws';
import { ClientMessage, PROTOCOL_VERSION, type ClientRole, type ServerMessage } from '@olc/shared';
import type { Clock } from '../clock/clock';
import { NoEpisodeError, type LiveRuntime } from '../runtime/live-runtime';

export const DEFAULT_MAX_BUFFERED_BYTES = 1_048_576;
export const DEFAULT_PING_INTERVAL_MS = 5_000;

/** The subset of a ws WebSocket that `safeSend` touches (tests pass a fake). */
export interface SendTarget {
  readonly readyState: number;
  readonly OPEN: number;
  readonly bufferedAmount: number;
  send(data: string): void;
  terminate(): void;
}

/**
 * Sends one message without ever throwing. A peer that does not drain its socket (bufferedAmount above the cap)
 * is terminated instead of growing the server's memory. Returns false when nothing was sent.
 */
export function safeSend(socket: SendTarget, msg: ServerMessage, maxBuffered: number, report: (err: unknown) => void): boolean {
  try {
    if (socket.readyState !== socket.OPEN) return false;
    if (socket.bufferedAmount > maxBuffered) {
      report(new Error(`WebSocket peer not draining (${socket.bufferedAmount} bytes buffered); closing it`));
      socket.terminate();
      return false;
    }
    socket.send(JSON.stringify(msg));
    return true;
  } catch (err) {
    report(err);
    return false;
  }
}

export interface WsContext {
  runtime: LiveRuntime;
  clock: Clock;
  version: string;
  instanceId: string;
  heartbeatMs: number;
  /** How often each socket is pinged; defaults to `DEFAULT_PING_INTERVAL_MS`. */
  pingIntervalMs?: number;
  /** Bytes a socket may buffer before it is treated as not draining; defaults to `DEFAULT_MAX_BUFFERED_BYTES`. */
  maxBufferedBytes?: number;
}

interface Client {
  role: ClientRole | null;
  lastView: string | null;
  /** Rev of the last view sent to this client; 0 before the first view. Heartbeats report it. */
  lastRev: number;
  /** False between a ping and the next pong (or any message): a peer that stays false is half-open. */
  alive: boolean;
}

/** The string `id` of a raw message, when it has one (a malformed command still carries its id). */
function rawId(data: unknown): string | null {
  if (typeof data !== 'object' || data === null) return null;
  const id = (data as { id?: unknown }).id;
  return typeof id === 'string' ? id : null;
}

export function registerWs(app: FastifyInstance, ctx: WsContext): void {
  const clients = new Map<WebSocket, Client>();
  let rev = 0;

  const maxBuffered = ctx.maxBufferedBytes ?? DEFAULT_MAX_BUFFERED_BYTES;
  const sendTo = (socket: WebSocket, msg: ServerMessage) => safeSend(socket, msg, maxBuffered, (err) => app.log.error(err));

  /** Run a projection safely: a throwing projection is logged and yields no view for this push. */
  const project = (fn: () => unknown): { ok: boolean; view: unknown } => {
    try {
      return { ok: true, view: fn() };
    } catch (err) {
      app.log.error(err);
      return { ok: false, view: null };
    }
  };

  const pushViews = () => {
    // Project each role at most once per push, so one bad role never hides the other.
    const presenter = project(() => ctx.runtime.presenterView());
    const control = project(() => ctx.runtime.controlView());
    for (const [socket, client] of clients) {
      if (client.role === null) continue;
      try {
        const projected = client.role === 'presenter' ? presenter : control;
        if (!projected.ok) continue;
        const json = JSON.stringify(projected.view);
        if (json === client.lastView) continue;
        client.lastView = json;
        rev += 1;
        client.lastRev = rev;
        sendTo(socket, { type: 'view', rev, role: client.role, view: projected.view });
      } catch (err) {
        app.log.error(err);
      }
    }
  };

  const unsubscribe = ctx.runtime.subscribe(pushViews);
  const heartbeat = setInterval(() => {
    try {
      pushViews();
    } catch (err) {
      app.log.error(err);
    }
    for (const [socket, client] of clients) {
      try {
        if (client.role !== null) sendTo(socket, { type: 'heartbeat', rev: client.lastRev, serverWall: ctx.clock.wall() });
      } catch (err) {
        app.log.error(err);
      }
    }
  }, ctx.heartbeatMs);

  const liveness = setInterval(() => {
    for (const [socket, client] of clients) {
      try {
        if (!client.alive) {
          app.log.warn('Terminating a WebSocket peer that stopped answering pings');
          clients.delete(socket);
          socket.terminate();
          continue;
        }
        client.alive = false;
        socket.ping();
      } catch (err) {
        app.log.error(err);
      }
    }
  }, ctx.pingIntervalMs ?? DEFAULT_PING_INTERVAL_MS);

  app.addHook('onClose', async () => {
    clearInterval(heartbeat);
    clearInterval(liveness);
    unsubscribe();
    for (const socket of clients.keys()) socket.close(1001, 'server shutting down');
    clients.clear();
  });

  app.get('/ws', { websocket: true }, (socket) => {
    const client: Client = { role: null, lastView: null, lastRev: 0, alive: true };
    clients.set(socket, client);
    socket.on('close', () => clients.delete(socket));
    socket.on('pong', () => {
      client.alive = true;
    });

    socket.on('message', (raw) => {
      client.alive = true;
      let data: unknown;
      try {
        data = JSON.parse(raw.toString());
      } catch {
        sendTo(socket, { type: 'error', id: null, code: 'invalid_message', message: 'Malformed JSON' });
        return;
      }

      let commandId: string | null = null;
      try {
        const parsed = ClientMessage.safeParse(data);
        if (!parsed.success) {
          sendTo(socket, {
            type: 'error',
            id: rawId(data),
            code: 'invalid_message',
            message: 'Unknown or invalid message',
          });
          return;
        }
        const msg = parsed.data;

        if (msg.type === 'hello') {
          if (msg.protocol !== PROTOCOL_VERSION) {
            sendTo(socket, {
              type: 'error',
              id: null,
              code: 'protocol_mismatch',
              message: `Server speaks protocol ${PROTOCOL_VERSION}`,
            });
            socket.close(4001, 'protocol_mismatch');
            return;
          }
          client.role = msg.role;
          client.lastView = null;
          client.lastRev = 0;
          sendTo(socket, { type: 'welcome', serverVersion: ctx.version, instanceId: ctx.instanceId, protocol: PROTOCOL_VERSION });
          pushViews();
          return;
        }

        if (client.role === null) {
          sendTo(socket, {
            type: 'error',
            id: msg.type === 'command' ? msg.id : null,
            code: 'hello_required',
            message: 'Send hello first',
          });
          return;
        }

        if (msg.type === 'time.ping') {
          sendTo(socket, { type: 'time.pong', t0: msg.t0, serverWall: ctx.clock.wall() });
          return;
        }

        if (client.role === 'presenter') {
          sendTo(socket, { type: 'error', id: msg.id, code: 'forbidden', message: 'The presenter role cannot send commands' });
          return;
        }

        commandId = msg.id;
        const changed = ctx.runtime.command(msg.command);
        sendTo(socket, { type: 'ack', id: msg.id, changed });
      } catch (err) {
        if (err instanceof NoEpisodeError) {
          sendTo(socket, { type: 'error', id: commandId, code: 'no_episode', message: 'No episode is loaded' });
          return;
        }
        app.log.error(err);
        sendTo(socket, { type: 'error', id: commandId, code: 'internal', message: 'Internal error' });
      }
    });
  });
}
