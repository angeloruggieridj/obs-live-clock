// SPDX-License-Identifier: GPL-2.0-or-later
import { mkdir } from 'node:fs/promises';
import { PROTOCOL_VERSION } from '@olc/shared';
import { acquireLock, olcInstanceAlive } from './instance-lock';
import { dataPaths, defaultDataDir, defaultWebRoot } from './paths';
import { removeRuntimeFile, writeRuntimeFile } from './runtime-file';
import { buildServer } from './server';
import { listenHost, loadSettings } from './settings';
import { APP_VERSION } from './version';

async function main(): Promise<void> {
  const paths = dataPaths(defaultDataDir());
  await mkdir(paths.root, { recursive: true });
  const release = await acquireLock(paths.lock, process.pid, olcInstanceAlive(paths, paths.lock));
  try {
    const settings = await loadSettings(paths.settings, (err) =>
      console.warn(
        '[obs-live-clock] invalid settings; using defaults:',
        err instanceof Error ? err.message : String(err),
      ),
    );
    const { app, instanceId, kiosk } = await buildServer({
      dataDir: paths.root,
      logger: true,
      lanAccess: settings.lanAccess,
      obsCredentials: settings.obs,
      webRoot: defaultWebRoot(),
      settings,
    });
    await app.listen({ port: settings.port, host: listenHost(settings) });
    await writeRuntimeFile(paths.runtime, {
      port: settings.port,
      pid: process.pid,
      instanceId,
      version: APP_VERSION,
      protocol: PROTOCOL_VERSION,
    });
    if (settings.kiosk.enabled) {
      kiosk.start().catch((err: unknown) => app.log.error({ error: err instanceof Error ? err.message : String(err) }, 'Kiosk start failed'));
    }

    const shutdown = async (): Promise<void> => {
      try {
        await app.close();
      } finally {
        await removeRuntimeFile(paths.runtime, instanceId);
        await release();
      }
      process.exit(0);
    };
    const onSignal = () =>
      void shutdown().catch((err: unknown) => {
        console.error(err);
        process.exit(1);
      });
    process.once('SIGINT', onSignal);
    process.once('SIGTERM', onSignal);
  } catch (err) {
    // Startup failed after we took the lock: release it so a retry is not blocked.
    await release();
    throw err;
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
