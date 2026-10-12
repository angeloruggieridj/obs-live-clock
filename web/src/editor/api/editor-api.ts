// SPDX-License-Identifier: GPL-2.0-or-later
import { Episode, Format } from '@olc/shared';
import { z } from 'zod';
import { ApiError } from '../../core/http';

export type DocKind = 'format' | 'episode';
export type EditorDoc = Format | Episode;
export interface DocRef {
  kind: DocKind;
  id: string;
}

export interface NewEpisodeBody {
  id: string;
  date: string; // YYYY-MM-DD
  plannedStart: string | null; // ISO 8601 with offset
  playlistName: string | null;
}

export interface LiveStatus {
  episodeId: string | null;
  phase: 'preshow' | 'live' | 'ended' | null;
}

export interface DeckItemDto {
  index: number;
  path: string;
  title: string;
  durationMs: number; // -1 = unknown
  occurrence: number;
}

export type DeckResult =
  | { state: 'ok'; items: DeckItemDto[] }
  | { state: 'unavailable'; reason: 'obs_not_connected' | 'deck_absent' | 'deck_not_ready' };

export interface CheckIssue {
  severity: 'error' | 'warning';
  code: string;
  blockId: string | null;
  message: string;
}

export interface ObsCheckResult {
  connected: boolean;
  obsWebSocketVersion: string | null;
  deck: { capability: 'absent' | 'legacy' | 'events' } | null;
  issues: CheckIssue[];
}

/** 409 `rundown_invalid` from `POST /api/live/load`: the server refuses a rundown with errors. */
export class RundownInvalidError extends ApiError {
  constructor(readonly issues: CheckIssue[]) {
    super(409, 'rundown_invalid');
  }
}

export interface EditorApi {
  listFormats(): Promise<Format[]>;
  listEpisodes(): Promise<Episode[]>;
  getDoc(ref: DocRef): Promise<EditorDoc>;
  /** POST. Throws `ApiError(409, 'exists')` when the id is taken. */
  createFormat(format: Format): Promise<Format>;
  /** PUT = upsert (the autosave). Throws `ApiError(409, 'episode_live')` for a live episode. */
  putDoc(doc: EditorDoc, kind: DocKind): Promise<EditorDoc>;
  /** Throws `ApiError(409, 'episode_loaded')` for the loaded episode. */
  deleteDoc(ref: DocRef): Promise<void>;
  createEpisode(formatId: string, body: NewEpisodeBody): Promise<Episode>;
  liveStatus(): Promise<LiveStatus>;
  /** Throws `RundownInvalidError` (409), `ApiError(409, 'live_running')`, `ApiError(404, 'not_found')`. */
  loadLive(episodeId: string): Promise<void>;
  /** `null` when OBS is not connected. */
  obsScenes(): Promise<string[] | null>;
  deckItems(): Promise<DeckResult>;
  checkObs(episodeId: string): Promise<ObsCheckResult>;
}

const LiveStatusSchema = z.object({
  episodeId: z.string().nullable(),
  phase: z.enum(['preshow', 'live', 'ended']).nullable(),
});
const DeckSchema = z.object({
  items: z.array(z.object({ index: z.number(), path: z.string(), title: z.string(), durationMs: z.number(), occurrence: z.number() })),
});
const CheckSchema = z.object({
  connected: z.boolean(),
  obsWebSocketVersion: z.string().nullable(),
  deck: z.object({ capability: z.enum(['absent', 'legacy', 'events']) }).nullable(),
  issues: z.array(z.object({ severity: z.enum(['error', 'warning']), code: z.string(), blockId: z.string().nullable(), message: z.string() })),
});

async function failure(res: Response): Promise<ApiError> {
  let code = `http_${res.status}`;
  let body: { error?: unknown; issues?: unknown } = {};
  try {
    body = (await res.json()) as typeof body;
    if (typeof body.error === 'string') code = body.error;
  } catch {
    // not JSON: keep the status code
  }
  if (res.status === 409 && code === 'rundown_invalid') {
    const parsed = CheckSchema.shape.issues.safeParse(body.issues);
    return new RundownInvalidError(parsed.success ? parsed.data : []);
  }
  return new ApiError(res.status, code);
}

const JSON_HEADERS = { 'content-type': 'application/json' };
const base = (kind: DocKind) => (kind === 'format' ? '/api/formats' : '/api/episodes');

export function httpEditorApi(fetchFn: typeof fetch = (input, init) => fetch(input, init)): EditorApi {
  async function json<T>(res: Response, parse: (v: unknown) => T): Promise<T> {
    if (!res.ok) throw await failure(res);
    return parse(await res.json());
  }
  return {
    async listFormats() {
      return json(await fetchFn('/api/formats'), (v) => z.array(Format).parse(v));
    },
    async listEpisodes() {
      return json(await fetchFn('/api/episodes'), (v) => z.array(Episode).parse(v));
    },
    async getDoc(ref) {
      const schema = ref.kind === 'format' ? Format : Episode;
      return json(await fetchFn(`${base(ref.kind)}/${encodeURIComponent(ref.id)}`), (v) => schema.parse(v));
    },
    async createFormat(format) {
      return json(await fetchFn('/api/formats', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(format) }), (v) => Format.parse(v));
    },
    async putDoc(doc, kind) {
      const schema = kind === 'format' ? Format : Episode;
      const res = await fetchFn(`${base(kind)}/${encodeURIComponent(doc.id)}`, { method: 'PUT', headers: JSON_HEADERS, body: JSON.stringify(doc) });
      return json(res, (v) => schema.parse(v));
    },
    async deleteDoc(ref) {
      const res = await fetchFn(`${base(ref.kind)}/${encodeURIComponent(ref.id)}`, { method: 'DELETE' });
      if (!res.ok) throw await failure(res);
    },
    async createEpisode(formatId, body) {
      const res = await fetchFn(`/api/formats/${encodeURIComponent(formatId)}/episodes`, { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(body) });
      return json(res, (v) => Episode.parse(v));
    },
    async liveStatus() {
      return json(await fetchFn('/api/live/status'), (v) => LiveStatusSchema.parse(v));
    },
    async loadLive(episodeId) {
      const res = await fetchFn('/api/live/load', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ episodeId }) });
      if (!res.ok) throw await failure(res);
    },
    async obsScenes() {
      const res = await fetchFn('/api/obs/scenes');
      if (res.status === 409) return null;
      return json(res, (v) => z.object({ scenes: z.array(z.string()) }).parse(v).scenes);
    },
    async deckItems(): Promise<DeckResult> {
      const res = await fetchFn('/api/deck/items');
      if (res.ok) return { state: 'ok', items: DeckSchema.parse(await res.json()).items };
      const err = await failure(res);
      if (err.code === 'obs_not_connected' || err.code === 'deck_absent' || err.code === 'deck_not_ready') {
        return { state: 'unavailable', reason: err.code };
      }
      throw err;
    },
    async checkObs(episodeId) {
      const res = await fetchFn('/api/obs/check', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ episodeId }) });
      return json(res, (v) => CheckSchema.parse(v));
    },
  };
}
