# Plan 1 — Foundation & Live Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the pnpm/TypeScript monorepo foundation, the shared data model (format, episode, validation) and the pure live timing engine. Everything is proven by unit and scenario tests, with no OBS required.

**Architecture:**
- The engine is a pure reducer: `reduce(state, input) → { state, changed }`.
- It works over a flattened rundown ("slots") with a sequential cursor.
- Derived timing (`computeTiming`) and the presenter projection (`presenterView`) are pure functions of state and time.
- All I/O (OBS, files, WebSocket) comes in later plans and talks to the engine only through `EngineInput` values.

**Tech Stack:** Node.js 24 LTS · pnpm workspaces · TypeScript 5.9 (strict) · zod 4 · Vitest 3 · GitHub Actions.

**Spec:** [docs/SPEC.md](../../SPEC.md) · [docs/TECH-DESIGN.md](../../TECH-DESIGN.md) (§4.3, §5, §6.1) · [docs/DECISIONS.md](../../DECISIONS.md)

**Roadmap (separate plans, written after this one ships):**

| Plan | Scope |
|---|---|
| **1 (this)** | Monorepo, shared model, validation, live engine, projection |
| 2 | Server: persistence (JSON/JSONL), OBS + Playlist Deck adapters, `tools/obs-sim`, HTTP API, WebSocket hub, clock sync |
| 3 | Web: presenter monitor, dock, control view |
| 4 | Web: editor (timeline, undo/redo, import, validation, Check OBS) |
| 5 | Plugin C++ (launcher, credentials, dock, hotkeys, screens) + kiosk |
| 6 | Installers, release pipeline, manual test plan |

---

## Execution model (agents)

This follows the user's instruction: **Opus 5.5 coordinates and orchestrates**, and **Sonnet or Haiku** implement the elementary tasks.

| Role | Model | Responsibility |
|---|---|---|
| Orchestrator | **Opus 5.5** (main session) | Dispatches tasks in order, passes each implementer only its task text plus the Global Constraints, runs the per-task review gate, resolves failures, runs the final whole-branch review |
| Implementer: mechanical | **Haiku 4.5** | Scaffolding and fully specified code with no design decisions |
| Implementer: logic | **Sonnet 5** | Engine logic transcribed from this plan, plus its tests. Must make every listed test pass without changing expected values |
| Reviewer (per task) | **Sonnet 5** | Checks the diff against the task text, the Global Constraints and the Review Focus |
| Final reviewer | **Opus 5.5** | Whole-branch review against SPEC/TECH-DESIGN before merge |

Per-task model assignment:

| Task | Model | Why |
|---|---|---|
| 1 Monorepo scaffold + CI | Haiku | Config files only |
| 2 Shared model | Haiku | Schemas copied verbatim |
| 3 Rundown validation | Sonnet | Small but rule-based logic |
| 4 Engine state & rundown helpers | Sonnet | Core types that later tasks depend on |
| 5 Timing primitives | Sonnet | Formulas |
| 6 Cursor & matcher | **Sonnet**, with an Opus review | Trickiest logic in the plan |
| 7 Reducer: events | Sonnet | |
| 8 Reducer: commands & ticks | Sonnet | |
| 9 Timing snapshot | Sonnet | |
| 10 Presenter projection | Sonnet | |
| 11 Acceptance scenarios | Sonnet, with an Opus review | Cross-cutting proof of the spec |

Escalation rule: if an implementer fails the same task twice, the orchestrator (Opus) takes it over directly.

---

## Global Constraints

- Node.js `>=24`. Package manager: pnpm (via corepack). Module format: ESM (`"type": "module"`).
- TypeScript `strict: true`, `moduleResolution: "Bundler"`, `noEmit` for typecheck. Packages expose TS source directly through `exports`.
- License GPL-2.0-or-later. Every new source file starts with `// SPDX-License-Identifier: GPL-2.0-or-later`.
- Runtime dependencies must be GPL-2.0-compatible (MIT, BSD, ISC). zod is MIT. Dev-only tools that are not distributed (typescript Apache-2.0, vitest MIT) are acceptable.
- The engine (`server/src/engine/**`) is **pure**. It must not use `Date.now()`, timers, I/O or randomness. Time always comes from `input.at` (a monotonic millisecond value, type `MonoMs`).
- All durations and times are integer **milliseconds**.
- The system never invents information. Every time value exposed by the engine carries a `source`: `'measured' | 'planned' | 'estimated'`. When OBS is lost, every source becomes `'estimated'`.
- Code identifiers, comments and commit messages are in English. User-facing copy (added in later plans) is in IT and EN.
- Line endings are LF (`.gitattributes` already enforces this).
- Commit messages and PR descriptions contain no AI attribution and no co-author trailers.

## Review Focus

These inputs are the ones most likely to break the engine for a real user. Each has a test in its owning task.

1. **The same media file appears twice in the playlist.** The second rundown occurrence must match the second playlist item, not the first. *Test: Task 6, "same file twice".*
2. **Media plays before the Playlist Deck item list is known** (`deck.items === null`). The matcher must fall back to matching by path and must not crash or skip. *Test: Task 6, "matches by path when deck items are unknown".*
3. **Events arrive in a phase where they make no sense.** Examples: scene changes after the program has ended, playback events in preshow. State fields may update, but the cursor must not move. *Test: Task 7, "ignores matching outside live".*
4. **Playlist Deck reports an unknown duration (`-1`).** The engine must fall back to the planned duration with `source: 'planned'`, never use `-1` in arithmetic. *Test: Task 4, "unknown deck duration falls back to planned".*
5. **The program scene belongs to no rundown element** (e.g. `CAMERA OSPITE`). The engine marks `offScript`, keeps the current block running and does not move the cursor. *Test: Task 6, "unknown scene is off-script".*

---

## File structure

```
package.json                     root scripts + dev deps
pnpm-workspace.yaml
tsconfig.base.json
vitest.config.ts                 single root Vitest config
.github/workflows/ci.yml
shared/
  package.json                   @olc/shared  (exports "." and "./testing")
  tsconfig.json
  src/index.ts                   re-exports
  src/model/format.ts            zod schemas: Preset, SceneGroup, MessagePreset, Block, Format, Episode + helpers
  src/model/episode.ts           createEpisode, rundownDurationMs, formatDateIt
  src/model/validate.ts          validateRundown, plannedStudioTimeMs
  src/testing/fixtures.ts        soloFutsalFormat/Episode, SOLO_FUTSAL_DECK
  test/format.test.ts
  test/episode.test.ts
  test/validate.test.ts
server/
  package.json                   @olc/server
  tsconfig.json
  src/engine/types.ts            LiveState, Slot, DomainEvent, Command, EngineInput, Source …
  src/engine/rundown.ts          buildSlots, resolveDeckIndex, slotDuration, studioTimeMs, block helpers
  src/engine/state.ts            createLiveState
  src/engine/timing.ts           plannedStartAt, plannedEndAt, targetForBlockStart, blockEndsAt
  src/engine/cursor.ts           startBlock, enterSlot, closeSlot, moveTo, correctTo
  src/engine/matcher.ts          classify, slotMatches, match
  src/engine/reducer.ts          reduce, nextTickAt
  src/engine/snapshot.ts         computeTiming (derived timing)
  src/engine/projection.ts       presenterView (anchors for the presenter)
  src/engine/index.ts            public engine API
  test/helpers.ts                run(), T0, liveState()
  test/engine/*.test.ts
  test/scenarios/acceptance.test.ts
```

Slot indexes of the shared fixture *Solo Futsal*, used throughout the tests:

| slot | block (index) | kind | title |
|---|---|---|---|
| 0 | b1 (0) | studio | Primo blocco |
| 1 | b1 (0) | media | Servizio 1 (`D:/media/servizio1.mp4`, planned 180 000, deck 185 000) |
| 2 | b1 (0) | studio | Primo blocco |
| 3 | br1 (1) | break | Break 1 (scene `BREAK`, input `Tappo`, 180 000) |
| 4 | b2 (2) | studio | Secondo blocco |
| 5 | b2 (2) | media | Servizio 2 (`D:/media/servizio2.mp4`, 120 000) |
| 6 | b2 (2) | studio | Secondo blocco |
| 7 | b3 (3) | studio | Chiusura |

Block durations are b1 720 000 · br1 180 000 · b2 600 000 · b3 120 000, for a total of 1 620 000. The studio scene group is `studio` = `CAM 1`, `CAM 2`, `CAM 3`.

---

### Task 1: Monorepo scaffold + CI

**Files:**
- Create: `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `vitest.config.ts`, `.github/workflows/ci.yml`
- Create: `shared/package.json`, `shared/tsconfig.json`, `shared/src/index.ts`, `shared/test/smoke.test.ts`
- Create: `server/package.json`, `server/tsconfig.json`, `server/src/engine/index.ts`, `server/test/smoke.test.ts`

**Interfaces:**
- Produces: packages `@olc/shared` (import `@olc/shared`, `@olc/shared/testing`) and `@olc/server`. Root scripts are `pnpm test` and `pnpm typecheck`.

- [ ] **Step 1: Verify toolchain**

Run: `node --version` → expected `v24.x`. If Node 24 is missing, install Node 24 LTS first.

Run: `corepack enable && corepack prepare pnpm@latest --activate && pnpm --version` → expected a version `>=10`.

- [ ] **Step 2: Create root files**

`package.json`:
```json
{
  "name": "obs-live-clock",
  "private": true,
  "type": "module",
  "license": "GPL-2.0-or-later",
  "engines": { "node": ">=24" },
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "pnpm -r --parallel typecheck"
  },
  "devDependencies": {
    "@types/node": "^24.0.0",
    "typescript": "^5.9.0",
    "vitest": "^3.2.0"
  }
}
```

`pnpm-workspace.yaml`:
```yaml
packages:
  - shared
  - server
```

`tsconfig.base.json`:
```json
{
  "compilerOptions": {
    "target": "ES2023",
    "lib": ["ES2023"],
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "noEmit": true,
    "isolatedModules": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "types": ["node"]
  }
}
```

`vitest.config.ts`:
```ts
// SPDX-License-Identifier: GPL-2.0-or-later
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['shared/test/**/*.test.ts', 'server/test/**/*.test.ts'],
  },
});
```

- [ ] **Step 3: Create the `shared` package**

`shared/package.json`:
```json
{
  "name": "@olc/shared",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "license": "GPL-2.0-or-later",
  "exports": {
    ".": "./src/index.ts",
    "./testing": "./src/testing/fixtures.ts"
  },
  "scripts": { "typecheck": "tsc -p tsconfig.json" },
  "dependencies": { "zod": "^4.1.0" }
}
```

`shared/tsconfig.json`:
```json
{ "extends": "../tsconfig.base.json", "include": ["src", "test"] }
```

`shared/src/index.ts`:
```ts
// SPDX-License-Identifier: GPL-2.0-or-later
export const SHARED_PACKAGE = '@olc/shared';
```

`shared/test/smoke.test.ts`:
```ts
// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import { SHARED_PACKAGE } from '../src/index';

describe('shared package', () => {
  it('is importable', () => {
    expect(SHARED_PACKAGE).toBe('@olc/shared');
  });
});
```

- [ ] **Step 4: Create the `server` package**

`server/package.json`:
```json
{
  "name": "@olc/server",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "license": "GPL-2.0-or-later",
  "scripts": { "typecheck": "tsc -p tsconfig.json" },
  "dependencies": { "@olc/shared": "workspace:*" }
}
```

`server/tsconfig.json`:
```json
{ "extends": "../tsconfig.base.json", "include": ["src", "test"] }
```

`server/src/engine/index.ts`:
```ts
// SPDX-License-Identifier: GPL-2.0-or-later
export const ENGINE_VERSION = 1;
```

`server/test/smoke.test.ts`:
```ts
// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import { SHARED_PACKAGE } from '@olc/shared';
import { ENGINE_VERSION } from '../src/engine/index';

describe('server package', () => {
  it('resolves the shared workspace package', () => {
    expect(SHARED_PACKAGE).toBe('@olc/shared');
    expect(ENGINE_VERSION).toBe(1);
  });
});
```

- [ ] **Step 5: Install and run**

Run: `pnpm install` → creates `pnpm-lock.yaml`.
Run: `pnpm test` → expected: 2 passed.
Run: `pnpm typecheck` → expected: no errors.

- [ ] **Step 6: Add CI**

`.github/workflows/ci.yml`:
```yaml
name: ci
on:
  push:
    branches: [main]
  pull_request:
jobs:
  ts:
    strategy:
      fail-fast: false
      matrix:
        os: [ubuntu-latest, windows-latest, macos-latest]
    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 24
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm typecheck
      - run: pnpm test
```

Add `"packageManager": "pnpm@<version printed in Step 1>"` to the root `package.json`, so that `pnpm/action-setup` picks up the same version.

- [ ] **Step 7: Commit**

```bash
git add package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json vitest.config.ts .github shared server
git commit -m "chore: pnpm monorepo with shared and server packages, vitest and CI"
```

---

### Task 2: Shared model (format, episode, fixtures)

**Files:**
- Create: `shared/src/model/format.ts`, `shared/src/model/episode.ts`, `shared/src/testing/fixtures.ts`
- Modify: `shared/src/index.ts` (replace content)
- Test: `shared/test/format.test.ts`, `shared/test/episode.test.ts`
- Delete: `shared/test/smoke.test.ts` (superseded)

**Interfaces:**
- Produces (from `@olc/shared`):
  - schemas: `Preset`, `SceneGroup`, `MessageDismiss`, `MessagePreset`, `StudioElement`, `MediaElement`, `RundownElement`, `StudioBlock`, `BreakBlock`, `Block`, `Rundown`, `Format`, `Episode`, `ProductionMode`, `DurationMs`;
  - types with the same names (`z.infer`);
  - `SCHEMA_VERSION = 1`;
  - `presetForMode(mode): Preset`;
  - `rundownDurationMs(r: { blocks: Block[] }): number`;
  - `createEpisode(format: Format, input: NewEpisodeInput): Episode`;
  - `formatDateIt(date: string): string`.
- Produces (from `@olc/shared/testing`): `soloFutsalFormat(): Format`, `soloFutsalEpisode(mode?: ProductionMode): Episode`, `SOLO_FUTSAL_DECK`.

- [ ] **Step 1: Write the failing tests**

`shared/test/format.test.ts`:
```ts
// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import { Format, presetForMode, rundownDurationMs } from '../src/index';
import { soloFutsalFormat } from '../src/testing/fixtures';

describe('Format schema', () => {
  it('accepts the Solo Futsal fixture', () => {
    expect(Format.safeParse(soloFutsalFormat()).success).toBe(true);
  });

  it('rejects a block shorter than one second', () => {
    const f = soloFutsalFormat();
    f.blocks[0]!.durationMs = 500;
    expect(Format.safeParse(f).success).toBe(false);
  });

  it('rejects a negative media occurrence', () => {
    const f = soloFutsalFormat();
    const b = f.blocks[0]!;
    if (b.kind !== 'studio') throw new Error('fixture changed');
    const m = b.elements[1]!;
    if (m.kind !== 'media') throw new Error('fixture changed');
    m.occurrence = -1;
    expect(Format.safeParse(f).success).toBe(false);
  });

  it('rejects a timeout message shorter than one second', () => {
    const f = soloFutsalFormat();
    f.messages[0]!.dismiss = { kind: 'timeout', ms: 200 };
    expect(Format.safeParse(f).success).toBe(false);
  });
});

describe('presetForMode', () => {
  it('freezes program time on REC pause only for live-to-tape', () => {
    expect(presetForMode('live_to_tape').recPauseFreezesProgram).toBe(true);
    expect(presetForMode('streaming').recPauseFreezesProgram).toBe(false);
    expect(presetForMode('tv').recPauseFreezesProgram).toBe(false);
  });

  it('uses the spec defaults', () => {
    expect(presetForMode('tv')).toEqual({
      mode: 'tv',
      warnMs: 60_000,
      returnImminentMs: 10_000,
      adjustStepMs: 30_000,
      recPauseFreezesProgram: false,
    });
  });
});

describe('rundownDurationMs', () => {
  it('is the sum of block durations', () => {
    expect(rundownDurationMs(soloFutsalFormat())).toBe(1_620_000);
  });
});
```

`shared/test/episode.test.ts`:
```ts
// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import { Episode, createEpisode, formatDateIt } from '../src/index';
import { soloFutsalFormat } from '../src/testing/fixtures';

describe('createEpisode', () => {
  const input = {
    id: 'ep-1',
    date: '2026-10-12',
    plannedStart: '2026-10-12T19:00:00+02:00',
    playlistName: 'Puntata del 12/10/2026',
  };

  it('copies the format and names the episode with the date', () => {
    const ep = createEpisode(soloFutsalFormat(), input);
    expect(ep.name).toBe('Solo Futsal · 12/10/2026');
    expect(ep.formatId).toBe('solo-futsal');
    expect(ep.blocks).toHaveLength(4);
    expect(Episode.safeParse(ep).success).toBe(true);
  });

  it('is independent from the format it came from', () => {
    const format = soloFutsalFormat();
    const ep = createEpisode(format, input);
    ep.blocks[0]!.durationMs = 1_000;
    expect(format.blocks[0]!.durationMs).toBe(720_000);
  });

  it('rejects an invalid date', () => {
    expect(() => createEpisode(soloFutsalFormat(), { ...input, date: '12/10/2026' })).toThrow();
  });
});

