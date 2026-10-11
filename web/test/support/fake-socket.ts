// SPDX-License-Identifier: GPL-2.0-or-later
import type { SocketLike } from '../../src/core/ws-client';

export class FakeSocket implements SocketLike {
  readyState = 0;
  onopen: ((ev: unknown) => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onclose: ((ev: { code: number }) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  readonly sent: unknown[] = [];
  /** Set when the client closes the socket itself. */
  closed: { code: number | undefined; reason: string | undefined } | null = null;

  constructor(readonly url: string) {}

  send(data: string): void {
    this.sent.push(JSON.parse(data));
  }

  close(code?: number, reason?: string): void {
    if (this.readyState === 3) return;
    this.closed = { code, reason };
    this.readyState = 3;
    this.onclose?.({ code: code ?? 1005 });
  }

  open(): void {
    this.readyState = 1;
    this.onopen?.({});
  }

  receive(msg: unknown): void {
    this.onmessage?.({ data: JSON.stringify(msg) });
  }

  receiveRaw(text: string): void {
    this.onmessage?.({ data: text });
  }

  /** The server or the network drops the connection. */
  drop(code = 1006): void {
    this.readyState = 3;
    this.onclose?.({ code });
  }

  sentOfType(type: string): unknown[] {
    return this.sent.filter((m) => (m as { type: string }).type === type);
  }
}
