# Plan 2 — Server Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the pure live engine into a running local server. Scope:
- JSON/JSONL persistence;
- a live runtime that owns the state, schedules ticks, persists and resumes after a restart;
- a clock and scheduler abstraction;
- the HTTP API (formats, episodes, live control, public message endpoint);
- a WebSocket hub (hello/welcome, role views, heartbeat, time sync, commands);
- the bootstrap (settings, data dir, single-instance lock, secret token).

**Architecture:**
- `LiveRuntime` is the only owner of `LiveState`. Every input goes through `reduce` from Plan 1.
- The runtime appends each accepted input to a JSONL journal and rewrites a snapshot atomically.
- It schedules the next `Tick` from `nextTickAt` and notifies subscribers.
- HTTP and WebSocket are thin adapters over the runtime.
- Time comes from an injected `Clock` and `Scheduler`, so every test is deterministic with `FakeTime`.
- OBS adapters and the simulator come in Plan 3. In this plan, tests drive the runtime by dispatching engine inputs directly.

**Tech Stack:** Node.js 24 · TypeScript 5.9 strict · Fastify 5 + @fastify/websocket 11 · zod 4 · Vitest 3 · ws 8 (test client) · tsx (dev run).

**Spec:** [docs/SPEC.md](../../SPEC.md) · [docs/TECH-DESIGN.md](../../TECH-DESIGN.md) §4.1, §5.7, §6, §7, §10 · [docs/DECISIONS.md](../../DECISIONS.md) DT-5, DT-6, DT-7, DT-8 · [docs/BACKLOG.md](../../BACKLOG.md)

**Roadmap (updated):**

| Plan | Scope |
|---|---|
| 1 ✅ | Monorepo, shared model, validation, live engine, projection |
| **2 (this)** | Server core: persistence, runtime, clock, HTTP API, WebSocket hub, bootstrap |
| 3 | OBS integration: obs-websocket connection, OBS + Playlist Deck adapters, SceneGraph, `tools/obs-sim`, Check OBS, playlist import, internal credential endpoint (DT-5) |
| 4 | Web: presenter monitor, dock, control view |
| 5 | Web: editor (timeline, undo/redo, import, validation) |
| 6 | Plugin C++ (launcher, credentials, dock, hotkeys, screens) + kiosk |
| 7 | Installers, packaging (bundle), release pipeline, manual test plan |

---

## Execution model (agents)

This follows the user's standing instruction: **Opus 5.5 coordinates**, and **Sonnet or Haiku implement** the elementary tasks. Reviews are Sonnet per task, Opus on the tricky tasks and for the final whole-branch review.

| Task | Implementer | Reviewer | Why |
|---|---|---|---|
| 1 Dependencies + shared protocol | Haiku | Sonnet | Schemas copied verbatim |
| 2 Clock & scheduler | Haiku | Sonnet | Small, fully specified |
| 3 JSON persistence + repository | Sonnet | Sonnet | Path-safety logic |
| 4 App basics (paths, settings, secret, lock) | Sonnet | Sonnet | OS-dependent behaviour |
| 5 Journal + snapshot store | Sonnet | Sonnet | Crash-safety logic |
| 6 Engine control view | Sonnet | Sonnet | Pure projection |
| 7 Live runtime | Sonnet | **Opus** | Scheduling, persistence ordering, resume |
| 8 HTTP API | Sonnet | Sonnet | Many routes, mechanical |
| 9 WebSocket hub | Sonnet | **Opus** | Protocol and broadcast semantics |
| 10 Bootstrap + end-to-end | Sonnet | Sonnet | Integration |

Final whole-branch review: **Opus**. If an implementer fails twice, a more capable model takes the task over.

---

## Global Constraints

- Node.js `>=24`, pnpm, ESM. TypeScript `strict: true`, `moduleResolution: "Bundler"`, typecheck with `noEmit`.
- License GPL-2.0-or-later. Every new source file starts with `// SPDX-License-Identifier: GPL-2.0-or-later`. Runtime dependencies must be MIT/BSD/ISC: fastify, @fastify/websocket, zod and ws are all MIT.
- `server/src/engine/**` stays **pure**: no `Date.now()`, timers or I/O. Only code outside `engine/` may touch the clock, timers and the filesystem, and it gets time only through the injected `Clock`/`Scheduler` (except atomic-write temp names, which use `randomUUID`).
- The system never invents information. Views sent to clients are the engine projections, unmodified.
- Monotonic time is epoch-anchored (`performance.timeOrigin + performance.now()`), so persisted engine times stay meaningful across a restart. This replaces the "re-base on resume" idea of TECH-DESIGN §5.7, and Task 10 updates that section.
- The server listens on `127.0.0.1` unless `lanAccess` is enabled (NF3). Default port `4460`.
- Data directory (DT-6): `%APPDATA%/obs-live-clock` (Windows), `~/Library/Application Support/obs-live-clock` (macOS), `$XDG_CONFIG_HOME/obs-live-clock` or `~/.config/obs-live-clock` (Linux). The `OLC_DATA_DIR` environment variable overrides it.
- Document ids used as file names must match `^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$` and must not contain `..`.
- The WebSocket protocol version is `1`. A client with another version is refused with close code `4001`.
- All durations and times are integer milliseconds.
- Commit messages and PR descriptions contain **no AI attribution and no co-author trailers**. Do not push; the controller pushes.
- Extra tools are installed locally only (project dependencies or a local venv), never globally.

## Review Focus

These are the inputs the spec implies that are most likely to hurt a user. Each has a test in its owning task.

1. **Path traversal through ids.** An id like `../../x`, `a/b` or `..` must never reach the filesystem: 400 over HTTP, `InvalidIdError` in the repository. *Test: Task 3 "rejects unsafe ids", Task 8 "invalid id is 400".*
2. **A corrupt or foreign JSON file in the data directory.** Listing must skip it and report it instead of failing the whole list. A corrupt live snapshot must not stop the server: resume returns false and reports the error. *Tests: Task 3 "skips corrupt documents", Task 7 "corrupt snapshot does not block start".*
3. **Crash mid-write.** The journal's torn last line is skipped. Snapshots are written atomically, with no partial file visible. *Tests: Task 5 "skips a torn last line", Task 3 "leaves no temp files".*
4. **A WebSocket client that misbehaves:** malformed JSON, messages before `hello`, a wrong protocol version, commands with no episode loaded. Each gets a typed `error` and the server keeps running. *Tests: Task 9.*
5. **Server restart during a live show.** After the restart the runtime resumes the same episode, still live, with OBS marked lost (everything `estimated`) until Plan 3's adapter reconnects. *Tests: Task 7 "resume", Task 10 "restart mid-show".*

---

## File structure

```
shared/src/protocol/messages.ts      PROTOCOL_VERSION, ClientRole, ClientCommand, ClientMessage (zod), ServerMessage, ErrorCode
shared/test/protocol.test.ts
server/package.json                  + fastify, @fastify/websocket, zod; dev: ws, @types/ws, tsx; script "dev"
server/src/clock/clock.ts            Clock, Scheduler, systemClock, systemScheduler, FakeTime
server/src/persistence/json-file.ts  writeJsonAtomic, readJsonFile, readJson, isNotFound
server/src/persistence/repository.ts DocumentRepository<T>, InvalidIdError
server/src/persistence/journal.ts    LiveJournal (JSONL append-only), JournalEntry
server/src/persistence/snapshot-store.ts  SnapshotStore, LiveSnapshot
server/src/app/paths.ts              defaultDataDir, dataPaths
server/src/app/settings.ts           Settings, loadSettings, listenHost
server/src/app/secret.ts             ensureSecretToken
server/src/app/instance-lock.ts      acquireLock, InstanceLockedError, isProcessAlive
server/src/app/version.ts            APP_VERSION
server/src/engine/control-view.ts    controlView (pure), ControlView, RundownRow
server/src/runtime/commands.ts       commandToInput, WithoutAt
server/src/runtime/live-runtime.ts   LiveRuntime, NoEpisodeError, LiveRunningError
server/src/api/http.ts               registerHttp
server/src/api/ws.ts                 registerWs
server/src/app/server.ts             buildServer
server/src/app/main.ts               process entry (dev: pnpm --filter @olc/server dev)
server/test/**                       tests per module (+ test/support/ helpers)
```

---

### Task 1: Server dependencies + shared WebSocket protocol

**Files:**
- Modify: `server/package.json`
- Create: `shared/src/protocol/messages.ts`, `shared/test/protocol.test.ts`
- Modify: `shared/src/index.ts` (add export)

**Interfaces:**
- Produces (from `@olc/shared`): `PROTOCOL_VERSION = 1`, `ClientRole` (zod + type: `'presenter' | 'control'`), `ClientCommand` (zod + type), `ClientMessage` (zod + type), `ErrorCode`, `ServerMessage` (types).

- [ ] **Step 1: Add the server dependencies**

Replace `server/package.json` with:
```json
{
  "name": "@olc/server",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "license": "GPL-2.0-or-later",
  "scripts": {
    "typecheck": "tsc -p tsconfig.json",
    "dev": "tsx src/app/main.ts"
  },
  "dependencies": {
    "@fastify/websocket": "^11.3.0",
    "@olc/shared": "workspace:*",
    "fastify": "^5.12.0",
    "zod": "^4.1.0"
  },
  "devDependencies": {
    "@types/ws": "^8.18.0",
    "tsx": "^4.23.0",
    "ws": "^8.22.0"
  }
}
```
Run: `pnpm install`. Expected: the lockfile is updated with no errors.

- [ ] **Step 2: Write the failing test**

`shared/test/protocol.test.ts`:
```ts
// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import { ClientCommand, ClientMessage, PROTOCOL_VERSION } from '../src/index';

describe('ClientMessage', () => {
  it('accepts hello, time.ping and command', () => {
    expect(ClientMessage.safeParse({ type: 'hello', role: 'presenter', protocol: PROTOCOL_VERSION }).success).toBe(true);
    expect(ClientMessage.safeParse({ type: 'time.ping', t0: 123.5 }).success).toBe(true);
    expect(
      ClientMessage.safeParse({ type: 'command', id: 'c1', command: { name: 'goto', slot: 3 } }).success,
    ).toBe(true);
  });

  it('rejects unknown roles, types and empty command ids', () => {
    expect(ClientMessage.safeParse({ type: 'hello', role: 'admin', protocol: 1 }).success).toBe(false);
    expect(ClientMessage.safeParse({ type: 'shout' }).success).toBe(false);
    expect(ClientMessage.safeParse({ type: 'command', id: '', command: { name: 'next' } }).success).toBe(false);
  });
});

describe('ClientCommand', () => {
  it('validates arguments', () => {
    expect(ClientCommand.safeParse({ name: 'goto', slot: -1 }).success).toBe(false);
    expect(ClientCommand.safeParse({ name: 'adjust', deltaMs: 0 }).success).toBe(false);
    expect(ClientCommand.safeParse({ name: 'adjust', deltaMs: -30_000 }).success).toBe(true);
    expect(
      ClientCommand.safeParse({ name: 'send_message', text: 'STRINGI', dismiss: { kind: 'timeout', ms: 10_000 } }).success,
    ).toBe(true);
    expect(
      ClientCommand.safeParse({ name: 'send_message', text: 'STRINGI', dismiss: { kind: 'timeout', ms: 10 } }).success,
    ).toBe(false);
    expect(ClientCommand.safeParse({ name: 'resolve_decision', id: 1, choice: 'end' }).success).toBe(true);
  });
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `pnpm vitest run shared/test/protocol.test.ts`
Expected: FAIL. `ClientMessage` is not exported.

- [ ] **Step 4: Implement**

`shared/src/protocol/messages.ts`:
```ts
// SPDX-License-Identifier: GPL-2.0-or-later
import { z } from 'zod';
import { MessageDismiss } from '../model/format';

export const PROTOCOL_VERSION = 1;

export const ClientRole = z.enum(['presenter', 'control']);
export type ClientRole = z.infer<typeof ClientRole>;

export const ClientCommand = z.discriminatedUnion('name', [
  z.object({ name: z.literal('start_program') }),
  z.object({ name: z.literal('next') }),
  z.object({ name: z.literal('prev') }),
  z.object({ name: z.literal('goto'), slot: z.number().int().nonnegative() }),
  z.object({
    name: z.literal('adjust'),
    deltaMs: z.number().int().refine((v) => v !== 0, 'deltaMs must not be 0'),
  }),
  z.object({ name: z.literal('set_control'), control: z.enum(['auto', 'manual']) }),
  z.object({ name: z.literal('send_message'), text: z.string().min(1).max(200), dismiss: MessageDismiss }),
  z.object({ name: z.literal('clear_message') }),
  z.object({ name: z.literal('resolve_decision'), id: z.number().int().positive(), choice: z.string().min(1).max(40) }),
]);
export type ClientCommand = z.infer<typeof ClientCommand>;

export const ClientMessage = z.discriminatedUnion('type', [
  z.object({ type: z.literal('hello'), role: ClientRole, protocol: z.number().int() }),
  z.object({ type: z.literal('time.ping'), t0: z.number() }),
  z.object({ type: z.literal('command'), id: z.string().min(1).max(64), command: ClientCommand }),
]);
export type ClientMessage = z.infer<typeof ClientMessage>;

export type ErrorCode = 'invalid_message' | 'protocol_mismatch' | 'hello_required' | 'no_episode';

/** Messages the server sends. `view` is the engine projection for the client's role (typed in Plan 4). */
export type ServerMessage =
  | { type: 'welcome'; serverVersion: string; instanceId: string; protocol: number }
  | { type: 'view'; rev: number; role: ClientRole; view: unknown }
  | { type: 'heartbeat'; rev: number; serverWall: number }
  | { type: 'time.pong'; t0: number; serverWall: number }
  | { type: 'ack'; id: string }
  | { type: 'error'; id: string | null; code: ErrorCode; message: string };
