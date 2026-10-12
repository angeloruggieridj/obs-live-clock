// SPDX-License-Identifier: GPL-2.0-or-later
import { z } from 'zod';

export interface EpisodeSummary {
  id: string;
  name: string;
  date: string;
}

export interface ObsStatusLite {
  connection: 'idle' | 'connecting' | 'connected' | 'auth_failed' | 'disconnected';
  deck: { capability: 'absent' | 'legacy' | 'events' } | null;
}

/** A first press of an emergency hotkey that still waits for its second press (DT-9). */
export interface HotkeyPending {
  slot: string;
  remainingMs: number;
}

export type KioskScreenChoice = { kind: 'primary' } | { kind: 'name'; name: string } | { kind: 'position'; x: number; y: number };
export interface KioskConfig {
  enabled: boolean;
  screen: KioskScreenChoice;
  restart: boolean;
  browserPath?: string;
}
export interface KioskStatusLite {
  state: string;
  enabled: boolean;
  pid: number | null;
  restarts: number;
  browser: string | null;
  screen: string | null;
}
export interface ScreenLite {
  name: string;
  width: number;
  height: number;
  primary: boolean;
}

/** The HTTP calls the dock and the control view make (same origin; Vite proxies /api in dev). */
export interface ApiClient {
  listEpisodes(): Promise<EpisodeSummary[]>;
  loadEpisode(id: string): Promise<void>;
  obsStatus(): Promise<ObsStatusLite>;
  hotkeyPending(): Promise<HotkeyPending | null>;
  kioskStatus(): Promise<KioskStatusLite>;
  kioskAction(action: 'start' | 'stop' | 'restart'): Promise<KioskStatusLite>;
  screens(): Promise<{ screens: ScreenLite[]; live: boolean }>;
  kioskConfig(): Promise<KioskConfig>;
  saveKioskConfig(kiosk: KioskConfig): Promise<KioskConfig>;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(`HTTP ${status}: ${code}`);
    this.name = 'ApiError';
  }
}

const EpisodeList = z.array(z.object({ id: z.string(), name: z.string(), date: z.string() }));
const ObsStatusSchema = z.object({
  connection: z.enum(['idle', 'connecting', 'connected', 'auth_failed', 'disconnected']),
  deck: z.object({ capability: z.enum(['absent', 'legacy', 'events']) }).nullable(),
});

const HotkeyPendingSchema = z.object({ pending: z.object({ slot: z.string(), remainingMs: z.number() }).nullable() });
const KioskScreenSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('primary') }),
  z.object({ kind: z.literal('name'), name: z.string() }),
  z.object({ kind: z.literal('position'), x: z.number(), y: z.number() }),
]);
const KioskConfigSchema = z.object({
  enabled: z.boolean(),
  screen: KioskScreenSchema,
  restart: z.boolean(),
  browserPath: z.string().optional(),
});
const KioskStatusSchema = z.object({
  state: z.string(),
  enabled: z.boolean(),
  pid: z.number().nullable(),
  restarts: z.number(),
  browser: z.string().nullable(),
  screen: z.string().nullable(),
});
const ScreensSchema = z.object({
  screens: z.array(z.object({ name: z.string(), width: z.number(), height: z.number(), primary: z.boolean() })),
  live: z.boolean(),
});
const SettingsSchema = z.object({ kiosk: KioskConfigSchema });

async function failure(res: Response): Promise<ApiError> {
  let code = `http_${res.status}`;
  try {
    const body = (await res.json()) as { error?: unknown };
    if (typeof body.error === 'string') code = body.error;
  } catch {
    // not JSON: keep the status code
  }
  return new ApiError(res.status, code);
}

export function httpApi(fetchFn: typeof fetch = (input, init) => fetch(input, init)): ApiClient {
  return {
    async listEpisodes() {
      const res = await fetchFn('/api/episodes');
      if (!res.ok) throw await failure(res);
      return EpisodeList.parse(await res.json())
        .map(({ id, name, date }) => ({ id, name, date }))
        .sort((a, b) => b.date.localeCompare(a.date) || a.name.localeCompare(b.name));
    },
    async loadEpisode(id) {
      const res = await fetchFn('/api/live/load', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ episodeId: id }),
      });
      if (!res.ok) throw await failure(res);
    },
    async obsStatus() {
      const res = await fetchFn('/api/obs/status');
      if (!res.ok) throw await failure(res);
      return ObsStatusSchema.parse(await res.json());
    },
    async hotkeyPending() {
      const res = await fetchFn('/api/hotkeys/pending');
      if (!res.ok) throw await failure(res);
      return HotkeyPendingSchema.parse(await res.json()).pending;
    },
    async kioskStatus() {
      const res = await fetchFn('/api/kiosk');
      if (!res.ok) throw await failure(res);
      return KioskStatusSchema.parse(await res.json());
    },
    async kioskAction(action) {
      const res = await fetchFn(`/api/kiosk/${action}`, { method: 'POST' });
      if (!res.ok) throw await failure(res);
      return KioskStatusSchema.parse(await res.json());
    },
    async screens() {
      const res = await fetchFn('/api/screens');
      if (!res.ok) throw await failure(res);
      return ScreensSchema.parse(await res.json());
    },
    async kioskConfig() {
      const res = await fetchFn('/api/settings');
      if (!res.ok) throw await failure(res);
      return SettingsSchema.parse(await res.json()).kiosk;
    },
    async saveKioskConfig(kiosk) {
      const res = await fetchFn('/api/settings', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ kiosk }),
      });
      if (!res.ok) throw await failure(res);
      return SettingsSchema.parse(await res.json()).kiosk;
    },
  };
}
