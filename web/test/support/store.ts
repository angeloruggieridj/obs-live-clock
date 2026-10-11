// SPDX-License-Identifier: GPL-2.0-or-later
import type { ClientCommand, ClientRole } from '@olc/shared';
import type { ClientSnapshot, LiveStore } from '../../src/core/ws-client';
import type { ViewFor } from '../../src/core/views';
import { WALL } from './views';

/** A fresh, synced, open snapshot holding `view`. */
export function snapshotOf<R extends ClientRole>(view: ViewFor<R> | null, over: Partial<ClientSnapshot<R>> = {}): ClientSnapshot<R> {
  return { connection: 'open', view, hasView: true, stale: false, staleSince: null, synced: true, serverVersion: '0.1.0', problem: null, ...over };
}

/** A LiveStore whose snapshot and server time the test sets directly. */
export class StaticStore<R extends ClientRole = ClientRole> implements LiveStore<R> {
  now: number | null;
  readonly commands: ClientCommand[] = [];
  reply: (command: ClientCommand) => Promise<{ changed: boolean }> = async () => ({ changed: true });
  private snap: ClientSnapshot<R>;
  private readonly listeners = new Set<() => void>();

  constructor(snap: ClientSnapshot<R>, now: number | null = WALL) {
    this.snap = snap;
    this.now = now;
  }

  readonly subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };

  readonly getSnapshot = (): ClientSnapshot<R> => this.snap;

  readonly serverNow = (): number | null => this.now;

  readonly sendCommand = (command: ClientCommand): Promise<{ changed: boolean }> => {
    this.commands.push(command);
    return this.reply(command);
  };

  set(patch: Partial<ClientSnapshot<R>>): void {
    this.snap = { ...this.snap, ...patch };
    for (const fn of [...this.listeners]) fn();
  }
}
