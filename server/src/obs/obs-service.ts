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

function sameCredentials(a: ObsCredentials, b: ObsCredentials): boolean {
  return a.host === b.host && a.port === b.port && (a.password ?? '') === (b.password ?? '');
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
 * to `obs: 'lost'` while OBS stays connected — triggers a resync.
 *
 * A runtime notify that arrives while a start or a resync is in flight is not lost: it sets a `dirty` flag.
 * When the operation finishes (for the same connection token) the service re-checks the runtime and runs at
 * most one follow-up resync, so a load that races a start or a resync cannot leave the runtime stuck `lost`.
 * A resync that succeeds but still finds the runtime lost is reported once and stops: no self-triggering loop.
 * A resync that has been superseded by a reconnect is ignored, so it can neither reconnect nor disturb the
 * healthy connection.
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
  /** The connection token that owns the in-flight resync, or -1 when none. */
  private resyncToken = -1;
  /** A runtime notify was skipped because a start/resync was in flight and must be re-checked afterwards. */
  private dirty = false;
  /** Depth of our own `runtime.dispatch` calls: notifies raised by them must not mark the runtime dirty. */
  private dispatchDepth = 0;
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
    // The plugin re-posts its credentials on every start: while a connection is already up (or being
    // established) an identical hand-off must not drop it, or the runtime would briefly go `lost`.
    if (
      creds !== null &&
      this.creds !== null &&
      sameCredentials(this.creds, creds) &&
      (this.connection.state === 'connected' || this.connection.state === 'connecting')
    ) {
      return;
    }
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
    let started = false;
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
      started = true;
    } finally {
      if (token === this.connectionToken) {
        this.starting = false;
        // A rejected start must not be followed by a settle/resync: the connection drives the reconnect.
        if (started) this.settleAfterStart(token);
      }
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
    // The flags belong to the dead connection: clear them so a stale resync cannot hold the new connection.
    this.resyncing = false;
    this.resyncToken = -1;
    this.dirty = false;
    adapter?.stop();
    deck?.stop();
    this.dispatch({ type: 'SourceLost' });
  }

  private onRuntimeChange(): void {
    try {
      if (this.stopped) return;
      if (this.connection.state !== 'connected') return;
      const state = this.deps.runtime.getState();
      if (state === null || state.obs !== 'lost') return;
      if (this.starting || this.resyncing) {
        // A notify raised by our own dispatch is not a fresh reset; only an external one must be re-checked.
        if (this.dispatchDepth === 0) this.dirty = true;
        return;
      }
      this.beginResync(this.connectionToken);
    } catch (err) {
      this.report(err);
    }
  }

  /** Starts one resync for `token`; a no-op when already resyncing or the adapters are gone. */
  private beginResync(token: number): void {
    const adapter = this.adapter;
    const deck = this.deck;
    if (adapter === null || deck === null || this.resyncing) return;
    this.resyncing = true;
    this.resyncToken = token;
    void this.resync(adapter, deck, token);
  }

  /** Single-flight: the flag keeps the dispatches made by the resync from re-entering this path. */
  private async resync(adapter: ObsAdapter, deck: DeckAdapter, token: number): Promise<void> {
    try {
      await adapter.resync();
      // The connection may have been replaced while the adapter sync was in flight: the stale resync must not
      // touch the healthy connection.
      if (this.adapter !== adapter) return;
      await deck.resync();
    } catch (err) {
      if (this.adapter !== adapter) return;
      this.report(err);
      this.reconnect();
    } finally {
      if (token === this.connectionToken && this.resyncToken === token) {
        this.resyncing = false;
        this.resyncToken = -1;
        this.settleAfterResync(token);
      }
    }
  }

  /** After a start: run one follow-up resync when a notify was skipped or the runtime is still lost. */
  private settleAfterStart(token: number): void {
    if (this.stopped || token !== this.connectionToken) return;
    const dirty = this.dirty;
    this.dirty = false;
    if (dirty || this.runtimeLost()) this.beginResync(token);
  }

  /**
   * After a resync: a skipped notify means the resync did not see the latest reset, so run exactly one more.
   * Otherwise, if the runtime is still lost, report once and stop — never resync again on our own.
   */
  private settleAfterResync(token: number): void {
    if (this.stopped || token !== this.connectionToken) return;
    const dirty = this.dirty;
    this.dirty = false;
    if (dirty) {
      this.beginResync(token);
      return;
    }
    if (this.runtimeLost()) this.report(new Error('OBS resync finished but the runtime is still lost'));
  }

  private runtimeLost(): boolean {
    const state = this.deps.runtime.getState();
    return state !== null && state.obs === 'lost';
  }

  /** The cleanest existing way to force a reconnect: re-applying the credentials drops and retries the client. */
  private reconnect(): void {
    if (this.stopped || this.creds === null) return;
    this.connection.setCredentials(this.creds);
  }

  private dispatch(input: WithoutAt<EngineInput>): boolean {
    if (this.stopped) return false;
    this.dispatchDepth += 1;
    try {
      return this.deps.runtime.dispatch(input);
    } finally {
      this.dispatchDepth -= 1;
    }
  }

  private report(err: unknown): void {
    try {
      this.deps.report(err);
    } catch {
      // A throwing reporter must never break an OBS handler.
    }
  }
}
