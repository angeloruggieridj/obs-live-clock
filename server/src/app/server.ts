// SPDX-License-Identifier: GPL-2.0-or-later
import { randomUUID } from 'node:crypto';
import { hostname as osHostname, networkInterfaces } from 'node:os';
import websocket from '@fastify/websocket';
import Fastify, { type FastifyInstance } from 'fastify';
import { Episode, Format } from '@olc/shared';
import { registerHostGuard } from '../api/host-guard';
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
  /** Source of local interface addresses for the LAN allowlist. Defaults to `os.networkInterfaces()`. */
  networkAddresses?: () => string[];
  /** Source of the machine hostname for the LAN allowlist. Defaults to `os.hostname()`. */
  hostname?: () => string;
}

export interface BuiltServer {
  app: FastifyInstance;
  runtime: LiveRuntime;
  instanceId: string;
}

/**
 * Hostnames accepted in Host/Origin headers. Loopback always; with LAN access also every local interface
 * address and the machine hostname. Compared on the hostname only, without the port and case-insensitively.
 * Interface addresses are added verbatim: an IPv6 address such as `fe80::1:2` must not be run through the
 * hostname normaliser, which strips everything after the last colon.
 */
function allowedHostnames(lanAccess: boolean, hostnameFn: () => string, addresses: () => string[]): Set<string> {
  const allowed = new Set<string>(['localhost', '127.0.0.1', '::1']);
  if (lanAccess) {
    allowed.add(hostnameFn().toLowerCase());
    for (const address of addresses()) allowed.add(address.toLowerCase());
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
  const hostnameFn = opts.hostname ?? osHostname;
  const networkAddresses =
    opts.networkAddresses ??
    (() => Object.values(networkInterfaces()).flatMap((list) => (list ?? []).map((entry) => entry.address)));
  registerHostGuard(app, allowedHostnames(opts.lanAccess ?? false, hostnameFn, networkAddresses));
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
