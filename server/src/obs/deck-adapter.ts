// SPDX-License-Identifier: GPL-2.0-or-later
import type { Clock, Scheduler } from '../clock/clock';
import type { DeckItem, EngineInput } from '../engine/index';
import type { WithoutAt } from '../runtime/commands';
import { ObsRequestError, type ObsClient, type ObsData, type ObsListener } from './client';
import { compareVersions } from './version';

/** How much of the Playlist Deck vendor is available. */
export type DeckCapability = 'absent' | 'legacy' | 'events';

export interface DeckStatusInfo {
  capability: DeckCapability;
  version: string | null;
  sourceName: string | null;
  playlistName: string | null;
}

export interface DeckAdapterDeps {
  client: ObsClient;
  clock: Clock;
  scheduler: Scheduler;
  dispatch(input: WithoutAt<EngineInput>): boolean;
  report(err: unknown): void;
  onSourceChanged(): void;
}

const VENDOR = 'obs-playlist-deck';
const PAGE_SIZE = 200;
/** Legacy plugins expose no events, so the items are polled instead. */
const POLL_MS = 2_000;
/** `playlist-changed` bursts are collapsed into one re-read. */
const DEBOUNCE_MS = 150;
/** Playback cursor drift above this (in ms) is a real seek/restart, not clock skew. */
const DRIFT_MS = 500;
/** Plugin version from which the vendor emits events instead of needing polling. */
const EVENTS_VERSION = '1.4.0';

interface LastPlayback {
  index: number;
  positionMs: number;
  durationMs: number;
  playing: boolean;
  at: number;
}

/**
 * Bridges the Playlist Deck OBS plugin to the live engine.
 *
 * `start()` reads the vendor status once to learn whether the plugin is present, old (polling) or
 * new (events), then publishes the full item list. Every handler is guarded: a failure is reported
 * and ignored. After every await a `running` check aborts before anything is dispatched, so a
 * `stop()` cannot leak dispatches onto a stopped adapter.
 */
export class DeckAdapter {
  private capability: DeckCapability = 'absent';
  private version: string | null = null;
  private source: string | null = null;
  private playlist: string | null = null;
  private currentItems: DeckItem[] | null = null;
  private listeners: Array<[string, ObsListener]> = [];
  private pollCancel: (() => void) | null = null;
  private debounceCancel: (() => void) | null = null;
  private lastPlayback: LastPlayback | null = null;
  private running = false;

  constructor(private readonly deps: DeckAdapterDeps) {}

  get info(): DeckStatusInfo {
    return {
      capability: this.capability,
      version: this.version,
      sourceName: this.source,
      playlistName: this.playlist,
    };
  }

  /** The last known item list, or `null` before the first successful read. */
  items(): DeckItem[] | null {
    return this.currentItems;
  }

  /** The OBS source the deck is currently bound to, or `null` when unknown. */
  sourceName(): string | null {
    return this.source;
  }

  async start(): Promise<void> {
    this.running = true;
    let status: ObsData;
    try {
      status = await this.getStatus();
    } catch (err) {
      if (!this.running) return;
      if (err instanceof ObsRequestError) {
        // The vendor is not installed: run without media matching and never poll.
        this.capability = 'absent';
        this.deps.report(err);
        return;
      }
      this.deps.report(err);
      throw err;
    }
    if (!this.running) return;

    this.version = typeof status.pluginVersion === 'string' ? status.pluginVersion : null;
    const supportsEvents = this.version !== null && compareVersions(this.version, EVENTS_VERSION) >= 0;
    this.capability = supportsEvents ? 'events' : 'legacy';
    this.source = typeof status.sourceName === 'string' ? status.sourceName : null;
    this.playlist = typeof status.playlistName === 'string' ? status.playlistName : null;

    let items: DeckItem[];
    try {
      items = await this.fetchItems();
    } catch (err) {
      if (!this.running) return;
      this.deps.report(err);
      // A vendor request failure is not fatal: run with an empty list and keep listening/polling.
      if (!(err instanceof ObsRequestError)) throw err;
      items = [];
    }
    if (!this.running) return;
    if (this.deps.dispatch({ type: 'DeckPlaylistChanged', items })) this.currentItems = items;
    this.dispatchStatusPlayback(status);

    if (this.capability === 'events') this.attach();
    else this.armPoll();
  }