describe('formatDateIt', () => {
  it('formats ISO dates as dd/mm/yyyy', () => {
    expect(formatDateIt('2026-10-12')).toBe('12/10/2026');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run shared/test`
Expected: FAIL. The imports `Format`, `presetForMode`, `../src/testing/fixtures` and `createEpisode` do not exist yet.

- [ ] **Step 3: Implement the schemas**

`shared/src/model/format.ts`:
```ts
// SPDX-License-Identifier: GPL-2.0-or-later
import { z } from 'zod';

export const SCHEMA_VERSION = 1 as const;

const Id = z.string().min(1);
const Name = z.string().min(1).max(120);

export const DurationMs = z.number().int().nonnegative();
export type DurationMs = z.infer<typeof DurationMs>;

export const ProductionMode = z.enum(['streaming', 'tv', 'live_to_tape']);
export type ProductionMode = z.infer<typeof ProductionMode>;

export const Preset = z.object({
  mode: ProductionMode,
  warnMs: DurationMs,
  returnImminentMs: DurationMs,
  adjustStepMs: z.number().int().min(1000),
  recPauseFreezesProgram: z.boolean(),
});
export type Preset = z.infer<typeof Preset>;

export function presetForMode(mode: ProductionMode): Preset {
  return {
    mode,
    warnMs: 60_000,
    returnImminentMs: 10_000,
    adjustStepMs: 30_000,
    recPauseFreezesProgram: mode === 'live_to_tape',
  };
}

export const SceneGroup = z.object({
  id: Id,
  name: Name,
  scenes: z.array(z.string().min(1)).min(1),
});
export type SceneGroup = z.infer<typeof SceneGroup>;

export const MessageDismiss = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('timeout'), ms: z.number().int().min(1000) }),
  z.object({ kind: z.literal('manual') }),
]);
export type MessageDismiss = z.infer<typeof MessageDismiss>;

export const MessagePreset = z.object({
  id: Id,
  text: z.string().min(1).max(80),
  dismiss: MessageDismiss,
});
export type MessagePreset = z.infer<typeof MessagePreset>;

export const StudioElement = z.object({ id: Id, kind: z.literal('studio') });
export type StudioElement = z.infer<typeof StudioElement>;

export const MediaElement = z.object({
  id: Id,
  kind: z.literal('media'),
  title: z.string().max(200),
  path: z.string().min(1),
  occurrence: z.number().int().nonnegative(),
  plannedDurationMs: DurationMs,
});
export type MediaElement = z.infer<typeof MediaElement>;

export const RundownElement = z.discriminatedUnion('kind', [StudioElement, MediaElement]);
export type RundownElement = z.infer<typeof RundownElement>;

export const StudioBlock = z.object({
  id: Id,
  kind: z.literal('studio'),
  name: Name,
  durationMs: z.number().int().min(1000),
  elastic: z.boolean(),
  sceneGroupId: Id,
  elements: z.array(RundownElement).min(1),
});
export type StudioBlock = z.infer<typeof StudioBlock>;

export const BreakBlock = z.object({
  id: Id,
  kind: z.literal('break'),
  name: Name,
  durationMs: z.number().int().min(1000),
  scene: z.string().min(1),
  mediaInput: z.string().min(1).nullable(),
});
export type BreakBlock = z.infer<typeof BreakBlock>;

export const Block = z.discriminatedUnion('kind', [StudioBlock, BreakBlock]);
export type Block = z.infer<typeof Block>;

const rundownShape = {
  preset: Preset,
  sceneGroups: z.array(SceneGroup),
  messages: z.array(MessagePreset),
  blocks: z.array(Block),
};

export const Rundown = z.object(rundownShape);
export type Rundown = z.infer<typeof Rundown>;

export const Format = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  id: Id,
  name: Name,
  ...rundownShape,
});
export type Format = z.infer<typeof Format>;

export const Episode = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  id: Id,
  formatId: Id,
  name: z.string().min(1).max(160),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  plannedStart: z.iso.datetime({ offset: true }).nullable(),
  playlistName: z.string().nullable(),
  ...rundownShape,
});
export type Episode = z.infer<typeof Episode>;
```

- [ ] **Step 4: Implement the episode helpers**

`shared/src/model/episode.ts`:
```ts
// SPDX-License-Identifier: GPL-2.0-or-later
import { Episode, SCHEMA_VERSION, type Block, type Format } from './format';

export interface NewEpisodeInput {
  id: string;
  date: string; // YYYY-MM-DD
  plannedStart: string | null; // ISO 8601 with offset
  playlistName: string | null;
}

export function formatDateIt(date: string): string {
  const [y, m, d] = date.split('-');
  return `${d}/${m}/${y}`;
}

export function rundownDurationMs(r: { blocks: Block[] }): number {
  return r.blocks.reduce((total, b) => total + b.durationMs, 0);
}

/** An episode is an independent deep copy of its format, stamped with a date. */
export function createEpisode(format: Format, input: NewEpisodeInput): Episode {
  const copy = structuredClone(format);
  return Episode.parse({
    schemaVersion: SCHEMA_VERSION,
    id: input.id,
    formatId: format.id,
    name: `${format.name} · ${formatDateIt(input.date)}`,
    date: input.date,
    plannedStart: input.plannedStart,
    playlistName: input.playlistName,
    preset: copy.preset,
    sceneGroups: copy.sceneGroups,
    messages: copy.messages,
    blocks: copy.blocks,
  });
}
```

`formatDateIt` runs before `Episode.parse`. With a bad date it produces a garbage name, but `parse` still throws on the `date` regex, which is what the test expects.

- [ ] **Step 5: Implement the fixtures and the index**

`shared/src/testing/fixtures.ts`:
```ts
// SPDX-License-Identifier: GPL-2.0-or-later
import { createEpisode } from '../model/episode';
import { presetForMode, type Episode, type Format, type ProductionMode } from '../model/format';

export function soloFutsalFormat(mode: ProductionMode = 'live_to_tape'): Format {
  return {
    schemaVersion: 1,
    id: 'solo-futsal',
    name: 'Solo Futsal',
    preset: presetForMode(mode),
    sceneGroups: [{ id: 'studio', name: 'Studio', scenes: ['CAM 1', 'CAM 2', 'CAM 3'] }],
    messages: [
      { id: 'stringi', text: 'STRINGI', dismiss: { kind: 'timeout', ms: 10_000 } },
      { id: 'cam2', text: 'GUARDA CAM 2', dismiss: { kind: 'manual' } },
    ],
    blocks: [
      {
        id: 'b1',
        kind: 'studio',
        name: 'Primo blocco',
        durationMs: 720_000,
        elastic: true,
        sceneGroupId: 'studio',
        elements: [
          { id: 'b1-s1', kind: 'studio' },
          {
            id: 'b1-m1',
            kind: 'media',
            title: 'Servizio 1',
            path: 'D:/media/servizio1.mp4',
            occurrence: 0,
            plannedDurationMs: 180_000,
          },
          { id: 'b1-s2', kind: 'studio' },
        ],
      },
      { id: 'br1', kind: 'break', name: 'Break 1', durationMs: 180_000, scene: 'BREAK', mediaInput: 'Tappo' },
      {
        id: 'b2',
        kind: 'studio',
        name: 'Secondo blocco',
        durationMs: 600_000,
        elastic: true,
        sceneGroupId: 'studio',
        elements: [
          { id: 'b2-s1', kind: 'studio' },
          {
            id: 'b2-m1',
            kind: 'media',
            title: 'Servizio 2',
            path: 'D:/media/servizio2.mp4',
            occurrence: 0,
            plannedDurationMs: 120_000,
          },
          { id: 'b2-s2', kind: 'studio' },
        ],
      },
      {
        id: 'b3',
        kind: 'studio',
        name: 'Chiusura',
        durationMs: 120_000,
        elastic: true,
        sceneGroupId: 'studio',
        elements: [{ id: 'b3-s1', kind: 'studio' }],
      },
    ],
  };
}

export function soloFutsalEpisode(mode: ProductionMode = 'live_to_tape'): Episode {
  return createEpisode(soloFutsalFormat(mode), {
    id: 'ep-2026-10-12',
    date: '2026-10-12',
    plannedStart: '2026-10-12T19:00:00+02:00',
    playlistName: 'Puntata del 12/10/2026',
  });
}

/** Playlist Deck `GetItems` result for the Solo Futsal episode. */
export const SOLO_FUTSAL_DECK = [
  { index: 0, path: 'D:/media/servizio1.mp4', title: 'Servizio 1', durationMs: 185_000 },
  { index: 1, path: 'D:/media/servizio2.mp4', title: 'Servizio 2', durationMs: 120_000 },
] as const;
```

`shared/src/index.ts` (replace the whole file):
```ts
// SPDX-License-Identifier: GPL-2.0-or-later
export * from './model/format';
export * from './model/episode';
```

Delete `shared/test/smoke.test.ts`. Update `server/test/smoke.test.ts` so that it imports `SCHEMA_VERSION` from `@olc/shared` and expects `1`, instead of `SHARED_PACKAGE`:
```ts
// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import { SCHEMA_VERSION } from '@olc/shared';
import { ENGINE_VERSION } from '../src/engine/index';

describe('server package', () => {
  it('resolves the shared workspace package', () => {
    expect(SCHEMA_VERSION).toBe(1);
    expect(ENGINE_VERSION).toBe(1);
  });
});
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `pnpm vitest run && pnpm typecheck`
Expected: all tests PASS, and typecheck reports no errors.

- [ ] **Step 7: Commit**

```bash
git add shared server/test/smoke.test.ts
git commit -m "feat(shared): format and episode schemas, presets, Solo Futsal fixture"
```

---

### Task 3: Rundown validation (SPEC F6)

**Files:**
- Create: `shared/src/model/validate.ts`
- Modify: `shared/src/index.ts` (add export)
- Test: `shared/test/validate.test.ts`

**Interfaces:**
- Consumes: `Rundown`, `StudioBlock` from Task 2.
- Produces: `validateRundown(r: Rundown): Issue[]`, `plannedStudioTimeMs(b: StudioBlock): number`, and the types `Issue`, `IssueCode`, `IssueSeverity`.

Rules (SPEC F6, TECH-DESIGN §4). OBS-dependent checks, such as "scene exists in OBS", belong to Check OBS in Plan 2 and are **not** part of this task.

| Code | Severity | Condition |
|---|---|---|
| `empty_rundown` | error | no blocks |
| `duplicate_id` | error | a block or element id is used twice |
| `scene_group_missing` | error | a studio block references an unknown scene group |
| `media_exceeds_block` | error | planned media durations exceed the studio block duration |
| `studio_below_threshold` | warning | remaining studio time is `< preset.warnMs` (and `>= 0`) |
| `scene_group_shared` | warning | two or more studio blocks use the same scene group (normal; they are told apart by order) |

- [ ] **Step 1: Write the failing test**

`shared/test/validate.test.ts`:
```ts
// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import { plannedStudioTimeMs, validateRundown, type StudioBlock } from '../src/index';
import { soloFutsalFormat } from '../src/testing/fixtures';

const codes = (r: ReturnType<typeof soloFutsalFormat>) => validateRundown(r).map((i) => i.code);
const studio = (f: ReturnType<typeof soloFutsalFormat>, i: number) => f.blocks[i] as StudioBlock;

describe('validateRundown', () => {
  it('reports only the shared scene-group warning for the fixture', () => {
    const issues = validateRundown(soloFutsalFormat());
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ severity: 'warning', code: 'scene_group_shared', blockId: null });
  });

  it('flags an empty rundown', () => {
    const f = soloFutsalFormat();
    f.blocks = [];
    expect(validateRundown(f)).toEqual([
      { severity: 'error', code: 'empty_rundown', blockId: null, message: 'The rundown has no blocks' },
    ]);
  });

  it('flags duplicate ids across blocks and elements', () => {
    const f = soloFutsalFormat();
    studio(f, 2).elements[0]!.id = 'b1-s1';
    expect(codes(f)).toContain('duplicate_id');
  });

  it('flags a missing scene group', () => {
    const f = soloFutsalFormat();
    studio(f, 0).sceneGroupId = 'nope';
    const issue = validateRundown(f).find((i) => i.code === 'scene_group_missing');
    expect(issue).toMatchObject({ severity: 'error', blockId: 'b1' });
  });

  it('flags media that exceed the block', () => {
    const f = soloFutsalFormat();
    studio(f, 3).durationMs = 60_000;
    studio(f, 3).elements.push({
      id: 'b3-m1', kind: 'media', title: 'Lungo', path: 'D:/media/lungo.mp4', occurrence: 0, plannedDurationMs: 90_000,
    });
    const issue = validateRundown(f).find((i) => i.code === 'media_exceeds_block');
    expect(issue).toMatchObject({ severity: 'error', blockId: 'b3' });
  });

  it('warns when studio time is below the warning threshold', () => {
    const f = soloFutsalFormat();
    studio(f, 0).durationMs = 220_000; // 220 000 - 180 000 = 40 000 < 60 000
    const issue = validateRundown(f).find((i) => i.code === 'studio_below_threshold');
    expect(issue).toMatchObject({ severity: 'warning', blockId: 'b1' });
  });
});

describe('plannedStudioTimeMs', () => {
  it('is block duration minus planned media', () => {
    expect(plannedStudioTimeMs(studio(soloFutsalFormat(), 0))).toBe(540_000);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run shared/test/validate.test.ts`
Expected: FAIL. `validateRundown` is not exported.

- [ ] **Step 3: Implement**

`shared/src/model/validate.ts`:
```ts
// SPDX-License-Identifier: GPL-2.0-or-later
import type { Rundown, StudioBlock } from './format';

export type IssueSeverity = 'error' | 'warning';
export type IssueCode =
  | 'empty_rundown'
  | 'duplicate_id'
  | 'scene_group_missing'
  | 'media_exceeds_block'
  | 'studio_below_threshold'
  | 'scene_group_shared';

export interface Issue {
  severity: IssueSeverity;
  code: IssueCode;
  blockId: string | null;
  /** English, for logs. The UI translates by `code`. */
  message: string;
}

export function plannedStudioTimeMs(block: StudioBlock): number {
  const media = block.elements.reduce((t, e) => (e.kind === 'media' ? t + e.plannedDurationMs : t), 0);
  return block.durationMs - media;
}

export function validateRundown(r: Rundown): Issue[] {
  const issues: Issue[] = [];
  if (r.blocks.length === 0) {
    issues.push({ severity: 'error', code: 'empty_rundown', blockId: null, message: 'The rundown has no blocks' });
    return issues;
  }

  const seen = new Set<string>();
  const checkId = (id: string, blockId: string) => {
    if (seen.has(id)) {
      issues.push({ severity: 'error', code: 'duplicate_id', blockId, message: `Duplicate id "${id}"` });
    }
    seen.add(id);
  };

  const groupUse = new Map<string, string[]>();
  for (const b of r.blocks) {
    checkId(b.id, b.id);
    if (b.kind !== 'studio') continue;
    for (const e of b.elements) checkId(e.id, b.id);

    if (!r.sceneGroups.some((g) => g.id === b.sceneGroupId)) {
      issues.push({
        severity: 'error',
        code: 'scene_group_missing',
        blockId: b.id,
        message: `Block "${b.name}" uses unknown scene group "${b.sceneGroupId}"`,
      });
    }
    groupUse.set(b.sceneGroupId, [...(groupUse.get(b.sceneGroupId) ?? []), b.id]);

    const studio = plannedStudioTimeMs(b);
    if (studio < 0) {
      issues.push({
        severity: 'error',
        code: 'media_exceeds_block',
        blockId: b.id,
        message: `Media exceed block "${b.name}" by ${-studio} ms`,
      });
    } else if (studio < r.preset.warnMs) {
      issues.push({
        severity: 'warning',
        code: 'studio_below_threshold',
        blockId: b.id,
        message: `Block "${b.name}" leaves only ${studio} ms of studio time`,
      });
    }
  }

  for (const [groupId, blockIds] of groupUse) {
    if (blockIds.length > 1) {
      issues.push({
        severity: 'warning',
        code: 'scene_group_shared',
        blockId: null,
        message: `Blocks ${blockIds.join(', ')} share scene group "${groupId}" and are told apart by order`,
      });
    }
  }
  return issues;
}
```

Append to `shared/src/index.ts`:
```ts
export * from './model/validate';
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm vitest run shared/test && pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add shared
git commit -m "feat(shared): rundown validation (errors and warnings, SPEC F6)"
```

