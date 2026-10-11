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

/** The HTTP calls the dock and the control view make (same origin; Vite proxies /api in dev). */
export interface ApiClient {
  listEpisodes(): Promise<EpisodeSummary[]>;
  loadEpisode(id: string): Promise<void>;
  obsStatus(): Promise<ObsStatusLite>;
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
  };
}
