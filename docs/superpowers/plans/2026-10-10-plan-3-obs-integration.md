# Plan 3 — OBS Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Connect the running server to a real OBS Studio, and keep the live engine fed with what actually happens on air. It must do this without inventing anything and without ever crashing when OBS misbehaves.

**Scope:**
- obs-websocket v5 connection with reconnect, and with authentication failures handled as a stop.
- An OBS adapter that covers Program scene, scene graph, REC/stream and break media.
- A Playlist Deck adapter for the vendor requests and events of plugin ≥ 1.4.0, with a polling fallback for older plugins.
- The DT-5 credential hand-off endpoint and a Windows ACL on the secret token.
- OBS endpoints for status, scenes, deck items and Check OBS.
- A local **OBS simulator** for tests and for Plan 4 development.
- The persistence and engine items from BACKLOG that are needed before ~1 Hz events start flowing.
- A manual test plan for real OBS.

**Architecture:**
- An `ObsClient` interface wraps `obs-websocket-js/json`. Tests use an in-memory `FakeObsClient`. Integration tests use the real client against `tools/obs-sim`, which speaks the obs-websocket v5 JSON protocol.
- `ObsConnection` owns connecting and reconnecting, using the injected `Scheduler`.
- On every successful connection, `ObsAdapter` and `DeckAdapter` translate OBS state and events into engine `DomainEvent`s through `LiveRuntime.dispatch`.
- `ObsService` wires these together and exposes a status for the HTTP layer.
- Everything stays off the engine. The engine remains pure.

**Tech Stack:** Node 24 · TypeScript 5.9 strict · obs-websocket-js 5.0.x (MIT), JSON variant · ws 8 · Fastify 5 · Vitest 3.

**Spec:** [SPEC.md](../../SPEC.md) §6, §15 · [TECH-DESIGN.md](../../TECH-DESIGN.md) §3, §4.2, §4.3, §5.5, §7, §10, §13 (R1, R3) · [DECISIONS.md](../../DECISIONS.md) DT-5, DT-7 · [BACKLOG.md](../../BACKLOG.md) "Piano 3".

**Roadmap:**

| Plan | Scope |
|---|---|
| 1 ✅ | engine |
| 2 ✅ | server core |
| **3 (this)** | OBS integration |
| 4 | web presenter, dock, control |
| 5 | editor |
| 6 | plugin C++ + kiosk |
| 7 | installers |

---

## Execution model (user's instruction)

- **Plan author:** Opus (this document).
- **Orchestrator:** a **Sonnet** agent runs the subagent-driven loop for each task:
  1. extract the brief;
  2. dispatch the implementer;
  3. verify the tests itself (3 green runs and a clean typecheck);
  4. review the diff, or dispatch a Sonnet reviewer;
  5. run fix rounds.

  For Tasks 4, 5 and 9 and for the final whole-branch review, it escalates the review to **Opus**.
- **Implementer:** **DeepSeek v4.1 Flash through OpenCode**, through the controller's script `deepseek-task.sh`. The script has a startup watchdog, because OpenCode can hang at startup with no output.
- **No AI attribution** in any commit. Nothing is pushed until the controller merges.

## Global Constraints

- Node `>=24`, pnpm, ESM, TypeScript `strict`. Every new source file starts with `// SPDX-License-Identifier: GPL-2.0-or-later`. Use LF line endings.
- Runtime dependencies must be MIT, BSD or ISC. `obs-websocket-js` and its dependency tree are MIT or ISC.
- `server/src/engine/**` stays pure.
- OBS-facing code gets time only through the injected `Clock` and `Scheduler`. It must never call `setTimeout` or `setInterval` directly, so that every test is deterministic with `FakeTime`. The one exception is `tools/obs-sim`, which is a dev tool.
- **Never crash on OBS input.** Every event handler and every request in `server/src/obs/**`:
  - is guarded with `try`/`catch`;
  - reports the error through an injected `report(err)`;
  - keeps running.

  A malformed or missing field is reported and ignored. It is never dispatched with guessed values (NF1, "never invent").
- **Never invent OBS state.** Until a connection is identified and the initial sync has completed, the runtime stays with `obs: 'lost'`. The order is: initial sync → `SourceRestored` → current Program scene. On disconnect, dispatch `SourceLost` exactly once.
- **The obs-websocket password is never written** to disk, logs, HTTP responses, the journal or error messages (DT-5). It lives only in memory. The one exception is the optional manual `settings.obs.password` used in remote mode, which the operator writes in `settings.json`.
- **Journal hygiene.** High-frequency sources (media cursor polling, Playlist Deck `playback-state` at ~1 Hz) are **deduplicated before dispatch**. Dispatch only when the playing state, the item or the duration changes, or when the reported position differs from the extrapolated one by more than **500 ms**.
- obs-websocket event and request names follow obs-websocket v5:
  - events: `CurrentProgramSceneChanged`, `SceneItemEnableStateChanged`, `SceneItemCreated`, `SceneItemRemoved`, `SceneListChanged`, `RecordStateChanged`, `StreamStateChanged`, `MediaInputPlaybackStarted`, `MediaInputPlaybackEnded`, `VendorEvent`, `ExitStarted`;
  - client event: `ConnectionClosed`;
  - requests: `GetVersion`, `GetSceneList`, `GetSceneItemList`, `GetGroupSceneItemList`, `GetCurrentProgramScene`, `GetRecordStatus`, `GetStreamStatus`, `GetInputList`, `GetMediaInputStatus`, `CallVendorRequest`.
- Playlist Deck vendor name is `obs-playlist-deck`. Requests: `GetStatus`, `GetItems { from, to }`. Events: `item-started`, `playback-state`, `playlist-changed`, `playlist-completed`. The minimum version with events is `1.4.0`.
- Output states: `OBS_WEBSOCKET_OUTPUT_STARTED`, `…_STOPPED`, `…_PAUSED` and `…_RESUMED` map to `started`, `stopped`, `paused` and `resumed`. Ignore `…_STARTING`, `…_STOPPING`, `…_RECONNECTING` and `…_RECONNECTED`.
- The media state playing value is `OBS_MEDIA_STATE_PLAYING`.
- Commit messages are plain, with **no AI attribution and no co-author trailers**.

## Review Focus

1. **OBS goes away mid-show.** `ConnectionClosed` or `ExitStarted` must dispatch `SourceLost` once. Reconnects back off from 0.5 s up to 5 s. *Tests: Task 3, Task 6.*
2. **Wrong password.** It must stop retrying, expose `auth_failed`, and resume only when new credentials arrive (DT-5). The password must not appear anywhere. *Tests: Task 3, Task 7.*
3. **OBS restarted while the show is live, or REC stopped while the server was down.** The initial sync must reconcile REC and stream with the runtime: dispatch `stopped` when OBS says inactive but the runtime says active, and the reverse. *Test: Task 4.*
4. **Flood of high-frequency events.** The journal must not grow at ~1–4 lines per second while nothing meaningful changes. *Tests: Task 4 (media), Task 5 (deck).*
5. **Missing or old Playlist Deck.** The vendor is absent: the system runs without media matching, reports it, and does not crash. The vendor is older than 1.4.0: fall back to polling `GetItems` every 2 s. *Test: Task 5.*

---

## File structure

```
server/package.json                       + obs-websocket-js
server/src/obs/client.ts                  ObsClient interface, ObsAuthError, ObsRequestError, createObsClient (real)
server/src/obs/scene-graph.ts             SceneGraphData, loadSceneGraph, visibleInputs
server/src/obs/connection.ts              ObsConnection (credentials, state machine, backoff)
server/src/obs/obs-adapter.ts             ObsAdapter (sync + events + media polling)
server/src/obs/deck-adapter.ts            DeckAdapter (vendor requests/events, legacy polling)
server/src/obs/obs-service.ts             ObsService (wiring + status)
server/src/obs/version.ts                 compareVersions
server/src/api/internal.ts                POST /api/internal/obs-credentials (loopback + bearer)
server/src/api/obs.ts                     GET /api/obs/status, /api/obs/scenes, /api/deck/items, POST /api/obs/check
server/src/app/secret.ts                  + Windows ACL (injectable runner)
server/src/app/settings.ts                + optional obs { host, port, password? }
server/src/app/server.ts / main.ts        wire ObsService
server/src/persistence/journal.ts         trailing-newline cache (no full re-read per append)
server/src/runtime/live-runtime.ts        snapshot save coalescing
server/src/engine/reducer.ts              estimated loop marks from position(s)
server/test/support/fake-obs.ts           FakeObsClient
tools/obs-sim/                            @olc/obs-sim: obs-websocket v5 JSON simulator + CLI
docs/TEST-PLAN.md                         manual checklist with real OBS + Playlist Deck
```

---

### Task 1: ObsClient interface, real client and the fake for tests

**Files:**
- Modify: `server/package.json` (add `"obs-websocket-js": "^5.0.8"` to dependencies)
- Create: `server/src/obs/client.ts`, `server/src/obs/version.ts`, `server/test/support/fake-obs.ts`, `server/test/obs/client.test.ts`

