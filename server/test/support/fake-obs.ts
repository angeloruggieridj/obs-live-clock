// SPDX-License-Identifier: GPL-2.0-or-later
import { ObsRequestError, type ObsClient, type ObsData, type ObsListener } from '../../src/obs/client';

/** In-memory obs-websocket client for unit tests. */
export class FakeObsClient implements ObsClient {
  connected = false;
  connectError: Error | null = null;
  readonly calls: Array<{ type: string; data: ObsData | undefined }> = [];
  private readonly responders = new Map<string, (data: ObsData | undefined) => ObsData | Promise<ObsData>>();
  private readonly listeners = new Map<string, Set<ObsListener>>();

  respond(type: string, fn: (data: ObsData | undefined) => ObsData | Promise<ObsData>): void {
    this.responders.set(type, fn);
  }

  async connect(url: string, password: string | undefined): Promise<{ obsWebSocketVersion: string; negotiatedRpcVersion: number }> {
    if (this.connectError) throw this.connectError;
    this.connected = true;
    return { obsWebSocketVersion: '5.5.0', negotiatedRpcVersion: 1 };
  }

  async disconnect(): Promise<void> {
    if (!this.connected) return;
    this.connected = false;
    this.emit('ConnectionClosed', { code: 1000 });
  }

  async call(type: string, data?: ObsData): Promise<ObsData> {
    this.calls.push({ type, data });
    const fn = this.responders.get(type);
    if (fn === undefined) throw new ObsRequestError(204, `Unknown request ${type}`);
    return fn(data);
  }

  on(event: string, listener: ObsListener): void {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event)!.add(listener);
  }

  off(event: string, listener: ObsListener): void {
    this.listeners.get(event)?.delete(listener);
  }

  emit(event: string, data: ObsData): void {
    for (const fn of [...(this.listeners.get(event) ?? [])]) fn(data);
  }

  listenerCount(event: string): number {
    return this.listeners.get(event)?.size ?? 0;
  }
}
