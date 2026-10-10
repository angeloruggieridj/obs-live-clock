// SPDX-License-Identifier: GPL-2.0-or-later
import type { FastifyInstance } from 'fastify';
import type { WebSocket } from 'ws';
import { ClientMessage, PROTOCOL_VERSION, type ClientRole, type ServerMessage } from '@olc/shared';
import type { Clock } from '../clock/clock';
import { NoEpisodeError, type LiveRuntime } from '../runtime/live-runtime';

export interface WsContext {
  runtime: LiveRuntime;
  clock: Clock;
  version: string;
  instanceId: string;
  heartbeatMs: number;
}

interface Client {
  role: ClientRole | null;
  lastView: string | null;
  /** Rev of the last view sent to this client; 0 before the first view. Heartbeats report it. */
  lastRev: number;
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

  const send = (socket: WebSocket, msg: ServerMessage) => {
    if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(msg));
  };

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
        send(socket, { type: 'view', rev, role: client.role, view: projected.view });
      } catch (err) {
        app.log.error(err);
      }
    }
  };

  const unsubscribe = ctx.runtime.subscribe(pushViews);
  const heartbeat = setInterval(() => {
    try {
      pushViews();
      for (const [socket, client] of clients) {
        if (client.role !== null) send(socket, { type: 'heartbeat', rev: client.lastRev, serverWall: ctx.clock.wall() });
      }
    } catch (err) {
      app.log.error(err);
    }
  }, ctx.heartbeatMs);

  app.addHook('onClose', async () => {
    clearInterval(heartbeat);
    unsubscribe();
    for (const socket of clients.keys()) socket.close(1001, 'server shutting down');
    clients.clear();
  });

  app.get('/ws', { websocket: true }, (socket) => {
    const client: Client = { role: null, lastView: null, lastRev: 0 };
    clients.set(socket, client);
    socket.on('close', () => clients.delete(socket));

    socket.on('message', (raw) => {
      let data: unknown;
      try {
        data = JSON.parse(raw.toString());
      } catch {
        send(socket, { type: 'error', id: null, code: 'invalid_message', message: 'Malformed JSON' });
        return;
      }

      let commandId: string | null = null;
      try {
        const parsed = ClientMessage.safeParse(data);
        if (!parsed.success) {
          send(socket, {
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
            send(socket, {
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
          send(socket, { type: 'welcome', serverVersion: ctx.version, instanceId: ctx.instanceId, protocol: PROTOCOL_VERSION });
          pushViews();
          return;
        }

        if (client.role === null) {
          send(socket, {
            type: 'error',
            id: msg.type === 'command' ? msg.id : null,
            code: 'hello_required',
            message: 'Send hello first',
          });
          return;
        }

        if (msg.type === 'time.ping') {
          send(socket, { type: 'time.pong', t0: msg.t0, serverWall: ctx.clock.wall() });
          return;
        }

        if (client.role === 'presenter') {
          send(socket, { type: 'error', id: msg.id, code: 'forbidden', message: 'The presenter role cannot send commands' });
          return;
        }

        commandId = msg.id;
        const changed = ctx.runtime.command(msg.command);
        send(socket, { type: 'ack', id: msg.id, changed });
      } catch (err) {
        if (err instanceof NoEpisodeError) {
          send(socket, { type: 'error', id: commandId, code: 'no_episode', message: 'No episode is loaded' });
          return;
        }
        app.log.error(err);
        send(socket, { type: 'error', id: commandId, code: 'internal', message: 'Internal error' });
      }
    });
  });
}