**Interfaces:**
- Produces:
  - `type ObsData = Record<string, unknown>`;
  - `interface ObsClient`, with:
    - `connect(url, password?)`, which returns `{ obsWebSocketVersion, negotiatedRpcVersion }`;
    - `disconnect()`;
    - `call(type, data?)`, which returns `ObsData`;
    - `on(event, fn)` and `off(event, fn)`;
  - `class ObsAuthError`;
  - `class ObsRequestError { code }`;
  - `createObsClient(): ObsClient`;
  - `compareVersions(a, b): number`, a numeric dotted compare where a missing part counts as 0.
- Produces (test support): `class FakeObsClient implements ObsClient`, with:
  - state fields `connected`, `connectError`, `calls[]`;
  - `respond(type, fn)`;
  - `emit(event, data)`;
  - `listenerCount(event)`.

- [ ] **Step 1: Write the failing test**

`server/test/obs/client.test.ts`:
```ts
// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import { ObsAuthError, ObsRequestError } from '../../src/obs/client';
import { compareVersions } from '../../src/obs/version';
import { FakeObsClient } from '../support/fake-obs';

describe('compareVersions', () => {
  it('compares dotted versions numerically', () => {
    expect(compareVersions('1.4.0', '1.4.0')).toBe(0);
    expect(compareVersions('1.10.0', '1.4.0')).toBeGreaterThan(0);
    expect(compareVersions('1.3.9', '1.4.0')).toBeLessThan(0);
    expect(compareVersions('1.4', '1.4.0')).toBe(0);
    expect(compareVersions('2', '1.9.9')).toBeGreaterThan(0);
  });
});

describe('FakeObsClient', () => {
  it('connects, answers configured requests and emits events', async () => {
    const obs = new FakeObsClient();
    obs.respond('GetVersion', () => ({ obsVersion: '31.0.0' }));
    expect(await obs.connect('ws://127.0.0.1:4455', 'pw')).toEqual({ obsWebSocketVersion: '5.5.0', negotiatedRpcVersion: 1 });
    expect(obs.connected).toBe(true);
    expect(await obs.call('GetVersion')).toEqual({ obsVersion: '31.0.0' });
    expect(obs.calls).toEqual([{ type: 'GetVersion', data: undefined }]);
    const seen: unknown[] = [];
    const fn = (d: unknown) => seen.push(d);
    obs.on('CurrentProgramSceneChanged', fn);
    obs.emit('CurrentProgramSceneChanged', { sceneName: 'CAM 1' });
    obs.off('CurrentProgramSceneChanged', fn);
    obs.emit('CurrentProgramSceneChanged', { sceneName: 'CAM 2' });
    expect(seen).toEqual([{ sceneName: 'CAM 1' }]);
  });

  it('fails unknown requests with ObsRequestError and can refuse auth', async () => {
    const obs = new FakeObsClient();
    await obs.connect('ws://x', undefined);
    await expect(obs.call('Nope')).rejects.toBeInstanceOf(ObsRequestError);
    const locked = new FakeObsClient();
    locked.connectError = new ObsAuthError('Authentication failed');
    await expect(locked.connect('ws://x', 'bad')).rejects.toBeInstanceOf(ObsAuthError);
    expect(locked.connected).toBe(false);
  });

  it('disconnect emits ConnectionClosed once', async () => {
    const obs = new FakeObsClient();
    await obs.connect('ws://x', undefined);
    let closed = 0;
    obs.on('ConnectionClosed', () => closed++);
    await obs.disconnect();
    await obs.disconnect();
    expect(closed).toBe(1);
  });
});
```

- [ ] **Step 2: Run it and verify it fails**

Run: `pnpm vitest run server/test/obs/client.test.ts`. Expected: FAIL, because the modules are missing.

- [ ] **Step 3: Implement**

Add the dependency, then run `pnpm install`.

`server/src/obs/version.ts`:
```ts
// SPDX-License-Identifier: GPL-2.0-or-later
/** Numeric compare of dotted versions ("1.10.0" > "1.4.0"); missing parts count as 0. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map((p) => Number.parseInt(p, 10) || 0);
  const pb = b.split('.').map((p) => Number.parseInt(p, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}
```

`server/src/obs/client.ts`:
```ts
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
```

The auth error message is fixed: `'Authentication failed'`. It never includes the password.

`server/test/support/fake-obs.ts`:
```ts
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

  async connect(): Promise<{ obsWebSocketVersion: string; negotiatedRpcVersion: number }> {
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
```

- [ ] **Step 4: Run it and verify it passes**

Run: `pnpm test && pnpm typecheck`. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/package.json pnpm-lock.yaml server/src/obs server/test/obs server/test/support/fake-obs.ts
git commit -m "feat(server): obs-websocket client wrapper, version compare and fake client"
```

---

### Task 2: Scene graph (nested scenes and groups)

**Files:**
- Create: `server/src/obs/scene-graph.ts`, `server/test/obs/scene-graph.test.ts`

**Interfaces:**
- Consumes: `ObsClient`.
- Produces:
  - `interface SceneItem { sourceName: string; enabled: boolean; kind: 'scene' | 'group' | 'input' }`;
  - `interface SceneGraphData { scenes: Map<string, SceneItem[]>; groups: Map<string, SceneItem[]> }`;
  - `loadSceneGraph(client): Promise<SceneGraphData>`;
  - `visibleInputs(graph, scene): Set<string>`;
  - `sceneNames(graph): string[]`.

**Rules** (TECH-DESIGN §4.3):
- An item with `isGroup: true` is a `group`. Its children come from `GetGroupSceneItemList { sceneName: <group name> }`.
- An item with `sourceType: 'OBS_SOURCE_TYPE_SCENE'` is a nested `scene`.
- Anything else is an `input`.
- `visibleInputs` collects every **enabled** input reachable from the scene, recursing through enabled nested scenes and enabled groups. It guards against cycles and returns an empty set for an unknown scene.
- Items with a missing or non-string `sourceName` are skipped and never guessed.

- [ ] **Step 1: Write the failing test**

`server/test/obs/scene-graph.test.ts`:
```ts
// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import { loadSceneGraph, sceneNames, visibleInputs } from '../../src/obs/scene-graph';
import { FakeObsClient } from '../support/fake-obs';

const item = (sourceName: string, extra: Record<string, unknown> = {}) => ({
  sourceName, sceneItemEnabled: true, sourceType: 'OBS_SOURCE_TYPE_INPUT', isGroup: false, ...extra,
});

function obsWithScenes(): FakeObsClient {
  const obs = new FakeObsClient();
  obs.respond('GetSceneList', () => ({ scenes: [{ sceneName: 'CAM 1' }, { sceneName: 'PLAYOUT' }, { sceneName: 'LOWER' }, { sceneName: 'BREAK' }] }));
  const lists: Record<string, unknown[]> = {
    'CAM 1': [item('Camera 1'), item('LOWER', { sourceType: 'OBS_SOURCE_TYPE_SCENE' })],
    PLAYOUT: [item('Deck Media'), item('Bug', { sceneItemEnabled: false })],
    LOWER: [item('Lower Third'), item('PLAYOUT', { sourceType: 'OBS_SOURCE_TYPE_SCENE', sceneItemEnabled: false })],
    BREAK: [item('Grp', { isGroup: true, sourceType: 'OBS_SOURCE_TYPE_SCENE' }), { sceneItemEnabled: true }],
  };
  obs.respond('GetSceneItemList', (d) => ({ sceneItems: lists[String(d?.sceneName)] ?? [] }));
  obs.respond('GetGroupSceneItemList', (d) => ({ sceneItems: d?.sceneName === 'Grp' ? [item('Tappo'), item('Hidden', { sceneItemEnabled: false })] : [] }));
  return obs;
}

describe('scene graph', () => {
  it('loads scenes, nested scenes and groups', async () => {
    const g = await loadSceneGraph(obsWithScenes());
    expect(sceneNames(g)).toEqual(['CAM 1', 'PLAYOUT', 'LOWER', 'BREAK']);
    expect(g.groups.get('Grp')?.map((i) => i.sourceName)).toEqual(['Tappo', 'Hidden']);
    expect(g.scenes.get('BREAK')).toEqual([{ sourceName: 'Grp', enabled: true, kind: 'group' }]);
  });

  it('collects enabled inputs through enabled nested scenes and groups only', async () => {
    const g = await loadSceneGraph(obsWithScenes());
    expect([...visibleInputs(g, 'CAM 1')].sort()).toEqual(['Camera 1', 'Lower Third']);
    expect([...visibleInputs(g, 'PLAYOUT')]).toEqual(['Deck Media']);
    expect([...visibleInputs(g, 'BREAK')]).toEqual(['Tappo']);
    expect(visibleInputs(g, 'NOPE').size).toBe(0);
  });

  it('survives cycles between nested scenes', () => {
    const g = {
      scenes: new Map([
        ['A', [{ sourceName: 'B', enabled: true, kind: 'scene' as const }, { sourceName: 'In A', enabled: true, kind: 'input' as const }]],
        ['B', [{ sourceName: 'A', enabled: true, kind: 'scene' as const }]],
      ]),
      groups: new Map(),
    };
    expect([...visibleInputs(g, 'A')]).toEqual(['In A']);
  });
});
```

- [ ] **Step 2: Run it and verify it fails** (`pnpm vitest run server/test/obs/scene-graph.test.ts`)

- [ ] **Step 3: Implement**

`server/src/obs/scene-graph.ts`:
```ts
// SPDX-License-Identifier: GPL-2.0-or-later
import type { ObsClient, ObsData } from './client';

