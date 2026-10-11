# Plan 4 — Web Clients Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the presenter, the director (OBS dock) and the extended control view their live screens. They must stay honest: every number shows its source, a counter never keeps counting on stale data, and nothing flickers at the second boundary.

**Scope:**
- The view types (`PresenterView`, `ControlView`, `Anchor`, …) move to `shared` as zod schemas, so the web never imports from `server/`. Small projection additions: an `ended` summary, the message presets and adjust step for the dock, and the planned start of every rundown row.
- A new `web` workspace (React 19 + Vite 7, DT-2) with three pages: `/presenter` (kiosk), `/dock` (OBS Custom Browser Dock, ≥ 300 px) and `/control` (extended view).
- A client core: WebSocket client (hello/welcome, protocol check, reconnect with jittered backoff), DT-7 server-clock sync, heartbeat staleness, per-frame anchored counters written straight to the DOM, i18n (Italian, English), bundled fonts.
- Server work: serve the built pages (hand-written static handler), WebSocket backpressure and ping/pong liveness, the minor `ws.ts` guards from BACKLOG.
- Dev tooling: Vite dev proxy, a root `pnpm dev` that runs server + obs-sim + Vite and seeds an episode.
- Tests: pure units for the clock/staleness/counter maths, RTL component tests, WCAG contrast tests, and an integration test that drives real clients against the real server and the obs simulator.

**Architecture:**
- `shared/src/live/views.ts` holds the zod schemas of every view. The engine projections keep their code and type their output with the shared types. A test parses every projection with the schemas, so the two can never drift.
- `web/src/core/` is framework-free. `LiveClient` owns the socket, the `ClockSync` and the staleness timer, and exposes an immutable `ClientSnapshot` for `useSyncExternalStore`. The maths (`ticksOf`, `stableTicks`, `anchorFrame`) are pure functions.
- `web/src/ui/` holds the React bindings. `<AnchoredTime>` renders once per anchor change and is repainted by one shared `requestAnimationFrame` loop. The loop writes into the text node React created, never through React state.
- `web/src/presenter/presenter-model.ts` is the pure state → screen mapping: mode, main anchor and tally. The screens are thin components over it.
- The server serves `web/dist` through `server/src/api/static.ts`, behind the existing Host/Origin guard.

**Tech Stack:** Node 24 · TypeScript 5.9 strict · React 19.3 (MIT) · Vite 7.3 + @vitejs/plugin-react 5.2 (MIT, dev) · zod 4 · @fontsource/inter 5.3 (font files under OFL-1.1, bundled as assets) · Vitest 3.2 + jsdom 30 + @testing-library/react 16.3 (MIT, dev) · Fastify 5 · ws 8.

**Spec:** [SPEC.md](../../SPEC.md) §7, §8, §12, §15, AC2, AC6, AC8, AC9, AC10, AC11 · [TECH-DESIGN.md](../../TECH-DESIGN.md) §6, §8, §10 · [DECISIONS.md](../../DECISIONS.md) DT-1, DT-2, DT-7, DT-9 · [BACKLOG.md](../../BACKLOG.md) "Piano 4".

**Roadmap:**

| Plan | Scope |
|---|---|
| 1 ✅ | engine |
| 2 ✅ | server core |
| 3 ✅ | OBS integration |
| **4 (this)** | web presenter, dock, control |
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

  For Tasks 5, 6, 7, 8, 9 and 13 and for the final whole-branch review, it escalates the review to **Opus**. These are the clock sync, staleness, anchored-time maths and component, the presenter state mapping, and the integration test.
- **Implementer:** **DeepSeek v4.1 Flash through OpenCode**, through the controller's script `.superpowers/sdd/deepseek-task.sh`. The script has a startup watchdog, because OpenCode can hang at startup with no output. The script's built-in prompt names only `shared` and `server`. From Task 4 on, the orchestrator passes as the 4th argument: `The repository also has web=@olc/web (React 19 + Vite 7, tests in web/test run under jsdom via the root vitest "web" project).`
- **Task sizing:** every task fits in one Flash run. The tricky pure logic is given as exact code: clock sync, anchored-time maths, the client, the state → screen mapping, the event diff. UI pieces get exact rules and complete tests. The implementer must not loosen any test. Ambiguities go back to the orchestrator.
- **No AI attribution** in any commit. Nothing is pushed until the controller merges.

## Global Constraints

- Node `>=24`, pnpm, ESM, TypeScript `strict`. Every new source file starts with `// SPDX-License-Identifier: GPL-2.0-or-later`; CSS files start with `/* SPDX-License-Identifier: GPL-2.0-or-later */`; HTML files with `<!-- SPDX-License-Identifier: GPL-2.0-or-later -->` after the doctype. Use LF line endings.
- **Runtime dependencies must be MIT, BSD or ISC.** This was verified with `npm view` on 2026-10-11:
  - `react` and `react-dom` 19.3.0 are MIT;
  - `zod` is MIT.
  - `@fastify/static` is **not** used, because it depends on `glob` 13, which is `BlueOak-1.0.0`. The server uses its own static handler instead (Task 3).
  - Dev-only tools are all MIT: `vite` 7.3.7, `@vitejs/plugin-react` 5.2.0, `jsdom` 30.1.2, `@testing-library/react` 16.3.3, `@testing-library/dom` 10.4.2, `@types/react*` 19.3.0.
  - Fonts: `@fontsource/inter` 5.3.0. Its font files are **OFL-1.1** and ship as bundled assets, not code (see "Decisions for the main session").
- **The web never imports from `server/`** in `web/src`. Shared types come from `@olc/shared`. Only the integration test (`web/test/integration`) imports `@olc/server/app/server`.
- `server/src/engine/**` stays pure. It may import **types** from `@olc/shared`.
- **Never invent (NF1, AC11).**
  - Every value displays its source: measured values plain, planned values as `PIAN.` where it matters, estimated values with `STIMATO` and an attenuated style.
  - Unknown values show `—`.
  - Data with no fresh heartbeat for more than 2 s is **stale**. Counters then freeze at the stale instant and dim, a `RICONNESSIONE…` banner appears, and after 10 s stale the counters show `—`. Nothing keeps counting on stale data as if it were fresh.
  - Before the first view and the first clock sample, no number is shown at all.
- **Offline only (NF2).** No CDN, no external fonts and no remote URLs in HTML or CSS. Fonts are bundled from `@fontsource/inter` and digits use `font-variant-numeric: tabular-nums`.
- **Time in the web.**
  - Pure core code takes its clock, scheduler and random source by injection.
  - Components read time only through `LiveStore.serverNow()` and the `FrameLoop`.
  - `ConfirmButton`, `useCommand`, `ConnectionOverlay` and `useObsStatus` use `setTimeout`/`setInterval` directly. Their tests use `vi.useFakeTimers()`.
- **Per-frame work never re-renders React.** Counters, progress bars and the wall clock write directly into the DOM through refs. React state changes only on view, snapshot or mode changes.
- **Security.** localhost by default. Everything the server serves, static pages included, stays behind the existing Host/Origin guard (TECH-DESIGN §10).
- **CI** runs on Windows, macOS and Linux: `pnpm typecheck`, `pnpm test`, and `pnpm build`, which is added in Task 14.
- Commit messages are plain, with **no AI attribution and no co-author trailers**.

## Review Focus

These are the five failure modes most likely to hurt a presenter or a director during a show.

1. **A counter keeps counting on stale data.** The page shows a confident, wrong number while the server or the Wi-Fi is gone. Data goes stale 2 s after the last fresh message, and counters freeze at that instant, dim, and blank after 10 s. *Tests:*
   - Task 5: `anchorFrame` "freezes at the stale instant…".
   - Task 7: "goes stale 2 s after the last fresh message", "keeps an invalid view out of the snapshot… lets the data go stale".
   - Task 10: presenter "stale".
   - Task 13: step 7, the real server closes.
2. **Second-boundary flicker.** Re-anchoring (deck playback every ~1 s) or a new clock sample a few ms across a boundary makes `0:41 ↔ 0:42` or the full-screen RIENTRO IMMINENTE blink. Everything is driven by `stableTicks` with 250 ms hysteresis, and tallies and modes come from the displayed ticks, never from raw milliseconds. *Tests:*
   - Task 5: "jitter around a boundary never flickers".
   - Task 9: "imminent keeps its hysteresis".
   - Task 10: "imminent boundary does not flicker on a re-anchor".
3. **Layout overflow with long titles.** A 200-character title pushes the counter off a 32" TV, or wraps the dock. Every text cell is `min-width: 0` plus ellipsis or a 2-line clamp, counter sizes are bounded by `vh` and `vw`, and longer strings step down in size by `data-len`. *Tests:*
   - Task 10: "layout rules" (CSS assertions and AC10 arithmetic).
   - TEST-PLAN TV check (Task 15).
   - Optional Task 16 Playwright overflow check.
4. **Reconnect storm.** Tablets and the dock hammer a restarting server. Reconnects use jittered exponential backoff from 0.5 s up to 5 s, the backoff resets only after a connection has stayed up for 10 s, and a protocol mismatch stops retrying. *Tests:* Task 6 `reconnectDelay`; Task 7 "reconnects with jittered exponential backoff", "does not reset the backoff… (no reconnect storm)", "stops for good on a protocol mismatch".
5. **Wrong state on first paint.** Before the first view or clock sample the page flashes "0:00", a stale PRE-SHOW, or the previous show. Mode `waiting` shows only `CONNESSIONE…` until a view has arrived **and** the clock is synced, and counters compute their first value during render (no empty first frame). *Tests:*
   - Task 7: "starts stale with no view".
   - Task 8: "renders the right value on the very first paint".
   - Task 10: "waiting".
   - Task 13: step 0.

---

## File structure

```
shared/src/live/views.ts                  zod schemas + types: Source, Anchor, PresenterView, ControlView, RundownRow, ControlDecision, DECISION_CHOICES
shared/src/protocol/messages.ts           + ServerMessageSchema, ErrorCodeSchema (client-side validation)
server/src/engine/{types,projection,control-view}.ts   types from shared; ended summary; presets; plannedStartAtWall
server/src/api/ws.ts                      safeSend (backpressure), ping/pong liveness, per-client guards
server/src/api/static.ts                  hand-written static handler for web/dist
server/src/app/{paths,server,main}.ts     defaultWebRoot, ServerOptions.webRoot
server/scripts/seed-dev.ts                dev seed (Solo Futsal episode)
web/package.json, tsconfig.json, vite.config.ts
web/{presenter,dock,control}/index.html   Vite multi-page entries
web/src/core/                             views, time-format, stable-ticks, anchor, clock-sync, backoff, i18n, params, ws-client, frame-loop, http
web/src/ui/                               tokens, fonts, base.css, live-context, AnchoredTime, AnchoredProgress, AnchoredWall, SourceBadge, ConnectionOverlay
web/src/ui/control/                       ConfirmButton, useCommand, CommandFeedback, useObsStatus, StatusPanel, Alerts, MessagePanel, EmergencyPanel, panels.css
web/src/presenter/                        presenter-model, PresenterScreen, presenter.css, wake-lock, main
web/src/dock/                             DockScreen, dock.css, main
web/src/control/                          ControlScreen, RundownTable, event-feed, EventFeed, EpisodePicker, control.css, main
web/test/                                 unit, component and integration tests; support/ fakes and fixtures
scripts/dev.mjs                           server + obs-sim + Vite launcher
vitest.config.ts                          projects: node + web (jsdom)
.github/workflows/ci.yml                  + pnpm build
docs/README, TEST-PLAN, BACKLOG, TECH-DESIGN
```

---

### Task 1: View schemas in `shared`; engine types from them; projection additions

**Files:**
- Create: `shared/src/live/views.ts`, `shared/test/views.test.ts`, `server/test/engine/view-schemas.test.ts`
- Modify: `shared/src/index.ts`, `shared/src/protocol/messages.ts`, `server/src/engine/types.ts`, `server/src/engine/projection.ts`, `server/src/engine/control-view.ts`, `server/test/engine/projection.test.ts`, `server/test/engine/control-view.test.ts`

**Interfaces:**
- Produces (`@olc/shared`), each name both a zod schema and its inferred type:
  - `Source`, `Anchor`, `SlotKind`, `SlotStatus`, `DecisionKind`, `PresenterView`, `RundownRow`, `ControlDecision`, `ControlView`;
  - `DECISION_CHOICES`;
  - `ServerMessageSchema`, `ErrorCodeSchema`. `ErrorCode` becomes `z.infer<typeof ErrorCodeSchema>`, with the same union.
- Changes:
  - `PresenterView.ended: { totalMs; finalOffsetMs; source } | null`;
  - `ControlView.presets: { messages: MessagePreset[]; adjustStepMs: number }`;
  - `RundownRow.plannedStartAtWall: number | null`.
- The engine keeps exporting `Anchor`, `PresenterView`, `ControlView`, `RundownRow`, `ControlDecision`, `Source`, `SlotKind`, `SlotStatus` and `DecisionKind` (re-exported types), so no other server import changes.

- [ ] **Step 1: Write the failing tests**

`shared/test/views.test.ts`:
```ts
// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import { Anchor, DECISION_CHOICES, ServerMessageSchema } from '../src/index';

describe('view schemas', () => {
  it('accepts the three anchor kinds and nothing else', () => {
    expect(Anchor.parse({ kind: 'countdown', endsAt: 1, source: 'measured' })).toEqual({ kind: 'countdown', endsAt: 1, source: 'measured' });
    expect(Anchor.parse({ kind: 'frozen', valueMs: 5, source: 'estimated' })).toEqual({ kind: 'frozen', valueMs: 5, source: 'estimated' });
    expect(Anchor.parse({ kind: 'unknown' })).toEqual({ kind: 'unknown' });
    expect(Anchor.safeParse({ kind: 'countup', since: 1, source: 'measured' }).success).toBe(false);
    expect(Anchor.safeParse({ kind: 'countdown', endsAt: 1 }).success).toBe(false);
  });

  it('lists the choices the engine offers for each decision kind', () => {
    expect(DECISION_CHOICES).toEqual({
      output_restart: ['continue', 'new_session'],
      all_outputs_stopped: ['interruption', 'end'],
    });
  });
});

describe('ServerMessageSchema', () => {
  it('parses every server message', () => {
    const msgs = [
      { type: 'welcome', serverVersion: '0.1.0', instanceId: 'i-1', protocol: 1 },
      { type: 'view', rev: 3, role: 'presenter', view: null },
      { type: 'heartbeat', rev: 3, serverWall: 1_790_000_000_000 },
      { type: 'time.pong', t0: 12.5, serverWall: 1_790_000_000_000 },
      { type: 'ack', id: 'c1', changed: false },
      { type: 'error', id: null, code: 'no_episode', message: 'No episode is loaded' },
    ];
    for (const m of msgs) expect(ServerMessageSchema.parse(m)).toEqual(m);
  });

  it('rejects malformed messages', () => {
    expect(ServerMessageSchema.safeParse({ type: 'view', role: 'presenter', view: null }).success).toBe(false);
    expect(ServerMessageSchema.safeParse({ type: 'error', id: null, code: 'teapot', message: '' }).success).toBe(false);
    expect(ServerMessageSchema.safeParse({ type: 'nope' }).success).toBe(false);
  });
});
```

`server/test/engine/view-schemas.test.ts`:
```ts
// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import { ControlView, PresenterView } from '@olc/shared';
import { controlView } from '../../src/engine/control-view';
import { presenterView } from '../../src/engine/projection';
import type { LiveState } from '../../src/engine/types';
import { T0, freshState, liveState, run } from '../helpers';

const toWall = (m: number) => 1_790_000_000_000 + m;

/** One state per screen the clients render: parse(view) must equal view, so every field is declared. */
const states: Array<[string, LiveState, number]> = [
  ['preshow', freshState(), 0],
  ['live studio', liveState(), T0 + 100_000],
  [
    'media',
    run(
      liveState(),
      { type: 'DeckItemStarted', at: T0 + 60_000, index: 0, path: 'D:/media/servizio1.mp4', title: 'Servizio 1', durationMs: 185_000 },
      { type: 'ProgramSceneChanged', at: T0 + 60_000, scene: 'PLAYOUT', deckOnProgram: true },
    ),
    T0 + 61_000,
  ],
  ['break', run(liveState(), { type: 'ProgramSceneChanged', at: T0 + 700_000, scene: 'BREAK', deckOnProgram: false }), T0 + 701_000],
  ['obs lost', run(liveState(), { type: 'SourceLost', at: T0 + 1 }), T0 + 2],
  [
    'off-script with a decision',
    run(
      liveState(),
      { type: 'ProgramSceneChanged', at: T0 + 30_000, scene: 'CAMERA OSPITE', deckOnProgram: false },
      { type: 'OutputChanged', at: T0 + 60_000, output: 'rec', state: 'stopped' },
    ),
    T0 + 61_000,
  ],
  ['ended', run(liveState(), { type: 'EndProgram', at: T0 + 1_700_000 }), T0 + 1_800_000],
];

describe('engine projections satisfy the shared view schemas', () => {
  it.each(states)('%s', (_label, state, now) => {
    const p = presenterView(state, now, toWall);
    expect(PresenterView.parse(p)).toEqual(p);
    const c = controlView(state, now, toWall);
    expect(ControlView.parse(c)).toEqual(c);
  });
});
```

Append to `server/test/engine/projection.test.ts`, inside `describe('presenterView', …)`:
```ts
  it('ended: total program time and final offset from the planned end', () => {
    const s = run(liveState(), { type: 'EndProgram', at: T0 + 1_700_000 });
    const v = presenterView(s, T0 + 1_800_000, toWall);
    expect(v.phase).toBe('ended');
    expect(v.ended).toEqual({ totalMs: 1_700_000, finalOffsetMs: 80_000, source: 'measured' });
  });

  it('ended is null until the program ends, and estimated when OBS was lost', () => {
    expect(presenterView(liveState(), T0 + 1, toWall).ended).toBeNull();
    const s = run(liveState(), { type: 'SourceLost', at: T0 + 1 }, { type: 'EndProgram', at: T0 + 600_000 });
    expect(presenterView(s, T0 + 600_001, toWall).ended).toEqual({ totalMs: 600_000, finalOffsetMs: -1_020_000, source: 'estimated' });
  });
```

In `server/test/engine/control-view.test.ts`, test `'lists every slot with status, duration and wall times'`:
- add `plannedStartAtWall: toWall(T0),` to the `rows[0]` literal (between `durationSource` and `startedAtWall`);
- append these lines:
```ts
    expect(v.rows[3]!.plannedStartAtWall).toBe(toWall(T0 + 720_000));
    expect(v.presets).toEqual({
      messages: [
        { id: 'stringi', text: 'STRINGI', dismiss: { kind: 'timeout', ms: 10_000 } },
        { id: 'cam2', text: 'GUARDA CAM 2', dismiss: { kind: 'manual' } },
      ],
      adjustStepMs: 30_000,
    });
```
Add one new test:
```ts
  it('has no planned start times before the program starts', () => {
    const v = controlView(freshState(), 0, toWall);
    expect(v.rows.every((r) => r.plannedStartAtWall === null)).toBe(true);
  });
```
(Import `freshState` from `../helpers`.)

- [ ] **Step 2: Run them and verify they fail**

Run: `pnpm vitest run shared/test/views.test.ts server/test/engine`. Expected: FAIL. The module is missing, `ended`/`presets`/`plannedStartAtWall` are undefined, and `ControlView.parse` strips nothing yet because the schema does not exist.

- [ ] **Step 3: Implement**

`shared/src/live/views.ts`:
```ts
// SPDX-License-Identifier: GPL-2.0-or-later
import { z } from 'zod';
import { MessagePreset } from '../model/format';

/** NF1: where a value comes from. */
export const Source = z.enum(['measured', 'planned', 'estimated']);
export type Source = z.infer<typeof Source>;

/**
 * DT-7 anchor: a fact with a reference instant, never a running value. A countdown past its end is shown as a
 * positive overrun by the client; a frozen value is paused (media pause or REC pause); unknown is shown as "—".
 */
export const Anchor = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('countdown'), endsAt: z.number(), source: Source }),
  z.object({ kind: z.literal('frozen'), valueMs: z.number(), source: Source }),
  z.object({ kind: z.literal('unknown') }),
]);
export type Anchor = z.infer<typeof Anchor>;

export const SlotKind = z.enum(['studio', 'media', 'break']);
export type SlotKind = z.infer<typeof SlotKind>;
export const SlotStatus = z.enum(['pending', 'onair', 'done', 'postponed', 'dropped']);
export type SlotStatus = z.infer<typeof SlotStatus>;
export const DecisionKind = z.enum(['output_restart', 'all_outputs_stopped']);
export type DecisionKind = z.infer<typeof DecisionKind>;

/** The choices `resolve_decision` accepts for each decision kind (the engine's defaults are listed first). */
export const DECISION_CHOICES = {
  output_restart: ['continue', 'new_session'],
  all_outputs_stopped: ['interruption', 'end'],
} as const satisfies Record<DecisionKind, readonly string[]>;

const Wall = z.number();

export const PresenterView = z.object({
  phase: z.enum(['preshow', 'live', 'ended']),
  segment: SlotKind.nullable(),
  rundownFinished: z.boolean(),
  block: z.object({ index: z.number().int().nonnegative(), name: z.string(), anchor: Anchor }).nullable(),
  onAir: z
    .object({ title: z.string(), anchor: Anchor, startedAtWall: Wall.nullable(), durationMs: z.number().nullable() })
    .nullable(),
  returnTo: z.object({ blockName: z.string(), anchor: Anchor }).nullable(),
  next: z.object({ title: z.string(), durationMs: z.number(), source: Source }).nullable(),
  programEnd: z.object({ anchor: Anchor, endsAtWall: Wall.nullable() }).nullable(),
  delay: z.object({ ms: z.number(), source: Source }).nullable(),
  thresholds: z.object({ warnMs: z.number().nonnegative(), returnImminentMs: z.number().nonnegative() }),
  message: z.object({ text: z.string() }).nullable(),
  status: z.object({
    rec: z.boolean(),
    stream: z.boolean(),
    recPaused: z.boolean(),
    obs: z.enum(['ok', 'lost']),
    control: z.enum(['auto', 'manual']),
  }),
  preshow: z
    .object({ plannedStart: z.string().nullable(), totalDurationMs: z.number(), upcoming: z.array(z.string()) })
    .nullable(),
  /** FINE (SPEC §7): program time from T0 to the end, and the end minus the planned end. Null until ended. */
  ended: z.object({ totalMs: z.number(), finalOffsetMs: z.number(), source: Source }).nullable(),
});
export type PresenterView = z.infer<typeof PresenterView>;

export const RundownRow = z.object({
  slot: z.number().int().nonnegative(),
  blockIndex: z.number().int().nonnegative(),
  blockName: z.string(),
  kind: SlotKind,
  title: z.string(),
  status: SlotStatus,
  provisional: z.boolean(),
  /** null for studio rows: their duration is elastic (shown as "—"). */
  durationMs: z.number().nullable(),
  durationSource: Source,
  /** Planned start of the row's block (T0 + preceding block durations); null before T0. */
  plannedStartAtWall: Wall.nullable(),
  startedAtWall: Wall.nullable(),
  endedAtWall: Wall.nullable(),
});
export type RundownRow = z.infer<typeof RundownRow>;

export const ControlDecision = z.object({
  id: z.number().int().positive(),
  kind: DecisionKind,
  atWall: Wall,
  defaultChoice: z.string(),
  choice: z.string(),
  confirmed: z.boolean(),
});
export type ControlDecision = z.infer<typeof ControlDecision>;

export const ControlView = z.object({
  episode: z.object({ id: z.string(), name: z.string() }),
  presenter: PresenterView,
  control: z.enum(['auto', 'manual']),
  obs: z.enum(['ok', 'lost']),
  ambiguous: z.boolean(),
  cursor: z.number().int(),
  returnSlot: z.number().int().nullable(),
  offScript: z.object({ scene: z.string(), sinceWall: Wall }).nullable(),
  decisions: z.array(ControlDecision),
  rows: z.array(RundownRow),
  /** What the dock needs from the loaded episode: preset messages (hotkey slot = index + 1, DT-9) and the ±time step. */
  presets: z.object({ messages: z.array(MessagePreset), adjustStepMs: z.number().int().positive() }),
});
export type ControlView = z.infer<typeof ControlView>;
```

`shared/src/index.ts`: add `export * from './live/views';`.

`shared/src/protocol/messages.ts`:
- replace the `ErrorCode` type line with the code below;
- append `ServerMessageSchema` after the existing `ServerMessage` type, which stays unchanged.
```ts
export const ErrorCodeSchema = z.enum(['invalid_message', 'protocol_mismatch', 'hello_required', 'no_episode', 'internal', 'forbidden']);
export type ErrorCode = z.infer<typeof ErrorCodeSchema>;
```
```ts
/** Client-side validation of what the server sends. `view` is validated per role by the client (shared view schemas). */
export const ServerMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('welcome'), serverVersion: z.string(), instanceId: z.string(), protocol: z.number().int() }),
  z.object({ type: z.literal('view'), rev: z.number().int().nonnegative(), role: ClientRole, view: z.unknown() }),
  z.object({ type: z.literal('heartbeat'), rev: z.number().int().nonnegative(), serverWall: z.number() }),
  z.object({ type: z.literal('time.pong'), t0: z.number(), serverWall: z.number() }),
  z.object({ type: z.literal('ack'), id: z.string(), changed: z.boolean() }),
  z.object({ type: z.literal('error'), id: z.string().nullable(), code: ErrorCodeSchema, message: z.string() }),
]);
```

`server/src/engine/types.ts`:
- remove the local `Source`, `SlotKind`, `SlotStatus` and `DecisionKind` definitions;
- at the top, add:
```ts
import type { DecisionKind, SlotKind, SlotStatus, Source } from '@olc/shared';
export type { DecisionKind, SlotKind, SlotStatus, Source };
```
(Keep `import type { Episode, MessageDismiss } from '@olc/shared';`.)

`server/src/engine/projection.ts`:
- delete the local `Anchor` and `PresenterView` declarations;
- import them as types from `@olc/shared` and re-export them: `export type { Anchor, PresenterView } from '@olc/shared';`, plus `import type { Anchor, PresenterView } from '@olc/shared';`;
- import `plannedEndAt` from `./timing`;
- add the function below and the field `ended: endedSummary(s),` as the last property of the returned object.
```ts
/** FINE: the latest block end is the program end (endProgram closes every started block at the same instant). */
function endedSummary(s: LiveState): PresenterView['ended'] {
  if (s.phase !== 'ended' || s.t0 === null) return null;
  let endAt: MonoMs | null = null;
  for (const rt of s.blockRt) {
    if (rt.endedAt !== null && (endAt === null || rt.endedAt > endAt)) endAt = rt.endedAt;
  }
  if (endAt === null) return null;
  const plannedEnd = plannedEndAt(s, s.episode.blocks.length - 1)!;
  return {
    totalMs: endAt - s.t0,
    finalOffsetMs: endAt - plannedEnd,
    source: s.obs === 'lost' || s.ambiguous ? 'estimated' : 'measured',
  };
}
```

`server/src/engine/control-view.ts`:
- delete the local `RundownRow`, `ControlDecision` and `ControlView` interfaces;
- add `import type { ControlDecision, ControlView, RundownRow } from '@olc/shared'; export type { ControlDecision, ControlView, RundownRow } from '@olc/shared';`;
- import `plannedStartAt` from `./timing`;
- in the row mapper, add `plannedStartAtWall: wall(plannedStartAt(s, slot.blockIndex)),` after `durationSource`;
- add this property after `rows`:
```ts
    presets: { messages: s.episode.messages.map((m) => ({ ...m })), adjustStepMs: s.episode.preset.adjustStepMs },
```
- the `Decision` import keeps only what is still used: `LiveState`, `MonoMs`.

- [ ] **Step 4: Run them and verify they pass**

Run: `pnpm test && pnpm typecheck`. Expected: PASS, all existing tests green.

- [ ] **Step 5: Commit**

```bash
git add shared/src shared/test server/src/engine server/test/engine
git commit -m "feat(shared): view schemas shared with the web; ended summary, presets and planned starts in the projections"
```

---

### Task 2: WebSocket backpressure, ping/pong liveness and per-client guards (BACKLOG)

**Files:**
- Modify: `server/src/api/ws.ts`, `server/test/api/ws.test.ts`

**Interfaces:**
- Produces:
  - `DEFAULT_MAX_BUFFERED_BYTES = 1_048_576`;
  - `DEFAULT_PING_INTERVAL_MS = 5_000`;
  - `interface SendTarget`;
  - `safeSend(socket, msg, maxBuffered, report): boolean`.
- `WsContext` gains two optional fields, `pingIntervalMs?` and `maxBufferedBytes?`. `buildServer` keeps the defaults.

**Rules:**
- **Every send goes through `safeSend`, which never throws.**
  - A socket that is not `OPEN` → `false`.
  - `bufferedAmount > maxBuffered` → the peer is not draining. Report it, `terminate()` the socket, return `false`.
  - A throwing `send` → report, return `false`.
- **Liveness.**
  - Every `pingIntervalMs`, each socket (with or without hello) that has not answered the previous ping is terminated and removed. Every other socket is marked not-alive and pinged.
  - A `pong` or any message marks the socket alive.
  - Each iteration has its own `try`/`catch`.
- **Heartbeat.** `pushViews` and each client's heartbeat send are guarded independently: one bad client never stops the loop.
- Both intervals are cleared in `onClose`.

- [ ] **Step 1: Write the failing tests**

In `server/test/api/ws.test.ts`:
- change the helper signature to `async function start(heartbeatMs = 40, extra: Partial<WsContext> = {})` and spread `...extra` into the `registerWs` context;
- import `WebSocket from 'ws'`, `type WsContext` and `safeSend` from `../../src/api/ws`;
- add:
```ts
type ViewMsg = Extract<ServerMessage, { type: 'view' }>;
type HeartbeatMsg = Extract<ServerMessage, { type: 'heartbeat' }>;

function fakeTarget(over: Partial<{ readyState: number; bufferedAmount: number; send: (d: string) => void }> = {}) {
  const sent: string[] = [];
  let terminated = 0;
  return {
    sent,
    get terminated() { return terminated; },
    target: {
      readyState: over.readyState ?? 1,
      OPEN: 1,
      bufferedAmount: over.bufferedAmount ?? 0,
      send: over.send ?? ((d: string) => { sent.push(d); }),
      terminate: () => { terminated += 1; },
    },
  };
}

describe('safeSend', () => {
  const msg: ServerMessage = { type: 'ack', id: 'c1', changed: true };

  it('sends JSON to an open, draining socket', () => {
    const f = fakeTarget();
    expect(safeSend(f.target, msg, 1_000, () => {})).toBe(true);
    expect(f.sent).toEqual([JSON.stringify(msg)]);
  });

  it('skips a socket that is not open', () => {
    const f = fakeTarget({ readyState: 3 });
    expect(safeSend(f.target, msg, 1_000, () => {})).toBe(false);
    expect(f.sent).toEqual([]);
  });

  it('terminates a peer whose buffer is over the cap instead of queueing more', () => {
    const reports: unknown[] = [];
    const f = fakeTarget({ bufferedAmount: 1_001 });
    expect(safeSend(f.target, msg, 1_000, (e) => reports.push(e))).toBe(false);
    expect(f.terminated).toBe(1);
    expect(f.sent).toEqual([]);
    expect(reports).toHaveLength(1);
  });

  it('never throws when send throws', () => {
    const reports: unknown[] = [];
    const f = fakeTarget({ send: () => { throw new Error('EPIPE'); } });
    expect(safeSend(f.target, msg, 1_000, (e) => reports.push(e))).toBe(false);
    expect(reports).toHaveLength(1);
  });
});
```
Add inside `describe('WebSocket hub', …)`:
```ts
  it('terminates a peer that stops answering pings (half-open tablet)', async () => {
    const s = await start(1_000, { pingIntervalMs: 50 });
    const dead = new WebSocket(s.url, { autoPong: false });
    await new Promise<void>((resolve) => dead.once('open', () => resolve()));
    const code = await new Promise<number>((resolve) => dead.once('close', (c: number) => resolve(c)));
    expect(code).toBe(1006);
  });

  it('keeps a peer that answers pings', async () => {
    const s = await start(1_000, { pingIntervalMs: 50 });
    const c = await connect(s.url);
    c.send({ type: 'hello', role: 'presenter', protocol: PROTOCOL_VERSION });
    await c.next(is('welcome'));
    const outcome = await Promise.race([
      c.closed.then(() => 'closed'),
      new Promise<string>((resolve) => setTimeout(() => resolve('open'), 400)),
    ]);
    expect(outcome).toBe('open');
    c.close();
  });
```
Replace the body of `"carries each client's own view rev on heartbeats"` with:
```ts
    const s = await start(30);
    await s.runtime.load(soloFutsalEpisode());
    const presenter = await connect(s.url);
    presenter.send({ type: 'hello', role: 'presenter', protocol: PROTOCOL_VERSION });
    const pv = (await presenter.next(is('view'))) as ViewMsg;
    const control = await connect(s.url);
    control.send({ type: 'hello', role: 'control', protocol: PROTOCOL_VERSION });
    const cv = (await control.next(is('view'))) as ViewMsg;
    expect(cv.rev).toBeGreaterThan(pv.rev);
    // Only heartbeats sent after the control view exists prove the rev is per client: skip the first one,
    // which may have left the server before the control view did, and check the second.
    const mark = presenter.messages.length;
    const after = (m: ServerMessage) => m.type === 'heartbeat' && presenter.messages.indexOf(m) >= mark;
    await presenter.next(after);
    const hb = (await presenter.next(after)) as HeartbeatMsg;
    expect(hb.rev).toBe(pv.rev);
    presenter.close();
    control.close();
```

- [ ] **Step 2: Run it and verify it fails**

Run: `pnpm vitest run server/test/api/ws.test.ts`. Expected: FAIL. `safeSend` is not exported, and the dead peer is never closed.

- [ ] **Step 3: Implement**

In `server/src/api/ws.ts`:
- add the exports below;
- add `alive: boolean` to `Client`, initialised to `true`;
- add the optional context fields;
- replace the local `send` with `sendTo`, which calls `safeSend`.
```ts
export const DEFAULT_MAX_BUFFERED_BYTES = 1_048_576;
export const DEFAULT_PING_INTERVAL_MS = 5_000;

/** The subset of a ws WebSocket that `safeSend` touches (tests pass a fake). */
export interface SendTarget {
  readonly readyState: number;
  readonly OPEN: number;
  readonly bufferedAmount: number;
  send(data: string): void;
  terminate(): void;
}

/**
 * Sends one message without ever throwing. A peer that does not drain its socket (bufferedAmount above the cap)
 * is terminated instead of growing the server's memory. Returns false when nothing was sent.
 */
export function safeSend(socket: SendTarget, msg: ServerMessage, maxBuffered: number, report: (err: unknown) => void): boolean {
  try {
    if (socket.readyState !== socket.OPEN) return false;
    if (socket.bufferedAmount > maxBuffered) {
      report(new Error(`WebSocket peer not draining (${socket.bufferedAmount} bytes buffered); closing it`));
      socket.terminate();
      return false;
    }
    socket.send(JSON.stringify(msg));
    return true;
  } catch (err) {
    report(err);
    return false;
  }
}
```
Inside `registerWs`:
```ts
  const maxBuffered = ctx.maxBufferedBytes ?? DEFAULT_MAX_BUFFERED_BYTES;
  const sendTo = (socket: WebSocket, msg: ServerMessage) => safeSend(socket, msg, maxBuffered, (err) => app.log.error(err));
```
Replace every `send(socket, …)` with `sendTo(socket, …)`. The heartbeat becomes:
```ts
  const heartbeat = setInterval(() => {
    try {
      pushViews();
    } catch (err) {
      app.log.error(err);
    }
    for (const [socket, client] of clients) {
      try {
        if (client.role !== null) sendTo(socket, { type: 'heartbeat', rev: client.lastRev, serverWall: ctx.clock.wall() });
      } catch (err) {
        app.log.error(err);
      }
    }
  }, ctx.heartbeatMs);

  const liveness = setInterval(() => {
    for (const [socket, client] of clients) {
      try {
        if (!client.alive) {
          app.log.warn('Terminating a WebSocket peer that stopped answering pings');
          clients.delete(socket);
          socket.terminate();
          continue;
        }
        client.alive = false;
        socket.ping();
      } catch (err) {
        app.log.error(err);
      }
    }
  }, ctx.pingIntervalMs ?? DEFAULT_PING_INTERVAL_MS);
```
- In `onClose`, also call `clearInterval(liveness)`.
- In the connection handler, add `socket.on('pong', () => { client.alive = true; });`, and set `client.alive = true;` as the first line of the `message` handler.

- [ ] **Step 4: Run it and verify it passes**

Run: `pnpm test && pnpm typecheck` three times. Expected: PASS every time.

- [ ] **Step 5: Commit**

```bash
git add server/src/api/ws.ts server/test/api/ws.test.ts
git commit -m "feat(server): websocket backpressure cap, ping/pong liveness and guarded per-client sends"
```

---

### Task 3: Serve the built web app (hand-written static handler)

**Files:**
- Create: `server/src/api/static.ts`, `server/test/api/static.test.ts`
- Modify: `server/src/app/paths.ts` (`defaultWebRoot`), `server/src/app/server.ts` (`ServerOptions.webRoot`, register), `server/src/app/main.ts` (pass `defaultWebRoot()`), `server/test/app/basics.test.ts` (`defaultWebRoot` cases)

**Interfaces:**
- Produces:
  - `WEB_PAGES = ['presenter', 'dock', 'control'] as const`;
  - `registerStatic(app, { root: string | null })`;
  - `defaultWebRoot(env?, moduleUrl?)`;
  - `ServerOptions.webRoot?: string | null`, default `null` (tests). `main.ts` passes `defaultWebRoot()`.

**Routes** (registered after the host guard, so they stay protected):

