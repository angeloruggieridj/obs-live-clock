// SPDX-License-Identifier: GPL-2.0-or-later
import { mkdir } from 'node:fs/promises';
import { writeJsonAtomic } from '../persistence/json-file';
import { acquireLock, olcInstanceAlive } from './instance-lock';
import { dataPaths, defaultDataDir } from './paths';
import { buildServer } from './server';
import { listenHost, loadSettings } from './settings';

async function main(): Promise<void> {
  const paths = dataPaths(defaultDataDir());
  await mkdir(paths.root, { recursive: true });
  const release = await acquireLock(paths.lock, process.pid, olcInstanceAlive(paths, paths.lock));
  try {
    const settings = await loadSettings(paths.settings, (err) =>
      console.warn('[obs-live-clock] invalid settings; using defaults:', err),
    );
    const { app, instanceId } = await buildServer({ dataDir: paths.root, logger: true, lanAccess: settings.lanAccess });
    await app.listen({ port: settings.port, host: listenHost(settings) });
    await writeJsonAtomic(paths.runtime, { port: settings.port, pid: process.pid, instanceId });

    const shutdown = async (): Promise<void> => {
      try {
        await app.close();
      } finally {
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