export interface SceneItem {
  sourceName: string;
  enabled: boolean;
  kind: 'scene' | 'group' | 'input';
}

export interface SceneGraphData {
  scenes: Map<string, SceneItem[]>;
  groups: Map<string, SceneItem[]>;
}

function toItems(raw: unknown): SceneItem[] {
  if (!Array.isArray(raw)) return [];
  const items: SceneItem[] = [];
  for (const r of raw as ObsData[]) {
    if (typeof r?.sourceName !== 'string') continue;
    const kind = r.isGroup === true ? 'group' : r.sourceType === 'OBS_SOURCE_TYPE_SCENE' ? 'scene' : 'input';
    items.push({ sourceName: r.sourceName, enabled: r.sceneItemEnabled === true, kind });
  }
  return items;
}

/** Reads every scene and group of the current scene collection. */
export async function loadSceneGraph(client: ObsClient): Promise<SceneGraphData> {
  const list = await client.call('GetSceneList');
  const names = Array.isArray(list.scenes)
    ? (list.scenes as ObsData[]).map((s) => s?.sceneName).filter((n): n is string => typeof n === 'string')
    : [];
  const scenes = new Map<string, SceneItem[]>();
  const groups = new Map<string, SceneItem[]>();
  for (const name of names) {
    const items = toItems((await client.call('GetSceneItemList', { sceneName: name })).sceneItems);
    scenes.set(name, items);
    for (const it of items) {
      if (it.kind === 'group' && !groups.has(it.sourceName)) {
        groups.set(it.sourceName, toItems((await client.call('GetGroupSceneItemList', { sceneName: it.sourceName })).sceneItems));
      }
    }
  }
  return { scenes, groups };
}

export function sceneNames(graph: SceneGraphData): string[] {
  return [...graph.scenes.keys()];
}

/** Every enabled input reachable from `scene` through enabled nested scenes and groups. */
export function visibleInputs(graph: SceneGraphData, scene: string): Set<string> {
  const out = new Set<string>();
  const seen = new Set<string>();
  const walk = (items: SceneItem[] | undefined) => {
    for (const it of items ?? []) {
      if (!it.enabled) continue;
      if (it.kind === 'input') out.add(it.sourceName);
      else if (!seen.has(`${it.kind}:${it.sourceName}`)) {
        seen.add(`${it.kind}:${it.sourceName}`);
        walk(it.kind === 'scene' ? graph.scenes.get(it.sourceName) : graph.groups.get(it.sourceName));
      }
    }
  };
  seen.add(`scene:${scene}`);
  walk(graph.scenes.get(scene));
  return out;
}
```

- [ ] **Step 4: Run it and verify it passes** (`pnpm test && pnpm typecheck`)

- [ ] **Step 5: Commit**

```bash
git add server/src/obs/scene-graph.ts server/test/obs/scene-graph.test.ts
git commit -m "feat(server): obs scene graph with nested scenes and groups"
```

---

### Task 3: ObsConnection — credentials, state machine, backoff

**Files:**
- Create: `server/src/obs/connection.ts`, `server/test/obs/connection.test.ts`

**Interfaces:**
- Consumes: `ObsClient`, `ObsAuthError`, `Clock`, `Scheduler`.
- Produces:
  - `interface ObsCredentials { host: string; port: number; password?: string }`;
  - `type ObsConnectionState = 'idle' | 'connecting' | 'connected' | 'auth_failed' | 'disconnected'`;
  - `interface ConnectionHooks { onConnected(client, info): Promise<void> | void; onDisconnected(): void; report(err): void }`;
  - `class ObsConnection` with:
    - `constructor({ clientFactory, clock, scheduler, hooks })`;
    - `setCredentials(creds | null)`;
    - `get state`;
    - `get info`, which returns `{ obsWebSocketVersion } | null`;
    - `stop(): Promise<void>`.

**Rules (DT-5, TECH-DESIGN §4.2):**
- `setCredentials(creds)` disconnects any current client, resets the backoff and starts connecting. `setCredentials(null)` disconnects and goes `idle`.
- Each attempt uses a **fresh client**: `clientFactory()`, then `connect('ws://<host>:<port>', password)`.
- **On success:**
  - attach `ConnectionClosed` and `ExitStarted` listeners;
  - set state `connected`;
  - await `hooks.onConnected(client, info)`. If it throws, report the error, disconnect, and treat the connection as closed.
- **On `ObsAuthError`:**
  - set state `auth_failed`;
  - report it (the message must not contain the password);
  - do **not** retry until the next `setCredentials`.
- **On any other connect error, or when the connection closes:**
  - set state `disconnected`;
  - call `hooks.onDisconnected()`, but only if the previous state was `connected`, so it fires once per connection;
  - schedule a retry after the backoff. The backoff starts at 500 ms, doubles on each failure up to a cap of 5000 ms, and resets to 500 ms after a successful connection.
- Use only `Scheduler.setTimer(clock.now() + delay)`. Never call `setTimeout`.
- `stop()` cancels the timer, disconnects, sets state `idle`, and makes later timers and events no-ops.
- Guard every handler.

- [ ] **Step 1: Write the failing test**

`server/test/obs/connection.test.ts`:
```ts
// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import { FakeTime } from '../../src/clock/clock';
import { ObsAuthError } from '../../src/obs/client';
import { ObsConnection } from '../../src/obs/connection';
import { FakeObsClient } from '../support/fake-obs';

const flush = () => new Promise((r) => setImmediate(r));

function harness(behaviour: Array<'ok' | 'fail' | 'auth'>) {
  const time = new FakeTime();
  const clients: FakeObsClient[] = [];
  const events: string[] = [];
  const errors: unknown[] = [];
  let n = 0;
  const conn = new ObsConnection({
    clock: time,
    scheduler: time,
    clientFactory: () => {
      const c = new FakeObsClient();
      const b = behaviour[Math.min(n++, behaviour.length - 1)];
      if (b === 'fail') c.connectError = new Error('ECONNREFUSED');
      if (b === 'auth') c.connectError = new ObsAuthError('Authentication failed');
      clients.push(c);
      return c;
    },
    hooks: {
      onConnected: () => void events.push('connected'),
      onDisconnected: () => void events.push('disconnected'),
      report: (e) => void errors.push(e),
    },
  });
  return { time, clients, events, errors, conn };
}