| Request | Response |
|---|---|
| `GET /` | `302 Location: /control` |
| `GET /presenter`, `/presenter/` (and the same for `dock` and `control`; the query string is ignored) | `<root>/<page>/index.html`. Headers: `content-type: text/html; charset=utf-8`, `cache-control: no-cache`, `x-content-type-options: nosniff` |
| `GET /assets/<name>` | `<root>/assets/<name>`. Headers: content type by extension, `cache-control: public, max-age=31536000, immutable` (Vite hashes the names), `x-content-type-options: nosniff` |
| root `null`, or the page file missing | `503 text/plain; charset=utf-8`: `OBS Live Clock web app is not built. Run: pnpm --filter @olc/web build` |
| a name not matching `^[A-Za-z0-9][A-Za-z0-9._-]*$` (so no `..`, no `/`, no `\`), an unknown asset, or root `null` for an asset | `404 { error: 'not_found' }` |

MIME map:

| Extension | Content type |
|---|---|
| `.js` | `text/javascript; charset=utf-8` |
| `.css` | `text/css; charset=utf-8` |
| `.woff2` | `font/woff2` |
| `.woff` | `font/woff` |
| `.svg` | `image/svg+xml` |
| `.png` | `image/png` |
| `.ico` | `image/x-icon` |
| `.json`, `.map` | `application/json; charset=utf-8` |
| anything else | `application/octet-stream` |

Fastify answers `HEAD` for every `GET` route automatically.

`defaultWebRoot(env = process.env, moduleUrl = import.meta.url)` returns `env.OLC_WEB_ROOT` when it is set. Otherwise it returns `fileURLToPath(new URL('../../../web/dist', moduleUrl))`. From `server/src/app/paths.ts` that is `<repo>/web/dist`.

- [ ] **Step 1: Write the failing tests**

`server/test/api/static.test.ts`:
```ts
// SPDX-License-Identifier: GPL-2.0-or-later
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import Fastify from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { registerStatic } from '../../src/api/static';
import { buildTestServer } from '../support/server';
import { tempDir } from '../support/tmp';

const closers: Array<() => Promise<unknown>> = [];
afterEach(async () => {
  while (closers.length > 0) await closers.pop()!();
});

async function webRoot(pages: string[] = ['presenter', 'dock', 'control']): Promise<string> {
  const root = await tempDir();
  for (const page of pages) {
    await mkdir(join(root, page), { recursive: true });
    await writeFile(join(root, page, 'index.html'), `<html>${page}</html>`);
  }
  await mkdir(join(root, 'assets'), { recursive: true });
  await writeFile(join(root, 'assets', 'presenter-abc123.js'), 'console.log(1)');
  await writeFile(join(root, 'assets', 'inter-latin-700-normal-x1.woff2'), Buffer.from([0x77, 0x4f, 0x46, 0x32]));
  await writeFile(join(root, 'secret.txt'), 'nope');
  return root;
}

async function app(root: string | null) {
  const a = Fastify();
  registerStatic(a, { root });
  closers.push(() => a.close());
  return a;
}

describe('static web app', () => {
  it('serves each page with and without the trailing slash, uncached', async () => {
    const a = await app(await webRoot());
    for (const page of ['presenter', 'dock', 'control']) {
      for (const url of [`/${page}`, `/${page}/`, `/${page}?lang=en&screen=tv-1`]) {
        const res = await a.inject({ method: 'GET', url });
        expect(res.statusCode, url).toBe(200);
        expect(res.headers['content-type']).toBe('text/html; charset=utf-8');
        expect(res.headers['cache-control']).toBe('no-cache');
        expect(res.headers['x-content-type-options']).toBe('nosniff');
        expect(res.body).toBe(`<html>${page}</html>`);
      }
    }
  });

  it('redirects the root to the control view', async () => {
    const res = await (await app(await webRoot())).inject({ method: 'GET', url: '/' });
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe('/control');
  });

  it('serves hashed assets as immutable with the right type', async () => {
    const a = await app(await webRoot());
    const js = await a.inject({ method: 'GET', url: '/assets/presenter-abc123.js' });
    expect(js.statusCode).toBe(200);
    expect(js.headers['content-type']).toBe('text/javascript; charset=utf-8');
    expect(js.headers['cache-control']).toBe('public, max-age=31536000, immutable');
    expect(js.body).toBe('console.log(1)');
    const font = await a.inject({ method: 'GET', url: '/assets/inter-latin-700-normal-x1.woff2' });
    expect(font.headers['content-type']).toBe('font/woff2');
    const head = await a.inject({ method: 'HEAD', url: '/presenter' });
    expect(head.statusCode).toBe(200);
    expect(head.body).toBe('');
  });

  it('refuses traversal, sub-paths and unknown assets with 404', async () => {
    const a = await app(await webRoot());
    for (const url of [
      '/assets/missing.js',
      '/assets/..%2Fsecret.txt',
      '/assets/%2e%2e%2fsecret.txt',
      '/assets/a/b.js',
      '/assets/.hidden',
      '/assets/..%5Csecret.txt',
    ]) {
      const res = await a.inject({ method: 'GET', url });
      expect(res.statusCode, url).toBe(404);
      expect(res.json()).toEqual({ error: 'not_found' });
    }
  });

  it('answers 503 with build instructions when the app is not built', async () => {
    const a = await app(null);
    const res = await a.inject({ method: 'GET', url: '/presenter' });
    expect(res.statusCode).toBe(503);
    expect(res.headers['content-type']).toBe('text/plain; charset=utf-8');
    expect(res.body).toContain('pnpm --filter @olc/web build');
    expect((await a.inject({ method: 'GET', url: '/assets/x.js' })).statusCode).toBe(404);
    const partial = await app(await webRoot(['presenter']));
    expect((await partial.inject({ method: 'GET', url: '/control' })).statusCode).toBe(503);
  });

  it('stays behind the host guard inside the real server', async () => {
    const root = await webRoot();
    const { app: server } = await buildTestServer({ dataDir: await tempDir(), webRoot: root });
    closers.push(() => server.close());
    expect((await server.inject({ method: 'GET', url: '/presenter', headers: { host: '127.0.0.1:4460' } })).statusCode).toBe(200);
    expect((await server.inject({ method: 'GET', url: '/presenter', headers: { host: 'evil.example' } })).statusCode).toBe(403);
    expect((await server.inject({ method: 'GET', url: '/api/health', headers: { host: '127.0.0.1:4460' } })).statusCode).toBe(200);
  });
});
```
In `server/test/app/basics.test.ts`, add the test below. Add `pathToFileURL` from `node:url` and `tmpdir` from `node:os`, and add `defaultWebRoot` to the existing `../../src/app/paths` import; `join` is already imported:
```ts
  it('resolves the web root next to the repository unless OLC_WEB_ROOT is set', () => {
    const base = join(tmpdir(), 'olc-repo');
    const moduleUrl = pathToFileURL(join(base, 'server', 'src', 'app', 'paths.ts')).href;
    expect(defaultWebRoot({}, moduleUrl)).toBe(join(base, 'web', 'dist'));
    expect(defaultWebRoot({ OLC_WEB_ROOT: '/srv/olc-web' }, moduleUrl)).toBe('/srv/olc-web');
  });
```

- [ ] **Step 2: Run it and verify it fails**

Run: `pnpm vitest run server/test/api/static.test.ts server/test/app/basics.test.ts`. Expected: FAIL, because the modules are missing.

- [ ] **Step 3: Implement**

`server/src/api/static.ts`:
```ts
// SPDX-License-Identifier: GPL-2.0-or-later
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import type { FastifyInstance, FastifyReply } from 'fastify';

export const WEB_PAGES = ['presenter', 'dock', 'control'] as const;

const ASSET_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const NOT_BUILT = 'OBS Live Clock web app is not built. Run: pnpm --filter @olc/web build';
const MIME: Record<string, string> = {
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
};

function isNotFound(err: unknown): boolean {
  const code = (err as { code?: unknown }).code;
  return code === 'ENOENT' || code === 'ENOTDIR' || code === 'EISDIR';
}

/**
 * Serves the Vite build (TECH-DESIGN §8): one HTML entry per page, hashed assets under /assets. Hand-written
 * because @fastify/static pulls a BlueOak-licensed dependency. Registered after the host guard.
 */
export function registerStatic(app: FastifyInstance, opts: { root: string | null }): void {
  const notBuilt = (reply: FastifyReply) => reply.code(503).type('text/plain; charset=utf-8').send(NOT_BUILT);
  const notFound = (reply: FastifyReply) => reply.code(404).send({ error: 'not_found' });

  app.get('/', (_req, reply) => reply.redirect('/control', 302));

  for (const page of WEB_PAGES) {
    const handler = async (_req: unknown, reply: FastifyReply) => {
      if (opts.root === null) return notBuilt(reply);
      try {
        const html = await readFile(join(opts.root, page, 'index.html'));
        return reply
          .type('text/html; charset=utf-8')
          .header('cache-control', 'no-cache')
          .header('x-content-type-options', 'nosniff')
          .send(html);
      } catch (err) {
        if (isNotFound(err)) return notBuilt(reply);
        throw err;
      }
    };
    app.get(`/${page}`, handler);
    app.get(`/${page}/`, handler);
  }

  app.get<{ Params: { '*': string } }>('/assets/*', async (req, reply) => {
    const name = req.params['*'];
    if (opts.root === null || !ASSET_NAME.test(name)) return notFound(reply);
    try {
      const body = await readFile(join(opts.root, 'assets', name));
      return reply
        .type(MIME[extname(name).toLowerCase()] ?? 'application/octet-stream')
        .header('cache-control', 'public, max-age=31536000, immutable')
        .header('x-content-type-options', 'nosniff')
        .send(body);
    } catch (err) {
      if (isNotFound(err)) return notFound(reply);
      throw err;
    }
  });
}
```
`server/src/app/paths.ts`: add the `defaultWebRoot` function, with `import { fileURLToPath } from 'node:url';`.
```ts
/** Where the built web app lives: OLC_WEB_ROOT, else `<repo>/web/dist` relative to this module (dev layout). */
export function defaultWebRoot(env: NodeJS.ProcessEnv = process.env, moduleUrl: string = import.meta.url): string {
  if (env.OLC_WEB_ROOT) return env.OLC_WEB_ROOT;
  return fileURLToPath(new URL('../../../web/dist', moduleUrl));
}
```
`server/src/app/server.ts`:
- add `webRoot?: string | null;` to `ServerOptions`, documented as `Built web app directory; null (default) answers 503 on the pages`;
- call `registerStatic(app, { root: opts.webRoot ?? null });` right after `registerWs(…)`.

`server/src/app/main.ts`: pass `webRoot: defaultWebRoot()` to `buildServer`.

- [ ] **Step 4: Run it and verify it passes**

Run: `pnpm test && pnpm typecheck`. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/api/static.ts server/src/app server/test/api/static.test.ts server/test/app/basics.test.ts
git commit -m "feat(server): serve the built web pages and hashed assets behind the host guard"
```

---
### Task 4: `web` workspace scaffold — Vite multi-page, Vitest projects, tokens, fonts, fixtures

**Files:**
- Modify: `pnpm-workspace.yaml` (add `web`), `package.json` (devDependency `"jsdom": "^30.1.2"`), `vitest.config.ts` (projects), `server/package.json` (`exports` for the integration test)
- Create:
  - `web/package.json`, `web/tsconfig.json`, `web/vite.config.ts`;
  - `web/presenter/index.html`, `web/dock/index.html`, `web/control/index.html`;
  - `web/src/presenter/main.tsx`, `web/src/dock/main.tsx`, `web/src/control/main.tsx` (placeholders, replaced in Tasks 10–12);
  - `web/src/ui/tokens.ts`, `web/src/ui/fonts.ts`, `web/src/ui/base.css`;
  - `web/test/setup.ts`, `web/test/support/views.ts`;
  - `web/test/ui/tokens.test.ts`, `web/test/fixtures.test.ts`.

**Interfaces:**
- Produces:
  - `COLORS`, `FONT_STACK`, `cssVarName(key)`, `tokensCss()`, `installTokens(doc?)`;
  - test fixtures `WALL`, `studioView`, `preshowView`, `mediaView`, `breakView`, `endedView`, `controlView`.
- Package `@olc/web`:
  - dependencies: `@olc/shared` `workspace:*`, `react` `^19.3.0`, `react-dom` `^19.3.0`, `zod` `^4.1.0`, `@fontsource/inter` `5.3.0`;
  - devDependencies: `@olc/server` `workspace:*`, `@olc/obs-sim` `workspace:*`, `@testing-library/dom` `^10.4.2`, `@testing-library/react` `^16.3.3`, `@types/react` `^19.3.0`, `@types/react-dom` `^19.3.0`, `@vitejs/plugin-react` `^5.2.0`, `vite` `~7.3.7`.
- **Why Vite 7, not 8:** Vitest 3.2 depends on Vite `^5 || ^6 || ^7`. Vite 7 keeps a single Vite in the tree. `@vitejs/plugin-react` 5.2 supports Vite 4–8 (6.x requires Vite 8).

- [ ] **Step 1: Write the failing tests**

`web/test/ui/tokens.test.ts`:
```ts
// SPDX-License-Identifier: GPL-2.0-or-later
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { COLORS, installTokens, tokensCss } from '../../src/ui/tokens';

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5]
    .map((i) => Number.parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

/** WCAG 2.x contrast ratio. */
function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

describe('colour tokens', () => {
  it('every text colour on black meets WCAG AAA for large text (≥ 4.5:1)', () => {
    for (const key of ['fg', 'fgDim', 'fgOff', 'estimated', 'stale', 'amber', 'red', 'green'] as const) {
      expect(contrast(COLORS[key], COLORS.bg), key).toBeGreaterThanOrEqual(4.5);
    }
    expect(contrast(COLORS.fg, COLORS.msgBg)).toBeGreaterThanOrEqual(4.5);
  });

  it('small-text pairs used by the dock and control view meet WCAG AAA (≥ 7:1)', () => {
    const pairs: Array<[keyof typeof COLORS, keyof typeof COLORS]> = [
      ['fg', 'bg'], ['fgDim', 'bg'], ['amber', 'bg'], ['fg', 'surface'], ['fgDim', 'surface'], ['amber', 'surface'],
    ];
    for (const [fg, bg] of pairs) expect(contrast(COLORS[fg], COLORS[bg]), `${fg} on ${bg}`).toBeGreaterThanOrEqual(7);
  });

  it('matches the documented ratios', () => {
    expect(contrast(COLORS.red, COLORS.bg)).toBeCloseTo(5.92, 1);
    expect(contrast(COLORS.green, COLORS.bg)).toBeCloseTo(10.39, 1);
    expect(contrast(COLORS.estimated, COLORS.bg)).toBeCloseTo(6.25, 1);
  });

  it('renders CSS custom properties once', () => {
    const css = tokensCss();
    expect(css.startsWith(':root{')).toBe(true);
    expect(css).toContain('--fg-dim:#B3B3B3;');
    expect(css).toContain('--msg-bg:#0A3D91;');
    expect(css).toContain("--font:'Inter',");
    installTokens(document);
    installTokens(document);
    const styles = document.head.querySelectorAll('style[data-olc-tokens]');
    expect(styles).toHaveLength(1);
    expect(styles[0]!.textContent).toBe(css);
  });
});

describe('offline assets (NF2)', () => {
  it('no source file or page references a remote URL', () => {
    const root = join(__dirname, '..', '..');
    const files = [
      ...readdirSync(join(root, 'src'), { recursive: true, encoding: 'utf8' }).map((f) => join(root, 'src', f)),
      ...['presenter', 'dock', 'control'].map((p) => join(root, p, 'index.html')),
    ].filter((f) => /\.(tsx?|css|html)$/.test(f));
    expect(files.length).toBeGreaterThan(5);
    for (const file of files) expect(readFileSync(file, 'utf8'), file).not.toMatch(/https?:\/\//);
  });
});
```

`web/test/fixtures.test.ts`:
```ts
// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import { ControlView, PresenterView } from '@olc/shared';
import { breakView, controlView, endedView, mediaView, preshowView, studioView } from './support/views';

describe('test fixtures are valid views', () => {
  it.each([
    ['studio', studioView()],
    ['preshow', preshowView()],
    ['media', mediaView()],
    ['break', breakView()],
    ['ended', endedView()],
  ])('%s', (_label, view) => expect(PresenterView.parse(view)).toEqual(view));

  it('control', () => {
    const v = controlView();
    expect(ControlView.parse(v)).toEqual(v);
    expect(v.rows).toHaveLength(8);
  });
});
```

- [ ] **Step 2: Run it and verify it fails**

Run: `pnpm vitest run web`. Expected: FAIL. The `web` project and its modules do not exist yet.

- [ ] **Step 3: Implement**

`pnpm-workspace.yaml`: add `  - web` under `packages`.

`server/package.json`: add `"exports": { "./app/server": "./src/app/server.ts" }`. Nothing imports `@olc/server` today. This lets the web integration test import `buildServer`.

`vitest.config.ts`:
```ts
// SPDX-License-Identifier: GPL-2.0-or-later
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'node',
          environment: 'node',
          include: ['shared/test/**/*.test.ts', 'server/test/**/*.test.ts', 'tools/**/test/**/*.test.ts'],
        },
      },
      {
        // React 19 automatic JSX runtime; components and hooks run under jsdom. A test file can opt out with
        // `// @vitest-environment node` on its second line (the integration test does: jsdom breaks real sockets).
        esbuild: { jsx: 'automatic' },
        test: {
          name: 'web',
          environment: 'jsdom',
          include: ['web/test/**/*.test.{ts,tsx}'],
          setupFiles: ['web/test/setup.ts'],
        },
      },
    ],
  },
});
```

`web/package.json`:
```json
{
  "name": "@olc/web",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "license": "GPL-2.0-or-later",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "typecheck": "tsc -p tsconfig.json"
  },
  "dependencies": {
    "@fontsource/inter": "5.3.0",
    "@olc/shared": "workspace:*",
    "react": "^19.3.0",
    "react-dom": "^19.3.0",
    "zod": "^4.1.0"
  },
  "devDependencies": {
    "@olc/obs-sim": "workspace:*",
    "@olc/server": "workspace:*",
    "@testing-library/dom": "^10.4.2",
    "@testing-library/react": "^16.3.3",
    "@types/react": "^19.3.0",
    "@types/react-dom": "^19.3.0",
    "@vitejs/plugin-react": "^5.2.0",
    "vite": "~7.3.7"
  }
}
```

`web/tsconfig.json`:
```json
{
  "extends": "../tsconfig.base.json",
  "compilerOptions": {
    "lib": ["ES2023", "DOM", "DOM.Iterable"],
    "jsx": "react-jsx",
    "types": ["node", "vite/client"]
  },
  "include": ["src", "test", "vite.config.ts"]
}
```

`web/vite.config.ts`:
```ts
// SPDX-License-Identifier: GPL-2.0-or-later
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

const root = fileURLToPath(new URL('.', import.meta.url));
const PAGES = ['presenter', 'dock', 'control'] as const;
const SERVER = process.env.OLC_SERVER ?? 'http://127.0.0.1:4460';

/** Dev only: answer /presenter like /presenter/ (Vite's MPA fallback needs the slash; the real server serves both). */
function pageWithoutSlash(): Plugin {
  return {
    name: 'olc-page-without-slash',
    configureServer(server) {
      server.middlewares.use((req, _res, next) => {
        const m = req.url === undefined ? null : /^\/(presenter|dock|control)(\?.*)?$/.exec(req.url);
        if (m !== null) req.url = `/${m[1]}/${m[2] ?? ''}`;
        next();
      });
    },
  };
}

export default defineConfig({
  root,
  appType: 'mpa',
  plugins: [react(), pageWithoutSlash()],
  build: {
    outDir: resolve(root, 'dist'),
    emptyOutDir: true,
    // OBS 30 docks run CEF 103 (Chromium 103): keep the output parseable there.
    target: ['chrome103', 'edge103', 'firefox115', 'safari16'],
    rollupOptions: { input: Object.fromEntries(PAGES.map((p) => [p, resolve(root, p, 'index.html')])) },
  },
  server: {
    port: 5173,
    strictPort: true,
    // The dev pages talk to the real server; the Host/Origin guard accepts localhost.
    proxy: {
      '/api': SERVER,
      '/ws': { target: SERVER.replace(/^http/, 'ws'), ws: true },
    },
  },
});
```
The `SERVER` default is the only `http://` literal in `web`. It lives in `vite.config.ts`, outside `src`, so the offline test does not scan it.

Each HTML entry (replace `presenter` and `Presenter` per page, and keep the indentation):
```html
<!doctype html>
<!-- SPDX-License-Identifier: GPL-2.0-or-later -->
<html lang="it">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>OBS Live Clock · Presenter</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/presenter/main.tsx"></script>
  </body>
</html>
```
The titles are `Presenter`, `Dock` and `Control`.

Each placeholder `web/src/<page>/main.tsx`:
```tsx
// SPDX-License-Identifier: GPL-2.0-or-later
import { createRoot } from 'react-dom/client';
import '../ui/fonts';
import '../ui/base.css';
import { installTokens } from '../ui/tokens';

installTokens();
createRoot(document.getElementById('root')!).render(<p>OBS Live Clock</p>);
```

`web/src/ui/fonts.ts`:
```ts
// SPDX-License-Identifier: GPL-2.0-or-later
// Bundled locally (NF2): Vite copies the font files into dist/assets. The Latin subset covers Italian and
// includes tabular figures (tnum) and U+2212 MINUS SIGN; other symbols (⚠ ● ✓) fall back to system fonts.
import '@fontsource/inter/latin-400.css';
import '@fontsource/inter/latin-700.css';
```

