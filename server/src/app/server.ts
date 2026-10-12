// SPDX-License-Identifier: GPL-2.0-or-later
import { randomUUID } from 'node:crypto';
import { hostname as osHostname, networkInterfaces } from 'node:os';
import websocket from '@fastify/websocket';
import Fastify, { type FastifyInstance } from 'fastify';
import { Episode, Format } from '@olc/shared';
import { registerHostGuard } from '../api/host-guard';
import { registerHttp } from '../api/http';
import { registerInternal } from '../api/internal';
import { registerObsRoutes } from '../api/obs';
import { registerStatic } from '../api/static';
import { registerSystem } from '../api/system';
import { registerWs } from '../api/ws';
import { systemClock, systemScheduler, type Clock, type Scheduler } from '../clock/clock';
import { HotkeyService } from '../hotkeys/hotkey-service';
import { KioskController, type KioskDeps } from '../kiosk/controller';
import { detectBrowser } from '../kiosk/detect';
import { nodeDetectDeps, nodeSpawn } from '../kiosk/node-kiosk';
import { ScreenRegistry, ScreensBody } from '../kiosk/screens';
import { createObsClient, type ObsClient } from '../obs/client';
import type { ObsCredentials } from '../obs/connection';
import { ObsService } from '../obs/obs-service';
import { LiveJournal } from '../persistence/journal';
import { readJson, writeJsonAtomic } from '../persistence/json-file';
import { DocumentRepository, type InvalidDocument } from '../persistence/repository';
import { SnapshotStore } from '../persistence/snapshot-store';
import { LiveRuntime } from '../runtime/live-runtime';
import { dataPaths } from './paths';
import { ensureSecretToken } from './secret';
import { Settings, SettingsHolder } from './settings';
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
  /** OBS client factory. Defaults to the real `createObsClient`; tests inject a fake. */
  obsClientFactory?: () => ObsClient;
  /** DT-5 remote mode: credentials used at startup when no plugin hands them over at runtime. */
  obsCredentials?: ObsCredentials;
  /** Platform selector passed to `ensureSecretToken`, injectable so tests can avoid the real `icacls`. */
  platform?: NodeJS.Platform;
  /** ACL restriction runner passed to `ensureSecretToken`, injectable so tests never shell out to `icacls`. */
  restrictAcl?: (path: string) => Promise<void>;
  /** Built web app directory; null (default) answers 503 on the pages. */
  webRoot?: string | null;
  /** The settings the app runs with (main.ts loads them from settings.json). Defaults to all-defaults. */
  settings?: Settings;
  /** Test seam: replaces how the kiosk browser is detected and started. The defaults are the real ones. */
  kioskDeps?: Partial<Pick<KioskDeps, 'spawn' | 'detect'>>;
}

export interface BuiltServer {
  app: FastifyInstance;
  runtime: LiveRuntime;
  instanceId: string;
  /** Not started by buildServer: main.ts starts it once the app is listening, when settings.kiosk.enabled. */
  kiosk: KioskController;
  hotkeys: HotkeyService;
  screens: ScreenRegistry;
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
  const app = Fastify({ logger: opts.logger ?? false });
  const secret = await ensureSecretToken(paths.secret, { restrictAcl: opts.restrictAcl, platform: opts.platform });
  if (secret.aclWarning !== undefined) {
    app.log.warn({ warning: secret.aclWarning }, 'Could not restrict the secret token file ACL');
  }
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

  // The reporter logs the message only: an OBS error must never carry the password into the log.
  const obs = new ObsService({
    runtime,
    clock,
    scheduler,
    clientFactory: opts.obsClientFactory ?? createObsClient,
    report: (err) => app.log.error(err instanceof Error ? err.message : String(err)),
  });
  if (opts.obsCredentials !== undefined) obs.setCredentials(opts.obsCredentials);

  const instanceId = randomUUID();

  // Plugin and kiosk (Plan 6): hotkeys with their confirmation rule, the monitor list, the kiosk browser.
  const settings = opts.settings ?? Settings.parse({});
  const settingsHolder = new SettingsHolder(paths.settings, settings);
  const hotkeys = new HotkeyService({ runtime, clock });
  const screens = new ScreenRegistry(
    {
      load: async () => (await readJson(paths.screens, ScreensBody))?.screens ?? [],
      save: (list) => writeJsonAtomic(paths.screens, { screens: list }),
    },
    (err) => app.log.warn({ error: err instanceof Error ? err.message : String(err) }, 'Screen list file problem'),
  );
  await screens.init();
  const detectDeps = nodeDetectDeps();
  const kiosk = new KioskController(
    {
      clock,
      scheduler,
      spawn: opts.kioskDeps?.spawn ?? nodeSpawn,
      detect: opts.kioskDeps?.detect ?? ((override) => detectBrowser(detectDeps, override)),
      screens: () => {
        const known = screens.get().screens;
        return known.length > 0 ? known : null;
      },
      port: () => settings.port,
      profileDir: paths.kioskProfile,
      log: (message) => app.log.info(message),
    },
    settings.kiosk,
  );
  screens.onChange(() => kiosk.onScreensChanged());
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
  const episodes = new DocumentRepository(paths.episodes, Episode, warnInvalid('episode'));
  registerHttp(app, {
    formats: new DocumentRepository(paths.formats, Format, warnInvalid('format')),
    episodes,
    runtime,
    version,
    instanceId,
  });
  registerInternal(app, { token: secret.token, obs, hotkeys, screens });
  registerSystem(app, { settings: settingsHolder, hotkeys, screens, kiosk });
  registerObsRoutes(app, { obs, episodes, clock, scheduler });
  registerWs(app, { runtime, clock, version, instanceId, heartbeatMs: opts.heartbeatMs ?? 1_000 });
  registerStatic(app, { root: opts.webRoot ?? null });
  app.addHook('onClose', async () => {
    kiosk.dispose(); // close the browser we opened, before anything else can delay it
    try {
      await withTimeout(obs.stop(), OBS_STOP_TIMEOUT_MS, clock, scheduler);
    } finally {
      // A screen report queued just before shutdown must land, and before the process exits.
      await screens.flush();
      // Flush persistence before disposing so a snapshot/journal write queued by the last dispatch lands.
      await runtime.flush();
      runtime.dispose();
    }
  });
  return { app, runtime, instanceId, kiosk, hotkeys, screens };
}

/** Bounds on how long shutdown waits for OBS: a hung socket must not block flush/dispose forever. */
const OBS_STOP_TIMEOUT_MS = 3_000;

/** Resolves with `promise`, or rejects once the injected clock passes `at + ms`. The losing result is dropped. */
function withTimeout<T>(promise: Promise<T>, ms: number, clock: Clock, scheduler: Scheduler): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const cancel = scheduler.setTimer(clock.now() + ms, () => {
      if (settled) return;
      settled = true;
      reject(new Error(`OBS stop timed out after ${ms} ms`));
    });
    promise.then(
      (value) => {
        if (settled) return;
        settled = true;
        cancel();
        resolve(value);
      },
      (err: unknown) => {
        if (settled) return;
        settled = true;
        cancel();
        reject(err);
      },
    );
  });
}