describe('ObsConnection', () => {
  it('connects with the given credentials', async () => {
    const h = harness(['ok']);
    h.conn.setCredentials({ host: '127.0.0.1', port: 4455, password: 'secret' });
    await flush();
    expect(h.conn.state).toBe('connected');
    expect(h.events).toEqual(['connected']);
  });

  it('retries with exponential backoff capped at 5 s', async () => {
    const h = harness(['fail', 'fail', 'fail', 'fail', 'fail', 'ok']);
    h.conn.setCredentials({ host: '127.0.0.1', port: 4455 });
    await flush();
    expect(h.conn.state).toBe('disconnected');
    const waits = [500, 1000, 2000, 4000, 5000];
    for (const w of waits) {
      h.time.advance(w - 1);
      await flush();
      const before = h.clients.length;
      h.time.advance(1);
      await flush();
      expect(h.clients.length).toBe(before + 1);
    }
    expect(h.conn.state).toBe('connected');
  });

  it('stops retrying after an authentication failure until new credentials arrive', async () => {
    const h = harness(['auth', 'ok']);
    h.conn.setCredentials({ host: '127.0.0.1', port: 4455, password: 'wrong-password' });
    await flush();
    expect(h.conn.state).toBe('auth_failed');
    h.time.advance(60_000);
    await flush();
    expect(h.clients.length).toBe(1);
    expect(JSON.stringify(h.errors.map(String))).not.toContain('wrong-password');
    h.conn.setCredentials({ host: '127.0.0.1', port: 4455, password: 'right' });
    await flush();
    expect(h.conn.state).toBe('connected');
  });

  it('reports a lost connection once, then reconnects', async () => {
    const h = harness(['ok', 'ok']);
    h.conn.setCredentials({ host: '127.0.0.1', port: 4455 });
    await flush();
    h.clients[0]!.emit('ExitStarted', {});
    h.clients[0]!.emit('ConnectionClosed', { code: 1001 });
    await flush();
    expect(h.events).toEqual(['connected', 'disconnected']);
    h.time.advance(500);
    await flush();
    expect(h.events).toEqual(['connected', 'disconnected', 'connected']);
  });

  it('stop() cancels everything', async () => {
    const h = harness(['fail']);
    h.conn.setCredentials({ host: '127.0.0.1', port: 4455 });
    await flush();
    await h.conn.stop();
    expect(h.time.pending).toBe(0);
    expect(h.conn.state).toBe('idle');
  });
});
```

- [ ] **Step 2: Run it and verify it fails**

- [ ] **Step 3: Implement** `server/src/obs/connection.ts` to satisfy the rules above. The essential shape:
```ts
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
    const client = this.deps.clientFactory();
    try {
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
        this.deps.hooks.report(err);
        await client.disconnect().catch(() => undefined);
        this.onClosed(gen, client);
      }
    } catch (err) {
      if (gen !== this.generation) return;
      if (err instanceof ObsAuthError) { this.deps.hooks.report(err); this.setState('auth_failed'); return; }
      this.deps.hooks.report(err);
      this.setState('disconnected');
      this.scheduleRetry(gen);
    }
  }

  private onClosed(gen: number, client: ObsClient): void {
    if (gen !== this.generation || this.client !== client) return;
    this.client = null;
    const wasConnected = this._state === 'connected';
    this.setState('disconnected');
    if (wasConnected) {
      try { this.deps.hooks.onDisconnected(); } catch (err) { this.deps.hooks.report(err); }
    }
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
    if (c) await c.disconnect().catch(() => undefined);
    if (wasConnected) { try { this.deps.hooks.onDisconnected(); } catch (err) { this.deps.hooks.report(err); } }
  }

  private setState(s: ObsConnectionState): void { this._state = s; }
}
```

Note on the backoff sequence. The first failure schedules a retry after 500 ms. Each later failure doubles the delay: 1000, 2000, 4000, then 5000 (capped). The test expects exactly this sequence.

- [ ] **Step 4: Run it and verify it passes** (`pnpm test && pnpm typecheck`)

- [ ] **Step 5: Commit**

```bash
git add server/src/obs/connection.ts server/test/obs/connection.test.ts
git commit -m "feat(server): obs connection with backoff, auth-failure stop and single disconnect notice"
```

---

### Task 4: ObsAdapter — initial sync, events, media polling

**Files:**
- Create: `server/src/obs/obs-adapter.ts`, `server/test/obs/obs-adapter.test.ts`

**Interfaces:**
- Consumes: `ObsClient`, `loadSceneGraph`, `visibleInputs`, `Clock`, `Scheduler`, `LiveRuntime`'s `dispatch(WithoutAt<EngineInput>)` and `getState()`.
- Produces:
  - `interface ObsAdapterDeps`:
    - `client`;
    - `clock`;
    - `scheduler`;
    - `dispatch(input): boolean`;
    - `getState(): LiveState | null`;
    - `deckSourceName(): string | null`;
    - `report(err)`.
  - `class ObsAdapter` with:
    - `start(): Promise<void>`, which runs the initial sync and attaches listeners;
    - `stop()`, which detaches listeners and cancels timers;
    - `refreshProgram()`, which re-dispatches the Program scene with the current `deckOnProgram`; the deck adapter calls it when the deck's bound source changes;
    - `get programScene`;
    - `get graph`.

**Rules:**

1. **`start()`, the initial sync.** Run these steps in order:
   1. Load the scene graph.
   2. Call `GetCurrentProgramScene` and use `sceneName`, falling back to `currentProgramSceneName`.
   3. Call `GetRecordStatus` and `GetStreamStatus`.
   4. **Reconcile outputs with `getState().outputs`** (Review Focus 3), separately for `rec` and `stream`:
      - OBS active and the runtime inactive → dispatch `OutputChanged` `started`;
      - OBS inactive and the runtime active → dispatch `stopped`;
      - for REC only, OBS `outputPaused` differing from the runtime's `recPaused` → dispatch `paused` or `resumed`.
   5. Dispatch `SourceRestored`.
   6. Dispatch `ProgramSceneChanged { scene, deckOnProgram }`, where `deckOnProgram` is `visibleInputs(graph, scene).has(deckSourceName())`.
   7. Attach the listeners and start media polling.

   If any step throws, `start()` rejects and dispatches nothing more. `ObsConnection` then reports the error and reconnects.
2. **Events.** Every handler is guarded with `try`/`catch` → `report`.
   - `CurrentProgramSceneChanged { sceneName }` → update `programScene` and dispatch `ProgramSceneChanged`.
   - `SceneItemEnableStateChanged`, `SceneItemCreated`, `SceneItemRemoved`, `SceneListChanged` → schedule a **graph reload debounced at 100 ms**. After the reload, dispatch `ProgramSceneChanged` for the current scene, because `deckOnProgram` may have changed.
   - `RecordStateChanged` and `StreamStateChanged { outputState }` → map them following the Global Constraints and dispatch `OutputChanged`. Ignore unmapped states.
3. **Media polling (break filler).**
   - Every **250 ms** through `Scheduler`, list the `mediaInput` values of the loaded episode's break blocks (from `getState().episode.blocks`) that are in `visibleInputs(graph, programScene)`.
   - For each one, call `GetMediaInputStatus { inputName }` and map the result to `MediaStatus { input, playing: mediaState === 'OBS_MEDIA_STATE_PLAYING', cursorMs: mediaCursor, durationMs: mediaDuration }`. If `mediaCursor` or `mediaDuration` is not a finite number, skip it and never guess.
   - **Deduplicate (Review Focus 4).** Dispatch only when one of these holds:
     - the input has no previous dispatch;
     - `playing` changed;
     - `durationMs` changed;
     - `|cursorMs − expected| > 500`, where `expected = last.cursorMs + (last.playing ? now − last.at : 0)`.
   - `MediaInputPlaybackStarted` and `MediaInputPlaybackEnded` for a polled input trigger an immediate poll of that input.
   - A failed `GetMediaInputStatus` is reported once per input until it succeeds again. It never crashes the loop.
4. **`stop()`** removes every listener it added and cancels the debounce and polling timers. After `stop()`, nothing is dispatched any more.

- [ ] **Step 1: Write the failing test**

`server/test/obs/obs-adapter.test.ts`:
```ts
// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import { soloFutsalEpisode } from '@olc/shared/testing';
import { FakeTime } from '../../src/clock/clock';
import { createLiveState, type LiveState } from '../../src/engine/index';
import { ObsAdapter } from '../../src/obs/obs-adapter';
import { FakeObsClient } from '../support/fake-obs';

const flush = () => new Promise((r) => setImmediate(r));
const item = (sourceName: string, extra: Record<string, unknown> = {}) => ({
  sourceName, sceneItemEnabled: true, sourceType: 'OBS_SOURCE_TYPE_INPUT', isGroup: false, ...extra,
});

function setup(opts: { rec?: boolean; runtimeRec?: boolean } = {}) {
  const time = new FakeTime();
  const obs = new FakeObsClient();
  const scenes: Record<string, unknown[]> = {
    'CAM 1': [item('Camera 1')],
    PLAYOUT: [item('Deck Media')],
    BREAK: [item('Tappo')],
  };
  let program = 'CAM 1';
  obs.respond('GetSceneList', () => ({ scenes: Object.keys(scenes).map((sceneName) => ({ sceneName })) }));
  obs.respond('GetSceneItemList', (d) => ({ sceneItems: scenes[String(d?.sceneName)] ?? [] }));
  obs.respond('GetGroupSceneItemList', () => ({ sceneItems: [] }));
  obs.respond('GetCurrentProgramScene', () => ({ sceneName: program, currentProgramSceneName: program }));
  obs.respond('GetRecordStatus', () => ({ outputActive: opts.rec ?? false, outputPaused: false }));
  obs.respond('GetStreamStatus', () => ({ outputActive: false }));
  const media = { mediaState: 'OBS_MEDIA_STATE_PLAYING', mediaCursor: 0, mediaDuration: 180_000 };
  obs.respond('GetMediaInputStatus', () => ({ ...media }));
  const state: LiveState = createLiveState(soloFutsalEpisode());
  if (opts.runtimeRec) state.outputs.rec = true;
  const dispatched: Array<Record<string, unknown>> = [];
  const errors: unknown[] = [];
  const adapter = new ObsAdapter({
    client: obs, clock: time, scheduler: time,
    dispatch: (i) => { dispatched.push(i as Record<string, unknown>); return true; },
    getState: () => state,
    deckSourceName: () => 'Deck Media',
    report: (e) => void errors.push(e),
  });
  return { time, obs, adapter, dispatched, errors, media, setProgram: (p: string) => (program = p), scenes };
}

const types = (d: Array<Record<string, unknown>>) => d.map((x) => x.type);