`web/src/ui/tokens.ts`:
```ts
// SPDX-License-Identifier: GPL-2.0-or-later

/**
 * Colour tokens (SPEC §7: black background, colour only as tally). Contrast on black, WCAG 2.x:
 * fg 21, fgDim 10.0, fgOff 4.9, estimated/stale 6.3, amber 11.5, red 5.9, green 10.4; fg on msgBg 10.1;
 * on surface: fg 18.4, fgDim 8.8, amber 10.1. Checked by web/test/ui/tokens.test.ts.
 */
export const COLORS = {
  bg: '#000000',
  surface: '#141414',
  fg: '#FFFFFF',
  fgDim: '#B3B3B3',
  fgOff: '#7A7A7A',
  estimated: '#8C8C8C',
  stale: '#8C8C8C',
  amber: '#FFB000',
  red: '#FF3B30',
  green: '#30D158',
  msgBg: '#0A3D91',
  tileBorder: '#3A3A3A',
} as const;

export const FONT_STACK = "'Inter', system-ui, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif";

/** `fgDim` → `--fg-dim`. */
export function cssVarName(key: string): string {
  return `--${key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`;
}

export function tokensCss(): string {
  const vars = Object.entries(COLORS).map(([k, v]) => `${cssVarName(k)}:${v};`).join('');
  return `:root{${vars}--font:${FONT_STACK};}`;
}

/** Installs the tokens once per document. */
export function installTokens(doc: Document = document): void {
  if (doc.head.querySelector('style[data-olc-tokens]') !== null) return;
  const style = doc.createElement('style');
  style.dataset.olcTokens = '';
  style.textContent = tokensCss();
  doc.head.append(style);
}
```

`web/src/ui/base.css`:
```css
/* SPDX-License-Identifier: GPL-2.0-or-later */
*, *::before, *::after { box-sizing: border-box; }
html, body { margin: 0; height: 100%; }
body {
  background: var(--bg);
  color: var(--fg);
  font-family: var(--font);
  font-variant-numeric: tabular-nums;
  -webkit-font-smoothing: antialiased;
}
#root { height: 100%; }
a { color: var(--fg); }
button {
  font: inherit; color: var(--fg); background: var(--surface);
  border: 1px solid var(--tile-border); border-radius: 6px; padding: 6px 10px; min-height: 36px; cursor: pointer;
}
button:disabled { opacity: 0.45; cursor: not-allowed; }
button:focus-visible, a:focus-visible, input:focus-visible, summary:focus-visible { outline: 2px solid var(--amber); outline-offset: 2px; }
.badge {
  display: inline-block; font-size: 0.6em; font-weight: 700; letter-spacing: 0.06em; padding: 0.1em 0.4em;
  border: 0.12em solid currentColor; border-radius: 0.3em; vertical-align: middle; white-space: nowrap; margin-left: 0.4em;
}
.badge-estimated { color: var(--estimated); }
.badge-planned, .badge-paused { color: var(--fg-dim); }
.label-text { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.counter { font-weight: 700; line-height: 1; white-space: nowrap; font-variant-numeric: tabular-nums; }
.counter[data-source='estimated'] { color: var(--estimated); }
.counter[data-stale='true'] { color: var(--stale) !important; }
.overlay-full {
  position: fixed; inset: 0; z-index: 10; display: flex; align-items: center; justify-content: center;
  background: var(--bg); color: var(--fg-dim); font-weight: 700; font-size: 2rem; letter-spacing: 0.08em;
}
.overlay-stale {
  position: fixed; top: 8px; left: 50%; transform: translateX(-50%); z-index: 10;
  background: var(--bg); color: var(--amber); border: 2px solid var(--amber); border-radius: 6px;
  padding: 4px 16px; font-weight: 700;
}
.progress { height: 0.8vh; min-height: 4px; background: var(--tile-border); border-radius: 999px; overflow: hidden; }
.progress-fill { height: 100%; background: var(--fg-dim); transform-origin: left center; }
```

`web/test/setup.ts`:
```ts
// SPDX-License-Identifier: GPL-2.0-or-later
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

afterEach(() => cleanup());
```

`web/test/support/views.ts`:
```ts
// SPDX-License-Identifier: GPL-2.0-or-later
import type { ControlView, PresenterView, RundownRow } from '@olc/shared';

/** Server wall time used by every web test: 2026-09-21 14:13:20 UTC (tests render with timeZone 'UTC'). */
export const WALL = 1_790_000_000_000;
/** Program start of the control fixture: 13:56:40 UTC. */
const T0W = WALL - 1_000_000;

/** Live in studio, block 3 "Secondo blocco" with 8:42 left, program end in 41:18 at 14:54:38 (SPEC §7 wireframe). */
export function studioView(over: Partial<PresenterView> = {}): PresenterView {
  return {
    phase: 'live',
    segment: 'studio',
    rundownFinished: false,
    block: { index: 2, name: 'Secondo blocco', anchor: { kind: 'countdown', endsAt: WALL + 522_000, source: 'measured' } },
    onAir: null,
    returnTo: null,
    next: { title: 'Servizio 2', durationMs: 120_000, source: 'measured' },
    programEnd: { anchor: { kind: 'countdown', endsAt: WALL + 2_478_000, source: 'planned' }, endsAtWall: WALL + 2_478_000 },
    delay: { ms: 42_000, source: 'measured' },
    thresholds: { warnMs: 60_000, returnImminentMs: 10_000 },
    message: null,
    status: { rec: true, stream: false, recPaused: false, obs: 'ok', control: 'auto' },
    preshow: null,
    ended: null,
    ...over,
  };
}

/** PRE-SHOW, planned start in 10:00 (14:23:20 UTC). */
export function preshowView(over: Partial<PresenterView> = {}): PresenterView {
  return studioView({
    phase: 'preshow',
    segment: null,
    block: null,
    next: { title: 'Servizio 1', durationMs: 180_000, source: 'planned' },
    programEnd: null,
    delay: null,
    status: { rec: false, stream: false, recPaused: false, obs: 'ok', control: 'auto' },
    preshow: {
      plannedStart: new Date(WALL + 600_000).toISOString(),
      totalDurationMs: 1_620_000,
      upcoming: ['Primo blocco', 'Servizio 1', 'Break 1', 'Secondo blocco'],
    },
    ...over,
  });
}

/** Servizio 1 on air, back to "Primo blocco" in 1:42. `block` stays set, as the server sends it (BACKLOG). */
export function mediaView(over: Partial<PresenterView> = {}): PresenterView {
  return studioView({
    segment: 'media',
    block: { index: 0, name: 'Primo blocco', anchor: { kind: 'countdown', endsAt: WALL + 400_000, source: 'measured' } },
    onAir: {
      title: 'Servizio 1',
      anchor: { kind: 'countdown', endsAt: WALL + 102_000, source: 'measured' },
      startedAtWall: WALL - 83_000,
      durationMs: 185_000,
    },
    returnTo: { blockName: 'Primo blocco', anchor: { kind: 'countdown', endsAt: WALL + 102_000, source: 'measured' } },
    next: { title: 'Break 1', durationMs: 180_000, source: 'planned' },
    ...over,
  });
}

/** Break 1 on air (filler playing), back to "Secondo blocco" in 2:00. */
export function breakView(over: Partial<PresenterView> = {}): PresenterView {
  return studioView({
    segment: 'break',
    block: { index: 1, name: 'Break 1', anchor: { kind: 'countdown', endsAt: WALL + 120_000, source: 'measured' } },
    onAir: {
      title: 'Break 1',
      anchor: { kind: 'countdown', endsAt: WALL + 120_000, source: 'measured' },
      startedAtWall: WALL - 60_000,
      durationMs: 180_000,
    },
    returnTo: { blockName: 'Secondo blocco', anchor: { kind: 'countdown', endsAt: WALL + 120_000, source: 'measured' } },
    next: { title: 'Servizio 2', durationMs: 120_000, source: 'measured' },
    ...over,
  });
}

/** FINE: 27:12 of program, 12 s over the plan. */
export function endedView(over: Partial<PresenterView> = {}): PresenterView {
  return studioView({
    phase: 'ended',
    delay: { ms: 12_000, source: 'measured' },
    status: { rec: false, stream: false, recPaused: false, obs: 'ok', control: 'auto' },
    ended: { totalMs: 1_632_000, finalOffsetMs: 12_000, source: 'measured' },
    ...over,
  });
}

function row(over: Partial<RundownRow> & Pick<RundownRow, 'slot' | 'blockIndex' | 'blockName' | 'kind' | 'title'>): RundownRow {
  return {
    status: 'pending',
    provisional: false,
    durationMs: null,
    durationSource: 'planned',
    plannedStartAtWall: null,
    startedAtWall: null,
    endedAtWall: null,
    ...over,
  };
}

/** The Solo Futsal rundown (8 slots), live in "Secondo blocco" (slot 4). */
export function controlView(over: Partial<ControlView> = {}): ControlView {
  return {
    episode: { id: 'ep-2026-10-12', name: 'Solo Futsal · 12/10/2026' },
    presenter: studioView(),
    control: 'auto',
    obs: 'ok',
    ambiguous: false,
    cursor: 4,
    returnSlot: null,
    offScript: null,
    decisions: [],
    rows: [
      row({ slot: 0, blockIndex: 0, blockName: 'Primo blocco', kind: 'studio', title: 'Primo blocco', status: 'done', plannedStartAtWall: T0W, startedAtWall: T0W, endedAtWall: T0W + 60_000 }),
      row({ slot: 1, blockIndex: 0, blockName: 'Primo blocco', kind: 'media', title: 'Servizio 1', status: 'done', durationMs: 185_000, durationSource: 'measured', plannedStartAtWall: T0W, startedAtWall: T0W + 60_000, endedAtWall: T0W + 245_000 }),
      row({ slot: 2, blockIndex: 0, blockName: 'Primo blocco', kind: 'studio', title: 'Primo blocco', status: 'done', plannedStartAtWall: T0W, startedAtWall: T0W + 245_000, endedAtWall: T0W + 700_000 }),
      row({ slot: 3, blockIndex: 1, blockName: 'Break 1', kind: 'break', title: 'Break 1', status: 'done', durationMs: 180_000, plannedStartAtWall: T0W + 720_000, startedAtWall: T0W + 700_000, endedAtWall: T0W + 880_000 }),
      row({ slot: 4, blockIndex: 2, blockName: 'Secondo blocco', kind: 'studio', title: 'Secondo blocco', status: 'onair', plannedStartAtWall: T0W + 900_000, startedAtWall: T0W + 880_000 }),
      row({ slot: 5, blockIndex: 2, blockName: 'Secondo blocco', kind: 'media', title: 'Servizio 2', durationMs: 120_000, durationSource: 'measured', plannedStartAtWall: T0W + 900_000 }),
      row({ slot: 6, blockIndex: 2, blockName: 'Secondo blocco', kind: 'studio', title: 'Secondo blocco', plannedStartAtWall: T0W + 900_000 }),
      row({ slot: 7, blockIndex: 3, blockName: 'Chiusura', kind: 'studio', title: 'Chiusura', plannedStartAtWall: T0W + 1_500_000 }),
    ],
    presets: {
      messages: [
        { id: 'stringi', text: 'STRINGI', dismiss: { kind: 'timeout', ms: 10_000 } },
        { id: 'cam2', text: 'GUARDA CAM 2', dismiss: { kind: 'manual' } },
      ],
      adjustStepMs: 30_000,
    },
    ...over,
  };
}
```
Wall times in UTC, for later tests:

| Value | Time |
|---|---|
| `T0W` | 13:56:40 |
| break planned start | 14:08:40 |
| `Secondo blocco` planned start | 14:11:40 |
| `Secondo blocco` real start | 14:11:20 |
| `Chiusura` planned start | 14:21:40 |
| `WALL` | 14:13:20 |

- [ ] **Step 4: Run it and verify it passes; verify the build**

Run: `pnpm install && pnpm test && pnpm typecheck`. Expected: PASS.

Run: `pnpm --filter @olc/web build`. Expected: `web/dist/presenter/index.html`, `web/dist/dock/index.html`, `web/dist/control/index.html` and `web/dist/assets/inter-latin-700-normal-*.woff2` exist. `dist/` is already git-ignored.

- [ ] **Step 5: Commit**

```bash
git add pnpm-workspace.yaml package.json pnpm-lock.yaml vitest.config.ts server/package.json web
git commit -m "feat(web): vite multi-page workspace with jsdom tests, colour tokens, bundled fonts and view fixtures"
```

---

### Task 5: Core maths — time formatting, stable ticks, anchored frames, view parsing

**Files:**
- Create:
  - `web/src/core/views.ts`, `web/src/core/time-format.ts`, `web/src/core/stable-ticks.ts`, `web/src/core/anchor.ts`;
  - `web/test/core/time-format.test.ts`, `web/test/core/anchor.test.ts`, `web/test/core/views.test.ts`.

**Interfaces:**
- Produces:
  - `views.ts`: `ViewFor<R>`, `parseView(role, raw)`, and type re-exports `Anchor`, `Source`, `PresenterView`, `ControlView`, `RundownRow`, `ControlDecision`;
  - `time-format.ts`: `MINUS`, `ticksOf`, `clockText`, `tickText`, `durationText`, `signedText`, `wallText`;
  - `stable-ticks.ts`: `TICK_HYSTERESIS_MS`, `stableTicks`;
  - `anchor.ts`: `STALE_BLANK_MS`, `UNKNOWN_TEXT`, `AnchorFrame`, `remainingAt`, `anchorFrame`.

**The display rule** (one rule everywhere):
- A remaining time `r` shows as the tick `k = ceil(r / 1000)`, with `-0` normalised to `0`.
- `k > 0` shows as a countdown `m:ss` (or `h:mm:ss`). `k ≤ 0` shows as the overrun counting up, `+m:ss`.
- So `0:01` covers `(0, 1 s]`, `+0:00` covers `(-1 s, 0]`, and `+0:01` covers `(-2 s, -1 s]`. Every tick lasts exactly one second and changes exactly on the boundary.
- Tallies and modes are computed from the **displayed** ticks (Task 9), never from raw milliseconds, so colour and text always agree.

- [ ] **Step 1: Write the failing tests**

`web/test/core/time-format.test.ts`:
```ts
// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import { stableTicks } from '../../src/core/stable-ticks';
import { MINUS, clockText, durationText, signedText, tickText, ticksOf, wallText } from '../../src/core/time-format';
import { WALL } from '../support/views';

describe('ticksOf / tickText', () => {
  it('ceil-rounds to whole seconds, zero and below being the overrun', () => {
    expect([10_000, 9_001, 9_000, 1, 0, -1, -999, -1_000, -1_001, -2_000].map(ticksOf)).toEqual([10, 10, 9, 1, 0, 0, 0, -1, -1, -2]);
    expect(Object.is(ticksOf(-1), 0)).toBe(true);
  });

  it('formats countdowns, overruns and hours', () => {
    expect(tickText(522)).toBe('8:42');
    expect(tickText(59)).toBe('0:59');
    expect(tickText(0)).toBe('+0:00');
    expect(tickText(-72)).toBe('+1:12');
    expect(tickText(3_600)).toBe('1:00:00');
    expect(tickText(-3_725)).toBe('+1:02:05');
    expect(clockText(0)).toBe('0:00');
  });
});

describe('durationText / signedText / wallText', () => {
  it('rounds plain durations to the nearest second', () => {
    expect(durationText(184_000)).toBe('3:04');
    expect(durationText(184_499)).toBe('3:04');
    expect(durationText(184_500)).toBe('3:05');
    expect(durationText(-5)).toBe('0:00');
    expect(durationText(7_200_000)).toBe('2:00:00');
  });

  it('signs offsets with + and U+2212', () => {
    expect(signedText(42_000)).toBe('+0:42');
    expect(signedText(-15_000)).toBe(`${MINUS}0:15`);
    expect(signedText(400)).toBe('0:00');
    expect(signedText(-400)).toBe('0:00');
    expect(signedText(61_000)).toBe('+1:01');
  });

  it('formats wall time as 24-hour HH:MM:SS', () => {
    expect(wallText(WALL, 'UTC')).toBe('14:13:20');
    expect(wallText(Date.UTC(2026, 9, 12, 17, 58, 40), 'UTC')).toBe('17:58:40');
    expect(wallText(Date.UTC(2026, 9, 12, 0, 0, 5), 'UTC')).toBe('00:00:05');
  });
});

describe('stableTicks', () => {
  it('follows a normal countdown exactly on the second boundary', () => {
    let prev: number | null = null;
    const shown = [41_999, 41_001, 41_000, 40_999, 40_000].map((r) => (prev = stableTicks(prev, r)));
    expect(shown).toEqual([42, 42, 41, 41, 40]);
  });

  it('holds a one-tick step back while it is within 250 ms of the boundary', () => {
    expect(stableTicks(41, 41_100)).toBe(41);
    expect(stableTicks(41, 41_250)).toBe(41);
    expect(stableTicks(41, 41_251)).toBe(42);
    expect(stableTicks(0, 200)).toBe(0);
    expect(stableTicks(0, 300)).toBe(1);
  });

  it('shows bigger jumps at once, in either direction', () => {
    expect(stableTicks(41, 72_000)).toBe(72);
    expect(stableTicks(41, 10_000)).toBe(10);
    expect(stableTicks(null, 41_100)).toBe(42);
  });

  it('jitter around a boundary never flickers', () => {
    let prev: number | null = 42;
    const shown = [41_050, 40_990, 41_120, 40_950, 41_200, 40_900].map((r) => (prev = stableTicks(prev, r)));
    expect(shown).toEqual([42, 41, 41, 41, 41, 41]);
  });
});
```

`web/test/core/anchor.test.ts`:
```ts
// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import { STALE_BLANK_MS, anchorFrame, remainingAt } from '../../src/core/anchor';
import type { Anchor, Source } from '../../src/core/views';
import { WALL } from '../support/views';

const cd = (endsAt: number, source: Source = 'measured'): Anchor => ({ kind: 'countdown', endsAt, source });

describe('remainingAt', () => {
  it('is signed for countdowns, constant for frozen values, null for unknown', () => {
    expect(remainingAt(cd(WALL + 5_000), WALL)).toBe(5_000);
    expect(remainingAt(cd(WALL - 5_000), WALL)).toBe(-5_000);
    expect(remainingAt({ kind: 'frozen', valueMs: 7_000, source: 'measured' }, WALL + 99_000)).toBe(7_000);
    expect(remainingAt({ kind: 'unknown' }, WALL)).toBeNull();
  });
});

describe('anchorFrame', () => {
  it('counts down from the anchor at server time', () => {
    expect(anchorFrame(cd(WALL + 522_000), WALL, null, null)).toEqual({
      text: '8:42', ticks: 522, remainingMs: 522_000, source: 'measured', paused: false, stale: false,
    });
    expect(anchorFrame(cd(WALL - 72_000, 'estimated'), WALL, null, null)).toMatchObject({ text: '+1:12', ticks: -72, source: 'estimated' });
  });

  it('shows a frozen anchor as a paused value that does not move', () => {
    const a: Anchor = { kind: 'frozen', valueMs: 300_000, source: 'measured' };
    expect(anchorFrame(a, WALL, null, null)).toMatchObject({ text: '5:00', paused: true });
    expect(anchorFrame(a, WALL + 60_000, null, 300).text).toBe('5:00');
  });

  it('shows "—" for unknown and missing anchors', () => {
    expect(anchorFrame({ kind: 'unknown' }, WALL, null, null)).toEqual({
      text: '—', ticks: null, remainingMs: null, source: null, paused: false, stale: false,
    });
    expect(anchorFrame(null, WALL, null, null).text).toBe('—');
  });

  it('freezes at the stale instant instead of counting on, then blanks after 10 s', () => {
    const a = cd(WALL + 60_000);
    expect(anchorFrame(a, WALL + 5_000, WALL, null)).toMatchObject({ text: '1:00', stale: true });
    expect(anchorFrame(a, WALL + STALE_BLANK_MS, WALL, null).text).toBe('1:00');
    expect(anchorFrame(a, WALL + STALE_BLANK_MS + 1, WALL, null)).toMatchObject({ text: '—', ticks: null, stale: true, source: 'measured' });
    expect(anchorFrame(a, WALL, Number.NEGATIVE_INFINITY, null).text).toBe('—');
  });

  it('applies the hysteresis through the previous ticks', () => {
    expect(anchorFrame(cd(WALL + 41_100), WALL, null, 41).text).toBe('0:41');
    expect(anchorFrame(cd(WALL + 41_100), WALL, null, null).text).toBe('0:42');
  });
});
```

`web/test/core/views.test.ts`:
```ts
// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import { parseView } from '../../src/core/views';
import { controlView, studioView } from '../support/views';

describe('parseView', () => {
  it('accepts a valid view for the role, and null (no episode loaded)', () => {
    expect(parseView('presenter', studioView())).toEqual({ ok: true, view: studioView() });
    expect(parseView('control', controlView())).toEqual({ ok: true, view: controlView() });
    expect(parseView('presenter', null)).toEqual({ ok: true, view: null });
  });

  it('rejects a view of the wrong shape', () => {
    expect(parseView('presenter', { phase: 'bogus' }).ok).toBe(false);
    expect(parseView('control', studioView()).ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run them and verify they fail**

Run: `pnpm vitest run web/test/core`. Expected: FAIL, because the modules are missing.

- [ ] **Step 3: Implement**

`web/src/core/views.ts`:
```ts
// SPDX-License-Identifier: GPL-2.0-or-later
import { ControlView, PresenterView, type ClientRole } from '@olc/shared';

export type { Anchor, ControlDecision, ControlView, PresenterView, RundownRow, Source } from '@olc/shared';

export type ViewFor<R extends ClientRole> = R extends 'presenter' ? PresenterView : ControlView;

/** Validates a `view` payload for a role (DT-7: schemas validated on both sides). null = no episode loaded. */
export function parseView<R extends ClientRole>(
  role: R,
  raw: unknown,
): { ok: true; view: ViewFor<R> | null } | { ok: false; error: string } {
  if (raw === null) return { ok: true, view: null };
  const result = role === 'presenter' ? PresenterView.safeParse(raw) : ControlView.safeParse(raw);
  return result.success ? { ok: true, view: result.data as ViewFor<R> } : { ok: false, error: result.error.message };
}
```

`web/src/core/time-format.ts`:
```ts
// SPDX-License-Identifier: GPL-2.0-or-later

/** U+2212 MINUS SIGN: as wide as "+" in tabular figures, unlike "-". */
export const MINUS = '−';

/**
 * The tick a counter displays for a signed remaining time: ceil to whole seconds. 10_000 → 10, 9_001 → 10,
 * 1 → 1, 0 → 0, -999 → 0, -1_000 → -1. Positive ticks count down; zero and negative ticks are the overrun,
 * shown counting up ("+0:00", "+0:01"). Each tick lasts exactly one second and changes on the boundary.
 */
export function ticksOf(remainingMs: number): number {
  const t = Math.ceil(remainingMs / 1000);
  return t === 0 ? 0 : t; // never -0
}

/** "m:ss" under one hour, "h:mm:ss" from one hour. `seconds` is a non-negative integer. */
export function clockText(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const ss = String(seconds % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

/** "8:42" counting down; "+0:00", "+1:12" past zero (SPEC §7 SFORAMENTO, OLTRE SCALETTA). */
export function tickText(ticks: number): string {
  return ticks > 0 ? clockText(ticks) : `+${clockText(-ticks)}`;
}

/** A plain duration, rounded to the nearest second ("3:04"). Durations are never negative. */
export function durationText(ms: number): string {
  return clockText(Math.max(0, Math.round(ms / 1000)));
}

/** A signed offset (delay, final offset) rounded to the nearest second: "+0:42", "−0:15", "0:00". */
export function signedText(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s === 0) return '0:00';
  return `${s > 0 ? '+' : MINUS}${clockText(Math.abs(s))}`;
}

const wallFormats = new Map<string, Intl.DateTimeFormat>();

/** "19:58:40", 24-hour. `timeZone` is for tests; the browser's own zone is used otherwise. */
export function wallText(wallMs: number, timeZone?: string): string {
  const key = timeZone ?? '';
  let format = wallFormats.get(key);
  if (format === undefined) {
    format = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23', timeZone });
    wallFormats.set(key, format);
  }
  return format.format(wallMs);
}
```

`web/src/core/stable-ticks.ts`:
```ts
// SPDX-License-Identifier: GPL-2.0-or-later
import { ticksOf } from './time-format';

/** How far past a boundary a one-tick step backwards must go before the display accepts it. */
export const TICK_HYSTERESIS_MS = 250;

/**
 * Ticks to display for `remainingMs`, given the ticks shown on the previous frame (null on the first one).
 * Countdowns only move forward in time, so a one-tick step back (shown 41, now 42) is almost always jitter: an
 * endsAt re-anchored by a deck update, or a new clock sample, a few ms across the boundary. Such a step is held
 * until it is more than TICK_HYSTERESIS_MS past the boundary; every other change is shown at once.
 */
export function stableTicks(prev: number | null, remainingMs: number): number {
  const next = ticksOf(remainingMs);
  if (prev === null || next !== prev + 1) return next;
  // next === prev + 1 means remainingMs > prev * 1000: hold until it is clearly past that boundary.
  return remainingMs - prev * 1000 > TICK_HYSTERESIS_MS ? next : prev;
}
```

`web/src/core/anchor.ts`:
```ts
// SPDX-License-Identifier: GPL-2.0-or-later
import { stableTicks } from './stable-ticks';
import { tickText } from './time-format';
import type { Anchor, Source } from './views';

/** After this long stale, a frozen counter gives up and shows "—". */
export const STALE_BLANK_MS = 10_000;
export const UNKNOWN_TEXT = '—';

export interface AnchorFrame {
  text: string;
  /** Displayed tick; null when the text is "—". */
  ticks: number | null;
  remainingMs: number | null;
  /** null for an unknown or missing anchor. */
  source: Source | null;
  /** A frozen anchor: media paused or REC pause (shown with "PAUSA"). */
  paused: boolean;
  stale: boolean;
}

/** Signed remaining time of an anchor at server time `now`; null when unknown. */
export function remainingAt(anchor: Anchor, now: number): number | null {
  switch (anchor.kind) {
    case 'countdown':
      return anchor.endsAt - now;
    case 'frozen':
      return anchor.valueMs;
    case 'unknown':
      return null;
  }
}

/**
 * What a counter shows at server time `now`. `staleSince` is the server time at which the data went stale (null
 * while fresh; -Infinity when it went stale before the clock was synced). Stale counters freeze at that instant,
 * never counting on as if fresh, and show "—" once STALE_BLANK_MS have passed.
 */
export function anchorFrame(anchor: Anchor | null, now: number, staleSince: number | null, prevTicks: number | null): AnchorFrame {
  const stale = staleSince !== null;
  if (anchor === null || anchor.kind === 'unknown' || (staleSince !== null && now - staleSince > STALE_BLANK_MS)) {
    const source = anchor !== null && anchor.kind !== 'unknown' ? anchor.source : null;
    return { text: UNKNOWN_TEXT, ticks: null, remainingMs: null, source, paused: false, stale };
  }
  const remainingMs = remainingAt(anchor, staleSince ?? now)!;
  const ticks = stableTicks(prevTicks, remainingMs);
  return { text: tickText(ticks), ticks, remainingMs, source: anchor.source, paused: anchor.kind === 'frozen', stale };
}
```

- [ ] **Step 4: Run them and verify they pass**

Run: `pnpm test && pnpm typecheck`. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/core web/test/core
git commit -m "feat(web): anchored-time maths with second-boundary hysteresis, stale freezing and view validation"
```

---

### Task 6: Clock sync, reconnect backoff, i18n and page parameters

**Files:**
- Create:
  - `web/src/core/clock-sync.ts`, `web/src/core/backoff.ts`, `web/src/core/i18n.ts`, `web/src/core/params.ts`;
  - `web/test/core/clock-sync.test.ts`, `web/test/core/i18n.test.ts`.

**Interfaces:**
- Produces:
  - `clock-sync.ts`: `CLOCK_WINDOW`, `MAX_SAMPLE_RTT_MS`, `ClockSample`, `class ClockSync`, with:
    - `addPong(t0, serverWall): boolean`;
    - `synced`;
    - `sample`;
    - `now()`;
    - `reset()`.
  - `backoff.ts`: `RECONNECT_BASE_MS`, `RECONNECT_MAX_MS`, `reconnectDelay(failures, random)`.
  - `i18n.ts`: `Lang`, `LANGS`, `MessageKey`, `IT`, `EN`, `Translate`, `createT(lang)`.
  - `params.ts`: `PageParams`, `parseParams(search)`.

**Rules (DT-7):**
- **Clock samples.** A sample is a `time.ping`/`time.pong` round trip measured on the local **monotonic** clock (`performance.timeOrigin + performance.now()`, injected):
  - `rtt = t1 − t0`;
  - `offset = serverWall − (t0 + t1) / 2`.
- **Estimate.** It is the offset of the **minimum-RTT** sample among the last 8. Ties go to the newest.
- **Rejected samples.** Samples with a negative, non-finite, or longer-than-10 s RTT are ignored.
- **Parameters.** `?lang=` accepts `it` and `en` (default `it`). `?screen=` is an opaque label matching `^[A-Za-z0-9_-]{1,32}$`, anything else gives `null`. It only goes into the document title, so that Plan 6's kiosk watchdog can tell windows apart.

- [ ] **Step 1: Write the failing tests**

`web/test/core/clock-sync.test.ts`:
```ts
// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import { RECONNECT_MAX_MS, reconnectDelay } from '../../src/core/backoff';
import { ClockSync } from '../../src/core/clock-sync';
import { parseParams } from '../../src/core/params';

function harness() {
  let now = 0;
  const clock = new ClockSync(() => now);
  /** A round trip starting at local t0 that took `rtt`, against a server `offset` ms ahead. */
  const pong = (t0: number, rtt: number, offset: number) => {
    now = t0 + rtt;
    return clock.addPong(t0, t0 + rtt / 2 + offset);
  };
  return { clock, pong, setNow: (v: number) => { now = v; } };
}

describe('ClockSync', () => {
  it('estimates the offset from the midpoint of the round trip', () => {
    const { clock, setNow } = harness();
    expect(clock.synced).toBe(false);
    expect(clock.sample).toBeNull();
    expect(() => clock.now()).toThrow();
    setNow(1_100);
    expect(clock.addPong(1_000, 9_000_050)).toBe(true);
    expect(clock.sample).toEqual({ offsetMs: 8_999_000, rttMs: 100 });
    setNow(2_000);
    expect(clock.now()).toBe(9_001_000);
  });

  it('keeps the minimum-RTT sample among the last 8', () => {
    const { clock, pong } = harness();
    pong(0, 30, 100);
    pong(1_000, 10, 200);
    pong(2_000, 50, 300);
    expect(clock.sample).toEqual({ offsetMs: 200, rttMs: 10 });
    for (let i = 0; i < 7; i++) pong(3_000 + i * 1_000, 40, 400); // pushes the 10 ms sample out of the window
    expect(clock.sample).toEqual({ offsetMs: 400, rttMs: 40 });
  });

  it('prefers the newest of equally fast samples', () => {
    const { clock, pong } = harness();
    pong(0, 20, 100);
    pong(1_000, 20, 150);
    expect(clock.sample?.offsetMs).toBe(150);
  });

  it('ignores impossible or useless round trips', () => {
    const { clock, setNow } = harness();
    setNow(500);
    expect(clock.addPong(1_000, 5)).toBe(false); // pong before ping
    setNow(20_000);
    expect(clock.addPong(1_000, 5)).toBe(false); // 19 s round trip
    setNow(1_000);
    expect(clock.addPong(Number.NaN, 5)).toBe(false);
    expect(clock.addPong(1_000, Number.POSITIVE_INFINITY)).toBe(false);
    expect(clock.synced).toBe(false);
  });

  it('reset forgets every sample', () => {
    const { clock, pong } = harness();
    pong(0, 10, 100);
    clock.reset();
    expect(clock.synced).toBe(false);
    pong(1_000, 50, 300);
    expect(clock.sample).toEqual({ offsetMs: 300, rttMs: 50 });
  });
});

describe('reconnectDelay', () => {
  it('doubles from 0.5 s up to 5 s', () => {
    expect([0, 1, 2, 3, 4, 10].map((n) => reconnectDelay(n, () => 0.5))).toEqual([500, 1_000, 2_000, 4_000, 5_000, 5_000]);
  });

  it('jitters by ±20 % so clients do not reconnect in lockstep', () => {
    expect(reconnectDelay(0, () => 0)).toBe(400);
    expect(reconnectDelay(0, () => 0.999)).toBe(600);
    expect(reconnectDelay(9, () => 0.999)).toBeLessThanOrEqual(RECONNECT_MAX_MS * 1.2);
  });
});

describe('parseParams', () => {
  it('reads lang and screen, with safe defaults', () => {
    expect(parseParams('?lang=en&screen=tv-1')).toEqual({ lang: 'en', screen: 'tv-1' });
    expect(parseParams('')).toEqual({ lang: 'it', screen: null });
    expect(parseParams('?lang=fr&screen=<script>')).toEqual({ lang: 'it', screen: null });
    expect(parseParams(`?screen=${'a'.repeat(33)}`).screen).toBeNull();
  });
});
```

`web/test/core/i18n.test.ts`:
```ts
// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import { EN, IT, createT, type MessageKey } from '../../src/core/i18n';

const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe('i18n', () => {
  it('has the same keys and placeholders in every language', () => {
    expect(Object.keys(EN).sort()).toEqual(Object.keys(IT).sort());
    for (const key of Object.keys(IT) as MessageKey[]) {
      expect(placeholders(EN[key]), key).toEqual(placeholders(IT[key]));
      expect(IT[key].length, key).toBeGreaterThan(0);
    }
  });

  it('interpolates parameters and leaves missing ones visible', () => {
    const t = createT('it');
    expect(t('block', { n: 2, name: 'Secondo blocco' })).toBe('BLOCCO 2 · Secondo blocco');
    expect(t('returnTo', {})).toBe('RIENTRO: {name}');
    expect(t('reconnecting')).toBe('RICONNESSIONE…');
    expect(createT('en')('obsLost')).toBe('⚠ OBS NOT CONNECTED');
  });
});
```

- [ ] **Step 2: Run them and verify they fail**

Run: `pnpm vitest run web/test/core/clock-sync.test.ts web/test/core/i18n.test.ts`. Expected: FAIL, because the modules are missing.

- [ ] **Step 3: Implement**

`web/src/core/clock-sync.ts`:
```ts
// SPDX-License-Identifier: GPL-2.0-or-later

export const CLOCK_WINDOW = 8;
export const MAX_SAMPLE_RTT_MS = 10_000;

export interface ClockSample {
  offsetMs: number;
  rttMs: number;
}

/**
 * DT-7 server-clock estimate. Each time.ping/pong round trip gives rtt = t1 − t0 and
 * offset = serverWall − (t0 + t1) / 2, with t0/t1 on the local monotonic clock. The estimate is the offset of the
 * minimum-RTT sample among the last CLOCK_WINDOW (the least delayed sample is the least skewed); ties go to the
 * newest. The server is the only source of time (NF4): the client never shows its own wall clock.
 */
export class ClockSync {
  private samples: ClockSample[] = [];
  private best: ClockSample | null = null;

  constructor(private readonly local: () => number) {}

  /** Records a pong received now. Returns false, ignoring it, for an impossible or useless round trip. */
  addPong(t0: number, serverWall: number): boolean {
    const t1 = this.local();
    const rttMs = t1 - t0;
    if (!Number.isFinite(rttMs) || !Number.isFinite(serverWall) || rttMs < 0 || rttMs > MAX_SAMPLE_RTT_MS) return false;
    this.samples.push({ offsetMs: serverWall - (t0 + t1) / 2, rttMs });
    if (this.samples.length > CLOCK_WINDOW) this.samples.shift();
    this.best = this.samples.reduce((a, b) => (b.rttMs <= a.rttMs ? b : a));
    return true;
  }

  get synced(): boolean {
    return this.best !== null;
  }

  /** The sample in use, or null before the first one. */
  get sample(): ClockSample | null {
    return this.best;
  }

  /** Estimated server wall time now. Callers check `synced` first. */
  now(): number {
    if (this.best === null) throw new Error('ClockSync.now() before the first sample');
    return this.local() + this.best.offsetMs;
  }

  reset(): void {
    this.samples = [];
    this.best = null;
  }
}
```

`web/src/core/backoff.ts`:
```ts
// SPDX-License-Identifier: GPL-2.0-or-later

export const RECONNECT_BASE_MS = 500;
export const RECONNECT_MAX_MS = 5_000;

/** Failure n (0-based) waits min(5 s, 0.5 s · 2^n), jittered to [0.8, 1.2) so many clients do not reconnect in lockstep. */
export function reconnectDelay(failures: number, random: () => number): number {
  const base = Math.min(RECONNECT_MAX_MS, RECONNECT_BASE_MS * 2 ** Math.max(0, failures));
  return Math.round(base * (0.8 + 0.4 * random()));
}
```

`web/src/core/params.ts`:
```ts
// SPDX-License-Identifier: GPL-2.0-or-later
import { LANGS, type Lang } from './i18n';

export interface PageParams {
  lang: Lang;
  /** Opaque screen label for the kiosk (Plan 6); only shown in the document title. */
  screen: string | null;
}

export function parseParams(search: string): PageParams {
  const q = new URLSearchParams(search);
  const lang = q.get('lang');
  const screen = q.get('screen');
  return {
    lang: (LANGS as readonly string[]).includes(lang ?? '') ? (lang as Lang) : 'it',
    screen: screen !== null && /^[A-Za-z0-9_-]{1,32}$/.test(screen) ? screen : null,
  };
}
```

`web/src/core/i18n.ts`. This is the complete dictionary for every page; later tasks only use these keys:
```ts
// SPDX-License-Identifier: GPL-2.0-or-later

export const LANGS = ['it', 'en'] as const;
export type Lang = (typeof LANGS)[number];

export const IT = {
  connecting: 'CONNESSIONE…',
  reconnecting: 'RICONNESSIONE…',
  incompatible: 'VERSIONE NON COMPATIBILE · RICARICA',
  noEpisode: 'NESSUNA PUNTATA CARICATA',
  block: 'BLOCCO {n} · {name}',
  blockRemaining: 'TEMPO RIMANENTE BLOCCO',
  returnIn: 'RIENTRO TRA',
  returnTo: 'RIENTRO: {name}',
  returnImminent: 'RIENTRO',
  onAirMedia: 'SERVIZIO · {title}',
  onAirBreak: 'BREAK · {title}',
  next: 'NEXT',
  programEnd: 'FINE PROGRAMMA',
  programStart: 'INIZIO PROGRAMMA',
  plannedAt: 'ORE {time}',
  rundown: 'SCALETTA',
  totalDuration: 'DURATA TOTALE {d}',
  rundownFinished: 'SCALETTA TERMINATA',
  ended: 'FINE',
  endedOffset: 'SCARTO {d}',
  estimated: 'STIMATO',
  planned: 'PIAN.',
  paused: 'PAUSA',
  rec: 'REC',
  onAir: 'ON AIR',
  delay: 'RITARDO',
  obsOk: 'OBS ✓',
  obsLost: '⚠ OBS NON CONNESSO',
  phasePreshow: 'PRE-SHOW',
  phaseLive: 'LIVE',
  phaseOverrun: 'OLTRE SCALETTA',
  phaseEnded: 'FINE',
  segStudio: 'STUDIO',
  segMedia: 'SERVIZIO',
  segBreak: 'BREAK',
  manual: 'MANUALE',
  onAirNow: 'IN ONDA: {title}',
  offScript: 'FUORI SCALETTA: {scene} dalle {time}',
  ambiguous: 'POSIZIONE INCERTA: verificare il rundown',
  obsAuthFailed: 'OBS: AUTENTICAZIONE FALLITA',
  deckAbsent: 'PLAYLIST DECK ASSENTE: nessun servizio misurato',
  deckLegacy: 'PLAYLIST DECK < 1.4.0: modalità ridotta',
  decisionOutputRestart: 'REC/STREAM RIAVVIATI alle {time}',
  decisionAllStopped: 'REC/STREAM FERMATI alle {time}',
  choice_continue: 'Continua',
  choice_new_session: 'Nuova sessione',
  choice_interruption: 'Interruzione',
  choice_end: 'Fine programma',
  messages: 'MESSAGGI',
  freeText: 'Testo libero',
  send: 'INVIA',
  clear: 'CLEAR',
  currentMessage: 'In onda: {text}',
  emergency: 'EMERGENZA',
  startProgram: 'START PROGRAM',
  endProgram: 'END PROGRAM',
  nextCmd: 'NEXT',
  prevCmd: 'PREV',
  setManual: 'MANUALE',
  setAuto: 'AUTO',
  confirmAgain: 'Premi di nuovo per confermare',
  noEffect: 'Nessun effetto',
  commandFailed: 'Comando non riuscito: {code}',
  openExtended: 'Apri vista estesa',
  colSlot: '#',
  colBlock: 'Blocco',
  colItem: 'Elemento',
  colStatus: 'Stato',
  colPlanned: 'Inizio pian.',
  colStart: 'Inizio',
  colEnd: 'Fine',
  colDuration: 'Durata',
  status_pending: 'in attesa',
  status_onair: 'in onda',
  status_done: 'andato',
  status_postponed: 'rimandato',
  status_dropped: 'eliminato',
  provisional: 'provvisorio',
  kind_studio: 'Studio',
  kind_media: 'Servizio',
  kind_break: 'Break',
  goto: 'VAI',
  events: 'EVENTI (questa sessione)',
  episodes: 'PUNTATE',
  load: 'CARICA',
  refresh: 'Aggiorna',
  loadFailed: 'Caricamento non riuscito: {code}',
  liveRunning: "Live in corso: impossibile caricare un'altra puntata",
  noEpisodes: 'Nessuna puntata salvata',
  evLoaded: 'Puntata caricata: {name}',
  evUnloaded: 'Puntata scaricata',
  evPhasePreshow: 'PRE-SHOW',
  evPhaseLive: 'Programma iniziato',
  evPhaseOverrun: 'Scaletta terminata',
  evPhaseEnded: 'Programma finito',
  evSlotPending: '{title}: in attesa',
  evSlotOnair: '{title}: in onda',
  evSlotDone: '{title}: andato',
  evSlotPostponed: '{title}: rimandato',
  evSlotDropped: '{title}: eliminato',
  evSlotProvisional: '{title}: provvisorio (stimato)',
  evMessage: 'Messaggio: {text}',
  evMessageCleared: 'Messaggio rimosso',
  evObsLost: 'OBS non connesso',
  evObsOk: 'OBS connesso',
  evRecStarted: 'REC avviata',
  evRecStopped: 'REC fermata',
  evRecPaused: 'REC in pausa',
  evStreamStarted: 'Streaming avviato',
  evStreamStopped: 'Streaming fermato',
  evControlManual: 'Controllo MANUALE',
  evControlAuto: 'Controllo AUTO',
  evDecisionOutputRestart: 'Decisione: REC/stream riavviati',
  evDecisionAllStopped: 'Decisione: REC/stream fermati',
  evChoseContinue: 'Scelta: continua',
  evChoseNewSession: 'Scelta: nuova sessione',
  evChoseInterruption: 'Scelta: interruzione',
  evChoseEnd: 'Scelta: fine programma',
  evOffScript: 'Fuori scaletta: {scene}',
  evOffScriptEnd: 'Rientrati in scaletta',
  evAmbiguous: 'Posizione incerta',
} as const;

export type MessageKey = keyof typeof IT;

export const EN: Record<MessageKey, string> = {
  connecting: 'CONNECTING…',
  reconnecting: 'RECONNECTING…',
  incompatible: 'INCOMPATIBLE VERSION · RELOAD',
  noEpisode: 'NO EPISODE LOADED',
  block: 'BLOCK {n} · {name}',
  blockRemaining: 'BLOCK TIME LEFT',
  returnIn: 'BACK IN',
  returnTo: 'BACK TO: {name}',
  returnImminent: 'BACK',
  onAirMedia: 'PACKAGE · {title}',
  onAirBreak: 'BREAK · {title}',
  next: 'NEXT',
  programEnd: 'PROGRAM END',
  programStart: 'PROGRAM START',
  plannedAt: 'AT {time}',
  rundown: 'RUNDOWN',
  totalDuration: 'TOTAL DURATION {d}',
  rundownFinished: 'RUNDOWN FINISHED',
  ended: 'END',
  endedOffset: 'OFFSET {d}',
  estimated: 'ESTIMATED',
  planned: 'PLAN.',
  paused: 'PAUSED',
  rec: 'REC',
  onAir: 'ON AIR',
  delay: 'DELAY',
  obsOk: 'OBS ✓',
  obsLost: '⚠ OBS NOT CONNECTED',
  phasePreshow: 'PRE-SHOW',
  phaseLive: 'LIVE',
  phaseOverrun: 'PAST RUNDOWN',
  phaseEnded: 'ENDED',
  segStudio: 'STUDIO',
  segMedia: 'PACKAGE',
  segBreak: 'BREAK',
  manual: 'MANUAL',
  onAirNow: 'ON AIR: {title}',
  offScript: 'OFF SCRIPT: {scene} since {time}',
  ambiguous: 'UNCERTAIN POSITION: check the rundown',
  obsAuthFailed: 'OBS: AUTHENTICATION FAILED',
  deckAbsent: 'PLAYLIST DECK MISSING: no measured packages',
  deckLegacy: 'PLAYLIST DECK < 1.4.0: reduced mode',
  decisionOutputRestart: 'REC/STREAM RESTARTED at {time}',
  decisionAllStopped: 'REC/STREAM STOPPED at {time}',
  choice_continue: 'Continue',
  choice_new_session: 'New session',
  choice_interruption: 'Interruption',
  choice_end: 'End program',
  messages: 'MESSAGES',
  freeText: 'Free text',
  send: 'SEND',
  clear: 'CLEAR',
  currentMessage: 'On air: {text}',
  emergency: 'EMERGENCY',
  startProgram: 'START PROGRAM',
  endProgram: 'END PROGRAM',
  nextCmd: 'NEXT',
  prevCmd: 'PREV',
  setManual: 'MANUAL',
  setAuto: 'AUTO',
  confirmAgain: 'Press again to confirm',
  noEffect: 'No effect',
  commandFailed: 'Command failed: {code}',
  openExtended: 'Open extended view',
  colSlot: '#',
  colBlock: 'Block',
  colItem: 'Item',
  colStatus: 'Status',
  colPlanned: 'Planned start',
  colStart: 'Start',
  colEnd: 'End',
  colDuration: 'Duration',
  status_pending: 'pending',
  status_onair: 'on air',
  status_done: 'done',
  status_postponed: 'postponed',
  status_dropped: 'dropped',
  provisional: 'provisional',
  kind_studio: 'Studio',
  kind_media: 'Package',
  kind_break: 'Break',
  goto: 'GO',
  events: 'EVENTS (this session)',
  episodes: 'EPISODES',
  load: 'LOAD',
  refresh: 'Refresh',
  loadFailed: 'Load failed: {code}',
  liveRunning: 'A live show is running: cannot load another episode',
  noEpisodes: 'No saved episodes',
  evLoaded: 'Episode loaded: {name}',
  evUnloaded: 'Episode unloaded',
  evPhasePreshow: 'PRE-SHOW',
  evPhaseLive: 'Program started',
  evPhaseOverrun: 'Rundown finished',
  evPhaseEnded: 'Program ended',
  evSlotPending: '{title}: pending',
  evSlotOnair: '{title}: on air',
  evSlotDone: '{title}: done',
  evSlotPostponed: '{title}: postponed',
  evSlotDropped: '{title}: dropped',
  evSlotProvisional: '{title}: provisional (estimated)',
  evMessage: 'Message: {text}',
  evMessageCleared: 'Message cleared',
  evObsLost: 'OBS not connected',
  evObsOk: 'OBS connected',
  evRecStarted: 'REC started',
  evRecStopped: 'REC stopped',
  evRecPaused: 'REC paused',
  evStreamStarted: 'Streaming started',
  evStreamStopped: 'Streaming stopped',
  evControlManual: 'MANUAL control',
  evControlAuto: 'AUTO control',
  evDecisionOutputRestart: 'Decision: REC/stream restarted',
  evDecisionAllStopped: 'Decision: REC/stream stopped',
  evChoseContinue: 'Chosen: continue',
  evChoseNewSession: 'Chosen: new session',
  evChoseInterruption: 'Chosen: interruption',
  evChoseEnd: 'Chosen: end program',
  evOffScript: 'Off script: {scene}',
  evOffScriptEnd: 'Back on script',
  evAmbiguous: 'Uncertain position',
};

export type Translate = (key: MessageKey, params?: Record<string, string | number>) => string;

const DICTIONARIES: Record<Lang, Record<MessageKey, string>> = { it: IT, en: EN };

/** Translator for a language. `{name}` placeholders take `params.name`; a missing parameter stays visible. */
export function createT(lang: Lang): Translate {
  const dict = DICTIONARIES[lang];
  return (key, params = {}) =>
    dict[key].replace(/\{(\w+)\}/g, (whole, name: string) => (name in params ? String(params[name]) : whole));
}
```

- [ ] **Step 4: Run them and verify they pass**

Run: `pnpm test && pnpm typecheck`. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/core web/test/core
git commit -m "feat(web): minimum-rtt server clock sync, jittered reconnect backoff, italian/english dictionary and page parameters"
```

---

### Task 7: `LiveClient` — WebSocket, hello/welcome, reconnect, staleness, commands

**Files:**
- Create:
  - `web/src/core/ws-client.ts`;
  - `web/test/support/fake-time.ts`, `web/test/support/fake-socket.ts`;
  - `web/test/core/ws-client.test.ts`.

**Interfaces:**
- Consumes:
  - `ClockSync`, `reconnectDelay`, `parseView`;
  - `PROTOCOL_VERSION`, `ServerMessageSchema`, `ClientMessage`, `ClientCommand`, `ClientRole`, `ErrorCode` (`@olc/shared`).
- Produces:
  - Constants: `STALE_AFTER_MS = 2_000`, `STALE_CHECK_MS = 250`, `PING_BURST = 4`, `PING_BURST_GAP_MS = 250`, `PING_INTERVAL_MS = 5_000`, `STABLE_CONNECTION_MS = 10_000`, `COMMAND_TIMEOUT_MS = 3_000`.
  - Types: `SocketLike`, `Scheduler`, `ConnectionState`, `ClientSnapshot<R>`, `LiveStore<R>`, `LiveClientOptions<R>`.
  - Values: `browserScheduler`, `monotonicNow`, `wsUrl(location)`, `class CommandError { code }`, `class LiveClient<R> implements LiveStore<R>`.
- Produces (test support):
  - `FakeScheduler`, with `now`, `local()`, `setTimeout`, `advance(ms)`;
  - `FakeSocket`, with `url`, `sent`, `closed`, `open()`, `receive(msg)`, `receiveRaw(text)`, `drop(code?)`, `sentOfType(type)`.

**Behaviour** (all of it is pinned by the tests below):
- **Starting state.** `start()` opens the first socket and the staleness check loop. The snapshot starts as `connecting`, `stale: true`, `hasView: false`, `synced: false`.
- **Open → hello.**
- **Welcome.**
  - A wrong protocol makes the client `incompatible`: it closes with 4001 and never reconnects.
  - A **different** `instanceId` resets the clock samples.
  - Otherwise: one ping immediately, three more 250 ms apart, then one every 5 s. A timer marks the connection stable after 10 s.
- **View.**
  - Its role must match, and it must pass `parseView`.
  - `lastRev` takes the message's rev even when the view is invalid.
  - A valid view is stored, sets `hasView`, and marks the data fresh.
  - An invalid view is reported, sets `problem: 'invalid_view'`, and stops heartbeats from refreshing until a valid view arrives. The old view is never shown as current.
- **Heartbeat.**
  - It refreshes only after a valid view on this connection.
  - A rev different from `lastRev` closes with 4000 `resync`, which leads to a reconnect and a full view.
- **Staleness.** A check runs every 250 ms. When `local − lastFresh > 2 s`, the snapshot becomes `stale: true`, with `staleSince = lastFresh + 2 s + offset`, in server time, or `null` when the clock is not synced.
- **Close.**
  - Pending commands reject with `disconnected`.
  - Per-connection timers are cleared.
  - Close code 4001 → `incompatible`.
  - Otherwise, a reconnect after `reconnectDelay(failures++)`. `failures` resets only when a connection stays up for 10 s.
- **Commands.** `sendCommand` uses ids `c1`, `c2`, …. It resolves on `ack`, and rejects with `CommandError(code)` on `error`, on `timeout` after 3 s, or on `disconnected` (before welcome, or when the socket closes).
- **Errors never escape.** Malformed frames set `problem: 'invalid_message'`. A throwing socket factory is reported and retried.

- [ ] **Step 1: Write the failing tests**

`web/test/support/fake-time.ts`:
```ts
// SPDX-License-Identifier: GPL-2.0-or-later
import type { Scheduler } from '../../src/core/ws-client';

/** Deterministic local clock + scheduler: timers fire in time order during `advance`. */
export class FakeScheduler implements Scheduler {
  now = 1_000;
  private timers: Array<{ id: number; at: number; fn: () => void }> = [];
  private nextId = 1;

  readonly local = (): number => this.now;

  setTimeout(fn: () => void, ms: number): () => void {
    const timer = { id: this.nextId++, at: this.now + Math.max(0, ms), fn };
    this.timers.push(timer);
    return () => {
      this.timers = this.timers.filter((t) => t !== timer);
    };
  }

  advance(ms: number): void {
    const target = this.now + ms;
    for (;;) {
      const due = this.timers.filter((t) => t.at <= target).sort((a, b) => a.at - b.at || a.id - b.id)[0];
      if (due === undefined) break;
      this.timers = this.timers.filter((t) => t !== due);
      this.now = due.at;
      due.fn();
    }
    this.now = target;
  }
}
```

`web/test/support/fake-socket.ts`:
```ts
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
```

`web/test/core/ws-client.test.ts`:
```ts
// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import { PROTOCOL_VERSION } from '@olc/shared';
import { CommandError, LiveClient, wsUrl } from '../../src/core/ws-client';
import { FakeScheduler } from '../support/fake-time';
import { FakeSocket } from '../support/fake-socket';
import { studioView } from '../support/views';

const WELCOME = { type: 'welcome', serverVersion: '0.1.0', instanceId: 'i-1', protocol: PROTOCOL_VERSION };

function setup<R extends 'presenter' | 'control'>(role: R) {
  const time = new FakeScheduler();
  const sockets: FakeSocket[] = [];
  const errors: unknown[] = [];
  const client = new LiveClient({
    url: 'ws://127.0.0.1:4460/ws',
    role,
    createSocket: (url) => {
      const s = new FakeSocket(url);
      sockets.push(s);
      return s;
    },
    local: time.local,
    scheduler: time,
    random: () => 0.5,
    report: (e) => errors.push(e),
  });
  const last = () => sockets[sockets.length - 1]!;
  /** Opens the newest socket and answers its hello with a welcome. */
  const welcome = (instanceId = 'i-1') => {
    last().open();
    last().receive({ ...WELCOME, instanceId });
  };
  return { time, sockets, errors, client, last, welcome };
}

describe('LiveClient', () => {
  it('starts stale with no view and says hello with its role on open', () => {
    const { client, last } = setup('presenter');
    client.start();
    expect(client.getSnapshot()).toMatchObject({ connection: 'connecting', hasView: false, stale: true, synced: false, view: null });
    expect(last().url).toBe('ws://127.0.0.1:4460/ws');
    last().open();
    expect(last().sent).toEqual([{ type: 'hello', role: 'presenter', protocol: PROTOCOL_VERSION }]);
  });

  it('syncs the clock: one ping at once, a burst of four, then one every 5 s', () => {
    const { client, last, welcome, time } = setup('presenter');
    client.start();
    welcome();
    expect(client.getSnapshot().connection).toBe('open');
    expect(last().sentOfType('time.ping')).toEqual([{ type: 'time.ping', t0: 1_000 }]);
    time.advance(40);
    last().receive({ type: 'time.pong', t0: 1_000, serverWall: 5_000_000 });
    expect(client.getSnapshot().synced).toBe(true);
    expect(client.serverNow()).toBe(5_000_020);
    time.advance(710); // 1750: pings at 1250, 1500, 1750
    expect(last().sentOfType('time.ping')).toHaveLength(4);
    time.advance(4_250); // 6000: the 5 s loop
    expect(last().sentOfType('time.ping')).toHaveLength(5);
    time.advance(5_000);
    expect(last().sentOfType('time.ping')).toHaveLength(6);
  });

  it('stores a valid view, then goes stale 2 s after the last fresh message, frozen at that instant', () => {
    const { client, last, welcome, time } = setup('presenter');
    client.start();
    welcome();
    time.advance(40);
    last().receive({ type: 'time.pong', t0: 1_000, serverWall: 5_000_000 }); // offset 4_998_980
    const view = studioView();
    last().receive({ type: 'view', rev: 1, role: 'presenter', view });
    expect(client.getSnapshot()).toMatchObject({ hasView: true, stale: false, staleSince: null, view });
    time.advance(960); // 2000
    last().receive({ type: 'heartbeat', rev: 1, serverWall: 5_001_000 });
    time.advance(2_000); // 4000: exactly 2 s, still fresh
    expect(client.getSnapshot().stale).toBe(false);
    time.advance(250); // 4250
    expect(client.getSnapshot()).toMatchObject({ stale: true, staleSince: 4_000 + 4_998_980 });
    last().receive({ type: 'heartbeat', rev: 1, serverWall: 5_004_000 });
    expect(client.getSnapshot()).toMatchObject({ stale: false, staleSince: null });
  });

  it('goes stale with an unknown instant when the clock was never synced', () => {
    const { client, last, welcome, time } = setup('presenter');
    client.start();
    welcome();
    last().receive({ type: 'view', rev: 1, role: 'presenter', view: studioView() });
    time.advance(2_250);
    expect(client.getSnapshot()).toMatchObject({ stale: true, staleSince: null });
  });

  it('ignores heartbeats until this connection has delivered a view', () => {
    const { client, last, welcome } = setup('presenter');
    client.start();
    welcome();
    last().receive({ type: 'heartbeat', rev: 0, serverWall: 1 });
    expect(client.getSnapshot().stale).toBe(true);
  });

  it('keeps an invalid view out of the snapshot, reports it, and lets the data go stale', () => {
    const { client, last, welcome, time, errors } = setup('presenter');
    client.start();
    welcome();
    const view = studioView();
    last().receive({ type: 'view', rev: 1, role: 'presenter', view });
    last().receive({ type: 'view', rev: 2, role: 'presenter', view: { phase: 'bogus' } });
    expect(client.getSnapshot()).toMatchObject({ view, problem: 'invalid_view' });
    expect(errors).toHaveLength(1);
    for (let i = 0; i < 3; i++) {
      time.advance(1_000);
      last().receive({ type: 'heartbeat', rev: 2, serverWall: 1 });
    }
    expect(client.getSnapshot().stale).toBe(true);
    expect(last().closed).toBeNull();
  });

  it('rejects a view addressed to the other role', () => {
    const { client, last, welcome } = setup('presenter');
    client.start();
    welcome();
    last().receive({ type: 'view', rev: 1, role: 'control', view: null });
    expect(client.getSnapshot()).toMatchObject({ hasView: false, problem: 'invalid_view' });
  });

  it('resynchronises with a new connection when a heartbeat reports an unseen rev', () => {
    const { client, sockets, last, welcome, time } = setup('presenter');
    client.start();
    welcome();
    last().receive({ type: 'view', rev: 3, role: 'presenter', view: studioView() });
    last().receive({ type: 'heartbeat', rev: 4, serverWall: 1 });
    expect(sockets[0]!.closed).toEqual({ code: 4000, reason: 'resync' });
    expect(client.getSnapshot().problem).toBe('rev_mismatch');
    time.advance(500);
    expect(sockets).toHaveLength(2);
  });

  it('reconnects with jittered exponential backoff capped at 5 s', () => {
    const { client, sockets, last, time } = setup('presenter');
    client.start();
    for (const delay of [500, 1_000, 2_000, 4_000, 5_000, 5_000]) {
      const count = sockets.length;
      last().drop();
      expect(client.getSnapshot().connection).toBe('reconnecting');
      time.advance(delay - 1);
      expect(sockets).toHaveLength(count);
      time.advance(1);
      expect(sockets).toHaveLength(count + 1);
    }
  });

  it('does not reset the backoff for connections that drop right after welcome (no reconnect storm)', () => {
    const { client, sockets, last, welcome, time } = setup('presenter');
    client.start();
    for (const delay of [500, 1_000, 2_000]) {
      welcome();
      last().drop();
      const count = sockets.length;
      time.advance(delay - 1);
      expect(sockets).toHaveLength(count);
      time.advance(1);
      expect(sockets).toHaveLength(count + 1);
    }
    welcome();
    time.advance(10_000); // stable for 10 s: the backoff starts over
    last().drop();
    const count = sockets.length;
    time.advance(499);
    expect(sockets).toHaveLength(count);
    time.advance(1);
    expect(sockets).toHaveLength(count + 1);
  });

  it('stops for good on a protocol mismatch', () => {
    const { client, sockets, last, time } = setup('presenter');
    client.start();
    last().open();
    last().receive({ ...WELCOME, protocol: 99 });
    expect(client.getSnapshot().connection).toBe('incompatible');
    expect(sockets[0]!.closed?.code).toBe(4001);
    time.advance(60_000);
    expect(sockets).toHaveLength(1);

    const other = setup('presenter');
    other.client.start();
    other.last().open();
    other.last().drop(4001);
    expect(other.client.getSnapshot().connection).toBe('incompatible');
    other.time.advance(60_000);
    expect(other.sockets).toHaveLength(1);
  });

  it('resolves a command on ack and rejects it on error, timeout and disconnect', async () => {
    const { client, last, welcome, time } = setup('control');
    client.start();
    await expect(client.sendCommand({ name: 'next' })).rejects.toMatchObject({ code: 'disconnected' });
    welcome();
    const ok = client.sendCommand({ name: 'next' });
    expect(last().sentOfType('command')).toEqual([{ type: 'command', id: 'c1', command: { name: 'next' } }]);
    last().receive({ type: 'ack', id: 'c1', changed: false });
    await expect(ok).resolves.toEqual({ changed: false });
    const bad = client.sendCommand({ name: 'prev' });
    last().receive({ type: 'error', id: 'c2', code: 'no_episode', message: 'No episode is loaded' });
    await expect(bad).rejects.toBeInstanceOf(CommandError);
    await expect(bad).rejects.toMatchObject({ code: 'no_episode' });
    const slow = client.sendCommand({ name: 'clear_message' });
    time.advance(3_000);
    await expect(slow).rejects.toMatchObject({ code: 'timeout' });
    const cut = client.sendCommand({ name: 'clear_message' });
    last().drop();
    await expect(cut).rejects.toMatchObject({ code: 'disconnected' });
  });

  it('stop closes the socket, rejects pending commands and never reconnects', async () => {
    const { client, sockets, welcome, time } = setup('control');
    client.start();
    welcome();
    const pending = client.sendCommand({ name: 'next' });
    client.stop();
    await expect(pending).rejects.toMatchObject({ code: 'disconnected' });
    expect(sockets[0]!.closed?.code).toBe(1000);
    time.advance(60_000);
    expect(sockets).toHaveLength(1);
  });

  it('survives malformed frames and a throwing socket factory', () => {
    const time = new FakeScheduler();
    const errors: unknown[] = [];
    const sockets: FakeSocket[] = [];
    let calls = 0;
    const client = new LiveClient({
      url: 'ws://x/ws',
      role: 'presenter',
      local: time.local,
      scheduler: time,
      random: () => 0.5,
      report: (e) => errors.push(e),
      createSocket: (url) => {
        calls += 1;
        if (calls === 1) throw new Error('boom');
        const s = new FakeSocket(url);
        sockets.push(s);
        return s;
      },
    });
    client.start();
    expect(errors).toHaveLength(1);
    time.advance(500);
    expect(sockets).toHaveLength(1);
    sockets[0]!.open();
    sockets[0]!.receiveRaw('not json');
    expect(client.getSnapshot().problem).toBe('invalid_message');
    sockets[0]!.receive({ type: 'nope' });
    expect(client.getSnapshot().problem).toBe('invalid_message');
  });

  it('forgets the clock offset when a different server instance answers', () => {
    const { client, last, welcome, time } = setup('presenter');
    client.start();
    welcome('i-1');
    last().receive({ type: 'time.pong', t0: 1_000, serverWall: 5_000_000 });
    expect(client.getSnapshot().synced).toBe(true);
    last().drop();
    time.advance(500);
    welcome('i-1');
    expect(client.getSnapshot().synced).toBe(true);
    last().drop();
    time.advance(1_000);
    welcome('i-2');
    expect(client.getSnapshot().synced).toBe(false);
    expect(client.serverNow()).toBeNull();
  });

  it('notifies subscribers only on real changes', () => {
    const { client, last, welcome } = setup('presenter');
    let calls = 0;
    const unsubscribe = client.subscribe(() => { calls += 1; });
    client.start();
    welcome();
    const before = calls;
    last().receive({ type: 'time.pong', t0: 1_000, serverWall: 5_000_000 });
    last().receive({ type: 'time.pong', t0: 1_000, serverWall: 5_000_000 });
    expect(calls).toBe(before + 1); // synced flips once
    unsubscribe();
  });

  it('builds the socket URL from the page location', () => {
    expect(wsUrl({ protocol: 'http:', host: '127.0.0.1:4460' })).toBe('ws://127.0.0.1:4460/ws');
    expect(wsUrl({ protocol: 'https:', host: 'regia.local' })).toBe('wss://regia.local/ws');
  });
});
```

- [ ] **Step 2: Run it and verify it fails**

Run: `pnpm vitest run web/test/core/ws-client.test.ts`. Expected: FAIL, because the module is missing.

- [ ] **Step 3: Implement** `web/src/core/ws-client.ts`

```ts
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
```

- [ ] **Step 4: Run it and verify it passes**

Run: `pnpm test && pnpm typecheck` three times. Expected: PASS every time.

- [ ] **Step 5: Commit**

```bash
git add web/src/core/ws-client.ts web/test/support/fake-time.ts web/test/support/fake-socket.ts web/test/core/ws-client.test.ts
git commit -m "feat(web): live websocket client with clock sync, heartbeat staleness, storm-safe reconnect and commands"
```

---

### Task 8: React bindings — live context, frame loop, `<AnchoredTime>` and friends

**Files:**
- Create:
  - `web/src/core/frame-loop.ts`;
  - `web/src/ui/live-context.tsx`, `web/src/ui/AnchoredTime.tsx`, `web/src/ui/AnchoredProgress.tsx`, `web/src/ui/AnchoredWall.tsx`, `web/src/ui/SourceBadge.tsx`, `web/src/ui/ConnectionOverlay.tsx`;
  - `web/test/support/frames.ts`, `web/test/support/store.ts`, `web/test/support/render.tsx`;
  - `web/test/ui/anchored.test.tsx`, `web/test/ui/overlay.test.tsx`, `web/test/core/frame-loop.test.ts`.

**Interfaces:**
- Consumes: `LiveStore`, `ClientSnapshot`, `anchorFrame`, `remainingAt`, `wallText`, `createT`.
- Produces:
  - `frame-loop.ts`: `FrameLoop { subscribe(fn): () => void }`, `browserFrameLoop(raf?, caf?, report?)`.
  - `live-context.tsx`:
    - `LiveContextValue { store; frames; lang; t; timeZone }`;
    - `<LiveProvider store frames lang? timeZone?>`;
    - `useLive()`;
    - `useSnapshot<R>()`, which uses `useSyncExternalStore` with a server snapshot, so SSR works;
    - `useFrameValue(compute)`.
  - `AnchoredTime.tsx`: `<AnchoredTime anchor className? tally? tallyRef? seedTicks?>`, `writeFrame(el, frame)`, `setText(el, text)`.
  - `AnchoredProgress.tsx`: `<AnchoredProgress anchor durationMs>`, `progressAt(anchor, durationMs, now)`.
  - `AnchoredWall.tsx`: `<AnchoredWall className?>`, the server wall clock.
  - `SourceBadge.tsx`: `<SourceBadge anchor? source? showPlanned?>`.
  - `ConnectionOverlay.tsx`: `<ConnectionOverlay reload? reloadAfterMs?>`.
- Produces (test support):
  - `ManualFrameLoop`, with `frame()` and `size`;
  - `StaticStore<R>`, with `now`, `commands`, `reply`, `set(patch)`, implementing `LiveStore<R>`;
  - `snapshotOf(view, over?)`;
  - `renderLive(ui, store, lang?)`, which returns RTL utils plus `frames`, `advance(ms)`, `update(patch)` and `rerender(ui)`.

**Rules (DT-2, DT-7, TECH-DESIGN §6.3):**
- **React renders a counter once per anchor or staleness change.** One shared `requestAnimationFrame` loop repaints it:
  - text goes into the **text node React created** (`firstChild.nodeValue`), so React and the loop share one node and never fight;
  - `data-len`, `data-source`, `data-paused` and `data-stale` are written only when they change;
  - the optional tally goes to `data-tally` on `tallyRef` (or the counter itself). A parent `tallyRef` is attached after the child effect on the first commit, so the parent renders its own initial `data-tally` and the first frame updates it.
- **First paint.** The value is computed during render, so the first paint, and server-side rendering, already show the right number. The paint is repeated in `useLayoutEffect`, before the browser paints.
- **Staleness.** `useSnapshot()` gives `stale`/`staleSince`. A stale snapshot without a `staleSince` (clock never synced) counts as `-Infinity`, so the counter shows `—`.
- **The wall clock** is the server clock (NF4). It keeps running while stale, because the offset estimate is still valid. It shows `—` before the first sample.
- **`useFrameValue(compute)`** recomputes on every frame and at render, and re-renders only when the primitive result changes.
- **`ConnectionOverlay`** shows:
  - `incompatible` → full-screen `VERSIONE NON COMPATIBILE · RICARICA` (`role="alert"`), and calls `reload()` after `reloadAfterMs` (default 10 s, `location.reload()`);
  - no view yet, or clock not synced → full-screen `CONNESSIONE…` (`role="status"`);
  - stale → banner `RICONNESSIONE…` (`role="alert"`);
  - otherwise nothing.

- [ ] **Step 1: Write the failing tests**

`web/test/support/frames.ts`:
```ts
// SPDX-License-Identifier: GPL-2.0-or-later
import type { FrameLoop } from '../../src/core/frame-loop';

/** A frame loop driven by the test. */
export class ManualFrameLoop implements FrameLoop {
  private readonly subscribers = new Set<() => void>();

  subscribe(fn: () => void): () => void {
    this.subscribers.add(fn);
    return () => {
      this.subscribers.delete(fn);
    };
  }

  frame(): void {
    for (const fn of [...this.subscribers]) fn();
  }

  get size(): number {
    return this.subscribers.size;
  }
}
```

`web/test/support/store.ts`:
```ts
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
```

`web/test/support/render.tsx`:
```tsx
// SPDX-License-Identifier: GPL-2.0-or-later
import { act, render } from '@testing-library/react';
import type { ReactElement } from 'react';
import type { ClientRole } from '@olc/shared';
import type { Lang } from '../../src/core/i18n';
import type { ClientSnapshot, LiveStore } from '../../src/core/ws-client';
import { LiveProvider } from '../../src/ui/live-context';
import { ManualFrameLoop } from './frames';
import type { StaticStore } from './store';

/** Renders `ui` inside a LiveProvider (Italian, UTC wall times) driven by a manual frame loop. */
export function renderLive<R extends ClientRole>(ui: ReactElement, store: StaticStore<R>, lang: Lang = 'it') {
  const frames = new ManualFrameLoop();
  const wrap = (node: ReactElement) => (
    <LiveProvider store={store as unknown as LiveStore<ClientRole>} frames={frames} lang={lang} timeZone="UTC">
      {node}
    </LiveProvider>
  );
  const utils = render(wrap(ui));
  return {
    ...utils,
    frames,
    rerender: (next: ReactElement) => utils.rerender(wrap(next)),
    /** Moves server time forward and runs one animation frame. */
    advance(ms: number) {
      act(() => {
        store.now = (store.now ?? 0) + ms;
        frames.frame();
      });
    },
    /** Publishes a new client snapshot. */
    update(patch: Partial<ClientSnapshot<R>>) {
      act(() => store.set(patch));
    },
  };
}
```

`web/test/core/frame-loop.test.ts`:
```ts
// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import { browserFrameLoop } from '../../src/core/frame-loop';

describe('browserFrameLoop', () => {
  it('runs one animation frame for all subscribers and stops when nobody listens', () => {
    const queue: Array<() => void> = [];
    const cancelled: number[] = [];
    const errors: unknown[] = [];
    const loop = browserFrameLoop((cb) => queue.push(cb), (h) => cancelled.push(h), (e) => errors.push(e));
    const seen: string[] = [];
    const offA = loop.subscribe(() => seen.push('a'));
    loop.subscribe(() => {
      throw new Error('bad subscriber');
    });
    const offC = loop.subscribe(() => seen.push('c'));
    expect(queue).toHaveLength(1);
    queue.shift()!();
    expect(seen).toEqual(['a', 'c']);
    expect(errors).toHaveLength(1);
    expect(queue).toHaveLength(1);
    offA();
    offC();
    expect(cancelled).toHaveLength(0); // the throwing subscriber is still there
  });

  it('cancels the pending frame when the last subscriber leaves', () => {
    const cancelled: number[] = [];
    const loop = browserFrameLoop(() => 7, (h) => cancelled.push(h));
    const off = loop.subscribe(() => {});
    off();
    expect(cancelled).toEqual([7]);
  });
});
```

`web/test/ui/anchored.test.tsx`:
```tsx
// SPDX-License-Identifier: GPL-2.0-or-later
import { Profiler, useRef } from 'react';
import { act, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { Anchor } from '../../src/core/views';
import { AnchoredProgress } from '../../src/ui/AnchoredProgress';
import { AnchoredTime } from '../../src/ui/AnchoredTime';
import { AnchoredWall } from '../../src/ui/AnchoredWall';
import { SourceBadge } from '../../src/ui/SourceBadge';
import { useFrameValue, useLive } from '../../src/ui/live-context';
import { renderLive } from '../support/render';
import { StaticStore, snapshotOf } from '../support/store';
import { WALL, studioView } from '../support/views';

const cd = (endsAt: number, source: 'measured' | 'planned' | 'estimated' = 'measured'): Anchor => ({ kind: 'countdown', endsAt, source });
const store = () => new StaticStore(snapshotOf<'presenter'>(studioView()));
const scaleOf = (el: HTMLElement) => Number(/scaleX\(([\d.]+)\)/.exec(el.style.transform)![1]);

describe('<AnchoredTime>', () => {
  it('renders the right value on the very first paint, then repaints the same text node without re-rendering', () => {
    let commits = 0;
    const s = store();
    const { container, advance } = renderLive(
      <Profiler id="counter" onRender={() => { commits += 1; }}>
        <AnchoredTime anchor={cd(WALL + 61_000)} className="counter" />
      </Profiler>,
      s,
    );
    const el = container.querySelector<HTMLElement>('.counter')!;
    expect(el.textContent).toBe('1:01');
    const node = el.firstChild;
    for (let i = 0; i < 120; i++) advance(500);
    expect(el.textContent).toBe('0:01');
    expect(el.firstChild).toBe(node);
    expect(commits).toBe(1);
  });

  it('writes length, source, paused and stale attributes', () => {
    const { container } = renderLive(
      <>
        <AnchoredTime anchor={cd(WALL + 61_000, 'estimated')} className="a" />
        <AnchoredTime anchor={{ kind: 'frozen', valueMs: 600_000, source: 'measured' }} className="b" />
      </>,
      store(),
    );
    const a = container.querySelector<HTMLElement>('.a')!;
    const b = container.querySelector<HTMLElement>('.b')!;
    expect(a.dataset).toMatchObject({ len: '4', source: 'estimated', paused: 'false', stale: 'false' });
    expect(b.textContent).toBe('10:00');
    expect(b.dataset).toMatchObject({ len: '5', source: 'measured', paused: 'true' });
  });

  it('shows "—" before the clock is synced and for unknown anchors', () => {
    const s = store();
    s.now = null;
    const { container } = renderLive(
      <>
        <AnchoredTime anchor={cd(WALL + 61_000)} className="a" />
        <AnchoredTime anchor={{ kind: 'unknown' }} className="b" />
      </>,
      s,
    );
    expect(container.querySelector('.a')!.textContent).toBe('—');
    expect(container.querySelector('.b')!.textContent).toBe('—');
  });

  it('freezes when the data goes stale and blanks after 10 s', () => {
    const { container, advance, update } = renderLive(<AnchoredTime anchor={cd(WALL + 61_000)} className="c" />, store());
    const el = container.querySelector<HTMLElement>('.c')!;
    update({ stale: true, staleSince: WALL });
    advance(3_000);
    expect(el.textContent).toBe('1:01');
    expect(el.dataset.stale).toBe('true');
    advance(8_000);
    expect(el.textContent).toBe('—');
    update({ stale: false, staleSince: null });
    expect(el.textContent).toBe('0:50');
    expect(el.dataset.stale).toBe('false');
  });

  it('writes the tally onto the target element on every frame', () => {
    function Tile() {
      const ref = useRef<HTMLDivElement>(null);
      return (
        <div ref={ref} data-testid="tile">
          <AnchoredTime anchor={cd(WALL + 61_000)} tally={(f) => (f.ticks !== null && f.ticks <= 60 ? 'warn' : 'none')} tallyRef={ref} />
        </div>
      );
    }
    const { advance } = renderLive(<Tile />, store());
    advance(0);
    expect(screen.getByTestId('tile').dataset.tally).toBe('none');
    advance(1_000);
    expect(screen.getByTestId('tile').dataset.tally).toBe('warn');
  });

  it('keeps the second-boundary hysteresis across a re-anchor', () => {
    const { container, rerender } = renderLive(<AnchoredTime anchor={cd(WALL + 41_000)} className="c" />, store());
    const el = container.querySelector('.c')!;
    expect(el.textContent).toBe('0:41');
    rerender(<AnchoredTime anchor={cd(WALL + 41_100)} className="c" />);
    expect(el.textContent).toBe('0:41');
    rerender(<AnchoredTime anchor={cd(WALL + 41_300)} className="c" />);
    expect(el.textContent).toBe('0:42');
  });
});

describe('<AnchoredProgress>, <AnchoredWall>, <SourceBadge>, useFrameValue', () => {
  it('fills the progress bar from the anchor and the duration', () => {
    const { container, advance } = renderLive(
      <>
        <AnchoredProgress anchor={cd(WALL + 50_000)} durationMs={100_000} />
        <AnchoredProgress anchor={cd(WALL + 50_000)} durationMs={null} />
      </>,
      store(),
    );
    const [known, unknown] = [...container.querySelectorAll<HTMLElement>('.progress-fill')];
    expect(scaleOf(known!)).toBeCloseTo(0.5, 3);
    expect(known!.dataset.known).toBe('true');
    advance(25_000);
    expect(scaleOf(known!)).toBeCloseTo(0.75, 3);
    advance(60_000);
    expect(scaleOf(known!)).toBe(1);
    expect(unknown!.dataset.known).toBe('false');
  });

  it('shows the server wall clock, and "—" before the first sample', () => {
    const s = store();
    const { container, advance, frames } = renderLive(<AnchoredWall className="w" />, s);
    expect(container.querySelector('.w')!.textContent).toBe('14:13:20');
    advance(1_000);
    expect(container.querySelector('.w')!.textContent).toBe('14:13:21');
    s.now = null;
    act(() => frames.frame());
    expect(container.querySelector('.w')!.textContent).toBe('—');
  });

  it('badges estimated, planned (on request) and paused values', () => {
    const { container } = renderLive(
      <>
        <span className="e"><SourceBadge anchor={cd(WALL, 'estimated')} /></span>
        <span className="p"><SourceBadge source="planned" showPlanned /></span>
        <span className="q"><SourceBadge source="planned" /></span>
        <span className="f"><SourceBadge anchor={{ kind: 'frozen', valueMs: 1, source: 'measured' }} /></span>
        <span className="m"><SourceBadge source="measured" /></span>
      </>,
      store(),
    );
    expect(container.querySelector('.e')!.textContent).toBe('STIMATO');
    expect(container.querySelector('.p')!.textContent).toBe('PIAN.');
    expect(container.querySelector('.q')!.textContent).toBe('');
    expect(container.querySelector('.f')!.textContent).toBe('PAUSA');
    expect(container.querySelector('.m')!.textContent).toBe('');
  });

  it('useFrameValue re-renders only when the derived value changes', () => {
    let commits = 0;
    function Phase() {
      const { store: s } = useLive();
      const v = useFrameValue(() => ((s.serverNow() ?? 0) >= WALL + 5_000 ? 'late' : 'early'));
      return <span className="v">{v}</span>;
    }
    const { container, advance } = renderLive(
      <Profiler id="v" onRender={() => { commits += 1; }}>
        <Phase />
      </Profiler>,
      store(),
    );
    for (let i = 0; i < 100; i++) advance(100);
    expect(container.querySelector('.v')!.textContent).toBe('late');
    expect(commits).toBe(2);
  });
});
```

`web/test/ui/overlay.test.tsx`:
```tsx
// SPDX-License-Identifier: GPL-2.0-or-later
import { act, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConnectionOverlay } from '../../src/ui/ConnectionOverlay';
import { renderLive } from '../support/render';
import { StaticStore, snapshotOf } from '../support/store';
import { studioView } from '../support/views';

afterEach(() => {
  vi.useRealTimers();
});

describe('<ConnectionOverlay>', () => {
  it('says CONNESSIONE… until a view has arrived and the clock is synced', () => {
    const s = new StaticStore(snapshotOf<'presenter'>(null, { hasView: false, synced: false, stale: true }));
    const { update, container } = renderLive(<ConnectionOverlay />, s);
    expect(screen.getByRole('status').textContent).toBe('CONNESSIONE…');
    update({ hasView: true, stale: false });
    expect(screen.getByRole('status').textContent).toBe('CONNESSIONE…');
    update({ synced: true });
    expect(container.textContent).toBe('');
  });

  it('shows RICONNESSIONE… while stale, in the chosen language', () => {
    const s = new StaticStore(snapshotOf<'presenter'>(studioView(), { stale: true, staleSince: 1 }));
    renderLive(<ConnectionOverlay />, s, 'en');
    expect(screen.getByRole('alert').textContent).toBe('RECONNECTING…');
  });

  it('asks for a reload on an incompatible server and reloads after 10 s', () => {
    vi.useFakeTimers();
    const reload = vi.fn();
    const s = new StaticStore(snapshotOf<'presenter'>(studioView(), { connection: 'incompatible' }));
    renderLive(<ConnectionOverlay reload={reload} />, s);
    expect(screen.getByRole('alert').textContent).toBe('VERSIONE NON COMPATIBILE · RICARICA');
    act(() => vi.advanceTimersByTime(9_999));
    expect(reload).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(reload).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run them and verify they fail**

Run: `pnpm vitest run web/test/ui web/test/core/frame-loop.test.ts`. Expected: FAIL, because the modules are missing.

- [ ] **Step 3: Implement**

`web/src/core/frame-loop.ts`:
```ts
// SPDX-License-Identifier: GPL-2.0-or-later

/** One animation-frame loop shared by every counter on the page. */
export interface FrameLoop {
  subscribe(fn: () => void): () => void;
}

/** requestAnimationFrame loop that runs only while something listens. A throwing subscriber is reported, never fatal. */
export function browserFrameLoop(
  raf: (cb: () => void) => number = (cb) => requestAnimationFrame(cb),
  caf: (handle: number) => void = (handle) => cancelAnimationFrame(handle),
  report: (err: unknown) => void = (err) => console.error(err),
): FrameLoop {
  const subscribers = new Set<() => void>();
  let handle: number | null = null;
  const tick = () => {
    handle = null;
    for (const fn of [...subscribers]) {
      try {
        fn();
      } catch (err) {
        report(err);
      }
    }
    if (subscribers.size > 0) handle = raf(tick);
  };
  return {
    subscribe(fn) {
      subscribers.add(fn);
      if (handle === null) handle = raf(tick);
      return () => {
        subscribers.delete(fn);
        if (subscribers.size === 0 && handle !== null) {
          caf(handle);
          handle = null;
        }
      };
    },
  };
}
```

`web/src/ui/live-context.tsx`:
```tsx
// SPDX-License-Identifier: GPL-2.0-or-later
import { createContext, useContext, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import type { ClientRole } from '@olc/shared';
import type { FrameLoop } from '../core/frame-loop';
import { createT, type Lang, type Translate } from '../core/i18n';
import type { ClientSnapshot, LiveStore } from '../core/ws-client';

export interface LiveContextValue {
  store: LiveStore<ClientRole>;
  frames: FrameLoop;
  lang: Lang;
  t: Translate;
  /** IANA zone for wall times; undefined means the browser's own (tests pass 'UTC'). */
  timeZone: string | undefined;
}

const LiveContext = createContext<LiveContextValue | null>(null);

export function LiveProvider(props: {
  store: LiveStore<ClientRole>;
  frames: FrameLoop;
  lang?: Lang;
  timeZone?: string;
  children: ReactNode;
}) {
  const { store, frames, lang = 'it', timeZone, children } = props;
  const value = useMemo(() => ({ store, frames, lang, t: createT(lang), timeZone }), [store, frames, lang, timeZone]);
  return <LiveContext.Provider value={value}>{children}</LiveContext.Provider>;
}

export function useLive(): LiveContextValue {
  const value = useContext(LiveContext);
  if (value === null) throw new Error('useLive() outside <LiveProvider>');
  return value;
}

/** The client snapshot; re-renders only when the client publishes a new one. Works in SSR (server snapshot). */
export function useSnapshot<R extends ClientRole = ClientRole>(): ClientSnapshot<R> {
  const { store } = useLive();
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot) as ClientSnapshot<R>;
}

/**
 * A discrete value derived from time (a screen mode, a tally): recomputed on every frame, but React re-renders
 * only when it changes. Each render recomputes it too, so a new view is reflected without waiting for a frame.
 */
export function useFrameValue<T extends string | number | boolean | null>(compute: () => T): T {
  const { frames } = useLive();
  const latest = useRef(compute);
  latest.current = compute;
  const current = compute();
  const shown = useRef(current);
  shown.current = current;
  const [, force] = useState(0);
  useLayoutEffect(
    () =>
      frames.subscribe(() => {
        const next = latest.current();
        if (!Object.is(next, shown.current)) {
          shown.current = next;
          force((n) => n + 1);
        }
      }),
    [frames],
  );
  return current;
}
```

`web/src/ui/AnchoredTime.tsx`:
```tsx
// SPDX-License-Identifier: GPL-2.0-or-later
import { useLayoutEffect, useRef, type RefObject } from 'react';
import { UNKNOWN_TEXT, anchorFrame, type AnchorFrame } from '../core/anchor';
import type { Anchor } from '../core/views';
import { useLive, useSnapshot } from './live-context';

export interface AnchoredTimeProps {
  anchor: Anchor | null;
  className?: string;
  /** Tally for each frame, written as data-tally onto `tallyRef` (or onto the counter itself). */
  tally?: (frame: AnchorFrame) => string;
  tallyRef?: RefObject<HTMLElement | null>;
  /** Ticks shown just before this counter mounted, so the hysteresis continues across a remount. */
  seedTicks?: number | null;
}

const NO_CLOCK: AnchorFrame = { text: UNKNOWN_TEXT, ticks: null, remainingMs: null, source: null, paused: false, stale: false };

/** Sets the text of the element's own text node (the one React rendered), so React and the frame loop share it. */
export function setText(el: HTMLElement, text: string): void {
  const node = el.firstChild;
  if (node !== null && node.nodeType === 3) {
    if (node.nodeValue !== text) node.nodeValue = text;
  } else if (el.textContent !== text) {
    el.textContent = text;
  }
}

function setData(el: HTMLElement, key: string, value: string): void {
  if (el.dataset[key] !== value) el.dataset[key] = value;
}

export function writeFrame(el: HTMLElement, frame: AnchorFrame): void {
  setText(el, frame.text);
  setData(el, 'len', String(frame.text.length));
  setData(el, 'source', frame.source ?? 'unknown');
  setData(el, 'paused', String(frame.paused));
  setData(el, 'stale', String(frame.stale));
}

/**
 * DT-2/DT-7 counter: computed on every animation frame from the anchor and the synced server clock and written
 * straight into the DOM. React renders it once per anchor or staleness change, never per frame.
 */
export function AnchoredTime({ anchor, className, tally, tallyRef, seedTicks = null }: AnchoredTimeProps) {
  const { store, frames } = useLive();
  const snap = useSnapshot();
  const staleSince = snap.stale ? (snap.staleSince ?? Number.NEGATIVE_INFINITY) : null;
  const ref = useRef<HTMLSpanElement>(null);
  const prevTicks = useRef<number | null>(seedTicks);
  const tallyFn = useRef(tally);
  tallyFn.current = tally;

  const frameNow = (): AnchorFrame => {
    const now = store.serverNow();
    return now === null ? NO_CLOCK : anchorFrame(anchor, now, staleSince, prevTicks.current);
  };
  const first = frameNow(); // the first paint, and SSR, already show the right value

  useLayoutEffect(() => {
    const el = ref.current;
    if (el === null) return undefined;
    const paint = () => {
      const frame = frameNow();
      prevTicks.current = frame.ticks;
      writeFrame(el, frame);
      // A parent tallyRef is attached after this child effect on the first commit: it is picked up on the next frame.
      const fn = tallyFn.current;
      const target = tallyRef === undefined ? el : tallyRef.current;
      if (fn !== undefined && target !== null) setData(target, 'tally', fn(frame));
    };
    paint();
    return frames.subscribe(paint);
    // frameNow closes over anchor, staleSince and store, all listed here.
  }, [anchor, staleSince, store, frames, tallyRef]);

  return (
    <span
      ref={ref}
      className={className}
      data-len={first.text.length}
      data-source={first.source ?? 'unknown'}
      data-paused={String(first.paused)}
      data-stale={String(first.stale)}
    >
      {first.text}
    </span>
  );
}
```

`web/src/ui/AnchoredProgress.tsx`:
```tsx
// SPDX-License-Identifier: GPL-2.0-or-later
import { useLayoutEffect, useRef } from 'react';
import { remainingAt } from '../core/anchor';
import type { Anchor } from '../core/views';
import { useLive, useSnapshot } from './live-context';

/** Fraction elapsed of an on-air item, or null when it cannot be known (no duration, unknown anchor, no clock). */
export function progressAt(anchor: Anchor, durationMs: number | null, now: number | null): number | null {
  if (now === null || durationMs === null || durationMs <= 0) return null;
  const r = remainingAt(anchor, now);
  if (r === null) return null;
  return Math.min(1, Math.max(0, 1 - r / durationMs));
}

const transformOf = (p: number | null): string => `scaleX(${(p ?? 0).toFixed(4)})`;

/** Progress bar of the on-air item, repainted per frame as a scaleX transform (no React render). */
export function AnchoredProgress({ anchor, durationMs }: { anchor: Anchor; durationMs: number | null }) {
  const { store, frames } = useLive();
  const snap = useSnapshot();
  const staleSince = snap.stale ? snap.staleSince : null;
  const ref = useRef<HTMLDivElement>(null);
  const at = (): number | null => {
    const now = store.serverNow();
    return now === null ? null : (staleSince ?? now);
  };
  const first = progressAt(anchor, durationMs, at());

  useLayoutEffect(() => {
    const el = ref.current;
    if (el === null) return undefined;
    const paint = () => {
      const p = progressAt(anchor, durationMs, at());
      const transform = transformOf(p);
      if (el.style.transform !== transform) el.style.transform = transform;
      const known = String(p !== null);
      if (el.dataset.known !== known) el.dataset.known = known;
    };
    paint();
    return frames.subscribe(paint);
  }, [anchor, durationMs, staleSince, store, frames]);

  return (
    <div className="progress" aria-hidden="true">
      <div ref={ref} className="progress-fill" data-known={String(first !== null)} style={{ transform: transformOf(first) }} />
    </div>
  );
}
```

`web/src/ui/AnchoredWall.tsx`:
```tsx
// SPDX-License-Identifier: GPL-2.0-or-later
import { useLayoutEffect, useRef } from 'react';
import { UNKNOWN_TEXT } from '../core/anchor';
import { wallText } from '../core/time-format';
import { setText } from './AnchoredTime';
import { useLive } from './live-context';

/** The server's wall clock (NF4: the server is the only source of time), repainted per frame. */
export function AnchoredWall({ className }: { className?: string }) {
  const { store, frames, timeZone } = useLive();
  const ref = useRef<HTMLSpanElement>(null);
  const text = (): string => {
    const now = store.serverNow();
    return now === null ? UNKNOWN_TEXT : wallText(now, timeZone);
  };
  const first = text();

  useLayoutEffect(() => {
    const el = ref.current;
    if (el === null) return undefined;
    const paint = () => setText(el, text());
    paint();
    return frames.subscribe(paint);
  }, [store, frames, timeZone]);

  return (
    <span ref={ref} className={className}>
      {first}
    </span>
  );
}
```

`web/src/ui/SourceBadge.tsx`:
```tsx
// SPDX-License-Identifier: GPL-2.0-or-later
import type { Anchor, Source } from '../core/views';
import { useLive } from './live-context';

/** NF1 badges: STIMATO for estimated values, PIAN. for planned ones (only where asked), PAUSA for frozen anchors. */
export function SourceBadge({ anchor, source, showPlanned = false }: { anchor?: Anchor | null; source?: Source | null; showPlanned?: boolean }) {
  const { t } = useLive();
  const src = source ?? (anchor !== undefined && anchor !== null && anchor.kind !== 'unknown' ? anchor.source : null);
  const paused = anchor?.kind === 'frozen';
  return (
    <>
      {src === 'estimated' ? <span className="badge badge-estimated">{t('estimated')}</span> : null}
      {src === 'planned' && showPlanned ? <span className="badge badge-planned">{t('planned')}</span> : null}
      {paused ? <span className="badge badge-paused">{t('paused')}</span> : null}
    </>
  );
}
```

`web/src/ui/ConnectionOverlay.tsx`:
```tsx
// SPDX-License-Identifier: GPL-2.0-or-later
import { useEffect } from 'react';
import { useLive, useSnapshot } from './live-context';

/**
 * Connection states the screen must not hide (SPEC §15: "RICONNESSIONE…", never old data shown as current).
 * An incompatible server means this page is older than the server: reload it (kiosk pages run unattended).
 */
export function ConnectionOverlay({ reload = () => location.reload(), reloadAfterMs = 10_000 }: { reload?: () => void; reloadAfterMs?: number }) {
  const { t } = useLive();
  const snap = useSnapshot();
  const incompatible = snap.connection === 'incompatible';

  useEffect(() => {
    if (!incompatible) return undefined;
    const handle = setTimeout(reload, reloadAfterMs);
    return () => clearTimeout(handle);
  }, [incompatible, reload, reloadAfterMs]);

  if (incompatible) {
    return (
      <div className="overlay overlay-full" role="alert">
        {t('incompatible')}
      </div>
    );
  }
  if (!snap.hasView || !snap.synced) {
    return (
      <div className="overlay overlay-full" role="status" aria-live="polite">
        {t('connecting')}
      </div>
    );
  }
  if (snap.stale) {
    return (
      <div className="overlay overlay-stale" role="alert">
        {t('reconnecting')}
      </div>
    );
  }
  return null;
}
```
The incompatible test passes an inline `reload = vi.fn()`, so the effect sees a stable reference. Callers that pass an inline arrow re-arm the timer only when it changes.

- [ ] **Step 4: Run them and verify they pass**

Run: `pnpm test && pnpm typecheck`. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/core/frame-loop.ts web/src/ui web/test/support web/test/ui web/test/core/frame-loop.test.ts
git commit -m "feat(web): react bindings with per-frame dom counters, progress, server wall clock and connection overlay"
```

---

### Task 9: Presenter model — state → screen mapping (pure)

**Files:**
- Create: `web/src/presenter/presenter-model.ts`, `web/test/presenter/presenter-model.test.ts`

**Interfaces:**
- Consumes: `PresenterView`, `Anchor`, `stableTicks`.
- Produces:
  - `type ScreenMode = 'waiting' | 'noepisode' | 'preshow' | 'studio' | 'media' | 'break' | 'imminent' | 'overrun' | 'ended'`;
  - `type Tally = 'none' | 'warn' | 'over' | 'imminent'`;
  - `baseMode(view, ready)`, `preshowAnchor(view)`, `mainAnchor(view, mode)`, `returnTicks(view, at, prev)`, `screenMode(view, ready, retTicks)`, `mainTally(view, mode, ticks)`, `showSide(mode)`.

**The mapping (SPEC §7, §12):**

| Condition, first match wins | Mode | Main counter | Main label |
|---|---|---|---|
| no view yet, or clock not synced | `waiting` | none (only `CONNESSIONE…`) | — |
| view `null` | `noepisode` | none | `NESSUNA PUNTATA CARICATA` |
| `phase === 'preshow'` | `preshow` | countdown to `preshow.plannedStart`, `planned`; `—` without it | `INIZIO PROGRAMMA` |
| `phase === 'ended'` | `ended` | none (static total and offset) | `FINE` |
| `rundownFinished` | `overrun` | `block.anchor` (shows `+m:ss`) | `SCALETTA TERMINATA` |
| `segment` `media`/`break`, and the **displayed** return ticks are between 1 and `returnImminentMs / 1000` | `imminent` | `returnTo.anchor`, full screen, green | `RIENTRO` |
| `segment === 'media'` | `media` | `returnTo.anchor`, else `onAir.anchor` | `RIENTRO TRA` |
| `segment === 'break'` | `break` | `returnTo.anchor`, else `onAir.anchor` | `RIENTRO TRA` |
| otherwise (studio, or a live view without a segment) | `studio` | `block.anchor` (gated: `block` is used only here, BACKLOG) | `BLOCCO n · name` |

| Mode | Tally from the **displayed** ticks |
|---|---|
| `imminent` | `imminent` (green) |
| `overrun` | `over` (red) |
| `studio` | `ticks ≤ 0` → `over`; `ticks · 1000 ≤ warnMs` → `warn` (amber; `1:00` is already amber); else `none` |
| `media`, `break` | `ticks ≤ 0` → `over` (the filler ended but we are not back yet, SPEC §11); else `none` |
| `preshow` | `ticks ≤ 0` → `warn` (late start); else `none` |
| others, or `—` | `none` |

`FUORI SCALETTA` is never a presenter mode: `PresenterView` has no off-script field.

- [ ] **Step 1: Write the failing test**

`web/test/presenter/presenter-model.test.ts`:
```ts
// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import type { PresenterView } from '../../src/core/views';
import {
  baseMode,
  mainAnchor,
  mainTally,
  preshowAnchor,
  returnTicks,
  screenMode,
  showSide,
  type ScreenMode,
} from '../../src/presenter/presenter-model';
import { WALL, breakView, endedView, mediaView, preshowView, studioView } from '../support/views';

describe('baseMode', () => {
  const cases: Array<[string, PresenterView | null, boolean, ScreenMode]> = [
    ['not ready', studioView(), false, 'waiting'],
    ['not ready, no episode', null, false, 'waiting'],
    ['no episode', null, true, 'noepisode'],
    ['preshow', preshowView(), true, 'preshow'],
    ['studio', studioView(), true, 'studio'],
    ['media', mediaView(), true, 'media'],
    ['break', breakView(), true, 'break'],
    ['overrun', studioView({ rundownFinished: true }), true, 'overrun'],
    ['ended', endedView(), true, 'ended'],
    ['live without a segment', studioView({ segment: null }), true, 'studio'],
  ];
  it.each(cases)('%s', (_label, view, ready, mode) => expect(baseMode(view, ready)).toBe(mode));
});

describe('mainAnchor', () => {
  it('uses the block only in studio and overrun', () => {
    expect(mainAnchor(studioView(), 'studio')).toEqual(studioView().block!.anchor);
    expect(mainAnchor(studioView({ rundownFinished: true }), 'overrun')).toEqual(studioView().block!.anchor);
    expect(mainAnchor(studioView({ block: null }), 'studio')).toEqual({ kind: 'unknown' });
  });

  it('uses the return countdown in media and break, never the block (BACKLOG gate)', () => {
    const media = mediaView();
    expect(mainAnchor(media, 'media')).toEqual(media.returnTo!.anchor);
    expect(mainAnchor(media, 'media')).not.toEqual(media.block!.anchor);
    expect(mainAnchor(breakView(), 'imminent')).toEqual(breakView().returnTo!.anchor);
    expect(mainAnchor(breakView({ returnTo: null }), 'break')).toEqual(breakView().onAir!.anchor);
  });

  it('counts to the planned start in preshow, and shows no counter without a show', () => {
    expect(mainAnchor(preshowView(), 'preshow')).toEqual({ kind: 'countdown', endsAt: WALL + 600_000, source: 'planned' });
    expect(preshowAnchor(preshowView({ preshow: { plannedStart: null, totalDurationMs: 1, upcoming: [] } }))).toEqual({ kind: 'unknown' });
    expect(mainAnchor(null, 'noepisode')).toBeNull();
    expect(mainAnchor(endedView(), 'ended')).toBeNull();
  });
});

describe('screenMode (RIENTRO IMMINENTE)', () => {
  const at = (endsAt: number, over: Partial<PresenterView> = {}) =>
    breakView({ returnTo: { blockName: 'Secondo blocco', anchor: { kind: 'countdown', endsAt, source: 'measured' } }, ...over });
  const mode = (view: PresenterView, prev: number | null = null) => screenMode(view, true, returnTicks(view, WALL, prev));

  it('goes full screen in the last returnImminentMs, while the counter is above zero', () => {
    expect(mode(at(WALL + 10_001))).toBe('break'); // 0:11
    expect(mode(at(WALL + 10_000))).toBe('imminent'); // 0:10
    expect(mode(at(WALL + 500))).toBe('imminent'); // 0:01
    expect(mode(at(WALL))).toBe('break'); // +0:00: the filler ended, back to red overrun
    expect(mode(at(WALL + 500, { segment: 'media' }))).toBe('imminent');
  });

  it('imminent keeps its hysteresis', () => {
    expect(mode(at(WALL + 10_100), 10)).toBe('imminent'); // held at 0:10 within 250 ms
    expect(mode(at(WALL + 10_300), 10)).toBe('break');
  });

  it('needs a running return countdown and a positive threshold', () => {
    const frozen = breakView({ returnTo: { blockName: 'Secondo blocco', anchor: { kind: 'frozen', valueMs: 5_000, source: 'measured' } } });
    expect(mode(frozen)).toBe('break');
    expect(mode(breakView({ returnTo: null }))).toBe('break');
    expect(mode(at(WALL + 5_000, { thresholds: { warnMs: 60_000, returnImminentMs: 0 } }))).toBe('break');
    expect(screenMode(studioView(), true, returnTicks(studioView(), WALL, null))).toBe('studio');
    expect(screenMode(at(WALL + 5_000), false, 5)).toBe('waiting');
  });
});

describe('mainTally', () => {
  const v = studioView();
  it.each([
    ['studio, plenty of time', 'studio', 61, 'none'],
    ['studio, 1:00 is amber', 'studio', 60, 'warn'],
    ['studio, last second', 'studio', 1, 'warn'],
    ['studio, overrun', 'studio', 0, 'over'],
    ['media running', 'media', 30, 'none'],
    ['break past the filler', 'break', -3, 'over'],
    ['preshow on time', 'preshow', 600, 'none'],
    ['preshow late', 'preshow', 0, 'warn'],
    ['imminent', 'imminent', 5, 'imminent'],
    ['overrun', 'overrun', -72, 'over'],
    ['unknown value', 'studio', null, 'none'],
  ] as Array<[string, ScreenMode, number | null, string]>)('%s', (_label, mode, ticks, tally) => {
    expect(mainTally(v, mode, ticks)).toBe(tally);
  });

  it('shows the side tiles only while there is a show to follow', () => {
    expect((['preshow', 'studio', 'media', 'break', 'overrun'] as ScreenMode[]).every(showSide)).toBe(true);
    expect((['waiting', 'noepisode', 'imminent', 'ended'] as ScreenMode[]).some(showSide)).toBe(false);
  });
});
```

- [ ] **Step 2: Run it and verify it fails**

Run: `pnpm vitest run web/test/presenter/presenter-model.test.ts`. Expected: FAIL, because the module is missing.

- [ ] **Step 3: Implement** `web/src/presenter/presenter-model.ts`

```ts
// SPDX-License-Identifier: GPL-2.0-or-later
import { stableTicks } from '../core/stable-ticks';
import type { Anchor, PresenterView } from '../core/views';

export type ScreenMode = 'waiting' | 'noepisode' | 'preshow' | 'studio' | 'media' | 'break' | 'imminent' | 'overrun' | 'ended';
export type Tally = 'none' | 'warn' | 'over' | 'imminent';

const UNKNOWN: Anchor = { kind: 'unknown' };

/** The mode from the view alone (SPEC §12). `ready`: a view has arrived and the server clock is synced. */
export function baseMode(view: PresenterView | null, ready: boolean): ScreenMode {
  if (!ready) return 'waiting';
  if (view === null) return 'noepisode';
  if (view.phase === 'preshow') return 'preshow';
  if (view.phase === 'ended') return 'ended';
  if (view.rundownFinished) return 'overrun';
  if (view.segment === 'media') return 'media';
  if (view.segment === 'break') return 'break';
  return 'studio';
}

/** PRE-SHOW: countdown to the planned start, counting up past it; "—" without a planned start. */
export function preshowAnchor(view: PresenterView): Anchor {
  const iso = view.preshow?.plannedStart ?? null;
  const at = iso === null ? Number.NaN : Date.parse(iso);
  return Number.isFinite(at) ? { kind: 'countdown', endsAt: at, source: 'planned' } : UNKNOWN;
}

/** The anchor the main counter shows in each mode; null when the mode has no main counter. */
export function mainAnchor(view: PresenterView | null, mode: ScreenMode): Anchor | null {
  if (view === null) return null;
  switch (mode) {
    case 'preshow':
      return preshowAnchor(view);
    case 'studio':
    case 'overrun':
      return view.block?.anchor ?? UNKNOWN;
    case 'media':
    case 'break':
    case 'imminent':
      return view.returnTo?.anchor ?? view.onAir?.anchor ?? UNKNOWN;
    default:
      return null;
  }
}

/** Displayed ticks of the return countdown at server time `at`; only a running countdown can become imminent. */
export function returnTicks(view: PresenterView | null, at: number, prev: number | null): number | null {
  const anchor = view?.returnTo?.anchor;
  if (anchor === undefined || anchor.kind !== 'countdown') return null;
  return stableTicks(prev, anchor.endsAt - at);
}

/** RIENTRO IMMINENTE: a media/break segment whose displayed return countdown is 1 … returnImminentMs/1000 s. */
export function screenMode(view: PresenterView | null, ready: boolean, retTicks: number | null): ScreenMode {
  const mode = baseMode(view, ready);
  if (
    (mode === 'media' || mode === 'break') &&
    view !== null &&
    retTicks !== null &&
    retTicks >= 1 &&
    retTicks * 1000 <= view.thresholds.returnImminentMs
  ) {
    return 'imminent';
  }
  return mode;
}

/** Tally of the main counter from its displayed ticks, so colour and digits always agree. */
export function mainTally(view: PresenterView | null, mode: ScreenMode, ticks: number | null): Tally {
  if (mode === 'imminent') return 'imminent';
  if (mode === 'overrun') return 'over';
  if (view === null || ticks === null) return 'none';
  switch (mode) {
    case 'studio':
      if (ticks <= 0) return 'over';
      return ticks * 1000 <= view.thresholds.warnMs ? 'warn' : 'none';
    case 'media':
    case 'break':
      return ticks <= 0 ? 'over' : 'none';
    case 'preshow':
      return ticks <= 0 ? 'warn' : 'none';
    default:
      return 'none';
  }
}

/** NEXT and FINE PROGRAMMA (or the PRE-SHOW rundown) are shown while there is a show to follow. */
export function showSide(mode: ScreenMode): boolean {
  return mode === 'preshow' || mode === 'studio' || mode === 'media' || mode === 'break' || mode === 'overrun';
}
```

- [ ] **Step 4: Run it and verify it passes**

Run: `pnpm test && pnpm typecheck`. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/presenter/presenter-model.ts web/test/presenter/presenter-model.test.ts
git commit -m "feat(web): presenter state-to-screen mapping with tick-based tallies and imminent-return hysteresis"
```

---

### Task 10: Presenter monitor — screen, layout, Wake Lock, entry

**Files:**
- Create:
  - `web/src/presenter/PresenterScreen.tsx`, `web/src/presenter/presenter.css`, `web/src/presenter/wake-lock.ts`;
  - `web/test/presenter/presenter-screen.test.tsx`, `web/test/presenter/layout.test.ts`, `web/test/presenter/wake-lock.test.ts`.
- Modify: `web/src/presenter/main.tsx` (replace the placeholder).

**Interfaces:**
- Consumes: the Task 8 bindings, the Task 9 model, `durationText`, `signedText`, `wallText`.
- Produces:
  - `<PresenterScreen />`;
  - `keepScreenAwake(nav?, doc?, report?): () => void`;
  - `WakeLockNavigator`.

**Design (SPEC §7, AC10).** Black background, Multiview-style tiles, colour only as tally on tile borders, labels and the main digits. The main digits also colour, because SPEC §11 asks for a red counter. Wireframes for a 16:9 TV (grid `2fr | 1fr`, rows `1fr | message (auto) | 9vh strip`):

```
STUDIO (data-mode=studio)                                  MEDIA / BREAK (data-mode=media|break)
┌───────────────────────────────┬───────────────┐          ┌───────────────────────────────┬───────────────┐
│ BLOCCO 3 · Secondo blocco [ST]│ NEXT          │          │ RIENTRO TRA              [ST] │ NEXT          │
│                               │ Servizio 2    │          │            1:42               │ Break 1       │
│            8:42               │ 2:00          │          │ SERVIZIO · Servizio 1   1:42  │ 3:00          │
│                               ├───────────────┤          │ ▓▓▓▓▓▓▓░░░░░░░░░░             ├───────────────┤
│     TEMPO RIMANENTE BLOCCO    │ FINE PROGRAMMA│          │ RIENTRO: Primo blocco         │ FINE PROGRAMMA│
│                               │ 41:18         │          │                               │ 41:18         │
│                               │ 14:54:38      │          │                               │ 14:54:38      │
├───────────────────────────────┴───────────────┤          ├───────────────────────────────┴───────────────┤
│ STRINGI                         (msg, if any) │          │ (msg, if any)                                 │
├───────────────────────────────────────────────┤          ├───────────────────────────────────────────────┤
│ 14:13:20  ● REC  ON AIR  RITARDO +0:42  OBS ✓ │          │ 14:13:20  ● REC  ON AIR  RITARDO +0:42  OBS ✓ │
└───────────────────────────────────────────────┘          └───────────────────────────────────────────────┘

RIENTRO IMMINENTE (data-mode=imminent): one green-framed tile over both columns,
"RIENTRO" + green digits at min(60vh, 42vw) + "RIENTRO: <block>"; message row and strip stay.
PRE-SHOW: main = INIZIO PROGRAMMA + countdown + "ORE 19:00:00"; side = one tile SCALETTA (first 4 titles) + DURATA TOTALE.
OLTRE SCALETTA: main = SCALETTA TERMINATA + "+1:12" in red. FINE: main spans both columns: FINE, total "27:12", SCARTO +0:12.
NO EPISODE: main spans both columns: NESSUNA PUNTATA CARICATA. WAITING: only the full-screen CONNESSIONE… overlay.
STALE: everything stays, counters freeze and dim, banner "RICONNESSIONE…" at the top; after 10 s the counters show "—".
```

**Type scale.** All sizes are in viewport units, so the layout is identical on every TV:
- labels `4.5vh` bold uppercase (`3.2vh` in the side tiles, so "FINE PROGRAMMA" plus a badge fits at 16:9);
- badges `2.6vh`;
- main digits `--p-main: min(30vh, 21vw)`;
- side counters `min(10vh, 7vw)`;
- imminent digits `min(60vh, 42vw)`;
- message `6vh`;
- strip `min(4.5vh, 2.4vw)`, so every item fits at 4:3 too;
- borders `0.6vh`.

**AC10:** Inter's figure height is ≈ 0.727 em, so the main digits are ≥ 21.8 % of the screen height at 16:9 and ≥ 20.4 % at 4:3. Longer strings step down through `data-len`, written per frame: 6 characters ×0.85, 7 ×0.72, 8 ×0.64. That range covers `+12:00` to `+1:00:00`, which only happens in long overruns or in pre-show.

**Overflow.** Every grid child is `min-width: 0` plus `overflow: hidden`. Single-line texts use `.label-text` (ellipsis). The NEXT title and the message are clamped to 2 lines. Counters never wrap.

**Kiosk.** `cursor: none` on the root. The Screen Wake Lock is held and taken again whenever the page becomes visible: it needs a secure context, and `127.0.0.1`/`localhost` qualify. A refused request is reported with `console.warn` and ignored.

- [ ] **Step 1: Write the failing tests**

`web/test/presenter/presenter-screen.test.tsx`:
```tsx
// SPDX-License-Identifier: GPL-2.0-or-later
import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { ClientSnapshot } from '../../src/core/ws-client';
import type { Anchor, PresenterView } from '../../src/core/views';
import { PresenterScreen } from '../../src/presenter/PresenterScreen';
import { renderLive } from '../support/render';
import { StaticStore, snapshotOf } from '../support/store';
import { WALL, breakView, controlView, endedView, mediaView, preshowView, studioView } from '../support/views';

const cd = (endsAt: number, source: 'measured' | 'estimated' = 'measured'): Anchor => ({ kind: 'countdown', endsAt, source });

function show(view: PresenterView | null, over: Partial<ClientSnapshot<'presenter'>> = {}, lang: 'it' | 'en' = 'it') {
  const store = new StaticStore(snapshotOf<'presenter'>(view, over));
  const utils = renderLive(<PresenterScreen />, store, lang);
  const q = (sel: string) => utils.container.querySelector<HTMLElement>(sel);
  const text = (sel: string) => q(sel)?.textContent?.trim() ?? null;
  const mode = () => q('.p-root')?.dataset.mode;
  return { ...utils, store, q, text, mode };
}

describe('<PresenterScreen>', () => {
  it('waiting: only CONNESSIONE… and no number before the first view', () => {
    const p = show(null, { hasView: false, synced: false, stale: true });
    expect(p.mode()).toBe('waiting');
    expect(screen.getByRole('status').textContent).toBe('CONNESSIONE…');
    expect(p.container.textContent).not.toMatch(/\d:\d\d/);
  });

  it('waiting: a view without a clock sample shows no number either', () => {
    const p = show(studioView(), { synced: false });
    expect(p.mode()).toBe('waiting');
    expect(p.container.textContent).not.toMatch(/\d:\d\d/);
  });

  it('no episode loaded', () => {
    const p = show(null);
    expect(p.mode()).toBe('noepisode');
    expect(p.text('.p-main .label-text')).toBe('NESSUNA PUNTATA CARICATA');
    expect(p.text('.p-wall')).toBe('14:13:20');
    expect(p.q('.p-next-title')).toBeNull();
  });

  it('PRE-SHOW: countdown to the planned start and the rundown preview', () => {
    const p = show(preshowView());
    expect(p.mode()).toBe('preshow');
    expect(p.text('.p-main .label-text')).toBe('INIZIO PROGRAMMA');
    expect(p.text('.p-main-counter')).toBe('10:00');
    expect(p.text('.p-main .caption')).toBe('ORE 14:23:20');
    expect([...p.container.querySelectorAll('.p-upcoming li')].map((li) => li.textContent)).toEqual([
      'Primo blocco', 'Servizio 1', 'Break 1', 'Secondo blocco',
    ]);
    expect(p.text('.p-side .caption')).toBe('DURATA TOTALE 27:00');
    expect(p.q('.p-delay')).toBeNull();
  });

  it('STUDIO: block countdown, next, program end and status strip', () => {
    const p = show(studioView());
    p.advance(0);
    expect(p.mode()).toBe('studio');
    expect(p.text('.p-main .label-text')).toBe('BLOCCO 3 · Secondo blocco');
    expect(p.text('.p-main-counter')).toBe('8:42');
    expect(p.q('.p-main')!.dataset.tally).toBe('none');
    expect(p.text('.p-main .caption')).toBe('TEMPO RIMANENTE BLOCCO');
    expect(p.text('.p-next-title')).toBe('Servizio 2');
    expect(p.text('.p-next-dur')).toBe('2:00');
    expect(p.text('.p-side-counter')).toBe('41:18');
    expect(p.text('.p-end-wall')).toBe('14:54:38');
    expect(p.text('.p-wall')).toBe('14:13:20');
    expect(p.text('.p-delay')).toBe('RITARDO +0:42');
    expect(p.text('.p-obs')).toBe('OBS ✓');
    const outs = [...p.container.querySelectorAll<HTMLElement>('.p-out')];
    expect(outs.map((o) => [o.textContent, o.dataset.on])).toEqual([['REC', 'true'], ['ON AIR', 'false']]);
  });

  it('AVVISO then SFORAMENTO: amber from 1:00, red and counting up past zero', () => {
    const p = show(studioView({ block: { index: 2, name: 'Secondo blocco', anchor: cd(WALL + 61_000) } }));
    p.advance(0);
    expect(p.text('.p-main-counter')).toBe('1:01');
    expect(p.q('.p-main')!.dataset.tally).toBe('none');
    p.advance(1_000);
    expect(p.text('.p-main-counter')).toBe('1:00');
    expect(p.q('.p-main')!.dataset.tally).toBe('warn');
    p.advance(60_000);
    expect(p.text('.p-main-counter')).toBe('+0:00');
    expect(p.q('.p-main')!.dataset.tally).toBe('over');
    p.advance(72_000);
    expect(p.text('.p-main-counter')).toBe('+1:12');
  });

  it('SERVIZIO: return countdown, what is on air with progress, the block is not shown', () => {
    const p = show(mediaView());
    expect(p.mode()).toBe('media');
    expect(p.text('.p-main .label-text')).toBe('RIENTRO TRA');
    expect(p.text('.p-main-counter')).toBe('1:42');
    expect(p.text('.p-onair-head .label-text')).toBe('SERVIZIO · Servizio 1');
    expect(p.text('.p-onair-counter')).toBe('1:42');
    expect(p.text('.p-return')).toBe('RIENTRO: Primo blocco');
    expect(p.container.textContent).not.toContain('BLOCCO 1');
    const fill = p.q('.progress-fill')!;
    expect(Number(/scaleX\(([\d.]+)\)/.exec(fill.style.transform)![1])).toBeCloseTo(83 / 185, 3);
    expect(p.text('.p-next-title')).toBe('Break 1');
  });

  it('BREAK: filler on air and the block to return to', () => {
    const p = show(breakView());
    expect(p.mode()).toBe('break');
    expect(p.text('.p-main-counter')).toBe('2:00');
    expect(p.text('.p-onair-head .label-text')).toBe('BREAK · Break 1');
    expect(p.text('.p-return')).toBe('RIENTRO: Secondo blocco');
  });

  it('RIENTRO IMMINENTE: full-screen green countdown, then red overrun after zero', () => {
    const p = show(breakView({ returnTo: { blockName: 'Secondo blocco', anchor: cd(WALL + 9_500) }, onAir: { title: 'Break 1', anchor: cd(WALL + 9_500), startedAtWall: WALL - 170_000, durationMs: 180_000 } }));
    expect(p.mode()).toBe('imminent');
    expect(p.text('.p-imminent-counter')).toBe('0:10');
    expect(p.q('.p-imminent')!.dataset.tally).toBe('imminent');
    expect(p.text('.p-imminent .p-return')).toBe('RIENTRO: Secondo blocco');
    expect(p.q('.p-next-title')).toBeNull();
    p.advance(9_600);
    expect(p.mode()).toBe('break');
    expect(p.text('.p-main-counter')).toBe('+0:00');
    p.advance(0);
    expect(p.q('.p-main')!.dataset.tally).toBe('over');
  });

  it('imminent boundary does not flicker on a re-anchor', () => {
    const at = (endsAt: number) => breakView({ returnTo: { blockName: 'Secondo blocco', anchor: cd(endsAt) } });
    const p = show(at(WALL + 10_100));
    expect(p.mode()).toBe('break');
    expect(p.text('.p-main-counter')).toBe('0:11');
    p.advance(200);
    expect(p.mode()).toBe('imminent');
    p.update({ view: at(WALL + 10_250) }); // the deck re-anchors 150 ms later: raw 10.05 s, still within the hysteresis
    expect(p.mode()).toBe('imminent');
    expect(p.text('.p-imminent-counter')).toBe('0:10');
  });

  it('OLTRE SCALETTA: rundown finished, positive red counter', () => {
    const p = show(studioView({ rundownFinished: true, block: { index: 3, name: 'Chiusura', anchor: cd(WALL - 72_000) } }));
    p.advance(0);
    expect(p.mode()).toBe('overrun');
    expect(p.text('.p-main .label-text')).toBe('SCALETTA TERMINATA');
    expect(p.text('.p-main-counter')).toBe('+1:12');
    expect(p.q('.p-main')!.dataset.tally).toBe('over');
  });

  it('FINE: total duration and final offset, no live delay', () => {
    const p = show(endedView());
    expect(p.mode()).toBe('ended');
    expect(p.text('.p-main .label-text')).toBe('FINE');
    expect(p.text('.p-ended-total')).toBe('27:12');
    expect(p.text('.p-main .caption')).toBe('SCARTO +0:12');
    expect(p.q('.p-delay')).toBeNull();
    expect(p.q('.p-next-title')).toBeNull();
  });

  it('OBS lost: warning in the strip and STIMATO on estimated values', () => {
    const p = show(
      studioView({
        block: { index: 2, name: 'Secondo blocco', anchor: cd(WALL + 522_000, 'estimated') },
        delay: { ms: 42_000, source: 'estimated' },
        status: { rec: true, stream: false, recPaused: false, obs: 'lost', control: 'auto' },
      }),
    );
    expect(p.text('.p-obs')).toBe('⚠ OBS NON CONNESSO');
    expect(p.q('.p-obs')!.dataset.ok).toBe('false');
    expect(p.text('.p-main .badge-estimated')).toBe('STIMATO');
    expect(p.q('.p-main-counter')!.dataset.source).toBe('estimated');
    expect(p.text('.p-delay')).toBe('RITARDO +0:42STIMATO');
  });

  it('paused: a frozen counter with PAUSA, and REC paused in the strip', () => {
    const p = show(
      studioView({
        block: { index: 2, name: 'Secondo blocco', anchor: { kind: 'frozen', valueMs: 300_000, source: 'measured' } },
        status: { rec: true, stream: false, recPaused: true, obs: 'ok', control: 'auto' },
      }),
    );
    expect(p.text('.p-main-counter')).toBe('5:00');
    expect(p.text('.p-main .badge-paused')).toBe('PAUSA');
    p.advance(5_000);
    expect(p.text('.p-main-counter')).toBe('5:00');
    expect(p.text('.p-out')).toBe('REC PAUSA');
  });

  it('unknown values show "—"', () => {
    const p = show(studioView({ next: null, programEnd: null, delay: null }));
    expect(p.text('.p-next-title')).toBe('—');
    expect(p.text('.p-side-counter')).toBe('—');
    expect(p.text('.p-delay')).toBe('RITARDO —');
  });

  it('shows the director message in its own row', () => {
    show(studioView({ message: { text: 'STRINGI' } }));
    expect(screen.getByRole('status').textContent).toBe('STRINGI');
  });

  it('stale: RICONNESSIONE…, counters frozen, then "—" after 10 s', () => {
    const p = show(studioView(), { stale: true, staleSince: WALL });
    expect(screen.getByRole('alert').textContent).toBe('RICONNESSIONE…');
    expect(p.text('.p-main-counter')).toBe('8:42');
    p.advance(3_000);
    expect(p.text('.p-main-counter')).toBe('8:42');
    expect(p.q('.p-main-counter')!.dataset.stale).toBe('true');
    p.advance(8_000);
    expect(p.text('.p-main-counter')).toBe('—');
  });

  it('never shows FUORI SCALETTA to the presenter', () => {
    const control = controlView({ offScript: { scene: 'CAMERA OSPITE', sinceWall: WALL } });
    const p = show(control.presenter);
    expect(p.container.textContent).not.toContain('FUORI SCALETTA');
    expect(p.container.textContent).not.toContain('CAMERA OSPITE');
  });

  it('speaks English with ?lang=en', () => {
    const p = show(studioView(), {}, 'en');
    expect(p.text('.p-main .label-text')).toBe('BLOCK 3 · Secondo blocco');
    expect(p.text('.p-main .caption')).toBe('BLOCK TIME LEFT');
    expect(p.text('.p-delay')).toBe('DELAY +0:42');
  });
});
```

`web/test/presenter/layout.test.ts`:
```ts
// SPDX-License-Identifier: GPL-2.0-or-later
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const presenterCss = readFileSync(join(__dirname, '../../src/presenter/presenter.css'), 'utf8');
const baseCss = readFileSync(join(__dirname, '../../src/ui/base.css'), 'utf8');

/** The declaration block of `selector` (written exactly as `<selector> {` in the stylesheet). */
function rule(css: string, selector: string): string {
  const start = css.indexOf(`${selector} {`);
  expect(start, selector).toBeGreaterThanOrEqual(0);
  return css.slice(start, css.indexOf('}', start));
}

describe('presenter layout rules', () => {
  it('AC10: the main digits are at least 20 % of the screen height on 16:9 and 4:3', () => {
    const m = /--p-main:\s*min\((\d+(?:\.\d+)?)vh,\s*(\d+(?:\.\d+)?)vw\)/.exec(presenterCss);
    expect(m).not.toBeNull();
    const [vh, vw] = [Number(m![1]), Number(m![2])];
    const INTER_FIGURE_HEIGHT_EM = 0.727;
    for (const aspect of [16 / 9, 4 / 3]) {
      const fontVh = Math.min(vh, vw * aspect);
      expect(fontVh * INTER_FIGURE_HEIGHT_EM, `aspect ${aspect.toFixed(2)}`).toBeGreaterThanOrEqual(20);
    }
  });

  it('never overflows: a hidden-overflow grid of shrinkable tiles, ellipsis and 2-line clamps', () => {
    const root = rule(presenterCss, '.p-root');
    expect(root).toContain('overflow: hidden');
    expect(root).toContain('cursor: none');
    expect(root).toContain('grid-template-columns: minmax(0, 2fr) minmax(0, 1fr)');
    expect(root).toContain('font-variant-numeric: tabular-nums');
    const tile = rule(presenterCss, '.p-root .tile');
    expect(tile).toContain('min-width: 0');
    expect(tile).toContain('overflow: hidden');
    expect(rule(presenterCss, '.p-next-title')).toContain('-webkit-line-clamp: 2');
    expect(rule(presenterCss, '.p-msg')).toContain('-webkit-line-clamp: 2');
    expect(rule(baseCss, '.label-text')).toContain('text-overflow: ellipsis');
    expect(rule(baseCss, '.counter')).toContain('white-space: nowrap');
  });

  it('steps long counters down by length', () => {
    for (const len of ['6', '7', '8']) expect(presenterCss).toContain(`.p-main-counter[data-len='${len}']`);
  });

  it('uses only colour tokens (no literal colours) for tallies', () => {
    expect(presenterCss).not.toMatch(/#[0-9a-fA-F]{3,6}\b/);
    expect(presenterCss).toContain("[data-tally='warn']");
    expect(presenterCss).toContain("[data-tally='over']");
    expect(presenterCss).toContain("[data-tally='imminent']");
  });
});
```

`web/test/presenter/wake-lock.test.ts`:
```ts
// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it, vi } from 'vitest';
import { keepScreenAwake } from '../../src/presenter/wake-lock';

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function fakeDoc(visibilityState: DocumentVisibilityState = 'visible') {
  const target = new EventTarget();
  return {
    visibilityState,
    addEventListener: target.addEventListener.bind(target),
    removeEventListener: target.removeEventListener.bind(target),
    fire: () => target.dispatchEvent(new Event('visibilitychange')),
  };
}

function fakeNav(fail = false) {
  const sentinels: Array<{ released: boolean; release: () => Promise<void> }> = [];
  const request = vi.fn(async (_type: 'screen') => {
    if (fail) throw new Error('NotAllowedError');
    const s = { released: false, release: async () => { s.released = true; } };
    sentinels.push(s);
    return s;
  });
  return { nav: { wakeLock: { request } }, request, sentinels };
}

describe('keepScreenAwake', () => {
  it('holds a screen wake lock and takes it again when the page becomes visible', async () => {
    const doc = fakeDoc();
    const { nav, request, sentinels } = fakeNav();
    const stop = keepScreenAwake(nav, doc, () => {});
    await flush();
    expect(request).toHaveBeenCalledWith('screen');
    sentinels[0]!.released = true; // the browser drops it while the page is hidden
    doc.fire();
    await flush();
    expect(request).toHaveBeenCalledTimes(2);
    doc.fire();
    await flush();
    expect(request).toHaveBeenCalledTimes(2); // still held: no new request
    stop();
    expect(sentinels[1]!.released).toBe(true);
  });

  it('waits for the page to be visible', async () => {
    const { nav, request } = fakeNav();
    keepScreenAwake(nav, fakeDoc('hidden'), () => {});
    await flush();
    expect(request).not.toHaveBeenCalled();
  });

  it('does nothing without the API and reports a refused request', async () => {
    expect(() => keepScreenAwake({}, fakeDoc(), () => {})()).not.toThrow();
    const reports: unknown[] = [];
    keepScreenAwake(fakeNav(true).nav, fakeDoc(), (e) => reports.push(e));
    await flush();
    expect(reports).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run them and verify they fail**

Run: `pnpm vitest run web/test/presenter`. Expected: FAIL, because the modules are missing.

- [ ] **Step 3: Implement**

`web/src/presenter/PresenterScreen.tsx`:
```tsx
// SPDX-License-Identifier: GPL-2.0-or-later
import { useRef } from 'react';
import type { AnchorFrame } from '../core/anchor';
import type { Translate } from '../core/i18n';
import { durationText, signedText, wallText } from '../core/time-format';
import type { PresenterView } from '../core/views';
import { AnchoredProgress } from '../ui/AnchoredProgress';
import { AnchoredTime } from '../ui/AnchoredTime';
import { AnchoredWall } from '../ui/AnchoredWall';
import { ConnectionOverlay } from '../ui/ConnectionOverlay';
import { SourceBadge } from '../ui/SourceBadge';
import { useFrameValue, useLive, useSnapshot } from '../ui/live-context';
import { mainAnchor, mainTally, returnTicks, screenMode, showSide, type ScreenMode } from './presenter-model';

/** SPEC §7 presenter monitor. Structure re-renders only on view/snapshot/mode changes; counters repaint per frame. */
export function PresenterScreen() {
  const { store } = useLive();
  const snap = useSnapshot<'presenter'>();
  const view = snap.view;
  const ready = snap.hasView && snap.synced;
  const staleAt = snap.stale && snap.staleSince !== null ? snap.staleSince : null;
  const prevReturn = useRef<number | null>(null);
  const mode = useFrameValue<ScreenMode>(() => {
    const now = store.serverNow();
    const ticks = now === null ? null : returnTicks(view, staleAt ?? now, prevReturn.current);
    prevReturn.current = ticks;
    return screenMode(view, ready, ticks);
  });

  if (mode === 'waiting') {
    return (
      <div className="p-root" data-mode="waiting">
        <ConnectionOverlay />
      </div>
    );
  }
  return (
    <div className="p-root" data-mode={mode}>
      {mode === 'imminent' && view !== null ? (
        <ImminentTile view={view} seedTicks={prevReturn.current} />
      ) : (
        <>
          <MainTile view={view} mode={mode} />
          {showSide(mode) && view !== null ? <SideTiles view={view} mode={mode} /> : null}
        </>
      )}
      {view?.message ? (
        <div className="p-msg" role="status" aria-live="polite">
          {view.message.text}
        </div>
      ) : null}
      <StatusStrip view={view} />
      <ConnectionOverlay />
    </div>
  );
}

function mainLabel(view: PresenterView | null, mode: ScreenMode, t: Translate): string {
  switch (mode) {
    case 'preshow':
      return t('programStart');
    case 'studio':
      return view?.block ? t('block', { n: view.block.index + 1, name: view.block.name }) : t('blockRemaining');
    case 'media':
    case 'break':
      return t('returnIn');
    case 'overrun':
      return t('rundownFinished');
    case 'ended':
      return t('ended');
    default:
      return t('noEpisode');
  }
}

function MainTile({ view, mode }: { view: PresenterView | null; mode: ScreenMode }) {
  const { t, timeZone } = useLive();
  const tileRef = useRef<HTMLElement>(null);
  const anchor = mainAnchor(view, mode);
  const tally = (frame: AnchorFrame) => mainTally(view, mode, frame.ticks);
  const plannedStart = view?.preshow?.plannedStart ?? null;
  return (
    <section className="tile p-main" ref={tileRef} data-tally="none">
      <div className="label">
        <span className="label-text">{mainLabel(view, mode, t)}</span>
        {anchor !== null ? <SourceBadge anchor={anchor} /> : null}
      </div>
      {anchor !== null ? <AnchoredTime anchor={anchor} className="counter p-main-counter" tally={tally} tallyRef={tileRef} /> : null}
      {mode === 'studio' && view?.block ? <div className="caption">{t('blockRemaining')}</div> : null}
      {mode === 'preshow' && plannedStart !== null ? (
        <div className="caption">{t('plannedAt', { time: wallText(Date.parse(plannedStart), timeZone) })}</div>
      ) : null}
      {(mode === 'media' || mode === 'break') && view?.onAir ? <OnAirRow view={view} mode={mode} /> : null}
      {mode === 'ended' ? <EndedSummary view={view} /> : null}
    </section>
  );
}

function OnAirRow({ view, mode }: { view: PresenterView; mode: 'media' | 'break' }) {
  const { t } = useLive();
  const onAir = view.onAir!;
  return (
    <div className="p-onair">
      <div className="p-onair-head">
        <span className="label-text">{t(mode === 'media' ? 'onAirMedia' : 'onAirBreak', { title: onAir.title })}</span>
        <SourceBadge anchor={onAir.anchor} />
        <AnchoredTime anchor={onAir.anchor} className="counter p-onair-counter" />
      </div>
      <AnchoredProgress anchor={onAir.anchor} durationMs={onAir.durationMs} />
      {view.returnTo ? <div className="p-return label-text">{t('returnTo', { name: view.returnTo.blockName })}</div> : null}
    </div>
  );
}

function EndedSummary({ view }: { view: PresenterView | null }) {
  const { t } = useLive();
  const ended = view?.ended ?? null;
  const total = ended === null ? '—' : durationText(ended.totalMs);
  return (
    <>
      <div className="counter p-main-counter p-ended-total" data-len={total.length}>
        {total}
      </div>
      <div className="caption">
        {t('endedOffset', { d: ended === null ? '—' : signedText(ended.finalOffsetMs) })}
        {ended !== null ? <SourceBadge source={ended.source} /> : null}
      </div>
    </>
  );
}

function SideTiles({ view, mode }: { view: PresenterView; mode: ScreenMode }) {
  const { t, timeZone } = useLive();
  if (mode === 'preshow') {
    const preshow = view.preshow;
    return (
      <aside className="p-side p-side-single">
        <section className="tile">
          <div className="label">
            <span className="label-text">{t('rundown')}</span>
          </div>
          <ol className="p-upcoming">
            {(preshow?.upcoming ?? []).map((title, i) => (
              <li key={`${i}-${title}`} className="label-text">
                {title}
              </li>
            ))}
          </ol>
          <div className="caption">{t('totalDuration', { d: preshow === null ? '—' : durationText(preshow.totalDurationMs) })}</div>
        </section>
      </aside>
    );
  }
  const { next, programEnd } = view;
  return (
    <aside className="p-side">
      <section className="tile p-next">
        <div className="label">
          <span className="label-text">{t('next')}</span>
        </div>
        <div className="p-next-title">{next === null ? '—' : next.title}</div>
        {next !== null ? (
          <div className="p-next-dur">
            {durationText(next.durationMs)}
            <SourceBadge source={next.source} />
          </div>
        ) : null}
      </section>
      <section className="tile p-end">
        <div className="label">
          <span className="label-text">{t('programEnd')}</span>
          {programEnd !== null ? <SourceBadge anchor={programEnd.anchor} /> : null}
        </div>
        {programEnd !== null ? (
          <>
            <AnchoredTime anchor={programEnd.anchor} className="counter p-side-counter" />
            <div className="p-end-wall">{programEnd.endsAtWall === null ? '—' : wallText(programEnd.endsAtWall, timeZone)}</div>
          </>
        ) : (
          <div className="counter p-side-counter">—</div>
        )}
      </section>
    </aside>
  );
}

function ImminentTile({ view, seedTicks }: { view: PresenterView; seedTicks: number | null }) {
  const { t } = useLive();
  const ret = view.returnTo!;
  return (
    <section className="tile p-imminent" data-tally="imminent">
      <div className="label">
        <span className="label-text">{t('returnImminent')}</span>
        <SourceBadge anchor={ret.anchor} />
      </div>
      <AnchoredTime anchor={ret.anchor} className="counter p-imminent-counter" seedTicks={seedTicks} />
      <div className="p-return label-text">{t('returnTo', { name: ret.blockName })}</div>
    </section>
  );
}

function StatusStrip({ view }: { view: PresenterView | null }) {
  const { t } = useLive();
  return (
    <footer className="p-strip">
      <AnchoredWall className="p-wall" />
      {view !== null ? (
        <>
          <span className="p-out" data-on={String(view.status.rec)}>
            {view.status.recPaused ? `${t('rec')} ${t('paused')}` : t('rec')}
          </span>
          <span className="p-out" data-on={String(view.status.stream)}>
            {t('onAir')}
          </span>
          {view.phase === 'live' ? (
            <span className="p-delay">
              {`${t('delay')} ${view.delay === null ? '—' : signedText(view.delay.ms)}`}
              {view.delay !== null ? <SourceBadge source={view.delay.source} showPlanned /> : null}
            </span>
          ) : null}
          <span className="p-obs" data-ok={String(view.status.obs === 'ok')}>
            {view.status.obs === 'ok' ? t('obsOk') : t('obsLost')}
          </span>
        </>
      ) : null}
    </footer>
  );
}
```

`web/src/presenter/presenter.css`:
```css
/* SPDX-License-Identifier: GPL-2.0-or-later */
/*
 * Presenter monitor (SPEC §7, AC10): a 16:9 TV read at ~4 m; still fits 4:3. Main tile 2/3, side tiles 1/3,
 * message row only when present, 9vh status strip. Main digits min(30vh, 21vw): Inter figures are ~0.727 em tall,
 * so ≥ 21.8 % of the screen height at 16:9 and ≥ 20.4 % at 4:3. Colours come only from the tokens.
 */
.p-root {
  --p-gap: 1vh;
  --p-strip-h: 9vh;
  --p-label: 4.5vh;
  --p-border: 0.6vh;
  --p-main: min(30vh, 21vw);
  --p-side: min(10vh, 7vw);
  --p-imminent: min(60vh, 42vw);
  position: fixed;
  inset: 0;
  overflow: hidden;
  cursor: none;
  display: grid;
  gap: var(--p-gap);
  padding: var(--p-gap);
  grid-template-columns: minmax(0, 2fr) minmax(0, 1fr);
  grid-template-rows: minmax(0, 1fr) auto var(--p-strip-h);
  grid-template-areas: 'main side' 'msg msg' 'strip strip';
  background: var(--bg);
  color: var(--fg);
  font-family: var(--font);
  font-variant-numeric: tabular-nums;
}
.p-root .tile {
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  gap: 1vh;
  padding: 1.5vh 2vh;
  border: var(--p-border) solid var(--tile-border);
  border-radius: 1vh;
}
.p-root .label {
  display: flex;
  align-items: center;
  gap: 1.5vh;
  min-width: 0;
  font-size: var(--p-label);
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--fg-dim);
}
.p-root .caption {
  font-size: 3.5vh;
  font-weight: 700;
  color: var(--fg-dim);
  text-align: center;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.p-main { grid-area: main; justify-content: space-between; }
.p-main-counter { font-size: var(--p-main); text-align: center; align-self: center; }
.p-main-counter[data-len='6'] { font-size: calc(var(--p-main) * 0.85); }
.p-main-counter[data-len='7'] { font-size: calc(var(--p-main) * 0.72); }
.p-main-counter[data-len='8'] { font-size: calc(var(--p-main) * 0.64); }
.p-root[data-mode='noepisode'] .p-main,
.p-root[data-mode='ended'] .p-main { grid-column: 1 / -1; }
.p-side {
  grid-area: side;
  display: grid;
  grid-template-rows: minmax(0, 1fr) minmax(0, 1fr);
  gap: var(--p-gap);
  min-width: 0;
  min-height: 0;
}
.p-side-single { grid-template-rows: minmax(0, 1fr); }
.p-root .p-side .label { font-size: 3.2vh; }
.p-root .badge { font-size: 2.6vh; margin-left: 0.6vh; }
.p-next-title {
  font-size: 5vh;
  font-weight: 700;
  line-height: 1.15;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  overflow-wrap: anywhere;
}
.p-next-dur { display: flex; align-items: center; gap: 1.5vh; font-size: var(--p-side); font-weight: 700; }
.p-side-counter { font-size: var(--p-side); }
.p-end-wall { font-size: 4.5vh; font-weight: 700; color: var(--fg-dim); }
.p-upcoming {
  margin: 0;
  padding-left: 1.2em;
  display: flex;
  flex-direction: column;
  gap: 0.6vh;
  min-width: 0;
  font-size: 4vh;
  font-weight: 700;
}
.p-onair { display: flex; flex-direction: column; gap: 1vh; min-width: 0; }
.p-onair-head { display: flex; align-items: baseline; gap: 2vh; min-width: 0; font-size: 4.5vh; font-weight: 700; }
.p-onair-counter { font-size: 6vh; margin-left: auto; }
.p-return { font-size: 4.5vh; font-weight: 700; }
.p-imminent { grid-column: 1 / -1; grid-row: 1; justify-content: center; align-items: center; }
.p-root .p-imminent .counter { font-size: var(--p-imminent); color: var(--green); }
.p-root .p-imminent .label,
.p-root .p-imminent .p-return { color: var(--green); }
.p-msg {
  grid-area: msg;
  background: var(--msg-bg);
  color: var(--fg);
  font-size: 6vh;
  font-weight: 700;
  line-height: 1.15;
  padding: 1vh 2vh;
  border-radius: 1vh;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  overflow-wrap: anywhere;
}
.p-strip {
  grid-area: strip;
  display: flex;
  align-items: center;
  gap: min(4vh, 2vw);
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  padding: 0 2vh;
  font-size: min(4.5vh, 2.4vw);
  font-weight: 700;
  border: var(--p-border) solid var(--tile-border);
  border-radius: 1vh;
}
.p-out[data-on='false'] { color: var(--fg-off); }
.p-out[data-on='true']::before { content: '●'; color: var(--red); margin-right: 0.3em; }
.p-obs { margin-left: auto; }
.p-obs[data-ok='false'] { color: var(--amber); }
/* Tally (SPEC §7, §12): border, label and main digits of the tile. */
.p-root .tile[data-tally='warn'] { border-color: var(--amber); }
.p-root .tile[data-tally='warn'] .label,
.p-root .tile[data-tally='warn'] .p-main-counter { color: var(--amber); }
.p-root .tile[data-tally='over'] { border-color: var(--red); }
.p-root .tile[data-tally='over'] .label,
.p-root .tile[data-tally='over'] .p-main-counter { color: var(--red); }
.p-root .tile[data-tally='imminent'] { border-color: var(--green); }
.p-root .overlay-full { font-size: 8vh; }
.p-root .overlay-stale { top: 2vh; font-size: 6vh; padding: 1vh 4vh; border-width: var(--p-border); }
```

`web/src/presenter/wake-lock.ts`:
```ts
// SPDX-License-Identifier: GPL-2.0-or-later

interface SentinelLike {
  readonly released: boolean;
  release(): Promise<void>;
}

/** The part of `navigator` used here; `wakeLock` is missing outside secure contexts (e.g. plain http on a LAN IP). */
export interface WakeLockNavigator {
  wakeLock?: { request(type: 'screen'): Promise<SentinelLike> };
}

type VisibilityDoc = Pick<Document, 'visibilityState' | 'addEventListener' | 'removeEventListener'>;

/**
 * Keeps the kiosk screen on (TECH-DESIGN §8). The browser drops the lock whenever the page is hidden, so it is
 * taken again on every visibility change. Failures are reported and otherwise ignored. Returns a stop function.
 */
export function keepScreenAwake(
  nav: WakeLockNavigator = navigator as unknown as WakeLockNavigator,
  doc: VisibilityDoc = document,
  report: (err: unknown) => void = (err) => console.warn('Screen Wake Lock unavailable', err),
): () => void {
  const api = nav.wakeLock;
  if (api === undefined) return () => {};
  let sentinel: SentinelLike | null = null;
  let stopped = false;
  const acquire = () => {
    if (stopped || doc.visibilityState !== 'visible' || (sentinel !== null && !sentinel.released)) return;
    api.request('screen').then((s) => {
      if (stopped) void s.release();
      else sentinel = s;
    }, report);
  };
  doc.addEventListener('visibilitychange', acquire);
  acquire();
  return () => {
    stopped = true;
    doc.removeEventListener('visibilitychange', acquire);
    if (sentinel !== null) void sentinel.release().catch(report);
  };
}
```

`web/src/presenter/main.tsx` (replaces the placeholder):
```tsx
// SPDX-License-Identifier: GPL-2.0-or-later
import { createRoot } from 'react-dom/client';
import '../ui/fonts';
import '../ui/base.css';
import './presenter.css';
import { browserFrameLoop } from '../core/frame-loop';
import { parseParams } from '../core/params';
import { LiveClient, wsUrl } from '../core/ws-client';
import { LiveProvider } from '../ui/live-context';
import { installTokens } from '../ui/tokens';
import { PresenterScreen } from './PresenterScreen';
import { keepScreenAwake } from './wake-lock';

const params = parseParams(location.search);
installTokens();
document.documentElement.lang = params.lang;
document.title = params.screen === null ? 'OBS Live Clock · Presenter' : `OBS Live Clock · Presenter · ${params.screen}`;

const client = new LiveClient({ url: wsUrl(location), role: 'presenter' });
client.start();
keepScreenAwake();

createRoot(document.getElementById('root')!).render(
  <LiveProvider store={client} frames={browserFrameLoop()} lang={params.lang}>
    <PresenterScreen />
  </LiveProvider>,
);
```

- [ ] **Step 4: Run them and verify they pass; build**

Run: `pnpm test && pnpm typecheck && pnpm --filter @olc/web build`. Expected: PASS, and the build succeeds.

- [ ] **Step 5: Commit**

```bash
git add web/src/presenter web/test/presenter
git commit -m "feat(web): presenter monitor with multiview tiles, tally colours, imminent return, wake lock and kiosk cursor"
```

---

### Task 11: OBS dock — status, alerts and decisions, messages, guarded emergency controls

**Files:**
- Create:
  - `web/src/core/http.ts`;
  - `web/src/ui/control/ConfirmButton.tsx`, `useCommand.ts`, `CommandFeedback.tsx`, `useObsStatus.ts`, `StatusPanel.tsx`, `Alerts.tsx`, `MessagePanel.tsx`, `EmergencyPanel.tsx`, `panels.css`;
  - `web/src/dock/DockScreen.tsx`, `web/src/dock/dock.css`;
  - `web/test/support/api.ts`, `web/test/core/http.test.ts`, `web/test/dock/dock.test.tsx`.
- Modify: `web/src/dock/main.tsx` (replace the placeholder).

**Interfaces:**
- Consumes: the Task 8 bindings, the Task 9 model (`baseMode`, `mainAnchor`, `mainTally`), `DECISION_CHOICES`, `ClientCommand`, `CommandError`.
- Produces:
  - `http.ts`: `EpisodeSummary`, `ObsStatusLite`, `ApiClient { listEpisodes; loadEpisode; obsStatus }`, `ApiError { status; code }`, `httpApi(fetchFn?)`;
  - `ConfirmButton.tsx`: `CONFIRM_WINDOW_MS = 1_500`, `LONG_PRESS_MS = 800`, `<ConfirmButton label onConfirm disabled? danger? pressed?>`;
  - `useCommand.ts`: `FEEDBACK_MS = 3_000`, `Feedback`, `useCommand(): { run(command): Promise<boolean>; feedback }`;
  - `CommandFeedback.tsx`: `<CommandFeedback feedback>`;
  - `useObsStatus.ts`: `OBS_STATUS_POLL_MS = 5_000`, `useObsStatus(api, intervalMs?)`;
  - `StatusPanel.tsx`: `<StatusPanel view>`, `phaseKey(presenterView)`;
  - `Alerts.tsx`: `<Alerts view obs run>`;
  - `MessagePanel.tsx`: `<MessagePanel view run>`;
  - `EmergencyPanel.tsx`: `<EmergencyPanel view run>`;
  - `DockScreen.tsx`: `<DockScreen api? search?>`.
- Produces (test support): `fakeApi(over?)`.

**Rules (SPEC §8, F13, F15, F16, DT-9; TECH-DESIGN §8):**
- **Layout.** The dock is vertical and works from 300 px wide, with panels in this order:
  1. status;
  2. alerts and decisions;
  3. messages;
  4. the Emergency section (`<details>`, closed by default);
  5. command feedback;
  6. the link `Apri vista estesa` → `/control` plus the page's own query string, in a new tab.
- **Role.** The dock uses role `control`.
- **Status panel.**
  - Badges: phase (`PRE-SHOW`/`LIVE`/`OLTRE SCALETTA`/`FINE`), segment while live (`STUDIO`/`SERVIZIO`/`BREAK`), `MANUALE` when control is manual, and the OBS indicator.
  - The current item with its counter, coloured with the same tally rule as the presenter: block in studio, `IN ONDA: <title>` plus the return countdown in media or break, `INIZIO PROGRAMMA` plus the planned-start countdown in pre-show.
  - `RIENTRO: <block>` in media or break.
  - `RITARDO ±m:ss` with its source (only while live, otherwise `—`).
  - `FINE PROGRAMMA <countdown> · <wall time>`.
- **Alerts** (`role="alert"`), in this order:
  1. OBS authentication failed, from `GET /api/obs/status`, polled every 5 s;
  2. `⚠ OBS NON CONNESSO` (view);
  3. Playlist Deck absent, or legacy (< 1.4.0), when OBS is connected;
  4. `FUORI SCALETTA: <scene> dalle <time>`;
  5. `POSIZIONE INCERTA`.

  A failed status poll shows nothing: unknown means no claim.
- **Decisions.** Every unconfirmed decision lists its choices from `DECISION_CHOICES`, with the current choice (the default the engine already applied) pressed (`aria-pressed`). A click sends `resolve_decision`. The `end` choice ends the program, so it is a `ConfirmButton`. Confirmed decisions are not listed in the dock.
- **Messages.**
  - One button per preset, labelled `<slot> · <text>`, where slot = index + 1 is the DT-9 hotkey slot. It sends the preset's text and dismiss rule.
  - Free text: max 200 characters, sent with `{ kind: 'manual' }`, and cleared once the command reports a change.
  - `CLEAR` is enabled only while a message is on air.
  - The current message is shown as `In onda: <text>`.
- **Emergency** (F16). Every button is a `ConfirmButton`:
  - `START PROGRAM`, enabled only in pre-show;
  - `PREV`, `NEXT`, `−<step>`, `+<step>` (step = `presets.adjustStepMs`, label `durationText`) and `END PROGRAM` (danger), enabled only while live;
  - `MANUALE`/`AUTO`, which toggles `set_control` and is enabled whenever an episode is loaded.
- **`ConfirmButton`.**
  - First click arms the button for 1.5 s; the text becomes `Premi di nuovo per confermare`. A second click within the window fires.
  - Or a press held for 800 ms fires, and the click that follows is ignored.
  - The accessible name stays the action label.
- **Feedback** (BACKLOG `ack` logic).
  - `ack.changed === false` → `Nessun effetto`.
  - A `CommandError` → `Comando non riuscito: <code>`.
  - Either one shows for 3 s, in a `role="status"` live region.
- **Without an episode:** `NESSUNA PUNTATA CARICATA`, with every command disabled.
- **Before the first view:** only `CONNESSIONE…`.

- [ ] **Step 1: Write the failing tests**

`web/test/support/api.ts`:
```ts
// SPDX-License-Identifier: GPL-2.0-or-later
import type { ApiClient } from '../../src/core/http';

export function fakeApi(over: Partial<ApiClient> = {}): ApiClient {
  return {
    listEpisodes: async () => [],
    loadEpisode: async () => {},
    obsStatus: async () => ({ connection: 'connected', deck: { capability: 'events' } }),
    ...over,
  };
}
```

`web/test/core/http.test.ts`:
```ts
// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import { ApiError, httpApi } from '../../src/core/http';

function fakeFetch(status: number, body: unknown, seen: Array<{ url: string; init?: RequestInit }> = []): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    seen.push({ url: String(input), init });
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
}

describe('httpApi', () => {
  it('lists episodes newest first, keeping only id, name and date', async () => {
    const api = httpApi(
      fakeFetch(200, [
        { id: 'a', name: 'Prova', date: '2026-10-11', blocks: [] },
        { id: 'b', name: 'Diretta', date: '2026-10-12', blocks: [] },
      ]),
    );
    expect(await api.listEpisodes()).toEqual([
      { id: 'b', name: 'Diretta', date: '2026-10-12' },
      { id: 'a', name: 'Prova', date: '2026-10-11' },
    ]);
  });

  it('loads an episode with a JSON POST and surfaces the server error code', async () => {
    const seen: Array<{ url: string; init?: RequestInit }> = [];
    await httpApi(fakeFetch(200, { episodeId: 'b' }, seen)).loadEpisode('b');
    expect(seen[0]!.url).toBe('/api/live/load');
    expect(seen[0]!.init?.method).toBe('POST');
    expect(JSON.parse(String(seen[0]!.init?.body))).toEqual({ episodeId: 'b' });
    const err = await httpApi(fakeFetch(409, { error: 'live_running' })).loadEpisode('b').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 409, code: 'live_running' });
  });

  it('reads the OBS status', async () => {
    const api = httpApi(fakeFetch(200, { connection: 'auth_failed', obsWebSocketVersion: null, programScene: null, deck: null }));
    expect(await api.obsStatus()).toEqual({ connection: 'auth_failed', deck: null });
  });
});
```

`web/test/dock/dock.test.tsx`:
```tsx
// SPDX-License-Identifier: GPL-2.0-or-later
import { act, fireEvent, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ClientSnapshot } from '../../src/core/ws-client';
import { CommandError } from '../../src/core/ws-client';
import type { ApiClient } from '../../src/core/http';
import type { ControlView } from '../../src/core/views';
import { DockScreen } from '../../src/dock/DockScreen';
import { fakeApi } from '../support/api';
import { renderLive } from '../support/render';
import { StaticStore, snapshotOf } from '../support/store';
import { WALL, controlView, mediaView, preshowView, studioView } from '../support/views';

afterEach(() => {
  vi.useRealTimers();
});

async function dock(view: ControlView | null = controlView(), over: Partial<ClientSnapshot<'control'>> = {}, api: ApiClient = fakeApi()) {
  const store = new StaticStore(snapshotOf<'control'>(view, over));
  const utils = renderLive(<DockScreen api={api} search="" />, store);
  await act(async () => {}); // let the first OBS status poll settle
  const texts = (sel: string) => [...utils.container.querySelectorAll(sel)].map((el) => el.textContent?.trim());
  const text = (sel: string) => utils.container.querySelector(sel)?.textContent?.trim() ?? null;
  const button = (name: string) => screen.getByRole('button', { name }) as HTMLButtonElement;
  return { ...utils, store, texts, text, button };
}

describe('<DockScreen> status and alerts', () => {
  it('shows phase, segment, current block, delay and program end', async () => {
    const d = await dock();
    expect(d.text('.badge-phase')).toBe('LIVE');
    expect(d.text('.badge-segment')).toBe('STUDIO');
    expect(d.text('.status-title')).toBe('BLOCCO 3 · Secondo blocco');
    expect(d.text('.status-counter')).toBe('8:42');
    expect(d.text('.status-delay')).toBe('RITARDO +0:42');
    expect(d.text('.status-end')).toBe('FINE PROGRAMMA 41:18 · 14:54:38');
    expect(d.text('.status-obs')).toBe('OBS ✓');
    expect(d.container.querySelector('.badge-manual')).toBeNull();
  });

  it('shows what is on air and the return during a service', async () => {
    const d = await dock(controlView({ presenter: mediaView() }));
    expect(d.text('.badge-segment')).toBe('SERVIZIO');
    expect(d.text('.status-title')).toBe('IN ONDA: Servizio 1');
    expect(d.text('.status-counter')).toBe('1:42');
    expect(d.text('.status-return')).toBe('RIENTRO: Primo blocco');
  });

  it('marks estimated values and manual control', async () => {
    const d = await dock(controlView({ control: 'manual', presenter: studioView({ delay: { ms: 42_000, source: 'estimated' } }) }));
    expect(d.text('.status-delay')).toBe('RITARDO +0:42STIMATO');
    expect(d.text('.badge-manual')).toBe('MANUALE');
  });

  it('lists the alerts the director must see', async () => {
    const d = await dock(controlView({ obs: 'lost', ambiguous: true, offScript: { scene: 'CAMERA OSPITE', sinceWall: WALL } }));
    expect(d.texts('.alert')).toEqual([
      '⚠ OBS NON CONNESSO',
      'FUORI SCALETTA: CAMERA OSPITE dalle 14:13:20',
      'POSIZIONE INCERTA: verificare il rundown',
    ]);
  });

  it('reports OBS authentication and Playlist Deck problems from the status endpoint', async () => {
    const auth = await dock(controlView(), {}, fakeApi({ obsStatus: async () => ({ connection: 'auth_failed', deck: null }) }));
    expect(auth.texts('.alert')).toEqual(['OBS: AUTENTICAZIONE FALLITA']);
    auth.unmount();
    const absent = await dock(controlView(), {}, fakeApi({ obsStatus: async () => ({ connection: 'connected', deck: { capability: 'absent' } }) }));
    expect(absent.texts('.alert')).toEqual(['PLAYLIST DECK ASSENTE: nessun servizio misurato']);
    absent.unmount();
    const legacy = await dock(controlView(), {}, fakeApi({ obsStatus: async () => ({ connection: 'connected', deck: { capability: 'legacy' } }) }));
    expect(legacy.texts('.alert')).toEqual(['PLAYLIST DECK < 1.4.0: modalità ridotta']);
  });

  it('offers the open decisions with the applied default pressed', async () => {
    const d = await dock(
      controlView({
        decisions: [
          { id: 1, kind: 'all_outputs_stopped', atWall: WALL, defaultChoice: 'interruption', choice: 'interruption', confirmed: false },
          { id: 2, kind: 'output_restart', atWall: WALL, defaultChoice: 'continue', choice: 'continue', confirmed: true },
        ],
      }),
    );
    expect(d.texts('.decision-text')).toEqual(['REC/STREAM FERMATI alle 14:13:20']);
    expect(d.button('Interruzione').getAttribute('aria-pressed')).toBe('true');
    expect(d.button('Fine programma').getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(d.button('Interruzione'));
    expect(d.store.commands).toEqual([{ name: 'resolve_decision', id: 1, choice: 'interruption' }]);
    fireEvent.click(d.button('Fine programma'));
    expect(d.store.commands).toHaveLength(1); // armed, not sent
    fireEvent.click(d.button('Fine programma'));
    expect(d.store.commands[1]).toEqual({ name: 'resolve_decision', id: 1, choice: 'end' });
  });
});

describe('<DockScreen> messages', () => {
  it('sends preset messages labelled with their hotkey slot', async () => {
    const d = await dock();
    expect(d.texts('.preset-grid button')).toEqual(['1 · STRINGI', '2 · GUARDA CAM 2']);
    fireEvent.click(d.button('1 · STRINGI'));
    expect(d.store.commands).toEqual([{ name: 'send_message', text: 'STRINGI', dismiss: { kind: 'timeout', ms: 10_000 } }]);
  });

  it('sends free text with manual dismissal and clears the field after the change', async () => {
    const d = await dock();
    const input = screen.getByRole('textbox', { name: 'Testo libero' }) as HTMLInputElement;
    expect(input.maxLength).toBe(200);
    expect(d.button('INVIA').disabled).toBe(true);
    fireEvent.change(input, { target: { value: '  CHIUDI  ' } });
    expect(d.button('INVIA').disabled).toBe(false);
    await act(async () => {
      fireEvent.click(d.button('INVIA'));
    });
    expect(d.store.commands).toEqual([{ name: 'send_message', text: 'CHIUDI', dismiss: { kind: 'manual' } }]);
    expect(input.value).toBe('');
  });

  it('shows the message on air and clears it', async () => {
    const d = await dock(controlView({ presenter: studioView({ message: { text: 'STRINGI' } }) }));
    expect(d.text('.current-message')).toBe('In onda: STRINGI');
    fireEvent.click(d.button('CLEAR'));
    expect(d.store.commands).toEqual([{ name: 'clear_message' }]);
    d.unmount();
    const quiet = await dock();
    expect(quiet.button('CLEAR').disabled).toBe(true);
  });
});

describe('<DockScreen> emergency', () => {
  it('is collapsed by default and needs a second click within 1.5 s', async () => {
    vi.useFakeTimers();
    const d = await dock();
    expect((d.container.querySelector('details.emergency') as HTMLDetailsElement).open).toBe(false);
    const next = d.button('NEXT');
    fireEvent.click(next);
    expect(d.store.commands).toEqual([]);
    expect(next.textContent).toBe('Premi di nuovo per confermare');
    act(() => vi.advanceTimersByTime(1_600));
    expect(next.textContent).toBe('NEXT');
    fireEvent.click(next);
    expect(d.store.commands).toEqual([]);
    fireEvent.click(next);
    expect(d.store.commands).toEqual([{ name: 'next' }]);
  });

  it('fires on a long press and ignores the click that follows', async () => {
    vi.useFakeTimers();
    const d = await dock();
    const prev = d.button('PREV');
    fireEvent.pointerDown(prev);
    act(() => vi.advanceTimersByTime(799));
    expect(d.store.commands).toEqual([]);
    act(() => vi.advanceTimersByTime(1));
    expect(d.store.commands).toEqual([{ name: 'prev' }]);
    fireEvent.pointerUp(prev);
    fireEvent.click(prev);
    expect(d.store.commands).toEqual([{ name: 'prev' }]);
  });

  it('adjusts by the preset step and toggles manual control', async () => {
    const d = await dock();
    const twice = (name: string) => {
      fireEvent.click(d.button(name));
      fireEvent.click(d.button(name));
    };
    twice('−0:30');
    twice('+0:30');
    twice('MANUALE');
    expect(d.store.commands).toEqual([
      { name: 'adjust', deltaMs: -30_000 },
      { name: 'adjust', deltaMs: 30_000 },
      { name: 'set_control', control: 'manual' },
    ]);
    d.unmount();
    const manual = await dock(controlView({ control: 'manual' }));
    expect(manual.button('AUTO')).toBeTruthy();
  });

  it('enables only the commands that make sense in the phase', async () => {
    const pre = await dock(controlView({ presenter: preshowView() }));
    expect(pre.button('START PROGRAM').disabled).toBe(false);
    for (const name of ['PREV', 'NEXT', '−0:30', '+0:30', 'END PROGRAM']) expect(pre.button(name).disabled, name).toBe(true);
    pre.unmount();
    const live = await dock();
    expect(live.button('START PROGRAM').disabled).toBe(true);
    for (const name of ['PREV', 'NEXT', '−0:30', '+0:30', 'END PROGRAM', 'MANUALE']) expect(live.button(name).disabled, name).toBe(false);
  });

  it('says when a command had no effect or failed, for 3 s', async () => {
    vi.useFakeTimers();
    const d = await dock();
    d.store.reply = async () => ({ changed: false });
    fireEvent.click(d.button('NEXT')); // arm (a render must happen between the two clicks)
    await act(async () => {
      fireEvent.click(d.button('NEXT'));
    });
    expect(d.text('.cmd-feedback')).toBe('Nessun effetto');
    act(() => vi.advanceTimersByTime(3_000));
    expect(d.text('.cmd-feedback')).toBe('');
    d.store.reply = async () => {
      throw new CommandError('no_episode', 'No episode is loaded');
    };
    fireEvent.click(d.button('PREV'));
    await act(async () => {
      fireEvent.click(d.button('PREV'));
    });
    expect(d.text('.cmd-feedback')).toBe('Comando non riuscito: no_episode');
  });
});

describe('<DockScreen> without a show', () => {
  it('disables every command when no episode is loaded', async () => {
    const d = await dock(null);
    expect(d.text('.no-episode')).toBe('NESSUNA PUNTATA CARICATA');
    expect(d.texts('.preset-grid button')).toEqual([]);
    for (const name of ['START PROGRAM', 'PREV', 'NEXT', 'END PROGRAM', 'MANUALE', 'CLEAR']) expect(d.button(name).disabled, name).toBe(true);
  });

  it('shows only CONNESSIONE… before the first view', async () => {
    const d = await dock(null, { hasView: false, synced: false, stale: true });
    expect(screen.getAllByRole('status').map((s) => s.textContent)).toContain('CONNESSIONE…');
    expect(d.container.querySelector('.status')).toBeNull();
  });

  it('links to the extended view in a new tab', async () => {
    await dock();
    const link = screen.getByRole('link', { name: 'Apri vista estesa' });
    expect(link.getAttribute('href')).toBe('/control');
    expect(link.getAttribute('target')).toBe('_blank');
  });
});
```

- [ ] **Step 2: Run them and verify they fail**

Run: `pnpm vitest run web/test/dock web/test/core/http.test.ts`. Expected: FAIL, because the modules are missing.

- [ ] **Step 3: Implement**

`web/src/core/http.ts`:
```ts
// SPDX-License-Identifier: GPL-2.0-or-later
import { z } from 'zod';

export interface EpisodeSummary {
  id: string;
  name: string;
  date: string;
}

export interface ObsStatusLite {
  connection: 'idle' | 'connecting' | 'connected' | 'auth_failed' | 'disconnected';
  deck: { capability: 'absent' | 'legacy' | 'events' } | null;
}

/** The HTTP calls the dock and the control view make (same origin; Vite proxies /api in dev). */
export interface ApiClient {
  listEpisodes(): Promise<EpisodeSummary[]>;
  loadEpisode(id: string): Promise<void>;
  obsStatus(): Promise<ObsStatusLite>;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(`HTTP ${status}: ${code}`);
    this.name = 'ApiError';
  }
}

const EpisodeList = z.array(z.object({ id: z.string(), name: z.string(), date: z.string() }));
const ObsStatusSchema = z.object({
  connection: z.enum(['idle', 'connecting', 'connected', 'auth_failed', 'disconnected']),
  deck: z.object({ capability: z.enum(['absent', 'legacy', 'events']) }).nullable(),
});

async function failure(res: Response): Promise<ApiError> {
  let code = `http_${res.status}`;
  try {
    const body = (await res.json()) as { error?: unknown };
    if (typeof body.error === 'string') code = body.error;
  } catch {
    // not JSON: keep the status code
  }
  return new ApiError(res.status, code);
}

export function httpApi(fetchFn: typeof fetch = (input, init) => fetch(input, init)): ApiClient {
  return {
    async listEpisodes() {
      const res = await fetchFn('/api/episodes');
      if (!res.ok) throw await failure(res);
      return EpisodeList.parse(await res.json())
        .map(({ id, name, date }) => ({ id, name, date }))
        .sort((a, b) => b.date.localeCompare(a.date) || a.name.localeCompare(b.name));
    },
    async loadEpisode(id) {
      const res = await fetchFn('/api/live/load', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ episodeId: id }),
      });
      if (!res.ok) throw await failure(res);
    },
    async obsStatus() {
      const res = await fetchFn('/api/obs/status');
      if (!res.ok) throw await failure(res);
      return ObsStatusSchema.parse(await res.json());
    },
  };
}
```

`web/src/ui/control/ConfirmButton.tsx`:
```tsx
// SPDX-License-Identifier: GPL-2.0-or-later
import { useEffect, useRef, useState } from 'react';
import { useLive } from '../live-context';

export const CONFIRM_WINDOW_MS = 1_500;
export const LONG_PRESS_MS = 800;

interface Props {
  label: string;
  onConfirm: () => void;
  disabled?: boolean;
  danger?: boolean;
  pressed?: boolean;
}

/** F16: an emergency action needs a second click within CONFIRM_WINDOW_MS, or a press held for LONG_PRESS_MS. */
export function ConfirmButton({ label, onConfirm, disabled = false, danger = false, pressed }: Props) {
  const { t } = useLive();
  const [armed, setArmed] = useState(false);
  const disarmTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const firedByPress = useRef(false);

  const clearTimers = () => {
    if (disarmTimer.current !== null) clearTimeout(disarmTimer.current);
    if (pressTimer.current !== null) clearTimeout(pressTimer.current);
    disarmTimer.current = null;
    pressTimer.current = null;
  };
  useEffect(() => clearTimers, []);
  useEffect(() => {
    if (disabled) {
      clearTimers();
      setArmed(false);
    }
  }, [disabled]);

  const fire = () => {
    clearTimers();
    setArmed(false);
    onConfirm();
  };
  const onClick = () => {
    if (firedByPress.current) {
      firedByPress.current = false;
      return;
    }
    if (armed) {
      fire();
      return;
    }
    setArmed(true);
    disarmTimer.current = setTimeout(() => setArmed(false), CONFIRM_WINDOW_MS);
  };
  const onPointerDown = () => {
    firedByPress.current = false;
    if (pressTimer.current !== null) clearTimeout(pressTimer.current);
    pressTimer.current = setTimeout(() => {
      pressTimer.current = null;
      firedByPress.current = true;
      fire();
    }, LONG_PRESS_MS);
  };
  const cancelPress = () => {
    if (pressTimer.current !== null) clearTimeout(pressTimer.current);
    pressTimer.current = null;
  };

  return (
    <button
      type="button"
      className="confirm-button"
      aria-label={label}
      aria-pressed={pressed}
      data-armed={String(armed)}
      data-danger={String(danger)}
      disabled={disabled}
      onClick={onClick}
      onPointerDown={onPointerDown}
      onPointerUp={cancelPress}
      onPointerLeave={cancelPress}
      onPointerCancel={cancelPress}
    >
      {armed ? t('confirmAgain') : label}
    </button>
  );
}
```

`web/src/ui/control/useCommand.ts`:
```ts
// SPDX-License-Identifier: GPL-2.0-or-later
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ClientCommand } from '@olc/shared';
import { CommandError } from '../../core/ws-client';
import { useLive } from '../live-context';

export const FEEDBACK_MS = 3_000;

export type Feedback = { kind: 'idle' } | { kind: 'noEffect' } | { kind: 'error'; code: string };

/** Sends a command and turns `ack.changed === false` and errors into visible feedback (BACKLOG Plan 4). */
export function useCommand(): { run: (command: ClientCommand) => Promise<boolean>; feedback: Feedback } {
  const { store } = useLive();
  const [feedback, setFeedback] = useState<Feedback>({ kind: 'idle' });
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current);
    },
    [],
  );
  const show = useCallback((next: Feedback) => {
    setFeedback(next);
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = setTimeout(() => setFeedback({ kind: 'idle' }), FEEDBACK_MS);
  }, []);
  const run = useCallback(
    async (command: ClientCommand): Promise<boolean> => {
      try {
        const { changed } = await store.sendCommand(command);
        if (!changed) show({ kind: 'noEffect' });
        return changed;
      } catch (err) {
        show({ kind: 'error', code: err instanceof CommandError ? err.code : 'internal' });
        return false;
      }
    },
    [store, show],
  );
  return { run, feedback };
}
```

`web/src/ui/control/CommandFeedback.tsx`:
```tsx
// SPDX-License-Identifier: GPL-2.0-or-later
import { useLive } from '../live-context';
import type { Feedback } from './useCommand';

