// SPDX-License-Identifier: GPL-2.0-or-later
import { join } from 'node:path';
import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import { Episode, Format, PROTOCOL_VERSION } from '@olc/shared';
import { soloFutsalFormat } from '@olc/shared/testing';
import { registerHttp } from '../../src/api/http';
import { DocumentRepository } from '../../src/persistence/repository';
import { makeHttp } from '../support/http';
import { makeRuntime } from '../support/runtime';
import { tempDir } from '../support/tmp';

const EPISODE_BODY = { id: 'ep-1', date: '2026-10-12', plannedStart: '2026-10-12T19:00:00+02:00', playlistName: 'Puntata' };

async function withEpisode() {
  const h = await makeHttp();
  await h.app.inject({ method: 'POST', url: '/api/formats', payload: soloFutsalFormat() });
  await h.app.inject({ method: 'POST', url: '/api/formats/solo-futsal/episodes', payload: EPISODE_BODY });
  return h;
}

/** Holds the next `put` until released, so a test can race it against another request. */
class GatedEpisodes extends DocumentRepository<Episode> {
  private gate: Promise<void> | null = null;
  private entered: (() => void) | null = null;
  private release: () => void = () => {};

  constructor(dir: string) {
    super(dir, Episode);
  }

  /** Blocks the next `put`; `entered` resolves once it is blocked and `release` lets it finish. */
  arm(): { entered: Promise<void>; release: () => void } {
    const entered = new Promise<void>((resolve) => (this.entered = resolve));
    this.gate = new Promise<void>((resolve) => (this.release = resolve));
    return { entered, release: () => this.release() };
  }

  override async put(doc: Episode): Promise<Episode> {
    const gate = this.gate;
    if (gate !== null) {
      this.gate = null;
      this.entered?.();
      this.entered = null;
      await gate;
    }
    return super.put(doc);
  }
}

/** An app like `makeHttp`, but with an injectable episodes repository. */
async function makeGatedHttp(episodes: GatedEpisodes) {
  const dir = await tempDir();
  const h = makeRuntime(dir);
  const app = Fastify();
  registerHttp(app, {
    formats: new DocumentRepository(join(dir, 'formats'), Format),
    episodes,
    runtime: h.runtime,
    version: '0.1.0-test',
    instanceId: 'instance-test',
  });
  await app.ready();
  return { ...h, app };
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

  it('refuses a PUT that races a go-live with 409 episode_live', async () => {
    const episodes = new GatedEpisodes(join(await tempDir(), 'episodes'));
    const h = await makeGatedHttp(episodes);
    await h.app.inject({ method: 'POST', url: '/api/formats', payload: soloFutsalFormat() });
    await h.app.inject({ method: 'POST', url: '/api/formats/solo-futsal/episodes', payload: EPISODE_BODY });
    await h.app.inject({ method: 'POST', url: '/api/live/load', payload: { episodeId: 'ep-1' } });
    const ep = (await h.app.inject({ method: 'GET', url: '/api/episodes/ep-1' })).json();
    const { entered, release } = episodes.arm();
    const putPromise = h.app.inject({ method: 'PUT', url: '/api/episodes/ep-1', payload: ep });
    await entered;
    const start = await h.app.inject({ method: 'POST', url: '/api/live/command', payload: { name: 'start_program' } });
    expect(start.json()).toEqual({ changed: true });
    release();
    const put = await putPromise;
    expect(put.statusCode).toBe(409);
    expect(put.json()).toEqual({ error: 'episode_live' });
  });
});

describe('live control', () => {
  it('reloads the loaded, not-yet-live episode when it is edited', async () => {
    const h = await withEpisode();
    await h.app.inject({ method: 'POST', url: '/api/live/load', payload: { episodeId: 'ep-1' } });
    const ep = (await h.app.inject({ method: 'GET', url: '/api/episodes/ep-1' })).json();
    ep.blocks[0].name = 'Primo blocco rinominato';
    const put = await h.app.inject({ method: 'PUT', url: '/api/episodes/ep-1', payload: ep });
    expect(put.statusCode).toBe(200);
    const view = (await h.app.inject({ method: 'GET', url: '/api/live/view?role=control' })).json();
    expect(view.rows[0].blockName).toBe('Primo blocco rinominato');
  });

  it('keeps the live runtime state when the loaded preshow episode is edited', async () => {
    const h = await withEpisode();
    await h.app.inject({ method: 'POST', url: '/api/live/load', payload: { episodeId: 'ep-1' } });
    await h.app.inject({ method: 'POST', url: '/api/messages/send', payload: { text: 'CIAO', dismiss: { kind: 'manual' } } });
    h.runtime.dispatch({ type: 'SourceRestored' });
    const ep = (await h.app.inject({ method: 'GET', url: '/api/episodes/ep-1' })).json();
    ep.blocks[0].name = 'Primo blocco rinominato';
    const put = await h.app.inject({ method: 'PUT', url: '/api/episodes/ep-1', payload: ep });
    expect(put.statusCode).toBe(200);
    const control = (await h.app.inject({ method: 'GET', url: '/api/live/view?role=control' })).json();
    expect(control.rows[0].blockName).toBe('Primo blocco rinominato');
    const presenter = (await h.app.inject({ method: 'GET', url: '/api/live/view?role=presenter' })).json();
    expect(presenter.message).toEqual({ text: 'CIAO' });
    expect(presenter.status.obs).toBe('ok');
  });

  it('keeps the as-run state when an ended episode is edited', async () => {
    const h = await withEpisode();
    await h.app.inject({ method: 'POST', url: '/api/live/load', payload: { episodeId: 'ep-1' } });
    await h.app.inject({ method: 'POST', url: '/api/live/command', payload: { name: 'start_program' } });
    await h.app.inject({ method: 'POST', url: '/api/live/command', payload: { name: 'end_program' } });
    expect(h.runtime.phase).toBe('ended');
    const ep = (await h.app.inject({ method: 'GET', url: '/api/episodes/ep-1' })).json();
    ep.blocks[0].name = 'Primo blocco rinominato';
    const put = await h.app.inject({ method: 'PUT', url: '/api/episodes/ep-1', payload: ep });
    expect(put.statusCode).toBe(200);
    expect(h.runtime.phase).toBe('ended');
    const control = (await h.app.inject({ method: 'GET', url: '/api/live/view?role=control' })).json();
    expect(control.rows[0].blockName).toBe('Primo blocco');
  });

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

  it('ends the program and then allows unload and reload', async () => {
    const h = await withEpisode();
    await h.app.inject({ method: 'POST', url: '/api/live/load', payload: { episodeId: 'ep-1' } });
    const start = await h.app.inject({ method: 'POST', url: '/api/live/command', payload: { name: 'start_program' } });
    expect(start.json()).toEqual({ changed: true });
    const end = await h.app.inject({ method: 'POST', url: '/api/live/command', payload: { name: 'end_program' } });
    expect(end.json()).toEqual({ changed: true });
    expect(h.runtime.phase).toBe('ended');
    expect((await h.app.inject({ method: 'POST', url: '/api/live/unload' })).statusCode).toBe(204);
    const reload = await h.app.inject({ method: 'POST', url: '/api/live/load', payload: { episodeId: 'ep-1' } });
    expect(reload.statusCode).toBe(200);
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