---

### Task 4: Engine types, slots and rundown helpers

**Files:**
- Create: `server/src/engine/types.ts`, `server/src/engine/rundown.ts`, `server/src/engine/state.ts`
- Create: `server/test/helpers.ts`
- Test: `server/test/engine/rundown.test.ts`

**Interfaces:**
- Consumes: `Episode`, `MessageDismiss` from `@olc/shared`; `soloFutsalEpisode`, `SOLO_FUTSAL_DECK` from `@olc/shared/testing`.
- Produces (exact names later tasks use):
  - types: `MonoMs`, `Source`, `OutputKind`, `DeckItem`, `DeckCurrent`, `InputMedia`, `DomainEvent`, `Command`, `Tick`, `EngineInput`, `SlotKind`, `Slot`, `SlotStatus`, `SlotRuntime`, `BlockRuntime`, `ActiveMessage`, `DecisionKind`, `Decision`, `Phase`, `LiveState`;
  - `buildSlots(ep)`, `resolveDeckIndex(items, slot)`, `slotDuration(s, slot): TimedValue`, `studioTimeMs(s, blockIndex)`, `firstSlotOfBlock(s, blockIndex)`, `currentBlockIndex(s)`, `lastBlockIndex(s)`, `isElastic(s, blockIndex)`, `worstSource(a, b)`;
  - `createLiveState(episode)`;
  - test helpers `T0`, `freshState(mode?)`.

- [ ] **Step 1: Write the types (no behaviour to test yet)**

`server/src/engine/types.ts`:
```ts
// SPDX-License-Identifier: GPL-2.0-or-later
import type { Episode, MessageDismiss } from '@olc/shared';

/** Monotonic milliseconds on the server. Never wall-clock. */
export type MonoMs = number;
export type Source = 'measured' | 'planned' | 'estimated';
export type OutputKind = 'rec' | 'stream';

/** One item of Playlist Deck `GetItems`. `durationMs` is -1 while unknown. */
export interface DeckItem {
  index: number;
  path: string;
  title: string;
  durationMs: number;
}

export interface DeckCurrent {
  index: number;
  path: string;
  title: string;
  positionMs: number;
  durationMs: number;
  playing: boolean;
  at: MonoMs;
}

/** Status of a plain OBS media input (e.g. the break filler). */
export interface InputMedia {
  input: string;
  playing: boolean;
  cursorMs: number;
  durationMs: number;
  at: MonoMs;
}

export type DomainEvent =
  | { type: 'ProgramSceneChanged'; at: MonoMs; scene: string; deckOnProgram: boolean }
  | { type: 'OutputChanged'; at: MonoMs; output: OutputKind; state: 'started' | 'stopped' | 'paused' | 'resumed' }
  | { type: 'DeckItemStarted'; at: MonoMs; index: number; path: string; title: string; durationMs: number }
  | { type: 'DeckPlayback'; at: MonoMs; index: number; positionMs: number; durationMs: number; playing: boolean }
  | { type: 'DeckPlaylistChanged'; at: MonoMs; items: DeckItem[] }
  | { type: 'MediaStatus'; at: MonoMs; input: string; playing: boolean; cursorMs: number; durationMs: number }
  | { type: 'SourceLost'; at: MonoMs }
  | { type: 'SourceRestored'; at: MonoMs };

export type Command =
  | { type: 'StartProgram'; at: MonoMs }
  | { type: 'Next'; at: MonoMs }
  | { type: 'Prev'; at: MonoMs }
  | { type: 'Goto'; at: MonoMs; slot: number }
  | { type: 'Adjust'; at: MonoMs; deltaMs: number }
  | { type: 'SetControl'; at: MonoMs; control: 'auto' | 'manual' }
  | { type: 'SendMessage'; at: MonoMs; text: string; dismiss: MessageDismiss }
  | { type: 'ClearMessage'; at: MonoMs }
  | { type: 'ResolveDecision'; at: MonoMs; id: number; choice: string };

export type Tick = { type: 'Tick'; at: MonoMs };
export type EngineInput = DomainEvent | Command | Tick;

export type SlotKind = 'studio' | 'media' | 'break';

/** One position of the flattened rundown. */
export interface Slot {
  index: number;
  blockIndex: number;
  kind: SlotKind;
  elementId: string | null;
  /** Media title, or block name for studio and break slots. */
  title: string;
  path: string | null;
  occurrence: number;
  /** Planned duration: media planned duration, break block duration, 0 for studio. */
  plannedDurationMs: number;
}

export type SlotStatus = 'pending' | 'onair' | 'done' | 'postponed' | 'dropped';

export interface SlotRuntime {
  status: SlotStatus;
  startedAt: MonoMs | null;
  endedAt: MonoMs | null;
}

export interface BlockRuntime {
  startedAt: MonoMs | null;
  endedAt: MonoMs | null;
  /** Sum of ±time commands applied to this block. */
  adjustMs: number;
  /** Duration the presenter works to, fixed when the block starts (includes recovery and adjustments). */
  targetMs: number | null;
}

export interface ActiveMessage {
  text: string;
  shownAt: MonoMs;
  expiresAt: MonoMs | null;
}

export type DecisionKind = 'output_restart' | 'all_outputs_stopped';

export interface Decision {
  id: number;
  kind: DecisionKind;
  at: MonoMs;
  defaultChoice: string;
  choice: string;
  confirmed: boolean;
}

export type Phase = 'preshow' | 'live' | 'ended';

export interface LiveState {
  episode: Episode;
  slots: Slot[];
  phase: Phase;
  /** Program start; shifted forward by frozen REC pauses. */
  t0: MonoMs | null;
  outputs: { rec: boolean; stream: boolean; recPaused: boolean };
  /** Set while a REC pause freezes program time (live-to-tape preset). */
  recPausedAt: MonoMs | null;
  control: 'auto' | 'manual';
  /** Whether OBS is reachable. Starts 'lost' until the adapter reports a connection. */
  obs: 'ok' | 'lost';
  /** Index into `slots`; -1 before the program starts. */
  cursor: number;
  /** Slot to resume after a postponed item that was aired out of order. */
  returnSlot: number | null;
  slotRt: SlotRuntime[];
  blockRt: BlockRuntime[];
  program: { scene: string | null; deckOnProgram: boolean };
  deck: { items: DeckItem[] | null; current: DeckCurrent | null };
  media: InputMedia | null;
  offScript: { scene: string; since: MonoMs } | null;
  message: ActiveMessage | null;
  decisions: Decision[];
  nextDecisionId: number;
}
```

- [ ] **Step 2: Write the failing test**

`server/test/helpers.ts`:
```ts
// SPDX-License-Identifier: GPL-2.0-or-later
import type { ProductionMode } from '@olc/shared';
import { soloFutsalEpisode } from '@olc/shared/testing';
import { createLiveState } from '../src/engine/state';
import type { LiveState } from '../src/engine/types';

/** Program start used by all tests (monotonic ms). */
export const T0 = 10_000;

export function freshState(mode: ProductionMode = 'live_to_tape'): LiveState {
  return createLiveState(soloFutsalEpisode(mode));
}
```

`server/test/engine/rundown.test.ts`:
```ts
// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import { SOLO_FUTSAL_DECK } from '@olc/shared/testing';
import {
  buildSlots, currentBlockIndex, firstSlotOfBlock, isElastic, lastBlockIndex,
  resolveDeckIndex, slotDuration, studioTimeMs, worstSource,
} from '../../src/engine/rundown';
import { freshState } from '../helpers';

const deck = () => SOLO_FUTSAL_DECK.map((i) => ({ ...i }));

describe('buildSlots', () => {
  it('flattens blocks into slots in order', () => {
    const s = freshState();
    expect(buildSlots(s.episode).map((x) => `${x.blockIndex}:${x.kind}`)).toEqual([
      '0:studio', '0:media', '0:studio', '1:break', '2:studio', '2:media', '2:studio', '3:studio',
    ]);
    expect(s.slots[1]).toMatchObject({ title: 'Servizio 1', path: 'D:/media/servizio1.mp4', plannedDurationMs: 180_000 });
    expect(s.slots[3]).toMatchObject({ title: 'Break 1', plannedDurationMs: 180_000 });
    expect(s.slots[0]).toMatchObject({ title: 'Primo blocco', plannedDurationMs: 0 });
  });
});

describe('createLiveState', () => {
  it('starts in preshow, before the first slot, with OBS not yet connected', () => {
    const s = freshState();
    expect(s.phase).toBe('preshow');
    expect(s.cursor).toBe(-1);
    expect(s.obs).toBe('lost');
    expect(s.slotRt.every((r) => r.status === 'pending')).toBe(true);
    expect(s.blockRt).toHaveLength(4);
  });
});

describe('resolveDeckIndex', () => {
  it('returns null while deck items are unknown', () => {
    const s = freshState();
    expect(resolveDeckIndex(null, s.slots[1]!)).toBeNull();
  });

  it('matches the n-th occurrence of the same path', () => {
    const s = freshState();
    const items = [
      { index: 0, path: 'a.mp4', title: 'A', durationMs: 1 },
      { index: 1, path: 'a.mp4', title: 'A', durationMs: 1 },
    ];
    expect(resolveDeckIndex(items, { ...s.slots[1]!, path: 'a.mp4', occurrence: 1 })).toBe(1);
    expect(resolveDeckIndex(items, { ...s.slots[1]!, path: 'a.mp4', occurrence: 2 })).toBeNull();
  });
});

describe('slotDuration', () => {
  it('uses the measured deck duration when known', () => {
    const s = freshState();
    s.deck.items = deck();
    expect(slotDuration(s, s.slots[1]!)).toEqual({ ms: 185_000, source: 'measured' });
  });

  it('unknown deck duration falls back to planned', () => {
    const s = freshState();
    s.deck.items = deck();
    s.deck.items[0]!.durationMs = -1;
    expect(slotDuration(s, s.slots[1]!)).toEqual({ ms: 180_000, source: 'planned' });
  });

  it('uses the planned duration for breaks', () => {
    const s = freshState();
    expect(slotDuration(s, s.slots[3]!)).toEqual({ ms: 180_000, source: 'planned' });
  });
});

describe('studioTimeMs', () => {
  it('subtracts media (measured when known) from the block', () => {
    const s = freshState();
    expect(studioTimeMs(s, 0)).toBe(540_000);
    s.deck.items = deck();
    expect(studioTimeMs(s, 0)).toBe(535_000);
  });

  it('ignores dropped media and is 0 for breaks', () => {
    const s = freshState();
    s.slotRt[5]!.status = 'dropped';
    expect(studioTimeMs(s, 2)).toBe(600_000);
    expect(studioTimeMs(s, 1)).toBe(0);
  });
});

describe('block helpers', () => {
  it('finds first slots, last block, elasticity and current block', () => {
    const s = freshState();
    expect(firstSlotOfBlock(s, 2)).toBe(4);
    expect(lastBlockIndex(s)).toBe(3);
    expect(isElastic(s, 0)).toBe(true);
    expect(isElastic(s, 1)).toBe(false);
    expect(currentBlockIndex(s)).toBe(-1);
    s.blockRt[0]!.startedAt = 1;
    s.blockRt[2]!.startedAt = 2;
    expect(currentBlockIndex(s)).toBe(2);
  });

  it('worstSource prefers estimated over planned over measured', () => {
    expect(worstSource('measured', 'planned')).toBe('planned');
    expect(worstSource('estimated', 'planned')).toBe('estimated');
    expect(worstSource('measured', 'measured')).toBe('measured');
  });
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `pnpm vitest run server/test/engine/rundown.test.ts`
Expected: FAIL. The modules `rundown` and `state` are missing.

- [ ] **Step 4: Implement**

`server/src/engine/rundown.ts`:
```ts
// SPDX-License-Identifier: GPL-2.0-or-later
import type { Episode } from '@olc/shared';
import type { DeckItem, LiveState, Slot, Source } from './types';

export interface TimedValue {
  ms: number;
  source: Source;
}

const SOURCE_RANK: Record<Source, number> = { measured: 0, planned: 1, estimated: 2 };

export function worstSource(a: Source, b: Source): Source {
  return SOURCE_RANK[a] >= SOURCE_RANK[b] ? a : b;
}

export function buildSlots(ep: Episode): Slot[] {
  const slots: Slot[] = [];
  ep.blocks.forEach((block, blockIndex) => {
    if (block.kind === 'break') {
      slots.push({
        index: slots.length, blockIndex, kind: 'break', elementId: null, title: block.name,
        path: null, occurrence: 0, plannedDurationMs: block.durationMs,
      });
      return;
    }
    for (const e of block.elements) {
      if (e.kind === 'studio') {
        slots.push({
          index: slots.length, blockIndex, kind: 'studio', elementId: e.id, title: block.name,
          path: null, occurrence: 0, plannedDurationMs: 0,
        });
      } else {
        slots.push({
          index: slots.length, blockIndex, kind: 'media', elementId: e.id, title: e.title,
          path: e.path, occurrence: e.occurrence, plannedDurationMs: e.plannedDurationMs,
        });
      }
    }
  });
  return slots;
}

/** Playlist index of a media slot: the n-th item with the same path. */
export function resolveDeckIndex(items: DeckItem[] | null, slot: Slot): number | null {
  if (items === null || slot.kind !== 'media' || slot.path === null) return null;
  let seen = 0;
  for (const item of items) {
    if (item.path !== slot.path) continue;
    if (seen === slot.occurrence) return item.index;
    seen++;
  }
  return null;
}

export function slotDuration(s: LiveState, slot: Slot): TimedValue {
  if (slot.kind === 'media') {
    const idx = resolveDeckIndex(s.deck.items, slot);
    const item = idx === null ? undefined : s.deck.items?.find((i) => i.index === idx);
    if (item !== undefined && item.durationMs >= 0) return { ms: item.durationMs, source: 'measured' };
  }
  return { ms: slot.plannedDurationMs, source: 'planned' };
}

/** Studio time of a block: its duration minus the media it still contains (never negative). */
export function studioTimeMs(s: LiveState, blockIndex: number): number {
  const block = s.episode.blocks[blockIndex];
  if (block === undefined || block.kind !== 'studio') return 0;
  const media = s.slots
    .filter((sl) => sl.blockIndex === blockIndex && sl.kind === 'media' && s.slotRt[sl.index]!.status !== 'dropped')
    .reduce((t, sl) => t + slotDuration(s, sl).ms, 0);
  return Math.max(0, block.durationMs - media);
}

export function firstSlotOfBlock(s: LiveState, blockIndex: number): number {
  return s.slots.findIndex((sl) => sl.blockIndex === blockIndex);
}

/** Highest block that has started, or -1. */
export function currentBlockIndex(s: LiveState): number {
  for (let i = s.blockRt.length - 1; i >= 0; i--) {
    if (s.blockRt[i]!.startedAt !== null) return i;
  }
  return -1;
}

export function lastBlockIndex(s: LiveState): number {
  return s.episode.blocks.length - 1;
}

export function isElastic(s: LiveState, blockIndex: number): boolean {
  const b = s.episode.blocks[blockIndex];
  return b !== undefined && b.kind === 'studio' && b.elastic;
}
```

`server/src/engine/state.ts`:
```ts
// SPDX-License-Identifier: GPL-2.0-or-later
import type { Episode } from '@olc/shared';
import { buildSlots } from './rundown';
import type { LiveState } from './types';

export function createLiveState(episode: Episode): LiveState {
  const slots = buildSlots(episode);
  return {
    episode,
    slots,
    phase: 'preshow',
    t0: null,
    outputs: { rec: false, stream: false, recPaused: false },
    recPausedAt: null,
    control: 'auto',
    obs: 'lost',
    cursor: -1,
    returnSlot: null,
    slotRt: slots.map(() => ({ status: 'pending', startedAt: null, endedAt: null })),
    blockRt: episode.blocks.map(() => ({ startedAt: null, endedAt: null, adjustMs: 0, targetMs: null })),
    program: { scene: null, deckOnProgram: false },
    deck: { items: null, current: null },
    media: null,
    offScript: null,
    message: null,
    decisions: [],
    nextDecisionId: 1,
  };
}
```

- [ ] **Step 5: Run to verify it passes**

Run: `pnpm vitest run server/test && pnpm typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add server
git commit -m "feat(engine): live state types, flattened rundown slots and helpers"
```

---

### Task 5: Timing primitives (planned schedule, block target with recovery)

**Files:**
- Create: `server/src/engine/timing.ts`
- Test: `server/test/engine/timing.test.ts`

**Interfaces:**
- Consumes: `studioTimeMs`, `isElastic` (Task 4).
- Produces: `plannedStartAt(s, bi): MonoMs | null`, `plannedEndAt(s, bi): MonoMs | null`, `targetForBlockStart(s, bi, at): number`, `blockEndsAt(s, bi): MonoMs | null`.

Rules (TECH-DESIGN §5.4, SPEC §10):
- The planned schedule uses the **original** block durations measured from `t0`.
- The target of a block is computed when the block starts: `durationMs + adjustMs`.
  - If the block is **elastic** and starts **late**, the lateness is absorbed from its studio time: `target − min(late, studioTimeMs)`.
  - If the block starts early, the gain is kept and the target is unchanged (early policy `keep`).

- [ ] **Step 1: Write the failing test**

`server/test/engine/timing.test.ts`:
```ts
// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import { blockEndsAt, plannedEndAt, plannedStartAt, targetForBlockStart } from '../../src/engine/timing';
import { T0, freshState } from '../helpers';

