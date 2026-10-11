// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import { ApiError, httpApi } from '../../src/core/http';

function fakeFetch(status: number, body: unknown, seen: Array<{ url: string; init?: RequestInit }> = []): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    seen.push({ url: String(input), init });
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
}

describe('httpApi', () => {
  it('lists episodes newest first, keeping only id, name and date', async () => {
    const api = httpApi(
      fakeFetch(200, [
        { id: 'a', name: 'Prova', date: '2026-10-11', blocks: [] },
        { id: 'b', name: 'Diretta', date: '2026-10-12', blocks: [] },
      ]),
    );
    expect(await api.listEpisodes()).toEqual([
      { id: 'b', name: 'Diretta', date: '2026-10-12' },
      { id: 'a', name: 'Prova', date: '2026-10-11' },
    ]);
  });

  it('loads an episode with a JSON POST and surfaces the server error code', async () => {
    const seen: Array<{ url: string; init?: RequestInit }> = [];
    await httpApi(fakeFetch(200, { episodeId: 'b' }, seen)).loadEpisode('b');
    expect(seen[0]!.url).toBe('/api/live/load');
    expect(seen[0]!.init?.method).toBe('POST');
    expect(JSON.parse(String(seen[0]!.init?.body))).toEqual({ episodeId: 'b' });
    const err = await httpApi(fakeFetch(409, { error: 'live_running' })).loadEpisode('b').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 409, code: 'live_running' });
  });

  it('reads the OBS status', async () => {
    const api = httpApi(fakeFetch(200, { connection: 'auth_failed', obsWebSocketVersion: null, programScene: null, deck: null }));
    expect(await api.obsStatus()).toEqual({ connection: 'auth_failed', deck: null });
  });
});
