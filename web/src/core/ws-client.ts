// SPDX-License-Identifier: GPL-2.0-or-later
import {
  PROTOCOL_VERSION,
  ServerMessageSchema,
  type ClientCommand,
  type ClientMessage,
  type ClientRole,
  type ErrorCode,
} from '@olc/shared';
import { reconnectDelay } from './backoff';
import { ClockSync } from './clock-sync';
import { parseView, type ViewFor } from './views';

export const STALE_AFTER_MS = 2_000;
export const STALE_CHECK_MS = 250;
export const PING_BURST = 4;
export const PING_BURST_GAP_MS = 250;
export const PING_INTERVAL_MS = 5_000;
export const STABLE_CONNECTION_MS = 10_000;
export const COMMAND_TIMEOUT_MS = 3_000;

const OPEN = 1;
const CLOSE_PROTOCOL_MISMATCH = 4001;
const CLOSE_RESYNC = 4000;

/** The part of the browser WebSocket the client uses (Node's global WebSocket and the test fake satisfy it). */
export interface SocketLike {
  readonly readyState: number;
  onopen: ((ev: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onclose: ((ev: { code: number }) => void) | null;
  onerror: ((ev: unknown) => void) | null;
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

export interface Scheduler {
  setTimeout(fn: () => void, ms: number): () => void;
}

export const browserScheduler: Scheduler = {
  setTimeout(fn, ms) {
    const handle = globalThis.setTimeout(fn, ms);
    return () => globalThis.clearTimeout(handle);
  },
};

/** Local monotonic milliseconds: immune to the client's wall clock being changed. */
export const monotonicNow = (): number => performance.timeOrigin + performance.now();

export function wsUrl(loc: { protocol: string; host: string }): string {
  return `${loc.protocol === 'https:' ? 'wss' : 'ws'}://${loc.host}/ws`;
}

export type ConnectionState = 'connecting' | 'open' | 'reconnecting' | 'incompatible';

export interface ClientSnapshot<R extends ClientRole> {
  connection: ConnectionState;
  /** Last valid view; null when no episode is loaded or before the first view. */
  view: ViewFor<R> | null;
  /** A valid view has arrived since start(): until then nothing about the show is known. */
  hasView: boolean;
  /** No fresh data for more than STALE_AFTER_MS (DT-7). */
  stale: boolean;
  /** Server time at which the data went stale; null while fresh, or when the clock was not synced. */
  staleSince: number | null;
  synced: boolean;
  serverVersion: string | null;
  /** Last protocol problem, for diagnostics: invalid_message, invalid_view, rev_mismatch or a server error code. */
  problem: string | null;
}

/** What the React layer needs; LiveClient implements it, tests use a static store. */
export interface LiveStore<R extends ClientRole> {
  subscribe(listener: () => void): () => void;
  getSnapshot(): ClientSnapshot<R>;
  /** Estimated server wall time, or null before the first clock sample. */
  serverNow(): number | null;
  sendCommand(command: ClientCommand): Promise<{ changed: boolean }>;
}

export interface LiveClientOptions<R extends ClientRole> {
  url: string;
  role: R;
  createSocket?: (url: string) => SocketLike;
  local?: () => number;
  scheduler?: Scheduler;
  random?: () => number;
  report?: (err: unknown) => void;
}

export class CommandError extends Error {
  constructor(
    readonly code: ErrorCode | 'timeout' | 'disconnected',
    message: string,
  ) {
    super(message);
    this.name = 'CommandError';
  }
}

interface Pending {
  resolve: (result: { changed: boolean }) => void;
  reject: (err: CommandError) => void;
  cancel: () => void;
}

export class LiveClient<R extends ClientRole> implements LiveStore<R> {
  readonly clock: ClockSync;
  private readonly createSocket: (url: string) => SocketLike;
  private readonly local: () => number;
  private readonly scheduler: Scheduler;
  private readonly random: () => number;
  private readonly report: (err: unknown) => void;
  private snap: ClientSnapshot<R> = {
    connection: 'connecting',
    view: null,
    hasView: false,
    stale: true,
    staleSince: null,
    synced: false,
    serverVersion: null,
    problem: null,
  };
  private readonly listeners = new Set<() => void>();
  private readonly pending = new Map<string, Pending>();
  private socket: SocketLike | null = null;
  private welcomed = false;
  private viewSinceWelcome = false;
  private latestViewValid = true;
  private lastRev = 0;
  private lastFreshAt: number | null = null;
  private instanceId: string | null = null;
  private failures = 0;
  private started = false;
  private stopped = false;
  private nextId = 1;
  private connTimers: Array<() => void> = [];
  private pingTimer: (() => void) | null = null;
  private reconnectTimer: (() => void) | null = null;
  private staleTimer: (() => void) | null = null;

  constructor(private readonly opts: LiveClientOptions<R>) {
    this.createSocket = opts.createSocket ?? ((url) => new WebSocket(url) as unknown as SocketLike);
    this.local = opts.local ?? monotonicNow;
    this.scheduler = opts.scheduler ?? browserScheduler;
    this.random = opts.random ?? Math.random;
    this.report = opts.report ?? ((err) => console.error(err));
    this.clock = new ClockSync(this.local);
  }

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  readonly getSnapshot = (): ClientSnapshot<R> => this.snap;

  readonly serverNow = (): number | null => (this.clock.synced ? this.clock.now() : null);

  start(): void {
    if (this.started) return;
    this.started = true;
    this.checkStale();
    this.connect();
  }

  stop(): void {
    this.stopped = true;
    this.reconnectTimer?.();
    this.reconnectTimer = null;
    this.staleTimer?.();
    this.staleTimer = null;
    this.clearConnectionTimers();
    const socket = this.socket;
    this.socket = null;
    if (socket !== null) {
      socket.onopen = null;
      socket.onmessage = null;
      socket.onclose = null;
      socket.onerror = null;
      try {
        socket.close(1000, 'client stopped');
      } catch (err) {
        this.report(err);
      }
    }
    this.rejectPending('disconnected');
  }

  sendCommand(command: ClientCommand): Promise<{ changed: boolean }> {
    const socket = this.socket;
    if (socket === null || socket.readyState !== OPEN || !this.welcomed) {
      return Promise.reject(new CommandError('disconnected', 'Not connected to the server'));
    }
    const id = `c${this.nextId++}`;
    return new Promise((resolve, reject) => {
      const cancel = this.scheduler.setTimeout(() => {
        this.pending.delete(id);
        reject(new CommandError('timeout', 'No answer from the server'));
      }, COMMAND_TIMEOUT_MS);
      this.pending.set(id, { resolve, reject, cancel });
      this.send({ type: 'command', id, command });
    });
  }

  private connect(): void {
    this.reconnectTimer = null;
    if (this.stopped) return;
    let socket: SocketLike;
    try {
      socket = this.createSocket(this.opts.url);
    } catch (err) {
      this.report(err);
      this.scheduleReconnect();
      return;
    }
    this.socket = socket;
    this.welcomed = false;
    this.viewSinceWelcome = false;
    socket.onopen = () => this.send({ type: 'hello', role: this.opts.role, protocol: PROTOCOL_VERSION });
    socket.onmessage = (ev) => this.onMessage(ev.data);
    socket.onerror = () => {}; // a close event always follows
    socket.onclose = (ev) => this.onClose(socket, ev.code);
  }

  private onClose(socket: SocketLike, code: number): void {
    if (socket !== this.socket) return;
    this.socket = null;
    this.welcomed = false;
    // Every close drops the clock estimate: after a suspend an old minimum-RTT sample can survive and show a wrong
    // offset as if it were fresh. serverNow() returns null until fresh pongs arrive on the new connection.
    this.clock.reset();
    this.clearConnectionTimers();
    this.rejectPending('disconnected');
    if (this.stopped || this.snap.connection === 'incompatible') return;
    if (code === CLOSE_PROTOCOL_MISMATCH) {
      this.update({ connection: 'incompatible' });
      return;
    }
    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    const delay = reconnectDelay(this.failures, this.random);
    this.failures += 1;
    this.update({ connection: 'reconnecting' });
    this.reconnectTimer = this.scheduler.setTimeout(() => this.connect(), delay);
  }

  private onMessage(data: unknown): void {
    let raw: unknown;
    try {
      raw = JSON.parse(String(data));
    } catch {
      this.update({ problem: 'invalid_message' });
      return;
    }
    const parsed = ServerMessageSchema.safeParse(raw);
    if (!parsed.success) {
      this.update({ problem: 'invalid_message' });
      return;
    }
    const msg = parsed.data;
    switch (msg.type) {
      case 'welcome':
        this.onWelcome(msg.serverVersion, msg.instanceId, msg.protocol);
        return;
      case 'view':
        this.onView(msg.rev, msg.role, msg.view);
        return;
      case 'heartbeat':
        this.onHeartbeat(msg.rev);
        return;
      case 'time.pong':
        if (this.clock.addPong(msg.t0, msg.serverWall)) this.update({ synced: true });
        return;
      case 'ack':
        this.take(msg.id)?.resolve({ changed: msg.changed });
        return;
      case 'error': {
        if (msg.code === 'protocol_mismatch') {
          this.update({ connection: 'incompatible', problem: msg.code });
          try {
            this.socket?.close(CLOSE_PROTOCOL_MISMATCH, 'protocol_mismatch');
          } catch (err) {
            this.report(err);
          }
          return;
        }
        const pending = msg.id === null ? undefined : this.take(msg.id);
        if (pending !== undefined) pending.reject(new CommandError(msg.code, msg.message));
        else this.update({ problem: msg.code });
        return;
      }
    }
  }

  private onWelcome(serverVersion: string, instanceId: string, protocol: number): void {
    const socket = this.socket;
    if (socket === null) return;
    if (protocol !== PROTOCOL_VERSION) {
      this.update({ connection: 'incompatible', problem: 'protocol_mismatch' });
      try {
        socket.close(CLOSE_PROTOCOL_MISMATCH, 'protocol_mismatch');
      } catch (err) {
        this.report(err);
      }
      return;
    }
    // Another server process may run on another clock: its old offset must not be trusted.
    if (this.instanceId !== null && this.instanceId !== instanceId) this.clock.reset();
    this.instanceId = instanceId;
    this.welcomed = true;
    this.viewSinceWelcome = false;
    this.lastRev = 0;
    // A second welcome on one connection must replace the timers, never run a second ping loop.
    this.clearConnectionTimers();
    this.update({ connection: 'open', serverVersion, synced: this.clock.synced });
    this.ping();
    for (let i = 1; i < PING_BURST; i++) {
      this.connTimers.push(this.scheduler.setTimeout(() => this.ping(), i * PING_BURST_GAP_MS));
    }
    this.schedulePingLoop();
    this.connTimers.push(
      this.scheduler.setTimeout(() => {
        this.failures = 0;
      }, STABLE_CONNECTION_MS),
    );
  }

  private onView(rev: number, role: ClientRole, raw: unknown): void {
    if (role !== this.opts.role) {
      this.update({ problem: 'invalid_view' });
      return;
    }
    this.lastRev = rev; // processed, even if invalid: a heartbeat for this rev is not a resync
    const parsed = parseView(this.opts.role, raw);
    if (!parsed.ok) {
      this.latestViewValid = false;
      this.report(new Error(`Invalid ${role} view: ${parsed.error}`));
      this.update({ problem: 'invalid_view' });
      return;
    }
    this.latestViewValid = true;
    this.viewSinceWelcome = true;
    this.markFresh({ view: parsed.view, hasView: true });
  }

  private onHeartbeat(rev: number): void {
    if (!this.viewSinceWelcome) return;
    if (rev !== this.lastRev) {
      // The server sent a view this client never processed: resynchronise on a fresh connection.
      this.update({ problem: 'rev_mismatch' });
      try {
        this.socket?.close(CLOSE_RESYNC, 'resync');
      } catch (err) {
        this.report(err);
      }
      return;
    }
    if (this.latestViewValid) this.markFresh({});
  }

  private markFresh(patch: Partial<ClientSnapshot<R>>): void {
    this.lastFreshAt = this.local();
    this.update(this.snap.stale ? { ...patch, stale: false, staleSince: null } : patch);
  }

  private checkStale(): void {
    this.staleTimer = this.scheduler.setTimeout(() => this.checkStale(), STALE_CHECK_MS);
    const last = this.lastFreshAt;
    if (this.snap.stale || last === null) return;
    if (this.local() - last <= STALE_AFTER_MS) return;
    const sample = this.clock.sample;
    this.update({ stale: true, staleSince: sample === null ? null : last + STALE_AFTER_MS + sample.offsetMs });
  }

  private ping(): void {
    this.send({ type: 'time.ping', t0: this.local() });
  }

  private schedulePingLoop(): void {
    this.pingTimer = this.scheduler.setTimeout(() => {
      this.ping();
      this.schedulePingLoop();
    }, PING_INTERVAL_MS);
  }

  private clearConnectionTimers(): void {
    for (const cancel of this.connTimers) cancel();
    this.connTimers = [];
    this.pingTimer?.();
    this.pingTimer = null;
  }

  private send(msg: ClientMessage): void {
    const socket = this.socket;
    if (socket === null || socket.readyState !== OPEN) return;
    try {
      socket.send(JSON.stringify(msg));
    } catch (err) {
      this.report(err);
    }
  }

  private take(id: string): Pending | undefined {
    const pending = this.pending.get(id);
    if (pending === undefined) return undefined;
    this.pending.delete(id);
    pending.cancel();
    return pending;
  }

  private rejectPending(code: 'disconnected'): void {
    const all = [...this.pending.values()];
    this.pending.clear();
    for (const p of all) {
      p.cancel();
      p.reject(new CommandError(code, 'The connection to the server was lost'));
    }
  }

  private update(patch: Partial<ClientSnapshot<R>>): void {
    const keys = Object.keys(patch) as Array<keyof ClientSnapshot<R>>;
    if (keys.every((k) => Object.is(this.snap[k], patch[k]))) return;
    this.snap = { ...this.snap, ...patch };
    for (const fn of [...this.listeners]) {
      try {
        fn();
      } catch (err) {
        this.report(err);
      }
    }
  }
}