function started() {
  const s = freshState();
  s.t0 = T0;
  return s;
}

describe('planned schedule', () => {
  it('is null before the program starts', () => {
    expect(plannedStartAt(freshState(), 0)).toBeNull();
  });

  it('adds original block durations from t0', () => {
    const s = started();
    expect(plannedStartAt(s, 0)).toBe(T0);
    expect(plannedStartAt(s, 2)).toBe(T0 + 900_000);
    expect(plannedEndAt(s, 3)).toBe(T0 + 1_620_000);
  });

  it('ignores adjustments (the plan is the official rundown)', () => {
    const s = started();
    s.blockRt[0]!.adjustMs = 60_000;
    expect(plannedStartAt(s, 1)).toBe(T0 + 720_000);
  });
});

describe('targetForBlockStart', () => {
  it('is the block duration when on time', () => {
    const s = started();
    expect(targetForBlockStart(s, 2, T0 + 900_000)).toBe(600_000);
  });

  it('absorbs lateness from studio time of an elastic block', () => {
    const s = started();
    expect(targetForBlockStart(s, 2, T0 + 990_000)).toBe(510_000);
  });

  it('never absorbs more than the studio time', () => {
    const s = started();
    // b2 studio time = 600 000 - 120 000 = 480 000
    expect(targetForBlockStart(s, 2, T0 + 900_000 + 500_000)).toBe(120_000);
  });

  it('does not absorb on a non-elastic block (break)', () => {
    const s = started();
    expect(targetForBlockStart(s, 1, T0 + 800_000)).toBe(180_000);
  });

  it('keeps the gain when the block starts early', () => {
    const s = started();
    expect(targetForBlockStart(s, 2, T0 + 870_000)).toBe(600_000);
  });

  it('includes adjustments', () => {
    const s = started();
    s.blockRt[2]!.adjustMs = 30_000;
    expect(targetForBlockStart(s, 2, T0 + 900_000)).toBe(630_000);
  });
});

