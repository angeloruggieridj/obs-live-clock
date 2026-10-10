// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import { FakeTime } from '../../src/clock/clock';
import { ObsRequestError } from '../../src/obs/client';
import { DeckAdapter } from '../../src/obs/deck-adapter';
import { FakeObsClient } from '../support/fake-obs';

const flush = () => new Promise((r) => setImmediate(r));

function setup(version: string | null) {
  const time = new FakeTime();
  const obs = new FakeObsClient();
  const status = {
    ok: true, pluginVersion: version, sourceName: 'Deck Media', playlistName: 'Puntata',
    currentIndex: -1, positionMs: -1, durationMs: -1, playing: false, count: 2,
  };
  let items = [
    { index: 0, title: 'Servizio 1', path: 'D:/media/servizio1.mp4', durationMs: 185_000 },
    { index: 1, title: 'Servizio 2', path: 'D:/media/servizio2.mp4' },
  ];
  obs.respond('CallVendorRequest', (d) => {
    if (version === null) throw new ObsRequestError(600, 'vendor not found');
    if (d?.requestType === 'GetStatus') return { responseData: { ...status, count: items.length } };
    const r = d?.requestData as { from: number; to: number };
    return { responseData: { ok: true, count: items.length, items: items.slice(r.from, r.to + 1) } };
  });
  const dispatched: Array<Record<string, unknown>> = [];
  const errors: unknown[] = [];
  let sourceChanges = 0;
  const deck = new DeckAdapter({
    client: obs, clock: time, scheduler: time,
    dispatch: (i) => { dispatched.push(i as Record<string, unknown>); return true; },
    report: (e) => void errors.push(e),
    onSourceChanged: () => void sourceChanges++,
  });
  return {
    time, obs, deck, dispatched, errors, status,
    setItems: (x: typeof items) => (items = x),
    sourceChanges: () => sourceChanges,
  };
}

const vendor = (eventType: string, eventData: Record<string, unknown>) => ({ vendorName: 'obs-playlist-deck', eventType, eventData });

describe('DeckAdapter', () => {
  it('loads status and all items; unknown durations are -1', async () => {
    const h = setup('1.4.0');
    await h.deck.start();
    expect(h.deck.info).toEqual({ capability: 'events', version: '1.4.0', sourceName: 'Deck Media', playlistName: 'Puntata' });
    expect(h.dispatched).toEqual([{
      type: 'DeckPlaylistChanged',
      items: [
        { index: 0, path: 'D:/media/servizio1.mp4', title: 'Servizio 1', durationMs: 185_000 },
        { index: 1, path: 'D:/media/servizio2.mp4', title: 'Servizio 2', durationMs: -1 },
      ],
    }]);
  });

  it('treats a missing vendor as absent without crashing', async () => {
    const h = setup(null);
    await h.deck.start();
    expect(h.deck.info.capability).toBe('absent');
    expect(h.dispatched).toEqual([]);
    expect(h.time.pending).toBe(0);
  });

  it('maps item-started and deduplicates playback-state', async () => {
    const h = setup('1.4.0');
    await h.deck.start();
    h.dispatched.length = 0;
    h.obs.emit('VendorEvent', vendor('item-started', { index: 0, title: 'Servizio 1', path: 'D:/media/servizio1.mp4', durationMs: 185_000 }));
    h.obs.emit('VendorEvent', vendor('playback-state', { playing: true, positionMs: 0, durationMs: 185_000, index: 0 }));
    for (let i = 1; i <= 5; i++) {
      h.time.advance(1_000);
      h.obs.emit('VendorEvent', vendor('playback-state', { playing: true, positionMs: i * 1_000, durationMs: 185_000, index: 0 }));
    }
    h.obs.emit('VendorEvent', vendor('playback-state', { playing: false, positionMs: 5_000, durationMs: 185_000, index: 0 }));
    h.obs.emit('VendorEvent', { vendorName: 'other', eventType: 'item-started', eventData: { index: 9, path: 'x' } });
    expect(h.dispatched.map((d) => d.type)).toEqual(['DeckItemStarted', 'DeckPlayback', 'DeckPlayback']);
    expect(h.dispatched[2]).toMatchObject({ playing: false, positionMs: 5_000 });
  });

  it('re-reads the playlist on playlist-changed (debounced) and notices a new bound source', async () => {
    const h = setup('1.4.0');
    await h.deck.start();
    h.dispatched.length = 0;
    h.setItems([{ index: 0, title: 'Servizio 2', path: 'D:/media/servizio2.mp4', durationMs: 120_000 }]);
    h.status.sourceName = 'Other Media';
    h.obs.emit('VendorEvent', vendor('playlist-changed', { reason: 'removed', playlistName: 'Puntata', count: 1 }));
    h.obs.emit('VendorEvent', vendor('playlist-changed', { reason: 'durations-updated', playlistName: 'Puntata', count: 1 }));
    h.time.advance(150);
    await flush();
    await flush();
    expect(h.dispatched).toEqual([{ type: 'DeckPlaylistChanged', items: [{ index: 0, path: 'D:/media/servizio2.mp4', title: 'Servizio 2', durationMs: 120_000 }] }]);
    expect(h.deck.sourceName()).toBe('Other Media');
    expect(h.sourceChanges()).toBe(1);
  });

  it('polls GetItems every 2 s on legacy plugins and dispatches only on change', async () => {
    const h = setup('1.3.3');
    await h.deck.start();
    expect(h.deck.info.capability).toBe('legacy');
    h.dispatched.length = 0;
    h.time.advance(2_000);
    await flush();
    await flush();
    expect(h.dispatched).toEqual([]);
    h.setItems([{ index: 0, title: 'Servizio 1', path: 'D:/media/servizio1.mp4', durationMs: 185_000 }]);
    h.time.advance(2_000);
    await flush();
    await flush();
    expect(h.dispatched.map((d) => d.type)).toEqual(['DeckPlaylistChanged']);
  });
});
