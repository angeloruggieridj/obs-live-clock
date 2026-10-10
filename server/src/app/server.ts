// SPDX-License-Identifier: GPL-2.0-or-later
import { randomUUID } from 'node:crypto';
import websocket from '@fastify/websocket';
import Fastify, { type FastifyInstance } from 'fastify';
import { Episode, Format } from '@olc/shared';
import { registerHttp } from '../api/http';
import { registerWs } from '../api/ws';
import { systemClock, systemScheduler, type Clock, type Scheduler } from '../clock/clock';
import { LiveJournal } from '../persistence/journal';
import { DocumentRepository, type InvalidDocument } from '../persistence/repository';
import { SnapshotStore } from '../persistence/snapshot-store';
import { LiveRuntime } from '../runtime/live-runtime';
import { dataPaths } from './paths';
import { ensureSecretToken } from './secret';
import { APP_VERSION } from './version';

export interface ServerOptions {
  dataDir: string;
  clock?: Clock;
  scheduler?: Scheduler;
  heartbeatMs?: number;
  logger?: boolean;
  version?: string;
}

export interface BuiltServer {
  app: FastifyInstance;
  runtime: LiveRuntime;
  instanceId: string;
}

export async function buildServer(opts: ServerOptions): Promise<BuiltServer> {
  const clock = opts.clock ?? systemClock;
  const scheduler = opts.scheduler ?? systemScheduler(clock);
  const version = opts.version ?? APP_VERSION;
  const paths = dataPaths(opts.dataDir);
  await ensureSecretToken(paths.secret);

  const app = Fastify({ logger: opts.logger ?? false });
  const warnInvalid = (kind: string) => (doc: InvalidDocument) =>
    app.log.warn({ file: doc.file, error: doc.error }, `Skipping invalid ${kind} file`);

  const runtime = new LiveRuntime({
    clock,
    scheduler,
    snapshots: new SnapshotStore(paths.snapshot),
    journalFor: (episodeId) => new LiveJournal(paths.journal(episodeId)),
    onError: (err) => app.log.error(err),
  });
  await runtime.resume();

  const instanceId = randomUUID();
  // Close live sockets with 1001 "going away" on shutdown (the plugin's default sends no code → clients see 1005).
  await app.register(websocket, {
    preClose(this: FastifyInstance, done: () => void) {
      for (const client of this.websocketServer.clients) client.close(1001, 'server shutting down');
      done();
    },
  });
  registerHttp(app, {
    formats: new DocumentRepository(paths.formats, Format, warnInvalid('format')),
    episodes: new DocumentRepository(paths.episodes, Episode, warnInvalid('episode')),
    runtime,
    version,
    instanceId,
  });
  registerWs(app, { runtime, clock, version, instanceId, heartbeatMs: opts.heartbeatMs ?? 1_000 });
  app.addHook('onClose', async () => {
    runtime.dispose();
    await runtime.flush();
  });
  return { app, runtime, instanceId };
}
