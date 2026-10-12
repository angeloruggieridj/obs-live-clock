// SPDX-License-Identifier: GPL-2.0-or-later
import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import { KioskSettings } from '../kiosk/settings';
import { isNotFound, readJson, writeJsonAtomic } from '../persistence/json-file';

/** DT-5 remote mode: credentials used when no plugin hands them over at runtime. */
export const ObsSettings = z.object({
  host: z.string().min(1).default('127.0.0.1'),
  port: z.number().int().min(1).max(65_535).default(4455),
  password: z.string().optional(),
});

export const Settings = z.object({
  port: z.number().int().min(1).max(65_535).default(4460),
  lanAccess: z.boolean().default(false),
  obs: ObsSettings.optional(),
  kiosk: KioskSettings.default(() => KioskSettings.parse({})),
});
export type Settings = z.infer<typeof Settings>;

/** What GET /api/settings returns. The OBS password is never part of it: only whether one is set. */
export interface PublicSettings {
  port: number;
  lanAccess: boolean;
  obs: { host: string; port: number; hasPassword: boolean } | null;
  kiosk: KioskSettings;
}

export function publicSettings(settings: Settings): PublicSettings {
  return {
    port: settings.port,
    lanAccess: settings.lanAccess,
    obs: settings.obs === undefined ? null : { host: settings.obs.host, port: settings.obs.port, hasPassword: settings.obs.password !== undefined },
    kiosk: settings.kiosk,
  };
}

export class SettingsFileInvalidError extends Error {
  constructor() {
    super('settings.json is not a valid JSON object; fix or delete it before changing settings from the app');
    this.name = 'SettingsFileInvalidError';
  }
}

/**
 * The settings the running app uses, and the one write path (kiosk only: port and LAN access need a restart and are
 * edited in the file). The write keeps every other key of settings.json exactly as it is, the OBS password included,
 * and refuses to overwrite a file it cannot parse.
 */
export class SettingsHolder {
  constructor(
    private readonly path: string,
    private current: Settings,
  ) {}

  get(): Settings {
    return this.current;
  }

  async setKiosk(kiosk: KioskSettings): Promise<Settings> {
    let raw: Record<string, unknown> = {};
    try {
      const parsed: unknown = JSON.parse(await readFile(this.path, 'utf8'));
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new SettingsFileInvalidError();
      raw = parsed as Record<string, unknown>;
    } catch (err) {
      if (err instanceof SettingsFileInvalidError) throw err;
      if (!isNotFound(err)) throw new SettingsFileInvalidError();
    }
    raw.kiosk = kiosk;
    await writeJsonAtomic(this.path, raw);
    this.current = { ...this.current, kiosk };
    return this.current;
  }
}

export async function loadSettings(path: string, onInvalid?: (err: unknown) => void): Promise<Settings> {
  try {
    return (await readJson(path, Settings)) ?? Settings.parse({});
  } catch (err) {
    // A corrupt or schema-invalid settings file must not stop the app: fall back to the defaults and report.
    onInvalid?.(sanitizeSettingsError(err));
    return Settings.parse({});
  }
}

/**
 * A `JSON.parse` SyntaxError quotes the surrounding text, which can include `settings.obs.password`; replace it
 * with a fixed message so the raw text never reaches a log. Other errors are returned unchanged.
 */
function sanitizeSettingsError(err: unknown): unknown {
  if (err instanceof SyntaxError) return new Error('settings.json is not valid JSON');
  return err;
}

/** NF3: localhost only unless LAN access is explicitly enabled. */
export function listenHost(settings: Settings): string {
  return settings.lanAccess ? '0.0.0.0' : '127.0.0.1';
}
