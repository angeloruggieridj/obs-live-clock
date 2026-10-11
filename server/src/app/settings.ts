// SPDX-License-Identifier: GPL-2.0-or-later
import { z } from 'zod';
import { readJson } from '../persistence/json-file';

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
});
export type Settings = z.infer<typeof Settings>;

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
