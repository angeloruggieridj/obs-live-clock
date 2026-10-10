// SPDX-License-Identifier: GPL-2.0-or-later
import type { Clock, Scheduler } from '../clock/clock';
import { ObsAuthError, type ObsClient } from './client';

export interface ObsCredentials { host: string; port: number; password?: string }
export type ObsConnectionState = 'idle' | 'connecting' | 'connected' | 'auth_failed' | 'disconnected';
export interface ConnectionHooks {
  onConnected(client: ObsClient, info: { obsWebSocketVersion: string }): Promise<void> | void;
  onDisconnected(): void;
  report(err: unknown): void;
}
export interface ConnectionDeps { clientFactory: () => ObsClient; clock: Clock; scheduler: Scheduler; hooks: ConnectionHooks }

const MIN_BACKOFF = 500;
const MAX_BACKOFF = 5_000;

export class ObsConnection {
  private creds: ObsCredentials | null = null;
  private client: ObsClient | null = null;
  private cancelRetry: (() => void) | null = null;
  private backoff = MIN_BACKOFF;
  private generation = 0;
  private stopped = false;
  private _state: ObsConnectionState = 'idle';
  private _info: { obsWebSocketVersion: string } | null = null;

  constructor(private readonly deps: ConnectionDeps) {}

  get state(): ObsConnectionState { return this._state; }
  get info(): { obsWebSocketVersion: string } | null { return this._info; }

  setCredentials(creds: ObsCredentials | null): void {
    if (this.stopped) return;
    this.generation += 1;
    this.cancel();
    this.dropClient();
    this.creds = creds;
    this.backoff = MIN_BACKOFF;
    if (creds === null) { this.setState('idle'); return; }
    void this.attempt(this.generation);
  }

  async stop(): Promise<void> {
    this.stopped = true;
    this.generation += 1;
    this.cancel();
    await this.dropClient();
    this._state = 'idle';
  }

  private async attempt(gen: number): Promise<void> {
    if (gen !== this.generation || this.creds === null) return;
    this.setState('connecting');
    try {
      const client = this.deps.clientFactory();
      const info = await client.connect(`ws://${this.creds.host}:${this.creds.port}`, this.creds.password);
      if (gen !== this.generation) { await client.disconnect().catch(() => undefined); return; }
      this.client = client;
      this._info = { obsWebSocketVersion: info.obsWebSocketVersion };
      const closed = () => this.onClosed(gen, client);
      client.on('ConnectionClosed', closed);
      client.on('ExitStarted', closed);
      this.backoff = MIN_BACKOFF;
      this.setState('connected');
      try {
        await this.deps.hooks.onConnected(client, this._info);
      } catch (err) {
        this.report(err);
        await client.disconnect().catch(() => undefined);
        this.onClosed(gen, client);
      }
    } catch (err) {
      if (gen !== this.generation) return;
      if (err instanceof ObsAuthError) { this.report(err); this.setState('auth_failed'); return; }
      this.setState('disconnected');
      this.report(err);
      this.scheduleRetry(gen);
    }
  }

  private onClosed(gen: number, client: ObsClient): void {
    if (gen !== this.generation || this.client !== client) return;
    this.client = null;
    const wasConnected = this._state === 'connected';
    this.setState('disconnected');
    if (wasConnected) {
      try { this.deps.hooks.onDisconnected(); } catch (err) { this.report(err); }
    }
    this.disconnectQuietly(client);
    this.scheduleRetry(gen);
  }

  private scheduleRetry(gen: number): void {
    if (this.stopped || gen !== this.generation) return;
    this.cancel();
    const delay = this.backoff;
    this.backoff = Math.min(this.backoff * 2, MAX_BACKOFF);
    this.cancelRetry = this.deps.scheduler.setTimer(this.deps.clock.now() + delay, () => {
      this.cancelRetry = null;
      void this.attempt(gen);
    });
  }

  private cancel(): void { this.cancelRetry?.(); this.cancelRetry = null; }

  private async dropClient(): Promise<void> {
    const c = this.client;
    this.client = null;
    const wasConnected = this._state === 'connected';
    // Notify synchronously before awaiting teardown so SourceLost always precedes a later SourceRestored.
    if (wasConnected) { try { this.deps.hooks.onDisconnected(); } catch (err) { this.report(err); } }
    if (c) await c.disconnect().catch(() => undefined);
  }

  private report(err: unknown): void {
    try { this.deps.hooks.report(err); } catch { /* a throwing reporter must not reject the attempt */ }
  }

  private disconnectQuietly(client: ObsClient): void {
    try { void client.disconnect().catch((err) => this.report(err)); } catch (err) { this.report(err); }
  }

  private setState(s: ObsConnectionState): void { this._state = s; }
}