```

Append to `shared/src/index.ts`:
```ts
export * from './protocol/messages';
```

- [ ] **Step 5: Run to verify it passes**

Run: `pnpm test && pnpm typecheck`
Expected: all tests PASS (132 existing + the new ones), and typecheck is clean.

- [ ] **Step 6: Commit**

```bash
git add server/package.json pnpm-lock.yaml shared
git commit -m "feat(shared): websocket protocol schemas; server dependencies"
```

---

### Task 2: Clock and scheduler

**Files:**
- Create: `server/src/clock/clock.ts`, `server/test/clock/clock.test.ts`

**Interfaces:**
- Produces: `interface Clock { now(): number; wall(): number }` (`now` is monotonic ms, epoch-anchored; `wall` is `Date.now()`), `interface Scheduler { setTimer(at: number, fn: () => void): () => void }` (fires at monotonic `at`, returns a cancel function), `systemClock: Clock`, `systemScheduler(clock: Clock): Scheduler`, `class FakeTime implements Clock, Scheduler` with `advance(ms)`, `pending` and public `mono`.

- [ ] **Step 1: Write the failing test**

`server/test/clock/clock.test.ts`:
```ts
// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import { FakeTime, systemClock, systemScheduler } from '../../src/clock/clock';

describe('FakeTime', () => {
  it('runs due timers in time order, with the clock at the timer time', () => {
    const t = new FakeTime(1_000);
    const seen: Array<[string, number]> = [];
    t.setTimer(1_500, () => seen.push(['b', t.now()]));
    t.setTimer(1_200, () => seen.push(['a', t.now()]));
    t.setTimer(5_000, () => seen.push(['c', t.now()]));
    t.advance(600);
    expect(seen).toEqual([['a', 1_200], ['b', 1_500]]);
    expect(t.now()).toBe(1_600);
    expect(t.pending).toBe(1);
  });

  it('cancels timers and fires timers scheduled by a timer', () => {
    const t = new FakeTime(0);
    const seen: number[] = [];
    const cancel = t.setTimer(10, () => seen.push(10));
    cancel();
    t.setTimer(20, () => t.setTimer(30, () => seen.push(30)));
    t.advance(100);
    expect(seen).toEqual([30]);
  });

  it('keeps wall and mono in a fixed relation', () => {
    const t = new FakeTime(1_000, 5_000);
    t.advance(250);
    expect(t.wall() - t.now()).toBe(5_000);
  });
});