describe('ObsAdapter', () => {
  it('syncs, then restores the source, then reports the Program scene', async () => {
    const h = setup();
    await h.adapter.start();
    expect(types(h.dispatched)).toEqual(['SourceRestored', 'ProgramSceneChanged']);
    expect(h.dispatched[1]).toEqual({ type: 'ProgramSceneChanged', scene: 'CAM 1', deckOnProgram: false });
  });

  it('reconciles outputs: OBS recording while the runtime is not, and the reverse', async () => {
    const a = setup({ rec: true });
    await a.adapter.start();
    expect(a.dispatched[0]).toEqual({ type: 'OutputChanged', output: 'rec', state: 'started' });
    const b = setup({ rec: false, runtimeRec: true });
    await b.adapter.start();
    expect(b.dispatched[0]).toEqual({ type: 'OutputChanged', output: 'rec', state: 'stopped' });
  });

  it('maps scene and output events, computing deckOnProgram from the scene graph', async () => {
    const h = setup();
    await h.adapter.start();
    h.dispatched.length = 0;
    h.obs.emit('CurrentProgramSceneChanged', { sceneName: 'PLAYOUT' });
    h.obs.emit('RecordStateChanged', { outputActive: true, outputState: 'OBS_WEBSOCKET_OUTPUT_STARTING' });
    h.obs.emit('RecordStateChanged', { outputActive: true, outputState: 'OBS_WEBSOCKET_OUTPUT_STARTED' });
    h.obs.emit('StreamStateChanged', { outputActive: false, outputState: 'OBS_WEBSOCKET_OUTPUT_STOPPED' });
    expect(h.dispatched).toEqual([
      { type: 'ProgramSceneChanged', scene: 'PLAYOUT', deckOnProgram: true },
      { type: 'OutputChanged', output: 'rec', state: 'started' },
      { type: 'OutputChanged', output: 'stream', state: 'stopped' },
    ]);
  });

  it('reloads the graph (debounced) when scene items change and re-reports Program', async () => {
    const h = setup();
    await h.adapter.start();
    h.dispatched.length = 0;
    h.scenes['CAM 1'] = [item('Camera 1'), item('Deck Media')];
    h.obs.emit('SceneItemEnableStateChanged', { sceneName: 'CAM 1', sceneItemId: 2, sceneItemEnabled: true });
    h.obs.emit('SceneItemCreated', { sceneName: 'CAM 1', sourceName: 'Deck Media' });
    h.time.advance(100);
    await flush();
    await flush();
    expect(h.dispatched).toEqual([{ type: 'ProgramSceneChanged', scene: 'CAM 1', deckOnProgram: true }]);
  });

  it('polls the visible break filler and deduplicates by extrapolation', async () => {
    const h = setup();
    await h.adapter.start();
    h.obs.emit('CurrentProgramSceneChanged', { sceneName: 'BREAK' });
    h.dispatched.length = 0;
    h.time.advance(250);
    await flush();
    expect(h.dispatched).toEqual([{ type: 'MediaStatus', input: 'Tappo', playing: true, cursorMs: 0, durationMs: 180_000 }]);
    for (let i = 1; i <= 8; i++) {
      h.media.mediaCursor = i * 250;
      h.time.advance(250);
      await flush();
    }
    expect(h.dispatched).toHaveLength(1);
    h.media.mediaCursor = 10_000;
    h.time.advance(250);
    await flush();
    expect(h.dispatched).toHaveLength(2);
    h.media.mediaState = 'OBS_MEDIA_STATE_PAUSED';
    h.time.advance(250);
    await flush();
    expect(h.dispatched.at(-1)).toMatchObject({ type: 'MediaStatus', playing: false });
  });

  it('never dispatches guessed media values and never crashes on bad data', async () => {
    const h = setup();
    await h.adapter.start();
    h.obs.emit('CurrentProgramSceneChanged', { sceneName: 'BREAK' });
    h.dispatched.length = 0;
    h.media.mediaCursor = null as unknown as number;
    h.time.advance(250);
    await flush();
    h.obs.emit('CurrentProgramSceneChanged', { nope: true });
    h.obs.emit('RecordStateChanged', {});
    expect(h.dispatched).toEqual([]);
  });

  it('stop() detaches listeners and timers', async () => {
    const h = setup();
    await h.adapter.start();
    h.adapter.stop();
    expect(h.obs.listenerCount('CurrentProgramSceneChanged')).toBe(0);
    expect(h.time.pending).toBe(0);
  });
});
```

- [ ] **Step 2: Run it and verify it fails**

- [ ] **Step 3: Implement** `server/src/obs/obs-adapter.ts` following the rules above.

  Guidance (binding):
  - Keep a `listeners` list of `[event, fn]` pairs so that `stop()` can detach them.
  - Use one `Scheduler` timer for polling and re-arm it after each poll. Do not use an interval.
  - Use a separate timer for the graph debounce.
  - Compute `deckOnProgram` as follows:
    ```ts
    const src = deps.deckSourceName();
    src !== null && visibleInputs(graph, scene).has(src);
    ```
  - Map `outputState` with a lookup table:
    ```ts
    { OBS_WEBSOCKET_OUTPUT_STARTED: 'started', OBS_WEBSOCKET_OUTPUT_STOPPED: 'stopped', OBS_WEBSOCKET_OUTPUT_PAUSED: 'paused', OBS_WEBSOCKET_OUTPUT_RESUMED: 'resumed' }
    ```
    For `stream`, ignore `paused` and `resumed`.
  - The poll reads break inputs like this:
    ```ts
    state.episode.blocks.filter(b => b.kind === 'break' && b.mediaInput !== null).map(b => b.mediaInput)
    ```

- [ ] **Step 4: Run it and verify it passes** (`pnpm test && pnpm typecheck`)

- [ ] **Step 5: Commit**

```bash
git add server/src/obs/obs-adapter.ts server/test/obs/obs-adapter.test.ts
git commit -m "feat(server): obs adapter with initial sync, output reconciliation and deduplicated media polling"
```

---

### Task 5: DeckAdapter — Playlist Deck vendor requests, events and legacy polling

**Files:**
- Create: `server/src/obs/deck-adapter.ts`, `server/test/obs/deck-adapter.test.ts`

**Interfaces:**
- Consumes: `ObsClient`, `compareVersions`, `Clock`, `Scheduler`, `dispatch`.
- Produces:
  - `type DeckCapability = 'absent' | 'legacy' | 'events'`;
  - `interface DeckStatusInfo { capability: DeckCapability; version: string | null; sourceName: string | null; playlistName: string | null }`;
  - `class DeckAdapter` with:
    - `constructor({ client, clock, scheduler, dispatch, report, onSourceChanged })`;
    - `start(): Promise<void>`;
    - `stop()`;
    - `get info(): DeckStatusInfo`;
    - `items(): DeckItem[] | null`, the last known items;
    - `sourceName(): string | null`.

**Rules:**
1. **`start()`.**
   - Call the vendor `GetStatus` through `CallVendorRequest { vendorName: 'obs-playlist-deck', requestType: 'GetStatus', requestData: {} }`, reading `responseData`.
   - If this throws `ObsRequestError`, the vendor is **absent**: set `capability 'absent'`, report it once, and return. Do not poll.
   - Otherwise:
     1. Determine the capability: `pluginVersion` ≥ `1.4.0` means `events`; otherwise `legacy`.
     2. Store `sourceName` and `playlistName`.
     3. Fetch all items through paginated `GetItems { from, to }` with a page size of 200. Read `count`, then request pages until done. Map every entry to `DeckItem { index, path, title, durationMs }`, where `durationMs` is `-1` when missing or not a number. Skip entries without a numeric `index` or a string `path`.
     4. Dispatch `DeckPlaylistChanged { items }`.
     5. If `currentIndex >= 0`, dispatch `DeckPlayback { index: currentIndex, positionMs, durationMs, playing }` from the status.
     6. In `events` mode, attach the `VendorEvent` listener. In `legacy` mode, start polling every **2000 ms**: re-read `GetStatus` and the items, and dispatch `DeckPlaylistChanged` only when the item list differs (deep compare of index, path, title and duration).
2. **`VendorEvent { vendorName, eventType, eventData }`.** Ignore every vendor other than `obs-playlist-deck`. Guard every branch.
   - `item-started { index, title, path, durationMs }` → `DeckItemStarted`. Skip it if `index` is not numeric or `path` is not a string. A missing duration becomes `-1`.
   - `playback-state { playing, positionMs, durationMs, index }` → `DeckPlayback`, **deduplicated** with the same rule as media, 500 ms drift. The extrapolation applies only while playing. A change of `index` always dispatches.
   - `playlist-changed { reason }` → **debounce 150 ms**, then re-read `GetStatus` (for `sourceName`, which may have changed) and all items, then dispatch `DeckPlaylistChanged`. If `sourceName` changed, call `onSourceChanged()`.
   - `playlist-completed` → nothing to dispatch.
3. **`stop()`** detaches the listener and cancels the timers.

- [ ] **Step 1: Write the failing test**

`server/test/obs/deck-adapter.test.ts`:
```ts
// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import { FakeTime } from '../../src/clock/clock';
import { ObsRequestError } from '../../src/obs/client';
import { DeckAdapter } from '../../src/obs/deck-adapter';
import { FakeObsClient } from '../support/fake-obs';

const flush = () => new Promise((r) => setImmediate(r));

