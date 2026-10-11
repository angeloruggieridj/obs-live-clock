// SPDX-License-Identifier: GPL-2.0-or-later
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const APP_DIR = 'obs-live-clock';

export function defaultDataDir(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  home: string = homedir(),
): string {
  if (env.OLC_DATA_DIR) return env.OLC_DATA_DIR;
  if (platform === 'win32') return join(env.APPDATA ?? join(home, 'AppData', 'Roaming'), APP_DIR);
  if (platform === 'darwin') return join(home, 'Library', 'Application Support', APP_DIR);
  return join(env.XDG_CONFIG_HOME ?? join(home, '.config'), APP_DIR);
}

/** Where the built web app lives: OLC_WEB_ROOT, else `<repo>/web/dist` relative to this module (dev layout). */
export function defaultWebRoot(env: NodeJS.ProcessEnv = process.env, moduleUrl: string = import.meta.url): string {
  if (env.OLC_WEB_ROOT) return env.OLC_WEB_ROOT;
  return fileURLToPath(new URL('../../../web/dist', moduleUrl));
}

export interface DataPaths {
  root: string;
  settings: string;
  formats: string;
  episodes: string;
  live: string;
  snapshot: string;
  journal(episodeId: string): string;
  secret: string;
  lock: string;
  runtime: string;
}

export function dataPaths(root: string): DataPaths {
  return {
    root,
    settings: join(root, 'settings.json'),
    formats: join(root, 'formats'),
    episodes: join(root, 'episodes'),
    live: join(root, 'live'),
    snapshot: join(root, 'live', 'snapshot.json'),
    journal: (episodeId) => join(root, 'live', `${episodeId}.log.jsonl`),
    secret: join(root, 'secret.token'),
    lock: join(root, 'instance.lock'),
    runtime: join(root, 'runtime.json'),
  };
}
