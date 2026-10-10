// SPDX-License-Identifier: GPL-2.0-or-later
import { randomUUID } from 'node:crypto';
import { hostname, networkInterfaces } from 'node:os';
import websocket from '@fastify/websocket';
import Fastify, { type FastifyInstance } from 'fastify';
import { Episode, Format } from '@olc/shared';
import { normalizeHostname, registerHostGuard } from '../api/host-guard';
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
  /** TECH-DESIGN §10: when false (default) only loopback hostnames are accepted. */
  lanAccess?: boolean;
}

export interface BuiltServer {
  app: FastifyInstance;
  runtime: LiveRuntime;
  instanceId: string;
}

/**
 * Hostnames accepted in Host/Origin headers. Loopback always; with LAN access also every local interface
 * address and the machine hostname. Compared on the hostname only, without the port and case-insensitively.
 */
function allowedHostnames(lanAccess: boolean): Set<string> {
  const allowed = new Set<string>(['localhost', '127.0.0.1', '::1']);
  if (lanAccess) {
    allowed.add(hostname().toLowerCase());
    for (const addresses of Object.values(networkInterfaces())) {
      for (const address of addresses ?? []) {
        const h = normalizeHostname(address.address);
        if (h !== null) allowed.add(h);
      }
    }
  }
  return allowed;
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
  // Registered after the websocket plugin so its onRequest hook (which marks upgrade requests) runs first;
  // our 403 then triggers the plugin's onResponse, which destroys the raw socket. Otherwise the client waits.
  registerHostGuard(app, allowedHostnames(opts.lanAccess ?? false));
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
