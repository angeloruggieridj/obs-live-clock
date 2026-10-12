// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import { FakeTime } from '../../src/clock/clock';
import { ObsRequestError } from '../../src/obs/client';
import { DeckAdapter } from '../../src/obs/deck-adapter';
import { FakeObsClient } from '../support/fake-obs';

const flush = () => new Promise((r) => setImmediate(r));

function setup(version: string | null, opts: { hasEpisode?: boolean } = {}) {
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
  let accept = true;
  let getItemsError: Error | null = null;
  let hasEpisode = opts.hasEpisode ?? true;
  obs.respond('CallVendorRequest', (d) => {
    if (version === null) throw new ObsRequestError(600, 'vendor not found');
    if (d?.requestType === 'GetStatus') return { responseData: { ...status, count: items.length } };
    if (getItemsError !== null) throw getItemsError;
    const r = d?.requestData as { from: number; to: number };
    return { responseData: { ok: true, count: items.length, items: items.slice(r.from, r.to + 1) } };
  });
  const dispatched: Array<Record<string, unknown>> = [];
  const errors: unknown[] = [];
  let sourceChanges = 0;
  const deck = new DeckAdapter({
    client: obs, clock: time, scheduler: time,
    dispatch: (i) => { dispatched.push(i as Record<string, unknown>); return accept; },
    report: (e) => void errors.push(e),
    onSourceChanged: () => void sourceChanges++,
    hasEpisode: () => hasEpisode,
  });
  return {
    time, obs, deck, dispatched, errors, status,
    setItems: (x: typeof items) => (items = x),
    setAccept: (v: boolean) => { accept = v; },
    setGetItemsError: (e: Error | null) => { getItemsError = e; },
    setHasEpisode: (v: boolean) => { hasEpisode = v; },
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

  it('reports and ignores playback-state without a boolean playing', async () => {
    const h = setup('1.4.0');
    await h.deck.start();
    h.dispatched.length = 0;
    h.errors.length = 0;
    h.obs.emit('VendorEvent', vendor('playback-state', { index: 0, positionMs: 0, durationMs: 1_000 }));
    expect(h.dispatched).toEqual([]);
    expect(h.errors).toHaveLength(1);
  });

  it('reports and ignores playback-state without a numeric positionMs', async () => {
    const h = setup('1.4.0');
    await h.deck.start();
    h.dispatched.length = 0;
    h.errors.length = 0;
    h.obs.emit('VendorEvent', vendor('playback-state', { index: 0, playing: true, durationMs: 1_000 }));
    expect(h.dispatched).toEqual([]);
    expect(h.errors).toHaveLength(1);
  });

  it('reports and ignores item-started without a numeric index or string path', async () => {
    const h = setup('1.4.0');
    await h.deck.start();
    h.dispatched.length = 0;
    h.errors.length = 0;
    h.obs.emit('VendorEvent', vendor('item-started', { title: 'Servizio 1', durationMs: 185_000 }));
    expect(h.dispatched).toEqual([]);
    expect(h.errors).toHaveLength(1);
  });

  it('reports a non-object eventData instead of dispatching', async () => {
    const h = setup('1.4.0');
    await h.deck.start();
    h.dispatched.length = 0;
    h.errors.length = 0;
    h.obs.emit('VendorEvent', { vendorName: 'obs-playlist-deck', eventType: 'item-started', eventData: 'nope' });
    expect(h.dispatched).toEqual([]);
    expect(h.errors).toHaveLength(1);
  });

  it('reports a status playback missing playing instead of dispatching', async () => {
    const h = setup('1.4.0');
    h.status.currentIndex = 0;
    delete (h.status as { playing?: boolean }).playing;
    await h.deck.start();
    expect(h.dispatched.some((d) => d.type === 'DeckPlayback')).toBe(false);
    expect(h.errors).toHaveLength(1);
  });

  it('survives an ObsRequestError while loading items', async () => {
    const h = setup('1.4.0');
    h.setGetItemsError(new ObsRequestError(500, 'GetItems failed'));
    await expect(h.deck.start()).resolves.toBeUndefined();
    expect(h.errors).toHaveLength(1);
    expect(h.deck.info.capability).toBe('events');
    expect(h.deck.info.sourceName).toBe('Deck Media');
  });

  it('rethrows a transport error while loading items', async () => {
    const h = setup('1.4.0');
    h.setGetItemsError(new Error('socket closed'));
    await expect(h.deck.start()).rejects.toThrow('socket closed');
  });

  it('publishes nothing on a GetItems ObsRequestError and delivers items on a later re-read', async () => {
    const h = setup('1.4.0');
    h.setGetItemsError(new ObsRequestError(500, 'GetItems failed'));
    await h.deck.start();
    // No empty DeckPlaylistChanged: that would make the engine drop every pending media slot.
    expect(h.dispatched.filter((d) => d.type === 'DeckPlaylistChanged')).toEqual([]);
    expect(h.deck.items()).toBeNull();
    expect(h.errors).toHaveLength(1);

    // The failed read schedules a debounced re-read through the playlist-changed path.
    h.setGetItemsError(null);
    h.time.advance(150);
    await flush();
    await flush();
    expect(h.dispatched.filter((d) => d.type === 'DeckPlaylistChanged')).toEqual([
      {
        type: 'DeckPlaylistChanged',
        items: [
          { index: 0, path: 'D:/media/servizio1.mp4', title: 'Servizio 1', durationMs: 185_000 },
          { index: 1, path: 'D:/media/servizio2.mp4', title: 'Servizio 2', durationMs: -1 },
        ],
      },
    ]);
    expect(h.deck.items()).not.toBeNull();
  });

  it('resync() re-delivers items after a refused dispatch', async () => {
    const h = setup('1.4.0');
    h.setAccept(false);
    await h.deck.start();
    expect(h.deck.items()).toBeNull();
    h.setAccept(true);
    await h.deck.resync();
    expect(h.deck.items()).toEqual([
      { index: 0, path: 'D:/media/servizio1.mp4', title: 'Servizio 1', durationMs: 185_000 },
      { index: 1, path: 'D:/media/servizio2.mp4', title: 'Servizio 2', durationMs: -1 },
    ]);
    expect(h.dispatched.filter((d) => d.type === 'DeckPlaylistChanged')).toHaveLength(2);
  });

  it('serves the latest known items when the engine refuses them because no episode is loaded', async () => {
    const h = setup('1.4.0', { hasEpisode: false });
    h.setAccept(false);
    await h.deck.start();
    // The engine has nowhere to put the playlist before an episode is loaded, but the editor imports from
    // the deck while it is preparing the rundown: the items must be served even though the dispatch was refused.
    expect(h.deck.items()).toEqual([
      { index: 0, path: 'D:/media/servizio1.mp4', title: 'Servizio 1', durationMs: 185_000 },
      { index: 1, path: 'D:/media/servizio2.mp4', title: 'Servizio 2', durationMs: -1 },
    ]);
    expect(h.dispatched.filter((d) => d.type === 'DeckPlaylistChanged')).toHaveLength(1);
  });

  it('delivers the playlist to the engine once an episode loads, though it was served while none was loaded', async () => {
    const h = setup('1.3.3', { hasEpisode: false });
    h.setAccept(false);
    await h.deck.start();
    // No episode yet: the engine got nothing, but the editor must still be served the list.
    expect(h.dispatched.filter((d) => d.type === 'DeckPlaylistChanged')).toHaveLength(1);
    expect(h.deck.items()).not.toBeNull();

    // The episode loads: the next poll must SEE that the engine never accepted the list and deliver it.
    h.setAccept(true);
    h.setHasEpisode(true);
    h.time.advance(2_000);
    await flush();
    await flush();
    const changes = h.dispatched.filter((d) => d.type === 'DeckPlaylistChanged');
    expect(changes).toHaveLength(2);
    expect(changes[1]).toEqual(changes[0]);
  });

  it('resync() clears lastPlayback so the same playback is re-dispatched', async () => {
    const h = setup('1.4.0');
    await h.deck.start();
    h.dispatched.length = 0;
    const state = { index: 0, positionMs: 0, durationMs: 1_000, playing: true };
    h.obs.emit('VendorEvent', vendor('playback-state', state));
    expect(h.dispatched).toHaveLength(1);
    h.obs.emit('VendorEvent', vendor('playback-state', state));
    expect(h.dispatched).toHaveLength(1);
    await h.deck.resync();
    h.dispatched.length = 0;
    h.obs.emit('VendorEvent', vendor('playback-state', state));
    expect(h.dispatched.map((d) => d.type)).toEqual(['DeckPlayback']);
  });

  it('legacy poll re-dispatches after a refused dispatch', async () => {
    const h = setup('1.3.3');
    h.setAccept(false);
    await h.deck.start();
    h.dispatched.length = 0;
    h.setAccept(true);
    h.time.advance(2_000);
    await flush();
    await flush();
    expect(h.dispatched.map((d) => d.type)).toEqual(['DeckPlaylistChanged']);
    expect(h.deck.items()).not.toBeNull();
  });

  it('legacy poll delivers items after a GetItems ObsRequestError during start', async () => {
    const h = setup('1.3.3');
    h.setGetItemsError(new ObsRequestError(500, 'GetItems failed'));
    await h.deck.start();
    expect(h.dispatched.filter((d) => d.type === 'DeckPlaylistChanged')).toEqual([]);
    expect(h.deck.items()).toBeNull();

    h.setGetItemsError(null);
    h.time.advance(2_000);
    await flush();
    await flush();
    expect(h.dispatched.filter((d) => d.type === 'DeckPlaylistChanged')).toHaveLength(1);
    expect(h.deck.items()).not.toBeNull();
  });
});
