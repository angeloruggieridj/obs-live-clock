// SPDX-License-Identifier: GPL-2.0-or-later
// @vitest-environment node
import { mkdtemp, rm } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it } from 'vitest';
import type { ClientRole } from '@olc/shared';
import { soloFutsalFormat } from '@olc/shared/testing';
import { startObsSim } from '@olc/obs-sim';
import { buildServer } from '@olc/server/app/server';
import type { FrameLoop } from '../../src/core/frame-loop';
import { LiveClient, type LiveStore, type SocketLike } from '../../src/core/ws-client';
import { DockScreen } from '../../src/dock/DockScreen';
import { PresenterScreen } from '../../src/presenter/PresenterScreen';
import { LiveProvider } from '../../src/ui/live-context';
import { fakeApi } from '../support/api';

const SCENES = {
  'CAM 1': [],
  'CAM 2': [],
  'CAM 3': [],
  PLAYOUT: [{ sourceName: 'Deck Media', kind: 'input' as const }],
  BREAK: [{ sourceName: 'Tappo', kind: 'input' as const }],
};
const DECK = {
  version: '1.4.0',
  sourceName: 'Deck Media',
  items: [
    { title: 'Servizio 1', path: 'D:/media/servizio1.mp4', durationMs: 185_000 },
    { title: 'Servizio 2', path: 'D:/media/servizio2.mp4', durationMs: 120_000 },
  ],
};

const noFrames: FrameLoop = { subscribe: () => () => {} };
const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()!();
});

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Bounded polling (50 ms steps): the first truthy probe result, or a failure naming what was awaited. */
async function waitFor<T>(label: string, probe: () => T | null | undefined | false, timeoutMs = 8_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = probe();
    if (value) return value;
    if (Date.now() >= deadline) throw new Error(`Timed out after ${timeoutMs} ms waiting for ${label}`);
    await delay(50);
  }
}

const decode = (s: string) =>
  s.replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