export function CommandFeedback({ feedback }: { feedback: Feedback }) {
  const { t } = useLive();
  const text = feedback.kind === 'noEffect' ? t('noEffect') : feedback.kind === 'error' ? t('commandFailed', { code: feedback.code }) : '';
  return (
    <div className="cmd-feedback" role="status" aria-live="polite" data-kind={feedback.kind}>
      {text}
    </div>
  );
}
```

`web/src/ui/control/useObsStatus.ts`:
```ts
// SPDX-License-Identifier: GPL-2.0-or-later
import { useEffect, useState } from 'react';
import type { ApiClient, ObsStatusLite } from '../../core/http';

export const OBS_STATUS_POLL_MS = 5_000;

/** Polls GET /api/obs/status. null while unknown or on error: no alert is better than a guessed one. */
export function useObsStatus(api: ApiClient, intervalMs = OBS_STATUS_POLL_MS): ObsStatusLite | null {
  const [status, setStatus] = useState<ObsStatusLite | null>(null);
  useEffect(() => {
    let alive = true;
    const poll = () => {
      api.obsStatus().then(
        (s) => {
          if (alive) setStatus(s);
        },
        () => {
          if (alive) setStatus(null);
        },
      );
    };
    poll();
    const handle = setInterval(poll, intervalMs);
    return () => {
      alive = false;
      clearInterval(handle);
    };
  }, [api, intervalMs]);
  return status;
}
```

`web/src/ui/control/StatusPanel.tsx`:
```tsx
// SPDX-License-Identifier: GPL-2.0-or-later
import { useRef } from 'react';
import type { AnchorFrame } from '../../core/anchor';
import type { MessageKey, Translate } from '../../core/i18n';
import { durationText, signedText, wallText } from '../../core/time-format';
import type { ControlView, PresenterView } from '../../core/views';
import { baseMode, mainAnchor, mainTally, type ScreenMode } from '../../presenter/presenter-model';
import { AnchoredTime } from '../AnchoredTime';
import { SourceBadge } from '../SourceBadge';
import { useLive } from '../live-context';