describe('system clock and scheduler', () => {
  it('now() is epoch-anchored and monotonic', () => {
    const a = systemClock.now();
    const b = systemClock.now();
    expect(b).toBeGreaterThanOrEqual(a);
    expect(Math.abs(a - Date.now())).toBeLessThan(60_000);
  });

  it('fires a real timer and can cancel one', async () => {
    const scheduler = systemScheduler(systemClock);
    let cancelledRan = false;
    scheduler.setTimer(systemClock.now() + 5, () => (cancelledRan = true))();
    await new Promise<void>((resolve) => scheduler.setTimer(systemClock.now() + 10, resolve));
    expect(cancelledRan).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run server/test/clock`
Expected: FAIL. The module is missing.

- [ ] **Step 3: Implement**

`server/src/clock/clock.ts`:
```ts
// SPDX-License-Identifier: GPL-2.0-or-later

/** Time source. `now()` is monotonic ms anchored to the epoch, so persisted engine times survive a restart. */
export interface Clock {
  now(): number;
  wall(): number;
}

/** Fires `fn` once the monotonic clock reaches `at`. Returns a cancel function. */
export interface Scheduler {
  setTimer(at: number, fn: () => void): () => void;
}

export const systemClock: Clock = {
  now: () => performance.timeOrigin + performance.now(),
  wall: () => Date.now(),
};

export function systemScheduler(clock: Clock): Scheduler {
  return {
    setTimer(at, fn) {
      const handle = setTimeout(fn, Math.max(0, at - clock.now()));
      return () => clearTimeout(handle);
    },
  };
}

interface FakeTimer {
  id: number;
  at: number;
  fn: () => void;
}

/** Deterministic clock + scheduler for tests. */
export class FakeTime implements Clock, Scheduler {
  private timers: FakeTimer[] = [];
  private nextId = 1;

  constructor(
    public mono = 1_000_000,
    private readonly wallOffset = 1_789_999_000_000,
  ) {}

  now(): number {
    return this.mono;
  }

  wall(): number {
    return this.mono + this.wallOffset;
  }

  setTimer(at: number, fn: () => void): () => void {
    const id = this.nextId++;
    this.timers.push({ id, at, fn });
    return () => {
      this.timers = this.timers.filter((t) => t.id !== id);
    };
  }

  get pending(): number {
    return this.timers.length;
  }

  /** Moves time forward, firing due timers in order with the clock set to each timer's time. */
  advance(ms: number): void {
    const target = this.mono + ms;
    for (;;) {
      const due = this.timers
        .filter((t) => t.at <= target)
        .sort((a, b) => a.at - b.at || a.id - b.id)[0];
      if (due === undefined) break;
      this.timers = this.timers.filter((t) => t.id !== due.id);
      this.mono = Math.max(this.mono, due.at);
      due.fn();
    }
    this.mono = target;
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm vitest run server/test/clock && pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/clock server/test/clock
git commit -m "feat(server): clock and scheduler abstraction with deterministic fake"
```

---

### Task 3: JSON persistence and document repository

**Files:**
- Create: `server/src/persistence/json-file.ts`, `server/src/persistence/repository.ts`
- Create: `server/test/support/tmp.ts`, `server/test/persistence/repository.test.ts`

**Interfaces:**
- Produces:
  - `writeJsonAtomic(path, data): Promise<void>`
  - `readJsonFile(path): Promise<unknown | undefined>` (undefined when the file is missing)
  - `readJson<T>(path, schema): Promise<T | undefined>`
  - `isNotFound(err): boolean`
  - `class InvalidIdError extends Error { id }`
  - `class DocumentRepository<T extends { id: string }>` with `list()`, `get(id)`, `put(doc)`, `delete(id)`, constructed as `(dir, schema, onInvalid?)`
  - test helper `tempDir(): Promise<string>`

- [ ] **Step 1: Write the test helper and failing test**

`server/test/support/tmp.ts`:
```ts
// SPDX-License-Identifier: GPL-2.0-or-later
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export function tempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'olc-test-'));
}
```

`server/test/persistence/repository.test.ts`:
```ts
// SPDX-License-Identifier: GPL-2.0-or-later
import { readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Format } from '@olc/shared';
import { soloFutsalFormat } from '@olc/shared/testing';
import { DocumentRepository, InvalidIdError } from '../../src/persistence/repository';
import { tempDir } from '../support/tmp';

async function repo() {
  const dir = join(await tempDir(), 'formats');
  const invalid: string[] = [];
  return { dir, invalid, repo: new DocumentRepository(dir, Format, (d) => invalid.push(d.file)) };
}

describe('DocumentRepository', () => {
  it('stores, reads, lists and deletes documents', async () => {
    const { repo: r } = await repo();
    expect(await r.list()).toEqual([]);
    const f = soloFutsalFormat();
    await r.put(f);
    await r.put({ ...soloFutsalFormat(), id: 'another', name: 'Another' });
    expect(await r.get('solo-futsal')).toEqual(f);
    expect((await r.list()).map((d) => d.id)).toEqual(['another', 'solo-futsal']);
    expect(await r.delete('another')).toBe(true);
    expect(await r.delete('another')).toBe(false);
    expect(await r.get('another')).toBeUndefined();
  });

  it('rejects unsafe ids before touching the filesystem', async () => {
    const { repo: r } = await repo();
    for (const id of ['../escape', 'a/b', 'a\\b', '..', '', '.hidden', 'x'.repeat(101)]) {
      await expect(r.get(id)).rejects.toBeInstanceOf(InvalidIdError);
    }
    await expect(r.put({ ...soloFutsalFormat(), id: '../escape' })).rejects.toThrow();
  });

  it('rejects documents that do not match the schema', async () => {
    const { repo: r } = await repo();
    await expect(r.put({ ...soloFutsalFormat(), blocks: 'nope' } as never)).rejects.toThrow();
  });

  it('skips corrupt documents when listing and reports them', async () => {
    const { repo: r, dir, invalid } = await repo();
    await r.put(soloFutsalFormat());
    await writeFile(join(dir, 'broken.json'), '{ not json');
    await writeFile(join(dir, 'foreign.json'), JSON.stringify({ hello: 'world' }));
    expect((await r.list()).map((d) => d.id)).toEqual(['solo-futsal']);
    expect(invalid.sort()).toEqual(['broken.json', 'foreign.json']);
  });

  it('leaves no temp files behind', async () => {
    const { repo: r, dir } = await repo();
    await r.put(soloFutsalFormat());
    await r.put(soloFutsalFormat());
    expect(await readdir(dir)).toEqual(['solo-futsal.json']);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run server/test/persistence/repository.test.ts`
Expected: FAIL. The modules are missing.

- [ ] **Step 3: Implement**

`server/src/persistence/json-file.ts`:
```ts
// SPDX-License-Identifier: GPL-2.0-or-later
import { randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { z } from 'zod';

export function isNotFound(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: unknown }).code === 'ENOENT';
}

/** Writes JSON so that a crash never leaves a partial file: temp file, fsync, rename. */
export async function writeJsonAtomic(path: string, data: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.${randomUUID()}.tmp`;
  const handle = await open(tmp, 'w');
  try {
    await handle.writeFile(`${JSON.stringify(data, null, 2)}\n`, 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename(tmp, path);
}

export async function readJsonFile(path: string): Promise<unknown | undefined> {
  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch (err) {
    if (isNotFound(err)) return undefined;
    throw err;
  }
  return JSON.parse(raw) as unknown;
}

export async function readJson<T>(path: string, schema: z.ZodType<T>): Promise<T | undefined> {
  const data = await readJsonFile(path);
  return data === undefined ? undefined : schema.parse(data);
}
```

`server/src/persistence/repository.ts`:
```ts
// SPDX-License-Identifier: GPL-2.0-or-later
import { readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { z } from 'zod';
import { isNotFound, readJson, writeJsonAtomic } from './json-file';

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;

export class InvalidIdError extends Error {
  constructor(readonly id: string) {
    super(`Invalid document id "${id}"`);
    this.name = 'InvalidIdError';
  }
}

export interface InvalidDocument {
  file: string;
  error: string;
}

/** One JSON file per document, named `<id>.json`, in a single directory. */
export class DocumentRepository<T extends { id: string }> {
  constructor(
    private readonly dir: string,
    private readonly schema: z.ZodType<T>,
    private readonly onInvalid: (doc: InvalidDocument) => void = () => {},
  ) {}

  private file(id: string): string {
    if (!SAFE_ID.test(id) || id.includes('..')) throw new InvalidIdError(id);
    return join(this.dir, `${id}.json`);
  }

  async list(): Promise<T[]> {
    let names: string[];
    try {
      names = await readdir(this.dir);
    } catch (err) {
      if (isNotFound(err)) return [];
      throw err;
    }
    const docs: T[] = [];
    for (const name of names.filter((n) => n.endsWith('.json')).sort()) {
      try {
        const doc = await readJson(join(this.dir, name), this.schema);
        if (doc !== undefined) docs.push(doc);
      } catch (err) {
        this.onInvalid({ file: name, error: err instanceof Error ? err.message : String(err) });
      }
    }
    return docs;
  }

  async get(id: string): Promise<T | undefined> {
    return readJson(this.file(id), this.schema);
  }

  async put(doc: T): Promise<T> {
    const parsed = this.schema.parse(doc);
    await writeJsonAtomic(this.file(parsed.id), parsed);
    return parsed;
  }

  async delete(id: string): Promise<boolean> {
    try {
      await rm(this.file(id));
      return true;
    } catch (err) {
      if (isNotFound(err)) return false;
      throw err;
    }
  }
}
```

`list()` returns documents in file-name order. `another.json` sorts before `solo-futsal.json`, which is what the test expects.

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm vitest run server/test/persistence && pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/persistence server/test/persistence server/test/support
git commit -m "feat(server): atomic JSON files and a path-safe document repository"
```

---

### Task 4: App basics — data paths, settings, secret token, single-instance lock

**Files:**
- Create: `server/src/app/paths.ts`, `server/src/app/settings.ts`, `server/src/app/secret.ts`, `server/src/app/instance-lock.ts`, `server/src/app/version.ts`
- Create: `server/test/app/basics.test.ts`

**Interfaces:**
- Consumes: `readJson`, `isNotFound` (Task 3).
- Produces:
  - `defaultDataDir(env?, platform?, home?): string`
  - `dataPaths(root): DataPaths` with fields `root, settings, formats, episodes, live, snapshot, journal(id), secret, lock, runtime`
  - `Settings` (zod: `port` default 4460, `lanAccess` default false), `loadSettings(path)`, `listenHost(settings)`
  - `ensureSecretToken(path): Promise<string>`
  - `acquireLock(path, pid?, isAlive?): Promise<() => Promise<void>>`, `InstanceLockedError`, `isProcessAlive`
  - `APP_VERSION`

The secret token is the DT-5 shared secret. On Windows, `chmod` cannot restrict readers. Restricting the file ACL to the current user belongs to Plan 3, together with the credential endpoint that relies on it.

- [ ] **Step 1: Write the failing test**

`server/test/app/basics.test.ts`:
```ts
// SPDX-License-Identifier: GPL-2.0-or-later
import { readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { InstanceLockedError, acquireLock } from '../../src/app/instance-lock';
import { dataPaths, defaultDataDir } from '../../src/app/paths';
import { ensureSecretToken } from '../../src/app/secret';
import { listenHost, loadSettings } from '../../src/app/settings';
import { tempDir } from '../support/tmp';

describe('defaultDataDir', () => {
  it('honours OLC_DATA_DIR', () => {
    expect(defaultDataDir({ OLC_DATA_DIR: '/data/olc' }, 'linux', '/home/a')).toBe('/data/olc');
  });

  it('uses the platform conventions', () => {
    expect(defaultDataDir({ APPDATA: 'C:/Users/a/AppData/Roaming' }, 'win32', 'C:/Users/a')).toBe(
      join('C:/Users/a/AppData/Roaming', 'obs-live-clock'),
    );
    expect(defaultDataDir({}, 'darwin', '/Users/a')).toBe(join('/Users/a', 'Library', 'Application Support', 'obs-live-clock'));
    expect(defaultDataDir({ XDG_CONFIG_HOME: '/x' }, 'linux', '/home/a')).toBe(join('/x', 'obs-live-clock'));
    expect(defaultDataDir({}, 'linux', '/home/a')).toBe(join('/home/a', '.config', 'obs-live-clock'));
  });

  it('lays out the data directory as in DT-6', () => {
    const p = dataPaths('/r');
    expect(p.snapshot).toBe(join('/r', 'live', 'snapshot.json'));
    expect(p.journal('ep-1')).toBe(join('/r', 'live', 'ep-1.log.jsonl'));
    expect(p.formats).toBe(join('/r', 'formats'));
  });
});

describe('settings', () => {
  it('defaults to localhost:4460 when the file is missing', async () => {
    const s = await loadSettings(join(await tempDir(), 'settings.json'));
    expect(s).toEqual({ port: 4460, lanAccess: false });
    expect(listenHost(s)).toBe('127.0.0.1');
  });

  it('listens on all interfaces only when LAN access is enabled', async () => {
    const dir = await tempDir();
    await writeFile(join(dir, 'settings.json'), JSON.stringify({ lanAccess: true }));
    const s = await loadSettings(join(dir, 'settings.json'));
    expect(s.port).toBe(4460);
    expect(listenHost(s)).toBe('0.0.0.0');
  });

  it('rejects an invalid port', async () => {
    const dir = await tempDir();
    await writeFile(join(dir, 'settings.json'), JSON.stringify({ port: 70_000 }));
    await expect(loadSettings(join(dir, 'settings.json'))).rejects.toThrow();
  });
});

describe('ensureSecretToken', () => {
  it('creates a 256-bit hex token once and reuses it', async () => {
    const path = join(await tempDir(), 'secret.token');
    const a = await ensureSecretToken(path);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(await ensureSecretToken(path)).toBe(a);
  });

  it('replaces a malformed token', async () => {
    const path = join(await tempDir(), 'secret.token');
    await writeFile(path, 'short');
    expect(await ensureSecretToken(path)).toMatch(/^[0-9a-f]{64}$/);
  });

  it.skipIf(process.platform === 'win32')('is readable only by the owner (POSIX)', async () => {
    const path = join(await tempDir(), 'secret.token');
    await ensureSecretToken(path);
    expect((await stat(path)).mode & 0o777).toBe(0o600);
  });
});

describe('acquireLock', () => {
  it('writes the pid and releases only its own lock', async () => {
    const path = join(await tempDir(), 'instance.lock');
    const release = await acquireLock(path, 111, () => true);
    expect(await readFile(path, 'utf8')).toBe('111');
    await release();
    await expect(readFile(path, 'utf8')).rejects.toThrow();
  });

  it('refuses when another live instance holds the lock', async () => {
    const path = join(await tempDir(), 'instance.lock');
    await acquireLock(path, 111, () => true);
    await expect(acquireLock(path, 222, (pid) => pid === 111)).rejects.toBeInstanceOf(InstanceLockedError);
  });

  it('takes over a stale lock', async () => {
    const path = join(await tempDir(), 'instance.lock');
    await writeFile(path, '999');
    const release = await acquireLock(path, 222, () => false);
    expect(await readFile(path, 'utf8')).toBe('222');
    await release();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run server/test/app/basics.test.ts`
Expected: FAIL. The modules are missing.

- [ ] **Step 3: Implement**

`server/src/app/version.ts`:
```ts
// SPDX-License-Identifier: GPL-2.0-or-later
export const APP_VERSION = '0.1.0';
```

`server/src/app/paths.ts`:
```ts
// SPDX-License-Identifier: GPL-2.0-or-later
import { homedir } from 'node:os';
import { join } from 'node:path';

const APP_DIR = 'obs-live-clock';

export function defaultDataDir(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  home: string = homedir(),
): string {
  if (env.OLC_DATA_DIR) return env.OLC_DATA_DIR;
  if (platform === 'win32') return join(env.APPDATA ?? join(home, 'AppData', 'Roaming'), APP_DIR);
  if (platform === 'darwin') return join(home, 'Library', 'Application Support', APP_DIR);
  return join(env.XDG_CONFIG_HOME ?? join(home, '.config'), APP_DIR);
}

export interface DataPaths {
  root: string;
  settings: string;
  formats: string;
  episodes: string;
  live: string;
  snapshot: string;
  journal(episodeId: string): string;
  secret: string;
  lock: string;
  runtime: string;
}

export function dataPaths(root: string): DataPaths {
  return {
    root,
    settings: join(root, 'settings.json'),
    formats: join(root, 'formats'),
    episodes: join(root, 'episodes'),
    live: join(root, 'live'),
    snapshot: join(root, 'live', 'snapshot.json'),
    journal: (episodeId) => join(root, 'live', `${episodeId}.log.jsonl`),
    secret: join(root, 'secret.token'),
    lock: join(root, 'instance.lock'),
    runtime: join(root, 'runtime.json'),
  };
}
```

`server/src/app/settings.ts`:
```ts
// SPDX-License-Identifier: GPL-2.0-or-later
import { z } from 'zod';
import { readJson } from '../persistence/json-file';

export const Settings = z.object({
  port: z.number().int().min(1).max(65_535).default(4460),
  lanAccess: z.boolean().default(false),
});
export type Settings = z.infer<typeof Settings>;

export async function loadSettings(path: string): Promise<Settings> {
  return (await readJson(path, Settings)) ?? Settings.parse({});
}

/** NF3: localhost only unless LAN access is explicitly enabled. */
export function listenHost(settings: Settings): string {
  return settings.lanAccess ? '0.0.0.0' : '127.0.0.1';
}
```

`server/src/app/secret.ts`:
```ts
// SPDX-License-Identifier: GPL-2.0-or-later
import { randomBytes } from 'node:crypto';
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { isNotFound } from '../persistence/json-file';

const TOKEN = /^[0-9a-f]{64}$/;

/** DT-5 shared secret between plugin and app. Created once, owner-only on POSIX. */
export async function ensureSecretToken(path: string): Promise<string> {
  try {
    const existing = (await readFile(path, 'utf8')).trim();
    if (TOKEN.test(existing)) return existing;
  } catch (err) {
    if (!isNotFound(err)) throw err;
  }
  await mkdir(dirname(path), { recursive: true });
  const token = randomBytes(32).toString('hex');
  await writeFile(path, token, { mode: 0o600 });
  await chmod(path, 0o600);
  return token;
}
```

`server/src/app/instance-lock.ts`:
```ts
// SPDX-License-Identifier: GPL-2.0-or-later
import { open, readFile, rm, writeFile } from 'node:fs/promises';
import { isNotFound } from '../persistence/json-file';

export class InstanceLockedError extends Error {
  constructor(readonly pid: number) {
    super(`OBS Live Clock is already running (pid ${pid})`);
    this.name = 'InstanceLockedError';
  }
}

export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as { code?: unknown }).code === 'EPERM';
  }
}

/** One app instance per data directory. Returns a release function. */
export async function acquireLock(
  path: string,
  pid: number = process.pid,
  isAlive: (pid: number) => boolean = isProcessAlive,
): Promise<() => Promise<void>> {
  try {
    const handle = await open(path, 'wx');
    try {
      await handle.writeFile(String(pid));
    } finally {
      await handle.close();
    }
  } catch (err) {
    if ((err as { code?: unknown }).code !== 'EEXIST') throw err;
    const owner = Number.parseInt((await readFile(path, 'utf8')).trim(), 10);
    if (Number.isInteger(owner) && owner !== pid && isAlive(owner)) throw new InstanceLockedError(owner);
    await writeFile(path, String(pid));
  }
  return async () => {
    try {
      if ((await readFile(path, 'utf8')).trim() === String(pid)) await rm(path);
    } catch (err) {
      if (!isNotFound(err)) throw err;
    }
  };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm vitest run server/test/app && pnpm typecheck`
Expected: PASS. On Windows the POSIX-mode test is skipped.

- [ ] **Step 5: Commit**

```bash
git add server/src/app server/test/app
git commit -m "feat(server): data paths, settings, secret token and single-instance lock"
```

---

### Task 5: Live journal and snapshot store

**Files:**
- Create: `server/src/persistence/journal.ts`, `server/src/persistence/snapshot-store.ts`
- Create: `server/test/persistence/live-store.test.ts`

**Interfaces:**
- Consumes: `writeJsonAtomic`, `readJsonFile`, `isNotFound` (Task 3); `EngineInput`, `LiveState` (engine).
- Produces:
  - `interface JournalEntry { seq: number; wallAt: number; input: EngineInput }`
  - `class LiveJournal { constructor(path); append(input, wallAt): Promise<void>; readAll(): Promise<JournalEntry[]> }`. Appends are serialised; `seq` keeps increasing across instances.
  - `interface LiveSnapshot { schemaVersion: 1; episodeId: string; wallAt: number; state: LiveState }`
  - `class SnapshotStore { constructor(path); save(s); load(): Promise<LiveSnapshot | undefined>; clear() }`. `load` throws on unrecognised content.

- [ ] **Step 1: Write the failing test**

`server/test/persistence/live-store.test.ts`:
```ts
// SPDX-License-Identifier: GPL-2.0-or-later
import { appendFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { soloFutsalEpisode } from '@olc/shared/testing';
import { createLiveState } from '../../src/engine/index';
import { LiveJournal } from '../../src/persistence/journal';
import { SnapshotStore } from '../../src/persistence/snapshot-store';
import { tempDir } from '../support/tmp';

describe('LiveJournal', () => {
  it('appends entries in order with increasing seq', async () => {
    const j = new LiveJournal(join(await tempDir(), 'live', 'ep.log.jsonl'));
    await Promise.all([
      j.append({ type: 'SourceRestored', at: 1 }, 100),
      j.append({ type: 'Tick', at: 2 }, 200),
      j.append({ type: 'SourceLost', at: 3 }, 300),
    ]);
    expect((await j.readAll()).map((e) => [e.seq, e.input.type, e.wallAt])).toEqual([
      [1, 'SourceRestored', 100],
      [2, 'Tick', 200],
      [3, 'SourceLost', 300],
    ]);
  });

  it('continues the sequence after a restart', async () => {
    const path = join(await tempDir(), 'ep.log.jsonl');
    await new LiveJournal(path).append({ type: 'Tick', at: 1 }, 1);
    const second = new LiveJournal(path);
    await second.append({ type: 'Tick', at: 2 }, 2);
    expect((await second.readAll()).map((e) => e.seq)).toEqual([1, 2]);
  });

  it('skips a torn last line left by a crash', async () => {
    const path = join(await tempDir(), 'ep.log.jsonl');
    const j = new LiveJournal(path);
    await j.append({ type: 'Tick', at: 1 }, 1);
    await appendFile(path, '{"seq":2,"wallAt":2,"inp');
    expect(await j.readAll()).toHaveLength(1);
    await j.append({ type: 'Tick', at: 3 }, 3);
    expect((await j.readAll()).map((e) => e.seq)).toEqual([1, 2]);
  });

  it('is empty when the file does not exist', async () => {
    expect(await new LiveJournal(join(await tempDir(), 'none.jsonl')).readAll()).toEqual([]);
  });
});

describe('SnapshotStore', () => {
  it('saves, loads and clears the live snapshot', async () => {
    const store = new SnapshotStore(join(await tempDir(), 'live', 'snapshot.json'));
    expect(await store.load()).toBeUndefined();
    const state = createLiveState(soloFutsalEpisode());
    await store.save({ schemaVersion: 1, episodeId: state.episode.id, wallAt: 42, state });
    const loaded = await store.load();
    expect(loaded?.episodeId).toBe('ep-2026-10-12');
    expect(loaded?.state).toEqual(state);
    await store.clear();
    await store.clear();
    expect(await store.load()).toBeUndefined();
  });

  it('throws on unrecognised content', async () => {
    const path = join(await tempDir(), 'snapshot.json');
    await writeFile(path, JSON.stringify({ schemaVersion: 99 }));
    await expect(new SnapshotStore(path).load()).rejects.toThrow(/Unrecognised live snapshot/);
  });
});
```

In the torn-line test, the journal's seq counter was loaded before the torn write. The next append therefore takes seq 2, and the torn fragment and the new entry end up on the same physical line. `readAll` skips that merged line, so the parsed seq list is `[1, 2]` only if the new entry sits on a line of its own.

To make this robust, **`append` writes a leading newline whenever the file does not end with one**. The implementation below does this. Keep the test as written.

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run server/test/persistence/live-store.test.ts`
Expected: FAIL. The modules are missing.

- [ ] **Step 3: Implement**

`server/src/persistence/journal.ts`:
```ts
// SPDX-License-Identifier: GPL-2.0-or-later
import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { EngineInput } from '../engine/index';
import { isNotFound } from './json-file';

export interface JournalEntry {
  seq: number;
  wallAt: number;
  input: EngineInput;
}

/** Append-only JSONL log of every accepted engine input for one episode (DT-6). */
export class LiveJournal {
  private seq: number | null = null;
  private chain: Promise<void> = Promise.resolve();

  constructor(readonly path: string) {}

  append(input: EngineInput, wallAt: number): Promise<void> {
    const next = this.chain
      .catch(() => undefined)
      .then(async () => {
        const raw = await this.readRaw();
        if (this.seq === null) this.seq = parseEntries(raw).reduce((max, e) => Math.max(max, e.seq), 0);
        this.seq += 1;
        const lead = raw.length > 0 && !raw.endsWith('\n') ? '\n' : '';
        await mkdir(dirname(this.path), { recursive: true });
        await appendFile(this.path, `${lead}${JSON.stringify({ seq: this.seq, wallAt, input })}\n`, 'utf8');
      });
    this.chain = next;
    return next;
  }

  async readAll(): Promise<JournalEntry[]> {
    return parseEntries(await this.readRaw());
  }

  private async readRaw(): Promise<string> {
    try {
      return await readFile(this.path, 'utf8');
    } catch (err) {
      if (isNotFound(err)) return '';
      throw err;
    }
  }
}

function parseEntries(raw: string): JournalEntry[] {
  const entries: JournalEntry[] = [];
  for (const line of raw.split('\n')) {
    if (line.trim() === '') continue;
    try {
      entries.push(JSON.parse(line) as JournalEntry);
    } catch {
      // A torn line left by a crash mid-append: skip it.
    }
  }
  return entries;
}
```

`server/src/persistence/snapshot-store.ts`:
```ts
// SPDX-License-Identifier: GPL-2.0-or-later
import { rm } from 'node:fs/promises';
import type { LiveState } from '../engine/index';
import { isNotFound, readJsonFile, writeJsonAtomic } from './json-file';

export interface LiveSnapshot {
  schemaVersion: 1;
  episodeId: string;
  wallAt: number;
  state: LiveState;
}

function isLiveSnapshot(data: unknown): data is LiveSnapshot {
  if (typeof data !== 'object' || data === null) return false;
  const d = data as Record<string, unknown>;
  return d.schemaVersion === 1 && typeof d.episodeId === 'string' && typeof d.state === 'object' && d.state !== null;
}

/** The live state of the loaded episode, rewritten atomically after every change (resume after restart). */
export class SnapshotStore {
  constructor(readonly path: string) {}

  save(snapshot: LiveSnapshot): Promise<void> {
    return writeJsonAtomic(this.path, snapshot);
  }

  async load(): Promise<LiveSnapshot | undefined> {
    const data = await readJsonFile(this.path);
    if (data === undefined) return undefined;
    if (!isLiveSnapshot(data)) throw new Error(`Unrecognised live snapshot at ${this.path}`);
    return data;
  }

  async clear(): Promise<void> {
    try {
      await rm(this.path);
    } catch (err) {
      if (!isNotFound(err)) throw err;
    }
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm vitest run server/test/persistence && pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/persistence server/test/persistence
git commit -m "feat(server): append-only live journal and atomic live snapshot"
```

---

### Task 6: Engine control view (pure)

**Files:**
- Create: `server/src/engine/control-view.ts`
- Modify: `server/src/engine/index.ts` (export)
- Test: `server/test/engine/control-view.test.ts`

**Interfaces:**
- Consumes: `presenterView` (Plan 1), `slotDuration` (`engine/rundown.ts`), `LiveState`, `Decision`, `SlotKind`, `SlotStatus`, `Source`.
- Produces:
```ts
export interface RundownRow {
  slot: number; blockIndex: number; blockName: string; kind: SlotKind; title: string;
  status: SlotStatus; provisional: boolean;
  durationMs: number; durationSource: Source;
  startedAtWall: number | null; endedAtWall: number | null;
}
export interface ControlDecision {
  id: number; kind: Decision['kind']; atWall: number; defaultChoice: string; choice: string; confirmed: boolean;
}
export interface ControlView {
  episode: { id: string; name: string };
  presenter: PresenterView;
  control: 'auto' | 'manual';
  obs: 'ok' | 'lost';
  ambiguous: boolean;
  cursor: number;
  returnSlot: number | null;
  offScript: { scene: string; sinceWall: number } | null;
  decisions: ControlDecision[];
  rows: RundownRow[];
}
export function controlView(s: LiveState, now: MonoMs, toWall: (mono: MonoMs) => number): ControlView;
```

The view carries data for the dock and the extended control view (SPEC §8): the rundown with the status of every element, planned and real times, off-script and decisions. Sources follow NF1: every duration is `estimated` while OBS is lost or the state is ambiguous.

- [ ] **Step 1: Write the failing test**

`server/test/engine/control-view.test.ts`:
```ts
// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import { controlView } from '../../src/engine/control-view';
import { T0, liveState, run } from '../helpers';

const toWall = (m: number) => 1_790_000_000_000 + m;

describe('controlView', () => {
  it('lists every slot with status, duration and wall times', () => {
    const v = controlView(liveState(), T0 + 1_000, toWall);
    expect(v.episode).toEqual({ id: 'ep-2026-10-12', name: 'Solo Futsal · 12/10/2026' });
    expect(v.rows).toHaveLength(8);
    expect(v.rows[0]).toEqual({
      slot: 0, blockIndex: 0, blockName: 'Primo blocco', kind: 'studio', title: 'Primo blocco',
      status: 'onair', provisional: false, durationMs: 0, durationSource: 'planned',
      startedAtWall: toWall(T0), endedAtWall: null,
    });
    expect(v.rows[1]).toMatchObject({ kind: 'media', title: 'Servizio 1', status: 'pending', durationMs: 185_000, durationSource: 'measured' });
    expect(v.rows[3]).toMatchObject({ kind: 'break', blockName: 'Break 1', durationMs: 180_000, durationSource: 'planned' });
    expect(v.cursor).toBe(0);
    expect(v.presenter.phase).toBe('live');
    expect(v).toMatchObject({ control: 'auto', obs: 'ok', ambiguous: false, returnSlot: null, offScript: null, decisions: [] });
  });

  it('exposes off-script and decisions in wall time', () => {
    const s = run(
      liveState(),
      { type: 'ProgramSceneChanged', at: T0 + 30_000, scene: 'CAMERA OSPITE', deckOnProgram: false },
      { type: 'OutputChanged', at: T0 + 60_000, output: 'rec', state: 'stopped' },
    );
    const v = controlView(s, T0 + 61_000, toWall);
    expect(v.offScript).toEqual({ scene: 'CAMERA OSPITE', sinceWall: toWall(T0 + 30_000) });
    expect(v.decisions).toEqual([
      { id: 1, kind: 'all_outputs_stopped', atWall: toWall(T0 + 60_000), defaultChoice: 'interruption', choice: 'interruption', confirmed: false },
    ]);
  });

  it('marks durations estimated while OBS is lost', () => {
    const v = controlView(run(liveState(), { type: 'SourceLost', at: T0 + 1 }), T0 + 2, toWall);
    expect(v.obs).toBe('lost');
    expect(v.rows.every((r) => r.durationSource === 'estimated')).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run server/test/engine/control-view.test.ts`
Expected: FAIL. The module is missing.

- [ ] **Step 3: Implement**

`server/src/engine/control-view.ts`:
```ts
// SPDX-License-Identifier: GPL-2.0-or-later
import { presenterView, type PresenterView } from './projection';
import { slotDuration } from './rundown';
import type { Decision, LiveState, MonoMs, SlotKind, SlotStatus, Source } from './types';

export interface RundownRow {
  slot: number;
  blockIndex: number;
  blockName: string;
  kind: SlotKind;
  title: string;
  status: SlotStatus;
  provisional: boolean;
  durationMs: number;
  durationSource: Source;
  startedAtWall: number | null;
  endedAtWall: number | null;
}

export interface ControlDecision {
  id: number;
  kind: Decision['kind'];
  atWall: number;
  defaultChoice: string;
  choice: string;
  confirmed: boolean;
}

export interface ControlView {
  episode: { id: string; name: string };
  presenter: PresenterView;
  control: 'auto' | 'manual';
  obs: 'ok' | 'lost';
  ambiguous: boolean;
  cursor: number;
  returnSlot: number | null;
  offScript: { scene: string; sinceWall: number } | null;
  decisions: ControlDecision[];
  rows: RundownRow[];
}

/** Data for the dock and the extended control view (SPEC §8). Pure. */
export function controlView(s: LiveState, now: MonoMs, toWall: (mono: MonoMs) => number): ControlView {
  const degraded = s.obs === 'lost' || s.ambiguous;
  const wall = (m: MonoMs | null) => (m === null ? null : toWall(m));
  return {
    episode: { id: s.episode.id, name: s.episode.name },
    presenter: presenterView(s, now, toWall),
    control: s.control,
    obs: s.obs,
    ambiguous: s.ambiguous,
    cursor: s.cursor,
    returnSlot: s.returnSlot,
    offScript: s.offScript === null ? null : { scene: s.offScript.scene, sinceWall: toWall(s.offScript.since) },
    decisions: s.decisions.map((d) => ({
      id: d.id,
      kind: d.kind,
      atWall: toWall(d.at),
      defaultChoice: d.defaultChoice,
      choice: d.choice,
      confirmed: d.confirmed,
    })),
    rows: s.slots.map((slot) => {
      const rt = s.slotRt[slot.index]!;
      const d = slotDuration(s, slot);
      return {
        slot: slot.index,
        blockIndex: slot.blockIndex,
        blockName: s.episode.blocks[slot.blockIndex]!.name,
        kind: slot.kind,
        title: slot.title,
        status: rt.status,
        provisional: rt.provisional,
        durationMs: d.ms,
        durationSource: degraded ? 'estimated' : d.source,
        startedAtWall: wall(rt.startedAt),
        endedAtWall: wall(rt.endedAt),
      };
    }),
  };
}
```

Append to `server/src/engine/index.ts`:
```ts
export { controlView, type ControlDecision, type ControlView, type RundownRow } from './control-view';
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm vitest run server/test && pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/engine server/test/engine
git commit -m "feat(engine): control view with rundown rows, decisions and off-script"
```

---

### Task 7: Live runtime

**Files:**
- Create: `server/src/runtime/commands.ts`, `server/src/runtime/live-runtime.ts`
- Create: `server/test/support/runtime.ts`, `server/test/runtime/live-runtime.test.ts`

**Interfaces:**
- Consumes:
  - `Clock`, `Scheduler`, `FakeTime` (Task 2);
  - `LiveJournal`, `SnapshotStore` (Task 5);
  - the engine API (`createLiveState`, `reduce`, `nextTickAt`, `presenterView`, `controlView`, `EngineInput`, `Command`, `LiveState`, `PresenterView`, `ControlView`);
  - `ClientCommand`, `Episode` (shared).
- Produces:
  - `type WithoutAt<T>`, `commandToInput(c: ClientCommand): WithoutAt<Command>`;
  - `class NoEpisodeError`, `class LiveRunningError { episodeId }`;
  - `interface RuntimeDeps { clock; scheduler; snapshots; journalFor(episodeId): LiveJournal; onError?(err) }`;
  - `class LiveRuntime` with:
    - accessors: `episodeId`, `phase`, `getState()`, `isLive(id)`;
    - subscription: `subscribe(fn): () => void`, `toWall(mono)`;
    - lifecycle: `load(episode)`, `unload()`, `resume(): Promise<boolean>`, `flush()`, `dispose()`;
    - input: `dispatch(input: WithoutAt<EngineInput>): boolean`, `command(c): boolean`;
    - views: `presenterView()`, `controlView()`.

Rules:
- **`dispatch`** stamps `at = clock.now()` and runs `reduce`. When the state changed, it:
  1. queues a journal append of the stamped input, followed by a snapshot save (serialised persistence chain);
  2. reschedules the tick;
  3. notifies subscribers synchronously.
- **Tick scheduling.** Only one timer is pending at a time. It is set at `nextTickAt(state)` and, when it fires, dispatches `Tick`. If that `Tick` changes nothing, and `nextTickAt` is still due (≤ now), the runtime reports an error and does **not** reschedule, which prevents a busy loop. Otherwise it reschedules.
- **`load`** is refused with `LiveRunningError` while the loaded episode is live. It creates a fresh state, saves the snapshot, schedules and notifies.
- **`unload`** is refused while live. It clears the state and the snapshot.
- **`resume`** loads the snapshot. If there is none, or it is corrupt, it returns false; a corrupt snapshot is reported via `onError` (Review Focus 2). Otherwise it restores the state and journal, dispatches `SourceLost` (OBS is unknown until Plan 3's adapter reconnects), schedules, notifies and returns true.
- **`command`** throws `NoEpisodeError` when nothing is loaded.
- **Persistence failures** go to `onError` (default `console.error`) and never throw into `dispatch`.

- [ ] **Step 1: Write the test support and failing test**

`server/test/support/runtime.ts`:
```ts
// SPDX-License-Identifier: GPL-2.0-or-later
import { join } from 'node:path';
import { FakeTime } from '../../src/clock/clock';
import { LiveJournal } from '../../src/persistence/journal';
import { SnapshotStore } from '../../src/persistence/snapshot-store';
import { LiveRuntime } from '../../src/runtime/live-runtime';

export interface RuntimeHarness {
  dir: string;
  time: FakeTime;
  errors: unknown[];
  runtime: LiveRuntime;
  /** A second runtime on the same data dir and clock: a restart. */
  restart(): LiveRuntime;
}

export function makeRuntime(dir: string, time = new FakeTime()): RuntimeHarness {
  const errors: unknown[] = [];
  const build = () =>
    new LiveRuntime({
      clock: time,
      scheduler: time,
      snapshots: new SnapshotStore(join(dir, 'live', 'snapshot.json')),
      journalFor: (id) => new LiveJournal(join(dir, 'live', `${id}.log.jsonl`)),
      onError: (err) => errors.push(err),
    });
  return { dir, time, errors, runtime: build(), restart: build };
}
```

`server/test/runtime/live-runtime.test.ts`:
```ts
// SPDX-License-Identifier: GPL-2.0-or-later
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SOLO_FUTSAL_DECK, soloFutsalEpisode } from '@olc/shared/testing';
import { LiveJournal } from '../../src/persistence/journal';
import { commandToInput } from '../../src/runtime/commands';
import { LiveRunningError, NoEpisodeError } from '../../src/runtime/live-runtime';
import { makeRuntime } from '../support/runtime';
import { tempDir } from '../support/tmp';

async function liveHarness() {
  const h = makeRuntime(await tempDir());
  await h.runtime.load(soloFutsalEpisode());
  h.runtime.dispatch({ type: 'SourceRestored' });
  h.runtime.dispatch({ type: 'DeckPlaylistChanged', items: SOLO_FUTSAL_DECK.map((i) => ({ ...i })) });
  h.runtime.dispatch({ type: 'ProgramSceneChanged', scene: 'CAM 1', deckOnProgram: false });
  h.runtime.dispatch({ type: 'OutputChanged', output: 'rec', state: 'started' });
  await h.runtime.flush();
  return h;
}

describe('commandToInput', () => {
  it('maps every client command to an engine command', () => {
    expect(commandToInput({ name: 'goto', slot: 4 })).toEqual({ type: 'Goto', slot: 4 });
    expect(commandToInput({ name: 'adjust', deltaMs: 30_000 })).toEqual({ type: 'Adjust', deltaMs: 30_000 });
    expect(commandToInput({ name: 'set_control', control: 'manual' })).toEqual({ type: 'SetControl', control: 'manual' });
    expect(commandToInput({ name: 'resolve_decision', id: 2, choice: 'end' })).toEqual({ type: 'ResolveDecision', id: 2, choice: 'end' });
    expect(commandToInput({ name: 'start_program' })).toEqual({ type: 'StartProgram' });
  });
});

describe('LiveRuntime', () => {
  it('loads an episode in preshow and saves a snapshot', async () => {
    const h = makeRuntime(await tempDir());
    let notified = 0;
    h.runtime.subscribe(() => notified++);
    await h.runtime.load(soloFutsalEpisode());
    expect(h.runtime.episodeId).toBe('ep-2026-10-12');
    expect(h.runtime.phase).toBe('preshow');
    expect(h.runtime.presenterView()?.phase).toBe('preshow');
    expect(notified).toBe(1);
    const snap = JSON.parse(await readFile(join(h.dir, 'live', 'snapshot.json'), 'utf8'));
    expect(snap).toMatchObject({ schemaVersion: 1, episodeId: 'ep-2026-10-12' });
  });

  it('stamps inputs with the clock, journals them and keeps the snapshot current', async () => {
    const h = await liveHarness();
    expect(h.runtime.phase).toBe('live');
    expect(h.runtime.getState()?.t0).toBe(h.time.now());
    const entries = await new LiveJournal(join(h.dir, 'live', 'ep-2026-10-12.log.jsonl')).readAll();
    expect(entries.map((e) => e.input.type)).toEqual(['SourceRestored', 'DeckPlaylistChanged', 'ProgramSceneChanged', 'OutputChanged']);
    expect(entries[3]!.input.at).toBe(h.time.now());
    const snap = JSON.parse(await readFile(join(h.dir, 'live', 'snapshot.json'), 'utf8'));
    expect(snap.state.phase).toBe('live');
  });

  it('returns false and neither journals nor notifies when nothing changed', async () => {
    const h = await liveHarness();
    let notified = 0;
    h.runtime.subscribe(() => notified++);
    expect(h.runtime.dispatch({ type: 'SourceRestored' })).toBe(false);
    await h.runtime.flush();
    expect(notified).toBe(0);
    const entries = await new LiveJournal(join(h.dir, 'live', 'ep-2026-10-12.log.jsonl')).readAll();
    expect(entries).toHaveLength(4);
  });

  it('refuses to load or unload while live', async () => {
    const h = await liveHarness();
    await expect(h.runtime.load(soloFutsalEpisode())).rejects.toBeInstanceOf(LiveRunningError);
    await expect(h.runtime.unload()).rejects.toBeInstanceOf(LiveRunningError);
    expect(h.runtime.isLive('ep-2026-10-12')).toBe(true);
  });

  it('fires scheduled ticks: a timeout message clears itself', async () => {
    const h = await liveHarness();
    h.runtime.command({ name: 'send_message', text: 'STRINGI', dismiss: { kind: 'timeout', ms: 10_000 } });
    expect(h.runtime.presenterView()?.message).toEqual({ text: 'STRINGI' });
    h.time.advance(9_999);
    expect(h.runtime.presenterView()?.message).toEqual({ text: 'STRINGI' });
    h.time.advance(1);
    expect(h.runtime.presenterView()?.message).toBeNull();
  });

  it('keeps counting on the plan when OBS is lost (estimated hand-over by tick)', async () => {
    const h = await liveHarness();
    h.runtime.dispatch({ type: 'SourceLost' });
    h.time.advance(720_000);
    expect(h.runtime.getState()?.cursor).toBe(3);
    expect(h.runtime.presenterView()?.segment).toBe('break');
  });

  it('command throws when no episode is loaded', async () => {
    const h = makeRuntime(await tempDir());
    expect(() => h.runtime.command({ name: 'next' })).toThrow(NoEpisodeError);
    expect(h.runtime.dispatch({ type: 'Tick' })).toBe(false);
  });

  it('resume: a restart mid-show continues live with OBS lost', async () => {
    const h = await liveHarness();
    h.time.advance(60_000);
    const restarted = h.restart();
    expect(await restarted.resume()).toBe(true);
    expect(restarted.phase).toBe('live');
    expect(restarted.getState()?.obs).toBe('lost');
    const block = restarted.presenterView()?.block;
    expect(block?.index).toBe(0);
    expect(block?.anchor).toMatchObject({ kind: 'countdown', source: 'estimated' });
  });

  it('unload clears the snapshot, so a restart resumes nothing', async () => {
    const h = makeRuntime(await tempDir());
    await h.runtime.load(soloFutsalEpisode());
    await h.runtime.unload();
    expect(h.runtime.episodeId).toBeNull();
    expect(await h.restart().resume()).toBe(false);
  });

  it('corrupt snapshot does not block start: resume returns false and reports', async () => {
    const h = makeRuntime(await tempDir());
    await h.runtime.load(soloFutsalEpisode());
    await writeFile(join(h.dir, 'live', 'snapshot.json'), '{ broken');
    const restarted = h.restart();
    expect(await restarted.resume()).toBe(false);
    expect(h.errors).toHaveLength(1);
  });

  it('dispose cancels the pending tick', async () => {
    const h = await liveHarness();
    h.runtime.dispatch({ type: 'SourceLost' });
    expect(h.time.pending).toBe(1);
    h.runtime.dispose();
    expect(h.time.pending).toBe(0);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run server/test/runtime`
Expected: FAIL. The modules are missing.

- [ ] **Step 3: Implement**

`server/src/runtime/commands.ts`:
```ts
// SPDX-License-Identifier: GPL-2.0-or-later
import type { ClientCommand } from '@olc/shared';
import type { Command } from '../engine/index';

/** An engine input before the runtime stamps its time. */
export type WithoutAt<T> = T extends unknown ? Omit<T, 'at'> : never;

export function commandToInput(c: ClientCommand): WithoutAt<Command> {
  switch (c.name) {
    case 'start_program':
      return { type: 'StartProgram' };
    case 'next':
      return { type: 'Next' };
    case 'prev':
      return { type: 'Prev' };
    case 'goto':
      return { type: 'Goto', slot: c.slot };
    case 'adjust':
      return { type: 'Adjust', deltaMs: c.deltaMs };
    case 'set_control':
      return { type: 'SetControl', control: c.control };
    case 'send_message':
      return { type: 'SendMessage', text: c.text, dismiss: c.dismiss };
    case 'clear_message':
      return { type: 'ClearMessage' };
    case 'resolve_decision':
      return { type: 'ResolveDecision', id: c.id, choice: c.choice };
  }
}
```

`server/src/runtime/live-runtime.ts`:
```ts
// SPDX-License-Identifier: GPL-2.0-or-later
import type { ClientCommand, Episode } from '@olc/shared';
import type { Clock, Scheduler } from '../clock/clock';
import {
  controlView,
  createLiveState,
  nextTickAt,
  presenterView,
  reduce,
  type ControlView,
  type EngineInput,
  type LiveState,
  type PresenterView,
} from '../engine/index';
import type { LiveJournal } from '../persistence/journal';
import type { SnapshotStore } from '../persistence/snapshot-store';
import { commandToInput, type WithoutAt } from './commands';

export class NoEpisodeError extends Error {
  constructor() {
    super('No episode is loaded');
    this.name = 'NoEpisodeError';
  }
}

export class LiveRunningError extends Error {
  constructor(readonly episodeId: string) {
    super(`Episode "${episodeId}" is live`);
    this.name = 'LiveRunningError';
  }
}

export interface RuntimeDeps {
  clock: Clock;
  scheduler: Scheduler;
  snapshots: SnapshotStore;
  journalFor(episodeId: string): LiveJournal;
  onError?(err: unknown): void;
}

/** Sole owner of the live state: stamps inputs, runs the engine, persists, schedules ticks, notifies. */
export class LiveRuntime {
  private state: LiveState | null = null;
  private journal: LiveJournal | null = null;
  private cancelTick: (() => void) | null = null;
  private readonly listeners = new Set<() => void>();
  private persisting: Promise<void> = Promise.resolve();

  constructor(private readonly deps: RuntimeDeps) {}

  readonly toWall = (mono: number): number => mono + (this.deps.clock.wall() - this.deps.clock.now());

  get episodeId(): string | null {
    return this.state?.episode.id ?? null;
  }

  get phase(): LiveState['phase'] | null {
    return this.state?.phase ?? null;
  }

  getState(): LiveState | null {
    return this.state;
  }

  isLive(episodeId: string): boolean {
    return this.state !== null && this.state.episode.id === episodeId && this.state.phase === 'live';
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  async load(episode: Episode): Promise<void> {
    if (this.state?.phase === 'live') throw new LiveRunningError(this.state.episode.id);
    this.state = createLiveState(episode);
    this.journal = this.deps.journalFor(episode.id);
    this.enqueue(() => this.saveSnapshot());
    this.reschedule();
    this.notify();
    await this.flush();
  }

  async unload(): Promise<void> {
    if (this.state?.phase === 'live') throw new LiveRunningError(this.state.episode.id);
    this.cancel();
    this.state = null;
    this.journal = null;
    this.enqueue(() => this.deps.snapshots.clear());
    this.notify();
    await this.flush();
  }

  async resume(): Promise<boolean> {
    let snapshot;
    try {
      snapshot = await this.deps.snapshots.load();
    } catch (err) {
      this.report(err);
      return false;
    }
    if (snapshot === undefined) return false;
    this.state = snapshot.state;
    this.journal = this.deps.journalFor(snapshot.episodeId);
    // OBS is unknown until the adapter reconnects: everything is estimated meanwhile.
    this.dispatch({ type: 'SourceLost' });
    this.reschedule();
    this.notify();
    return true;
  }

  dispatch(partial: WithoutAt<EngineInput>): boolean {
    if (this.state === null) return false;
    const input = { ...partial, at: this.deps.clock.now() } as EngineInput;
    const result = reduce(this.state, input);
    if (!result.changed) return false;
    this.state = result.state;
    const journal = this.journal;
    const wallAt = this.deps.clock.wall();
    this.enqueue(async () => {
      await journal?.append(input, wallAt);
      await this.saveSnapshot();
    });
    this.reschedule();
    this.notify();
    return true;
  }

  command(c: ClientCommand): boolean {
    if (this.state === null) throw new NoEpisodeError();
    return this.dispatch(commandToInput(c));
  }

  presenterView(): PresenterView | null {
    return this.state === null ? null : presenterView(this.state, this.deps.clock.now(), this.toWall);
  }

  controlView(): ControlView | null {
    return this.state === null ? null : controlView(this.state, this.deps.clock.now(), this.toWall);
  }

  /** Resolves once every queued persistence job has finished. */
  flush(): Promise<void> {
    return this.persisting;
  }

  dispose(): void {
    this.cancel();
    this.listeners.clear();
  }

  private saveSnapshot(): Promise<void> {
    const s = this.state;
    if (s === null) return Promise.resolve();
    return this.deps.snapshots.save({ schemaVersion: 1, episodeId: s.episode.id, wallAt: this.deps.clock.wall(), state: s });
  }

  private enqueue(job: () => Promise<void>): void {
    this.persisting = this.persisting.then(job).catch((err: unknown) => this.report(err));
  }

  private report(err: unknown): void {
    if (this.deps.onError) this.deps.onError(err);
    else console.error('[obs-live-clock]', err);
  }

  private cancel(): void {
    this.cancelTick?.();
    this.cancelTick = null;
  }

  private reschedule(): void {
    this.cancel();
    if (this.state === null) return;
    const at = nextTickAt(this.state);
    if (at === null) return;
    this.cancelTick = this.deps.scheduler.setTimer(at, () => {
      this.cancelTick = null;
      if (this.dispatch({ type: 'Tick' })) return;
      const due = this.state === null ? null : nextTickAt(this.state);
      if (due !== null && due <= this.deps.clock.now()) {
        this.report(new Error(`Tick due at ${due} changed nothing; not rescheduling`));
        return;
      }
      this.reschedule();
    });
  }

  private notify(): void {
    for (const fn of [...this.listeners]) fn();
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm vitest run server/test && pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/runtime server/test/runtime server/test/support
git commit -m "feat(server): live runtime with persistence, tick scheduling and resume"
```

---

### Task 8: HTTP API

**Files:**
- Create: `server/src/api/http.ts`, `server/test/support/http.ts`, `server/test/api/http.test.ts`

**Interfaces:**
- Consumes: `DocumentRepository`, `InvalidIdError` (Task 3); `LiveRuntime`, `NoEpisodeError`, `LiveRunningError` (Task 7); `Format`, `Episode`, `ClientCommand`, `MessageDismiss`, `createEpisode`, `validateRundown`, `PROTOCOL_VERSION` (shared).
- Produces: `interface HttpContext { formats: DocumentRepository<Format>; episodes: DocumentRepository<Episode>; runtime: LiveRuntime; version: string; instanceId: string }`, `registerHttp(app: FastifyInstance, ctx: HttpContext): void`.

Routes (TECH-DESIGN §7). Errors are JSON `{ error: <code> }`.

| Method & path | Success | Errors |
|---|---|---|
| `GET /api/health` | 200 `{ version, protocol, instanceId }` | |
| `GET /api/formats` | 200 `Format[]` | |
| `GET /api/formats/:id` | 200 `Format` | 404 `not_found`, 400 `invalid_id` |
| `POST /api/formats` | 201 `Format` | 400 `invalid_body`, 409 `exists` |
| `PUT /api/formats/:id` | 200 `Format` | 400 `id_mismatch` / `invalid_body` |
| `DELETE /api/formats/:id` | 204 | 404 |
| `POST /api/formats/:id/episodes` body `{ id, date, plannedStart, playlistName }` | 201 `Episode` | 404 format, 409 `exists` |
| `GET /api/episodes`, `GET /api/episodes/:id` | 200 | 404 |
| `PUT /api/episodes/:id` | 200 | 409 `episode_live` |
| `DELETE /api/episodes/:id` | 204 | 409 `episode_loaded` (loaded in the runtime), 404 |
| `POST /api/episodes/:id/validate` | 200 `{ issues }` | 404 |
| `POST /api/live/load` body `{ episodeId }` | 200 `{ episodeId }` | 404, 409 `live_running` |
| `POST /api/live/unload` | 204 | 409 `live_running` |
| `GET /api/live/view?role=presenter\|control` | 200 view | 404 `no_episode`, 400 `invalid_role` |
| `POST /api/live/command` body `ClientCommand` | 200 `{ changed }` | 409 `no_episode`, 400 |
| `POST /api/messages/send` body `{ presetId }` or `{ text, dismiss }` | 200 `{ changed }` | 404 `unknown_preset`, 409 `no_episode` |
| `POST /api/messages/clear` | 200 `{ changed }` | 409 `no_episode` |

`PUT /api/episodes/:id` while that episode is **live** gives 409, which implements SPEC §18.7: the rundown is locked during the live. The public `/api/messages/*` endpoints are for Stream Deck, Companion and scripts (F17).

- [ ] **Step 1: Write the test support and failing test**

`server/test/support/http.ts`:
```ts
// SPDX-License-Identifier: GPL-2.0-or-later
import { join } from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import { Episode, Format } from '@olc/shared';
import { registerHttp } from '../../src/api/http';
import { DocumentRepository } from '../../src/persistence/repository';
import { makeRuntime, type RuntimeHarness } from './runtime';
import { tempDir } from './tmp';

export interface HttpHarness extends RuntimeHarness {
  app: FastifyInstance;
}

export async function makeHttp(): Promise<HttpHarness> {
  const dir = await tempDir();
  const h = makeRuntime(dir);
  const app = Fastify();
  registerHttp(app, {
    formats: new DocumentRepository(join(dir, 'formats'), Format),
    episodes: new DocumentRepository(join(dir, 'episodes'), Episode),
    runtime: h.runtime,
    version: '0.1.0-test',
    instanceId: 'instance-test',
  });
  await app.ready();
  return { ...h, app };
}
```

`server/test/api/http.test.ts`:
```ts
// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import { PROTOCOL_VERSION } from '@olc/shared';
import { soloFutsalFormat } from '@olc/shared/testing';
import { makeHttp } from '../support/http';

const EPISODE_BODY = { id: 'ep-1', date: '2026-10-12', plannedStart: '2026-10-12T19:00:00+02:00', playlistName: 'Puntata' };

async function withEpisode() {
  const h = await makeHttp();
  await h.app.inject({ method: 'POST', url: '/api/formats', payload: soloFutsalFormat() });
  await h.app.inject({ method: 'POST', url: '/api/formats/solo-futsal/episodes', payload: EPISODE_BODY });
  return h;
}

describe('health', () => {
  it('reports version, protocol and instance', async () => {
    const h = await makeHttp();
    const res = await h.app.inject({ method: 'GET', url: '/api/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ version: '0.1.0-test', protocol: PROTOCOL_VERSION, instanceId: 'instance-test' });
  });
});

describe('formats', () => {
  it('creates, reads, updates, lists and deletes', async () => {
    const h = await makeHttp();
    const f = soloFutsalFormat();
    expect((await h.app.inject({ method: 'POST', url: '/api/formats', payload: f })).statusCode).toBe(201);
    expect((await h.app.inject({ method: 'POST', url: '/api/formats', payload: f })).json()).toEqual({ error: 'exists' });
    const updated = { ...f, name: 'Solo Futsal Plus' };
    expect((await h.app.inject({ method: 'PUT', url: '/api/formats/solo-futsal', payload: updated })).json().name).toBe('Solo Futsal Plus');
    expect((await h.app.inject({ method: 'GET', url: '/api/formats' })).json()).toHaveLength(1);
    expect((await h.app.inject({ method: 'DELETE', url: '/api/formats/solo-futsal' })).statusCode).toBe(204);
    expect((await h.app.inject({ method: 'GET', url: '/api/formats/solo-futsal' })).statusCode).toBe(404);
  });

  it('rejects bad bodies, id mismatches and invalid ids', async () => {
    const h = await makeHttp();
    const bad = await h.app.inject({ method: 'POST', url: '/api/formats', payload: { id: 'x' } });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error).toBe('invalid_body');
    const mismatch = await h.app.inject({ method: 'PUT', url: '/api/formats/other', payload: soloFutsalFormat() });
    expect(mismatch.json()).toEqual({ error: 'id_mismatch' });
    const invalid = await h.app.inject({ method: 'GET', url: '/api/formats/..%2F..%2Fsecret' });
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json()).toEqual({ error: 'invalid_id' });
    const malformed = await h.app.inject({
      method: 'POST',
      url: '/api/formats',
      headers: { 'content-type': 'application/json' },
      payload: '{ not json',
    });
    expect(malformed.statusCode).toBe(400);
    expect(malformed.json()).toEqual({ error: 'bad_request' });
  });
});

describe('episodes', () => {
  it('creates an episode from a format and validates it', async () => {
    const h = await withEpisode();
    const ep = (await h.app.inject({ method: 'GET', url: '/api/episodes/ep-1' })).json();
    expect(ep).toMatchObject({ id: 'ep-1', formatId: 'solo-futsal', name: 'Solo Futsal · 12/10/2026' });
    const again = await h.app.inject({ method: 'POST', url: '/api/formats/solo-futsal/episodes', payload: EPISODE_BODY });
    expect(again.json()).toEqual({ error: 'exists' });
    const missing = await h.app.inject({ method: 'POST', url: '/api/formats/nope/episodes', payload: EPISODE_BODY });
    expect(missing.statusCode).toBe(404);
    const issues = (await h.app.inject({ method: 'POST', url: '/api/episodes/ep-1/validate' })).json().issues;
    expect(issues.map((i: { code: string }) => i.code)).toEqual(['scene_group_shared']);
  });

  it('locks the episode structure while it is live', async () => {
    const h = await withEpisode();
    await h.app.inject({ method: 'POST', url: '/api/live/load', payload: { episodeId: 'ep-1' } });
    const ep = (await h.app.inject({ method: 'GET', url: '/api/episodes/ep-1' })).json();
    expect((await h.app.inject({ method: 'DELETE', url: '/api/episodes/ep-1' })).json()).toEqual({ error: 'episode_loaded' });
    h.runtime.dispatch({ type: 'OutputChanged', output: 'rec', state: 'started' });
    const put = await h.app.inject({ method: 'PUT', url: '/api/episodes/ep-1', payload: ep });
    expect(put.statusCode).toBe(409);
    expect(put.json()).toEqual({ error: 'episode_live' });
  });
});

describe('live control', () => {
  it('loads an episode and serves both views', async () => {
    const h = await withEpisode();
    expect((await h.app.inject({ method: 'GET', url: '/api/live/view?role=presenter' })).json()).toEqual({ error: 'no_episode' });
    const load = await h.app.inject({ method: 'POST', url: '/api/live/load', payload: { episodeId: 'ep-1' } });
    expect(load.json()).toEqual({ episodeId: 'ep-1' });
    expect((await h.app.inject({ method: 'GET', url: '/api/live/view?role=presenter' })).json().phase).toBe('preshow');
    expect((await h.app.inject({ method: 'GET', url: '/api/live/view?role=control' })).json().rows).toHaveLength(8);
    expect((await h.app.inject({ method: 'GET', url: '/api/live/view?role=boss' })).json()).toEqual({ error: 'invalid_role' });
  });

  it('runs commands and refuses them with no episode', async () => {
    const h = await withEpisode();
    const none = await h.app.inject({ method: 'POST', url: '/api/live/command', payload: { name: 'start_program' } });
    expect(none.statusCode).toBe(409);
    expect(none.json()).toEqual({ error: 'no_episode' });
    await h.app.inject({ method: 'POST', url: '/api/live/load', payload: { episodeId: 'ep-1' } });
    const start = await h.app.inject({ method: 'POST', url: '/api/live/command', payload: { name: 'start_program' } });
    expect(start.json()).toEqual({ changed: true });
    expect(h.runtime.phase).toBe('live');
    const busy = await h.app.inject({ method: 'POST', url: '/api/live/load', payload: { episodeId: 'ep-1' } });
    expect(busy.json()).toEqual({ error: 'live_running' });
    expect((await h.app.inject({ method: 'POST', url: '/api/live/unload' })).statusCode).toBe(409);
  });

  it('public message endpoints send presets or free text and clear', async () => {
    const h = await withEpisode();
    await h.app.inject({ method: 'POST', url: '/api/live/load', payload: { episodeId: 'ep-1' } });
    const preset = await h.app.inject({ method: 'POST', url: '/api/messages/send', payload: { presetId: 'stringi' } });
    expect(preset.json()).toEqual({ changed: true });
    expect(h.runtime.presenterView()?.message).toEqual({ text: 'STRINGI' });
    const unknown = await h.app.inject({ method: 'POST', url: '/api/messages/send', payload: { presetId: 'nope' } });
    expect(unknown.json()).toEqual({ error: 'unknown_preset' });
    await h.app.inject({ method: 'POST', url: '/api/messages/send', payload: { text: 'CHIUDI', dismiss: { kind: 'manual' } } });
    expect(h.runtime.presenterView()?.message).toEqual({ text: 'CHIUDI' });
    expect((await h.app.inject({ method: 'POST', url: '/api/messages/clear' })).json()).toEqual({ changed: true });
    expect(h.runtime.presenterView()?.message).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run server/test/api/http.test.ts`
Expected: FAIL. The module `http` is missing.

- [ ] **Step 3: Implement**

`server/src/api/http.ts`:
```ts
// SPDX-License-Identifier: GPL-2.0-or-later
import type { FastifyInstance, FastifyReply } from 'fastify';
import { z, ZodError } from 'zod';
import {
  ClientCommand,
  ClientRole,
  Episode,
  Format,
  MessageDismiss,
  PROTOCOL_VERSION,
  createEpisode,
  validateRundown,
} from '@olc/shared';
import { InvalidIdError, type DocumentRepository } from '../persistence/repository';
import { LiveRunningError, NoEpisodeError, type LiveRuntime } from '../runtime/live-runtime';

export interface HttpContext {
  formats: DocumentRepository<Format>;
  episodes: DocumentRepository<Episode>;
  runtime: LiveRuntime;
  version: string;
  instanceId: string;
}

const NewEpisodeBody = z.object({
  id: z.string().min(1),
  date: z.string(),
  plannedStart: z.string().nullable(),
  playlistName: z.string().nullable(),
});
const LoadBody = z.object({ episodeId: z.string().min(1) });
const SendMessageBody = z.union([
  z.object({ presetId: z.string().min(1) }),
  z.object({ text: z.string().min(1).max(200), dismiss: MessageDismiss }),
]);

type IdParams = { Params: { id: string } };

const notFound = (reply: FastifyReply) => reply.code(404).send({ error: 'not_found' });

export function registerHttp(app: FastifyInstance, ctx: HttpContext): void {
  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof InvalidIdError) return reply.code(400).send({ error: 'invalid_id' });
    if (err instanceof ZodError) return reply.code(400).send({ error: 'invalid_body', issues: err.issues });
    if (err instanceof NoEpisodeError) return reply.code(409).send({ error: 'no_episode' });
    if (err instanceof LiveRunningError) return reply.code(409).send({ error: 'live_running' });
    const status = (err as { statusCode?: unknown }).statusCode;
    if (typeof status === 'number' && status >= 400 && status < 500) {
      return reply.code(status).send({ error: 'bad_request' }); // e.g. malformed JSON body
    }
    reply.log.error(err);
    return reply.code(500).send({ error: 'internal' });
  });

  app.get('/api/health', async () => ({ version: ctx.version, protocol: PROTOCOL_VERSION, instanceId: ctx.instanceId }));

  // Formats
  app.get('/api/formats', async () => ctx.formats.list());
  app.get<IdParams>('/api/formats/:id', async (req, reply) => (await ctx.formats.get(req.params.id)) ?? notFound(reply));
  app.post('/api/formats', async (req, reply) => {
    const format = Format.parse(req.body);
    if ((await ctx.formats.get(format.id)) !== undefined) return reply.code(409).send({ error: 'exists' });
    return reply.code(201).send(await ctx.formats.put(format));
  });
  app.put<IdParams>('/api/formats/:id', async (req, reply) => {
    const format = Format.parse(req.body);
    if (format.id !== req.params.id) return reply.code(400).send({ error: 'id_mismatch' });
    return ctx.formats.put(format);
  });
  app.delete<IdParams>('/api/formats/:id', async (req, reply) =>
    (await ctx.formats.delete(req.params.id)) ? reply.code(204).send() : notFound(reply),
  );
  app.post<IdParams>('/api/formats/:id/episodes', async (req, reply) => {
    const body = NewEpisodeBody.parse(req.body);
    const format = await ctx.formats.get(req.params.id);
    if (format === undefined) return notFound(reply);
    if ((await ctx.episodes.get(body.id)) !== undefined) return reply.code(409).send({ error: 'exists' });
    return reply.code(201).send(await ctx.episodes.put(createEpisode(format, body)));
  });

  // Episodes
  app.get('/api/episodes', async () => ctx.episodes.list());
  app.get<IdParams>('/api/episodes/:id', async (req, reply) => (await ctx.episodes.get(req.params.id)) ?? notFound(reply));
  app.put<IdParams>('/api/episodes/:id', async (req, reply) => {
    const episode = Episode.parse(req.body);
    if (episode.id !== req.params.id) return reply.code(400).send({ error: 'id_mismatch' });
    if (ctx.runtime.isLive(episode.id)) return reply.code(409).send({ error: 'episode_live' });
    return ctx.episodes.put(episode);
  });
  app.delete<IdParams>('/api/episodes/:id', async (req, reply) => {
    if (ctx.runtime.episodeId === req.params.id) return reply.code(409).send({ error: 'episode_loaded' });
    return (await ctx.episodes.delete(req.params.id)) ? reply.code(204).send() : notFound(reply);
  });
  app.post<IdParams>('/api/episodes/:id/validate', async (req, reply) => {
    const episode = await ctx.episodes.get(req.params.id);
    return episode === undefined ? notFound(reply) : { issues: validateRundown(episode) };
  });

  // Live
  app.post('/api/live/load', async (req, reply) => {
    const { episodeId } = LoadBody.parse(req.body);
    const episode = await ctx.episodes.get(episodeId);
    if (episode === undefined) return notFound(reply);
    await ctx.runtime.load(episode);
    return { episodeId };
  });
  app.post('/api/live/unload', async (_req, reply) => {
    await ctx.runtime.unload();
    return reply.code(204).send();
  });
  app.get<{ Querystring: { role?: string } }>('/api/live/view', async (req, reply) => {
    const role = ClientRole.safeParse(req.query.role ?? 'presenter');
    if (!role.success) return reply.code(400).send({ error: 'invalid_role' });
    const view = role.data === 'presenter' ? ctx.runtime.presenterView() : ctx.runtime.controlView();
    return view ?? reply.code(404).send({ error: 'no_episode' });
  });
  app.post('/api/live/command', async (req) => ({ changed: ctx.runtime.command(ClientCommand.parse(req.body)) }));

  // Public message endpoints (Stream Deck, Companion, scripts — F17)
  app.post('/api/messages/send', async (req, reply) => {
    const body = SendMessageBody.parse(req.body);
    if ('presetId' in body) {
      const preset = ctx.runtime.getState()?.episode.messages.find((m) => m.id === body.presetId);
      if (preset === undefined) {
        if (ctx.runtime.episodeId === null) throw new NoEpisodeError();
        return reply.code(404).send({ error: 'unknown_preset' });
      }
      return { changed: ctx.runtime.command({ name: 'send_message', text: preset.text, dismiss: preset.dismiss }) };
    }
    return { changed: ctx.runtime.command({ name: 'send_message', text: body.text, dismiss: body.dismiss }) };
  });
  app.post('/api/messages/clear', async () => ({ changed: ctx.runtime.command({ name: 'clear_message' }) }));
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm vitest run server/test/api && pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/api server/test/api server/test/support
git commit -m "feat(server): HTTP API for formats, episodes, live control and messages"
```

---

### Task 9: WebSocket hub

**Files:**
- Create: `server/src/api/ws.ts`, `server/test/support/ws-client.ts`, `server/test/api/ws.test.ts`

**Interfaces:**
- Consumes: `LiveRuntime`, `NoEpisodeError` (Task 7); `Clock` (Task 2); `ClientMessage`, `ClientRole`, `PROTOCOL_VERSION`, `ServerMessage` (shared).
- Produces: `interface WsContext { runtime: LiveRuntime; clock: Clock; version: string; instanceId: string; heartbeatMs: number }`, `registerWs(app: FastifyInstance, ctx: WsContext): void`. It must be registered after `@fastify/websocket` and serves `GET /ws`.

Rules (TECH-DESIGN §6.2, DT-7):
- **`hello`:**
  - with the wrong protocol → `error protocol_mismatch`, then the socket closes with code `4001`;
  - otherwise it sets the role, sends `welcome`, then immediately sends the current `view` (which is `null` when no episode is loaded).
- **Any other message before `hello`** → `error hello_required`. Malformed JSON or a schema failure → `error invalid_message`. The socket stays open in both cases.
- **`time.ping {t0}`** → `time.pong {t0, serverWall: clock.wall()}`.
- **`command {id, command}`** → `ack {id}`. With no episode loaded → `error {id, code: no_episode}`.
- **Views are pushed on every runtime change and on every heartbeat.** Each client only receives a view when its JSON differs from the last one sent to that client; this is the dedupe from BACKLOG. `rev` is a global counter incremented per sent view.
- **Heartbeat.** Every `heartbeatMs`, each client that has sent `hello` gets `heartbeat {rev, serverWall}`.
- **Server close** clears the interval, unsubscribes from the runtime and closes the sockets (code 1001).

- [ ] **Step 1: Write the test client and failing test**

`server/test/support/ws-client.ts`:
```ts
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
```

`server/test/api/ws.test.ts`:
```ts
// SPDX-License-Identifier: GPL-2.0-or-later
import websocket from '@fastify/websocket';
import Fastify from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { PROTOCOL_VERSION, type ServerMessage } from '@olc/shared';
import { soloFutsalEpisode } from '@olc/shared/testing';
import { registerWs } from '../../src/api/ws';
import { makeRuntime } from '../support/runtime';
import { tempDir } from '../support/tmp';
import { connect } from '../support/ws-client';

const closers: Array<() => Promise<void>> = [];
afterEach(async () => {
  while (closers.length > 0) await closers.pop()!();
});

async function start(heartbeatMs = 40) {
  const h = makeRuntime(await tempDir());
  const app = Fastify();
  await app.register(websocket);
  registerWs(app, { runtime: h.runtime, clock: h.time, version: '0.1.0-test', instanceId: 'i-1', heartbeatMs });
  await app.listen({ port: 0, host: '127.0.0.1' });
  closers.push(() => app.close());
  const port = (app.server.address() as { port: number }).port;
  return { ...h, app, url: `ws://127.0.0.1:${port}/ws` };
}

const is = (type: ServerMessage['type']) => (m: ServerMessage) => m.type === type;

describe('WebSocket hub', () => {
  it('greets a presenter and pushes the current view, then updates', async () => {
    const s = await start();
    const c = await connect(s.url);
    c.send({ type: 'hello', role: 'presenter', protocol: PROTOCOL_VERSION });
    expect(await c.next(is('welcome'))).toEqual({ type: 'welcome', serverVersion: '0.1.0-test', instanceId: 'i-1', protocol: 1 });
    expect(await c.next(is('view'))).toMatchObject({ type: 'view', role: 'presenter', view: null });
    await s.runtime.load(soloFutsalEpisode());
    const v = (await c.next((m) => m.type === 'view' && m.view !== null)) as Extract<ServerMessage, { type: 'view' }>;
    expect((v.view as { phase: string }).phase).toBe('preshow');
    c.close();
  });

  it('serves the control view to control clients', async () => {
    const s = await start();
    await s.runtime.load(soloFutsalEpisode());
    const c = await connect(s.url);
    c.send({ type: 'hello', role: 'control', protocol: PROTOCOL_VERSION });
    const v = (await c.next(is('view'))) as Extract<ServerMessage, { type: 'view' }>;
    expect((v.view as { rows: unknown[] }).rows).toHaveLength(8);
    c.close();
  });

  it('refuses a protocol mismatch with close code 4001', async () => {
    const s = await start();
    const c = await connect(s.url);
    c.send({ type: 'hello', role: 'presenter', protocol: 99 });
    expect(await c.next(is('error'))).toMatchObject({ code: 'protocol_mismatch' });
    expect(await c.closed).toBe(4001);
  });

  it('answers misbehaving clients with typed errors and stays up', async () => {
    const s = await start();
    const c = await connect(s.url);
    c.sendRaw('{ not json');
    expect(await c.next(is('error'))).toMatchObject({ code: 'invalid_message', id: null });
    c.send({ type: 'command', id: 'c1', command: { name: 'next' } });
    expect(await c.next((m) => m.type === 'error' && m.code === 'hello_required')).toMatchObject({ id: 'c1' });
    c.send({ type: 'hello', role: 'control', protocol: PROTOCOL_VERSION });
    await c.next(is('welcome'));
    c.send({ type: 'command', id: 'c2', command: { name: 'next' } });
    expect(await c.next((m) => m.type === 'error' && m.code === 'no_episode')).toMatchObject({ id: 'c2' });
    c.send({ type: 'shout' });
    expect(await c.next((m) => m.type === 'error' && m.code === 'invalid_message')).toBeTruthy();
    c.close();
  });

  it('runs commands with an ack and pushes the resulting view', async () => {
    const s = await start();
    await s.runtime.load(soloFutsalEpisode());
    const c = await connect(s.url);
    c.send({ type: 'hello', role: 'presenter', protocol: PROTOCOL_VERSION });
    await c.next(is('view'));
    c.send({ type: 'command', id: 'm1', command: { name: 'send_message', text: 'STRINGI', dismiss: { kind: 'manual' } } });
    expect(await c.next(is('ack'))).toEqual({ type: 'ack', id: 'm1' });
    const v = (await c.next(
      (m) => m.type === 'view' && (m.view as { message: unknown }).message !== null,
    )) as Extract<ServerMessage, { type: 'view' }>;
    expect((v.view as { message: unknown }).message).toEqual({ text: 'STRINGI' });
    c.close();
  });

  it('answers time pings with the server wall clock', async () => {
    const s = await start();
    const c = await connect(s.url);
    c.send({ type: 'hello', role: 'presenter', protocol: PROTOCOL_VERSION });
    c.send({ type: 'time.ping', t0: 12.5 });
    expect(await c.next(is('time.pong'))).toEqual({ type: 'time.pong', t0: 12.5, serverWall: s.time.wall() });
    c.close();
  });

  it('sends heartbeats and never resends an unchanged view', async () => {
    const s = await start(30);
    await s.runtime.load(soloFutsalEpisode());
    const c = await connect(s.url);
    c.send({ type: 'hello', role: 'presenter', protocol: PROTOCOL_VERSION });
    await c.next(is('view'));
    await c.next(is('heartbeat'));
    await c.next(is('heartbeat'));
    await c.next(is('heartbeat'));
    expect(c.messages.filter((m) => m.type === 'view')).toHaveLength(1);
    const hb = c.messages.find((m) => m.type === 'heartbeat') as Extract<ServerMessage, { type: 'heartbeat' }>;
    expect(hb.serverWall).toBe(s.time.wall());
    c.close();
  });

  it('closes client sockets when the server closes', async () => {
    const s = await start();
    const c = await connect(s.url);
    c.send({ type: 'hello', role: 'presenter', protocol: PROTOCOL_VERSION });
    await c.next(is('welcome'));
    await s.app.close();
    closers.pop();
    // Our hook closes with 1001; if the websocket plugin terminates the socket first the client sees 1006.
    expect([1001, 1006]).toContain(await c.closed);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run server/test/api/ws.test.ts`
Expected: FAIL. The module `ws` is missing.

- [ ] **Step 3: Implement**

`server/src/api/ws.ts`:
```ts
// SPDX-License-Identifier: GPL-2.0-or-later
import type { FastifyInstance } from 'fastify';
import type { WebSocket } from 'ws';
import { ClientMessage, PROTOCOL_VERSION, type ClientRole, type ServerMessage } from '@olc/shared';
import type { Clock } from '../clock/clock';
import { NoEpisodeError, type LiveRuntime } from '../runtime/live-runtime';

export interface WsContext {
  runtime: LiveRuntime;
  clock: Clock;
  version: string;
  instanceId: string;
  heartbeatMs: number;
}

interface Client {
  role: ClientRole | null;
  lastView: string | null;
}

export function registerWs(app: FastifyInstance, ctx: WsContext): void {
  const clients = new Map<WebSocket, Client>();
  let rev = 0;

  const send = (socket: WebSocket, msg: ServerMessage) => {
    if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(msg));
  };

  const viewFor = (role: ClientRole): unknown =>
    role === 'presenter' ? ctx.runtime.presenterView() : ctx.runtime.controlView();

  const pushViews = () => {
    for (const [socket, client] of clients) {
      if (client.role === null) continue;
      const view = viewFor(client.role);
      const json = JSON.stringify(view);
      if (json === client.lastView) continue;
      client.lastView = json;
      rev += 1;
      send(socket, { type: 'view', rev, role: client.role, view });
    }
  };

  const unsubscribe = ctx.runtime.subscribe(pushViews);
  const heartbeat = setInterval(() => {
    pushViews();
    for (const [socket, client] of clients) {
      if (client.role !== null) send(socket, { type: 'heartbeat', rev, serverWall: ctx.clock.wall() });
    }
  }, ctx.heartbeatMs);

  app.addHook('onClose', async () => {
    clearInterval(heartbeat);
    unsubscribe();
    for (const socket of clients.keys()) socket.close(1001, 'server shutting down');
    clients.clear();
  });

  app.get('/ws', { websocket: true }, (socket) => {
    const client: Client = { role: null, lastView: null };
    clients.set(socket, client);
    socket.on('close', () => clients.delete(socket));

    socket.on('message', (raw) => {
      let data: unknown;
      try {
        data = JSON.parse(raw.toString());
      } catch {
        send(socket, { type: 'error', id: null, code: 'invalid_message', message: 'Malformed JSON' });
        return;
      }
      const parsed = ClientMessage.safeParse(data);
      if (!parsed.success) {
        send(socket, { type: 'error', id: null, code: 'invalid_message', message: 'Unknown or invalid message' });
        return;
      }
      const msg = parsed.data;

      if (msg.type === 'hello') {
        if (msg.protocol !== PROTOCOL_VERSION) {
          send(socket, {
            type: 'error',
            id: null,
            code: 'protocol_mismatch',
            message: `Server speaks protocol ${PROTOCOL_VERSION}`,
          });
          socket.close(4001, 'protocol_mismatch');
          return;
        }
        client.role = msg.role;
        client.lastView = null;
        send(socket, { type: 'welcome', serverVersion: ctx.version, instanceId: ctx.instanceId, protocol: PROTOCOL_VERSION });
        pushViews();
        return;
      }

      if (client.role === null) {
        send(socket, {
          type: 'error',
          id: msg.type === 'command' ? msg.id : null,
          code: 'hello_required',
          message: 'Send hello first',
        });
        return;
      }

      if (msg.type === 'time.ping') {
        send(socket, { type: 'time.pong', t0: msg.t0, serverWall: ctx.clock.wall() });
        return;
      }

      try {
        ctx.runtime.command(msg.command);
        send(socket, { type: 'ack', id: msg.id });
      } catch (err) {
        if (!(err instanceof NoEpisodeError)) throw err;
        send(socket, { type: 'error', id: msg.id, code: 'no_episode', message: 'No episode is loaded' });
      }
    });
  });
}
```

`pushViews` runs synchronously inside `runtime.dispatch` via `subscribe`. When a command changes the state, the new view is therefore sent **before** the `ack`. The test uses `next(predicate)` for both, so the order does not matter to it. Keep the order as written.

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm vitest run server/test/api && pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/api/ws.ts server/test/api/ws.test.ts server/test/support/ws-client.ts
git commit -m "feat(server): websocket hub with role views, heartbeat, time sync and commands"
```

---

### Task 10: Bootstrap, entry point and end-to-end tests

**Files:**
- Create: `server/src/app/server.ts`, `server/src/app/main.ts`, `server/test/app/server.test.ts`
- Modify: `README.md` (Development section), `docs/TECH-DESIGN.md` §5.7 (resume note)

**Interfaces:**
- Consumes: everything above.
- Produces: `interface ServerOptions { dataDir: string; clock?: Clock; scheduler?: Scheduler; heartbeatMs?: number; logger?: boolean; version?: string }` and `buildServer(opts): Promise<{ app: FastifyInstance; runtime: LiveRuntime; instanceId: string }>`.

`buildServer` does the following, in order:
1. Ensure the secret token exists.
2. Create the repositories (formats and episodes; invalid files are logged through `app.log.warn` once the app exists).
3. Create the runtime and call `resume()`.
4. Create Fastify, register `@fastify/websocket`, `registerHttp` and `registerWs`.
5. Add an `onClose` hook that disposes the runtime and awaits `flush()`.

Defaults: `systemClock` and `systemScheduler`, heartbeat `1000` ms, `APP_VERSION`.

`main.ts` is the process entry. It resolves the data dir, acquires the lock, loads the settings, builds the server, listens on `listenHost(settings)`, writes `runtime.json` (`{ port, pid, instanceId }`) for the plugin (TECH-DESIGN R7), and shuts down cleanly on SIGINT/SIGTERM. It is exercised manually through `pnpm --filter @olc/server dev`. Its building blocks are unit-tested.

- [ ] **Step 1: Write the failing test**

`server/test/app/server.test.ts`:
```ts
// SPDX-License-Identifier: GPL-2.0-or-later
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { PROTOCOL_VERSION, type ServerMessage } from '@olc/shared';
import { soloFutsalFormat } from '@olc/shared/testing';
import { buildServer } from '../../src/app/server';
import { FakeTime } from '../../src/clock/clock';
import { tempDir } from '../support/tmp';
import { connect } from '../support/ws-client';

const apps: Array<{ close(): Promise<unknown> }> = [];
afterEach(async () => {
  while (apps.length > 0) await apps.pop()!.close();
});

async function boot(dataDir: string, time: FakeTime) {
  const server = await buildServer({ dataDir, clock: time, scheduler: time, heartbeatMs: 40 });
  apps.push(server.app);
  return server;
}

describe('buildServer', () => {
  it('creates the secret token and serves health', async () => {
    const dir = await tempDir();
    const { app } = await boot(dir, new FakeTime());
    expect((await readFile(join(dir, 'secret.token'), 'utf8')).trim()).toMatch(/^[0-9a-f]{64}$/);
    const health = (await app.inject({ method: 'GET', url: '/api/health' })).json();
    expect(health).toMatchObject({ version: '0.1.0', protocol: PROTOCOL_VERSION });
  });

  it('end to end: format → episode → load → live over HTTP and WebSocket', async () => {
    const { app, runtime } = await boot(await tempDir(), new FakeTime());
    await app.inject({ method: 'POST', url: '/api/formats', payload: soloFutsalFormat() });
    await app.inject({
      method: 'POST',
      url: '/api/formats/solo-futsal/episodes',
      payload: { id: 'ep-1', date: '2026-10-12', plannedStart: null, playlistName: null },
    });
    await app.inject({ method: 'POST', url: '/api/live/load', payload: { episodeId: 'ep-1' } });

    await app.listen({ port: 0, host: '127.0.0.1' });
    const port = (app.server.address() as { port: number }).port;
    const c = await connect(`ws://127.0.0.1:${port}/ws`);
    c.send({ type: 'hello', role: 'presenter', protocol: PROTOCOL_VERSION });
    await c.next((m) => m.type === 'view');

    runtime.dispatch({ type: 'SourceRestored' });
    runtime.dispatch({ type: 'ProgramSceneChanged', scene: 'CAM 1', deckOnProgram: false });
    runtime.dispatch({ type: 'OutputChanged', output: 'rec', state: 'started' });
    const live = (await c.next(
      (m) => m.type === 'view' && (m.view as { phase: string }).phase === 'live',
    )) as Extract<ServerMessage, { type: 'view' }>;
    expect((live.view as { block: { name: string } }).block.name).toBe('Primo blocco');
    c.close();
  });

  it('restart mid-show: resumes the live episode with OBS lost', async () => {
    const dir = await tempDir();
    const time = new FakeTime();
    const first = await boot(dir, time);
    await first.app.inject({ method: 'POST', url: '/api/formats', payload: soloFutsalFormat() });
    await first.app.inject({
      method: 'POST',
      url: '/api/formats/solo-futsal/episodes',
      payload: { id: 'ep-1', date: '2026-10-12', plannedStart: null, playlistName: null },
    });
    await first.app.inject({ method: 'POST', url: '/api/live/load', payload: { episodeId: 'ep-1' } });
    first.runtime.dispatch({ type: 'SourceRestored' });
    first.runtime.dispatch({ type: 'OutputChanged', output: 'rec', state: 'started' });
    await first.app.close();
    apps.pop();

    time.advance(30_000);
    const second = await boot(dir, time);
    expect(second.runtime.phase).toBe('live');
    const view = (await second.app.inject({ method: 'GET', url: '/api/live/view?role=presenter' })).json();
    expect(view.status.obs).toBe('lost');
    expect(view.block.anchor.source).toBe('estimated');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run server/test/app/server.test.ts`
Expected: FAIL. The module `server` is missing.

- [ ] **Step 3: Implement**

`server/src/app/server.ts`:
```ts
// SPDX-License-Identifier: GPL-2.0-or-later
import { randomUUID } from 'node:crypto';
import websocket from '@fastify/websocket';
import Fastify, { type FastifyInstance } from 'fastify';
import { Episode, Format } from '@olc/shared';
import { registerHttp } from '../api/http';
import { registerWs } from '../api/ws';
import { systemClock, systemScheduler, type Clock, type Scheduler } from '../clock/clock';
import { LiveJournal } from '../persistence/journal';
import { DocumentRepository, type InvalidDocument } from '../persistence/repository';
import { SnapshotStore } from '../persistence/snapshot-store';
import { LiveRuntime } from '../runtime/live-runtime';
import { dataPaths } from './paths';
import { ensureSecretToken } from './secret';
import { APP_VERSION } from './version';

export interface ServerOptions {
  dataDir: string;
  clock?: Clock;
  scheduler?: Scheduler;
  heartbeatMs?: number;
  logger?: boolean;
  version?: string;
}

export interface BuiltServer {
  app: FastifyInstance;
  runtime: LiveRuntime;
  instanceId: string;
}

export async function buildServer(opts: ServerOptions): Promise<BuiltServer> {
  const clock = opts.clock ?? systemClock;
  const scheduler = opts.scheduler ?? systemScheduler(clock);
  const version = opts.version ?? APP_VERSION;
  const paths = dataPaths(opts.dataDir);
  await ensureSecretToken(paths.secret);

  const app = Fastify({ logger: opts.logger ?? false });
  const warnInvalid = (kind: string) => (doc: InvalidDocument) =>
    app.log.warn({ file: doc.file, error: doc.error }, `Skipping invalid ${kind} file`);

  const runtime = new LiveRuntime({
    clock,
    scheduler,
    snapshots: new SnapshotStore(paths.snapshot),
    journalFor: (episodeId) => new LiveJournal(paths.journal(episodeId)),
    onError: (err) => app.log.error(err),
  });
  await runtime.resume();

  const instanceId = randomUUID();
  await app.register(websocket);
  registerHttp(app, {
    formats: new DocumentRepository(paths.formats, Format, warnInvalid('format')),
    episodes: new DocumentRepository(paths.episodes, Episode, warnInvalid('episode')),
    runtime,
    version,
    instanceId,
  });
  registerWs(app, { runtime, clock, version, instanceId, heartbeatMs: opts.heartbeatMs ?? 1_000 });
  app.addHook('onClose', async () => {
    runtime.dispose();
    await runtime.flush();
  });
  return { app, runtime, instanceId };
}
```

`server/src/app/main.ts`:
```ts
// SPDX-License-Identifier: GPL-2.0-or-later
import { mkdir } from 'node:fs/promises';
import { writeJsonAtomic } from '../persistence/json-file';
import { acquireLock } from './instance-lock';
import { dataPaths, defaultDataDir } from './paths';
import { buildServer } from './server';
import { listenHost, loadSettings } from './settings';

async function main(): Promise<void> {
  const paths = dataPaths(defaultDataDir());
  await mkdir(paths.root, { recursive: true });
  const release = await acquireLock(paths.lock);
  const settings = await loadSettings(paths.settings);
  const { app, instanceId } = await buildServer({ dataDir: paths.root, logger: true });
  await app.listen({ port: settings.port, host: listenHost(settings) });
  await writeJsonAtomic(paths.runtime, { port: settings.port, pid: process.pid, instanceId });

  const shutdown = async () => {
    await app.close();
    await release();
    process.exit(0);
  };
  process.once('SIGINT', () => void shutdown());
  process.once('SIGTERM', () => void shutdown());
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
```

Add a **Development** section to `README.md`, after "Documentation":
````markdown
## Development

Requirements: Node.js 24, pnpm (via `corepack enable`).

```bash
pnpm install
pnpm test        # all tests
pnpm typecheck
pnpm --filter @olc/server dev   # start the local server on http://127.0.0.1:4460
```

Data is stored in the platform data directory (`%APPDATA%/obs-live-clock`, `~/Library/Application Support/obs-live-clock`, `~/.config/obs-live-clock`); set `OLC_DATA_DIR` to use another folder.
````

In `docs/TECH-DESIGN.md` §5.7, replace the paragraph that starts with "**Ripresa dopo il riavvio.**" and its numbered list with:
```markdown
- **Ripresa dopo il riavvio.** Il tempo monotono è ancorato all'epoca (`performance.timeOrigin + performance.now()`), quindi i tempi salvati nello snapshot restano validi anche dopo il riavvio, senza bisogno di convertirli. Al riavvio il runtime ricarica lo snapshot e segna OBS come perso (`SourceLost`), quindi tutti i valori sono `estimated`. Quando l'adapter si riconnette, la sincronizzazione iniziale riallinea il rundown. Un salto dell'orologio di sistema (NTP) fra due esecuzioni viene accettato.
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm test && pnpm typecheck`
Expected: all tests PASS, and typecheck is clean.

- [ ] **Step 5: Manual smoke run**

Run: `OLC_DATA_DIR="$(mktemp -d)" pnpm --filter @olc/server dev` (Git Bash), then in another shell `curl -s http://127.0.0.1:4460/api/health`.
Expected: JSON with `version: "0.1.0"`, `protocol: 1`. Stop the server with Ctrl+C. Paste the output into the report.

- [ ] **Step 6: Commit**

```bash
git add server README.md docs/TECH-DESIGN.md
git commit -m "feat(server): bootstrap, process entry, end-to-end tests and dev instructions"
```

---

## Self-review notes (plan author)

- **Spec coverage in this plan:**
  - NF2: local only, no external calls. NF3: localhost by default, LAN opt-in. NF4: the server is the only time source, via `time.ping`/`heartbeat` (client offset estimation comes in Plan 4). NF5: persistence and resume.
  - DT-5: token creation only (the credential endpoint is Plan 3). DT-6: layout and atomic writes. DT-7: anchors, heartbeat and staleness data. DT-8: Fastify, zod, Vitest.
  - F12: journal. F13/F14: the control view data. F15/F17: messages over HTTP and WebSocket. F16: commands. SPEC §18.7: lock while live. TECH-DESIGN §7: routes; the Plan 3 routes (`/api/obs/*`, `/api/deck/items`, `/api/internal/*`, import-playlist) are deferred there.
- **Deviations from TECH-DESIGN:**
  - §5.7 resume uses an epoch-anchored monotonic clock instead of re-basing (Task 10 updates the doc).
  - §6.2 `view` messages carry the full view for the client's role. Dedupe is per client (JSON compare), which also closes the BACKLOG item "changed=true on identical payloads" at the transport level.
- **Deferred:**
  - bundling into a single distributable (Plan 7);
  - Windows ACL on the secret token (Plan 3);
  - `/api/obs/*` and Check OBS (Plan 3).