/** Headless render of a real screen against a real client: the markup a first paint would show. */
function render(store: LiveStore<ClientRole>, ui: ReactElement): { html: string; text: string } {
  const html = renderToStaticMarkup(
    <LiveProvider store={store} frames={noFrames} lang="it">
      {ui}
    </LiveProvider>,
  );
  return { html, text: decode(html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')).trim() };
}

const mainCounter = (html: string) => decode(/class="counter p-main-counter"[^>]*>([^<]*)</.exec(html)?.[1] ?? '');

function client<R extends ClientRole>(port: number, role: R): LiveClient<R> {
  const c = new LiveClient({ url: `ws://127.0.0.1:${port}/ws`, role, createSocket: (url) => new WebSocket(url) as unknown as SocketLike });
  cleanups.push(() => c.stop());
  return c;
}

describe('web clients against the real server and the OBS simulator', () => {
  it('drives the presenter and the dock from PRE-SHOW to OBS loss and server loss', async () => {
    const sim = await startObsSim({ port: 0, scenes: SCENES, inputs: ['Deck Media', 'Tappo'], program: 'CAM 1', deck: DECK });
    cleanups.push(() => sim.close());
    const dir = await mkdtemp(join(tmpdir(), 'olc-web-'));
    cleanups.push(() => rm(dir, { recursive: true, force: true, maxRetries: 5 }));
    const { app } = await buildServer({ dataDir: dir, restrictAcl: async () => {}, obsCredentials: { host: '127.0.0.1', port: sim.port } });
    let appOpen = true;
    cleanups.push(async () => {
      if (appOpen) await app.close();
    });
    await app.listen({ port: 0, host: '127.0.0.1' });
    const port = (app.server.address() as AddressInfo).port;

    const plannedStart = new Date(Date.now() + 3_600_000).toISOString();
    expect((await app.inject({ method: 'POST', url: '/api/formats', payload: soloFutsalFormat() })).statusCode).toBe(201);
    const created = await app.inject({
      method: 'POST',
      url: '/api/formats/solo-futsal/episodes',
      payload: { id: 'ep-1', date: plannedStart.slice(0, 10), plannedStart, playlistName: null },
    });
    expect(created.statusCode).toBe(201);

    const presenter = client(port, 'presenter');
    const control = client(port, 'control');
    const showPresenter = () => render(presenter, <PresenterScreen />);
    const showDock = () => render(control, <DockScreen api={fakeApi()} search="" />);

    // 0. First paint, before anything arrived: no number at all.
    expect(showPresenter().text).toContain('CONNESSIONE…');
    expect(showPresenter().text).not.toMatch(/\d:\d\d/);
    presenter.start();
    control.start();

    // 1. Connected and synced, nothing loaded yet.
    await waitFor('presenter ready without an episode', () => {
      const s = presenter.getSnapshot();
      return s.hasView && s.synced && s.view === null;
    });
    expect(showPresenter().text).toContain('NESSUNA PUNTATA CARICATA');

    // 2. PRE-SHOW once loaded, with OBS connected.
    expect((await app.inject({ method: 'POST', url: '/api/live/load', payload: { episodeId: 'ep-1' } })).statusCode).toBe(200);
    await waitFor('pre-show with OBS connected', () => {
      const v = presenter.getSnapshot().view;
      return v?.phase === 'preshow' && v.status.obs === 'ok';
    });
    let out = showPresenter();
    expect(out.text).toContain('INIZIO PROGRAMMA');
    expect(mainCounter(out.html)).toMatch(/^(59:5\d|1:00:00)$/);
    expect(out.text).toContain('SCALETTA');
    expect(out.text).toContain('Primo blocco');

    // 3. REC starts: live, in studio, on both screens.
    sim.setRecord('started');
    await waitFor('live in studio', () => {
      const p = presenter.getSnapshot().view;
      const c = control.getSnapshot().view;
      return p?.phase === 'live' && p.segment === 'studio' && c?.presenter.phase === 'live';
    });
    out = showPresenter();
    expect(out.text).toContain('BLOCCO 1 · Primo blocco');
    expect(mainCounter(out.html)).toMatch(/^1[12]:\d\d$/);
    expect(out.text).toContain('NEXT');
    expect(out.text).toContain('Servizio 1');
    expect(out.text).toContain('FINE PROGRAMMA');
    expect(out.text).toContain('OBS ✓');
    const dockLive = showDock().text;
    expect(dockLive).toContain('LIVE');
    expect(dockLive).toContain('STUDIO');

    // 4. An unknown scene: the dock says FUORI SCALETTA, the presenter never does.
    sim.setProgram('CAMERA OSPITE');
    const dockOff = await waitFor('off-script in the dock', () =>
      control.getSnapshot().view?.offScript?.scene === 'CAMERA OSPITE' ? showDock() : null,
    );
    expect(dockOff.text).toContain('FUORI SCALETTA: CAMERA OSPITE');
    expect(showPresenter().text).not.toContain('FUORI SCALETTA');
    sim.setProgram('CAM 1');
    await waitFor('back on script', () => control.getSnapshot().view?.offScript === null);

    // 5. A service from Playlist Deck: RIENTRO TRA and what is on air; the block is not shown.
    sim.setProgram('PLAYOUT');
    sim.deckPlay(0);
    await waitFor('media segment', () => presenter.getSnapshot().view?.segment === 'media');
    out = showPresenter();
    expect(out.text).toContain('RIENTRO TRA');
    expect(out.text).toContain('SERVIZIO · Servizio 1');
    expect(out.text).toContain('RIENTRO: Primo blocco');
    expect(out.text).not.toContain('BLOCCO 1 · Primo blocco');
    expect(mainCounter(out.html)).toMatch(/^\d:\d\d$/);

    // 6. The clip ends, back to studio, then the break with its filler playing.
    sim.deckPlayback(185_000, false);
    sim.setProgram('CAM 1');
    await waitFor('studio again', () => presenter.getSnapshot().view?.segment === 'studio');
    sim.setMedia('Tappo', { state: 'OBS_MEDIA_STATE_PLAYING', cursor: 0, duration: 180_000 });
    sim.setProgram('BREAK');
    await waitFor('break segment', () => presenter.getSnapshot().view?.segment === 'break');
    out = showPresenter();
    expect(out.text).toContain('BREAK · Break 1');
    expect(out.text).toContain('RIENTRO: Secondo blocco');

    // 7. OBS goes away: both screens warn, values become estimated (captured before the server reconnects).
    sim.dropConnections();
    const lost = await waitFor('OBS lost on both screens', () =>
      presenter.getSnapshot().view?.status.obs === 'lost' && control.getSnapshot().view?.obs === 'lost'
        ? { presenter: showPresenter().text, dock: showDock().text }
        : null,
    );
    expect(lost.presenter).toContain('⚠ OBS NON CONNESSO');
    expect(lost.presenter).toContain('STIMATO');
    expect(lost.dock).toContain('⚠ OBS NON CONNESSO');

    // 8. The server goes away: ~2 s later RICONNESSIONE…, and the counters freeze instead of counting on.
    appOpen = false;
    await app.close();
    await waitFor('stale presenter', () => presenter.getSnapshot().stale, 6_000);
    const frozen = showPresenter();
    expect(frozen.text).toContain('RICONNESSIONE…');
    await delay(1_100);
    expect(mainCounter(showPresenter().html)).toBe(mainCounter(frozen.html));
    expect(mainCounter(frozen.html)).not.toBe('');
  }, 45_000);
});