  /**
   * Re-reads the vendor status and items, then re-publishes them.
   *
   * Clears the playback dedup state and the item baseline first, so everything is re-dispatched
   * even if an earlier dispatch was refused. A no-op when not running; never throws.
   */
  async resync(): Promise<void> {
    if (!this.running) return;
    try {
      await this.resyncOnce();
    } catch (err) {
      this.deps.report(err);
    }
  }

  private async resyncOnce(): Promise<void> {
    if (!this.running) return;
    const status = await this.getStatus();
    if (!this.running) return;
    const items = await this.fetchItems();
    if (!this.running) return;

    this.lastPlayback = null;
    this.currentItems = null;
    if (this.deps.dispatch({ type: 'DeckPlaylistChanged', items })) this.currentItems = items;
    this.dispatchStatusPlayback(status);
  }

  stop(): void {
    this.running = false;
    for (const [event, fn] of this.listeners) this.deps.client.off(event, fn);
    this.listeners = [];
    if (this.debounceCancel !== null) {
      this.debounceCancel();
      this.debounceCancel = null;
    }
    if (this.pollCancel !== null) {
      this.pollCancel();
      this.pollCancel = null;
    }
  }

  private async getStatus(): Promise<ObsData> {
    const resp = await this.deps.client.call('CallVendorRequest', {
      vendorName: VENDOR,
      requestType: 'GetStatus',
      requestData: {},
    });
    return responseData(resp);
  }

  /** Reads every page of `GetItems`, mapping each entry to a `DeckItem`. */
  private async fetchItems(): Promise<DeckItem[]> {
    const items: DeckItem[] = [];
    for (let from = 0; ; from += PAGE_SIZE) {
      const resp = await this.deps.client.call('CallVendorRequest', {
        vendorName: VENDOR,
        requestType: 'GetItems',
        requestData: { from, to: from + PAGE_SIZE - 1 },
      });
      if (!this.running) return items;
      const data = responseData(resp);
      const raw = Array.isArray(data.items) ? data.items : [];
      for (const entry of raw) {
        const item = mapItem(entry);
        if (item !== null) items.push(item);
      }
      const count = isFiniteNumber(data.count) ? data.count : items.length;
      if (from + PAGE_SIZE >= count || raw.length === 0) break;
    }
    return items;
  }

  private dispatchStatusPlayback(status: ObsData): void {
    const index = status.currentIndex;
    if (!isFiniteNumber(index) || index < 0) return;
    const positionMs = status.positionMs;
    if (!isFiniteNumber(positionMs)) {
      this.deps.report(new Error('status malformed: positionMs'));
      return;
    }
    const playing = status.playing;
    if (typeof playing !== 'boolean') {
      this.deps.report(new Error('status malformed: playing'));
      return;
    }
    const durationMs = isFiniteNumber(status.durationMs) ? status.durationMs : -1;
    if (this.deps.dispatch({ type: 'DeckPlayback', index, positionMs, durationMs, playing })) {
      this.lastPlayback = { index, positionMs, durationMs, playing, at: this.deps.clock.now() };
    }
  }

  private attach(): void {
    const fn: ObsListener = (d) => this.guard(() => this.onVendorEvent(d));
    this.deps.client.on('VendorEvent', fn);
    this.listeners.push(['VendorEvent', fn]);
  }

  private guard(fn: () => void): void {
    try {
      fn();
    } catch (err) {
      this.deps.report(err);
    }
  }

  private onVendorEvent(data: ObsData): void {
    if (!this.running) return;
    if (data.vendorName !== VENDOR) return;
    const eventType = data.eventType;
    switch (eventType) {
      case 'item-started':
      case 'playback-state': {
        const eventData = data.eventData;
        if (!isRecord(eventData)) {
          this.deps.report(new Error(`${String(eventType)} malformed: eventData`));
          return;
        }
        if (eventType === 'item-started') this.onItemStarted(eventData);
        else this.onPlaybackState(eventData);
        return;
      }
      case 'playlist-changed':
        this.onPlaylistChanged();
        return;
      case 'playlist-completed':
        return;
      default:
        return;
    }
  }

  private onItemStarted(d: ObsData): void {
    const index = d.index;
    if (!isFiniteNumber(index)) {
      this.deps.report(new Error('item-started malformed: index'));
      return;
    }
    const path = d.path;
    if (typeof path !== 'string') {
      this.deps.report(new Error('item-started malformed: path'));
      return;
    }
    const title = typeof d.title === 'string' ? d.title : '';
    const durationMs = isFiniteNumber(d.durationMs) ? d.durationMs : -1;
    this.deps.dispatch({ type: 'DeckItemStarted', index, path, title, durationMs });
  }