describe('blockEndsAt', () => {
  it('is start + target once started, null otherwise', () => {
    const s = started();
    expect(blockEndsAt(s, 0)).toBeNull();
    s.blockRt[0] = { startedAt: T0, endedAt: null, adjustMs: 0, targetMs: 720_000 };
    expect(blockEndsAt(s, 0)).toBe(T0 + 720_000);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run server/test/engine/timing.test.ts`
Expected: FAIL. The module `timing` is missing.

- [ ] **Step 3: Implement**

`server/src/engine/timing.ts`:
```ts
// SPDX-License-Identifier: GPL-2.0-or-later
import { isElastic, studioTimeMs } from './rundown';
import type { LiveState, MonoMs } from './types';

export function plannedStartAt(s: LiveState, blockIndex: number): MonoMs | null {
  if (s.t0 === null) return null;
  let t = s.t0;
  for (let j = 0; j < blockIndex; j++) t += s.episode.blocks[j]!.durationMs;
  return t;
}

export function plannedEndAt(s: LiveState, blockIndex: number): MonoMs | null {
  const start = plannedStartAt(s, blockIndex);
  return start === null ? null : start + s.episode.blocks[blockIndex]!.durationMs;
}

/** Duration the presenter gets for a block that starts at `at` (recovery policy: next_elastic, early: keep). */
export function targetForBlockStart(s: LiveState, blockIndex: number, at: MonoMs): number {
  const base = s.episode.blocks[blockIndex]!.durationMs + s.blockRt[blockIndex]!.adjustMs;
  const plannedStart = plannedStartAt(s, blockIndex);
  if (plannedStart === null || !isElastic(s, blockIndex)) return base;
  const late = at - plannedStart;
  if (late <= 0) return base;
  return base - Math.min(late, studioTimeMs(s, blockIndex));
}

export function blockEndsAt(s: LiveState, blockIndex: number): MonoMs | null {
  const rt = s.blockRt[blockIndex];
  if (rt === undefined || rt.startedAt === null || rt.targetMs === null) return null;
  return rt.startedAt + rt.targetMs;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm vitest run server/test && pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server
git commit -m "feat(engine): planned schedule and block targets with next-elastic recovery"
```

---

### Task 6: Cursor operations and matcher (sequential cursor, "OBS reality wins")

**Files:**
- Create: `server/src/engine/cursor.ts`, `server/src/engine/matcher.ts`
- Test: `server/test/engine/matcher.test.ts`

**Interfaces:**
- Consumes: Task 4 helpers, `targetForBlockStart` (Task 5).
- Produces:
  - `cursor.ts`: `startBlock(s, bi, at)`, `enterSlot(s, i, at)`, `closeSlot(s, i, at)`, `moveTo(s, target, at)` (forward only), `correctTo(s, i, at)` (manual correction backwards);
  - `matcher.ts`: `type Target`, `classify(s): Target | null`, `slotMatches(s, slot, t): boolean`, `match(s, at): void`.
  - All of these **mutate** `s`. The reducer passes them a clone.

Rules (TECH-DESIGN §5.3, SPEC F9/F10):
1. **Classification of what is on Program:**
   - if the Playlist Deck source is on Program and a deck item is loaded → `media`;
   - else if the scene is a break block's scene → `break`;
   - else if the scene belongs to a scene group → `studio`;
   - else → `null`, which means off-script.
2. **Same target as the current slot:** nothing happens. A camera switch within a studio group therefore never advances.
3. **Returning from an out-of-order postponed item:** if `returnSlot` is set and matches the target, resume there.
4. **Forward search:** from `returnSlot ?? cursor`, find the first `pending` or `postponed` slot that matches, then `moveTo`. Skipped studio slots become `done`; skipped media and break slots become `postponed`.
5. **Backward search:** a `postponed` slot that matches is aired out of order, and the cursor remembers `returnSlot`.
6. **No match anywhere:** `offScript`. The block keeps running and the cursor does not move.

Media matching:
- when deck items are known, compare the resolved playlist index (path + occurrence);
- when they are unknown, compare the path.

- [ ] **Step 1: Write the failing test**

`server/test/engine/matcher.test.ts`:
```ts
// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import { SOLO_FUTSAL_DECK } from '@olc/shared/testing';
import { correctTo, moveTo } from '../../src/engine/cursor';
import { classify, match } from '../../src/engine/matcher';
import type { LiveState } from '../../src/engine/types';
import { T0, freshState } from '../helpers';

function live(): LiveState {
  const s = freshState();
  s.phase = 'live';
  s.t0 = T0;
  s.deck.items = SOLO_FUTSAL_DECK.map((i) => ({ ...i }));
  s.program = { scene: 'CAM 1', deckOnProgram: false };
  moveTo(s, 0, T0);
  return s;
}

function onScene(s: LiveState, scene: string, at: number) {
  s.program = { scene, deckOnProgram: false };
  match(s, at);
}

function deckPlays(s: LiveState, index: number, at: number) {
  const item = s.deck.items?.find((i) => i.index === index);
  s.deck.current = {
    index, path: item?.path ?? 'D:/media/servizio1.mp4', title: item?.title ?? '', positionMs: 0,
    durationMs: item?.durationMs ?? 1000, playing: true, at,
  };
  s.program = { scene: 'PLAYOUT', deckOnProgram: true };
  match(s, at);
}

const statuses = (s: LiveState) => s.slotRt.map((r) => r.status);

describe('moveTo from the start', () => {
  it('puts slot 0 on air and starts block 0 with its target', () => {
    const s = live();
    expect(s.cursor).toBe(0);
    expect(s.slotRt[0]).toEqual({ status: 'onair', startedAt: T0, endedAt: null });
    expect(s.blockRt[0]).toMatchObject({ startedAt: T0, targetMs: 720_000 });
  });
});

describe('classify', () => {
  it('prefers deck media on program over the scene', () => {
    const s = live();
    s.deck.current = { index: 0, path: 'D:/media/servizio1.mp4', title: 'Servizio 1', positionMs: 0, durationMs: 185_000, playing: true, at: T0 };
    s.program = { scene: 'CAM 1', deckOnProgram: true };
    expect(classify(s)).toEqual({ kind: 'media', index: 0, path: 'D:/media/servizio1.mp4' });
  });

  it('recognises break and studio scenes, and nothing else', () => {
    const s = live();
    s.program = { scene: 'BREAK', deckOnProgram: false };
    expect(classify(s)).toEqual({ kind: 'break', scene: 'BREAK' });
    s.program = { scene: 'CAM 3', deckOnProgram: false };
    expect(classify(s)).toEqual({ kind: 'studio', scene: 'CAM 3' });
    s.program = { scene: 'CAMERA OSPITE', deckOnProgram: false };
    expect(classify(s)).toBeNull();
  });
});

describe('match', () => {
  it('does not advance on a camera switch within the studio group', () => {
    const s = live();
    onScene(s, 'CAM 2', T0 + 5_000);
    expect(s.cursor).toBe(0);
  });

  it('follows studio -> media -> studio -> break -> studio', () => {
    const s = live();
    deckPlays(s, 0, T0 + 60_000);
    expect(s.cursor).toBe(1);
    expect(s.slotRt[0]).toMatchObject({ status: 'done', endedAt: T0 + 60_000 });
    onScene(s, 'CAM 1', T0 + 245_000);
    expect(s.cursor).toBe(2);
    onScene(s, 'BREAK', T0 + 720_000);
    expect(s.cursor).toBe(3);
    expect(s.blockRt[0]!.endedAt).toBe(T0 + 720_000);
    expect(s.blockRt[1]!.startedAt).toBe(T0 + 720_000);
    onScene(s, 'CAM 1', T0 + 900_000);
    expect(s.cursor).toBe(4);
    expect(s.blockRt[2]).toMatchObject({ startedAt: T0 + 900_000, targetMs: 600_000 });
  });

  it('postpones skipped media and closes skipped studio slots', () => {
    const s = live();
    onScene(s, 'BREAK', T0 + 700_000);
    expect(s.cursor).toBe(3);
    expect(statuses(s).slice(0, 4)).toEqual(['done', 'postponed', 'done', 'onair']);
  });

  it('unknown scene is off-script: cursor and block unchanged', () => {
    const s = live();
    onScene(s, 'CAMERA OSPITE', T0 + 30_000);
    expect(s.cursor).toBe(0);
    expect(s.offScript).toEqual({ scene: 'CAMERA OSPITE', since: T0 + 30_000 });
    expect(s.blockRt[0]!.endedAt).toBeNull();
    onScene(s, 'CAM 1', T0 + 40_000);
    expect(s.offScript).toBeNull();
    expect(s.cursor).toBe(0);
  });

  it('airs a postponed item out of order and returns to where it was', () => {
    const s = live();
    onScene(s, 'BREAK', T0 + 700_000); // Servizio 1 postponed
    onScene(s, 'CAM 1', T0 + 880_000); // block 2 studio, slot 4
    deckPlays(s, 0, T0 + 900_000); // Servizio 1 now
    expect(s.cursor).toBe(1);
    expect(s.returnSlot).toBe(4);
    expect(s.slotRt[1]!.status).toBe('onair');
    onScene(s, 'CAM 2', T0 + 1_085_000);
    expect(s.cursor).toBe(4);
    expect(s.returnSlot).toBeNull();
    expect(s.slotRt[1]).toMatchObject({ status: 'done', endedAt: T0 + 1_085_000 });
  });

  it('same file twice: the second occurrence matches the second playlist item', () => {
    const s = live();
    const b2 = s.episode.blocks[2]!;
    if (b2.kind !== 'studio') throw new Error('fixture changed');
    s.slots[5] = { ...s.slots[5]!, path: 'D:/media/servizio1.mp4', occurrence: 1 };
    s.deck.items = [
      { index: 0, path: 'D:/media/servizio1.mp4', title: 'Servizio 1', durationMs: 185_000 },
      { index: 1, path: 'D:/media/servizio1.mp4', title: 'Servizio 1 (replica)', durationMs: 185_000 },
    ];
    deckPlays(s, 1, T0 + 10_000);
    expect(s.cursor).toBe(5);
    expect(s.slotRt[1]!.status).toBe('postponed');
  });

  it('matches by path when deck items are unknown', () => {
    const s = live();
    s.deck.items = null;
    s.deck.current = { index: 7, path: 'D:/media/servizio2.mp4', title: '', positionMs: 0, durationMs: 120_000, playing: true, at: T0 };
    s.program = { scene: 'PLAYOUT', deckOnProgram: true };
    match(s, T0 + 20_000);
    expect(s.cursor).toBe(5);
  });

  it('marks deck media that is not in the rundown as off-script', () => {
    const s = live();
    s.deck.items = [...s.deck.items!, { index: 2, path: 'D:/media/extra.mp4', title: 'Extra', durationMs: 30_000 }];
    s.deck.current = { index: 2, path: 'D:/media/extra.mp4', title: 'Extra', positionMs: 0, durationMs: 30_000, playing: true, at: T0 };
    s.program = { scene: 'PLAYOUT', deckOnProgram: true };
    match(s, T0 + 20_000);
    expect(s.cursor).toBe(0);
    expect(s.offScript).toEqual({ scene: 'PLAYOUT', since: T0 + 20_000 });
  });
});

describe('correctTo', () => {
  it('moves back, resets later slots and un-starts later blocks', () => {
    const s = live();
    onScene(s, 'BREAK', T0 + 700_000);
    onScene(s, 'CAM 1', T0 + 880_000);
    correctTo(s, 2, T0 + 890_000);
    expect(s.cursor).toBe(2);
    expect(s.slotRt[2]).toMatchObject({ status: 'onair' });
    expect(s.slotRt[3]!.status).toBe('pending');
    expect(s.slotRt[4]!.status).toBe('pending');
    expect(s.blockRt[1]!.startedAt).toBeNull();
    expect(s.blockRt[2]!.startedAt).toBeNull();
    expect(s.blockRt[0]!.endedAt).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run server/test/engine/matcher.test.ts`
Expected: FAIL. The modules `cursor` and `matcher` are missing.

- [ ] **Step 3: Implement the cursor operations**

`server/src/engine/cursor.ts`:
```ts
// SPDX-License-Identifier: GPL-2.0-or-later
import { currentBlockIndex } from './rundown';
import { targetForBlockStart } from './timing';
import type { LiveState, MonoMs } from './types';

export function startBlock(s: LiveState, blockIndex: number, at: MonoMs): void {
  const rt = s.blockRt[blockIndex]!;
  if (rt.startedAt !== null) return;
  rt.startedAt = at;
  rt.endedAt = null;
  rt.targetMs = targetForBlockStart(s, blockIndex, at);
}

export function enterSlot(s: LiveState, index: number, at: MonoMs): void {
  const rt = s.slotRt[index]!;
  rt.status = 'onair';
  rt.startedAt = at;
  rt.endedAt = null;
}

export function closeSlot(s: LiveState, index: number, at: MonoMs): void {
  if (index < 0) return;
  const rt = s.slotRt[index]!;
  if (rt.status !== 'onair') return;
  rt.status = 'done';
  rt.endedAt = at;
}

/** Advance the cursor forward to `target`. Skipped slots are closed (studio) or postponed (media, break). */
export function moveTo(s: LiveState, target: number, at: MonoMs): void {
  const from = s.cursor;
  closeSlot(s, from, at);
  for (let j = from + 1; j < target; j++) {
    const rt = s.slotRt[j]!;
    if (rt.status !== 'pending') continue;
    rt.status = s.slots[j]!.kind === 'studio' ? 'done' : 'postponed';
  }
  enterSlot(s, target, at);

  const blockIndex = s.slots[target]!.blockIndex;
  const current = currentBlockIndex(s);
  if (blockIndex > current) {
    for (let b = 0; b < blockIndex; b++) {
      const rt = s.blockRt[b]!;
      if (rt.startedAt !== null && rt.endedAt === null) rt.endedAt = at;
    }
    startBlock(s, blockIndex, at);
  }
  if (s.slots[target]!.kind === 'break') s.media = null;
  s.cursor = target;
}

/** Manual correction to an earlier slot: later slots return to pending and later blocks are un-started. */
export function correctTo(s: LiveState, index: number, at: MonoMs): void {
  for (let j = index + 1; j <= s.cursor; j++) {
    s.slotRt[j] = { status: 'pending', startedAt: null, endedAt: null };
  }
  const blockIndex = s.slots[index]!.blockIndex;
  for (let b = blockIndex + 1; b < s.blockRt.length; b++) {
    s.blockRt[b] = { ...s.blockRt[b]!, startedAt: null, endedAt: null, targetMs: null };
  }
  s.blockRt[blockIndex]!.endedAt = null;
  const rt = s.slotRt[index]!;
  rt.status = 'onair';
  rt.startedAt = rt.startedAt ?? at;
  rt.endedAt = null;
  startBlock(s, blockIndex, at);
  s.cursor = index;
  s.returnSlot = null;
}
```

- [ ] **Step 4: Implement the matcher**

`server/src/engine/matcher.ts`:
```ts
// SPDX-License-Identifier: GPL-2.0-or-later
import { closeSlot, enterSlot, moveTo } from './cursor';
import { resolveDeckIndex } from './rundown';
import type { LiveState, MonoMs, Slot } from './types';

export type Target =
  | { kind: 'media'; index: number; path: string }
  | { kind: 'break'; scene: string }
  | { kind: 'studio'; scene: string };

export function classify(s: LiveState): Target | null {
  const cur = s.deck.current;
  if (s.program.deckOnProgram && cur !== null) return { kind: 'media', index: cur.index, path: cur.path };
  const scene = s.program.scene;
  if (scene === null) return null;
  if (s.episode.blocks.some((b) => b.kind === 'break' && b.scene === scene)) return { kind: 'break', scene };
  if (s.episode.sceneGroups.some((g) => g.scenes.includes(scene))) return { kind: 'studio', scene };
  return null;
}

export function slotMatches(s: LiveState, slot: Slot, t: Target): boolean {
  const block = s.episode.blocks[slot.blockIndex]!;
  switch (t.kind) {
    case 'media': {
      if (slot.kind !== 'media') return false;
      if (s.deck.items !== null) return resolveDeckIndex(s.deck.items, slot) === t.index;
      return slot.path === t.path;
    }
    case 'break':
      return slot.kind === 'break' && block.kind === 'break' && block.scene === t.scene;
    case 'studio': {
      if (slot.kind !== 'studio' || block.kind !== 'studio') return false;
      const group = s.episode.sceneGroups.find((g) => g.id === block.sceneGroupId);
      return group !== undefined && group.scenes.includes(t.scene);
    }
  }
}

function markOffScript(s: LiveState, at: MonoMs): void {
  const scene = s.program.scene ?? '';
  if (s.offScript === null || s.offScript.scene !== scene) s.offScript = { scene, since: at };
}

/** Align the cursor with what OBS shows on Program. Mutates `s`. */
export function match(s: LiveState, at: MonoMs): void {
  const target = classify(s);
  if (target === null) {
    markOffScript(s, at);
    return;
  }

  const current = s.cursor >= 0 ? s.slots[s.cursor]! : null;
  if (current !== null && slotMatches(s, current, target)) {
    s.offScript = null;
    return;
  }

  if (s.returnSlot !== null && slotMatches(s, s.slots[s.returnSlot]!, target)) {
    closeSlot(s, s.cursor, at);
    s.cursor = s.returnSlot;
    s.returnSlot = null;
    s.offScript = null;
    return;
  }

  const base = s.returnSlot ?? s.cursor;
  for (let i = base + 1; i < s.slots.length; i++) {
    const status = s.slotRt[i]!.status;
    if ((status === 'pending' || status === 'postponed') && slotMatches(s, s.slots[i]!, target)) {
      if (s.returnSlot !== null) {
        closeSlot(s, s.cursor, at);
        s.cursor = s.returnSlot;
        s.returnSlot = null;
      }
      moveTo(s, i, at);
      s.offScript = null;
      return;
    }
  }

  for (let i = 0; i < base; i++) {
    if (s.slotRt[i]!.status === 'postponed' && slotMatches(s, s.slots[i]!, target)) {
      if (s.returnSlot === null) s.returnSlot = s.cursor;
      else closeSlot(s, s.cursor, at);
      enterSlot(s, i, at);
      s.cursor = i;
      s.offScript = null;
      return;
    }
  }

  markOffScript(s, at);
}
```

One detail to keep in mind: when an out-of-order item is aired, the slot it interrupted (`returnSlot`) stays `onair`. When the matcher later moves forward from `returnSlot`, the `closeSlot(s, s.cursor, at)` inside `moveTo` closes it.

- [ ] **Step 5: Run to verify it passes**

Run: `pnpm vitest run server/test && pnpm typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add server
git commit -m "feat(engine): sequential cursor matcher, postponed items and manual correction"
```

---

### Task 7: Reducer — domain events

**Files:**
- Create: `server/src/engine/reducer.ts`
- Modify: `server/test/helpers.ts` (add `run` and `liveState`)
- Test: `server/test/engine/reducer-events.test.ts`

**Interfaces:**
- Consumes: `match` (Task 6); `moveTo`, `closeSlot` (Task 6); `currentBlockIndex`, `lastBlockIndex`, `resolveDeckIndex` (Task 4).
- Produces: `reduce(prev: LiveState, input: EngineInput): ReduceResult` with `interface ReduceResult { state: LiveState; changed: boolean }`. When `changed` is false, `state === prev` (same reference). Also produces the helpers `startProgram(s, at)` and `endProgram(s, at)`, which are exported for Task 8.
- This task handles only `DomainEvent`s. `Command` and `Tick` are added in Task 8. Until then, `apply` returns `false` for them.

Rules (TECH-DESIGN §5.6):

| Event | Effect |
|---|---|
| `OutputChanged started` in preshow | Program starts: `t0 = at`, slot 0 on air, then `match` |
| `started` in live, when no output was on | Records the decision `output_restart` (default `new_session` for live-to-tape, `continue` otherwise) and confirms any pending `all_outputs_stopped` as `interruption` |
| `stopped`, leaving no output on | In the last block, the program **ends**. Otherwise records the decision `all_outputs_stopped` (default `interruption`) |
| `paused` (REC) | If the preset freezes program time, `recPausedAt = at` |
| `resumed` (REC) | Shifts `t0`, the current block start and the current slot start by the pause length |
| `DeckPlaylistChanged` | Media slots not yet aired with no playlist match → `dropped`; a dropped slot found again → `pending` |
| All events | Matching runs only when `phase === 'live'` and `control === 'auto'` |

- [ ] **Step 1: Extend the test helpers**

Replace `server/test/helpers.ts` with:
```ts
// SPDX-License-Identifier: GPL-2.0-or-later
import type { ProductionMode } from '@olc/shared';
import { SOLO_FUTSAL_DECK, soloFutsalEpisode } from '@olc/shared/testing';
import { reduce } from '../src/engine/reducer';
import { createLiveState } from '../src/engine/state';
import type { EngineInput, LiveState } from '../src/engine/types';

/** Program start used by all tests (monotonic ms). */
export const T0 = 10_000;

export function freshState(mode: ProductionMode = 'live_to_tape'): LiveState {
  return createLiveState(soloFutsalEpisode(mode));
}

export function run(state: LiveState, ...inputs: EngineInput[]): LiveState {
  return inputs.reduce((s, input) => reduce(s, input).state, state);
}

/** OBS connected, deck list known, CAM 1 on program, REC started at T0. */
export function liveState(mode: ProductionMode = 'live_to_tape'): LiveState {
  return run(
    freshState(mode),
    { type: 'SourceRestored', at: 0 },
    { type: 'DeckPlaylistChanged', at: 0, items: SOLO_FUTSAL_DECK.map((i) => ({ ...i })) },
    { type: 'ProgramSceneChanged', at: 0, scene: 'CAM 1', deckOnProgram: false },
    { type: 'OutputChanged', at: T0, output: 'rec', state: 'started' },
  );
}
```

- [ ] **Step 2: Write the failing test**

`server/test/engine/reducer-events.test.ts`:
```ts
// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import { SOLO_FUTSAL_DECK } from '@olc/shared/testing';
import { reduce } from '../../src/engine/reducer';
import { T0, freshState, liveState, run } from '../helpers';

describe('program start', () => {
  it('starts the program on the first output and matches Program', () => {
    const s = liveState();
    expect(s.phase).toBe('live');
    expect(s.t0).toBe(T0);
    expect(s.cursor).toBe(0);
    expect(s.outputs).toEqual({ rec: true, stream: false, recPaused: false });
  });

  it('a second output does not restart the program', () => {
    const s = run(liveState(), { type: 'OutputChanged', at: T0 + 5_000, output: 'stream', state: 'started' });
    expect(s.t0).toBe(T0);
    expect(s.decisions).toEqual([]);
  });
});

describe('outputs stopping and restarting', () => {
  it('stopping every output mid-show asks for a decision and keeps the show live', () => {
    const s = run(liveState(), { type: 'OutputChanged', at: T0 + 60_000, output: 'rec', state: 'stopped' });
    expect(s.phase).toBe('live');
    expect(s.decisions).toEqual([
      { id: 1, kind: 'all_outputs_stopped', at: T0 + 60_000, defaultChoice: 'interruption', choice: 'interruption', confirmed: false },
    ]);
  });

  it('restarting confirms the interruption and records a restart decision (live-to-tape: new_session)', () => {
    const s = run(
      liveState(),
      { type: 'OutputChanged', at: T0 + 60_000, output: 'rec', state: 'stopped' },
      { type: 'OutputChanged', at: T0 + 70_000, output: 'rec', state: 'started' },
    );
    expect(s.decisions[0]).toMatchObject({ kind: 'all_outputs_stopped', confirmed: true, choice: 'interruption' });
    expect(s.decisions[1]).toMatchObject({ id: 2, kind: 'output_restart', defaultChoice: 'new_session', confirmed: false });
  });

  it('restart default is continue for streaming', () => {
    const s = run(
      liveState('streaming'),
      { type: 'OutputChanged', at: T0 + 60_000, output: 'rec', state: 'stopped' },
      { type: 'OutputChanged', at: T0 + 70_000, output: 'rec', state: 'started' },
    );
    expect(s.decisions[1]).toMatchObject({ kind: 'output_restart', defaultChoice: 'continue' });
  });

  it('stopping in the last block ends the program', () => {
    const s = liveState();
    // Put the show in the last block directly (commands such as Goto arrive in Task 8).
    s.cursor = 7;
    s.slotRt[7] = { status: 'onair', startedAt: T0 + 1_500_000, endedAt: null };
    s.blockRt[3] = { startedAt: T0 + 1_500_000, endedAt: null, adjustMs: 0, targetMs: 120_000 };
    const ended = run(s, { type: 'OutputChanged', at: T0 + 1_620_000, output: 'rec', state: 'stopped' });
    expect(ended.phase).toBe('ended');
    expect(ended.slotRt[7]).toMatchObject({ status: 'done', endedAt: T0 + 1_620_000 });
    expect(ended.blockRt[3]!.endedAt).toBe(T0 + 1_620_000);
  });
});

describe('REC pause', () => {
  it('live-to-tape: pause/resume shifts t0 and the current block and slot', () => {
    const s = run(
      liveState(),
      { type: 'OutputChanged', at: T0 + 100_000, output: 'rec', state: 'paused' },
      { type: 'OutputChanged', at: T0 + 130_000, output: 'rec', state: 'resumed' },
    );
    expect(s.t0).toBe(T0 + 30_000);
    expect(s.blockRt[0]!.startedAt).toBe(T0 + 30_000);
    expect(s.slotRt[0]!.startedAt).toBe(T0 + 30_000);
    expect(s.recPausedAt).toBeNull();
    expect(s.outputs.recPaused).toBe(false);
  });

  it('streaming: pause does not freeze program time', () => {
    const s = run(
      liveState('streaming'),
      { type: 'OutputChanged', at: T0 + 100_000, output: 'rec', state: 'paused' },
      { type: 'OutputChanged', at: T0 + 130_000, output: 'rec', state: 'resumed' },
    );
    expect(s.t0).toBe(T0);
  });
});

describe('playlist changes', () => {
  it('drops a media slot removed from the playlist and restores it when re-added', () => {
    const removed = run(liveState(), {
      type: 'DeckPlaylistChanged', at: T0 + 1_000, items: [{ ...SOLO_FUTSAL_DECK[0]! }],
    });
    expect(removed.slotRt[5]!.status).toBe('dropped');
    const back = run(removed, {
      type: 'DeckPlaylistChanged', at: T0 + 2_000, items: SOLO_FUTSAL_DECK.map((i) => ({ ...i })),
    });
    expect(back.slotRt[5]!.status).toBe('pending');
  });

  it('never drops a slot that is already on air or done', () => {
    const s = run(
      liveState(),
      { type: 'DeckItemStarted', at: T0 + 60_000, index: 0, path: 'D:/media/servizio1.mp4', title: 'Servizio 1', durationMs: 185_000 },
      { type: 'ProgramSceneChanged', at: T0 + 60_000, scene: 'PLAYOUT', deckOnProgram: true },
      { type: 'DeckPlaylistChanged', at: T0 + 61_000, items: [{ ...SOLO_FUTSAL_DECK[1]!, index: 0 }] },
    );
    expect(s.cursor).toBe(1);
    expect(s.slotRt[1]!.status).toBe('onair');
  });
});

describe('deck and media status', () => {
  it('tracks deck playback and matches when the deck goes on program', () => {
    const s = run(
      liveState(),
      { type: 'DeckItemStarted', at: T0 + 60_000, index: 0, path: 'D:/media/servizio1.mp4', title: 'Servizio 1', durationMs: 185_000 },
    );
    expect(s.cursor).toBe(0); // deck not on program yet
    const onAir = run(s, { type: 'ProgramSceneChanged', at: T0 + 61_000, scene: 'PLAYOUT', deckOnProgram: true });
    expect(onAir.cursor).toBe(1);
    const paused = run(onAir, { type: 'DeckPlayback', at: T0 + 70_000, index: 0, positionMs: 9_000, durationMs: 185_000, playing: false });
    expect(paused.deck.current).toMatchObject({ positionMs: 9_000, playing: false, path: 'D:/media/servizio1.mp4' });
  });

  it('stores media input status', () => {
    const s = run(liveState(), { type: 'MediaStatus', at: T0 + 1, input: 'Tappo', playing: true, cursorMs: 0, durationMs: 180_000 });
    expect(s.media).toEqual({ input: 'Tappo', playing: true, cursorMs: 0, durationMs: 180_000, at: T0 + 1 });
  });
});

describe('connection', () => {
  it('reports unchanged state as the same reference', () => {
    const s = liveState();
    const lost = reduce(s, { type: 'SourceLost', at: T0 + 1 });
    expect(lost.changed).toBe(true);
    expect(lost.state.obs).toBe('lost');
    const again = reduce(lost.state, { type: 'SourceLost', at: T0 + 2 });
    expect(again.changed).toBe(false);
    expect(again.state).toBe(lost.state);
  });
});

describe('phase guards', () => {
  it('ignores matching outside live', () => {
    const pre = run(freshState(), { type: 'ProgramSceneChanged', at: 1, scene: 'BREAK', deckOnProgram: false });
    expect(pre.cursor).toBe(-1);
    expect(pre.program.scene).toBe('BREAK');
    const ended = { ...liveState(), phase: 'ended' as const };
    const after = run(ended, { type: 'ProgramSceneChanged', at: T0 + 5, scene: 'BREAK', deckOnProgram: false });
    expect(after.cursor).toBe(0);
  });
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `pnpm vitest run server/test/engine/reducer-events.test.ts`
Expected: FAIL. The module `reducer` is missing.

- [ ] **Step 4: Implement**

`server/src/engine/reducer.ts`:
```ts
// SPDX-License-Identifier: GPL-2.0-or-later
import { closeSlot, moveTo } from './cursor';
import { match } from './matcher';
import { currentBlockIndex, lastBlockIndex, resolveDeckIndex } from './rundown';
import type { DecisionKind, DomainEvent, EngineInput, LiveState, MonoMs } from './types';

export interface ReduceResult {
  state: LiveState;
  changed: boolean;
}

/** Pure: never mutates `prev`. Returns `prev` itself when nothing changed. */
export function reduce(prev: LiveState, input: EngineInput): ReduceResult {
  const s = structuredClone(prev);
  const changed = apply(s, input);
  return changed ? { state: s, changed: true } : { state: prev, changed: false };
}

function apply(s: LiveState, input: EngineInput): boolean {
  switch (input.type) {
    case 'ProgramSceneChanged':
    case 'OutputChanged':
    case 'DeckItemStarted':
    case 'DeckPlayback':
    case 'DeckPlaylistChanged':
    case 'MediaStatus':
    case 'SourceLost':
    case 'SourceRestored':
      return applyEvent(s, input);
    default:
      return false; // commands and ticks: Task 8
  }
}

const canMatch = (s: LiveState) => s.phase === 'live' && s.control === 'auto';

function applyEvent(s: LiveState, e: DomainEvent): boolean {
  switch (e.type) {
    case 'ProgramSceneChanged':
      s.program = { scene: e.scene, deckOnProgram: e.deckOnProgram };
      if (canMatch(s)) match(s, e.at);
      return true;

    case 'OutputChanged':
      return onOutput(s, e);

    case 'DeckItemStarted':
      s.deck.current = {
        index: e.index, path: e.path, title: e.title, positionMs: 0, durationMs: e.durationMs, playing: true, at: e.at,
      };
      if (canMatch(s) && s.program.deckOnProgram) match(s, e.at);
      return true;

    case 'DeckPlayback': {
      const prev = s.deck.current;
      const item = s.deck.items?.find((i) => i.index === e.index);
      const sameItem = prev !== null && prev.index === e.index;
      s.deck.current = {
        index: e.index,
        path: item?.path ?? (sameItem ? prev!.path : ''),
        title: item?.title ?? (sameItem ? prev!.title : ''),
        positionMs: e.positionMs,
        durationMs: e.durationMs,
        playing: e.playing,
        at: e.at,
      };
      if (!sameItem && canMatch(s) && s.program.deckOnProgram) match(s, e.at);
      return true;
    }

    case 'DeckPlaylistChanged':
      s.deck.items = e.items.map((i) => ({ ...i }));
      reconcileDropped(s);
      return true;

    case 'MediaStatus':
      s.media = { input: e.input, playing: e.playing, cursorMs: e.cursorMs, durationMs: e.durationMs, at: e.at };
      return true;

    case 'SourceLost':
      if (s.obs === 'lost') return false;
      s.obs = 'lost';
      return true;

    case 'SourceRestored':
      if (s.obs === 'ok') return false;
      s.obs = 'ok';
      return true;
  }
}

function reconcileDropped(s: LiveState): void {
  for (const slot of s.slots) {
    if (slot.kind !== 'media') continue;
    const rt = s.slotRt[slot.index]!;
    if (rt.status === 'onair' || rt.status === 'done') continue;
    const found = resolveDeckIndex(s.deck.items, slot) !== null;
    if (!found) rt.status = 'dropped';
    else if (rt.status === 'dropped') rt.status = 'pending';
  }
}

export function startProgram(s: LiveState, at: MonoMs): void {
  s.phase = 'live';
  s.t0 = at;
  moveTo(s, 0, at);
  if (s.control === 'auto') match(s, at);
}

export function endProgram(s: LiveState, at: MonoMs): void {
  closeSlot(s, s.cursor, at);
  if (s.returnSlot !== null) closeSlot(s, s.returnSlot, at);
  for (const rt of s.blockRt) {
    if (rt.startedAt !== null && rt.endedAt === null) rt.endedAt = at;
  }
  s.phase = 'ended';
}

function addDecision(s: LiveState, kind: DecisionKind, defaultChoice: string, at: MonoMs): void {
  s.decisions.push({ id: s.nextDecisionId++, kind, at, defaultChoice, choice: defaultChoice, confirmed: false });
}

function confirmPending(s: LiveState, kind: DecisionKind, choice: string): void {
  for (const d of s.decisions) {
    if (d.kind === kind && !d.confirmed) {
      d.choice = choice;
      d.confirmed = true;
    }
  }
}

function resumeFromPause(s: LiveState, at: MonoMs): void {
  if (s.recPausedAt === null) return;
  const d = at - s.recPausedAt;
  s.recPausedAt = null;
  if (s.t0 !== null) s.t0 += d;
  const bi = currentBlockIndex(s);
  const block = bi >= 0 ? s.blockRt[bi]! : null;
  if (block !== null && block.startedAt !== null) block.startedAt += d;
  const slot = s.cursor >= 0 ? s.slotRt[s.cursor]! : null;
  if (slot !== null && slot.startedAt !== null) slot.startedAt += d;
}

function onOutput(s: LiveState, e: Extract<DomainEvent, { type: 'OutputChanged' }>): boolean {
  const anyBefore = s.outputs.rec || s.outputs.stream;
  switch (e.state) {
    case 'started':
      s.outputs[e.output] = true;
      if (s.phase === 'preshow') startProgram(s, e.at);
      else if (s.phase === 'live' && !anyBefore) {
        confirmPending(s, 'all_outputs_stopped', 'interruption');
        addDecision(s, 'output_restart', s.episode.preset.mode === 'live_to_tape' ? 'new_session' : 'continue', e.at);
      }
      return true;

    case 'stopped':
      s.outputs[e.output] = false;
      if (e.output === 'rec') {
        s.outputs.recPaused = false;
        resumeFromPause(s, e.at);
      }
      if (s.phase === 'live' && !s.outputs.rec && !s.outputs.stream) {
        if (currentBlockIndex(s) === lastBlockIndex(s)) endProgram(s, e.at);
        else addDecision(s, 'all_outputs_stopped', 'interruption', e.at);
      }
      return true;

    case 'paused':
      s.outputs.recPaused = true;
      if (s.phase === 'live' && s.episode.preset.recPauseFreezesProgram) s.recPausedAt = e.at;
      return true;

    case 'resumed':
      s.outputs.recPaused = false;
      resumeFromPause(s, e.at);
      return true;
  }
}
```

Add to `server/src/engine/index.ts`:
```ts
export * from './types';
export { createLiveState } from './state';
export { reduce, type ReduceResult } from './reducer';
```

- [ ] **Step 5: Run to verify it passes**

Run: `pnpm vitest run server/test && pnpm typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add server
git commit -m "feat(engine): reducer for OBS and Playlist Deck domain events"
```

---

### Task 8: Reducer — commands, ticks, estimated mode

**Files:**
- Modify: `server/src/engine/reducer.ts` (the `apply` switch, plus new functions `applyCommand`, `applyTick` and `nextTickAt`)
- Modify: `server/src/engine/index.ts` (export `nextTickAt`)
- Test: `server/test/engine/reducer-commands.test.ts`

**Interfaces:**
- Consumes: `moveTo`, `correctTo` (Task 6); `blockEndsAt` (Task 5); `firstSlotOfBlock`, `currentBlockIndex`, `lastBlockIndex` (Task 4); `startProgram`, `endProgram` (Task 7).
- Produces: `nextTickAt(s: LiveState): MonoMs | null`. The earliest future moment at which a `Tick` could change the state.

Rules:

| Input | Effect |
|---|---|
| `StartProgram` | Only in preshow. Same as the first output starting |
| `Next` | Only in live, when a next slot exists. Clears `returnSlot`, then `moveTo(cursor+1)` |
| `Prev` | Only in live, when `cursor > 0`. `correctTo(cursor-1)` |
| `Goto` | Valid index, different from the cursor. Forward uses `moveTo`, backward uses `correctTo` |
| `Adjust` | In live, adds `deltaMs` to the current block's `adjustMs` and `targetMs` |
| `SetControl` | Changes control. Switching back to `auto` in live runs `match` immediately |
| `SendMessage` | Replaces the current message. `expiresAt = at + ms` for timeout messages, `null` for manual ones |
| `ClearMessage` | Removes the message (`false` if there is none) |
| `ResolveDecision` | Confirms the choice. `all_outputs_stopped` + `'end'` in live → `endProgram` |
| `Tick` | (1) Expires the message. (2) **Estimated mode:** when OBS is lost in live + auto, each current block whose target end has passed hands over to the first slot of the next block, at that block's end time. It never goes past the last block |

- [ ] **Step 1: Write the failing test**

`server/test/engine/reducer-commands.test.ts`:
```ts
// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import { nextTickAt, reduce } from '../../src/engine/reducer';
import { T0, freshState, liveState, run } from '../helpers';

describe('StartProgram', () => {
  it('starts from preshow and is ignored afterwards', () => {
    const s = run(freshState(), { type: 'StartProgram', at: T0 });
    expect(s.phase).toBe('live');
    expect(s.t0).toBe(T0);
    expect(reduce(s, { type: 'StartProgram', at: T0 + 1 }).changed).toBe(false);
  });
});

describe('Next / Prev / Goto', () => {
  it('moves forward and back', () => {
    const next = run(liveState(), { type: 'Next', at: T0 + 1_000 });
    expect(next.cursor).toBe(1);
    const prev = run(next, { type: 'Prev', at: T0 + 2_000 });
    expect(prev.cursor).toBe(0);
    expect(prev.slotRt[1]!.status).toBe('pending');
  });

  it('Goto jumps to any slot and rejects invalid targets', () => {
    const s = run(liveState(), { type: 'Goto', at: T0 + 1_000, slot: 4 });
    expect(s.cursor).toBe(4);
    expect(s.blockRt[2]!.startedAt).toBe(T0 + 1_000);
    expect(reduce(s, { type: 'Goto', at: T0 + 2_000, slot: 99 }).changed).toBe(false);
    expect(reduce(s, { type: 'Goto', at: T0 + 2_000, slot: 4 }).changed).toBe(false);
  });

  it('is ignored outside live', () => {
    expect(reduce(freshState(), { type: 'Next', at: 1 }).changed).toBe(false);
  });
});

describe('Adjust', () => {
  it('extends the current block target', () => {
    const s = run(liveState(), { type: 'Adjust', at: T0 + 1_000, deltaMs: 30_000 });
    expect(s.blockRt[0]).toMatchObject({ adjustMs: 30_000, targetMs: 750_000 });
  });
});

describe('SetControl', () => {
  it('manual stops matching, auto re-aligns immediately', () => {
    const manual = run(
      liveState(),
      { type: 'SetControl', at: T0 + 1_000, control: 'manual' },
      { type: 'ProgramSceneChanged', at: T0 + 2_000, scene: 'BREAK', deckOnProgram: false },
    );
    expect(manual.cursor).toBe(0);
    const auto = run(manual, { type: 'SetControl', at: T0 + 3_000, control: 'auto' });
    expect(auto.cursor).toBe(3);
  });
});

describe('messages', () => {
  it('timeout messages expire on tick; manual ones stay until cleared', () => {
    const shown = run(liveState(), {
      type: 'SendMessage', at: T0 + 1_000, text: 'STRINGI', dismiss: { kind: 'timeout', ms: 10_000 },
    });
    expect(shown.message).toEqual({ text: 'STRINGI', shownAt: T0 + 1_000, expiresAt: T0 + 11_000 });
    expect(nextTickAt(shown)).toBe(T0 + 11_000);
    expect(reduce(shown, { type: 'Tick', at: T0 + 10_999 }).changed).toBe(false);
    expect(run(shown, { type: 'Tick', at: T0 + 11_000 }).message).toBeNull();

    const manual = run(liveState(), { type: 'SendMessage', at: T0, text: 'GUARDA CAM 2', dismiss: { kind: 'manual' } });
    expect(run(manual, { type: 'Tick', at: T0 + 999_999 }).message).not.toBeNull();
    expect(run(manual, { type: 'ClearMessage', at: T0 + 5 }).message).toBeNull();
  });

  it('a new message replaces the previous one', () => {
    const s = run(
      liveState(),
      { type: 'SendMessage', at: T0, text: 'A', dismiss: { kind: 'manual' } },
      { type: 'SendMessage', at: T0 + 1, text: 'B', dismiss: { kind: 'manual' } },
    );
    expect(s.message?.text).toBe('B');
  });
});

describe('ResolveDecision', () => {
  it('ends the program when all outputs stopped is resolved as end', () => {
    const stopped = run(liveState(), { type: 'OutputChanged', at: T0 + 60_000, output: 'rec', state: 'stopped' });
    const ended = run(stopped, { type: 'ResolveDecision', at: T0 + 61_000, id: 1, choice: 'end' });
    expect(ended.phase).toBe('ended');
    expect(ended.decisions[0]).toMatchObject({ choice: 'end', confirmed: true });
    expect(reduce(ended, { type: 'ResolveDecision', at: T0 + 62_000, id: 42, choice: 'end' }).changed).toBe(false);
  });
});

describe('estimated mode (OBS lost)', () => {
  it('hands over to the next block at the planned end, never past the last block', () => {
    const lost = run(liveState(), { type: 'SourceLost', at: T0 + 100_000 });
    expect(nextTickAt(lost)).toBe(T0 + 720_000);
    const s = run(lost, { type: 'Tick', at: T0 + 950_000 });
    // block 0 ended at 720 000 -> break (180 000) ended at 900 000 -> block 2 started at 900 000
    expect(s.cursor).toBe(4);
    expect(s.blockRt[1]).toMatchObject({ startedAt: T0 + 720_000, endedAt: T0 + 900_000 });
    expect(s.blockRt[2]!.startedAt).toBe(T0 + 900_000);
    const late = run(s, { type: 'Tick', at: T0 + 5_000_000 });
    expect(late.cursor).toBe(7);
    expect(nextTickAt(late)).toBeNull();
  });

  it('does not advance while OBS is connected', () => {
    expect(run(liveState(), { type: 'Tick', at: T0 + 950_000 }).cursor).toBe(0);
    expect(nextTickAt(liveState())).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run server/test/engine/reducer-commands.test.ts`
Expected: FAIL. `nextTickAt` is not exported, and commands are no-ops.

- [ ] **Step 3: Implement**

In `server/src/engine/reducer.ts`:

1. Extend the imports:
```ts
import { closeSlot, correctTo, moveTo } from './cursor';
import { match } from './matcher';
import { currentBlockIndex, firstSlotOfBlock, lastBlockIndex, resolveDeckIndex } from './rundown';
import { blockEndsAt } from './timing';
import type { Command, DecisionKind, DomainEvent, EngineInput, LiveState, MonoMs } from './types';
```

2. Replace the `default` branch of `apply` with:
```ts
    case 'Tick':
      return applyTick(s, input.at);
    default:
      return applyCommand(s, input);
```

3. Add these functions:
```ts
function applyCommand(s: LiveState, c: Command): boolean {
  switch (c.type) {
    case 'StartProgram':
      if (s.phase !== 'preshow') return false;
      startProgram(s, c.at);
      return true;

    case 'Next':
      if (s.phase !== 'live' || s.cursor + 1 >= s.slots.length) return false;
      if (s.returnSlot !== null) {
        closeSlot(s, s.cursor, c.at);
        s.cursor = s.returnSlot;
        s.returnSlot = null;
      }
      moveTo(s, s.cursor + 1, c.at);
      return true;

    case 'Prev':
      if (s.phase !== 'live' || s.cursor <= 0) return false;
      correctTo(s, s.cursor - 1, c.at);
      return true;

    case 'Goto':
      if (s.phase !== 'live' || c.slot < 0 || c.slot >= s.slots.length || c.slot === s.cursor) return false;
      if (c.slot > s.cursor) {
        s.returnSlot = null;
        moveTo(s, c.slot, c.at);
      } else {
        correctTo(s, c.slot, c.at);
      }
      return true;

    case 'Adjust': {
      const bi = currentBlockIndex(s);
      if (s.phase !== 'live' || bi < 0 || c.deltaMs === 0) return false;
      const rt = s.blockRt[bi]!;
      rt.adjustMs += c.deltaMs;
      if (rt.targetMs !== null) rt.targetMs += c.deltaMs;
      return true;
    }

    case 'SetControl':
      if (s.control === c.control) return false;
      s.control = c.control;
      if (c.control === 'auto' && s.phase === 'live') match(s, c.at);
      return true;

    case 'SendMessage':
      s.message = {
        text: c.text,
        shownAt: c.at,
        expiresAt: c.dismiss.kind === 'timeout' ? c.at + c.dismiss.ms : null,
      };
      return true;

    case 'ClearMessage':
      if (s.message === null) return false;
      s.message = null;
      return true;

    case 'ResolveDecision': {
      const d = s.decisions.find((x) => x.id === c.id);
      if (d === undefined) return false;
      d.choice = c.choice;
      d.confirmed = true;
      if (d.kind === 'all_outputs_stopped' && c.choice === 'end' && s.phase === 'live') endProgram(s, c.at);
      return true;
    }
  }
}

const estimating = (s: LiveState) => s.phase === 'live' && s.obs === 'lost' && s.control === 'auto';

function applyTick(s: LiveState, at: MonoMs): boolean {
  let changed = false;
  if (s.message !== null && s.message.expiresAt !== null && at >= s.message.expiresAt) {
    s.message = null;
    changed = true;
  }
  if (estimating(s)) {
    for (;;) {
      const bi = currentBlockIndex(s);
      const end = bi >= 0 ? blockEndsAt(s, bi) : null;
      if (end === null || at < end || bi >= lastBlockIndex(s)) break;
      s.returnSlot = null;
      moveTo(s, firstSlotOfBlock(s, bi + 1), end);
      changed = true;
    }
  }
  return changed;
}

export function nextTickAt(s: LiveState): MonoMs | null {
  const candidates: MonoMs[] = [];
  if (s.message !== null && s.message.expiresAt !== null) candidates.push(s.message.expiresAt);
  if (estimating(s)) {
    const bi = currentBlockIndex(s);
    const end = bi >= 0 && bi < lastBlockIndex(s) ? blockEndsAt(s, bi) : null;
    if (end !== null) candidates.push(end);
  }
  return candidates.length === 0 ? null : Math.min(...candidates);
}
```

The estimated hand-over uses `blockEndsAt` of the current block. Each next block is started at the previous block's end time, so `targetForBlockStart` sees zero lateness and the block keeps its full duration.

In `server/src/engine/index.ts`, change the reducer export to:
```ts
export { nextTickAt, reduce, type ReduceResult } from './reducer';
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm vitest run server/test && pnpm typecheck`
Expected: PASS (Task 7 tests included).

- [ ] **Step 5: Commit**

```bash
git add server
git commit -m "feat(engine): emergency commands, messages, decisions and estimated mode"
```

---

### Task 9: Timing snapshot (delay, forecast end, on-air media, return)

**Files:**
- Create: `server/src/engine/snapshot.ts`
- Modify: `server/src/engine/index.ts` (export)
- Test: `server/test/engine/snapshot.test.ts`

**Interfaces:**
- Consumes: Task 4 helpers (`slotDuration`, `studioTimeMs`, `isElastic`, `currentBlockIndex`, `lastBlockIndex`, `worstSource`); Task 5 (`plannedEndAt`, `blockEndsAt`).
- Produces:
```ts
export type Remaining =
  | { kind: 'running'; endsAt: MonoMs; source: Source }
  | { kind: 'frozen'; remainingMs: number; source: Source };

export interface OnAirTiming {
  slotIndex: number;
  title: string;
  startedAt: MonoMs | null;
  durationMs: number | null; // null when unknown
  remaining: Remaining;
}

export interface TimingSnapshot {
  blockIndex: number;                 // -1 before start
  block: Remaining | null;            // current block countdown
  delayMs: number | null;             // + late / - early vs plan
  plannedEndAt: MonoMs | null;        // whole program
  forecast: Remaining | null;         // forecast program end
  rundownFinished: boolean;           // last block over time
  segment: 'studio' | 'media' | 'break' | null;
  onAir: OnAirTiming | null;          // media or break on air
  returnAt: Remaining | null;         // back to studio
  returnBlockIndex: number | null;
}
export function computeTiming(s: LiveState, now: MonoMs): TimingSnapshot;
```

Rules (TECH-DESIGN §5.4). `now` is replaced by `recPausedAt` while a REC pause freezes program time, and every `running` value then becomes `frozen`.

- **Block countdown:** `endsAt = startedAt + targetMs`, `source: 'measured'`, because it is anchored to an observed start.
- **Delay:** `max(blockEndsAt, now) − plannedEndAt(current)`.
- **Forecast:** a positive residual delay is absorbed by each later elastic block up to its studio time. `forecastEnd = plannedEnd(last) + residual`.
- **Deck media on air:**
  - playing → running, ends at `at + duration − position`, measured;
  - paused → frozen, measured;
  - unknown duration (`< 0`) → planned, from the slot start.
- **Break on air:**
  - a status for its `mediaInput` with `durationMs > 0` → measured (running or frozen);
  - otherwise planned: `blockStart + target`.
- **Return:** the on-air remaining time, plus the durations of the following contiguous non-studio slots that are not `done` or `dropped`, up to the next studio slot. `returnBlockIndex` is that studio slot's block. With no studio slot after it, `returnAt` is `null`.
- **Return after an out-of-order item** (`returnSlot` set): `returnAt` is the on-air remaining time only, and `returnBlockIndex` is the block of `returnSlot`, because the show resumes where it was interrupted.
- **Source:** if OBS is lost, every source becomes `'estimated'`.

- [ ] **Step 1: Write the failing test**

`server/test/engine/snapshot.test.ts`:
```ts
// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import { computeTiming } from '../../src/engine/snapshot';
import { T0, freshState, liveState, run } from '../helpers';

describe('computeTiming', () => {
  it('is empty before the program starts', () => {
    const t = computeTiming(freshState(), 5);
    expect(t).toMatchObject({ blockIndex: -1, block: null, delayMs: null, forecast: null, segment: null });
  });

  it('on time in block 1', () => {
    const t = computeTiming(liveState(), T0 + 100_000);
    expect(t.block).toEqual({ kind: 'running', endsAt: T0 + 720_000, source: 'measured' });
    expect(t.delayMs).toBe(0);
    expect(t.plannedEndAt).toBe(T0 + 1_620_000);
    expect(t.forecast).toEqual({ kind: 'running', endsAt: T0 + 1_620_000, source: 'planned' });
    expect(t.segment).toBe('studio');
    expect(t.rundownFinished).toBe(false);
  });

  it('overrun: delay grows and is absorbed by the next elastic block in the forecast', () => {
    const t = computeTiming(liveState(), T0 + 750_000);
    expect(t.delayMs).toBe(30_000);
    expect(t.forecast).toEqual({ kind: 'running', endsAt: T0 + 1_620_000, source: 'planned' });
  });

  it('forecast slips when later elastic studio time cannot absorb the delay', () => {
    const t = computeTiming(liveState(), T0 + 720_000 + 700_000); // 700 s over
    // b2 absorbs 480 000, b3 absorbs 120 000 -> residual 100 000
    expect(t.forecast).toEqual({ kind: 'running', endsAt: T0 + 1_720_000, source: 'planned' });
  });

  it('deck media on air: running, measured, with return to studio', () => {
    const s = run(
      liveState(),
      { type: 'DeckItemStarted', at: T0 + 60_000, index: 0, path: 'D:/media/servizio1.mp4', title: 'Servizio 1', durationMs: 185_000 },
      { type: 'ProgramSceneChanged', at: T0 + 60_000, scene: 'PLAYOUT', deckOnProgram: true },
      { type: 'DeckPlayback', at: T0 + 120_000, index: 0, positionMs: 60_000, durationMs: 185_000, playing: true },
    );
    const t = computeTiming(s, T0 + 121_000);
    expect(t.segment).toBe('media');
    expect(t.onAir).toEqual({
      slotIndex: 1, title: 'Servizio 1', startedAt: T0 + 60_000, durationMs: 185_000,
      remaining: { kind: 'running', endsAt: T0 + 245_000, source: 'measured' },
    });
    expect(t.returnAt).toEqual({ kind: 'running', endsAt: T0 + 245_000, source: 'measured' });
    expect(t.returnBlockIndex).toBe(0);
  });

  it('paused deck media is frozen', () => {
    const s = run(
      liveState(),
      { type: 'DeckItemStarted', at: T0 + 60_000, index: 0, path: 'D:/media/servizio1.mp4', title: 'Servizio 1', durationMs: 185_000 },
      { type: 'ProgramSceneChanged', at: T0 + 60_000, scene: 'PLAYOUT', deckOnProgram: true },
      { type: 'DeckPlayback', at: T0 + 90_000, index: 0, positionMs: 30_000, durationMs: 185_000, playing: false },
    );
    expect(computeTiming(s, T0 + 200_000).onAir?.remaining).toEqual({ kind: 'frozen', remainingMs: 155_000, source: 'measured' });
  });

  it('break with a measured filler, then without (planned)', () => {
    const inBreak = run(liveState(), { type: 'ProgramSceneChanged', at: T0 + 720_000, scene: 'BREAK', deckOnProgram: false });
    const planned = computeTiming(inBreak, T0 + 730_000);
    expect(planned.segment).toBe('break');
    expect(planned.onAir?.remaining).toEqual({ kind: 'running', endsAt: T0 + 900_000, source: 'planned' });
    expect(planned.returnBlockIndex).toBe(2);

    const measured = run(inBreak, {
      type: 'MediaStatus', at: T0 + 725_000, input: 'Tappo', playing: true, cursorMs: 5_000, durationMs: 181_000,
    });
    expect(computeTiming(measured, T0 + 730_000).returnAt).toEqual({ kind: 'running', endsAt: T0 + 901_000, source: 'measured' });
  });

  it('marks every source estimated while OBS is lost', () => {
    const s = run(liveState(), { type: 'SourceLost', at: T0 + 1 });
    const t = computeTiming(s, T0 + 2);
    expect(t.block?.source).toBe('estimated');
    expect(t.forecast?.source).toBe('estimated');
  });

  it('freezes during a live-to-tape REC pause', () => {
    const s = run(liveState(), { type: 'OutputChanged', at: T0 + 100_000, output: 'rec', state: 'paused' });
    expect(computeTiming(s, T0 + 500_000).block).toEqual({ kind: 'frozen', remainingMs: 620_000, source: 'measured' });
  });

  it('flags the rundown as finished when the last block is over time', () => {
    const s = run(liveState(), { type: 'Goto', at: T0 + 1_500_000, slot: 7 });
    const t = computeTiming(s, T0 + 1_700_000);
    expect(t.blockIndex).toBe(3);
    expect(t.rundownFinished).toBe(true);
    expect(t.delayMs).toBe(80_000);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run server/test/engine/snapshot.test.ts`
Expected: FAIL. The module `snapshot` is missing.

- [ ] **Step 3: Implement**

`server/src/engine/snapshot.ts`:
```ts
// SPDX-License-Identifier: GPL-2.0-or-later
import { currentBlockIndex, isElastic, lastBlockIndex, slotDuration, studioTimeMs, worstSource } from './rundown';
import { blockEndsAt, plannedEndAt } from './timing';
import type { LiveState, MonoMs, Source } from './types';

export type Remaining =
  | { kind: 'running'; endsAt: MonoMs; source: Source }
  | { kind: 'frozen'; remainingMs: number; source: Source };

export interface OnAirTiming {
  slotIndex: number;
  title: string;
  startedAt: MonoMs | null;
  durationMs: number | null;
  remaining: Remaining;
}

export interface TimingSnapshot {
  blockIndex: number;
  block: Remaining | null;
  delayMs: number | null;
  plannedEndAt: MonoMs | null;
  forecast: Remaining | null;
  rundownFinished: boolean;
  segment: 'studio' | 'media' | 'break' | null;
  onAir: OnAirTiming | null;
  returnAt: Remaining | null;
  returnBlockIndex: number | null;
}

const EMPTY: TimingSnapshot = {
  blockIndex: -1, block: null, delayMs: null, plannedEndAt: null, forecast: null, rundownFinished: false,
  segment: null, onAir: null, returnAt: null, returnBlockIndex: null,
};

function running(endsAt: MonoMs, source: Source): Remaining {
  return { kind: 'running', endsAt, source };
}

function extend(r: Remaining, ms: number, source: Source): Remaining {
  return r.kind === 'running'
    ? { kind: 'running', endsAt: r.endsAt + ms, source: worstSource(r.source, source) }
    : { kind: 'frozen', remainingMs: r.remainingMs + ms, source: worstSource(r.source, source) };
}

/** Converts running values to frozen ones measured at `frozenAt` (REC pause), and degrades sources when OBS is lost. */
function finalize(r: Remaining | null, frozenAt: MonoMs | null, lost: boolean): Remaining | null {
  if (r === null) return null;
  let out = r;
  if (frozenAt !== null && out.kind === 'running') out = { kind: 'frozen', remainingMs: out.endsAt - frozenAt, source: out.source };
  if (lost) out = { ...out, source: 'estimated' };
  return out;
}

function onAirRemaining(s: LiveState, slotIndex: number): OnAirTiming {
  const slot = s.slots[slotIndex]!;
  const rt = s.slotRt[slotIndex]!;
  const base = { slotIndex, title: slot.title, startedAt: rt.startedAt };

  if (slot.kind === 'media') {
    const cur = s.deck.current;
    if (cur !== null && cur.durationMs >= 0) {
      const left = Math.max(0, cur.durationMs - cur.positionMs);
      return {
        ...base,
        durationMs: cur.durationMs,
        remaining: cur.playing ? running(cur.at + left, 'measured') : { kind: 'frozen', remainingMs: left, source: 'measured' },
      };
    }
    const planned = slotDuration(s, slot);
    return { ...base, durationMs: planned.ms, remaining: running((rt.startedAt ?? 0) + planned.ms, planned.source) };
  }

  // break
  const block = s.episode.blocks[slot.blockIndex]!;
  const media = s.media;
  if (block.kind === 'break' && block.mediaInput !== null && media !== null && media.input === block.mediaInput && media.durationMs > 0) {
    const left = Math.max(0, media.durationMs - media.cursorMs);
    return {
      ...base,
      durationMs: media.durationMs,
      remaining: media.playing ? running(media.at + left, 'measured') : { kind: 'frozen', remainingMs: left, source: 'measured' },
    };
  }
  const end = blockEndsAt(s, slot.blockIndex) ?? (rt.startedAt ?? 0) + slot.plannedDurationMs;
  return { ...base, durationMs: s.blockRt[slot.blockIndex]!.targetMs ?? slot.plannedDurationMs, remaining: running(end, 'planned') };
}

export function computeTiming(s: LiveState, nowIn: MonoMs): TimingSnapshot {
  if (s.t0 === null) return { ...EMPTY };
  const now = s.recPausedAt ?? nowIn;
  const frozenAt = s.recPausedAt;
  const lost = s.obs === 'lost';

  const bi = currentBlockIndex(s);
  const last = lastBlockIndex(s);
  const programPlannedEnd = plannedEndAt(s, last)!;
  const endsAt = bi >= 0 ? blockEndsAt(s, bi) : null;

  let delayMs: number | null = null;
  let forecast: Remaining | null = null;
  if (bi >= 0 && endsAt !== null) {
    delayMs = Math.max(endsAt, now) - plannedEndAt(s, bi)!;
    let residual = delayMs;
    for (let j = bi + 1; j <= last && residual > 0; j++) {
      if (isElastic(s, j)) residual -= Math.min(residual, studioTimeMs(s, j));
    }
    forecast = running(programPlannedEnd + residual, 'planned');
  }

  const slot = s.cursor >= 0 ? s.slots[s.cursor]! : null;
  const segment = slot?.kind ?? null;

  let onAir: OnAirTiming | null = null;
  let returnAt: Remaining | null = null;
  let returnBlockIndex: number | null = null;
  if (slot !== null && slot.kind !== 'studio' && s.returnSlot !== null) {
    // Out-of-order item: the show returns to the slot it interrupted.
    onAir = onAirRemaining(s, slot.index);
    returnAt = onAir.remaining;
    returnBlockIndex = s.slots[s.returnSlot]!.blockIndex;
  } else if (slot !== null && slot.kind !== 'studio') {
    onAir = onAirRemaining(s, slot.index);
    let r = onAir.remaining;
    for (let j = slot.index + 1; j < s.slots.length; j++) {
      const next = s.slots[j]!;
      if (next.kind === 'studio') {
        returnBlockIndex = next.blockIndex;
        break;
      }
      const status = s.slotRt[j]!.status;
      if (status === 'done' || status === 'dropped') continue;
      const d = slotDuration(s, next);
      r = extend(r, d.ms, d.source);
    }
    returnAt = returnBlockIndex === null ? null : r;
  }

  return {
    blockIndex: bi,
    block: finalize(endsAt === null ? null : running(endsAt, 'measured'), frozenAt, lost),
    delayMs,
    plannedEndAt: programPlannedEnd,
    forecast: finalize(forecast, frozenAt, lost),
    rundownFinished: bi === last && endsAt !== null && now > endsAt,
    segment,
    onAir: onAir === null ? null : { ...onAir, remaining: finalize(onAir.remaining, frozenAt, lost)! },
    returnAt: finalize(returnAt, frozenAt, lost),
    returnBlockIndex,
  };
}
```

Append to `server/src/engine/index.ts`:
```ts
export { computeTiming, type OnAirTiming, type Remaining, type TimingSnapshot } from './snapshot';
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm vitest run server/test && pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server
git commit -m "feat(engine): derived timing snapshot (delay, forecast end, on-air media, return)"
```

---

### Task 10: Presenter projection (anchors)

**Files:**
- Create: `server/src/engine/projection.ts`
- Modify: `server/src/engine/index.ts` (export)
- Test: `server/test/engine/projection.test.ts`

**Interfaces:**
- Consumes: `computeTiming`, `Remaining` (Task 9); `slotDuration`, `rundownDurationMs` (Task 4 / shared).
- Produces:
```ts
export type Anchor =
  | { kind: 'countdown'; endsAt: number; source: Source }   // endsAt in server WALL ms
  | { kind: 'frozen'; valueMs: number; source: Source }
  | { kind: 'unknown' };

export interface PresenterView {
  phase: 'preshow' | 'live' | 'ended';
  segment: 'studio' | 'media' | 'break' | null;
  rundownFinished: boolean;
  block: { index: number; name: string; anchor: Anchor } | null;
  onAir: { title: string; anchor: Anchor; startedAtWall: number | null; durationMs: number | null } | null;
  returnTo: { blockName: string; anchor: Anchor } | null;
  next: { title: string; durationMs: number; source: Source } | null;
  programEnd: { anchor: Anchor; endsAtWall: number | null } | null;
  delayMs: number | null;
  thresholds: { warnMs: number; returnImminentMs: number };
  message: { text: string } | null;
  status: { rec: boolean; stream: boolean; recPaused: boolean; obs: 'ok' | 'lost'; control: 'auto' | 'manual' };
  preshow: { plannedStart: string | null; totalDurationMs: number; upcoming: string[] } | null;
}
export function presenterView(s: LiveState, now: MonoMs, toWall: (mono: MonoMs) => number): PresenterView;
```

The view carries **data, not copy**. Labels such as "RIENTRO TRA" are translated by the client in Plan 3. Tally colour is derived on the client from the anchor and `thresholds` (SPEC §7).

The client does that derivation per frame; the rules are recorded here for reference:
- remaining `< 0` → over;
- `< warnMs` → warn;
- return remaining `<= returnImminentMs` → imminent.

`next`:
- it is the first slot after the cursor (after `returnSlot` if set) whose kind is not studio and whose status is `pending` or `postponed`;
- it uses `slotDuration`;
- in preshow it is the first such slot from the start.

`upcoming`:
- in preshow, the first 4 distinct slot titles, in order.

- [ ] **Step 1: Write the failing test**

`server/test/engine/projection.test.ts`:
```ts
// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import { presenterView } from '../../src/engine/projection';
import { T0, freshState, liveState, run } from '../helpers';

const WALL0 = 1_790_000_000_000;
const toWall = (mono: number) => WALL0 + mono;

describe('presenterView', () => {
  it('preshow shows the plan, the upcoming items and the first thing to air', () => {
    const v = presenterView(freshState(), 0, toWall);
    expect(v.phase).toBe('preshow');
    expect(v.block).toBeNull();
    expect(v.preshow).toEqual({
      plannedStart: '2026-10-12T19:00:00+02:00',
      totalDurationMs: 1_620_000,
      upcoming: ['Primo blocco', 'Servizio 1', 'Break 1', 'Secondo blocco'],
    });
    // OBS is not connected yet, so even planned values are declared estimated (never overstate certainty).
    expect(v.next).toEqual({ title: 'Servizio 1', durationMs: 180_000, source: 'estimated' });
    expect(v.status.obs).toBe('lost');
  });

  it('live in studio: block countdown in wall time, next item, program end', () => {
    const v = presenterView(liveState(), T0 + 100_000, toWall);
    expect(v.segment).toBe('studio');
    expect(v.block).toEqual({ index: 0, name: 'Primo blocco', anchor: { kind: 'countdown', endsAt: toWall(T0 + 720_000), source: 'measured' } });
    expect(v.next).toEqual({ title: 'Servizio 1', durationMs: 185_000, source: 'measured' });
    expect(v.programEnd).toEqual({
      anchor: { kind: 'countdown', endsAt: toWall(T0 + 1_620_000), source: 'planned' },
      endsAtWall: toWall(T0 + 1_620_000),
    });
    expect(v.delayMs).toBe(0);
    expect(v.thresholds).toEqual({ warnMs: 60_000, returnImminentMs: 10_000 });
    expect(v.preshow).toBeNull();
  });

  it('during a service: on-air media and return to the block', () => {
    const s = run(
      liveState(),
      { type: 'DeckItemStarted', at: T0 + 60_000, index: 0, path: 'D:/media/servizio1.mp4', title: 'Servizio 1', durationMs: 185_000 },
      { type: 'ProgramSceneChanged', at: T0 + 60_000, scene: 'PLAYOUT', deckOnProgram: true },
    );
    const v = presenterView(s, T0 + 61_000, toWall);
    expect(v.segment).toBe('media');
    expect(v.onAir).toEqual({
      title: 'Servizio 1', anchor: { kind: 'countdown', endsAt: toWall(T0 + 245_000), source: 'measured' },
      startedAtWall: toWall(T0 + 60_000), durationMs: 185_000,
    });
    expect(v.returnTo).toEqual({ blockName: 'Primo blocco', anchor: { kind: 'countdown', endsAt: toWall(T0 + 245_000), source: 'measured' } });
    expect(v.next).toEqual({ title: 'Break 1', durationMs: 180_000, source: 'planned' });
  });

  it('degrades to estimated when OBS is lost', () => {
    const v = presenterView(run(liveState(), { type: 'SourceLost', at: T0 + 1 }), T0 + 2, toWall);
    expect(v.block?.anchor).toMatchObject({ source: 'estimated' });
    expect(v.status.obs).toBe('lost');
  });

  it('shows frozen values during a live-to-tape REC pause', () => {
    const s = run(liveState(), { type: 'OutputChanged', at: T0 + 100_000, output: 'rec', state: 'paused' });
    expect(presenterView(s, T0 + 400_000, toWall).block?.anchor).toEqual({ kind: 'frozen', valueMs: 620_000, source: 'measured' });
  });

  it('carries the active message and output status', () => {
    const s = run(liveState(), { type: 'SendMessage', at: T0, text: 'STRINGI', dismiss: { kind: 'manual' } });
    const v = presenterView(s, T0 + 1, toWall);
    expect(v.message).toEqual({ text: 'STRINGI' });
    expect(v.status).toEqual({ rec: true, stream: false, recPaused: false, obs: 'ok', control: 'auto' });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run server/test/engine/projection.test.ts`
Expected: FAIL. The module `projection` is missing.

- [ ] **Step 3: Implement**

`server/src/engine/projection.ts`:
```ts
// SPDX-License-Identifier: GPL-2.0-or-later
import { rundownDurationMs } from '@olc/shared';
import { slotDuration } from './rundown';
import { computeTiming, type Remaining } from './snapshot';
import type { LiveState, MonoMs, Source } from './types';

export type Anchor =
  | { kind: 'countdown'; endsAt: number; source: Source }
  | { kind: 'frozen'; valueMs: number; source: Source }
  | { kind: 'unknown' };

export interface PresenterView {
  phase: 'preshow' | 'live' | 'ended';
  segment: 'studio' | 'media' | 'break' | null;
  rundownFinished: boolean;
  block: { index: number; name: string; anchor: Anchor } | null;
  onAir: { title: string; anchor: Anchor; startedAtWall: number | null; durationMs: number | null } | null;
  returnTo: { blockName: string; anchor: Anchor } | null;
  next: { title: string; durationMs: number; source: Source } | null;
  programEnd: { anchor: Anchor; endsAtWall: number | null } | null;
  delayMs: number | null;
  thresholds: { warnMs: number; returnImminentMs: number };
  message: { text: string } | null;
  status: { rec: boolean; stream: boolean; recPaused: boolean; obs: 'ok' | 'lost'; control: 'auto' | 'manual' };
  preshow: { plannedStart: string | null; totalDurationMs: number; upcoming: string[] } | null;
}

function toAnchor(r: Remaining | null, toWall: (m: MonoMs) => number): Anchor {
  if (r === null) return { kind: 'unknown' };
  return r.kind === 'running'
    ? { kind: 'countdown', endsAt: toWall(r.endsAt), source: r.source }
    : { kind: 'frozen', valueMs: r.remainingMs, source: r.source };
}

function nextItem(s: LiveState): PresenterView['next'] {
  const from = (s.returnSlot ?? s.cursor) + 1;
  for (let j = Math.max(0, from); j < s.slots.length; j++) {
    const slot = s.slots[j]!;
    const status = s.slotRt[j]!.status;
    if (slot.kind === 'studio' || (status !== 'pending' && status !== 'postponed')) continue;
    const d = slotDuration(s, slot);
    return { title: slot.title, durationMs: d.ms, source: s.obs === 'lost' ? 'estimated' : d.source };
  }
  return null;
}

function upcoming(s: LiveState): string[] {
  const titles: string[] = [];
  for (const slot of s.slots) {
    if (!titles.includes(slot.title)) titles.push(slot.title);
    if (titles.length === 4) break;
  }
  return titles;
}

export function presenterView(s: LiveState, now: MonoMs, toWall: (mono: MonoMs) => number): PresenterView {
  const t = computeTiming(s, now);
  const blocks = s.episode.blocks;
  const programEndAnchor = toAnchor(t.forecast, toWall);

  return {
    phase: s.phase,
    segment: t.segment,
    rundownFinished: t.rundownFinished,
    block: t.blockIndex >= 0 ? { index: t.blockIndex, name: blocks[t.blockIndex]!.name, anchor: toAnchor(t.block, toWall) } : null,
    onAir:
      t.onAir === null
        ? null
        : {
            title: t.onAir.title,
            anchor: toAnchor(t.onAir.remaining, toWall),
            startedAtWall: t.onAir.startedAt === null ? null : toWall(t.onAir.startedAt),
            durationMs: t.onAir.durationMs,
          },
    returnTo:
      t.returnBlockIndex === null
        ? null
        : { blockName: blocks[t.returnBlockIndex]!.name, anchor: toAnchor(t.returnAt, toWall) },
    next: nextItem(s),
    programEnd:
      t.forecast === null
        ? null
        : { anchor: programEndAnchor, endsAtWall: programEndAnchor.kind === 'countdown' ? programEndAnchor.endsAt : null },
    delayMs: t.delayMs,
    thresholds: { warnMs: s.episode.preset.warnMs, returnImminentMs: s.episode.preset.returnImminentMs },
    message: s.message === null ? null : { text: s.message.text },
    status: { ...s.outputs, obs: s.obs, control: s.control },
    preshow:
      s.phase === 'preshow'
        ? { plannedStart: s.episode.plannedStart, totalDurationMs: rundownDurationMs(s.episode), upcoming: upcoming(s) }
        : null,
  };
}
```

Append to `server/src/engine/index.ts`:
```ts
export { presenterView, type Anchor, type PresenterView } from './projection';
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm vitest run server/test && pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server
git commit -m "feat(engine): presenter projection with wall-clock anchors and sources"
```

---

### Task 11: Acceptance scenarios (engine level)

**Files:**
- Create: `server/test/scenarios/acceptance.test.ts`

**Interfaces:**
- Consumes: the public engine API only (`server/src/engine/index.ts`) plus the test helpers. If a scenario needs a non-exported symbol, that is a design gap: stop and report it to the orchestrator instead of importing internals.

These scenarios prove the spec's acceptance criteria at the engine level. The OBS latency and rendering parts of AC2/AC4/AC9/AC10 are proven in Plans 2–3.

- [ ] **Step 1: Write the scenarios**

`server/test/scenarios/acceptance.test.ts`:
```ts
// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import { SOLO_FUTSAL_DECK } from '@olc/shared/testing';
import { computeTiming, presenterView } from '../../src/engine/index';
import { T0, liveState, run } from '../helpers';

const toWall = (m: number) => 1_790_000_000_000 + m;

describe('AC3 — camera switches never advance the block; the break scene enters the break', () => {
  it('holds', () => {
    let s = liveState();
    for (const [i, cam] of ['CAM 2', 'CAM 3', 'CAM 1', 'CAM 2'].entries()) {
      s = run(s, { type: 'ProgramSceneChanged', at: T0 + 10_000 * (i + 1), scene: cam, deckOnProgram: false });
      expect(s.cursor).toBe(0);
    }
    s = run(s, { type: 'ProgramSceneChanged', at: T0 + 700_000, scene: 'BREAK', deckOnProgram: false });
    expect(presenterView(s, T0 + 700_001, toWall).segment).toBe('break');
  });
});

describe('AC5 — removing a service from the playlist updates studio time immediately', () => {
  it('holds', () => {
    let s = run(
      liveState(),
      { type: 'ProgramSceneChanged', at: T0 + 700_000, scene: 'BREAK', deckOnProgram: false },
      { type: 'ProgramSceneChanged', at: T0 + 880_000, scene: 'CAM 1', deckOnProgram: false },
    );
    expect(presenterView(s, T0 + 881_000, toWall).next).toMatchObject({ title: 'Servizio 2' });
    s = run(s, { type: 'DeckPlaylistChanged', at: T0 + 890_000, items: [{ ...SOLO_FUTSAL_DECK[0]! }] });
    expect(s.slotRt[5]!.status).toBe('dropped');
    expect(presenterView(s, T0 + 891_000, toWall).next).toBeNull();
  });
});

describe('AC6 — OBS lost: estimated, keeps counting; restored: measured and aligned', () => {
  it('holds', () => {
    let s = run(liveState(), { type: 'SourceLost', at: T0 + 600_000 });
    let v = presenterView(s, T0 + 600_500, toWall);
    expect(v.block?.anchor).toMatchObject({ kind: 'countdown', source: 'estimated' });

    s = run(s, { type: 'Tick', at: T0 + 800_000 });
    expect(s.cursor).toBe(3); // handed over to the break at its planned time

    s = run(
      s,
      { type: 'SourceRestored', at: T0 + 820_000 },
      { type: 'ProgramSceneChanged', at: T0 + 820_000, scene: 'CAM 2', deckOnProgram: false },
    );
    v = presenterView(s, T0 + 820_001, toWall);
    expect(s.cursor).toBe(4); // reality wins: studio of block 2
    expect(v.block).toMatchObject({ index: 2, anchor: { source: 'measured' } });
  });
});

describe('AC8 — overrun: amber/red is derivable, recovery lands on the next elastic block', () => {
  it('holds', () => {
    let s = liveState();
    const warn = presenterView(s, T0 + 690_000, toWall);
    const anchor = warn.block!.anchor;
    if (anchor.kind !== 'countdown') throw new Error('expected countdown');
    const remaining = anchor.endsAt - toWall(T0 + 690_000);
    expect(remaining).toBeLessThan(warn.thresholds.warnMs); // client shows amber
    expect(remaining).toBeGreaterThan(0);

    const over = computeTiming(s, T0 + 750_000);
    expect(over.delayMs).toBe(30_000); // red, +0:30

    s = run(
      s,
      { type: 'ProgramSceneChanged', at: T0 + 750_000, scene: 'BREAK', deckOnProgram: false },
      { type: 'ProgramSceneChanged', at: T0 + 930_000, scene: 'CAM 1', deckOnProgram: false },
    );
    // block 2 started 30 s late -> it gets 600 000 - 30 000
    expect(s.blockRt[2]!.targetMs).toBe(570_000);
    expect(computeTiming(s, T0 + 931_000).forecast).toMatchObject({ endsAt: T0 + 1_620_000 });
  });
});

describe('Out-of-order service (Servizio 1 aired in block 2)', () => {
  it('is postponed, then aired, then the show resumes in block 2', () => {
    const s = run(
      liveState(),
      { type: 'ProgramSceneChanged', at: T0 + 700_000, scene: 'BREAK', deckOnProgram: false },
      { type: 'ProgramSceneChanged', at: T0 + 880_000, scene: 'CAM 1', deckOnProgram: false },
      { type: 'DeckItemStarted', at: T0 + 900_000, index: 0, path: 'D:/media/servizio1.mp4', title: 'Servizio 1', durationMs: 185_000 },
      { type: 'ProgramSceneChanged', at: T0 + 900_000, scene: 'PLAYOUT', deckOnProgram: true },
    );
    const during = presenterView(s, T0 + 901_000, toWall);
    expect(during.segment).toBe('media');
    expect(during.returnTo?.blockName).toBe('Secondo blocco'); // back to where the show was interrupted
    expect(during.block?.name).toBe('Secondo blocco'); // the block clock keeps running

    const back = run(s, { type: 'ProgramSceneChanged', at: T0 + 1_085_000, scene: 'CAM 1', deckOnProgram: false });
    expect(back.cursor).toBe(4);
    expect(back.slotRt[1]!.status).toBe('done');
  });
});
```

- [ ] **Step 2: Run the scenarios**

Run: `pnpm vitest run server/test/scenarios`
Expected: PASS. If a scenario fails, fix the engine, not the expected values, and report the fix to the orchestrator.

- [ ] **Step 3: Full suite and typecheck**

Run: `pnpm test && pnpm typecheck`
Expected: all green.

- [ ] **Step 4: Commit and push**

```bash
git add server
git commit -m "test(engine): acceptance scenarios AC3, AC5, AC6, AC8 and out-of-order service"
git push
```

Expected: the CI workflow runs green on ubuntu, windows and macos (public repository, so no billed minutes).

---

## Self-review notes (plan author)

- **Spec coverage in this plan:**
  - F2 (episode from format), F6 (validation, OBS-independent part), F8–F12 (engine), F15 (messages at engine level), F16 (emergency commands);
  - NF1 (sources), NF5 (the engine is replayable; persistence comes in Plan 2);
  - SPEC §9 through §12.
- **Deferred to later plans:**
  - F1/F3/F4/F5/F7, F13/F14/F17/F18, and NF2–NF4, NF6–NF9. See the roadmap.
  - Journal and snapshot persistence and resume after restart (TECH-DESIGN §5.7) → Plan 2.
- **Deviation from TECH-DESIGN §5.1.**
  - The `overrun_rundown` phase is **derived** (`TimingSnapshot.rundownFinished`) instead of stored. This avoids a tick-driven phase change, and the presenter shows the same thing.
  - Recovery and early policies are fixed to `next_elastic` / `keep`, which is the MVP. The alternatives are v1.x (SPEC §17).
- **Out-of-order items.** While a postponed item airs out of order, `returnTo` names the block being resumed (via `returnSlot`), as SPEC §7 requires ("RIENTRO: blocco a cui si rientra").