export function phaseKey(p: PresenterView): MessageKey {
  if (p.phase === 'preshow') return 'phasePreshow';
  if (p.phase === 'ended') return 'phaseEnded';
  return p.rundownFinished ? 'phaseOverrun' : 'phaseLive';
}

const SEGMENT_KEY = { studio: 'segStudio', media: 'segMedia', break: 'segBreak' } as const;

function currentTitle(p: PresenterView, mode: ScreenMode, t: Translate): string {
  switch (mode) {
    case 'preshow':
      return t('programStart');
    case 'studio':
      return p.block ? t('block', { n: p.block.index + 1, name: p.block.name }) : '—';
    case 'media':
    case 'break':
      return p.onAir ? t('onAirNow', { title: p.onAir.title }) : t('returnIn');
    case 'overrun':
      return t('rundownFinished');
    case 'ended':
      return p.ended ? `${t('ended')} ${durationText(p.ended.totalMs)} · ${t('endedOffset', { d: signedText(p.ended.finalOffsetMs) })}` : t('ended');
    default:
      return '';
  }
}

/** Compact live status for the dock and the control view (SPEC §8). Same tally rule as the presenter. */
export function StatusPanel({ view }: { view: ControlView }) {
  const { t, timeZone } = useLive();
  const p = view.presenter;
  const panelRef = useRef<HTMLElement>(null);
  const mode = baseMode(p, true);
  const anchor = mainAnchor(p, mode);
  const tally = (frame: AnchorFrame) => mainTally(p, mode, frame.ticks);
  const live = p.phase === 'live';
  return (
    <section className="panel status" ref={panelRef} data-tally="none">
      <div className="status-badges">
        <span className="badge-phase">{t(phaseKey(p))}</span>
        {live && p.segment !== null ? <span className="badge-segment">{t(SEGMENT_KEY[p.segment])}</span> : null}
        {view.control === 'manual' ? <span className="badge-manual">{t('manual')}</span> : null}
        <span className="status-obs" data-ok={String(view.obs === 'ok')}>
          {view.obs === 'ok' ? t('obsOk') : t('obsLost')}
        </span>
      </div>
      <div className="status-current">
        <span className="label-text status-title">{currentTitle(p, mode, t)}</span>
        {anchor !== null ? <SourceBadge anchor={anchor} /> : null}
        {anchor !== null ? <AnchoredTime anchor={anchor} className="counter status-counter" tally={tally} tallyRef={panelRef} /> : null}
      </div>
      {(mode === 'media' || mode === 'break') && p.returnTo ? (
        <div className="label-text status-return">{t('returnTo', { name: p.returnTo.blockName })}</div>
      ) : null}
      <div className="status-row">
        <span className="status-delay">
          {`${t('delay')} ${live && p.delay !== null ? signedText(p.delay.ms) : '—'}`}
          {live && p.delay !== null ? <SourceBadge source={p.delay.source} showPlanned /> : null}
        </span>
        <span className="status-end">
          {`${t('programEnd')} `}
          {p.programEnd !== null ? (
            <>
              <AnchoredTime anchor={p.programEnd.anchor} className="counter" />
              {` · ${p.programEnd.endsAtWall === null ? '—' : wallText(p.programEnd.endsAtWall, timeZone)}`}
            </>
          ) : (
            '—'
          )}
        </span>
      </div>
    </section>
  );
}
```

`web/src/ui/control/Alerts.tsx`:
```tsx
// SPDX-License-Identifier: GPL-2.0-or-later
import { DECISION_CHOICES, type ClientCommand } from '@olc/shared';
import type { ObsStatusLite } from '../../core/http';
import type { MessageKey } from '../../core/i18n';
import { wallText } from '../../core/time-format';
import type { ControlDecision, ControlView } from '../../core/views';
import { useLive } from '../live-context';
import { ConfirmButton } from './ConfirmButton';