  private onPlaybackState(d: ObsData): void {
    const index = d.index;
    if (!isFiniteNumber(index)) {
      this.deps.report(new Error('playback-state malformed: index'));
      return;
    }
    const positionMs = d.positionMs;
    if (!isFiniteNumber(positionMs)) {
      this.deps.report(new Error('playback-state malformed: positionMs'));
      return;
    }
    const playing = d.playing;
    if (typeof playing !== 'boolean') {
      this.deps.report(new Error('playback-state malformed: playing'));
      return;
    }
    const durationMs = isFiniteNumber(d.durationMs) ? d.durationMs : -1;
    const now = this.deps.clock.now();
    const last = this.lastPlayback;
    if (last !== null && last.index === index && last.playing === playing && last.durationMs === durationMs) {
      const expected = last.positionMs + (last.playing ? now - last.at : 0);
      if (Math.abs(positionMs - expected) <= DRIFT_MS) return;
    }
    // Remember only what was accepted: a dropped dispatch must not suppress the next one.
    if (this.deps.dispatch({ type: 'DeckPlayback', index, positionMs, durationMs, playing })) {
      this.lastPlayback = { index, positionMs, durationMs, playing, at: now };
    }
  }

  private onPlaylistChanged(): void {
    if (this.debounceCancel !== null) this.debounceCancel();
    this.debounceCancel = this.deps.scheduler.setTimer(this.deps.clock.now() + DEBOUNCE_MS, () => {
      this.debounceCancel = null;
      void this.reloadPlaylist();
    });
  }

  private async reloadPlaylist(): Promise<void> {
    try {
      await this.reloadPlaylistOnce();
    } catch (err) {
      this.deps.report(err);
    }
  }

  private async reloadPlaylistOnce(): Promise<void> {
    if (!this.running) return;
    let status: ObsData;
    try {
      status = await this.getStatus();
    } catch (err) {
      this.deps.report(err);
      return;
    }
    if (!this.running) return;
    const items = await this.fetchItems();
    if (!this.running) return;

    const source = typeof status.sourceName === 'string' ? status.sourceName : this.source;
    const changed = source !== this.source;
    this.source = source;
    if (typeof status.playlistName === 'string') this.playlist = status.playlistName;
    if (this.deps.dispatch({ type: 'DeckPlaylistChanged', items })) this.currentItems = items;
    if (changed) this.deps.onSourceChanged();
  }

  private armPoll(): void {
    this.pollCancel = this.deps.scheduler.setTimer(this.deps.clock.now() + POLL_MS, () => {
      this.pollCancel = null;
      void this.poll();
    });
  }

  private async poll(): Promise<void> {
    try {
      await this.pollOnce();
    } catch (err) {
      this.deps.report(err);
    } finally {
      if (this.running) this.armPoll();
    }
  }

  private async pollOnce(): Promise<void> {
    let status: ObsData;
    try {
      status = await this.getStatus();
    } catch (err) {
      this.deps.report(err);
      return;
    }
    if (!this.running) return;
    const items = await this.fetchItems();
    if (!this.running) return;

    const source = typeof status.sourceName === 'string' ? status.sourceName : this.source;
    if (source !== this.source) {
      this.source = source;
      this.deps.onSourceChanged();
    }
    if (typeof status.playlistName === 'string') this.playlist = status.playlistName;
    if (!itemsEqual(this.currentItems, items)) {
      if (this.deps.dispatch({ type: 'DeckPlaylistChanged', items })) this.currentItems = items;
    }
  }
}

function responseData(resp: ObsData): ObsData {
  return isRecord(resp.responseData) ? resp.responseData : {};
}

function mapItem(entry: unknown): DeckItem | null {
  if (!isRecord(entry)) return null;
  const index = entry.index;
  const path = entry.path;
  if (!isFiniteNumber(index) || typeof path !== 'string') return null;
  const title = typeof entry.title === 'string' ? entry.title : '';
  const durationMs = isFiniteNumber(entry.durationMs) ? entry.durationMs : -1;
  return { index, path, title, durationMs };
}

/** Deep comparison of the fields the engine cares about. */
function itemsEqual(a: DeckItem[] | null, b: DeckItem[]): boolean {
  if (a === null || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    const y = b[i];
    if (x.index !== y.index || x.path !== y.path || x.title !== y.title || x.durationMs !== y.durationMs) return false;
  }
  return true;
}

function isRecord(value: unknown): value is ObsData {
  return typeof value === 'object' && value !== null;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}
