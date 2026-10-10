// SPDX-License-Identifier: GPL-2.0-or-later
import type { Clock, Scheduler } from '../clock/clock';
import type { DeckItem, EngineInput } from '../engine/index';
import type { WithoutAt } from '../runtime/commands';
import type { LiveRuntime } from '../runtime/live-runtime';
import type { ObsClient } from './client';
import { ObsConnection, type ObsConnectionState, type ObsCredentials } from './connection';
import { DeckAdapter, type DeckStatusInfo } from './deck-adapter';
import { ObsAdapter } from './obs-adapter';
import { sceneNames } from './scene-graph';

export interface ObsStatus {
  connection: ObsConnectionState;
  obsWebSocketVersion: string | null;
  programScene: string | null;
  deck: DeckStatusInfo | null;
}

export interface ObsServiceDeps {
  runtime: LiveRuntime;
  clock: Clock;
  scheduler: Scheduler;
  clientFactory: () => ObsClient;
  report(err: unknown): void;
}

/**
 * Owns the OBS connection and its two adapters and wires them into the live runtime.
 *
 * On every connection it builds a fresh `DeckAdapter` and `ObsAdapter` (the previous pair was stopped by
 * `onDisconnected`), starting the deck first so its items and bound source are known before the Program
 * scene is first reported. It watches the runtime so that a fresh episode load — which resets the runtime
 * to `obs: 'lost'` while OBS stays connected — triggers one resync; a resync failure asks the connection to
 * reconnect, so the runtime can never be stuck `obs: 'lost'` while the connection looks healthy.
 */
export class ObsService {
  private readonly connection: ObsConnection;
  private readonly unsubscribe: () => void;
  private creds: ObsCredentials | null = null;
  private deck: DeckAdapter | null = null;
  private adapter: ObsAdapter | null = null;
  private connectedClient: ObsClient | null = null;
  private stopped = false;
  private starting = false;
  private resyncing = false;
  /** Bumped on every connection and disconnect so a superseded in-flight `onConnected` cannot take over. */
  private connectionToken = 0;

  constructor(private readonly deps: ObsServiceDeps) {
    this.connection = new ObsConnection({
      clientFactory: deps.clientFactory,
      clock: deps.clock,
      scheduler: deps.scheduler,
      hooks: {
        onConnected: (client) => this.onConnected(client),
        onDisconnected: () => this.onDisconnected(),
        report: (err) => this.report(err),
      },
    });
    this.unsubscribe = deps.runtime.subscribe(() => this.onRuntimeChange());
  }

  setCredentials(creds: ObsCredentials | null): void {
    if (this.stopped) return;
    this.creds = creds;
    this.connection.setCredentials(creds);
  }

  status(): ObsStatus {
    return {
      connection: this.connection.state,
      obsWebSocketVersion: this.connection.info?.obsWebSocketVersion ?? null,
      programScene: this.adapter?.programScene ?? null,
      deck: this.deck?.info ?? null,
    };
  }

  sceneNames(): string[] | null {
    const graph = this.adapter?.graph ?? null;
    return graph === null ? null : sceneNames(graph);
  }

  deckItems(): DeckItem[] | null {
    return this.deck?.items() ?? null;
  }

  client(): ObsClient | null {
    return this.connectedClient;
  }

  async stop(): Promise<void> {
    if (this.stopped) return;
    this.stopped = true;
    this.unsubscribe();
    this.adapter?.stop();
    this.deck?.stop();
    this.adapter = null;
    this.deck = null;
    this.connectedClient = null;
    await this.connection.stop();
  }

  private async onConnected(client: ObsClient): Promise<void> {
    if (this.stopped) return;
    const token = ++this.connectionToken;
    this.starting = true;
    this.connectedClient = client;
    const deck = new DeckAdapter({
      client,
      clock: this.deps.clock,
      scheduler: this.deps.scheduler,
      dispatch: (input) => this.dispatch(input),
      report: (err) => this.report(err),
      onSourceChanged: () => this.adapter?.refreshProgram(),
    });
    this.deck = deck;
    try {
      await deck.start();
      // A drop mid-start is detected by onDisconnected bumping the token; never build on a dead connection.
      if (this.stopped || token !== this.connectionToken) return;
      const adapter = new ObsAdapter({
        client,
        clock: this.deps.clock,
        scheduler: this.deps.scheduler,
        dispatch: (input) => this.dispatch(input),
        getState: () => this.deps.runtime.getState(),
        deckSourceName: () => deck.sourceName(),
        report: (err) => this.report(err),
      });
      this.adapter = adapter;
      await adapter.start();
    } finally {
      if (token === this.connectionToken) this.starting = false;
    }
  }

  private onDisconnected(): void {
    this.connectionToken += 1;
    const adapter = this.adapter;
    const deck = this.deck;
    this.adapter = null;
    this.deck = null;
    this.connectedClient = null;
    this.starting = false;
    adapter?.stop();
    deck?.stop();
    this.dispatch({ type: 'SourceLost' });
  }

  private onRuntimeChange(): void {
    if (this.stopped || this.starting || this.resyncing) return;
    if (this.connection.state !== 'connected') return;
    const state = this.deps.runtime.getState();
    if (state === null || state.obs !== 'lost') return;
    const adapter = this.adapter;
    const deck = this.deck;
    if (adapter === null || deck === null) return;
    this.resyncing = true;
    void this.resync(adapter, deck);
  }

  /** Single-flight: the flag keeps the dispatches made by the resync from re-entering this path. */
  private async resync(adapter: ObsAdapter, deck: DeckAdapter): Promise<void> {
    try {
      await adapter.resync();
      await deck.resync();
    } catch (err) {
      this.report(err);
      this.reconnect();
    } finally {
      this.resyncing = false;
    }
  }

  /** The cleanest existing way to force a reconnect: re-applying the credentials drops and retries the client. */
  private reconnect(): void {
    if (this.stopped || this.creds === null) return;
    this.connection.setCredentials(this.creds);
  }

  private dispatch(input: WithoutAt<EngineInput>): boolean {
    if (this.stopped) return false;
    return this.deps.runtime.dispatch(input);
  }

  private report(err: unknown): void {
    try {
      this.deps.report(err);
    } catch {
      // A throwing reporter must never break an OBS handler.
    }
  }
}
