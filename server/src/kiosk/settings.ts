// SPDX-License-Identifier: GPL-2.0-or-later
import { z } from 'zod';

/** Which monitor the presenter window goes to. `primary` is the default; `name` needs the plugin's screen list. */
export const KioskScreen = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('primary') }),
  z.object({ kind: z.literal('name'), name: z.string().min(1).max(200) }),
  z.object({ kind: z.literal('position'), x: z.number().int(), y: z.number().int() }),
]);
export type KioskScreen = z.infer<typeof KioskScreen>;

/** settings.json "kiosk" block (TECH-DESIGN §9). Off by default: opening a window must be the operator's choice. */
export const KioskSettings = z.object({
  enabled: z.boolean().default(false),
  /** Overrides browser detection. A path that does not exist is an error, never silently replaced. */
  browserPath: z.string().min(1).max(500).optional(),
  screen: KioskScreen.default({ kind: 'primary' }),
  /** Reopen the window when it closes or crashes (with limits: see RestartPolicy). */
  restart: z.boolean().default(true),
});
export type KioskSettings = z.infer<typeof KioskSettings>;
