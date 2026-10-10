// SPDX-License-Identifier: GPL-2.0-or-later
import { mkdir } from 'node:fs/promises';
import { writeJsonAtomic } from '../persistence/json-file';
import { acquireLock } from './instance-lock';
import { dataPaths, defaultDataDir } from './paths';
import { buildServer } from './server';
import { listenHost, loadSettings } from './settings';

async function main(): Promise<void> {
  const paths = dataPaths(defaultDataDir());
  await mkdir(paths.root, { recursive: true });
  const release = await acquireLock(paths.lock);
  const settings = await loadSettings(paths.settings);
  const { app, instanceId } = await buildServer({ dataDir: paths.root, logger: true, lanAccess: settings.lanAccess });
  await app.listen({ port: settings.port, host: listenHost(settings) });
  await writeJsonAtomic(paths.runtime, { port: settings.port, pid: process.pid, instanceId });

  const shutdown = async () => {
    await app.close();
    await release();
    process.exit(0);
  };
  process.once('SIGINT', () => void shutdown());
  process.once('SIGTERM', () => void shutdown());
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
