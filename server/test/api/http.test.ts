// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import { PROTOCOL_VERSION } from '@olc/shared';
import { soloFutsalFormat } from '@olc/shared/testing';
import { makeHttp } from '../support/http';

const EPISODE_BODY = { id: 'ep-1', date: '2026-10-12', plannedStart: '2026-10-12T19:00:00+02:00', playlistName: 'Puntata' };

async function withEpisode() {
  const h = await makeHttp();
  await h.app.inject({ method: 'POST', url: '/api/formats', payload: soloFutsalFormat() });
  await h.app.inject({ method: 'POST', url: '/api/formats/solo-futsal/episodes', payload: EPISODE_BODY });
  return h;
}

describe('health', () => {
  it('reports version, protocol and instance', async () => {
    const h = await makeHttp();
    const res = await h.app.inject({ method: 'GET', url: '/api/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ version: '0.1.0-test', protocol: PROTOCOL_VERSION, instanceId: 'instance-test' });
  });
});

describe('formats', () => {
  it('creates, reads, updates, lists and deletes', async () => {
    const h = await makeHttp();
    const f = soloFutsalFormat();
    expect((await h.app.inject({ method: 'POST', url: '/api/formats', payload: f })).statusCode).toBe(201);
    expect((await h.app.inject({ method: 'POST', url: '/api/formats', payload: f })).json()).toEqual({ error: 'exists' });
    const updated = { ...f, name: 'Solo Futsal Plus' };
    expect((await h.app.inject({ method: 'PUT', url: '/api/formats/solo-futsal', payload: updated })).json().name).toBe('Solo Futsal Plus');
    expect((await h.app.inject({ method: 'GET', url: '/api/formats' })).json()).toHaveLength(1);
    expect((await h.app.inject({ method: 'DELETE', url: '/api/formats/solo-futsal' })).statusCode).toBe(204);
    expect((await h.app.inject({ method: 'GET', url: '/api/formats/solo-futsal' })).statusCode).toBe(404);
  });

  it('rejects bad bodies, id mismatches and invalid ids', async () => {
    const h = await makeHttp();
    const bad = await h.app.inject({ method: 'POST', url: '/api/formats', payload: { id: 'x' } });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error).toBe('invalid_body');
    const mismatch = await h.app.inject({ method: 'PUT', url: '/api/formats/other', payload: soloFutsalFormat() });
    expect(mismatch.json()).toEqual({ error: 'id_mismatch' });
    const invalid = await h.app.inject({ method: 'GET', url: '/api/formats/..%2F..%2Fsecret' });
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json()).toEqual({ error: 'invalid_id' });
    const malformed = await h.app.inject({
      method: 'POST',
      url: '/api/formats',
      headers: { 'content-type': 'application/json' },
      payload: '{ not json',
    });
    expect(malformed.statusCode).toBe(400);
    expect(malformed.json()).toEqual({ error: 'bad_request' });
  });
});

describe('episodes', () => {
  it('creates an episode from a format and validates it', async () => {
    const h = await withEpisode();
    const ep = (await h.app.inject({ method: 'GET', url: '/api/episodes/ep-1' })).json();
    expect(ep).toMatchObject({ id: 'ep-1', formatId: 'solo-futsal', name: 'Solo Futsal · 12/10/2026' });
    const again = await h.app.inject({ method: 'POST', url: '/api/formats/solo-futsal/episodes', payload: EPISODE_BODY });
    expect(again.json()).toEqual({ error: 'exists' });
    const missing = await h.app.inject({ method: 'POST', url: '/api/formats/nope/episodes', payload: EPISODE_BODY });
    expect(missing.statusCode).toBe(404);
    const issues = (await h.app.inject({ method: 'POST', url: '/api/episodes/ep-1/validate' })).json().issues;
    expect(issues.map((i: { code: string }) => i.code)).toEqual(['scene_group_shared']);
  });

  it('locks the episode structure while it is live', async () => {
    const h = await withEpisode();
    await h.app.inject({ method: 'POST', url: '/api/live/load', payload: { episodeId: 'ep-1' } });
    const ep = (await h.app.inject({ method: 'GET', url: '/api/episodes/ep-1' })).json();
    expect((await h.app.inject({ method: 'DELETE', url: '/api/episodes/ep-1' })).json()).toEqual({ error: 'episode_loaded' });
    h.runtime.dispatch({ type: 'OutputChanged', output: 'rec', state: 'started' });
    const put = await h.app.inject({ method: 'PUT', url: '/api/episodes/ep-1', payload: ep });
    expect(put.statusCode).toBe(409);
    expect(put.json()).toEqual({ error: 'episode_live' });
  });
});

describe('live control', () => {
  it('loads an episode and serves both views', async () => {
    const h = await withEpisode();
    expect((await h.app.inject({ method: 'GET', url: '/api/live/view?role=presenter' })).json()).toEqual({ error: 'no_episode' });
    const load = await h.app.inject({ method: 'POST', url: '/api/live/load', payload: { episodeId: 'ep-1' } });
    expect(load.json()).toEqual({ episodeId: 'ep-1' });
    expect((await h.app.inject({ method: 'GET', url: '/api/live/view?role=presenter' })).json().phase).toBe('preshow');
    expect((await h.app.inject({ method: 'GET', url: '/api/live/view?role=control' })).json().rows).toHaveLength(8);
    expect((await h.app.inject({ method: 'GET', url: '/api/live/view?role=boss' })).json()).toEqual({ error: 'invalid_role' });
  });

  it('runs commands and refuses them with no episode', async () => {
    const h = await withEpisode();
    const none = await h.app.inject({ method: 'POST', url: '/api/live/command', payload: { name: 'start_program' } });
    expect(none.statusCode).toBe(409);
    expect(none.json()).toEqual({ error: 'no_episode' });
    await h.app.inject({ method: 'POST', url: '/api/live/load', payload: { episodeId: 'ep-1' } });
    const start = await h.app.inject({ method: 'POST', url: '/api/live/command', payload: { name: 'start_program' } });
    expect(start.json()).toEqual({ changed: true });
    expect(h.runtime.phase).toBe('live');
    const busy = await h.app.inject({ method: 'POST', url: '/api/live/load', payload: { episodeId: 'ep-1' } });
    expect(busy.json()).toEqual({ error: 'live_running' });
    expect((await h.app.inject({ method: 'POST', url: '/api/live/unload' })).statusCode).toBe(409);
  });

  it('public message endpoints send presets or free text and clear', async () => {
    const h = await withEpisode();
    await h.app.inject({ method: 'POST', url: '/api/live/load', payload: { episodeId: 'ep-1' } });
    const preset = await h.app.inject({ method: 'POST', url: '/api/messages/send', payload: { presetId: 'stringi' } });
    expect(preset.json()).toEqual({ changed: true });
    expect(h.runtime.presenterView()?.message).toEqual({ text: 'STRINGI' });
    const unknown = await h.app.inject({ method: 'POST', url: '/api/messages/send', payload: { presetId: 'nope' } });
    expect(unknown.json()).toEqual({ error: 'unknown_preset' });
    await h.app.inject({ method: 'POST', url: '/api/messages/send', payload: { text: 'CHIUDI', dismiss: { kind: 'manual' } } });
    expect(h.runtime.presenterView()?.message).toEqual({ text: 'CHIUDI' });
    expect((await h.app.inject({ method: 'POST', url: '/api/messages/clear' })).json()).toEqual({ changed: true });
    expect(h.runtime.presenterView()?.message).toBeNull();
  });
});
