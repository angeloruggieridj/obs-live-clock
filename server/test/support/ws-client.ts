// SPDX-License-Identifier: GPL-2.0-or-later
import WebSocket from 'ws';
import type { ServerMessage } from '@olc/shared';

export interface TestClient {
  messages: ServerMessage[];
  send(msg: unknown): void;
  sendRaw(raw: string): void;
  next(pred: (m: ServerMessage) => boolean, timeoutMs?: number): Promise<ServerMessage>;
  closed: Promise<number>;
  close(): void;
}

/**
 * `next(pred)` consumes messages in arrival order: it returns the first message after the previous
 * `next` result that matches, whether it has already arrived or arrives later.
 */
export async function connect(url: string): Promise<TestClient> {
  const ws = new WebSocket(url);
  const messages: ServerMessage[] = [];
  let cursor = 0;
  let waiter: { pred: (m: ServerMessage) => boolean; resolve: (m: ServerMessage) => void } | null = null;

  const scan = (): ServerMessage | undefined => {
    if (waiter === null) return undefined;
    for (let i = cursor; i < messages.length; i++) {
      if (waiter.pred(messages[i]!)) {
        cursor = i + 1;
        return messages[i];
      }
    }
    return undefined;
  };

  ws.on('message', (raw) => {
    messages.push(JSON.parse(raw.toString()) as ServerMessage);
    const hit = scan();
    if (hit !== undefined && waiter !== null) {
      const w = waiter;
      waiter = null;
      w.resolve(hit);
    }
  });
  const closed = new Promise<number>((resolve) => ws.on('close', (code) => resolve(code)));
  await new Promise<void>((resolve, reject) => {
    ws.once('open', () => resolve());
    ws.once('error', reject);
  });
  return {
    messages,
    send: (msg) => ws.send(JSON.stringify(msg)),
    sendRaw: (raw) => ws.send(raw),
    next(pred, timeoutMs = 2_000) {
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          waiter = null;
          reject(new Error('timed out waiting for message'));
        }, timeoutMs);
        waiter = {
          pred,
          resolve: (m) => {
            clearTimeout(timer);
            resolve(m);
          },
        };
        const hit = scan();
        if (hit !== undefined) {
          waiter = null;
          clearTimeout(timer);
          resolve(hit);
        }
      });
    },
    closed,
    close: () => ws.close(),
  };
}
