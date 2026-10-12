// SPDX-License-Identifier: GPL-2.0-or-later
import { execFile, spawn } from 'node:child_process';
import { constants } from 'node:fs';
import { access, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { delimiter, join } from 'node:path';
import { promisify } from 'node:util';
import type { ExitInfo, KioskProcess } from './controller';
import type { DetectDeps } from './detect';

const execFileAsync = promisify(execFile);

/** Starts the browser. A failure to start (ENOENT, EACCES) arrives through onExit with `error` set. */
export function nodeSpawn(command: string, args: string[]): KioskProcess {
  const child = spawn(command, args, { stdio: 'ignore' });
  let callback: ((info: ExitInfo) => void) | null = null;
  let early: ExitInfo | null = null;
  let finished = false;
  const finish = (info: ExitInfo): void => {
    if (finished) return;
    finished = true;
    if (callback !== null) callback(info);
    else early = info;
  };
  child.once('error', (err) => finish({ code: null, error: err.message }));
  child.once('exit', (code) => finish({ code }));
  return {
    get pid() {
      return child.pid;
    },
    kill() {
      child.kill();
    },
    onExit(cb) {
      callback = cb;
      if (early !== null) {
        const info = early;
        early = null;
        cb(info);
      }
    },
  };
}

/**
 * The default value of a `reg query ... /ve` answer. The label before REG_SZ is localised ("(Default)",
 * "(Predefinito)"), so only REG_SZ / REG_EXPAND_SZ is used as the anchor.
 */
export function parseRegQuery(stdout: string): string | null {
  for (const line of stdout.split(/\r?\n/)) {
    const match = /REG_(?:EXPAND_)?SZ\s+(.+?)\s*$/.exec(line);
    if (match !== null) return match[1]!;
  }
  return null;
}

async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

/** Detection dependencies backed by the real machine. */
export function nodeDetectDeps(platform: NodeJS.Platform = process.platform, env: NodeJS.ProcessEnv = process.env): DetectDeps {
  return {
    platform,
    env,
    home: homedir(),
    exists: isFile,
    async which(name) {
      for (const dir of (env.PATH ?? '').split(delimiter)) {
        if (dir === '') continue;
        const candidate = join(dir, name);
        try {
          await access(candidate, constants.X_OK);
          if (await isFile(candidate)) return candidate;
        } catch {
          // not here
        }
      }
      return null;
    },
    async appPath(exe) {
      if (platform !== 'win32') return null;
      for (const hive of ['HKLM', 'HKCU']) {
        const key = `${hive}\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\${exe}`;
        try {
          const { stdout } = await execFileAsync('reg', ['query', key, '/ve'], { windowsHide: true, encoding: 'utf8' });
          const value = parseRegQuery(stdout);
          if (value !== null) return value;
        } catch {
          // key not in this hive
        }
      }
      return null;
    },
  };
}
