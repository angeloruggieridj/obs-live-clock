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
}

export function registerWs(app: FastifyInstance, ctx: WsContext): void {
  const clients = new Map<WebSocket, Client>();
  let rev = 0;

  const send = (socket: WebSocket, msg: ServerMessage) => {
    if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(msg));
  };

  const viewFor = (role: ClientRole): unknown =>
    role === 'presenter' ? ctx.runtime.presenterView() : ctx.runtime.controlView();

  const pushViews = () => {
    for (const [socket, client] of clients) {
      if (client.role === null) continue;
      const view = viewFor(client.role);
      const json = JSON.stringify(view);
      if (json === client.lastView) continue;
      client.lastView = json;
      rev += 1;
      send(socket, { type: 'view', rev, role: client.role, view });
    }
  };

  const unsubscribe = ctx.runtime.subscribe(pushViews);
  const heartbeat = setInterval(() => {
    pushViews();
    for (const [socket, client] of clients) {
      if (client.role !== null) send(socket, { type: 'heartbeat', rev, serverWall: ctx.clock.wall() });
    }
  }, ctx.heartbeatMs);

  app.addHook('preClose', async () => {
    for (const socket of clients.keys()) socket.close(1001, 'server shutting down');
  });

  app.addHook('onClose', async () => {
    clearInterval(heartbeat);
    unsubscribe();
    for (const socket of clients.keys()) socket.close(1001, 'server shutting down');
    clients.clear();
  });

  app.get('/ws', { websocket: true }, (socket) => {
    const client: Client = { role: null, lastView: null };
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
      const parsed = ClientMessage.safeParse(data);
      if (!parsed.success) {
        send(socket, { type: 'error', id: null, code: 'invalid_message', message: 'Unknown or invalid message' });
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

      try {
        ctx.runtime.command(msg.command);
        send(socket, { type: 'ack', id: msg.id });
      } catch (err) {
        if (!(err instanceof NoEpisodeError)) throw err;
        send(socket, { type: 'error', id: msg.id, code: 'no_episode', message: 'No episode is loaded' });
      }
    });
  });
}