function setup(version: string | null) {
  const time = new FakeTime();
  const obs = new FakeObsClient();
  const status = {
    ok: true, pluginVersion: version, sourceName: 'Deck Media', playlistName: 'Puntata',
    currentIndex: -1, positionMs: -1, durationMs: -1, playing: false, count: 2,
  };
  let items = [
    { index: 0, title: 'Servizio 1', path: 'D:/media/servizio1.mp4', durationMs: 185_000 },
    { index: 1, title: 'Servizio 2', path: 'D:/media/servizio2.mp4' },
  ];
  obs.respond('CallVendorRequest', (d) => {
    if (version === null) throw new ObsRequestError(600, 'vendor not found');
    if (d?.requestType === 'GetStatus') return { responseData: { ...status, count: items.length } };
    const r = d?.requestData as { from: number; to: number };
    return { responseData: { ok: true, count: items.length, items: items.slice(r.from, r.to + 1) } };
  });
  const dispatched: Array<Record<string, unknown>> = [];
  const errors: unknown[] = [];
  let sourceChanges = 0;
  const deck = new DeckAdapter({
    client: obs, clock: time, scheduler: time,
    dispatch: (i) => { dispatched.push(i as Record<string, unknown>); return true; },
    report: (e) => void errors.push(e),
    onSourceChanged: () => void sourceChanges++,
  });
  return {
    time, obs, deck, dispatched, errors, status,
    setItems: (x: typeof items) => (items = x),
    sourceChanges: () => sourceChanges,
  };
}

const vendor = (eventType: string, eventData: Record<string, unknown>) => ({ vendorName: 'obs-playlist-deck', eventType, eventData });

