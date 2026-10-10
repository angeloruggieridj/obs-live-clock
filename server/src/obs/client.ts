// SPDX-License-Identifier: GPL-2.0-or-later
import OBSWebSocket, { EventSubscription, OBSWebSocketError } from 'obs-websocket-js/json';

export type ObsData = Record<string, unknown>;
export type ObsListener = (data: ObsData) => void;

export interface ObsClient {
  connect(url: string, password: string | undefined): Promise<{ obsWebSocketVersion: string; negotiatedRpcVersion: number }>;
  disconnect(): Promise<void>;
  call(requestType: string, requestData?: ObsData): Promise<ObsData>;
  on(event: string, listener: ObsListener): void;
  off(event: string, listener: ObsListener): void;
}

/** obs-websocket refused the password (close code 4009). Never retried automatically. */
export class ObsAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ObsAuthError';
  }
}

/** A request failed with an obs-websocket status code. */
export class ObsRequestError extends Error {
  constructor(readonly code: number, message: string) {
    super(message);
    this.name = 'ObsRequestError';
  }
}

const AUTH_FAILED = 4009;

export function createObsClient(): ObsClient {
  const obs = new OBSWebSocket();
  const call = obs.call.bind(obs) as unknown as (t: string, d?: ObsData) => Promise<ObsData | undefined>;
  const on = obs.on.bind(obs) as unknown as (e: string, fn: ObsListener) => void;
  const off = obs.off.bind(obs) as unknown as (e: string, fn: ObsListener) => void;
  return {
    async connect(url, password) {
      try {
        const r = await obs.connect(url, password, { eventSubscriptions: EventSubscription.All, rpcVersion: 1 });
        return { obsWebSocketVersion: r.obsWebSocketVersion, negotiatedRpcVersion: r.negotiatedRpcVersion };
      } catch (err) {
        if (err instanceof OBSWebSocketError && err.code === AUTH_FAILED) throw new ObsAuthError('Authentication failed');
        throw err;
      }
    },
    disconnect: () => obs.disconnect(),
    async call(requestType, requestData) {
      try {
        return (await call(requestType, requestData)) ?? {};
      } catch (err) {
        if (err instanceof OBSWebSocketError) throw new ObsRequestError(err.code, err.message);
        throw err;
      }
    },
    on: (event, listener) => on(event, listener),
    off: (event, listener) => off(event, listener),
  };
}