type Run = (command: ClientCommand) => Promise<boolean>;

/** SPEC §8 warnings, then the open non-blocking decisions (default already applied, changeable afterwards). */
export function Alerts({ view, obs, run }: { view: ControlView; obs: ObsStatusLite | null; run: Run }) {
  const { t, timeZone } = useLive();
  const items: Array<{ key: string; text: string }> = [];
  if (obs?.connection === 'auth_failed') items.push({ key: 'auth', text: t('obsAuthFailed') });
  if (view.obs === 'lost') items.push({ key: 'obs', text: t('obsLost') });
  if (obs?.connection === 'connected' && obs.deck?.capability === 'absent') items.push({ key: 'deck', text: t('deckAbsent') });
  if (obs?.connection === 'connected' && obs.deck?.capability === 'legacy') items.push({ key: 'deck', text: t('deckLegacy') });
  if (view.offScript !== null) {
    const scene = view.offScript.scene === '' ? '—' : view.offScript.scene; // the engine may not know the scene (BACKLOG)
    items.push({ key: 'off', text: t('offScript', { scene, time: wallText(view.offScript.sinceWall, timeZone) }) });
  }
  if (view.ambiguous) items.push({ key: 'amb', text: t('ambiguous') });
  const open = view.decisions.filter((d) => !d.confirmed);
  if (items.length === 0 && open.length === 0) return null;
  return (
    <section className="panel alerts">
      {items.map((item) => (
        <div key={item.key} className="alert" role="alert">
          {item.text}
        </div>
      ))}
      {open.map((d) => (
        <Decision key={d.id} decision={d} run={run} />
      ))}
    </section>
  );
}

