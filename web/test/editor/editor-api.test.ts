// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import { soloFutsalFormat } from '@olc/shared/testing';
import { ApiError } from '../../src/core/http';
import { RundownInvalidError, httpEditorApi } from '../../src/editor/api/editor-api';

function fakeFetch(handler: (url: string, init?: RequestInit) => { status: number; body?: unknown }) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    const { status, body } = handler(url, init);
    return new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  return { fn, calls };
}

describe('httpEditorApi', () => {
  it('lists, gets and puts documents with the right verbs and urls', async () => {
    const f = soloFutsalFormat();
    const { fn, calls } = fakeFetch((url, init) => ({ status: 200, body: url.endsWith('/api/formats') && init?.method === undefined ? [f] : f }));
    const api = httpEditorApi(fn);
    expect(await api.listFormats()).toEqual([f]);
    expect((await api.getDoc({ kind: 'format', id: 'solo-futsal' })).id).toBe('solo-futsal');
    await api.putDoc(f, 'format');
    expect(calls.map((c) => `${c.init?.method ?? 'GET'} ${c.url}`)).toEqual([
      'GET /api/formats',
      'GET /api/formats/solo-futsal',
      'PUT /api/formats/solo-futsal',
    ]);
    expect(JSON.parse(String(calls[2]!.init!.body)).id).toBe('solo-futsal');
  });

  it('url-encodes ids and rejects a response that is not a valid document', async () => {
    const { fn, calls } = fakeFetch(() => ({ status: 200, body: { nope: true } }));
    const api = httpEditorApi(fn);
    await expect(api.getDoc({ kind: 'episode', id: 'a b' })).rejects.toThrow();
    expect(calls[0]!.url).toBe('/api/episodes/a%20b');
  });

  it('turns an error body into ApiError(status, code)', async () => {
    const { fn } = fakeFetch(() => ({ status: 409, body: { error: 'episode_live' } }));
    const err = await httpEditorApi(fn).putDoc(soloFutsalFormat(), 'format').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 409, code: 'episode_live' });
  });

  it('turns rundown_invalid into RundownInvalidError with the issues', async () => {
    const issues = [{ severity: 'error', code: 'media_exceeds_block', blockId: 'b1', message: 'x' }];
    const { fn } = fakeFetch(() => ({ status: 409, body: { error: 'rundown_invalid', issues } }));
    const err = await httpEditorApi(fn).loadLive('ep-1').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RundownInvalidError);
    expect((err as RundownInvalidError).issues).toEqual(issues);
  });

  it('maps obs scenes (null when not connected) and deck availability', async () => {
    let mode = 'ok';
    const { fn } = fakeFetch((url) => {
      if (url === '/api/obs/scenes') return mode === 'ok' ? { status: 200, body: { scenes: ['A'] } } : { status: 409, body: { error: 'obs_not_connected' } };
      if (mode === 'ok') return { status: 200, body: { items: [{ index: 0, path: 'a', title: 'A', durationMs: -1, occurrence: 0 }] } };
      if (mode === 'absent') return { status: 404, body: { error: 'deck_absent' } };
      return { status: 409, body: { error: 'deck_not_ready' } };
    });
    const api = httpEditorApi(fn);
    expect(await api.obsScenes()).toEqual(['A']);
    expect(await api.deckItems()).toMatchObject({ state: 'ok', items: [{ durationMs: -1 }] });
    mode = 'absent';
    expect(await api.deckItems()).toEqual({ state: 'unavailable', reason: 'deck_absent' });
    mode = 'notready';
    expect(await api.deckItems()).toEqual({ state: 'unavailable', reason: 'deck_not_ready' });
    mode = 'down';
    expect(await api.obsScenes()).toBeNull();
  });

  it('posts the episode creation body and the live load', async () => {
    const { fn, calls } = fakeFetch((url) => ({ status: url.includes('/episodes') ? 201 : 200, body: url.includes('/episodes') ? undefined : {} }));
    const api = httpEditorApi(fn);
    await api.loadLive('ep-1');
    expect(JSON.parse(String(calls[0]!.init!.body))).toEqual({ episodeId: 'ep-1' });
    await expect(api.createEpisode('solo-futsal', { id: 'e', date: '2026-10-12', plannedStart: null, playlistName: null })).rejects.toThrow();
    expect(calls[1]!.url).toBe('/api/formats/solo-futsal/episodes');
  });
});