describe('DeckAdapter', () => {
  it('loads status and all items; unknown durations are -1', async () => {
    const h = setup('1.4.0');
    await h.deck.start();
    expect(h.deck.info).toEqual({ capability: 'events', version: '1.4.0', sourceName: 'Deck Media', playlistName: 'Puntata' });
    expect(h.dispatched).toEqual([{
      type: 'DeckPlaylistChanged',
      items: [
        { index: 0, path: 'D:/media/servizio1.mp4', title: 'Servizio 1', durationMs: 185_000 },
        { index: 1, path: 'D:/media/servizio2.mp4', title: 'Servizio 2', durationMs: -1 },
      ],
    }]);
  });

  it('treats a missing vendor as absent without crashing', async () => {
    const h = setup(null);
    await h.deck.start();
    expect(h.deck.info.capability).toBe('absent');
    expect(h.dispatched).toEqual([]);
    expect(h.time.pending).toBe(0);
  });

  it('maps item-started and deduplicates playback-state', async () => {
    const h = setup('1.4.0');
    await h.deck.start();
    h.dispatched.length = 0;
    h.obs.emit('VendorEvent', vendor('item-started', { index: 0, title: 'Servizio 1', path: 'D:/media/servizio1.mp4', durationMs: 185_000 }));
    h.obs.emit('VendorEvent', vendor('playback-state', { playing: true, positionMs: 0, durationMs: 185_000, index: 0 }));
    for (let i = 1; i <= 5; i++) {
      h.time.advance(1_000);
      h.obs.emit('VendorEvent', vendor('playback-state', { playing: true, positionMs: i * 1_000, durationMs: 185_000, index: 0 }));
    }
    h.obs.emit('VendorEvent', vendor('playback-state', { playing: false, positionMs: 5_000, durationMs: 185_000, index: 0 }));
    h.obs.emit('VendorEvent', { vendorName: 'other', eventType: 'item-started', eventData: { index: 9, path: 'x' } });
    expect(h.dispatched.map((d) => d.type)).toEqual(['DeckItemStarted', 'DeckPlayback', 'DeckPlayback']);
    expect(h.dispatched[2]).toMatchObject({ playing: false, positionMs: 5_000 });
  });

  it('re-reads the playlist on playlist-changed (debounced) and notices a new bound source', async () => {
    const h = setup('1.4.0');
    await h.deck.start();
    h.dispatched.length = 0;
    h.setItems([{ index: 0, title: 'Servizio 2', path: 'D:/media/servizio2.mp4', durationMs: 120_000 }]);
    h.status.sourceName = 'Other Media';
    h.obs.emit('VendorEvent', vendor('playlist-changed', { reason: 'removed', playlistName: 'Puntata', count: 1 }));
    h.obs.emit('VendorEvent', vendor('playlist-changed', { reason: 'durations-updated', playlistName: 'Puntata', count: 1 }));
    h.time.advance(150);
    await flush();
    await flush();
    expect(h.dispatched).toEqual([{ type: 'DeckPlaylistChanged', items: [{ index: 0, path: 'D:/media/servizio2.mp4', title: 'Servizio 2', durationMs: 120_000 }] }]);
    expect(h.deck.sourceName()).toBe('Other Media');
    expect(h.sourceChanges()).toBe(1);
  });

  it('polls GetItems every 2 s on legacy plugins and dispatches only on change', async () => {
    const h = setup('1.3.3');
    await h.deck.start();
    expect(h.deck.info.capability).toBe('legacy');
    h.dispatched.length = 0;
    h.time.advance(2_000);
    await flush();
    await flush();
    expect(h.dispatched).toEqual([]);
    h.setItems([{ index: 0, title: 'Servizio 1', path: 'D:/media/servizio1.mp4', durationMs: 185_000 }]);
    h.time.advance(2_000);
    await flush();
    await flush();
    expect(h.dispatched.map((d) => d.type)).toEqual(['DeckPlaylistChanged']);
  });
});
```

- [ ] **Step 2: Run it and verify it fails**

- [ ] **Step 3: Implement** `server/src/obs/deck-adapter.ts` following the rules above. Use the same listener-tracking, single re-armed timer, guarded-handler and report-once patterns as Task 4.

- [ ] **Step 4: Run it and verify it passes**

- [ ] **Step 5: Commit**

```bash
git add server/src/obs/deck-adapter.ts server/test/obs/deck-adapter.test.ts
git commit -m "feat(server): playlist deck adapter with events, debounced re-reads and legacy polling"
```

---

### Task 6: ObsService — wiring connection, adapters and runtime

**Files:**
- Create: `server/src/obs/obs-service.ts`, `server/test/obs/obs-service.test.ts`

**Interfaces:**
- Consumes: Tasks 1–5, and `LiveRuntime` (Plan 2).
- Produces:
  - `interface ObsStatus`:
    - `connection: ObsConnectionState`;
    - `obsWebSocketVersion: string | null`;
    - `programScene: string | null`;
    - `deck: DeckStatusInfo | null`;
  - `class ObsService` with:
    - `constructor({ runtime, clock, scheduler, clientFactory, report })`;
    - `setCredentials(creds | null)`;
    - `status(): ObsStatus`;
    - `sceneNames(): string[] | null`;
    - `deckItems(): DeckItem[] | null`;
    - `client(): ObsClient | null`;
    - `stop()`.

**Rules:**
- **`onConnected(client)`.**
  1. Create a `DeckAdapter` and run `await deck.start()`. If `start()` throws for any reason other than an absent vendor, the error propagates and the connection reconnects.
  2. Create an `ObsAdapter` with `deckSourceName = () => deck.sourceName()` and `getState = () => runtime.getState()`, and run `await adapter.start()`.
  3. Wire `deck.onSourceChanged` to `adapter.refreshProgram()`.

  The deck starts first so that its items and source name are known before the Program scene is first reported.
- **`onDisconnected()`.** Stop both adapters, then dispatch `SourceLost` once.
- `dispatch` means `(i) => runtime.dispatch(i)`.
- **`status()`.** Combine `connection.state`, `connection.info`, `adapter?.programScene ?? null` and `deck?.info ?? null`.
- **`stop()`.** Stop the connection and both adapters.

- [ ] **Step 1: Write the failing test**

`server/test/obs/obs-service.test.ts` uses `makeRuntime` (Plan 2 support), `soloFutsalEpisode`, and a `FakeObsClient` factory configured as in Task 4 (scenes `CAM 1`, `PLAYOUT`, `BREAK`; deck version `1.4.0` with the two Solo Futsal items, bound source `Deck Media` in `PLAYOUT`). Required cases:

1. **Connected.** After `setCredentials`, `flush`:
   - `status().connection === 'connected'`;
   - the runtime state has `obs === 'ok'`;
   - `deck.items` equals the two items;
   - `program.scene === 'CAM 1'`.
2. **Deck on Program.** Emitting `CurrentProgramSceneChanged PLAYOUT` and then deck `item-started` index 0 on a live runtime puts the runtime cursor on slot 1. Go live first by dispatching `OutputChanged rec started` through the fake's `RecordStateChanged STARTED`.
3. **Disconnect.** Emitting `ConnectionClosed`:
   - sets the runtime `obs` to `'lost'`;
   - makes the presenter view block anchor `source === 'estimated'`;
   - makes the service status `disconnected`.
4. **Reconnect.** Advancing 500 ms reconnects, and the runtime `obs` is `'ok'` again.
5. **Absent vendor.** With the vendor absent, the service still connects, `status().deck.capability === 'absent'`, and the Program scene is still reported.

Write all five as concrete `it(...)` blocks, using these exact values.

- [ ] **Step 2: Run it and verify it fails**

- [ ] **Step 3: Implement** `server/src/obs/obs-service.ts`.

- [ ] **Step 4: Run it and verify it passes**

- [ ] **Step 5: Commit**

```bash
git add server/src/obs/obs-service.ts server/test/obs/obs-service.test.ts
git commit -m "feat(server): obs service wiring connection, deck and obs adapters into the runtime"
```

---

### Task 7: Credential hand-off endpoint, remote settings, secret token ACL

**Files:**
- Create: `server/src/api/internal.ts`, `server/test/api/internal.test.ts`
- Modify: `server/src/app/settings.ts` (optional `obs`), `server/src/app/secret.ts` (Windows ACL), `server/test/app/basics.test.ts`

**Interfaces:**
- Produces:
  - `registerInternal(app, { token: string; obs: Pick<ObsService, 'setCredentials'> })`.
  - `Settings.obs?: { host: string; port: number; password?: string }`. The zod schema for it: `host` is a min-1 string with default `'127.0.0.1'`; `port` is an integer from 1 to 65535 with default `4455`; `password` is an optional string.
  - `ensureSecretToken(path, { platform?, restrictAcl? })`. On `win32` it calls `restrictAcl(path)` (default: `execFile('icacls', [path, '/inheritance:r', '/grant:r', `${process.env.USERNAME}:F`])`) after creating the token. A failure is reported through the returned promise as `{ token, aclWarning?: string }`, and is **never fatal**.

  Note: this changes the return type to an object. Update `buildServer` and the existing tests accordingly.

**Rules (DT-5):**
- `POST /api/internal/obs-credentials` is accepted **only** when all of these hold:
  - `request.socket.remoteAddress` is one of `127.0.0.1`, `::1`, `::ffff:127.0.0.1`;
  - `Authorization: Bearer <token>` matches, compared with `crypto.timingSafeEqual` on equal-length buffers (different lengths → reject);
  - the body is `{ port: int 1..65535, password?: string, host?: string }`, where `host` defaults to `127.0.0.1`.
- Failures:
  - non-loopback request → 403 `{ error: 'forbidden' }`;
  - wrong or missing token → 401 `{ error: 'unauthorized' }`;
  - bad body → 400 `{ error: 'invalid_body' }`, **with no zod issues echoed**, because issues could contain the password.
- On success: call `obs.setCredentials(...)` and reply 204.
- The password must never appear in any response or log line. Add a test that captures the Fastify logger output (pino stream) during a valid request and an invalid one, and asserts the password string is absent.
- **Remote mode.** `main.ts` and `buildServer`: when `settings.obs` exists, call `obsService.setCredentials(settings.obs)` at startup. Credentials received from the plugin replace it.

- [ ] **Step 1: Write the failing tests.** The required cases are below. Use `app.inject`, which sets `remoteAddress` to `127.0.0.1`. For the non-loopback case, pass `remoteAddress: '192.168.1.20'` in the inject options.
  - 204 and `setCredentials` called with `{ host: '127.0.0.1', port: 4455, password: 'pw' }` for a valid request.
  - 401 for a wrong token, a token of a different length, and a missing header.
  - 403 from a non-loopback address, even with the right token.
  - 400 for `{ port: 'x', password: 'pw' }`, and the response body does not contain `pw`.
  - Logger capture shows no `pw`.
  - Settings: `{ obs: { port: 4456 } }` parses to `{ host: '127.0.0.1', port: 4456 }`. A missing `obs` stays `undefined`.
  - Secret on `win32`, with an injected `restrictAcl` that records its argument: it is called once with the token path. An injected failing `restrictAcl` yields `aclWarning` and still returns the token.

- [ ] **Step 2: Run it and verify it fails**

- [ ] **Step 3: Implement**

- [ ] **Step 4: Run it and verify it passes** (`pnpm test && pnpm typecheck`)

- [ ] **Step 5: Commit**

```bash
git add server/src/api/internal.ts server/src/app/settings.ts server/src/app/secret.ts server/test
git commit -m "feat(server): loopback credential hand-off, remote obs settings and windows acl on the secret token"
```

---

### Task 8: OBS HTTP endpoints and Check OBS

**Files:**
- Create: `server/src/api/obs.ts`, `server/test/api/obs.test.ts`
- Modify: `server/src/app/server.ts` (create the `ObsService`, register `internal` and `obs` routes, start remote settings credentials, stop the service on close), `server/src/app/main.ts` (pass settings)

**Interfaces:**
- Produces: `registerObsRoutes(app, { obs: ObsService, episodes: DocumentRepository<Episode> })`. `buildServer` gets a new option `obsClientFactory?: () => ObsClient`, with `createObsClient` as the default.

**Routes:**

| Route | Response |
|---|---|
| `GET /api/obs/status` | `ObsStatus` |
| `GET /api/obs/scenes` | `{ scenes: string[] }`, or 409 `{ error: 'obs_not_connected' }` |
| `GET /api/deck/items` | `{ items: Array<DeckItem & { occurrence: number }> }`, or 409 `obs_not_connected`, or 404 `{ error: 'deck_absent' }`. `occurrence` is the 0-based count of earlier items with the same path, used by the editor (Plan 5) to create media elements. |
| `POST /api/obs/check { episodeId }` | `{ connected, obsWebSocketVersion, deck: DeckStatusInfo \| null, issues: Issue[] }` (see below) |

`Issue` is `{ severity: 'error' | 'warning'; code: string; blockId: string | null; message: string }`.

Check OBS (SPEC F7) codes, computed against the live OBS state through the service:
- `obs_not_connected` (error): the only issue returned when not connected.
- `scene_missing` (error): a studio scene-group scene or a break `scene` that is not in `GetSceneList`.
- `media_input_missing` (error): a break `mediaInput` that is not among the inputs returned by `GetInputList`, read from `inputs[].inputName`.
- `deck_absent` (error) when the episode has media elements; `deck_legacy` (warning) when the capability is `legacy`.
- `deck_item_missing` (error): a media element whose `(path, occurrence)` does not resolve in the deck items.
- `deck_duration_unknown` (warning): the resolved item has `durationMs < 0`.

**Tests** (`app.inject` with a `buildServer` built on a `FakeObsClient` factory and `FakeTime`):
- `status` while disconnected, then connected.
- `scenes` returns 409 before connecting and lists the scenes after.
- `deck/items` returns occurrences; with two items sharing one path, the occurrences are 0 and 1.
- `check` on the Solo Futsal episode:
  - against a complete fake OBS, it returns `issues: []`;
  - remove scene `BREAK` from the fake → `scene_missing` on block `br1`;
  - make the deck items lack `servizio2.mp4` → `deck_item_missing` on `b2`;
  - with OBS disconnected → only `obs_not_connected`.

- [ ] Steps 1–5 as usual (failing test, run it, implement, run it, commit):
```bash
git add server/src/api/obs.ts server/src/app server/test
git commit -m "feat(server): obs status, scenes, deck items and check obs endpoints; service wired into the server"
```

---

### Task 9: `tools/obs-sim` — obs-websocket v5 simulator and integration test

**Files:**
- Modify: `pnpm-workspace.yaml` (add `tools/obs-sim`), `vitest.config.ts` (add `tools/**/test/**/*.test.ts`)
- Create: `tools/obs-sim/package.json` (`@olc/obs-sim`, deps `ws`, `exports: "./src/index.ts"`, scripts `start` and `typecheck` (`tsc -p tsconfig.json`)), `tools/obs-sim/tsconfig.json`, `tools/obs-sim/src/index.ts`, `tools/obs-sim/src/cli.ts`, `tools/obs-sim/test/sim.test.ts`
- Create: `server/test/integration/obs-sim.test.ts` (server devDependency `"@olc/obs-sim": "workspace:*"`)

**Protocol (obs-websocket v5, JSON, subprotocol `obswebsocket.json`).** Messages are `{ op, d }`.

1. **On connect**, send `op 0 Hello`: `{ obsWebSocketVersion: '5.5.0', rpcVersion: 1, authentication?: { challenge, salt } }`. Include `authentication` only when a password is set.
2. **Client `op 1 Identify`** `{ rpcVersion, authentication?, eventSubscriptions? }`.
   - With a password, check `authentication === base64(sha256(base64(sha256(password + salt)) + challenge))`.
   - On a mismatch, close with code **4009** and reason `'Authentication failed.'`.
   - Otherwise send `op 2 Identified` `{ negotiatedRpcVersion: 1 }`.
3. **Client `op 6 Request`** `{ requestType, requestId, requestData }` → `op 7 RequestResponse` `{ requestType, requestId, requestStatus: { result, code, comment? }, responseData? }`.
   - Success uses code `100`.
   - An unknown request returns `result: false, code: 204`.
   - A vendor request to an absent vendor returns `result: false, code: 600`.
4. **Events:** `op 5 Event` `{ eventType, eventIntent: 1, eventData }`.

**Simulated state and API** (`startObsSim(opts)` returns `ObsSim`):
- `opts`:
  - `port` (0 = random);
  - `password?`;
  - `scenes: Record<string, Array<{ sourceName; enabled?; kind?: 'input' | 'scene' | 'group' }>>`;
  - `groups?`;
  - `inputs?: string[]`;
  - `program: string`;
  - `deck?: { version: string; sourceName: string; items: Array<{ title; path; durationMs }> } | null`.
- `ObsSim` exposes:
  - `port`;
  - `close()`;
  - `setProgram(scene)`, which updates the state and emits `CurrentProgramSceneChanged`;
  - `setRecord(state: 'started' | 'stopped' | 'paused' | 'resumed')`, which emits `RecordStateChanged` with the mapped `OBS_WEBSOCKET_OUTPUT_*`, and the same for `setStream`;
  - `setMedia(input, { state, cursor, duration })`;
  - `deckPlay(index)`, which emits the vendor `item-started` and sets the playing state;
  - `deckPlayback(positionMs, playing)`, which emits `playback-state`;
  - `deckSetItems(items)`, which emits `playlist-changed`;
  - `dropConnections()`, which terminates every client socket to simulate OBS crashing.
- Supported requests:
  - `GetVersion`;
  - `GetSceneList`;
  - `GetSceneItemList`;
  - `GetGroupSceneItemList`;
  - `GetCurrentProgramScene` (both `sceneName` and `currentProgramSceneName`);
  - `GetRecordStatus` and `GetStreamStatus` (`outputActive`, `outputPaused`);
  - `GetInputList` (`inputs: [{ inputName }]`);
  - `GetMediaInputStatus`;
  - `CallVendorRequest` for `obs-playlist-deck` `GetStatus` / `GetItems`, with the same fields as Task 5.

**CLI:** `pnpm --filter @olc/obs-sim start` starts on port 4455 with no password, using a Solo Futsal scene set: `CAM 1`, `CAM 2`, `CAM 3`, `PLAYOUT` (with input `Deck Media`), `BREAK` (with input `Tappo`), and deck items Servizio 1 and Servizio 2. It reads commands from stdin, one per line: `program <scene>`, `rec <state>`, `stream <state>`, `play <index>`, `media <input> <state> <cursor> <duration>`, `drop`. This is for Plan 4 development.

**Tests:**
- `tools/obs-sim/test/sim.test.ts`, using the **real `obs-websocket-js/json` client**:
  - connect without and with a password;
  - a wrong password rejects with code 4009;
  - `GetSceneList` and `GetCurrentProgramScene`;
  - an event arrives after `setProgram`;
  - a vendor `GetItems` round trip;
  - `dropConnections` triggers `ConnectionClosed`.
- `server/test/integration/obs-sim.test.ts`, end to end, with the **real** `createObsClient` and a **real** `systemClock` and `systemScheduler`, using short waits through polling helpers:
  1. Start the sim on a random port with password `pw`, then `buildServer` on a temp dir.
  2. Create the Solo Futsal format and episode through HTTP, then load it.
  3. `POST /api/internal/obs-credentials` with the token from the data dir.
  4. Wait until `GET /api/obs/status` is `connected` and the presenter view `status.obs === 'ok'`.
  5. `sim.setRecord('started')` → the view phase becomes `live`.
  6. `sim.setProgram('PLAYOUT'); sim.deckPlay(0)` → the view segment becomes `media`.
  7. `sim.dropConnections()` → the view `status.obs` becomes `'lost'` and the block anchor source becomes `'estimated'`.
  8. The sim keeps listening, so the server reconnects on its own within about 2 s, and `status.obs` is `'ok'` again.
  9. `POST /api/obs/check` returns `issues: []`.

  Every wait uses a bounded polling helper (50 ms steps, 5 s max) and fails with a clear message on timeout.

- [ ] Steps 1–5 as usual. Run the integration test 3 times; it must be green every time.
```bash
git add pnpm-workspace.yaml vitest.config.ts pnpm-lock.yaml tools/obs-sim server/package.json server/test/integration
git commit -m "feat(tools): obs-websocket v5 simulator with cli; end-to-end integration test against it"
```

---

### Task 10: Persistence ahead of ~1 Hz events (BACKLOG)

**Files:** `server/src/persistence/journal.ts`, `server/src/runtime/live-runtime.ts`, and their tests.

**Rules:**
1. **Journal.**
   - Track in memory whether the file ends with `\n`. It is initialised by one read on the first append. After that, append without re-reading the file.
   - Keep the `seq` seeding from that first read.
   - Keep the torn-line safety: if the initial read shows a missing trailing newline, prefix the first append with `\n`.
   - Test: spy on `readFile` (or count reads through an injectable `fs` wrapper). 100 appends cause exactly **1** read.
2. **Snapshot save coalescing (TECH-DESIGN §5.7).**
   - When a snapshot save is already queued and has not started, a new change does **not** enqueue another save. The queued save reads the latest state when it runs.
   - The journal append still happens for every input, in order.
   - Test: 50 synchronous dispatches, then `flush()` → the snapshot is written at most **2** times (spy `SnapshotStore.save`), the final file holds the latest state, and the journal has 50 entries.
   - `flush()` still resolves after everything is written.

- [ ] Steps 1–5 as usual.
```bash
git commit -m "perf(server): journal appends without re-reading; coalesced snapshot saves"
```

---

### Task 11: Engine — an estimated hand-over that starts during an out-of-order excursion (BACKLOG)

**Files:** `server/src/engine/reducer.ts` (estimating loop), `server/test/engine/reducer-commands.test.ts`.

**Rule.** The estimated (OBS lost) hand-over loop that marks slots `provisional` must start from `position(s)` (`returnSlot ?? cursor`), not from `s.cursor`. Slots between the excursion slot and `returnSlot` were observed, so they must not be marked provisional. The interrupted `returnSlot` studio slot must be closed (`done`) when the loop moves past it, so that it does not stay `onair`.

**Test.** Run the reviewer's sequence:
1. BREAK at 700 s, CAM 1 at 880 s.
2. Servizio 1 aired late at 900 s, giving cursor 1 and returnSlot 4.
3. OBS lost at 950 s.
4. Tick at 1520 s.

Expected:
- slots 3 and 4 have `provisional === false`;
- slot 4 status is `done`;
- no two slots are `onair`;
- after restore + CAM 1, the state is **not** `ambiguous`, because the gap behind the cursor holds only observed slots.

- [ ] Steps 1–5 as usual.
```bash
git commit -m "fix(engine): estimated hand-over during an out-of-order excursion starts from the resume position"
```

---

### Task 12: Manual test plan with real OBS (docs)

**Files:** Create `docs/TEST-PLAN.md`.

The file is a checklist in Italian for the operator, to run on Windows with OBS ≥ 30 and Playlist Deck ≥ 1.4.0. Each step has three parts: setup, action, expected result.

Steps:
1. Prerequisites:
   - obs-websocket enabled with a password;
   - Playlist Deck bound to a Media Source inside a `PLAYOUT` scene;
   - scenes `CAM 1/2/3` and `BREAK` with a `Tappo` media source.
2. Start the server with `pnpm --filter @olc/server dev`. Send credentials manually with `curl` to `/api/internal/obs-credentials` using the token file, until Plan 6 delivers them automatically.
3. Check OBS returns no issues.
4. REC start → the presenter phase becomes live.
5. Camera switches do not advance the block.
6. Servizio from Playlist Deck → segment media, countdown measured.
7. Brief cutaway during a servizio → RIENTRO is kept.
8. BREAK with the tappo → RIENTRO countdown, red count-up after the tappo ends.
9. Close OBS mid-show → STIMATO within 2 s. Reopen it → realigned.
10. Wrong password → `auth_failed`, no retry storm.
11. Remove a servizio from the playlist → it disappears from NEXT.
12. Plugin older than 1.4.0 → `deck_legacy` warning and polling works.
13. Stop the server mid-show and restart it → resumes with STIMATO, then realigns.
14. Journal size after 10 minutes of playback: a few hundred lines, not thousands.

Commit:
```bash
git add docs/TEST-PLAN.md
git commit -m "docs: manual test plan with real obs and playlist deck"
```

(This task is documentation only. The implementer writes it from this list, and the controller reviews it.)

---

## Self-review notes (plan author)

- **Spec coverage:**
  - SPEC F7 (Check OBS) and §6 (OBS integration table).
  - §15 failure scenarios: OBS lost, restart, plugin absent or old.
  - DT-5: credential hand-off, password memory-only, Windows ACL.
  - TECH-DESIGN §4.2 and §4.3 (adapters, SceneGraph, legacy polling), §5.5 (estimated mode is fed by SourceLost/Restored), §7 (OBS routes), §13 R1 (credentials reach the server through the endpoint; the plugin side is Plan 6) and R3 (media polling at 4 Hz).
  - BACKLOG Plan 3 items: debounce, journal re-read, the excursion fix, ACL. Windows rename retry stays in the backlog.
- **Deferred:**
  - the plugin delivering credentials automatically (Plan 6);
  - the playlist import UI (Plan 5, which uses `/api/deck/items` with occurrences);
  - `RecordFileChanged` and post-production markers (v1.x).
- **Where the plan gives rules instead of full code** (Tasks 4–9): the logic is mechanical given the rules, and the tests are written out exactly. The implementer must not loosen any test. Ambiguities go back to the orchestrator.