function Decision({ decision, run }: { decision: ControlDecision; run: Run }) {
  const { t, timeZone } = useLive();
  const time = wallText(decision.atWall, timeZone);
  return (
    <div className="decision">
      <div className="decision-text">{t(decision.kind === 'output_restart' ? 'decisionOutputRestart' : 'decisionAllStopped', { time })}</div>
      <div className="decision-choices">
        {DECISION_CHOICES[decision.kind].map((choice) => {
          const label = t(`choice_${choice}` as MessageKey);
          const pressed = decision.choice === choice;
          const send = () => void run({ name: 'resolve_decision', id: decision.id, choice });
          return choice === 'end' ? (
            <ConfirmButton key={choice} label={label} onConfirm={send} danger pressed={pressed} />
          ) : (
            <button key={choice} type="button" aria-pressed={pressed} onClick={send}>
              {label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
```

`web/src/ui/control/MessagePanel.tsx`:
```tsx
// SPDX-License-Identifier: GPL-2.0-or-later
import { useState, type FormEvent } from 'react';
import type { ClientCommand } from '@olc/shared';
import type { ControlView } from '../../core/views';
import { useLive } from '../live-context';

/** F15: preset buttons (hotkey slot = index + 1, DT-9), free text, CLEAR. */
export function MessagePanel({ view, run }: { view: ControlView | null; run: (command: ClientCommand) => Promise<boolean> }) {
  const { t } = useLive();
  const [draft, setDraft] = useState('');
  const disabled = view === null;
  const current = view?.presenter.message?.text ?? null;
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const text = draft.trim();
    if (text === '') return;
    if (await run({ name: 'send_message', text, dismiss: { kind: 'manual' } })) setDraft('');
  };
  return (
    <section className="panel messages">
      <h2 className="panel-title">{t('messages')}</h2>
      {current !== null ? <div className="current-message label-text">{t('currentMessage', { text: current })}</div> : null}
      <div className="preset-grid">
        {(view?.presets.messages ?? []).map((m, i) => (
          <button key={m.id} type="button" disabled={disabled} onClick={() => void run({ name: 'send_message', text: m.text, dismiss: m.dismiss })}>
            {`${i + 1} · ${m.text}`}
          </button>
        ))}
      </div>
      <form className="free-text" onSubmit={(e) => void submit(e)}>
        <input
          type="text"
          aria-label={t('freeText')}
          placeholder={t('freeText')}
          maxLength={200}
          value={draft}
          disabled={disabled}
          onChange={(e) => setDraft(e.target.value)}
        />
        <button type="submit" disabled={disabled || draft.trim() === ''}>
          {t('send')}
        </button>
      </form>
      <button type="button" className="clear" disabled={disabled || current === null} onClick={() => void run({ name: 'clear_message' })}>
        {t('clear')}
      </button>
    </section>
  );
}
```

`web/src/ui/control/EmergencyPanel.tsx`:
```tsx
// SPDX-License-Identifier: GPL-2.0-or-later
import type { ClientCommand } from '@olc/shared';
import { MINUS, durationText } from '../../core/time-format';
import type { ControlView } from '../../core/views';
import { useLive } from '../live-context';
import { ConfirmButton } from './ConfirmButton';

/** F16 emergency controls, closed by default; every action needs a confirmation. */
export function EmergencyPanel({ view, run }: { view: ControlView | null; run: (command: ClientCommand) => Promise<boolean> }) {
  const { t } = useLive();
  const phase = view?.presenter.phase ?? null;
  const live = phase === 'live';
  const step = view?.presets.adjustStepMs ?? 30_000;
  const manual = view?.control === 'manual';
  const send = (command: ClientCommand) => () => void run(command);
  return (
    <details className="panel emergency">
      <summary className="panel-title">{t('emergency')}</summary>
      <div className="emergency-grid">
        <ConfirmButton label={t('startProgram')} disabled={phase !== 'preshow'} onConfirm={send({ name: 'start_program' })} />
        <ConfirmButton label={t('prevCmd')} disabled={!live} onConfirm={send({ name: 'prev' })} />
        <ConfirmButton label={t('nextCmd')} disabled={!live} onConfirm={send({ name: 'next' })} />
        <ConfirmButton label={`${MINUS}${durationText(step)}`} disabled={!live} onConfirm={send({ name: 'adjust', deltaMs: -step })} />
        <ConfirmButton label={`+${durationText(step)}`} disabled={!live} onConfirm={send({ name: 'adjust', deltaMs: step })} />
        <ConfirmButton
          label={manual ? t('setAuto') : t('setManual')}
          disabled={view === null}
          onConfirm={send({ name: 'set_control', control: manual ? 'auto' : 'manual' })}
        />
        <ConfirmButton label={t('endProgram')} disabled={!live} danger onConfirm={send({ name: 'end_program' })} />
      </div>
    </details>
  );
}
```

`web/src/dock/DockScreen.tsx`:
```tsx
// SPDX-License-Identifier: GPL-2.0-or-later
import { httpApi, type ApiClient } from '../core/http';
import { ConnectionOverlay } from '../ui/ConnectionOverlay';
import { Alerts } from '../ui/control/Alerts';
import { CommandFeedback } from '../ui/control/CommandFeedback';
import { EmergencyPanel } from '../ui/control/EmergencyPanel';
import { MessagePanel } from '../ui/control/MessagePanel';
import { StatusPanel } from '../ui/control/StatusPanel';
import { useCommand } from '../ui/control/useCommand';
import { useObsStatus } from '../ui/control/useObsStatus';
import { useLive, useSnapshot } from '../ui/live-context';

const defaultApi = httpApi();

/** SPEC §8 / F13: the OBS Custom Browser Dock, from 300 px wide. Role `control`. */
export function DockScreen({ api = defaultApi, search = typeof window === 'undefined' ? '' : window.location.search }: { api?: ApiClient; search?: string }) {
  const { t } = useLive();
  const snap = useSnapshot<'control'>();
  const { run, feedback } = useCommand();
  const obs = useObsStatus(api);
  const view = snap.view;
  const ready = snap.hasView && snap.synced;
  return (
    <div className="dock">
      {ready && view === null ? (
        <section className="panel">
          <div className="no-episode">{t('noEpisode')}</div>
        </section>
      ) : null}
      {ready && view !== null ? (
        <>
          <StatusPanel view={view} />
          <Alerts view={view} obs={obs} run={run} />
        </>
      ) : null}
      {ready ? (
        <>
          <MessagePanel view={view} run={run} />
          <EmergencyPanel view={view} run={run} />
        </>
      ) : null}
      <CommandFeedback feedback={feedback} />
      <a className="open-extended" href={`/control${search}`} target="_blank" rel="noopener">
        {t('openExtended')}
      </a>
      <ConnectionOverlay />
    </div>
  );
}
```

`web/src/ui/control/panels.css` (shared by the dock and the control view):
```css
/* SPDX-License-Identifier: GPL-2.0-or-later */
.panel {
  background: var(--surface);
  border: 2px solid var(--tile-border);
  border-radius: 8px;
  padding: 8px 10px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}
.panel-title { margin: 0; font-size: 0.85rem; font-weight: 700; letter-spacing: 0.06em; color: var(--fg-dim); cursor: pointer; }
.status-badges { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; font-weight: 700; font-size: 0.85rem; }
.badge-phase, .badge-segment, .badge-manual {
  border: 1px solid currentColor; border-radius: 4px; padding: 1px 6px;
}
.badge-manual { color: var(--amber); }
.status-obs { margin-left: auto; }
.status-obs[data-ok='false'] { color: var(--amber); }
.status-current { display: flex; align-items: baseline; gap: 8px; min-width: 0; font-weight: 700; }
.status-title { flex: 1 1 auto; }
.status-counter { font-size: 2rem; }
.status-return, .status-row { color: var(--fg-dim); font-weight: 700; }
.status-row { display: flex; flex-wrap: wrap; gap: 4px 12px; }
.status[data-tally='warn'] { border-color: var(--amber); }
.status[data-tally='warn'] .status-counter { color: var(--amber); }
.status[data-tally='over'] { border-color: var(--red); }
.status[data-tally='over'] .status-counter { color: var(--red); }
.alert { color: var(--amber); font-weight: 700; overflow-wrap: anywhere; }
.decision { display: flex; flex-direction: column; gap: 4px; }
.decision-choices { display: flex; flex-wrap: wrap; gap: 6px; }
button[aria-pressed='true'] { border-color: var(--fg); font-weight: 700; }
.current-message { font-weight: 700; }
.preset-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(130px, 1fr)); gap: 6px; }
.preset-grid button { text-align: left; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.free-text { display: flex; gap: 6px; }
.free-text input {
  flex: 1 1 auto; min-width: 0; font: inherit; color: var(--fg); background: var(--bg);
  border: 1px solid var(--tile-border); border-radius: 6px; padding: 6px 8px;
}
.emergency-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); gap: 6px; padding-top: 6px; }
.confirm-button[data-armed='true'] { border-color: var(--amber); color: var(--amber); }
.confirm-button[data-danger='true'] { border-color: var(--red); }
.cmd-feedback { min-height: 1.4em; color: var(--amber); font-weight: 700; }
```

`web/src/dock/dock.css`:
```css
/* SPDX-License-Identifier: GPL-2.0-or-later */
/* OBS Custom Browser Dock (CEF): vertical, usable from 300 px; no features newer than Chromium 103. */
.dock {
  min-width: 300px;
  min-height: 100%;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 8px;
  background: var(--bg);
  font-size: 14px;
}
.no-episode { color: var(--fg-dim); font-weight: 700; }
.open-extended { align-self: flex-start; font-weight: 700; }
```

`web/src/dock/main.tsx` (replaces the placeholder):
```tsx
// SPDX-License-Identifier: GPL-2.0-or-later
import { createRoot } from 'react-dom/client';
import '../ui/fonts';
import '../ui/base.css';
import '../ui/control/panels.css';
import './dock.css';
import { browserFrameLoop } from '../core/frame-loop';
import { parseParams } from '../core/params';
import { LiveClient, wsUrl } from '../core/ws-client';
import { LiveProvider } from '../ui/live-context';
import { installTokens } from '../ui/tokens';
import { DockScreen } from './DockScreen';

const params = parseParams(location.search);
installTokens();
document.documentElement.lang = params.lang;

const client = new LiveClient({ url: wsUrl(location), role: 'control' });
client.start();

createRoot(document.getElementById('root')!).render(
  <LiveProvider store={client} frames={browserFrameLoop()} lang={params.lang}>
    <DockScreen />
  </LiveProvider>,
);
```

- [ ] **Step 4: Run them and verify they pass; build**

Run: `pnpm test && pnpm typecheck && pnpm --filter @olc/web build`. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/core/http.ts web/src/ui/control web/src/dock web/test/support/api.ts web/test/core/http.test.ts web/test/dock
git commit -m "feat(web): obs dock with live status, alerts and decisions, preset and free-text messages, confirmed emergency controls"
```

---

### Task 12: Extended control view — rundown table, session event feed, rehearsal episode picker

**Files:**
- Create:
  - `web/src/control/event-feed.ts`, `web/src/control/EventFeed.tsx`, `web/src/control/RundownTable.tsx`, `web/src/control/EpisodePicker.tsx`, `web/src/control/ControlScreen.tsx`, `web/src/control/control.css`;
  - `web/test/control/event-feed.test.ts`, `web/test/control/control.test.tsx`.
- Modify: `web/src/control/main.tsx` (replace the placeholder).

**Interfaces:**
- Consumes: the Task 11 panels and hooks, `ApiClient`, `ConfirmButton`, `SourceBadge`, `durationText`, `wallText`.
- Produces:
  - `event-feed.ts`: `FeedEvent`, `FeedEntry`, `FEED_LIMIT = 200`, `diffViews(prev, next)`, `appendFeed(feed, events, atWall, nextId)`;
  - `EventFeed.tsx`: `useEventFeed(view, synced)`, `<EventFeed entries>`;
  - `RundownTable.tsx`: `<RundownTable view run>`;
  - `EpisodePicker.tsx`: `<EpisodePicker api loadedId>`;
  - `ControlScreen.tsx`: `<ControlScreen api?>`.

**Rules (SPEC §8, F14; BACKLOG):**
- **Layout.** Header with the episode name. Below it, a two-column grid (`2fr | minmax(300px, 1fr)`, a single column under 900 px):
  - left: the rundown table;
  - right: status, alerts and decisions, messages, emergency, command feedback, event feed, episodes.
- **Rundown table.** One row per `ControlView.rows` entry. Columns:

  | Column | Content |
  |---|---|
  | `#` | slot + 1 |
  | Blocco | block name, on the first row of each block only |
  | Elemento | `Servizio · <title>` for media, `Studio` or `Break` otherwise |
  | Stato | `in attesa`/`in onda`/`andato`/`rimandato`/`eliminato`; ` · provvisorio` when provisional; ` ↩` on the `returnSlot` row |
  | Inizio pian. | the block's planned start, first row of each block only, `—` before T0 |
  | Inizio, Fine | real wall times, or `—` |
  | Durata | studio rows (`durationMs: null`) `—` (BACKLOG); otherwise `durationText` plus the source badge (`PIAN.` or `STIMATO`) |

  - The cursor row has `aria-current="true"`.
  - Every other row has a `VAI` `ConfirmButton`, enabled only while live, which sends `goto`.
  - Rows carry `data-status`, for styling.
  - Real times come from the view. Per-row forecast times are deferred (BACKLOG).
- **Event feed** ("log in tempo reale", SPEC §8).
  - Derived only from successive control views received in this session. It is labelled `EVENTI (questa sessione)` and is **not** the server journal.
  - Newest first, at most 200 entries, each with the server wall time. Changes wait for the first clock sample, because the first view arrives before the first pong.
  - The event rules are those of `diffViews`, in order:
    1. episode loaded or unloaded;
    2. phase;
    3. slot status, and provisional;
    4. message shown or cleared;
    5. OBS lost or OK;
    6. REC started, stopped or paused; streaming started or stopped;
    7. control manual or auto;
    8. new decision, decision confirmed with its choice;
    9. off-script start or end;
    10. ambiguous.
- **Episode picker** (rehearsal, minimal; the real editor is Plan 5).
  - Lists `GET /api/episodes` as name and date, newest first, with a `CARICA` button (disabled for the loaded episode) that posts `/api/live/load`.
  - `409 live_running` → `Live in corso: impossibile caricare un'altra puntata`. Any other failure → `Caricamento non riuscito: <code>`.
  - An empty list → `Nessuna puntata salvata`.
  - `Aggiorna` reloads the list.
- **Commands** are the same as in the dock, through the same panels and the same `useCommand` feedback.

- [ ] **Step 1: Write the failing tests**

`web/test/control/event-feed.test.ts`:
```ts
// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import { FEED_LIMIT, appendFeed, diffViews, type FeedEntry } from '../../src/control/event-feed';
import type { ControlView } from '../../src/core/views';
import { WALL, controlView, preshowView, studioView } from '../support/views';

const keys = (prev: ControlView | null, next: ControlView | null) => diffViews(prev, next).map((e) => e.key);

describe('diffViews', () => {
  it('reports loading and unloading an episode', () => {
    expect(diffViews(null, null)).toEqual([]);
    expect(diffViews(null, controlView())).toEqual([{ key: 'evLoaded', params: { name: 'Solo Futsal · 12/10/2026' } }]);
    expect(keys(controlView(), null)).toEqual(['evUnloaded']);
    expect(keys(controlView(), controlView({ episode: { id: 'other', name: 'Altra' } }))).toEqual(['evLoaded']);
    expect(diffViews(controlView(), controlView())).toEqual([]);
  });

  it('reports the phase, with OLTRE SCALETTA as its own phase', () => {
    expect(keys(controlView({ presenter: preshowView() }), controlView())).toEqual(['evPhaseLive', 'evRecStarted']); // REC start makes it live
    expect(keys(controlView(), controlView({ presenter: studioView({ rundownFinished: true }) }))).toEqual(['evPhaseOverrun']);
  });

  it('reports slot status and provisional changes with the slot title', () => {
    const before = controlView();
    const rows = before.rows.map((r) => ({ ...r }));
    rows[4] = { ...rows[4]!, status: 'done' };
    rows[5] = { ...rows[5]!, status: 'onair', provisional: true };
    expect(diffViews(before, controlView({ rows }))).toEqual([
      { key: 'evSlotDone', params: { title: 'Secondo blocco' } },
      { key: 'evSlotOnair', params: { title: 'Servizio 2' } },
      { key: 'evSlotProvisional', params: { title: 'Servizio 2' } },
    ]);
  });

  it('reports messages, OBS, outputs and control mode in a fixed order', () => {
    const quiet = controlView();
    const busy = controlView({
      obs: 'lost',
      control: 'manual',
      presenter: studioView({
        message: { text: 'STRINGI' },
        status: { rec: false, stream: true, recPaused: false, obs: 'lost', control: 'manual' },
      }),
    });
    expect(diffViews(quiet, busy)).toEqual([
      { key: 'evMessage', params: { text: 'STRINGI' } },
      { key: 'evObsLost', params: {} },
      { key: 'evRecStopped', params: {} },
      { key: 'evStreamStarted', params: {} },
      { key: 'evControlManual', params: {} },
    ]);
    expect(keys(busy, quiet)).toEqual(['evMessageCleared', 'evObsOk', 'evRecStarted', 'evStreamStopped', 'evControlAuto']);
    const paused = controlView({ presenter: studioView({ status: { rec: true, stream: false, recPaused: true, obs: 'ok', control: 'auto' } }) });
    expect(keys(quiet, paused)).toEqual(['evRecPaused']);
  });

  it('reports decisions, off-script and ambiguity', () => {
    const decision = { id: 1, kind: 'all_outputs_stopped' as const, atWall: WALL, defaultChoice: 'interruption', choice: 'interruption', confirmed: false };
    const a = controlView();
    const b = controlView({ decisions: [decision], offScript: { scene: 'CAMERA OSPITE', sinceWall: WALL }, ambiguous: true });
    expect(diffViews(a, b)).toEqual([
      { key: 'evDecisionAllStopped', params: {} },
      { key: 'evOffScript', params: { scene: 'CAMERA OSPITE' } },
      { key: 'evAmbiguous', params: {} },
    ]);
    const c = controlView({ decisions: [{ ...decision, choice: 'end', confirmed: true }] });
    expect(keys(b, c)).toEqual(['evChoseEnd', 'evOffScriptEnd']);
  });
});

describe('appendFeed', () => {
  it('puts the newest first, numbers entries and keeps at most FEED_LIMIT', () => {
    const old: FeedEntry[] = Array.from({ length: FEED_LIMIT - 1 }, (_, i) => ({ id: i + 1, atWall: WALL, key: 'evObsOk', params: {} }));
    const { feed, nextId } = appendFeed(old, [{ key: 'evObsLost', params: {} }, { key: 'evRecStopped', params: {} }], WALL + 1, FEED_LIMIT);
    expect(feed).toHaveLength(FEED_LIMIT);
    expect(feed.slice(0, 2)).toEqual([
      { id: FEED_LIMIT + 1, atWall: WALL + 1, key: 'evRecStopped', params: {} },
      { id: FEED_LIMIT, atWall: WALL + 1, key: 'evObsLost', params: {} },
    ]);
    expect(nextId).toBe(FEED_LIMIT + 2);
  });
});
```

`web/test/control/control.test.tsx`:
```tsx
// SPDX-License-Identifier: GPL-2.0-or-later
import { act, fireEvent, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ControlScreen } from '../../src/control/ControlScreen';
import { ApiError, type ApiClient } from '../../src/core/http';
import type { ControlView } from '../../src/core/views';
import { fakeApi } from '../support/api';
import { renderLive } from '../support/render';
import { StaticStore, snapshotOf } from '../support/store';
import { controlView, studioView } from '../support/views';

async function control(view: ControlView | null = controlView(), api: ApiClient = fakeApi()) {
  const store = new StaticStore(snapshotOf<'control'>(view));
  const utils = renderLive(<ControlScreen api={api} />, store);
  await act(async () => {});
  const rows = () => [...utils.container.querySelectorAll<HTMLTableRowElement>('table.rundown tbody tr')];
  const col = (cls: string) => rows().map((r) => r.querySelector(`.${cls}`)!.textContent);
  return { ...utils, store, rows, col };
}

describe('<ControlScreen> rundown', () => {
  it('lists every slot with block, item, status, planned and real times and durations', async () => {
    const c = await control();
    expect(c.rows()).toHaveLength(8);
    expect(c.col('c-slot')).toEqual(['1', '2', '3', '4', '5', '6', '7', '8']);
    expect(c.col('c-block')).toEqual(['Primo blocco', '', '', 'Break 1', 'Secondo blocco', '', '', 'Chiusura']);
    expect(c.col('c-item')).toEqual(['Studio', 'Servizio · Servizio 1', 'Studio', 'Break', 'Studio', 'Servizio · Servizio 2', 'Studio', 'Studio']);
    expect(c.col('c-status')).toEqual(['andato', 'andato', 'andato', 'andato', 'in onda', 'in attesa', 'in attesa', 'in attesa']);
    expect(c.col('c-planned')).toEqual(['13:56:40', '', '', '14:08:40', '14:11:40', '', '', '14:21:40']);
    expect(c.col('c-start')[4]).toBe('14:11:20');
    expect(c.col('c-end')[4]).toBe('—');
    expect(c.col('c-duration')).toEqual(['—', '3:05', '—', '3:00PIAN.', '—', '2:00', '—', '—']);
    expect(c.rows()[4]!.getAttribute('aria-current')).toBe('true');
    expect(c.rows()[4]!.dataset.status).toBe('onair');
  });

  it('shows provisional, postponed, dropped, the return slot and estimated durations', async () => {
    const base = controlView();
    const rows = base.rows.map((r) => ({ ...r }));
    rows[1] = { ...rows[1]!, status: 'postponed' };
    rows[5] = { ...rows[5]!, status: 'dropped', durationSource: 'estimated' };
    rows[6] = { ...rows[6]!, provisional: true };
    const c = await control(controlView({ rows, returnSlot: 4 }));
    expect(c.col('c-status')[1]).toBe('rimandato');
    expect(c.col('c-status')[4]).toBe('in onda ↩');
    expect(c.col('c-status')[5]).toBe('eliminato');
    expect(c.col('c-status')[6]).toBe('in attesa · provvisorio');
    expect(c.col('c-duration')[5]).toBe('2:00STIMATO');
  });

  it('jumps to a slot with a confirmed VAI, never on the current row', async () => {
    const c = await control();
    expect(within(c.rows()[4]!).queryByRole('button', { name: 'VAI' })).toBeNull();
    const go = within(c.rows()[6]!).getByRole('button', { name: 'VAI' });
    fireEvent.click(go);
    expect(c.store.commands).toEqual([]);
    fireEvent.click(go);
    expect(c.store.commands).toEqual([{ name: 'goto', slot: 6 }]);
  });

  it('offers the same commands as the dock', async () => {
    await control();
    expect(screen.getByRole('button', { name: 'NEXT' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '1 · STRINGI' })).toBeTruthy();
    expect(screen.getByRole('textbox', { name: 'Testo libero' })).toBeTruthy();
  });
});

describe('<ControlScreen> event feed', () => {
  it('logs what changes, newest first, with the server time', async () => {
    const c = await control();
    const feed = () => [...c.container.querySelectorAll('.feed-list li')].map((li) => li.textContent);
    expect(feed()).toEqual(['14:13:20 Puntata caricata: Solo Futsal · 12/10/2026']);
    c.update({ view: controlView({ presenter: studioView({ message: { text: 'STRINGI' } }) }) });
    expect(feed()[0]).toBe('14:13:20 Messaggio: STRINGI');
    expect(screen.getByText('EVENTI (questa sessione)')).toBeTruthy();
  });
});

describe('<ControlScreen> episode picker', () => {
  const episodes = [
    { id: 'ep-2026-10-12', name: 'Solo Futsal · 12/10/2026', date: '2026-10-12' },
    { id: 'ep-prova', name: 'Prova pomeriggio', date: '2026-10-11' },
  ];

  it('lists episodes and loads one; the loaded one cannot be reloaded', async () => {
    const loadEpisode = vi.fn(async () => {});
    const c = await control(controlView(), fakeApi({ listEpisodes: async () => episodes, loadEpisode }));
    const items = [...c.container.querySelectorAll<HTMLLIElement>('.episode-list li')];
    expect(items.map((li) => li.querySelector('.label-text')!.textContent)).toEqual(['Solo Futsal · 12/10/2026', 'Prova pomeriggio']);
    expect((within(items[0]!).getByRole('button', { name: 'CARICA' }) as HTMLButtonElement).disabled).toBe(true);
    await act(async () => {
      fireEvent.click(within(items[1]!).getByRole('button', { name: 'CARICA' }));
    });
    expect(loadEpisode).toHaveBeenCalledWith('ep-prova');
  });

  it('explains why a load was refused', async () => {
    const c = await control(
      controlView(),
      fakeApi({
        listEpisodes: async () => episodes,
        loadEpisode: async () => {
          throw new ApiError(409, 'live_running');
        },
      }),
    );
    const items = [...c.container.querySelectorAll<HTMLLIElement>('.episode-list li')];
    await act(async () => {
      fireEvent.click(within(items[1]!).getByRole('button', { name: 'CARICA' }));
    });
    expect(c.container.querySelector('.episodes .alert')!.textContent).toBe("Live in corso: impossibile caricare un'altra puntata");
  });

  it('says when there is nothing to load, and works without a loaded episode', async () => {
    const c = await control(null);
    expect(c.container.querySelector('.episodes .empty')!.textContent).toBe('Nessuna puntata salvata');
    expect(c.container.querySelector('.c-header h1')!.textContent).toBe('NESSUNA PUNTATA CARICATA');
    expect(c.container.querySelector('table.rundown')).toBeNull();
  });
});
```

- [ ] **Step 2: Run them and verify they fail**

Run: `pnpm vitest run web/test/control`. Expected: FAIL, because the modules are missing.

- [ ] **Step 3: Implement**

`web/src/control/event-feed.ts`:
```ts
// SPDX-License-Identifier: GPL-2.0-or-later
import type { MessageKey } from '../core/i18n';
import type { ControlView, PresenterView } from '../core/views';

export interface FeedEvent {
  key: MessageKey;
  params: Record<string, string>;
}

export interface FeedEntry extends FeedEvent {
  id: number;
  /** Server wall time at which the change arrived; null before the clock was synced. */
  atWall: number | null;
}

export const FEED_LIMIT = 200;

const PHASE_KEY = { preshow: 'evPhasePreshow', live: 'evPhaseLive', overrun: 'evPhaseOverrun', ended: 'evPhaseEnded' } as const;
const SLOT_KEY = { pending: 'evSlotPending', onair: 'evSlotOnair', done: 'evSlotDone', postponed: 'evSlotPostponed', dropped: 'evSlotDropped' } as const;
const CHOICE_KEY: Record<string, MessageKey> = {
  continue: 'evChoseContinue',
  new_session: 'evChoseNewSession',
  interruption: 'evChoseInterruption',
  end: 'evChoseEnd',
};

function phaseOf(p: PresenterView): keyof typeof PHASE_KEY {
  return p.phase === 'live' && p.rundownFinished ? 'overrun' : p.phase;
}

/**
 * Journal-like events between two control views (SPEC §8 "log in tempo reale"). Derived only from the views this
 * client received: a session feed, not the server journal.
 */
export function diffViews(prev: ControlView | null, next: ControlView | null): FeedEvent[] {
  if (next === null) return prev === null ? [] : [{ key: 'evUnloaded', params: {} }];
  if (prev === null || prev.episode.id !== next.episode.id) return [{ key: 'evLoaded', params: { name: next.episode.name } }];
  const out: FeedEvent[] = [];
  const add = (key: MessageKey, params: Record<string, string> = {}) => {
    out.push({ key, params });
  };
  const p = prev.presenter;
  const n = next.presenter;
  if (phaseOf(p) !== phaseOf(n)) add(PHASE_KEY[phaseOf(n)]);
  next.rows.forEach((row, i) => {
    const before = prev.rows[i];
    if (before === undefined) return;
    if (before.status !== row.status) add(SLOT_KEY[row.status], { title: row.title });
    if (!before.provisional && row.provisional) add('evSlotProvisional', { title: row.title });
  });
  const pm = p.message?.text ?? null;
  const nm = n.message?.text ?? null;
  if (nm !== null && nm !== pm) add('evMessage', { text: nm });
  else if (nm === null && pm !== null) add('evMessageCleared');
  if (prev.obs !== next.obs) add(next.obs === 'lost' ? 'evObsLost' : 'evObsOk');
  if (p.status.rec !== n.status.rec) add(n.status.rec ? 'evRecStarted' : 'evRecStopped');
  if (!p.status.recPaused && n.status.recPaused) add('evRecPaused');
  if (p.status.stream !== n.status.stream) add(n.status.stream ? 'evStreamStarted' : 'evStreamStopped');
  if (prev.control !== next.control) add(next.control === 'manual' ? 'evControlManual' : 'evControlAuto');
  for (const d of next.decisions) {
    const before = prev.decisions.find((x) => x.id === d.id);
    if (before === undefined) add(d.kind === 'output_restart' ? 'evDecisionOutputRestart' : 'evDecisionAllStopped');
    else if (!before.confirmed && d.confirmed) {
      const key = CHOICE_KEY[d.choice];
      if (key !== undefined) add(key);
    }
  }
  const po = prev.offScript?.scene ?? null;
  const no = next.offScript?.scene ?? null;
  if (no !== null && no !== po) add('evOffScript', { scene: no });
  else if (no === null && po !== null) add('evOffScriptEnd');
  if (!prev.ambiguous && next.ambiguous) add('evAmbiguous');
  return out;
}

/** Prepends `events` (the last derived on top) and keeps at most FEED_LIMIT entries. */
export function appendFeed(
  feed: FeedEntry[],
  events: FeedEvent[],
  atWall: number | null,
  nextId: number,
): { feed: FeedEntry[]; nextId: number } {
  const fresh = events.map((e, i) => ({ id: nextId + i, atWall, key: e.key, params: e.params }));
  return { feed: [...fresh.reverse(), ...feed].slice(0, FEED_LIMIT), nextId: nextId + events.length };
}
```

`web/src/control/EventFeed.tsx`:
```tsx
// SPDX-License-Identifier: GPL-2.0-or-later
import { useEffect, useRef, useState } from 'react';
import { wallText } from '../core/time-format';
import type { ControlView } from '../core/views';
import { useLive } from '../ui/live-context';
import { appendFeed, diffViews, type FeedEntry } from './event-feed';

/** Accumulates the session feed from successive views; waits for the first clock sample so every entry has a server time. */
export function useEventFeed(view: ControlView | null, synced: boolean): FeedEntry[] {
  const { store } = useLive();
  const prev = useRef<ControlView | null>(null);
  const state = useRef<{ feed: FeedEntry[]; nextId: number }>({ feed: [], nextId: 1 });
  const [feed, setFeed] = useState<FeedEntry[]>([]);
  useEffect(() => {
    if (!synced) return; // the first view arrives before the first pong: keep it until the clock is known
    const events = diffViews(prev.current, view);
    prev.current = view;
    if (events.length === 0) return;
    state.current = appendFeed(state.current.feed, events, store.serverNow(), state.current.nextId);
    setFeed(state.current.feed);
  }, [view, synced, store]);
  return feed;
}

export function EventFeed({ entries }: { entries: FeedEntry[] }) {
  const { t, timeZone } = useLive();
  return (
    <section className="panel feed">
      <h2 className="panel-title">{t('events')}</h2>
      <ol className="feed-list">
        {entries.map((e) => (
          <li key={e.id}>
            <span className="feed-time">{e.atWall === null ? '—' : wallText(e.atWall, timeZone)}</span>{' '}
            <span className="feed-text">{t(e.key, e.params)}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}
```

`web/src/control/RundownTable.tsx`:
```tsx
// SPDX-License-Identifier: GPL-2.0-or-later
import type { ClientCommand } from '@olc/shared';
import { durationText, wallText } from '../core/time-format';
import type { ControlView } from '../core/views';
import { SourceBadge } from '../ui/SourceBadge';
import { ConfirmButton } from '../ui/control/ConfirmButton';
import { useLive } from '../ui/live-context';

const COLUMNS = ['colSlot', 'colBlock', 'colItem', 'colStatus', 'colPlanned', 'colStart', 'colEnd', 'colDuration'] as const;

/** SPEC §8 extended view: every rundown element with its status, planned and real times and duration source. */
export function RundownTable({ view, run }: { view: ControlView; run: (command: ClientCommand) => Promise<boolean> }) {
  const { t, timeZone } = useLive();
  const live = view.presenter.phase === 'live';
  const wall = (ms: number | null) => (ms === null ? '—' : wallText(ms, timeZone));
  return (
    <table className="rundown">
      <thead>
        <tr>
          {COLUMNS.map((key) => (
            <th key={key} scope="col">
              {t(key)}
            </th>
          ))}
          <th scope="col" aria-label={t('goto')} />
        </tr>
      </thead>
      <tbody>
        {view.rows.map((row, i) => {
          const firstOfBlock = i === 0 || view.rows[i - 1]!.blockIndex !== row.blockIndex;
          const current = row.slot === view.cursor;
          return (
            <tr key={row.slot} data-status={row.status} data-provisional={String(row.provisional)} aria-current={current ? 'true' : undefined}>
              <td className="c-slot">{row.slot + 1}</td>
              <td className="c-block label-text">{firstOfBlock ? row.blockName : ''}</td>
              <td className="c-item label-text">{row.kind === 'media' ? `${t('kind_media')} · ${row.title}` : t(`kind_${row.kind}`)}</td>
              <td className="c-status">
                {t(`status_${row.status}`)}
                {row.provisional ? ` · ${t('provisional')}` : ''}
                {view.returnSlot === row.slot ? ' ↩' : ''}
              </td>
              <td className="c-planned">{firstOfBlock ? wall(row.plannedStartAtWall) : ''}</td>
              <td className="c-start">{wall(row.startedAtWall)}</td>
              <td className="c-end">{wall(row.endedAtWall)}</td>
              <td className="c-duration">
                {row.durationMs === null ? '—' : durationText(row.durationMs)}
                {row.durationMs !== null ? <SourceBadge source={row.durationSource} showPlanned /> : null}
              </td>
              <td className="c-goto">
                {current ? null : <ConfirmButton label={t('goto')} disabled={!live} onConfirm={() => void run({ name: 'goto', slot: row.slot })} />}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
```

`web/src/control/EpisodePicker.tsx`:
```tsx
// SPDX-License-Identifier: GPL-2.0-or-later
import { useCallback, useEffect, useState } from 'react';
import { ApiError, type ApiClient, type EpisodeSummary } from '../core/http';
import { useLive } from '../ui/live-context';

/** Minimal rehearsal loader (the editor is Plan 5): list the saved episodes and load one for the live. */
export function EpisodePicker({ api, loadedId }: { api: ApiClient; loadedId: string | null }) {
  const { t } = useLive();
  const [episodes, setEpisodes] = useState<EpisodeSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const codeOf = (err: unknown) => (err instanceof ApiError ? err.code : 'network');

  const refresh = useCallback(() => {
    api.listEpisodes().then(
      (list) => {
        setEpisodes(list);
        setError(null);
      },
      (err: unknown) => setError(t('loadFailed', { code: codeOf(err) })),
    );
  }, [api, t]);
  useEffect(() => {
    refresh();
  }, [refresh]);

  const load = async (id: string) => {
    try {
      await api.loadEpisode(id);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError && err.code === 'live_running' ? t('liveRunning') : t('loadFailed', { code: codeOf(err) }));
    }
  };

  return (
    <section className="panel episodes">
      <h2 className="panel-title">{t('episodes')}</h2>
      <button type="button" className="refresh" onClick={refresh}>
        {t('refresh')}
      </button>
      {error !== null ? (
        <div className="alert" role="alert">
          {error}
        </div>
      ) : null}
      {episodes !== null && episodes.length === 0 ? <div className="empty">{t('noEpisodes')}</div> : null}
      <ul className="episode-list">
        {(episodes ?? []).map((ep) => (
          <li key={ep.id} data-loaded={String(ep.id === loadedId)}>
            <span className="label-text">{ep.name}</span>
            <span className="episode-date">{ep.date}</span>
            <button type="button" disabled={ep.id === loadedId} onClick={() => void load(ep.id)}>
              {t('load')}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
```

`web/src/control/ControlScreen.tsx`:
```tsx
// SPDX-License-Identifier: GPL-2.0-or-later
import { httpApi, type ApiClient } from '../core/http';
import { ConnectionOverlay } from '../ui/ConnectionOverlay';
import { Alerts } from '../ui/control/Alerts';
import { CommandFeedback } from '../ui/control/CommandFeedback';
import { EmergencyPanel } from '../ui/control/EmergencyPanel';
import { MessagePanel } from '../ui/control/MessagePanel';
import { StatusPanel } from '../ui/control/StatusPanel';
import { useCommand } from '../ui/control/useCommand';
import { useObsStatus } from '../ui/control/useObsStatus';
import { useLive, useSnapshot } from '../ui/live-context';
import { EpisodePicker } from './EpisodePicker';
import { EventFeed, useEventFeed } from './EventFeed';
import { RundownTable } from './RundownTable';

const defaultApi = httpApi();

/** SPEC §8 / F14: the extended control view, opened from the dock. Role `control`. */
export function ControlScreen({ api = defaultApi }: { api?: ApiClient }) {
  const { t } = useLive();
  const snap = useSnapshot<'control'>();
  const { run, feedback } = useCommand();
  const obs = useObsStatus(api);
  const feed = useEventFeed(snap.view, snap.synced);
  const view = snap.view;
  const ready = snap.hasView && snap.synced;
  return (
    <div className="control">
      <header className="c-header">
        <h1 className="label-text">{view === null ? t('noEpisode') : view.episode.name}</h1>
      </header>
      <main className="c-main">
        <div className="c-rundown">{ready && view !== null ? <RundownTable view={view} run={run} /> : null}</div>
        <div className="c-side">
          {ready && view !== null ? (
            <>
              <StatusPanel view={view} />
              <Alerts view={view} obs={obs} run={run} />
            </>
          ) : null}
          {ready ? (
            <>
              <MessagePanel view={view} run={run} />
              <EmergencyPanel view={view} run={run} />
            </>
          ) : null}
          <CommandFeedback feedback={feedback} />
          <EventFeed entries={feed} />
          <EpisodePicker api={api} loadedId={view?.episode.id ?? null} />
        </div>
      </main>
      <ConnectionOverlay />
    </div>
  );
}
```

`web/src/control/control.css`:
```css
/* SPDX-License-Identifier: GPL-2.0-or-later */
.control { min-height: 100%; display: flex; flex-direction: column; gap: 12px; padding: 12px; font-size: 15px; }
.c-header h1 { margin: 0; font-size: 1.3rem; }
.c-main { display: grid; grid-template-columns: minmax(0, 2fr) minmax(300px, 1fr); gap: 12px; align-items: start; }
@media (max-width: 900px) {
  .c-main { grid-template-columns: minmax(0, 1fr); }
}
.c-rundown { min-width: 0; overflow-x: auto; }
.c-side { display: flex; flex-direction: column; gap: 8px; min-width: 0; }
.rundown { width: 100%; border-collapse: collapse; table-layout: fixed; }
.rundown th { text-align: left; color: var(--fg-dim); font-size: 0.8rem; padding: 4px 6px; border-bottom: 1px solid var(--tile-border); }
.rundown td { padding: 4px 6px; border-bottom: 1px solid var(--tile-border); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.rundown th:nth-child(1) { width: 3em; }
.rundown th:nth-child(2) { width: 16%; }
.rundown th:nth-child(3) { width: 26%; }
.rundown th:nth-child(4) { width: 13%; }
.rundown th:nth-child(5), .rundown th:nth-child(6), .rundown th:nth-child(7) { width: 9%; }
.rundown th:nth-child(8) { width: 10%; }
.rundown th:nth-child(9) { width: 5em; }
.rundown tr[aria-current='true'] td { background: var(--surface); font-weight: 700; }
.rundown tr[aria-current='true'] td.c-slot { box-shadow: inset 4px 0 0 var(--red); }
.rundown tr[data-status='done'] td, .rundown tr[data-status='dropped'] td { color: var(--fg-dim); }
.rundown tr[data-status='dropped'] td.c-item { text-decoration: line-through; }
.rundown tr[data-provisional='true'] td.c-status { color: var(--estimated); }
.feed-list { margin: 0; padding: 0; list-style: none; max-height: 40vh; overflow-y: auto; font-size: 0.9rem; }
.feed-time { color: var(--fg-dim); }
.episode-list { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 4px; }
.episode-list li { display: flex; align-items: center; gap: 8px; min-width: 0; }
.episode-list .label-text { flex: 1 1 auto; }
.episode-date { color: var(--fg-dim); }
.empty { color: var(--fg-dim); }
```

`web/src/control/main.tsx` (replaces the placeholder):
```tsx
// SPDX-License-Identifier: GPL-2.0-or-later
import { createRoot } from 'react-dom/client';
import '../ui/fonts';
import '../ui/base.css';
import '../ui/control/panels.css';
import './control.css';
import { browserFrameLoop } from '../core/frame-loop';
import { parseParams } from '../core/params';
import { LiveClient, wsUrl } from '../core/ws-client';
import { LiveProvider } from '../ui/live-context';
import { installTokens } from '../ui/tokens';
import { ControlScreen } from './ControlScreen';

const params = parseParams(location.search);
installTokens();
document.documentElement.lang = params.lang;

const client = new LiveClient({ url: wsUrl(location), role: 'control' });
client.start();

createRoot(document.getElementById('root')!).render(
  <LiveProvider store={client} frames={browserFrameLoop()} lang={params.lang}>
    <ControlScreen />
  </LiveProvider>,
);
```

- [ ] **Step 4: Run them and verify they pass; build**

Run: `pnpm test && pnpm typecheck && pnpm --filter @olc/web build`. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/control web/test/control
git commit -m "feat(web): extended control view with rundown table, session event feed and rehearsal episode loading"
```

---

### Task 13: Integration — real server + obs-sim + real clients, rendered output

**Files:**
- Create: `web/test/integration/live.test.tsx`

**Interfaces:**
- Consumes:
  - `buildServer` (`@olc/server/app/server`), `startObsSim` (`@olc/obs-sim`), `soloFutsalFormat` (`@olc/shared/testing`);
  - `LiveClient` with Node's global `WebSocket`;
  - `PresenterScreen`, `DockScreen`, `LiveProvider`, `fakeApi`.

**Why this shape:**
- The file runs under `// @vitest-environment node`. jsdom replaces the global `Event` class, which breaks Node's `WebSocket` (verified: `TypeError: The "event" argument must be an instance of Event`).
- It renders with `react-dom/server` `renderToStaticMarkup`, which is a headless DOM-free render of the real components. The counters compute their value during render (Task 8), so the markup shows exactly what a first paint shows.
- Node's `WebSocket` sends no `Origin` header, so the Host/Origin guard accepts it with Host `127.0.0.1:<port>`.

**Scenario.** Every wait is a bounded poll (50 ms steps, 8 s max) that fails with a clear label. Run it 3 times; it must be green every time.

| Step | Action | Expected |
|---|---|---|
| 0 | first render, before `start()` | `CONNESSIONE…`, no `d:dd` anywhere |
| 1 | clients connect, nothing loaded | `NESSUNA PUNTATA CARICATA` |
| 2 | load the episode (planned start in 1 h), OBS connected | `INIZIO PROGRAMMA`, main counter `59:5x` or `1:00:00`, `SCALETTA`, `Primo blocco` |
| 3 | `rec started` | `BLOCCO 1 · Primo blocco`, main counter `11:xx` or `12:00`, `NEXT`, `Servizio 1`, `FINE PROGRAMMA`, `OBS ✓`; dock shows `LIVE` and `STUDIO` |
| 4 | program `CAMERA OSPITE`, then back to `CAM 1` | dock shows `FUORI SCALETTA: CAMERA OSPITE`; presenter never shows `FUORI SCALETTA` |
| 5 | program `PLAYOUT` and deck item 0 plays | `RIENTRO TRA`, `SERVIZIO · Servizio 1`, `RIENTRO: Primo blocco`, no `BLOCCO 1 · Primo blocco` |
| 6 | the clip ends, `CAM 1`, filler playing, program `BREAK` | `BREAK · Break 1`, `RIENTRO: Secondo blocco` |
| 7 | `dropConnections()` | presenter: `⚠ OBS NON CONNESSO` and `STIMATO`; dock: `⚠ OBS NON CONNESSO` |
| 8 | the server closes | within ~2.3 s `RICONNESSIONE…`; the main counter is identical 1.1 s later (frozen, not counting) |

- [ ] **Step 1: Write the test** (it fails until Tasks 1–12 are in, then it drives them all)

`web/test/integration/live.test.tsx`:
```tsx
// SPDX-License-Identifier: GPL-2.0-or-later
// @vitest-environment node
import { mkdtemp, rm } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it } from 'vitest';
import type { ClientRole } from '@olc/shared';
import { soloFutsalFormat } from '@olc/shared/testing';
import { startObsSim } from '@olc/obs-sim';
import { buildServer } from '@olc/server/app/server';
import type { FrameLoop } from '../../src/core/frame-loop';
import { LiveClient, type LiveStore, type SocketLike } from '../../src/core/ws-client';
import { DockScreen } from '../../src/dock/DockScreen';
import { PresenterScreen } from '../../src/presenter/PresenterScreen';
import { LiveProvider } from '../../src/ui/live-context';
import { fakeApi } from '../support/api';

const SCENES = {
  'CAM 1': [],
  'CAM 2': [],
  'CAM 3': [],
  PLAYOUT: [{ sourceName: 'Deck Media', kind: 'input' as const }],
  BREAK: [{ sourceName: 'Tappo', kind: 'input' as const }],
};
const DECK = {
  version: '1.4.0',
  sourceName: 'Deck Media',
  items: [
    { title: 'Servizio 1', path: 'D:/media/servizio1.mp4', durationMs: 185_000 },
    { title: 'Servizio 2', path: 'D:/media/servizio2.mp4', durationMs: 120_000 },
  ],
};

const noFrames: FrameLoop = { subscribe: () => () => {} };
const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()!();
});

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Bounded polling (50 ms steps): the first truthy probe result, or a failure naming what was awaited. */
async function waitFor<T>(label: string, probe: () => T | null | undefined | false, timeoutMs = 8_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = probe();
    if (value) return value;
    if (Date.now() >= deadline) throw new Error(`Timed out after ${timeoutMs} ms waiting for ${label}`);
    await delay(50);
  }
}

const decode = (s: string) =>
  s.replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

/** Headless render of a real screen against a real client: the markup a first paint would show. */
function render(store: LiveStore<ClientRole>, ui: ReactElement): { html: string; text: string } {
  const html = renderToStaticMarkup(
    <LiveProvider store={store} frames={noFrames} lang="it">
      {ui}
    </LiveProvider>,
  );
  return { html, text: decode(html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')).trim() };
}

const mainCounter = (html: string) => decode(/class="counter p-main-counter"[^>]*>([^<]*)</.exec(html)?.[1] ?? '');

function client<R extends ClientRole>(port: number, role: R): LiveClient<R> {
  const c = new LiveClient({ url: `ws://127.0.0.1:${port}/ws`, role, createSocket: (url) => new WebSocket(url) as unknown as SocketLike });
  cleanups.push(() => c.stop());
  return c;
}

describe('web clients against the real server and the OBS simulator', () => {
  it('drives the presenter and the dock from PRE-SHOW to OBS loss and server loss', async () => {
    const sim = await startObsSim({ port: 0, scenes: SCENES, inputs: ['Deck Media', 'Tappo'], program: 'CAM 1', deck: DECK });
    cleanups.push(() => sim.close());
    const dir = await mkdtemp(join(tmpdir(), 'olc-web-'));
    cleanups.push(() => rm(dir, { recursive: true, force: true, maxRetries: 5 }));
    const { app } = await buildServer({ dataDir: dir, restrictAcl: async () => {}, obsCredentials: { host: '127.0.0.1', port: sim.port } });
    let appOpen = true;
    cleanups.push(async () => {
      if (appOpen) await app.close();
    });
    await app.listen({ port: 0, host: '127.0.0.1' });
    const port = (app.server.address() as AddressInfo).port;

    const plannedStart = new Date(Date.now() + 3_600_000).toISOString();
    expect((await app.inject({ method: 'POST', url: '/api/formats', payload: soloFutsalFormat() })).statusCode).toBe(201);
    const created = await app.inject({
      method: 'POST',
      url: '/api/formats/solo-futsal/episodes',
      payload: { id: 'ep-1', date: plannedStart.slice(0, 10), plannedStart, playlistName: null },
    });
    expect(created.statusCode).toBe(201);

    const presenter = client(port, 'presenter');
    const control = client(port, 'control');
    const showPresenter = () => render(presenter, <PresenterScreen />);
    const showDock = () => render(control, <DockScreen api={fakeApi()} search="" />);

    // 0. First paint, before anything arrived: no number at all.
    expect(showPresenter().text).toContain('CONNESSIONE…');
    expect(showPresenter().text).not.toMatch(/\d:\d\d/);
    presenter.start();
    control.start();

    // 1. Connected and synced, nothing loaded yet.
    await waitFor('presenter ready without an episode', () => {
      const s = presenter.getSnapshot();
      return s.hasView && s.synced && s.view === null;
    });
    expect(showPresenter().text).toContain('NESSUNA PUNTATA CARICATA');

    // 2. PRE-SHOW once loaded, with OBS connected.
    expect((await app.inject({ method: 'POST', url: '/api/live/load', payload: { episodeId: 'ep-1' } })).statusCode).toBe(200);
    await waitFor('pre-show with OBS connected', () => {
      const v = presenter.getSnapshot().view;
      return v?.phase === 'preshow' && v.status.obs === 'ok';
    });
    let out = showPresenter();
    expect(out.text).toContain('INIZIO PROGRAMMA');
    expect(mainCounter(out.html)).toMatch(/^(59:5\d|1:00:00)$/);
    expect(out.text).toContain('SCALETTA');
    expect(out.text).toContain('Primo blocco');

    // 3. REC starts: live, in studio, on both screens.
    sim.setRecord('started');
    await waitFor('live in studio', () => {
      const p = presenter.getSnapshot().view;
      const c = control.getSnapshot().view;
      return p?.phase === 'live' && p.segment === 'studio' && c?.presenter.phase === 'live';
    });
    out = showPresenter();
    expect(out.text).toContain('BLOCCO 1 · Primo blocco');
    expect(mainCounter(out.html)).toMatch(/^1[12]:\d\d$/);
    expect(out.text).toContain('NEXT');
    expect(out.text).toContain('Servizio 1');
    expect(out.text).toContain('FINE PROGRAMMA');
    expect(out.text).toContain('OBS ✓');
    const dockLive = showDock().text;
    expect(dockLive).toContain('LIVE');
    expect(dockLive).toContain('STUDIO');

    // 4. An unknown scene: the dock says FUORI SCALETTA, the presenter never does.
    sim.setProgram('CAMERA OSPITE');
    const dockOff = await waitFor('off-script in the dock', () =>
      control.getSnapshot().view?.offScript?.scene === 'CAMERA OSPITE' ? showDock() : null,
    );
    expect(dockOff.text).toContain('FUORI SCALETTA: CAMERA OSPITE');
    expect(showPresenter().text).not.toContain('FUORI SCALETTA');
    sim.setProgram('CAM 1');
    await waitFor('back on script', () => control.getSnapshot().view?.offScript === null);

    // 5. A service from Playlist Deck: RIENTRO TRA and what is on air; the block is not shown.
    sim.setProgram('PLAYOUT');
    sim.deckPlay(0);
    await waitFor('media segment', () => presenter.getSnapshot().view?.segment === 'media');
    out = showPresenter();
    expect(out.text).toContain('RIENTRO TRA');
    expect(out.text).toContain('SERVIZIO · Servizio 1');
    expect(out.text).toContain('RIENTRO: Primo blocco');
    expect(out.text).not.toContain('BLOCCO 1 · Primo blocco');
    expect(mainCounter(out.html)).toMatch(/^\d:\d\d$/);

    // 6. The clip ends, back to studio, then the break with its filler playing.
    sim.deckPlayback(185_000, false);
    sim.setProgram('CAM 1');
    await waitFor('studio again', () => presenter.getSnapshot().view?.segment === 'studio');
    sim.setMedia('Tappo', { state: 'OBS_MEDIA_STATE_PLAYING', cursor: 0, duration: 180_000 });
    sim.setProgram('BREAK');
    await waitFor('break segment', () => presenter.getSnapshot().view?.segment === 'break');
    out = showPresenter();
    expect(out.text).toContain('BREAK · Break 1');
    expect(out.text).toContain('RIENTRO: Secondo blocco');

    // 7. OBS goes away: both screens warn, values become estimated (captured before the server reconnects).
    sim.dropConnections();
    const lost = await waitFor('OBS lost on both screens', () =>
      presenter.getSnapshot().view?.status.obs === 'lost' && control.getSnapshot().view?.obs === 'lost'
        ? { presenter: showPresenter().text, dock: showDock().text }
        : null,
    );
    expect(lost.presenter).toContain('⚠ OBS NON CONNESSO');
    expect(lost.presenter).toContain('STIMATO');
    expect(lost.dock).toContain('⚠ OBS NON CONNESSO');

    // 8. The server goes away: ~2 s later RICONNESSIONE…, and the counters freeze instead of counting on.
    appOpen = false;
    await app.close();
    await waitFor('stale presenter', () => presenter.getSnapshot().stale, 6_000);
    const frozen = showPresenter();
    expect(frozen.text).toContain('RICONNESSIONE…');
    await delay(1_100);
    expect(mainCounter(showPresenter().html)).toBe(mainCounter(frozen.html));
    expect(mainCounter(frozen.html)).not.toBe('');
  }, 45_000);
});
```

- [ ] **Step 2: Run it**

Run: `pnpm vitest run web/test/integration/live.test.tsx` three times. Expected: PASS every time, in well under 45 s. If a step times out, the label names it. Debug the component or the server, never the expectation.

- [ ] **Step 3: Full suite**

Run: `pnpm test && pnpm typecheck`. Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add web/test/integration/live.test.tsx
git commit -m "test(web): presenter and dock driven end to end by the real server and the obs simulator"
```

---

### Task 14: Dev tooling, README and CI build

**Files:**
- Create: `scripts/dev.mjs`, `server/scripts/seed-dev.ts`
- Modify:
  - `package.json`: scripts `"build": "pnpm --filter @olc/web build"` and `"dev": "node scripts/dev.mjs"`;
  - `server/package.json`: script `"seed:dev": "tsx scripts/seed-dev.ts"`;
  - `server/tsconfig.json`: include `"scripts"`;
  - `.gitignore`: add `.dev-data/`;
  - `.github/workflows/ci.yml`: add `- run: pnpm build` after `pnpm test`;
  - `README.md`.

**Rules:**
- **`pnpm dev`**, from the repo root, starts three processes with prefixed output: `[sim]`, `[server]`, `[web]`.
  - `pnpm --filter @olc/obs-sim start`. This terminal's stdin is piped to the simulator, so its commands (`program PLAYOUT`, `rec started`, `play 0`, `drop`, …) can be typed directly.
  - `pnpm --filter @olc/server dev`, with `OLC_DATA_DIR=<repo>/.dev-data`. The script first writes `.dev-data/settings.json` = `{ "obs": { "host": "127.0.0.1", "port": 4455 } }` when it is missing, so the server connects to the simulator.
  - `pnpm --filter @olc/web dev`: Vite on `http://localhost:5173`, proxying `/api` and `/ws` to `127.0.0.1:4460`.
- **Seeding.** Once `GET http://127.0.0.1:4460/api/health` answers (polled every 500 ms, up to 30 s), the script runs `pnpm --filter @olc/server seed:dev`. That creates the Solo Futsal format and episode `ep-dev`, planned 5 minutes ahead, and loads it.
  - 409 on create is fine.
  - 409 `live_running` on load prints a note.
  - The script then prints the three URLs.
- **Shutdown.** Ctrl+C or any child exiting stops all three: on Windows with `taskkill /pid <pid> /T /F`, elsewhere with `SIGTERM`.
- **Seed script.** It uses `fetch` with no `Origin` header, so the host guard accepts it, and `OLC_URL` (default `http://127.0.0.1:4460`).
- **CI.** `pnpm build` runs `vite build` on the three OSes.

`scripts/dev.mjs`:
```js
// SPDX-License-Identifier: GPL-2.0-or-later
// Development launcher: obs-sim + server + Vite. Type obs-sim commands in this terminal (e.g. "rec started").
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = join(root, '.dev-data');
const settingsFile = join(dataDir, 'settings.json');
const isWindows = process.platform === 'win32';

mkdirSync(dataDir, { recursive: true });
if (!existsSync(settingsFile)) {
  writeFileSync(settingsFile, `${JSON.stringify({ obs: { host: '127.0.0.1', port: 4455 } }, null, 2)}\n`);
}

const children = [];
let stopping = false;

function prefix(name, stream, out) {
  let buffer = '';
  stream.setEncoding('utf8');
  stream.on('data', (chunk) => {
    buffer += chunk;
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? '';
    for (const line of lines) out.write(`[${name}] ${line}\n`);
  });
}

function run(name, args, { stdin = 'ignore', env = {} } = {}) {
  const child = spawn('pnpm', args, { cwd: root, shell: isWindows, stdio: [stdin, 'pipe', 'pipe'], env: { ...process.env, ...env } });
  prefix(name, child.stdout, process.stdout);
  prefix(name, child.stderr, process.stderr);
  child.on('exit', (code) => {
    console.log(`[${name}] exited (${code})`);
    shutdown();
  });
  children.push(child);
  return child;
}

function shutdown() {
  if (stopping) return;
  stopping = true;
  for (const child of children) {
    if (child.exitCode !== null || child.pid === undefined) continue;
    if (isWindows) spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    else child.kill('SIGTERM');
  }
  setTimeout(() => process.exit(0), 500);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

const sim = run('sim', ['--filter', '@olc/obs-sim', 'start'], { stdin: 'pipe' });
process.stdin.pipe(sim.stdin);
run('server', ['--filter', '@olc/server', 'dev'], { env: { OLC_DATA_DIR: dataDir } });
run('web', ['--filter', '@olc/web', 'dev']);

async function seedWhenReady() {
  const deadline = Date.now() + 30_000;
  while (!stopping && Date.now() < deadline) {
    try {
      if ((await fetch('http://127.0.0.1:4460/api/health')).ok) break;
    } catch {
      // not listening yet
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  if (stopping) return;
  const seed = spawn('pnpm', ['--filter', '@olc/server', 'seed:dev'], { cwd: root, shell: isWindows, stdio: 'inherit' });
  seed.on('exit', (code) => {
    if (code !== 0) console.log(`[dev] seed failed (${code})`);
    console.log('[dev] presenter http://localhost:5173/presenter · dock http://localhost:5173/dock · control http://localhost:5173/control');
  });
}
void seedWhenReady();
```
`scripts/dev.mjs` is outside `web/src`, so the offline-URL test does not scan it.

`server/scripts/seed-dev.ts`:
```ts
// SPDX-License-Identifier: GPL-2.0-or-later
// Dev only: create the Solo Futsal format and a rehearsal episode on a running server, and load it.
import { soloFutsalFormat } from '@olc/shared/testing';

const BASE = process.env.OLC_URL ?? 'http://127.0.0.1:4460';

function post(path: string, body: unknown): Promise<Response> {
  return fetch(`${BASE}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
}

async function main(): Promise<void> {
  const format = await post('/api/formats', soloFutsalFormat());
  if (format.status !== 201 && format.status !== 409) throw new Error(`format: HTTP ${format.status}`);
  const id = 'ep-dev';
  const plannedStart = new Date(Date.now() + 5 * 60_000).toISOString();
  const episode = await post('/api/formats/solo-futsal/episodes', { id, date: plannedStart.slice(0, 10), plannedStart, playlistName: null });
  if (episode.status !== 201 && episode.status !== 409) throw new Error(`episode: HTTP ${episode.status}`);
  const load = await post('/api/live/load', { episodeId: id });
  if (load.status === 409) {
    console.log('seed: a live show is running; ep-dev not loaded');
    return;
  }
  if (!load.ok) throw new Error(`load: HTTP ${load.status}`);
  console.log(`seed: loaded ${id}${episode.status === 201 ? ` (planned start ${plannedStart})` : ' (existing episode; delete .dev-data to reset)'}`);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
```

**README.md:**
- Replace the status line with: `> **Status:** server, OBS integration and the live web clients (presenter, dock, control view) are implemented; the editor, the OBS plugin and installers are next.`
- Add a `## Web clients` section with:
  - the URLs on the server (`http://127.0.0.1:4460/presenter`, `/dock`, `/control`; `/` redirects to `/control`). They need `pnpm build` first;
  - `?lang=en` and `?screen=<label>`;
  - the OBS dock setup (OBS → Docks → Custom Browser Docks → URL `http://127.0.0.1:4460/dock`, at least 300 px wide; Plan 6 registers it automatically);
  - the kiosk note: Plan 6 launches it, and manually it is `chrome --app=http://127.0.0.1:4460/presenter --kiosk`.
- Add to `## Development`:
  - `pnpm dev`: what it starts and the simulator command list (`program <scene> | rec <state> | stream <state> | play <index> | media <input> <state> <cursor> <duration> | drop`). Run it in an interactive terminal: the simulator exits when its stdin closes;
  - `pnpm build`;
  - the font licence note: Inter, SIL OFL 1.1, bundled from `@fontsource/inter`.

- [ ] **Step 1: Implement** the files above.

- [ ] **Step 2: Verify**

Run: `pnpm typecheck && pnpm test && pnpm build`. Expected: PASS, and `web/dist` is produced.

Manual check, on the developer machine:
1. `pnpm dev`. The three prefixes appear and the seed prints `seed: loaded ep-dev`.
2. Open `http://localhost:5173/presenter`. It shows PRE-SHOW with a countdown of about 5:00.
3. Type `rec started` in the terminal. The presenter turns LIVE and shows `BLOCCO 1 · Primo blocco`.
4. Ctrl+C stops all three processes.

Write the outcome in the task report.

- [ ] **Step 3: Commit**

```bash
git add scripts/dev.mjs server/scripts/seed-dev.ts server/package.json server/tsconfig.json package.json .gitignore .github/workflows/ci.yml README.md
git commit -m "chore: pnpm dev launcher with obs-sim, server, vite and seed; build in ci; web client docs"
```

---

### Task 15: Docs — TV test plan, BACKLOG, TECH-DESIGN alignment

**Files:** `docs/TEST-PLAN.md`, `docs/BACKLOG.md`, `docs/TECH-DESIGN.md`

**`docs/TEST-PLAN.md`.** Append a section `## Client web (Piano 4)`, in Italian and in the existing setup / action / expected-result format. Steps:
1. **Prerequisites.**
   - `pnpm build`, server started;
   - a 32" TV on the second HDMI output;
   - Chrome or Edge in kiosk mode on `/presenter`;
   - OBS 30.x with the Custom Browser Dock on `/dock`.
2. **AC10 legibility.** With a ruler on the TV in STUDIO, the main digits are at least 20 % of the screen height (about 8 cm on a 32" 16:9). From 4 m, block, next item and program end can be read at a glance.
3. **Colours.**
   - Amber from 1:00 left in the block (`+0:30` from the dock to get there faster).
   - Red counting up past zero.
   - Green full-screen in the last 10 s before the return from a break, which goes back to red `+0:00` if the filler ends without the return.
4. **Long titles.** A format with a 120-character block name and a 200-character media title: nothing overflows on the TV, and the dock at 300 px does not scroll horizontally.
5. **Offline.** With the network unplugged, all three pages load (fonts included). DevTools → Network shows only requests to 127.0.0.1.
6. **Reconnection.**
   - Stop the server mid-show: within 3 s `RICONNESSIONE…`, the counters stop and dim, and after 10 s they show `—`.
   - Restart the server: the screens recover on their own with the right values.
   - Restart the server ten times quickly: the server log shows no reconnection storm, at most one connection per client per backoff step.
7. **OBS lost.** Close OBS: `⚠ OBS NON CONNESSO` and `STIMATO` on the presenter, an alert in the dock. Reopen OBS: back to normal.
8. **Kiosk.** The cursor is not visible on the presenter, and the TV does not go to standby or dim after 15 minutes (Wake Lock).
9. **Dock in OBS 30 (CEF 103).**
   - The page works.
   - The Emergency section is closed by default.
   - NEXT needs a double click or a long press.
   - A message sent from the dock appears on the presenter within 500 ms (AC9) and disappears after its timeout.
   - CLEAR removes it.
10. **Decisions.** Stop and restart REC: the dock shows the decision with the default pressed; changing the choice is reflected in the control view.
11. **Control view.**
    - The rundown shows planned and real times, studio durations are `—`, and estimated durations show `STIMATO` with OBS closed.
    - The feed lists the events of the session.
    - Loading another episode during the live show is refused with the explicit message.
12. **Language.** `?lang=en` on all three pages.

**`docs/BACKLOG.md`.**
- Remove the "Piano 4" items that this plan closes: backpressure, half-open peers, the `block` gate, studio rows `—`, `ack` logic, the `ws.ts` guards.
- Add a section `## Piano 4 — residui`, written in the same style:
  - **Tempi previsti per riga** nella vista estesa (SPEC §8 "previsti"): oggi solo pianificati e reali.
  - **Feed eventi dal journal del server** invece che dalla sessione del client (endpoint di lettura del journal).
  - **`PresenterView.delay` dopo FINE** continua a crescere nel motore: il client lo nasconde, valutare di congelarlo nella proiezione.
  - **Numerazione "BLOCCO n"**: conta anche i break (il secondo blocco di studio è "BLOCCO 3"). Decisione di prodotto da confermare.
  - **Fuso orario degli orari a parete**: il client usa quello del browser; un tablet in LAN con fuso diverso mostrerebbe orari diversi.
  - **`?screen=`**: oggi è solo un'etichetta nel titolo; il Piano 6 ne definisce l'uso con il kiosk.
  - **Etichette hotkey nel dock** ("F1 · STRINGI", DT-9): oggi solo il numero di slot; il tasto reale arriva dal plugin (Piano 6).
  - **Percorso della web app dopo il bundle** (Piano 7): `OLC_WEB_ROOT` / `ServerOptions.webRoot`.
  - **Licenza OFL del font Inter** da includere nei crediti e nell'installer (Piano 7).
  - **Test Playwright in CI** (se il Task 16 non è stato eseguito, o per estenderlo).
  - **Fuori scaletta con scena sconosciuta**: `START PROGRAM` senza OBS marca `offScript` con `scene: ''` (`engine/matcher.ts`). Il dock mostra "—" come nome della scena: valutare di non marcare il fuori scaletta quando la scena in Program non è nota.

**`docs/TECH-DESIGN.md`.**
- §6.1:
  - Replace the `Anchor` block with the real shape: `countdown { endsAt, source }`, `frozen { valueMs, source }` (media paused or REC paused, shown with "PAUSA"), `unknown` ("—"). A countdown past zero is shown as a positive overrun; there is no `countup`.
  - Update the JSON example to the real `PresenterView` fields: `block`, `onAir`, `returnTo`, `next`, `programEnd { anchor, endsAtWall }`, `delay`, `thresholds`, `message`, `status`, `preshow`, `ended`.
  - Note that the schemas live in `shared/src/live/views.ts`.
- §6.3: add the display rule (ceil to whole seconds; 250 ms hysteresis on one-tick steps backwards; tally from the displayed ticks), the staleness rule (freeze at the stale instant, "—" after 10 s), and minimum-RTT-of-8 clock sync.
- §8:
  - The server serves `web/dist` through its own static handler (no `@fastify/static`, because of a BlueOak-licensed dependency), with `/` → `/control`, uncached HTML and immutable `/assets`.
  - `pnpm dev` for development.
  - The editor entry comes in Plan 5.

- [ ] **Step 1: Write the three documents.** Italian for `TEST-PLAN` and `BACKLOG`; keep each document's existing tone.

- [ ] **Step 2: Commit**

```bash
git add docs/TEST-PLAN.md docs/BACKLOG.md docs/TECH-DESIGN.md
git commit -m "docs: tv test plan for the web clients, backlog update and tech design alignment"
```

(Documentation only. The implementer writes it from these lists; the orchestrator reviews it.)

---

### Task 16 (OPTIONAL, bounded): Playwright smoke tests of the three pages against the simulator

Run this task only if the main session approves it (see "Decisions"). It is **not** part of `pnpm test` or CI. It needs a local Chromium download.

**Files:**
- Create: `web/playwright.config.ts`, `web/e2e/serve.ts`, `web/e2e/smoke.spec.ts`
- Modify:
  - `web/package.json`: devDependencies `"@playwright/test": "1.64.0"` (Apache-2.0, dev-only) and `"tsx": "^4.23.0"`; script `"e2e": "playwright test"`;
  - `.gitignore`: add `web/test-results/` and `web/playwright-report/`.

**Rules:**
- **Browser download.** `PLAYWRIGHT_BROWSERS_PATH=0 pnpm --filter @olc/web exec playwright install chromium` keeps Chromium inside `node_modules`, so nothing is installed globally.
- **`web/e2e/serve.ts`**, run by Playwright's `webServer` as `pnpm exec tsx e2e/serve.ts`, on port 4470:
  - starts `startObsSim` on a random port;
  - starts `buildServer({ dataDir: <temp>, webRoot: <web/dist>, obsCredentials: { host: '127.0.0.1', port: sim.port }, restrictAcl: async () => {} })`;
  - creates a format whose first block name is 120 × `W` and whose first media title is 200 × `M`, plus an episode `ep-e2e`, and loads it;
  - sends `rec started`;
  - closes everything on `SIGTERM`.
- **`playwright.config.ts`:** `testDir: 'e2e'`, `webServer: { command: 'pnpm exec tsx e2e/serve.ts', url: 'http://127.0.0.1:4470/api/health', reuseExistingServer: false }`, `use: { baseURL: 'http://127.0.0.1:4470' }`, a single `chromium` project.
- **`smoke.spec.ts`:**
  1. Each of `/presenter`, `/dock`, `/control` loads with no console error, and every request goes to `127.0.0.1:4470`. This uses `page.on('console')` and `page.on('request')`.
  2. Presenter at 1920×1080 and at 1024×768:
     - wait for `.p-root[data-mode="studio"]`;
     - for every `.p-root .tile` and for `.p-strip`, `scrollWidth <= clientWidth + 1`;
     - `document.documentElement.scrollWidth <= innerWidth`;
     - `parseFloat(getComputedStyle(.p-main-counter).fontSize) * 0.727 >= 0.2 * innerHeight` (AC10).
  3. Dock at 300×800: `document.documentElement.scrollWidth <= 300`.
  4. Presenter: `getComputedStyle(.p-root).cursor === 'none'`.
- Run `pnpm build && pnpm --filter @olc/web e2e` three times. Expected: green every time.

```bash
git add web/playwright.config.ts web/e2e web/package.json pnpm-lock.yaml .gitignore
git commit -m "test(web): optional playwright smoke tests for layout overflow, ac10 and offline requests"
```

---

## Decisions for the main session

1. **Font licence.** Inter is shipped from `@fontsource/inter` 5.3.0. The npm package is OFL-1.1: the font files are bundled **assets**, not code, so this is no MIT/BSD/ISC code dependency, and the OFL allows bundling with GPL software. *Recommended: accept, and credit it in the README and later in the installer.* Fallback: no bundled font, only a system stack with `tabular-nums`. Legibility then varies by OS and the kiosk look is less predictable.
2. **No `@fastify/static`.** It pulls `glob` 13 (BlueOak-1.0.0), which breaks the MIT/BSD/ISC rule. The plan uses a hand-written static handler instead (Task 3, about 60 lines, fully tested).
3. **Vite 7.3, not Vite 8.** Vite 7.3 is used to stay on Vitest 3.2's own Vite. Upgrading Vitest and Vite together is a separate chore.
4. **Design choices made for the "standard design".** Confirm or adjust:
   - (a) tally colours also apply to the **main digits** for amber and red, not only to borders and labels, following SPEC §11 "contatore in rosso";
   - (b) RIENTRO IMMINENTE is **green digits and a green frame on black**, not a full green screen, so a bright TV does not light the presenter's face;
   - (c) stale data **freezes and dims for 10 s, then shows `—`**;
   - (d) `1:00` is already amber (`≤ warnMs`);
   - (e) `/` redirects to `/control`;
   - (f) `?screen=` is only a label in the window title until Plan 6;
   - (g) "BLOCCO n" counts break blocks, because `n` = block index + 1.
5. **Projection additions visible to the product.** `ended` (FINE: total time and final offset), `presets` (the dock's messages and ±step) and `plannedStartAtWall` per row. The ended summary measures from T0, which already excludes REC-pause freezes in live-to-tape.
6. **Task 16 (Playwright).** Optional. It downloads Chromium locally and stays out of CI. *Recommended: run it once before the first real TV test, keep it as a local script, and list "Playwright in CI" in the backlog.*

---

## Self-review notes (plan author)

- **Spec coverage.**
  - SPEC §7, all states:
    - PRE-SHOW, STUDIO, SERVIZIO, BREAK: Tasks 9 and 10;
    - RIENTRO IMMINENTE: Tasks 9 and 10;
    - AVVISO and SFORAMENTO: Tasks 9 and 10;
    - OLTRE SCALETTA: Tasks 9 and 10;
    - FINE: Tasks 1, 9 and 10;
    - OBS lost / STIMATO: Tasks 10 and 13;
    - FUORI SCALETTA kept from the presenter: Tasks 10 and 13.
  - SPEC §8: dock (Task 11) and extended view (Task 12). The editor is Plan 5.
  - SPEC §12 orthogonal states:
    - source: every counter, with badges;
    - control mode: dock and control view;
    - outputs: the presenter strip.
  - SPEC §15: monitor disconnected → RICONNESSIONE…, never old data as current (Tasks 7, 8, 10, 13).
  - AC2 and AC6 in the integration test (Task 13).
  - AC8 (Tasks 9 and 10).
  - AC9 (TEST-PLAN; the message path is unit-tested in Task 11).
  - AC10 (Task 10 arithmetic, TEST-PLAN ruler, optional Playwright).
  - AC11 (`—` and badges everywhere).
  - TECH-DESIGN §6.3: Tasks 5 and 8. §8: Tasks 4, 10, 11, 12 and 14. §10: Task 3 keeps the guard.
  - DT-7: Tasks 6 and 7. DT-9 slot labels: Task 11.
  - BACKLOG Plan 4: Task 2 (server items), Task 9 (`block` gate), Task 12 (studio `—`), Task 11 (`ack`).
- **Verification done while writing.** Every code block of Tasks 1–13 was extracted from this document and applied to a local clone of `main` (a scratch copy, never this repository).
  - Results: `pnpm test` 568 green (1 pre-existing skip); the integration test green 3 times out of 3 (~4.3 s); `tsc` clean for `shared`, `server` and `web`; `vite build` green.
  - A smoke run (simulator + server serving `web/dist` + seed) and headless-Chrome screenshots at 1920×1080 and 1024×768 checked AC10 by measurement (main digits ≈ 22 % and 21 % of the screen height) and led to the badge, strip and column-width fixes already in Tasks 10–12.
  - Prototypes confirmed: Vitest `projects` with a per-file `@vitest-environment node`; React writing into the shared text node; `renderToStaticMarkup` with `useSyncExternalStore`; no React 19 SSR warning for `useLayoutEffect`; Node's `WebSocket` sends no Origin; jsdom breaks Node's `WebSocket`; Vite's MPA dev server needs the trailing-slash rewrite; Inter's latin subset has `tnum`.
  - Licences and versions come from `npm view` on 2026-10-11.
- **Interfaces stay consistent across tasks:**
  - `LiveStore` is the only thing components see: `LiveClient` in production, `StaticStore` in tests;
  - `useSnapshot` and `useFrameValue` come from `live-context`;
  - `AnchoredTime` props are `anchor`, `tally`, `tallyRef` and `seedTicks`;
  - the model functions take displayed ticks;
  - the `ApiClient` from Task 11 is reused in Task 12;
  - every i18n key used in Tasks 10–13 is defined in Task 6.
- **Where rules replace code:** Tasks 14 (README text), 15 (docs) and 16 (optional). Everything else is exact code and exact tests.
- **Deferred:**
  - the editor (Plan 5);
  - the kiosk launcher and plugin-registered dock (Plan 6);
  - packaging, web-root resolution after bundling, and font credits in the installer (Plan 7);
  - per-row forecasts and a journal-backed feed (BACKLOG).
