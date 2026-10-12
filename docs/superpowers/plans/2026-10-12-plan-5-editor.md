# Plan 5 — Editor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the director the page where the show is prepared before it goes on air: `/editor`. The director builds a format, makes an episode from it, lays the blocks out on a timeline, imports the media from Playlist Deck, sees what is wrong, checks OBS, and loads the episode for the live. Nothing the director typed may be lost without a visible sign, and every structural change can be undone.

**Scope (SPEC F1–F7, AC12):**
- **Library (F1, F2):** list, create, duplicate, rename and delete formats and episodes. Create an episode from a format (date, planned start, playlist name). Ids are lowercase slugs made from the name. "Load for live". Links to `/dock`, `/control`, `/presenter`. An episode that is live is read-only, with a banner (SPEC §18.7).
- **Document editing (F3, F4):** a pure, framework-free document store with a bounded undo/redo history, coalescing of rapid edits, and a debounced, ordered autosave with a visible error/retry state and conflict handling.
- **Timeline (F3):** blocks proportional to their duration, reorder by drag and by keyboard, resize with a 5 s snap, create/duplicate/delete/split, a properties panel, the elements of a studio block, the computed studio time with the F6 warnings, total duration and planned end time.
- **Format-level settings:** production-mode preset, thresholds, adjust step, REC-pause rule, scene groups (scenes picked from OBS when connected), preset messages.
- **Playlist import (F5):** from the live Playlist Deck (`GET /api/deck/items`) and from a playlist file (JSON, CSV, M3U exactly as Playlist Deck exports them). The unknown duration stays visibly unknown.
- **Validation (F6) and Check OBS (F7):** `validateRundown` runs live in the editor with click-to-focus; Check OBS lists what OBS lacks. Errors block "Load for live"; warnings do not.
- **Server additions (minimal, tested):** serve `/editor`; `GET /api/live/status`; `POST /api/live/load` refuses a rundown with validation errors; Check OBS reports `media_input_unverified`. No new dependency anywhere.
- Italian default plus English for every editor string.

**Out of scope:** named checkpoints, whole-project export/import, recovery policies beyond `next_elastic`, login (SPEC §17, v1.x); the plugin (Plan 6); installers (Plan 7). Server-side ETags: not needed, see "Architecture".

**Architecture:**
- **Everything in `web/src/editor/` is split into pure modules and thin React components.** The pure modules (`store/`, `model/`, `timeline/geometry.ts`, `import/`, `validation/`) import nothing from React and take time and timers by injection. The components only call them.
- **The document is an immutable value.** `DocumentStore<T>` holds the current document plus an undo stack and a redo stack of previous documents (structural sharing keeps this cheap). An `Edit` is `{ label, coalesceKey?, apply(doc) }`; every operation in `model/ops.ts` returns an `Edit`. Rapid edits with the same key (resize drag, typing in a field) merge into one undo step.
- **`Autosave` watches the store.** One save in flight at a time, so writes reach the server in order. The document counts as saved only when the save of exactly the current revision succeeded. Failures are shown, retried with backoff, and never swallowed. Undo, redo and edits are independent of the save status: after a failed save the next successful save carries the current document.
- **Concurrent edits (another tab, another machine) are handled on the client without a server ETag.** The session remembers the last document the server confirmed. On window focus and every 10 s it fetches the document again. If it changed on the server and the local copy is clean, the editor reloads it silently; if the local copy is dirty it shows a conflict banner ("take theirs" / "keep mine"). The only hard server lock is the existing `409 episode_live`.
- **Drag and drop is hand-written** (pointer events + the pure `geometry.ts`), not a library. Reason: @dnd-kit/core 6.3.1 (MIT, verified with `npm view` on 2026-10-12) is fine, but its pointer sensors need real layout, which jsdom does not have, so the part that matters (where does the block land) could only be tested through its keyboard sensor. Here the drop index, the snap and the resize are pure functions with exact tests, the pointer handlers are a few lines that call them, and the keyboard path calls the same store operations. No runtime dependency, and the only lockfile change is in Task 1.
- **Playlist-file parsing lives in `shared/src/playlist/parse.ts`** (pure, runs in node tests). The editor reads the file with `File.text()` and feeds the text to it; the server is not involved. The formats were verified against the real exporter, `src/core/PlaylistIO.cpp` of angeloruggieridj/obs-playlist-deck (read on 2026-10-12): JSON `{version,name,items:[{path,title,duration}]}` with `duration` in **milliseconds**, `-1` unknown, paths possibly relative when the user exported "portable"; CSV `title,path,duration_ms` with RFC 4180 quoting; M3U `#EXTM3U` + `#EXTINF:<whole seconds>,<title>` + path. The exporter has no CSV reader, so the CSV parser is written tolerant (header optional, `;` accepted) and fully tested.
- **Per-feature i18n.** `web/src/editor/i18n/index.ts` merges one dictionary module per feature (`shell`, `library`, `timeline`, `props`, `settings`, `import`, `validation`). The scaffold creates all of them (empty); each UI task fills only its own, so parallel tasks never edit the same file.

**Tech Stack:** unchanged from Plan 4 (Node 24, TypeScript 5.9 strict, React 19.3, Vite 7.3, zod 4, Vitest 3.2, jsdom 30, @testing-library/react 16.3, Fastify 5). **One new dev dependency:** `@testing-library/user-event` ^14.6.7 (MIT, verified with `npm view` on 2026-10-12), added by Task 1 only, so the lockfile changes in exactly one task of wave 0 and every later worktree forks from a commit that already contains it. No new runtime dependency.

**Spec:** [SPEC.md](../../SPEC.md) §3, §4 (F1–F7), §9, §17–§19, AC12 · [TECH-DESIGN.md](../../TECH-DESIGN.md) §7, §8 · [DECISIONS.md](../../DECISIONS.md) DT-2, DT-6 · [BACKLOG.md](../../BACKLOG.md) "Piano 5".

**Roadmap:**

| Plan | Scope |
|---|---|
| 1 ✅ | engine |
| 2 ✅ | server core |
| 3 ✅ | OBS integration |
| 4 ✅ | web presenter, dock, control |
| **5 (this)** | editor |
| 6 | plugin C++ + kiosk |
| 7 | installers |

---

## Execution model (user's instruction)

- **Plan author:** Sonnet (this document).
- **Orchestrator:** a **Sonnet** agent that does the minimum. It runs shell drivers that print one line each (`verify.sh` = 3 green test runs + typecheck, `deepseek-review.sh`, one script per task) and reads only the one-line results. It reads a diff only when a script reports a problem.
- **Implementer:** **DeepSeek v4.1 Flash through OpenCode**, through `.superpowers/sdd/deepseek-task.sh`. The 4th argument is, from Task 1 on: `The repository also has web=@olc/web (React 19 + Vite 7, tests in web/test run under jsdom via the root vitest "web" project). The editor lives in web/src/editor. Do not add dependencies.`
- **Parallel DeepSeek instances are allowed and expected.** Each parallel task runs in its **own `git worktree` on a temp branch** (`git worktree add ../olc-wt-tN -b plan5/tN`), forked from the commit that holds all its dependencies. The orchestrator merges the branches one by one with `git merge --no-ff` in the order of the table below. Because the tasks in a wave own **disjoint files** (see "File ownership"), merges are conflict-free; a conflict means a task touched a file it does not own, and the orchestrator sends it back.
- **Reviews:** a first-pass review of every task by **DeepSeek** (`deepseek-review.sh`). A **Sonnet** review gate only for Tasks 3, 5, 6, 7, 8 and 16 (store/undo/autosave, timeline geometry, import parsers, import placement, session/conflict handling, integration test) and for the final whole-branch review. **No Opus anywhere.**
- **Task sizing:** every task fits in one Flash run. Pure logic is given as exact code. UI pieces get exact rules and complete tests. The implementer must not loosen a test; an ambiguity goes back to the orchestrator.
- **No AI attribution** in any commit. Nothing is pushed until the controller merges.

### Dependency graph and waves

```
Wave 0a (2 parallel, first): T1 scaffold (page, i18n modules, constants, user-event)   T2 shared+server additions
Wave 0b (4 parallel, forked from T1+T2 merged): T3 store+autosave   T4 ids/time/ops   T5 geometry   T6 parsers
Wave 1 (2 parallel):  T7 import placement (T3,T4,T6)        T8 api+session+test support (T1,T2,T3,T4)
Wave 2 (6 parallel):  T9 library (T8)   T10 timeline (T4,T5,T8)   T11 properties (T4,T8)   T12 settings (T4,T8)   T13 import UI (T7,T8)   T14 validation + Check OBS (T2,T8)
Wave 3 (serial):      T15 shell integration (T9–T14)
Wave 4 (2 parallel):  T16 integration test (T15)    T17 docs, dev tooling (T15)
Optional:             T18 Playwright smoke (T15), outside CI
```

| Task | Depends on | Parallel group | Worktree | First review | Sonnet gate |
|---|---|---|---|---|---|
| 1 Scaffold | — | W0a | yes | DeepSeek | no |
| 2 Shared + server additions | — | W0a | yes | DeepSeek | no |
| 3 Document store + autosave | 1 | W0b | yes | DeepSeek | **yes** |
| 4 Ids, time math, rundown operations | 1, 2 | W0b | yes | DeepSeek | no |
| 5 Timeline geometry | 1 | W0b | yes | DeepSeek | **yes** |
| 6 Playlist file parsers (shared) | 1 | W0b | yes | DeepSeek | **yes** |
| 7 Import placement | 3, 4, 6 | W1 | yes | DeepSeek | **yes** |
| 8 API client, session, hooks, test support | 1, 2, 3, 4 | W1 | yes | DeepSeek | **yes** |
| 9 Library UI | 8 | W2 | yes | DeepSeek | no |
| 10 Timeline UI | 4, 5, 8 | W2 | yes | DeepSeek | no |
| 11 Properties and elements UI | 4, 8 | W2 | yes | DeepSeek | no |
| 12 Format settings UI | 4, 8 | W2 | yes | DeepSeek | no |
| 13 Import UI | 7, 8 | W2 | yes | DeepSeek | no |
| 14 Validation + Check OBS UI | 2, 8 | W2 | yes | DeepSeek | no |
| 15 Shell integration | 9–14 | W3 | no (serial) | DeepSeek | no |
| 16 Integration test | 15 | W4 | yes | DeepSeek | **yes** |
| 17 Docs, dev tooling | 15 | W4 | yes | DeepSeek | no |
| 18 Playwright smoke (optional) | 15 | — | — | — | no |

### File ownership (what makes the waves conflict-free)

Task 1 creates every shared registry file, so later tasks only **add** files or fill the file they own:

| Shared file | Created by | Later touched by |
|---|---|---|
| `web/package.json` + `pnpm-lock.yaml` (user-event), `web/editor/index.html`, `web/vite.config.ts` (PAGES, dev regex), `server/src/api/static.ts` (`WEB_PAGES`), `server/test/api/static.test.ts` | T1 | nobody |
| `web/src/editor/main.tsx`, `EditorApp.tsx` | T1 (placeholder) | T15 only |
| `web/src/editor/i18n/index.ts` and the 7 dictionary modules | T1 (empty modules) | each module is filled by exactly one task: `shell` T15, `library` T9, `timeline` T10, `props` T11, `settings` T12, `import` T13, `validation` T14 |
| `web/src/editor/styles/editor.css` | T1 | nobody; each UI task owns its own `*.css` |
| `shared/src/index.ts` | T6 adds `export * from './playlist/parse'` | nobody |
| `shared/src/model/format.ts`, `validate.ts` | T2 | nobody |
| `server/src/api/http.ts`, `server/src/api/obs.ts` | T2 | nobody |
| `web/test/support/editor.tsx` | T8 | nobody (read-only for others) |

## Global Constraints

- Node `>=24`, pnpm, ESM, TypeScript `strict`. Every new source file starts with `// SPDX-License-Identifier: GPL-2.0-or-later`; CSS with `/* SPDX-License-Identifier: GPL-2.0-or-later */`; HTML with `<!-- SPDX-License-Identifier: GPL-2.0-or-later -->` after the doctype. LF line endings.
- **No new runtime dependency** (the single new dev dependency is `@testing-library/user-event`, Task 1). Runtime dependencies stay MIT/BSD/ISC (React, zod, Fastify, ws, obs-websocket-js already verified in Plans 3–4).
- **`server/src/engine/**` stays pure.** The engine is not touched by this plan. The only shared-model change is an *optional* field (Task 2) that the engine ignores.
- **Never invent information.** An unknown duration (Playlist Deck `-1`, an M3U `-1`, a missing field) is stored as `plannedDurationMs: 0` with `durationSource: 'unknown'`; the editor shows it as `—` with a warning and never as `0:00`. Every imported value shows its origin (`deck`, `file`, `file_rounded`, `manual`). Nothing is auto-corrected silently.
- **The save state is always visible.** There is no state in which the editor looks saved while the last save failed.
- **Offline only (NF2):** no CDN, no remote fonts. Reuse the bundled font import (`../ui/fonts`).
- **Security:** localhost by default; `/editor` and its assets are served behind the existing Host/Origin guard. File content from a playlist file is data: it is never interpreted as HTML (React text nodes only).
- **ids:** documents are identified by lowercase slugs matching the server rule `^[a-z0-9][a-z0-9._-]{0,99}$` and not a Windows reserved name (`con`, `prn`, `aux`, `nul`, `com0–9`, `lpt0–9`). Block and element ids are `blk-N` / `el-N` (unique per document).
- **Time:** pure code takes `now` and timers by injection; components read time only through the injected `Timers`. Tests use fake timers.
- **CI** on Windows, macOS, Linux: `pnpm typecheck`, `pnpm test`, `pnpm build`.
- Commit messages are plain, with **no AI attribution and no co-author trailers**.

## Review Focus

The five failure modes most likely to hurt a director, and the test that pins each.

1. **Autosave fails silently and the director believes the rundown is saved.** Network drop, server restart, disk error. The state must turn to `error` (visible, red, with a Retry button), keep retrying with backoff, and never show `clean` until the save of the *current* revision succeeded. Closing the tab with unsaved changes asks for confirmation. *Tests:* T3 "shows an error, retries with backoff and recovers", "never reports clean while a newer revision exists: an edit during a save is saved afterwards"; T15 "shows a loud error with a retry button, and never claims "Salvato" while it failed", "asks the browser to confirm leaving while there is anything unsaved"; T16 "an outage is shown, never hides the unsaved edit…".
2. **Undo after a failed save.** Undo must not lose the failed edit or desync the file: the save always carries the *current* document, so the file ends equal to what the screen shows. *Tests:* T3 "undo after a failed save is saved once the server is back"; T8 "undo after a failed save: the retry carries the undone document"; T16 (same outage test, after `session.undo()`).
3. **A block dropped on the wrong index.** The pointer position, the dragged block's own width and variable block widths make off-by-one drops easy. *Tests:* T5 `dropIndex` (stays put until the centre passes, first and last place, middle block both ways, wide neighbour), T4 "moveBlock moves to the final index and clamps", T10 "dragging a block past the next one reorders (same result as the keyboard)", "a small movement is a click, not a drag".
4. **Importing a playlist twice duplicates the items.** Pressing Import twice, or importing the same deck again after edits, must not double the media. Items already in the rundown (same `path` and `occurrence`) are skipped and reported. *Tests:* T7 "importing the same items twice adds nothing the second time", "a stale plan applied twice still adds nothing the second time"; T13 "a second click adds nothing (importing twice must not duplicate)"; T16 step 5.
5. **Editing an episode that went live in another tab.** The edit would never reach the show, yet the screen would look fine. The editor polls the live status; a live episode turns read-only with a banner, and a `409 episode_live` on save locks the store. *Tests:* T3 "locks on 409 episode_live: read-only, no more saves, no retry"; T8 "a live episode opens read-only with the live lock", "a 409 episode_live on save locks the session", "refreshLive() locks an open episode that went on air"; T15 "polling locks an open episode that goes on air in another tab"; T16 step 9.

Also pinned: a stale tab overwriting newer server data (T8 "external changes (another tab)", T15 "offers a choice when another tab changed the document…"), a block with an unknown duration shown as 0:00 (T11, T13), loading an episode with validation errors (T2 server test, T14 UI test).

---

## File structure

```
shared/src/model/format.ts                  + MediaElement.durationSource (optional)
shared/src/model/validate.ts                + media_duration_unknown warning
shared/src/playlist/parse.ts                parsePlaylistFile + JSON/CSV/M3U parsers (pure)
server/src/api/static.ts                    + 'editor' page
server/src/api/http.ts                      + GET /api/live/status; load refuses invalid rundowns (409 rundown_invalid)
server/src/api/obs.ts                       + media_input_unverified warning
web/editor/index.html                       Vite entry
web/src/editor/main.tsx                     mount
web/src/editor/EditorApp.tsx                shell: regions, toolbar, banners, shortcuts            (T15)
web/src/editor/styles/editor.css            layout grid, editor tokens
web/src/editor/i18n/                        index.ts + shell, library, timeline, props, settings, import, validation
web/src/editor/store/document-store.ts      DocumentStore, Edit (undo/redo, coalescing)
web/src/editor/store/autosave.ts            Autosave, SaveError, SaveState, Timers
web/src/editor/model/ids.ts                 slugify, uniqueSlug, nextId
web/src/editor/model/time.ts                offsets, total, planned end, studio time
web/src/editor/model/ops.ts                 rundown operations (Edit factories)
web/src/editor/timeline/geometry.ts         snap, layout, dropIndex, resize, key intents
web/src/editor/import/place.ts              turns imported items into media elements, placement modes
web/src/editor/api/editor-api.ts            EditorApi interface + HTTP implementation
web/src/editor/session/session.ts           EditorSession: open/close, autosave wiring, live status, external change
web/src/editor/session/context.tsx          provider + hooks
web/src/editor/library/                     LibraryPanel.tsx, NewEpisodeDialog.tsx, library.css      (T9)
web/src/editor/timeline/                    TimelinePanel.tsx, BlockView.tsx, timeline.css           (T10)
web/src/editor/props/                       PropertiesPanel.tsx, ElementsList.tsx, props.css         (T11)
web/src/editor/settings/                    SettingsPanel.tsx, settings.css                          (T12)
web/src/editor/import/                      ImportPanel.tsx, import.css                              (T13)
web/src/editor/validation/                  issues.ts, ValidationPanel.tsx, validation.css           (T14)
web/test/support/editor.tsx                 fake API, sample documents, render helper
web/test/editor/…  shared/test/playlist-parse.test.ts  server/test/api/…  one test file per unit
docs/README, TEST-PLAN, BACKLOG, TECH-DESIGN §8
```

---
### Task 1: Scaffold — `/editor` page, i18n modules, constants

**Files:**
- Create: `web/editor/index.html`, `web/src/editor/main.tsx`, `web/src/editor/EditorApp.tsx`, `web/src/editor/styles/editor.css`, `web/src/editor/model/constants.ts`, `web/src/editor/i18n/{index,shell,library,timeline,props,settings,import,validation}.ts`, `web/test/editor/i18n.test.ts`, `web/test/editor/scaffold.test.tsx`
- Modify: `web/package.json` (+ `pnpm-lock.yaml`), `web/vite.config.ts`, `server/src/api/static.ts`, `server/test/api/static.test.ts`, `scripts/dev.mjs` (log line only)

**Interfaces:**
- Produces: the page `/editor`; `EditorKey`, `EditorT`, `createEditorT(lang)`, `EDITOR_MODULES`; `SNAP_MS`, `MIN_BLOCK_MS`, `UNDO_LIMIT`, `COALESCE_MS`, `AUTOSAVE_DEBOUNCE_MS` (constants); the CSS class names of the layout regions.

- [ ] **Step 1: Add the dev dependency**

Run `pnpm --filter @olc/web add -D @testing-library/user-event@^14.6.7` (MIT). Commit only `web/package.json` and `pnpm-lock.yaml` changes together with the rest of this task.

- [ ] **Step 2: Write the failing tests**

`web/test/editor/i18n.test.ts`:
```ts
// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import { EDITOR_MODULES, createEditorT } from '../../src/editor/i18n';

const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe('editor dictionaries', () => {
  for (const [name, mod] of Object.entries(EDITOR_MODULES)) {
    describe(name, () => {
      it('has the same keys in Italian and English', () => {
        expect(Object.keys(mod.en).sort()).toEqual(Object.keys(mod.it).sort());
      });
      it('namespaces every key with the module name', () => {
        for (const key of Object.keys(mod.it)) expect(key.startsWith(`${name}.`)).toBe(true);
      });
      it('has no empty text and the same placeholders in both languages', () => {
        for (const [key, it] of Object.entries(mod.it)) {
          const en = (mod.en as Record<string, string>)[key]!;
          expect(it.trim(), key).not.toBe('');
          expect(en.trim(), key).not.toBe('');
          expect(placeholders(en), key).toEqual(placeholders(it));
        }
      });
    });
  }

  it('merges the modules without a key defined twice', () => {
    const total = Object.values(EDITOR_MODULES).reduce((n, m) => n + Object.keys(m.it).length, 0);
    const merged = new Set(Object.values(EDITOR_MODULES).flatMap((m) => Object.keys(m.it)));
    expect(merged.size).toBe(total);
  });

  it('interpolates parameters and leaves a missing one visible', () => {
    // Uses the translator on a key that exists in every build of this plan: the module list is checked above.
    const t = createEditorT('it') as (k: string, p?: Record<string, string | number>) => string;
    const first = Object.entries(EDITOR_MODULES).flatMap(([, m]) => Object.entries(m.it)).find(([, v]) => v.includes('{'));
    if (first === undefined) return; // no parameterised text yet (empty scaffold)
    const [key, text] = first;
    const name = /\{(\w+)\}/.exec(text)![1]!;
    expect(t(key, { [name]: 'X' })).not.toContain(`{${name}}`);
    expect(t(key)).toContain(`{${name}}`);
  });
});
```

`web/test/editor/scaffold.test.tsx`:
```tsx
// SPDX-License-Identifier: GPL-2.0-or-later
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { EditorApp } from '../../src/editor/EditorApp';
import { AUTOSAVE_DEBOUNCE_MS, COALESCE_MS, MIN_BLOCK_MS, SNAP_MS, UNDO_LIMIT } from '../../src/editor/model/constants';

describe('editor scaffold', () => {
  it('renders the five layout regions', () => {
    render(<EditorApp lang="it" />);
    for (const region of ['library', 'timeline', 'properties', 'settings', 'validation']) {
      expect(screen.getByTestId(`region-${region}`)).toBeTruthy();
    }
  });

  it('fixes the editing constants', () => {
    expect([SNAP_MS, MIN_BLOCK_MS, UNDO_LIMIT, COALESCE_MS, AUTOSAVE_DEBOUNCE_MS]).toEqual([5_000, 5_000, 100, 600, 800]);
  });
});
```

Add to `server/test/api/static.test.ts`: `'editor'` joins the default `pages` of `webRoot()` and the page loop (`for (const page of ['presenter', 'dock', 'control', 'editor'])`), and one test: `GET /editor` and `GET /editor/` answer 200 with `cache-control: no-cache`; and `GET /` still redirects to `/control`.

- [ ] **Step 3: Run the tests, confirm they fail**

`pnpm vitest run web/test/editor server/test/api/static.test.ts`. Expected: FAIL (modules and page missing).

- [ ] **Step 4: Implement**

`web/src/editor/model/constants.ts`:
```ts
// SPDX-License-Identifier: GPL-2.0-or-later

/** Block durations snap to this step while resizing (SPEC F3). */
export const SNAP_MS = 5_000;
/** Shortest block the editor lets the director make. The schema's own minimum is 1 s. */
export const MIN_BLOCK_MS = 5_000;
/** Undo steps kept. */
export const UNDO_LIMIT = 100;
/** Edits with the same key closer together than this merge into one undo step. */
export const COALESCE_MS = 600;
/** Quiet time after the last edit before the document is saved. */
export const AUTOSAVE_DEBOUNCE_MS = 800;
```

Each dictionary module (`shell`, `library`, `timeline`, `props`, `settings`, `import`, `validation`) starts empty; the owner task fills it. `web/src/editor/i18n/library.ts` (the other six are identical with their own names, constants `IT_SHELL`/`EN_SHELL`, `IT_PROPS`/`EN_PROPS`, `IT_SETTINGS`, `IT_IMPORT`, `IT_VALIDATION`, `IT_TIMELINE`):
```ts
// SPDX-License-Identifier: GPL-2.0-or-later
// Keys are namespaced "library.*". Filled by Task 9.
export const IT_LIBRARY = {} as const;
export const EN_LIBRARY: Record<keyof typeof IT_LIBRARY, string> = {};
```

`web/src/editor/i18n/index.ts`:
```ts
// SPDX-License-Identifier: GPL-2.0-or-later
import type { Lang } from '../../core/i18n';
import { EN_IMPORT, IT_IMPORT } from './import';
import { EN_LIBRARY, IT_LIBRARY } from './library';
import { EN_PROPS, IT_PROPS } from './props';
import { EN_SETTINGS, IT_SETTINGS } from './settings';
import { EN_SHELL, IT_SHELL } from './shell';
import { EN_TIMELINE, IT_TIMELINE } from './timeline';
import { EN_VALIDATION, IT_VALIDATION } from './validation';

/** One dictionary module per feature, so parallel tasks never edit the same file. */
export const EDITOR_MODULES = {
  shell: { it: IT_SHELL, en: EN_SHELL },
  library: { it: IT_LIBRARY, en: EN_LIBRARY },
  timeline: { it: IT_TIMELINE, en: EN_TIMELINE },
  props: { it: IT_PROPS, en: EN_PROPS },
  settings: { it: IT_SETTINGS, en: EN_SETTINGS },
  import: { it: IT_IMPORT, en: EN_IMPORT },
  validation: { it: IT_VALIDATION, en: EN_VALIDATION },
} as const;

const IT = { ...IT_SHELL, ...IT_LIBRARY, ...IT_TIMELINE, ...IT_PROPS, ...IT_SETTINGS, ...IT_IMPORT, ...IT_VALIDATION } as const;
export type EditorKey = keyof typeof IT;
const EN: Record<EditorKey, string> = { ...EN_SHELL, ...EN_LIBRARY, ...EN_TIMELINE, ...EN_PROPS, ...EN_SETTINGS, ...EN_IMPORT, ...EN_VALIDATION };

export type EditorT = (key: EditorKey, params?: Record<string, string | number>) => string;

/** `{name}` placeholders take `params.name`; a missing parameter stays visible so a bug cannot hide. */
export function createEditorT(lang: Lang): EditorT {
  const dict: Record<string, string> = lang === 'en' ? EN : IT;
  return (key, params = {}) =>
    (dict[key] ?? key).replace(/\{(\w+)\}/g, (whole, name: string) => (name in params ? String(params[name]) : whole));
}
```

`web/src/editor/EditorApp.tsx` (placeholder, replaced by Task 15):
```tsx
// SPDX-License-Identifier: GPL-2.0-or-later
import type { Lang } from '../core/i18n';

const REGIONS = ['library', 'timeline', 'properties', 'settings', 'validation'] as const;

export function EditorApp(props: { lang: Lang }) {
  return (
    <div className="ed-root" lang={props.lang}>
      {REGIONS.map((r) => (
        <section key={r} className={`ed-region ed-${r}`} data-testid={`region-${r}`} />
      ))}
    </div>
  );
}
```

`web/src/editor/main.tsx`: same pattern as `web/src/control/main.tsx` but without `LiveClient`: import `../ui/fonts`, `../ui/base.css`, `./styles/editor.css`; `parseParams(location.search)`; `installTokens()`; `document.documentElement.lang = params.lang`; render `<EditorApp lang={params.lang} />` into `#root`.

`web/editor/index.html`: copy of `web/control/index.html` with `<title>OBS Live Clock · Editor</title>` and `<script type="module" src="/src/editor/main.tsx">`.

`web/src/editor/styles/editor.css` (layout and the editor's derived tokens; all colours reference the existing `--*` variables from `ui/tokens.ts`, no new hex values except these derived ones):
```css
/* SPDX-License-Identifier: GPL-2.0-or-later */
:root {
  --ed-studio: #1d3a5f;       /* studio block */
  --ed-studio-edge: #4a86c5;
  --ed-break: #4a3b12;        /* break block */
  --ed-break-edge: #c9a227;
  --ed-focus: #ffb000;
  --ed-gap: 12px;
}
html, body { height: 100%; }
.ed-root {
  display: grid; height: 100vh; gap: var(--ed-gap); padding: var(--ed-gap); box-sizing: border-box;
  grid-template-columns: minmax(240px, 280px) minmax(0, 1fr) minmax(280px, 340px);
  grid-template-rows: auto minmax(0, 1fr) minmax(0, 220px);
  grid-template-areas: "bar bar bar" "library timeline properties" "settings validation validation";
  background: var(--bg); color: var(--fg); font-family: var(--font);
}
.ed-bar { grid-area: bar; }
.ed-library { grid-area: library; } .ed-timeline { grid-area: timeline; } .ed-properties { grid-area: properties; }
.ed-settings { grid-area: settings; } .ed-validation { grid-area: validation; }
.ed-region { background: var(--surface); border: 1px solid var(--tile-border); border-radius: 6px; padding: 8px; overflow: auto; min-width: 0; }
.ed-root :focus-visible { outline: 2px solid var(--ed-focus); outline-offset: 2px; }
.ed-btn { background: var(--surface); color: var(--fg); border: 1px solid var(--tile-border); border-radius: 4px; padding: 6px 10px; cursor: pointer; font: inherit; }
.ed-btn:disabled { color: var(--fg-off); cursor: not-allowed; }
.ed-btn-danger { border-color: var(--red); }
.ed-error { color: var(--red); } .ed-warn { color: var(--amber); }
@media (max-width: 1000px) {
  .ed-root { grid-template-columns: minmax(0, 1fr); grid-template-rows: none; grid-template-areas: "bar" "library" "timeline" "properties" "settings" "validation"; height: auto; }
}
```

`web/vite.config.ts`: add `'editor'` to `PAGES` and to the dev regex `(presenter|dock|control|editor)`. `server/src/api/static.ts`: `WEB_PAGES = ['presenter', 'dock', 'control', 'editor']`. `scripts/dev.mjs`: append `· editor http://localhost:5173/editor` to the log line.

- [ ] **Step 5: Run, typecheck, build**

`pnpm vitest run web/test/editor server/test/api/static.test.ts` → PASS; `pnpm typecheck`; `pnpm build` and confirm `web/dist/editor/index.html` exists.

- [ ] **Step 6: Commit**

```
git add web/package.json pnpm-lock.yaml web/editor web/src/editor web/test/editor web/vite.config.ts server/src/api/static.ts server/test/api/static.test.ts scripts/dev.mjs
git commit -m "feat(web,server): editor page scaffold, per-feature i18n modules, editor constants"
```

---

### Task 2: Shared and server additions — duration origin, live status, guarded load, unverified inputs

**Files:**
- Modify: `shared/src/model/format.ts`, `shared/src/model/validate.ts`, `shared/test/validate.test.ts`, `shared/test/format.test.ts`, `server/src/api/http.ts`, `server/test/api/http.test.ts`, `server/src/api/obs.ts`, `server/test/api/obs.test.ts`

**Interfaces:**
- `MediaElement.durationSource?: 'deck' | 'file' | 'file_rounded' | 'manual' | 'unknown'` (optional; absent on every existing document and ignored by the engine).
- `IssueCode` gains `'media_duration_unknown'` (warning, `blockId` = the block).
- `GET /api/live/status` → `200 { episodeId: string | null, phase: 'preshow' | 'live' | 'ended' | null }`.
- `POST /api/live/load` → `409 { error: 'rundown_invalid', issues: Issue[] }` when `validateRundown(episode)` contains an error; warnings never block.
- Check OBS: a break block with a `mediaInput` whose `GetInputList` read failed gets a warning `media_input_unverified` (BACKLOG).

- [ ] **Step 1: Write the failing tests**

`shared/test/format.test.ts` (append):
```ts
describe('MediaElement.durationSource', () => {
  const base = { id: 'm', kind: 'media', title: 'T', path: 'a.mp4', occurrence: 0, plannedDurationMs: 0 };
  it('is optional and accepts the five origins', () => {
    expect(MediaElement.parse(base).durationSource).toBeUndefined();
    for (const s of ['deck', 'file', 'file_rounded', 'manual', 'unknown']) {
      expect(MediaElement.parse({ ...base, durationSource: s }).durationSource).toBe(s);
    }
  });
  it('rejects any other origin', () => {
    expect(MediaElement.safeParse({ ...base, durationSource: 'guess' }).success).toBe(false);
  });
});
```
(import `MediaElement` from `../src/model/format` if not already imported.)

`shared/test/validate.test.ts` (append):
```ts
it('warns about a media element whose duration is unknown, on its block', () => {
  const f = soloFutsalFormat();
  const b = f.blocks[0] as StudioBlock;
  b.elements = b.elements.map((e) => (e.kind === 'media' ? { ...e, plannedDurationMs: 0, durationSource: 'unknown' as const } : e));
  const issue = validateRundown(f).find((i) => i.code === 'media_duration_unknown');
  expect(issue).toMatchObject({ severity: 'warning', blockId: 'b1' });
});

it('does not warn when the origin is absent or known', () => {
  expect(validateRundown(soloFutsalFormat()).some((i) => i.code === 'media_duration_unknown')).toBe(false);
});
```

`server/test/api/http.test.ts` (append, using `makeHttp`, `soloFutsalFormat`, `EPISODE_BODY` already in the file):
```ts
describe('GET /api/live/status', () => {
  it('reports nothing loaded, then the loaded episode in preshow', async () => {
    const h = await withEpisode();
    expect((await h.app.inject({ method: 'GET', url: '/api/live/status' })).json()).toEqual({ episodeId: null, phase: null });
    await h.app.inject({ method: 'POST', url: '/api/live/load', payload: { episodeId: 'ep-1' } });
    expect((await h.app.inject({ method: 'GET', url: '/api/live/status' })).json()).toEqual({ episodeId: 'ep-1', phase: 'preshow' });
  });
});

describe('POST /api/live/load with an invalid rundown', () => {
  it('refuses an episode with a validation error and names the issue', async () => {
    const h = await withEpisode();
    const ep = (await h.app.inject({ method: 'GET', url: '/api/episodes/ep-1' })).json();
    ep.blocks[0].elements[1].plannedDurationMs = 9_999_999; // media longer than the block
    await h.app.inject({ method: 'PUT', url: '/api/episodes/ep-1', payload: ep });
    const res = await h.app.inject({ method: 'POST', url: '/api/live/load', payload: { episodeId: 'ep-1' } });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('rundown_invalid');
    expect(res.json().issues[0]).toMatchObject({ severity: 'error', code: 'media_exceeds_block', blockId: 'b1' });
  });

  it('loads an episode that has only warnings', async () => {
    const h = await withEpisode();
    const ep = (await h.app.inject({ method: 'GET', url: '/api/episodes/ep-1' })).json();
    ep.preset.warnMs = 10 * 60_000; // every block now leaves "too little" studio time: warnings only
    await h.app.inject({ method: 'PUT', url: '/api/episodes/ep-1', payload: ep });
    const res = await h.app.inject({ method: 'POST', url: '/api/live/load', payload: { episodeId: 'ep-1' } });
    expect(res.statusCode).toBe(200);
  });
});
```

`server/test/api/obs.test.ts`: change the existing test "treats a rejecting GetInputList as unverifiable and answers normally" so that the final assertion becomes
```ts
expect(res.json().issues).toEqual([
  { severity: 'warning', code: 'media_input_unverified', blockId: 'br1', message: expect.any(String) },
]);
```
(and keep its status 200 assertion). The timeout test ("times out an unresponsive GetInputList and does not report media_input_missing") must also expect `media_input_unverified` and still no `media_input_missing`.

- [ ] **Step 2: Run, confirm FAIL.** `pnpm vitest run shared server/test/api`.

- [ ] **Step 3: Implement**

`format.ts`:
```ts
export const DurationSource = z.enum(['deck', 'file', 'file_rounded', 'manual', 'unknown']);
export type DurationSource = z.infer<typeof DurationSource>;
```
and in `MediaElement` add `durationSource: DurationSource.optional(),`.

`validate.ts`: add `'media_duration_unknown'` to `IssueCode`; inside the studio-block loop, for each media element with `durationSource === 'unknown'` push `{ severity: 'warning', code: 'media_duration_unknown', blockId: b.id, message: \`Media "${e.title}" has no known duration\` }` (after the `checkId` loop, before the group checks). Warnings never change `plannedStudioTimeMs`.

`http.ts`: add
```ts
app.get('/api/live/status', async () => ({ episodeId: ctx.runtime.episodeId, phase: ctx.runtime.phase }));
```
and in `POST /api/live/load`, after the 404 check:
```ts
const errors = validateRundown(episode).filter((i) => i.severity === 'error');
if (errors.length > 0) return reply.code(409).send({ error: 'rundown_invalid', issues: errors });
```
`obs.ts`: in the break branch, replace the `inputs !== null` guard with: if `block.mediaInput !== null && inputs === null` push `{ severity: 'warning', code: 'media_input_unverified', blockId: block.id, message: \`Media input "${block.mediaInput}" could not be verified\` }`; keep the existing `media_input_missing` branch for `inputs !== null`.

- [ ] **Step 4: Run all** `pnpm test` (the whole server suite: if another existing test loads an episode that has an error-severity issue, fix that fixture minimally and say so in the report) and `pnpm typecheck` → PASS.

- [ ] **Step 5: Commit**

```
git add shared/src/model shared/test server/src/api/http.ts server/src/api/obs.ts server/test/api
git commit -m "feat(shared,server): media duration origin, live status route, load refuses invalid rundowns, unverified media inputs"
```

---

### Task 3: Document store with undo/redo, and ordered autosave (pure)

**Files:**
- Create: `web/src/editor/store/document-store.ts`, `web/src/editor/store/autosave.ts`, `web/test/editor/document-store.test.ts`, `web/test/editor/autosave.test.ts`, `web/test/support/fake-timers.ts`

**Interfaces:**
- Produces: `DocumentStore<T>` (`getSnapshot`, `subscribe`, `edit`, `undo`, `redo`, `seal`, `replace`, `setReadOnly`), `Edit<T>`, `StoreSnapshot<T>`; `Autosave<T>` (`getState`, `subscribe`, `markSaved`, `flush`, `retryNow`, `dispose`), `SaveError(status, code)`, `SaveState`, `Timers`.
- The code below was run in a scratch directory before being written here; the tests are the contract.

`web/src/editor/store/document-store.ts`:
```ts
// SPDX-License-Identifier: GPL-2.0-or-later
import { COALESCE_MS, UNDO_LIMIT } from '../model/constants';

export interface Edit<T> {
  /** Stable identifier of the operation, shown in the undo tooltip through the shell dictionary. */
  label: string;
  /** Edits with the same key within `coalesceMs` of each other merge into ONE undo step (drag-resize, typing). */
  coalesceKey?: string;
  apply(doc: T): T;
}

interface Entry<T> {
  before: T;
  label: string;
  key: string | null;
  at: number;
}

export interface StoreSnapshot<T> {
  doc: T;
  /** Increments on every change of `doc` (edit, undo, redo, replace). Autosave compares revisions, never documents. */
  rev: number;
  canUndo: boolean;
  canRedo: boolean;
  undoLabel: string | null;
  redoLabel: string | null;
  readOnly: boolean;
}

export interface DocumentStoreOptions {
  limit?: number; // default UNDO_LIMIT (100)
  coalesceMs?: number; // default COALESCE_MS (600)
  now?: () => number;
}

/**
 * Framework-free document store with a bounded undo/redo history. Documents are immutable values: a history entry
 * is just the previous document (structural sharing keeps it cheap).
 */
export class DocumentStore<T> {
  private doc: T;
  private past: Entry<T>[] = [];
  private future: Entry<T>[] = [];
  private rev = 0;
  private readOnly = false;
  /** True only right after an edit: undo, redo, replace and seal() end a coalescing run. */
  private coalescible = false;
  private snap: StoreSnapshot<T>;
  private readonly listeners = new Set<() => void>();
  private readonly limit: number;
  private readonly coalesceMs: number;
  private readonly now: () => number;

  constructor(initial: T, opts: DocumentStoreOptions = {}) {
    this.doc = initial;
    this.limit = opts.limit ?? UNDO_LIMIT;
    this.coalesceMs = opts.coalesceMs ?? COALESCE_MS;
    this.now = opts.now ?? (() => Date.now());
    this.snap = this.build();
  }

  getSnapshot = (): StoreSnapshot<T> => this.snap;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  /** Applies an edit. Returns false (recording nothing) when read-only or when `apply` returns the same document. */
  edit(e: Edit<T>): boolean {
    if (this.readOnly) return false;
    const next = e.apply(this.doc);
    if (Object.is(next, this.doc)) return false;
    const at = this.now();
    const top = this.past[this.past.length - 1];
    const key = e.coalesceKey ?? null;
    if (key !== null && this.coalescible && top !== undefined && top.key === key && at - top.at <= this.coalesceMs) {
      top.at = at; // sliding window; `before` stays the state before the whole run
    } else {
      this.past.push({ before: this.doc, label: e.label, key, at });
      if (this.past.length > this.limit) this.past.shift();
    }
    this.future = [];
    this.doc = next;
    this.coalescible = true;
    this.rev += 1;
    this.emit();
    return true;
  }

  undo(): boolean {
    if (this.readOnly) return false;
    const entry = this.past.pop();
    if (entry === undefined) return false;
    this.future.push({ ...entry, before: this.doc });
    this.doc = entry.before;
    this.coalescible = false;
    this.rev += 1;
    this.emit();
    return true;
  }

  redo(): boolean {
    if (this.readOnly) return false;
    const entry = this.future.pop();
    if (entry === undefined) return false;
    this.past.push({ ...entry, before: this.doc });
    this.doc = entry.before;
    this.coalescible = false;
    this.rev += 1;
    this.emit();
    return true;
  }

  /** Ends the current coalescing run (call on pointer-up and on blur). */
  seal(): void {
    this.coalescible = false;
  }

  /** Loads a different document: history is cleared. Not an edit. */
  replace(doc: T, opts: { readOnly?: boolean } = {}): void {
    this.doc = doc;
    this.past = [];
    this.future = [];
    this.coalescible = false;
    this.readOnly = opts.readOnly ?? false;
    this.rev += 1;
    this.emit();
  }

  setReadOnly(value: boolean): void {
    if (this.readOnly === value) return;
    this.readOnly = value;
    this.emit();
  }

  private build(): StoreSnapshot<T> {
    const u = this.past[this.past.length - 1];
    const r = this.future[this.future.length - 1];
    return {
      doc: this.doc,
      rev: this.rev,
      canUndo: u !== undefined && !this.readOnly,
      canRedo: r !== undefined && !this.readOnly,
      undoLabel: u?.label ?? null,
      redoLabel: r?.label ?? null,
      readOnly: this.readOnly,
    };
  }

  private emit(): void {
    this.snap = this.build();
    for (const l of [...this.listeners]) l();
  }
}
```

`web/src/editor/store/autosave.ts`:
```ts
// SPDX-License-Identifier: GPL-2.0-or-later
import { AUTOSAVE_DEBOUNCE_MS } from '../model/constants';
import type { DocumentStore } from './document-store';

export class SaveError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(`HTTP ${status}: ${code}`);
    this.name = 'SaveError';
  }
}

export type SaveState =
  | { kind: 'clean' }
  | { kind: 'dirty' }
  | { kind: 'saving' }
  /** Network or server failure: the director must SEE this. Retries automatically with backoff. */
  | { kind: 'error'; code: string; attempt: number }
  /** The server rejected the content (400): retrying cannot help; the next edit tries again. */
  | { kind: 'invalid'; code: string }
  /** The episode is live (409 episode_live): saving stopped for good, the store is read-only. */
  | { kind: 'locked' };

export interface Timers {
  /** Schedules `fn` after `ms`; returns the cancel function. */
  set(fn: () => void, ms: number): () => void;
  now(): number;
}

export interface AutosaveOptions {
  debounceMs?: number; // default 800
  maxWaitMs?: number; // default 5000: continuous editing still saves
  retryBaseMs?: number; // default 1000
  retryMaxMs?: number; // default 10000
}

/**
 * Saves the store's document through `save` after edits settle. At most ONE save is in flight, so writes reach the
 * server in order. A document is "saved" only when the save of exactly the current revision succeeded.
 */
export class Autosave<T> {
  private state: SaveState = { kind: 'clean' };
  private savedRev: number;
  private cancelTimer: (() => void) | null = null;
  private inflight: Promise<void> | null = null;
  private firstDirtyAt: number | null = null;
  private failures = 0;
  private readonly listeners = new Set<() => void>();
  private readonly o: Required<AutosaveOptions>;
  private readonly unsubscribe: () => void;

  constructor(
    private readonly store: DocumentStore<T>,
    private readonly save: (doc: T) => Promise<void>,
    private readonly timers: Timers,
    opts: AutosaveOptions = {},
  ) {
    this.o = { debounceMs: AUTOSAVE_DEBOUNCE_MS, maxWaitMs: 5000, retryBaseMs: 1000, retryMaxMs: 10_000, ...opts };
    this.savedRev = store.getSnapshot().rev;
    this.unsubscribe = store.subscribe(() => this.onStoreChange());
  }

  getState = (): SaveState => this.state;

  subscribe = (l: () => void): (() => void) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };

  /** Declares the current document as already persisted (after load, or after a "take theirs" reload). */
  markSaved(): void {
    this.cancel();
    this.savedRev = this.store.getSnapshot().rev;
    this.failures = 0;
    this.firstDirtyAt = null;
    this.set({ kind: 'clean' });
  }

  /** Saves now (cancelling the debounce); resolves when no unsaved change is left or saving cannot proceed. */
  async flush(): Promise<void> {
    this.cancel();
    for (;;) {
      if (this.inflight !== null) await this.inflight;
      const s = this.state.kind;
      if (this.store.getSnapshot().rev === this.savedRev || s === 'locked' || s === 'error' || s === 'invalid') return;
      await this.run();
    }
  }

  /** "Retry now" button. After a failure it runs one attempt immediately. */
  async retryNow(): Promise<void> {
    if (this.state.kind === 'locked') return;
    this.cancel();
    if (this.inflight !== null) await this.inflight;
    await this.run();
  }

  dispose(): void {
    this.cancel();
    this.unsubscribe();
  }

  private onStoreChange(): void {
    if (this.state.kind === 'locked') return;
    const rev = this.store.getSnapshot().rev;
    if (rev === this.savedRev) return;
    if (this.state.kind === 'clean' || this.state.kind === 'invalid') {
      this.firstDirtyAt = this.timers.now();
      this.set({ kind: 'dirty' });
    }
    this.firstDirtyAt ??= this.timers.now();
    if (this.inflight !== null) return; // the finishing save reschedules
    const waited = this.timers.now() - this.firstDirtyAt;
    this.schedule(Math.max(0, Math.min(this.o.debounceMs, this.o.maxWaitMs - waited)));
  }

  private schedule(ms: number): void {
    this.cancel();
    this.cancelTimer = this.timers.set(() => {
      this.cancelTimer = null;
      void this.run();
    }, ms);
  }

  private cancel(): void {
    this.cancelTimer?.();
    this.cancelTimer = null;
  }

  private run(): Promise<void> {
    if (this.inflight !== null) return this.inflight;
    const { doc, rev } = this.store.getSnapshot();
    if (rev === this.savedRev) return Promise.resolve();
    this.set({ kind: 'saving' });
    const attempt = (async () => {
      try {
        await this.save(doc);
        this.savedRev = rev;
        this.failures = 0;
        this.firstDirtyAt = null;
        if (this.store.getSnapshot().rev === this.savedRev) this.set({ kind: 'clean' });
        else {
          this.set({ kind: 'dirty' });
          this.firstDirtyAt = this.timers.now();
          this.schedule(this.o.debounceMs);
        }
      } catch (err) {
        const status = err instanceof SaveError ? err.status : 0;
        const code = err instanceof SaveError ? err.code : 'network';
        if (status === 409 && code === 'episode_live') {
          this.set({ kind: 'locked' });
          this.store.setReadOnly(true);
        } else if (status === 400) {
          this.set({ kind: 'invalid', code });
        } else {
          this.failures += 1;
          this.set({ kind: 'error', code, attempt: this.failures });
          this.schedule(Math.min(this.o.retryBaseMs * 2 ** (this.failures - 1), this.o.retryMaxMs));
        }
      } finally {
        this.inflight = null;
      }
    })();
    this.inflight = attempt;
    return attempt;
  }

  private set(next: SaveState): void {
    this.state = next;
    for (const l of [...this.listeners]) l();
  }
}
```

`web/test/support/fake-timers.ts`:
```ts
// SPDX-License-Identifier: GPL-2.0-or-later
import type { Timers } from '../../src/editor/store/autosave';

/** Deterministic timers: `advance(ms)` runs due callbacks in order and lets promise chains settle between them. */
export function fakeTimers() {
  let now = 0;
  const queue: Array<{ at: number; fn: () => void }> = [];
  const timers: Timers = {
    now: () => now,
    set(fn, ms) {
      const entry = { at: now + ms, fn };
      queue.push(entry);
      return () => {
        const i = queue.indexOf(entry);
        if (i >= 0) queue.splice(i, 1);
      };
    },
  };
  const settle = async () => {
    for (let i = 0; i < 6; i++) await Promise.resolve();
  };
  const advance = async (ms: number) => {
    const end = now + ms;
    for (;;) {
      queue.sort((a, b) => a.at - b.at);
      const next = queue[0];
      if (next === undefined || next.at > end) break;
      queue.shift();
      now = next.at;
      next.fn();
      await settle();
    }
    now = end;
    await settle();
  };
  return { timers, advance, pending: () => queue.length };
}
```

- [ ] **Step 1: Write the failing tests**

`web/test/editor/document-store.test.ts`:
```ts
// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import { DocumentStore, type Edit } from '../../src/editor/store/document-store';

const inc = (n = 1, key?: string): Edit<number> => ({ label: 'inc', coalesceKey: key, apply: (d) => d + n });

describe('DocumentStore', () => {
  it('undoes and redoes, records no-ops nowhere, and clears redo on a new edit', () => {
    const s = new DocumentStore(0);
    expect(s.edit({ label: 'noop', apply: (d) => d })).toBe(false);
    expect(s.getSnapshot().canUndo).toBe(false);
    s.edit(inc());
    s.edit(inc());
    expect(s.getSnapshot().doc).toBe(2);
    s.undo();
    expect(s.getSnapshot().doc).toBe(1);
    s.redo();
    expect(s.getSnapshot().doc).toBe(2);
    s.undo();
    s.edit(inc(10));
    expect(s.getSnapshot().canRedo).toBe(false);
    expect(s.getSnapshot().doc).toBe(11);
  });

  it('exposes the labels of the next undo and redo', () => {
    const s = new DocumentStore(0);
    s.edit({ label: 'move_block', apply: (d) => d + 1 });
    expect(s.getSnapshot().undoLabel).toBe('move_block');
    s.undo();
    expect(s.getSnapshot()).toMatchObject({ undoLabel: null, redoLabel: 'move_block' });
  });

  it('merges rapid edits with the same key into one undo step', () => {
    let t = 0;
    const s = new DocumentStore(0, { now: () => t });
    s.edit(inc(1, 'k'));
    t = 100;
    s.edit(inc(1, 'k'));
    t = 200;
    s.edit(inc(1, 'k'));
    expect(s.getSnapshot().doc).toBe(3);
    s.undo();
    expect(s.getSnapshot().doc).toBe(0);
    s.redo();
    expect(s.getSnapshot().doc).toBe(3);
  });

  it('starts a new step after the window, and never merges into a run that an undo ended', () => {
    let t = 0;
    const s = new DocumentStore(0, { now: () => t });
    s.edit(inc(1, 'k'));
    t = 5_000;
    s.edit(inc(1, 'k')); // window expired: own step
    s.undo();
    expect(s.getSnapshot().doc).toBe(1);
    t = 5_100;
    s.edit(inc(1, 'k')); // right after an undo: must not merge with the older run
    s.undo();
    expect(s.getSnapshot().doc).toBe(1);
    s.undo();
    expect(s.getSnapshot().doc).toBe(0);
  });

  it('seal() ends a run; edits with different keys never merge', () => {
    let t = 0;
    const s = new DocumentStore(0, { now: () => t });
    s.edit(inc(1, 'a'));
    s.seal();
    t = 10;
    s.edit(inc(1, 'a'));
    s.undo();
    expect(s.getSnapshot().doc).toBe(1);
    s.edit(inc(1, 'b'));
    t = 20;
    s.edit(inc(1, 'c'));
    s.undo();
    expect(s.getSnapshot().doc).toBe(2);
  });

  it('keeps at most `limit` steps', () => {
    const s = new DocumentStore(0, { limit: 3 });
    for (let i = 0; i < 10; i++) s.edit(inc());
    let n = 0;
    while (s.undo()) n++;
    expect(n).toBe(3);
    expect(s.getSnapshot().doc).toBe(7);
  });

  it('is read-only on demand: no edits, no undo, no redo', () => {
    const s = new DocumentStore(0);
    s.edit(inc());
    s.setReadOnly(true);
    expect(s.edit(inc())).toBe(false);
    expect(s.undo()).toBe(false);
    expect(s.getSnapshot()).toMatchObject({ canUndo: false, canRedo: false, readOnly: true, doc: 1 });
  });

  it('replace() loads a document, clears history and bumps the revision', () => {
    const s = new DocumentStore(0);
    s.edit(inc());
    const before = s.getSnapshot().rev;
    s.replace(50, { readOnly: true });
    expect(s.getSnapshot()).toMatchObject({ doc: 50, canUndo: false, readOnly: true });
    expect(s.getSnapshot().rev).toBeGreaterThan(before);
  });

  it('notifies subscribers and hands out a stable snapshot between changes', () => {
    const s = new DocumentStore(0);
    let calls = 0;
    const off = s.subscribe(() => calls++);
    const a = s.getSnapshot();
    expect(s.getSnapshot()).toBe(a);
    s.edit(inc());
    expect(calls).toBe(1);
    expect(s.getSnapshot()).not.toBe(a);
    off();
    s.edit(inc());
    expect(calls).toBe(1);
  });
});
```

`web/test/editor/autosave.test.ts`:
```ts
// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import { Autosave, SaveError } from '../../src/editor/store/autosave';
import { DocumentStore, type Edit } from '../../src/editor/store/document-store';
import { fakeTimers } from '../support/fake-timers';

const inc: Edit<number> = { label: 'inc', apply: (d) => d + 1 };

function setup() {
  const f = fakeTimers();
  const store = new DocumentStore(0);
  const saved: number[] = [];
  const ctl = { fail: null as Error | null, hold: null as null | { release: () => void } };
  const save = async (doc: number) => {
    if (ctl.fail !== null) throw ctl.fail;
    if (ctl.hold !== null) {
      await new Promise<void>((resolve) => (ctl.hold = { release: resolve }));
    }
    saved.push(doc);
  };
  const autosave = new Autosave(store, save, f.timers);
  return { f, store, saved, ctl, autosave };
}

describe('Autosave', () => {
  it('waits for the edits to settle, then saves once', async () => {
    const { f, store, saved, autosave } = setup();
    store.edit(inc);
    store.edit(inc);
    expect(autosave.getState().kind).toBe('dirty');
    await f.advance(799);
    expect(saved).toEqual([]);
    await f.advance(2);
    expect(saved).toEqual([2]);
    expect(autosave.getState().kind).toBe('clean');
  });

  it('keeps saving during continuous editing (max wait)', async () => {
    const { f, store, saved } = setup();
    for (let i = 0; i < 20; i++) {
      store.edit(inc);
      await f.advance(500); // never quiet for the 800 ms debounce
    }
    expect(saved.length).toBeGreaterThanOrEqual(1);
  });

  it('shows an error, retries with backoff and recovers', async () => {
    const { f, store, saved, ctl, autosave } = setup();
    ctl.fail = new SaveError(500, 'internal');
    store.edit(inc);
    await f.advance(900);
    expect(autosave.getState()).toEqual({ kind: 'error', code: 'internal', attempt: 1 });
    await f.advance(1_000);
    expect(autosave.getState()).toMatchObject({ kind: 'error', attempt: 2 });
    await f.advance(2_000);
    expect(autosave.getState()).toMatchObject({ kind: 'error', attempt: 3 });
    ctl.fail = null;
    await f.advance(4_000);
    expect(saved).toEqual([1]);
    expect(autosave.getState().kind).toBe('clean');
  });

  it('treats a network failure as an error with code "network"', async () => {
    const { f, store, ctl, autosave } = setup();
    ctl.fail = new TypeError('fetch failed');
    store.edit(inc);
    await f.advance(900);
    expect(autosave.getState()).toMatchObject({ kind: 'error', code: 'network' });
  });

  it('never reports clean while a newer revision exists: an edit during a save is saved afterwards', async () => {
    const { f, store, saved, ctl, autosave } = setup();
    ctl.hold = { release: () => {} };
    store.edit(inc);
    await f.advance(900);
    expect(autosave.getState().kind).toBe('saving');
    store.edit(inc);
    ctl.hold.release();
    await f.advance(0);
    expect(saved).toEqual([1]);
    expect(autosave.getState().kind).toBe('dirty');
    await f.advance(900);
    expect(autosave.getState().kind).toBe('saving');
    ctl.hold.release();
    await f.advance(0);
    expect(saved).toEqual([1, 2]);
    expect(autosave.getState().kind).toBe('clean');
  });

  it('undo after a failed save is saved once the server is back', async () => {
    const { f, store, saved, ctl, autosave } = setup();
    store.edit(inc);
    await f.advance(900);
    expect(saved).toEqual([1]);
    ctl.fail = new SaveError(500, 'internal');
    store.edit(inc);
    await f.advance(900);
    expect(autosave.getState().kind).toBe('error');
    store.undo(); // the screen now shows 1 again
    ctl.fail = null;
    await f.advance(1_000);
    expect(saved).toEqual([1, 1]); // the file ends equal to what the screen shows
    expect(autosave.getState().kind).toBe('clean');
    expect(store.getSnapshot().doc).toBe(1);
  });

  it('locks on 409 episode_live: read-only, no more saves, no retry', async () => {
    const { f, store, ctl, autosave } = setup();
    ctl.fail = new SaveError(409, 'episode_live');
    store.edit(inc);
    await f.advance(900);
    expect(autosave.getState().kind).toBe('locked');
    expect(store.getSnapshot().readOnly).toBe(true);
    expect(store.edit(inc)).toBe(false);
    await f.advance(60_000);
    expect(autosave.getState().kind).toBe('locked');
  });

  it('a 400 stops retrying; the next edit tries again', async () => {
    const { f, store, saved, ctl, autosave } = setup();
    ctl.fail = new SaveError(400, 'invalid_body');
    store.edit(inc);
    await f.advance(900);
    expect(autosave.getState()).toEqual({ kind: 'invalid', code: 'invalid_body' });
    await f.advance(30_000);
    expect(autosave.getState().kind).toBe('invalid');
    ctl.fail = null;
    store.edit(inc);
    await f.advance(900);
    expect(saved).toEqual([2]);
    expect(autosave.getState().kind).toBe('clean');
  });

  it('flush() saves immediately and resolves when clean', async () => {
    const { store, saved, autosave } = setup();
    store.edit(inc);
    await autosave.flush();
    expect(saved).toEqual([1]);
    expect(autosave.getState().kind).toBe('clean');
  });

  it('flush() resolves with the error state when the save fails', async () => {
    const { store, ctl, autosave } = setup();
    ctl.fail = new SaveError(500, 'internal');
    store.edit(inc);
    await autosave.flush();
    expect(autosave.getState().kind).toBe('error');
  });

  it('retryNow() runs an attempt without waiting for the backoff', async () => {
    const { f, store, saved, ctl, autosave } = setup();
    ctl.fail = new SaveError(503, 'down');
    store.edit(inc);
    await f.advance(900);
    ctl.fail = null;
    await autosave.retryNow();
    expect(saved).toEqual([1]);
    expect(autosave.getState().kind).toBe('clean');
  });

  it('markSaved() declares a freshly loaded document clean', async () => {
    const { store, autosave } = setup();
    store.replace(7);
    autosave.markSaved();
    expect(autosave.getState().kind).toBe('clean');
  });
});
```
(The `hold` mechanism: setting `ctl.hold` to any object makes the next `save` park until the test calls `ctl.hold.release()`; the save re-assigns `ctl.hold` to the real resolver. Keep this exact shape.)

- [ ] **Step 2: Run, confirm FAIL.** `pnpm vitest run web/test/editor/document-store.test.ts web/test/editor/autosave.test.ts`.
- [ ] **Step 3: Create the three source files above verbatim. Run again → PASS, 3 times; `pnpm typecheck`.**
- [ ] **Step 4: Commit**

```
git add web/src/editor/store web/test/editor/document-store.test.ts web/test/editor/autosave.test.ts web/test/support/fake-timers.ts
git commit -m "feat(web): editor document store with undo/redo and ordered autosave"
```

---

### Task 4: Ids, time math and rundown operations (pure)

**Files:**
- Create: `web/src/editor/model/ids.ts`, `web/src/editor/model/time.ts`, `web/src/editor/model/ops.ts`, `web/test/editor/ids.test.ts`, `web/test/editor/time.test.ts`, `web/test/editor/ops.test.ts`

**Interfaces:**
- `slugify(name)`, `uniqueSlug(name, taken)`, `nextId(prefix, taken)`.
- `blockOffsets(blocks)`, `totalMs(blocks)`, `plannedEndMs(plannedStart, total)`, `blockTimings(blocks)`, `mediaTotalMs(block)`, `localDate(now)`, `toIsoWithOffset(date, time)`, `timeOfDay(iso)` (the last three serve the library and the settings panel, which run in parallel and therefore cannot share a file owned by one of them).
- `RundownDoc = Rundown & { id: string; name: string }` (a `Format` or an `Episode`).
- Every operation returns `Edit<D>` (`D extends RundownDoc`) and is a no-op (returns the same object) when its arguments do not apply. `OP_LABELS` lists every label.

`web/src/editor/model/ids.ts`:
```ts
// SPDX-License-Identifier: GPL-2.0-or-later

const RESERVED = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\.|$)/;

/** Lowercase slug that satisfies the server's id rule (`^[a-z0-9][a-z0-9._-]{0,99}$`, no Windows reserved names). */
export function slugify(name: string): string {
  let s = name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  s = s.slice(0, 80).replace(/-+$/, '');
  if (s === '') s = 'senza-nome';
  if (RESERVED.test(s)) s = `${s}-1`;
  return s;
}

/** `slugify(name)`, or `slug-2`, `slug-3`… when the slug is taken. */
export function uniqueSlug(name: string, taken: ReadonlySet<string>): string {
  const base = slugify(name);
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) {
    const candidate = `${base}-${n}`;
    if (!taken.has(candidate)) return candidate;
  }
}

/** `prefix-1`, `prefix-2`… the first one not taken. Deterministic: no randomness in documents. */
export function nextId(prefix: string, taken: ReadonlySet<string>): string {
  for (let n = 1; ; n++) {
    const id = `${prefix}-${n}`;
    if (!taken.has(id)) return id;
  }
}
```

`web/src/editor/model/time.ts`:
```ts
// SPDX-License-Identifier: GPL-2.0-or-later
import { plannedStudioTimeMs, type Block, type StudioBlock } from '@olc/shared';

export function blockOffsets(blocks: ReadonlyArray<Pick<Block, 'durationMs'>>): number[] {
  let t = 0;
  return blocks.map((b) => {
    const offset = t;
    t += b.durationMs;
    return offset;
  });
}

export function totalMs(blocks: ReadonlyArray<Pick<Block, 'durationMs'>>): number {
  return blocks.reduce((t, b) => t + b.durationMs, 0);
}

/** Epoch ms of the planned end (planned start + total), or null when there is no valid planned start. */
export function plannedEndMs(plannedStart: string | null, total: number): number | null {
  if (plannedStart === null) return null;
  const start = Date.parse(plannedStart);
  return Number.isNaN(start) ? null : start + total;
}

export function mediaTotalMs(block: StudioBlock): number {
  return block.elements.reduce((t, e) => (e.kind === 'media' ? t + e.plannedDurationMs : t), 0);
}

/** Local calendar date as `YYYY-MM-DD`. */
export function localDate(now: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

/** `2026-10-12` + `19:30` in the browser's time zone → `2026-10-12T19:30:00+02:00` (ISO 8601 with offset, as the schema requires). */
export function toIsoWithOffset(date: string, time: string): string {
  const [y, mo, d] = date.split('-').map(Number) as [number, number, number];
  const [h, mi] = time.split(':').map(Number) as [number, number];
  const local = new Date(y, mo - 1, d, h, mi, 0);
  const offset = -local.getTimezoneOffset();
  const sign = offset >= 0 ? '+' : '-';
  const p = (n: number) => String(Math.trunc(n)).padStart(2, '0');
  return `${date}T${p(h)}:${p(mi)}:00${sign}${p(Math.abs(offset) / 60)}:${p(Math.abs(offset) % 60)}`;
}

/** `HH:MM` in the browser's time zone of an ISO datetime; null when absent or invalid. */
export function timeOfDay(iso: string | null): string | null {
  if (iso === null) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  const d = new Date(t);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}`;
}

export interface BlockTiming {
  id: string;
  startMs: number;
  endMs: number;
  /** Duration minus media; null for a break. Negative = media exceed the block (an error). */
  studioMs: number | null;
  /** Media elements whose duration is unknown (counted as 0 above, flagged in the UI). */
  unknownMedia: number;
}

export function blockTimings(blocks: ReadonlyArray<Block>): BlockTiming[] {
  const offsets = blockOffsets(blocks);
  return blocks.map((b, i) => ({
    id: b.id,
    startMs: offsets[i]!,
    endMs: offsets[i]! + b.durationMs,
    studioMs: b.kind === 'studio' ? plannedStudioTimeMs(b) : null,
    unknownMedia: b.kind === 'studio' ? b.elements.filter((e) => e.kind === 'media' && e.durationSource === 'unknown').length : 0,
  }));
}
```

`web/src/editor/model/ops.ts` — rules, then code:

1. `moveItem(arr, from, to)`: remove `from`, insert so the item ends at final index `to`; returns the SAME array when `from === to` or out of range.
2. `moveBlock(from, to)`: `to` is the **final index** (clamped to `0..n-1`); no-op when equal.
3. `resizeBlock(id, ms)`: duration = `max(MIN_BLOCK_MS, round(ms / SNAP_MS) * SNAP_MS)`; coalesce key `resize:<id>`; no-op when unchanged.
4. `patchStudio(id, patch)` / `patchBreak(id, patch)`: change only `name` (trimmed, must be 1..120 chars else no-op), `durationMs` (same clamp), `elastic`, `sceneGroupId` (studio) or `scene` (non-empty), `mediaInput` (break). Coalesce key `patch:<id>:<field>` for `name`, `scene`, `mediaInput`, `durationMs`; none for the others. A patch that changes nothing is a no-op.
5. `convertBlock(id, kind)`: studio → break (`scene: 'BREAK'`, `mediaInput: null`, elements dropped, same name and duration); break → studio (one fresh studio element, `elastic: true`, first scene group id or `''`). Same kind: no-op.
6. `addBlock(kind, atIndex, name)`: studio 300 000 ms, elastic, first scene group, one fresh studio element; break 180 000 ms, scene `BREAK`, `mediaInput: null`. Id `blk-N`, element ids `el-N`, both unique across blocks and elements.
7. `duplicateBlock(id, name)`: inserted right after the original; **studio parts are copied with new ids, media elements are NOT copied** (their path#occurrence would collide with the original's and match the same deck item twice).
8. `deleteBlock(id)`; `splitBlock(id, atMs, secondName)`: studio only; `atMs` snapped; both parts ≥ `MIN_BLOCK_MS`, otherwise no-op. The first part keeps all elements and the id; the second part is a new `blk-N` with the same scene group and `elastic`, one fresh studio element, and the remaining time.
9. Elements (studio blocks): `addStudioPart(blockId, index?)`, `addMedia(blockId, media, index?)` (media without `id`; id `el-N`), `removeElement(blockId, elId)` (no-op if it is the block's last element), `moveElement(blockId, from, to)`, `patchMedia(blockId, elId, patch)` (`title`, `plannedDurationMs` ≥ 0 integer, `durationSource`; when `plannedDurationMs` changes and `durationSource` is not in the patch, `durationSource` becomes `'manual'`; key `media:<elId>`).
10. Document level: `renameDoc(name)` (1..120 after trim; key `doc-name`), `setPreset(patch)` (key `preset:<field>`; `adjustStepMs` ≥ 1000), `applyMode(mode)` (replaces the whole preset with `presetForMode(mode)`), `addSceneGroup(name)` (id = `uniqueSlug(name)` among group ids; scenes `[]` is NOT valid in the schema, so the group is created with scenes `['SCENA']` placeholder text that the UI shows for editing), `patchSceneGroup(id, {name?, scenes?})` (scenes must stay non-empty, entries non-empty), `removeSceneGroup(id)` (**refused when any block uses it**), `addMessage(text)` (id `uniqueSlug`, dismiss `timeout 10000`), `patchMessage(id, patch)` (text 1..80, `timeout.ms` ≥ 1000), `removeMessage(id)`. Episodes only: `patchEpisodeMeta({ date?, plannedStart?, playlistName? })` (label `edit_episode`; no-op on a document without `formatId`; `date` must match `YYYY-MM-DD`; `plannedStart` is `null` or an ISO 8601 datetime WITH offset and seconds, e.g. `2026-10-12T19:00:00+02:00`; `playlistName` any string or `null`; empty string becomes `null`).

```ts
// SPDX-License-Identifier: GPL-2.0-or-later
import {
  presetForMode,
  type Block,
  type BreakBlock,
  type MediaElement,
  type MessagePreset,
  type Preset,
  type ProductionMode,
  type Rundown,
  type SceneGroup,
  type StudioBlock,
} from '@olc/shared';
import type { Edit } from '../store/document-store';
import { MIN_BLOCK_MS, SNAP_MS } from './constants';
import { nextId, uniqueSlug } from './ids';

export type RundownDoc = Rundown & { id: string; name: string };

const clampDuration = (ms: number) => Math.max(MIN_BLOCK_MS, Math.round(ms / SNAP_MS) * SNAP_MS);

export const OP_LABELS = [
  'move_block', 'resize_block', 'edit_block', 'convert_block', 'add_block', 'duplicate_block', 'delete_block',
  'split_block', 'add_element', 'remove_element', 'move_element', 'edit_media', 'rename_doc', 'edit_preset',
  'edit_scene_group', 'edit_message', 'import_media', 'edit_episode',
] as const;
export type OpLabel = (typeof OP_LABELS)[number];

export function moveItem<T>(arr: readonly T[], from: number, to: number): readonly T[] {
  if (from === to || from < 0 || from >= arr.length || to < 0 || to >= arr.length) return arr;
  const next = arr.slice();
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item!);
  return next;
}

function takenIds(doc: Rundown): Set<string> {
  const ids = new Set<string>();
  for (const b of doc.blocks) {
    ids.add(b.id);
    if (b.kind === 'studio') for (const e of b.elements) ids.add(e.id);
  }
  return ids;
}

const withBlocks = <D extends RundownDoc>(doc: D, blocks: Block[]): D => ({ ...doc, blocks });

function mapBlock<D extends RundownDoc>(doc: D, id: string, fn: (b: Block) => Block): D {
  const i = doc.blocks.findIndex((b) => b.id === id);
  if (i < 0) return doc;
  const next = fn(doc.blocks[i]!);
  if (next === doc.blocks[i]) return doc;
  const blocks = doc.blocks.slice();
  blocks[i] = next;
  return withBlocks(doc, blocks);
}

export function moveBlock<D extends RundownDoc>(from: number, to: number): Edit<D> {
  return {
    label: 'move_block',
    apply: (doc) => {
      const t = Math.max(0, Math.min(doc.blocks.length - 1, to));
      const blocks = moveItem(doc.blocks, from, t) as Block[];
      return blocks === doc.blocks ? doc : withBlocks(doc, blocks);
    },
  };
}

export function resizeBlock<D extends RundownDoc>(id: string, ms: number): Edit<D> {
  return {
    label: 'resize_block',
    coalesceKey: `resize:${id}`,
    apply: (doc) => mapBlock(doc, id, (b) => (b.durationMs === clampDuration(ms) ? b : { ...b, durationMs: clampDuration(ms) })),
  };
}

export type StudioPatch = Partial<Pick<StudioBlock, 'name' | 'durationMs' | 'elastic' | 'sceneGroupId'>>;
export type BreakPatch = Partial<Pick<BreakBlock, 'name' | 'durationMs' | 'scene' | 'mediaInput'>>;

function patchBlock<D extends RundownDoc>(id: string, kind: Block['kind'], patch: StudioPatch & BreakPatch): Edit<D> {
  const textFields = ['name', 'durationMs', 'scene', 'mediaInput'] as const;
  const field = textFields.find((f) => f in patch);
  return {
    label: 'edit_block',
    coalesceKey: field === undefined ? undefined : `patch:${id}:${field}`,
    apply: (doc) =>
      mapBlock(doc, id, (b) => {
        if (b.kind !== kind) return b;
        const next: Record<string, unknown> = { ...b };
        if (patch.name !== undefined) {
          const name = patch.name.trim();
          if (name.length < 1 || name.length > 120) return b;
          next.name = name;
        }
        if (patch.durationMs !== undefined) next.durationMs = clampDuration(patch.durationMs);
        if (b.kind === 'studio') {
          if (patch.elastic !== undefined) next.elastic = patch.elastic;
          if (patch.sceneGroupId !== undefined) next.sceneGroupId = patch.sceneGroupId;
        } else {
          if (patch.scene !== undefined) {
            if (patch.scene.trim() === '') return b;
            next.scene = patch.scene;
          }
          if (patch.mediaInput !== undefined) next.mediaInput = patch.mediaInput === '' ? null : patch.mediaInput;
        }
        const changed = Object.keys(next).some((k) => next[k] !== (b as Record<string, unknown>)[k]);
        return changed ? (next as unknown as Block) : b;
      }),
  };
}
export const patchStudio = <D extends RundownDoc>(id: string, patch: StudioPatch) => patchBlock<D>(id, 'studio', patch);
export const patchBreak = <D extends RundownDoc>(id: string, patch: BreakPatch) => patchBlock<D>(id, 'break', patch);

export function convertBlock<D extends RundownDoc>(id: string, kind: Block['kind']): Edit<D> {
  return {
    label: 'convert_block',
    apply: (doc) =>
      mapBlock(doc, id, (b) => {
        if (b.kind === kind) return b;
        if (kind === 'break') return { id: b.id, kind: 'break', name: b.name, durationMs: b.durationMs, scene: 'BREAK', mediaInput: null };
        const ids = takenIds(doc);
        return {
          id: b.id, kind: 'studio', name: b.name, durationMs: b.durationMs, elastic: true,
          sceneGroupId: doc.sceneGroups[0]?.id ?? '',
          elements: [{ id: nextId('el', ids), kind: 'studio' }],
        };
      }),
  };
}

function freshBlock(doc: Rundown, kind: Block['kind'], name: string): Block {
  const ids = takenIds(doc);
  const id = nextId('blk', ids);
  ids.add(id);
  if (kind === 'break') return { id, kind: 'break', name, durationMs: 180_000, scene: 'BREAK', mediaInput: null };
  return {
    id, kind: 'studio', name, durationMs: 300_000, elastic: true,
    sceneGroupId: doc.sceneGroups[0]?.id ?? '',
    elements: [{ id: nextId('el', ids), kind: 'studio' }],
  };
}

export function addBlock<D extends RundownDoc>(kind: Block['kind'], atIndex: number, name: string): Edit<D> {
  return {
    label: 'add_block',
    apply: (doc) => {
      const at = Math.max(0, Math.min(doc.blocks.length, atIndex));
      const blocks = doc.blocks.slice();
      blocks.splice(at, 0, freshBlock(doc, kind, name));
      return withBlocks(doc, blocks);
    },
  };
}

export function duplicateBlock<D extends RundownDoc>(id: string, name: string): Edit<D> {
  return {
    label: 'duplicate_block',
    apply: (doc) => {
      const i = doc.blocks.findIndex((b) => b.id === id);
      if (i < 0) return doc;
      const src = doc.blocks[i]!;
      const ids = takenIds(doc);
      const newId = nextId('blk', ids);
      ids.add(newId);
      let copy: Block;
      if (src.kind === 'break') copy = { ...src, id: newId, name };
      else {
        const elements = src.elements
          .filter((e) => e.kind === 'studio')
          .map((e) => {
            const eid = nextId('el', ids);
            ids.add(eid);
            return { ...e, id: eid };
          });
        copy = { ...src, id: newId, name, elements: elements.length > 0 ? elements : [{ id: nextId('el', ids), kind: 'studio' }] };
      }
      const blocks = doc.blocks.slice();
      blocks.splice(i + 1, 0, copy);
      return withBlocks(doc, blocks);
    },
  };
}

export function deleteBlock<D extends RundownDoc>(id: string): Edit<D> {
  return {
    label: 'delete_block',
    apply: (doc) => (doc.blocks.some((b) => b.id === id) ? withBlocks(doc, doc.blocks.filter((b) => b.id !== id)) : doc),
  };
}

export function splitBlock<D extends RundownDoc>(id: string, atMs: number, secondName: string): Edit<D> {
  return {
    label: 'split_block',
    apply: (doc) => {
      const i = doc.blocks.findIndex((b) => b.id === id);
      const src = doc.blocks[i];
      if (src === undefined || src.kind !== 'studio') return doc;
      const first = Math.round(atMs / SNAP_MS) * SNAP_MS;
      const rest = src.durationMs - first;
      if (first < MIN_BLOCK_MS || rest < MIN_BLOCK_MS) return doc;
      const ids = takenIds(doc);
      const newId = nextId('blk', ids);
      ids.add(newId);
      const second: StudioBlock = {
        id: newId, kind: 'studio', name: secondName, durationMs: rest, elastic: src.elastic,
        sceneGroupId: src.sceneGroupId, elements: [{ id: nextId('el', ids), kind: 'studio' }],
      };
      const blocks = doc.blocks.slice();
      blocks.splice(i, 1, { ...src, durationMs: first }, second);
      return withBlocks(doc, blocks);
    },
  };
}

function mapStudio<D extends RundownDoc>(doc: D, blockId: string, fn: (b: StudioBlock, ids: Set<string>) => StudioBlock): D {
  return mapBlock(doc, blockId, (b) => (b.kind === 'studio' ? fn(b, takenIds(doc)) : b));
}

export function addStudioPart<D extends RundownDoc>(blockId: string, index?: number): Edit<D> {
  return {
    label: 'add_element',
    apply: (doc) =>
      mapStudio(doc, blockId, (b, ids) => {
        const at = Math.max(0, Math.min(b.elements.length, index ?? b.elements.length));
        const elements = b.elements.slice();
        elements.splice(at, 0, { id: nextId('el', ids), kind: 'studio' });
        return { ...b, elements };
      }),
  };
}

export function addMedia<D extends RundownDoc>(blockId: string, media: Omit<MediaElement, 'id'>, index?: number): Edit<D> {
  return {
    label: 'add_element',
    apply: (doc) =>
      mapStudio(doc, blockId, (b, ids) => {
        const at = Math.max(0, Math.min(b.elements.length, index ?? b.elements.length));
        const elements = b.elements.slice();
        elements.splice(at, 0, { ...media, id: nextId('el', ids) });
        return { ...b, elements };
      }),
  };
}

export function removeElement<D extends RundownDoc>(blockId: string, elementId: string): Edit<D> {
  return {
    label: 'remove_element',
    apply: (doc) =>
      mapStudio(doc, blockId, (b) =>
        b.elements.length <= 1 || !b.elements.some((e) => e.id === elementId)
          ? b
          : { ...b, elements: b.elements.filter((e) => e.id !== elementId) },
      ),
  };
}

export function moveElement<D extends RundownDoc>(blockId: string, from: number, to: number): Edit<D> {
  return {
    label: 'move_element',
    apply: (doc) =>
      mapStudio(doc, blockId, (b) => {
        const elements = moveItem(b.elements, from, to) as StudioBlock['elements'];
        return elements === b.elements ? b : { ...b, elements };
      }),
  };
}

export type MediaPatch = Partial<Pick<MediaElement, 'title' | 'plannedDurationMs' | 'durationSource'>>;
export function patchMedia<D extends RundownDoc>(blockId: string, elementId: string, patch: MediaPatch): Edit<D> {
  return {
    label: 'edit_media',
    coalesceKey: `media:${elementId}`,
    apply: (doc) =>
      mapStudio(doc, blockId, (b) => {
        let changed = false;
        const elements = b.elements.map((e) => {
          if (e.id !== elementId || e.kind !== 'media') return e;
          const next: MediaElement = { ...e };
          if (patch.title !== undefined) next.title = patch.title.slice(0, 200);
          if (patch.plannedDurationMs !== undefined && Number.isInteger(patch.plannedDurationMs) && patch.plannedDurationMs >= 0) {
            next.plannedDurationMs = patch.plannedDurationMs;
            next.durationSource = patch.durationSource ?? 'manual';
          } else if (patch.durationSource !== undefined) next.durationSource = patch.durationSource;
          if (JSON.stringify(next) === JSON.stringify(e)) return e;
          changed = true;
          return next;
        });
        return changed ? { ...b, elements } : b;
      }),
  };
}

export function renameDoc<D extends RundownDoc>(name: string): Edit<D> {
  return {
    label: 'rename_doc',
    coalesceKey: 'doc-name',
    apply: (doc) => {
      const n = name.trim();
      return n.length < 1 || n.length > 120 || n === doc.name ? doc : { ...doc, name: n };
    },
  };
}

export function setPreset<D extends RundownDoc>(patch: Partial<Omit<Preset, 'mode'>>): Edit<D> {
  const field = Object.keys(patch)[0] ?? 'x';
  return {
    label: 'edit_preset',
    coalesceKey: `preset:${field}`,
    apply: (doc) => {
      if (patch.adjustStepMs !== undefined && !(Number.isInteger(patch.adjustStepMs) && patch.adjustStepMs >= 1000)) return doc;
      if (patch.warnMs !== undefined && !(Number.isInteger(patch.warnMs) && patch.warnMs >= 0)) return doc;
      if (patch.returnImminentMs !== undefined && !(Number.isInteger(patch.returnImminentMs) && patch.returnImminentMs >= 0)) return doc;
      const next = { ...doc.preset, ...patch };
      return JSON.stringify(next) === JSON.stringify(doc.preset) ? doc : { ...doc, preset: next };
    },
  };
}

export function applyMode<D extends RundownDoc>(mode: ProductionMode): Edit<D> {
  return { label: 'edit_preset', apply: (doc) => ({ ...doc, preset: presetForMode(mode) }) };
}

export function addSceneGroup<D extends RundownDoc>(name: string, placeholderScene: string): Edit<D> {
  return {
    label: 'edit_scene_group',
    apply: (doc) => {
      const n = name.trim();
      if (n === '' || n.length > 120) return doc;
      const id = uniqueSlug(n, new Set(doc.sceneGroups.map((g) => g.id)));
      return { ...doc, sceneGroups: [...doc.sceneGroups, { id, name: n, scenes: [placeholderScene] }] };
    },
  };
}

export function patchSceneGroup<D extends RundownDoc>(id: string, patch: Partial<Pick<SceneGroup, 'name' | 'scenes'>>): Edit<D> {
  return {
    label: 'edit_scene_group',
    coalesceKey: `group:${id}`,
    apply: (doc) => {
      if (patch.name !== undefined && (patch.name.trim() === '' || patch.name.length > 120)) return doc;
      if (patch.scenes !== undefined && (patch.scenes.length < 1 || patch.scenes.some((s) => s.trim() === ''))) return doc;
      let changed = false;
      const sceneGroups = doc.sceneGroups.map((g) => {
        if (g.id !== id) return g;
        const next = { ...g, ...patch };
        if (JSON.stringify(next) === JSON.stringify(g)) return g;
        changed = true;
        return next;
      });
      return changed ? { ...doc, sceneGroups } : doc;
    },
  };
}

export function removeSceneGroup<D extends RundownDoc>(id: string): Edit<D> {
  return {
    label: 'edit_scene_group',
    apply: (doc) =>
      doc.blocks.some((b) => b.kind === 'studio' && b.sceneGroupId === id) || !doc.sceneGroups.some((g) => g.id === id)
        ? doc
        : { ...doc, sceneGroups: doc.sceneGroups.filter((g) => g.id !== id) },
  };
}

export function addMessage<D extends RundownDoc>(text: string): Edit<D> {
  return {
    label: 'edit_message',
    apply: (doc) => {
      const t = text.trim();
      if (t === '' || t.length > 80) return doc;
      const id = uniqueSlug(t, new Set(doc.messages.map((m) => m.id)));
      return { ...doc, messages: [...doc.messages, { id, text: t, dismiss: { kind: 'timeout', ms: 10_000 } }] };
    },
  };
}

export function patchMessage<D extends RundownDoc>(id: string, patch: Partial<Pick<MessagePreset, 'text' | 'dismiss'>>): Edit<D> {
  return {
    label: 'edit_message',
    coalesceKey: `message:${id}`,
    apply: (doc) => {
      if (patch.text !== undefined && (patch.text.trim() === '' || patch.text.length > 80)) return doc;
      if (patch.dismiss?.kind === 'timeout' && !(Number.isInteger(patch.dismiss.ms) && patch.dismiss.ms >= 1000)) return doc;
      let changed = false;
      const messages = doc.messages.map((m) => {
        if (m.id !== id) return m;
        const next = { ...m, ...patch };
        if (JSON.stringify(next) === JSON.stringify(m)) return m;
        changed = true;
        return next;
      });
      return changed ? { ...doc, messages } : doc;
    },
  };
}

const ISO_WITH_OFFSET = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

export function patchEpisodeMeta<D extends RundownDoc>(patch: {
  date?: string;
  plannedStart?: string | null;
  playlistName?: string | null;
}): Edit<D> {
  return {
    label: 'edit_episode',
    coalesceKey: `episode:${Object.keys(patch)[0] ?? 'x'}`,
    apply: (doc) => {
      if (!('formatId' in doc)) return doc;
      if (patch.date !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(patch.date)) return doc;
      if (patch.plannedStart != null && !(ISO_WITH_OFFSET.test(patch.plannedStart) && !Number.isNaN(Date.parse(patch.plannedStart)))) return doc;
      const next: Record<string, unknown> = { ...doc };
      if (patch.date !== undefined) next.date = patch.date;
      if (patch.plannedStart !== undefined) next.plannedStart = patch.plannedStart;
      if (patch.playlistName !== undefined) next.playlistName = patch.playlistName === null || patch.playlistName.trim() === '' ? null : patch.playlistName;
      return JSON.stringify(next) === JSON.stringify(doc) ? doc : (next as unknown as D);
    },
  };
}

export function removeMessage<D extends RundownDoc>(id: string): Edit<D> {
  return {
    label: 'edit_message',
    apply: (doc) => (doc.messages.some((m) => m.id === id) ? { ...doc, messages: doc.messages.filter((m) => m.id !== id) } : doc),
  };
}
```

- [ ] **Step 1: Write the failing tests**

`web/test/editor/ids.test.ts`:
```ts
// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import { nextId, slugify, uniqueSlug } from '../../src/editor/model/ids';

const SAFE_ID = /^[a-z0-9][a-z0-9._-]{0,99}$/;
const RESERVED_ID = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\.|$)/;

describe('slugify', () => {
  it.each([
    ['Solo Futsal', 'solo-futsal'],
    ['  Così è la Vita!  ', 'cosi-e-la-vita'],
    ['Puntata del 12/10/2026', 'puntata-del-12-10-2026'],
    ['---', 'senza-nome'],
    ['', 'senza-nome'],
    ['ÀÉÎÕÜ', 'aeiou'],
    ['CON', 'con-1'],
    ['com1', 'com1-1'],
    ['lpt9', 'lpt9-1'],
    ['nul', 'nul-1'],
    ['Console', 'console'],
  ])('%j -> %j', (input, expected) => {
    expect(slugify(input)).toBe(expected);
  });

  it('always satisfies the server id rule, even for hostile input', () => {
    for (const s of ['x'.repeat(500), '../../etc/passwd', 'C:\\Windows\\System32', 'a.b.c', '日本語', '\u0000\u0001', 'Aux.txt', 'a'.repeat(79) + ' b']) {
      const id = slugify(s);
      expect(SAFE_ID.test(id), id).toBe(true);
      expect(RESERVED_ID.test(id), id).toBe(false);
      expect(id.includes('..')).toBe(false);
    }
  });
});

describe('uniqueSlug and nextId', () => {
  it('appends -2, -3 … when taken', () => {
    expect(uniqueSlug('Solo Futsal', new Set())).toBe('solo-futsal');
    expect(uniqueSlug('Solo Futsal', new Set(['solo-futsal']))).toBe('solo-futsal-2');
    expect(uniqueSlug('Solo Futsal', new Set(['solo-futsal', 'solo-futsal-2']))).toBe('solo-futsal-3');
  });
  it('nextId takes the first free number', () => {
    expect(nextId('blk', new Set())).toBe('blk-1');
    expect(nextId('blk', new Set(['blk-1', 'blk-3']))).toBe('blk-2');
  });
});
```

`web/test/editor/time.test.ts`:
```ts
// SPDX-License-Identifier: GPL-2.0-or-later
import { Episode } from '@olc/shared';
import { soloFutsalEpisode, soloFutsalFormat } from '@olc/shared/testing';
import { describe, expect, it } from 'vitest';
import { blockOffsets, blockTimings, localDate, plannedEndMs, timeOfDay, toIsoWithOffset, totalMs } from '../../src/editor/model/time';

describe('time math', () => {
  const f = soloFutsalFormat();
  it('computes offsets and the total', () => {
    expect(blockOffsets(f.blocks)).toEqual([0, 720_000, 900_000, 1_500_000]);
    expect(totalMs(f.blocks)).toBe(1_620_000);
  });
  it('computes the planned end from the planned start', () => {
    expect(plannedEndMs('2026-10-12T19:00:00+02:00', 1_620_000)).toBe(Date.parse('2026-10-12T17:27:00Z'));
    expect(plannedEndMs(null, 1)).toBeNull();
    expect(plannedEndMs('not a date', 1)).toBeNull();
  });
  it('computes studio time per block (duration minus media) and null for a break', () => {
    const t = blockTimings(f.blocks);
    expect(t.map((x) => x.studioMs)).toEqual([540_000, null, 480_000, 120_000]);
    expect(t[1]).toMatchObject({ startMs: 720_000, endMs: 900_000 });
  });
  it('localDate uses the local calendar date', () => {
    expect(localDate(new Date(2026, 9, 5, 23, 59))).toBe('2026-10-05');
  });
  it('toIsoWithOffset names the same instant as the local wall time and satisfies the Episode schema', () => {
    const iso = toIsoWithOffset('2026-10-12', '19:30');
    expect(iso).toMatch(/^2026-10-12T19:30:00[+-]\d{2}:\d{2}$/);
    expect(Date.parse(iso)).toBe(new Date(2026, 9, 12, 19, 30).getTime());
    expect(Episode.safeParse({ ...soloFutsalEpisode(), plannedStart: iso }).success).toBe(true);
  });
  it('timeOfDay is the local HH:MM of an ISO datetime', () => {
    expect(timeOfDay(toIsoWithOffset('2026-10-12', '19:30'))).toBe('19:30');
    expect(timeOfDay(null)).toBeNull();
    expect(timeOfDay('nope')).toBeNull();
  });
  it('counts media with an unknown duration', () => {
    const g = structuredClone(f);
    const b = g.blocks[0]!;
    if (b.kind === 'studio') b.elements = b.elements.map((e) => (e.kind === 'media' ? { ...e, plannedDurationMs: 0, durationSource: 'unknown' as const } : e));
    expect(blockTimings(g.blocks)[0]!.unknownMedia).toBe(1);
  });
});
```
`web/test/editor/ops.test.ts` — complete:
```ts
// SPDX-License-Identifier: GPL-2.0-or-later
import { Episode, Format, validateRundown, type StudioBlock } from '@olc/shared';
import { soloFutsalEpisode, soloFutsalFormat } from '@olc/shared/testing';
import { describe, expect, it } from 'vitest';
import * as ops from '../../src/editor/model/ops';

const base = () => soloFutsalFormat();
const run = (doc: ReturnType<typeof base>, e: { apply(d: ReturnType<typeof base>): ReturnType<typeof base> }) => e.apply(doc);
const ids = (d: ReturnType<typeof base>) => d.blocks.map((b) => b.id);
const studio = (d: ReturnType<typeof base>, id: string) => d.blocks.find((b) => b.id === id) as StudioBlock;

describe('moveItem / moveBlock', () => {
  it('moveItem puts the item at the FINAL index', () => {
    expect(ops.moveItem(['a', 'b', 'c', 'd'], 0, 2)).toEqual(['b', 'c', 'a', 'd']);
    expect(ops.moveItem(['a', 'b', 'c', 'd'], 3, 0)).toEqual(['d', 'a', 'b', 'c']);
    expect(ops.moveItem(['a', 'b', 'c', 'd'], 1, 2)).toEqual(['a', 'c', 'b', 'd']);
  });
  it('returns the same array for a no-op or an out-of-range index', () => {
    const a = ['a', 'b'];
    expect(ops.moveItem(a, 1, 1)).toBe(a);
    expect(ops.moveItem(a, 5, 0)).toBe(a);
    expect(ops.moveItem(a, 0, 9)).toBe(a);
  });
  it('moveBlock moves to the final index and clamps', () => {
    expect(ids(run(base(), ops.moveBlock(0, 2)))).toEqual(['br1', 'b2', 'b1', 'b3']);
    expect(ids(run(base(), ops.moveBlock(0, 99)))).toEqual(['br1', 'b2', 'b3', 'b1']);
    const d = base();
    expect(run(d, ops.moveBlock(2, 2))).toBe(d);
  });
});

describe('resize and patch', () => {
  it('resize snaps to 5 s and never goes below the minimum', () => {
    expect(run(base(), ops.resizeBlock('b1', 731_000)).blocks[0]!.durationMs).toBe(730_000);
    expect(run(base(), ops.resizeBlock('b1', 100)).blocks[0]!.durationMs).toBe(5_000);
    const d = base();
    expect(run(d, ops.resizeBlock('b1', 720_000))).toBe(d);
    expect(run(d, ops.resizeBlock('nope', 10_000))).toBe(d);
  });
  it('resize edits coalesce per block', () => {
    expect(ops.resizeBlock('b1', 1).coalesceKey).toBe('resize:b1');
    expect(ops.resizeBlock('b2', 1).coalesceKey).toBe('resize:b2');
  });
  it('patchStudio changes only valid fields', () => {
    const d = run(base(), ops.patchStudio('b1', { name: '  Nuovo  ', elastic: false, durationMs: 301_000 }));
    expect(studio(d, 'b1')).toMatchObject({ name: 'Nuovo', elastic: false, durationMs: 300_000 });
    const same = base();
    expect(run(same, ops.patchStudio('b1', { name: '   ' }))).toBe(same);
    expect(run(same, ops.patchStudio('b1', { name: 'Primo blocco' }))).toBe(same);
    expect(run(same, ops.patchStudio('br1', { name: 'x' }))).toBe(same); // wrong kind
  });
  it('patchBreak sets the scene and the optional media input', () => {
    const d = run(base(), ops.patchBreak('br1', { scene: 'PAUSA', mediaInput: '' }));
    expect(d.blocks[1]).toMatchObject({ scene: 'PAUSA', mediaInput: null });
    const same = base();
    expect(run(same, ops.patchBreak('br1', { scene: ' ' }))).toBe(same);
  });
  it('convertBlock switches kinds and keeps the id, name and duration', () => {
    const asBreak = run(base(), ops.convertBlock('b3', 'break')).blocks[3]!;
    expect(asBreak).toMatchObject({ id: 'b3', kind: 'break', name: 'Chiusura', durationMs: 120_000, scene: 'BREAK', mediaInput: null });
    const asStudio = run(base(), ops.convertBlock('br1', 'studio')).blocks[1] as StudioBlock;
    expect(asStudio).toMatchObject({ id: 'br1', kind: 'studio', sceneGroupId: 'studio', elastic: true });
    expect(asStudio.elements).toHaveLength(1);
    const same = base();
    expect(run(same, ops.convertBlock('b1', 'studio'))).toBe(same);
  });
});

describe('add, duplicate, delete, split', () => {
  it('addBlock inserts at the index with unique ids', () => {
    const d = run(base(), ops.addBlock('studio', 1, 'Nuovo'));
    expect(d.blocks[1]).toMatchObject({ id: 'blk-1', kind: 'studio', name: 'Nuovo', durationMs: 300_000 });
    expect(new Set(d.blocks.flatMap((b) => [b.id, ...(b.kind === 'studio' ? b.elements.map((e) => e.id) : [])])).size).toBe(
      d.blocks.length + d.blocks.reduce((n, b) => n + (b.kind === 'studio' ? b.elements.length : 0), 0),
    );
    const d2 = run(d, ops.addBlock('break', 99, 'Pausa'));
    expect(d2.blocks.at(-1)).toMatchObject({ id: 'blk-2', kind: 'break', scene: 'BREAK' });
  });
  it('addBlock produces a document the schema accepts', () => {
    const d = run(run(base(), ops.addBlock('studio', 0, 'A')), ops.addBlock('break', 2, 'B'));
    expect(Format.safeParse(d).success).toBe(true);
  });
  it('duplicateBlock copies the studio parts and NOT the media', () => {
    const d = run(base(), ops.duplicateBlock('b1', 'Primo blocco (copia)'));
    expect(ids(d)).toEqual(['b1', 'blk-1', 'br1', 'b2', 'b3']);
    const copy = studio(d, 'blk-1');
    expect(copy.elements.map((e) => e.kind)).toEqual(['studio', 'studio']);
    expect(copy.durationMs).toBe(720_000);
    expect(new Set(d.blocks.flatMap((b) => (b.kind === 'studio' ? b.elements.map((e) => e.id) : []))).size).toBe(
      d.blocks.reduce((n, b) => n + (b.kind === 'studio' ? b.elements.length : 0), 0),
    );
    expect(validateRundown(d).filter((i) => i.severity === 'error')).toEqual([]);
  });
  it('duplicateBlock of a block with media only keeps a studio part', () => {
    const f = base();
    const b = f.blocks[2] as StudioBlock;
    b.elements = [b.elements[1]!]; // media only
    const d = run(f, ops.duplicateBlock('b2', 'copia'));
    expect(studio(d, 'blk-1').elements).toHaveLength(1);
    expect(studio(d, 'blk-1').elements[0]!.kind).toBe('studio');
  });
  it('deleteBlock removes it; unknown id is a no-op', () => {
    expect(ids(run(base(), ops.deleteBlock('br1')))).toEqual(['b1', 'b2', 'b3']);
    const d = base();
    expect(run(d, ops.deleteBlock('zz'))).toBe(d);
  });
  it('splitBlock cuts a studio block in two and keeps the total', () => {
    const d = run(base(), ops.splitBlock('b1', 300_000, 'Seconda parte'));
    expect(ids(d)).toEqual(['b1', 'blk-1', 'br1', 'b2', 'b3']);
    expect(d.blocks[0]!.durationMs).toBe(300_000);
    expect(d.blocks[1]).toMatchObject({ name: 'Seconda parte', durationMs: 420_000, elastic: true, sceneGroupId: 'studio' });
    expect(studio(d, 'b1').elements).toHaveLength(3); // the first part keeps its elements
    expect(d.blocks.reduce((t, b) => t + b.durationMs, 0)).toBe(1_620_000);
  });
  it('splitBlock refuses a cut that leaves less than 5 s on either side, and breaks', () => {
    const d = base();
    expect(run(d, ops.splitBlock('b1', 2_000, 'x'))).toBe(d);
    expect(run(d, ops.splitBlock('b1', 718_000, 'x'))).toBe(d);
    expect(run(d, ops.splitBlock('br1', 60_000, 'x'))).toBe(d);
  });
});

describe('elements', () => {
  it('adds a studio part and media at an index', () => {
    let d = run(base(), ops.addStudioPart('b3', 0));
    expect(studio(d, 'b3').elements.map((e) => e.id)).toEqual(['el-1', 'b3-s1']);
    d = run(d, ops.addMedia('b3', { kind: 'media', title: 'T', path: 'x.mp4', occurrence: 0, plannedDurationMs: 0, durationSource: 'unknown' }));
    const last = studio(d, 'b3').elements.at(-1)!;
    expect(last).toMatchObject({ kind: 'media', id: 'el-2', durationSource: 'unknown' });
  });
  it('never removes the last element of a studio block', () => {
    const d = base();
    expect(run(d, ops.removeElement('b3', 'b3-s1'))).toBe(d);
    expect(studio(run(d, ops.removeElement('b1', 'b1-m1')), 'b1').elements.map((e) => e.id)).toEqual(['b1-s1', 'b1-s2']);
  });
  it('moves an element to the final index', () => {
    expect(studio(run(base(), ops.moveElement('b1', 0, 2)), 'b1').elements.map((e) => e.id)).toEqual(['b1-m1', 'b1-s2', 'b1-s1']);
  });
  it('patchMedia marks a hand-typed duration as manual and keeps the title cap', () => {
    const d = run(base(), ops.patchMedia('b1', 'b1-m1', { plannedDurationMs: 200_000 }));
    expect(studio(d, 'b1').elements[1]).toMatchObject({ plannedDurationMs: 200_000, durationSource: 'manual' });
    const e = run(base(), ops.patchMedia('b1', 'b1-m1', { title: 'x'.repeat(300) }));
    expect((studio(e, 'b1').elements[1] as { title: string }).title).toHaveLength(200);
    const same = base();
    expect(run(same, ops.patchMedia('b1', 'b1-m1', { plannedDurationMs: -5 }))).toBe(same);
    expect(run(same, ops.patchMedia('b1', 'b1-s1', { title: 'q' }))).toBe(same); // not a media element
  });
});

describe('document level', () => {
  it('renames within 1..120 characters', () => {
    expect(run(base(), ops.renameDoc('  Nuovo nome ')).name).toBe('Nuovo nome');
    const d = base();
    expect(run(d, ops.renameDoc(''))).toBe(d);
    expect(run(d, ops.renameDoc('x'.repeat(121)))).toBe(d);
  });
  it('setPreset validates and applyMode replaces the whole preset', () => {
    const d = base();
    expect(run(d, ops.setPreset({ adjustStepMs: 500 }))).toBe(d);
    expect(run(d, ops.setPreset({ warnMs: 90_000 })).preset.warnMs).toBe(90_000);
    expect(run(d, ops.applyMode('streaming')).preset).toMatchObject({ mode: 'streaming', recPauseFreezesProgram: false });
  });
  it('scene groups: add (unique id), patch (non-empty scenes), remove (refused while used)', () => {
    let d = run(base(), ops.addSceneGroup('Studio', 'SCENA'));
    expect(d.sceneGroups.map((g) => g.id)).toEqual(['studio', 'studio-2']);
    d = run(d, ops.patchSceneGroup('studio-2', { scenes: ['CAM 4', 'CAM 5'] }));
    expect(d.sceneGroups[1]!.scenes).toEqual(['CAM 4', 'CAM 5']);
    expect(run(d, ops.patchSceneGroup('studio-2', { scenes: [] }))).toBe(d);
    expect(run(d, ops.removeSceneGroup('studio'))).toBe(d); // used by b1
    expect(run(d, ops.removeSceneGroup('studio-2')).sceneGroups.map((g) => g.id)).toEqual(['studio']);
  });
  it('messages: add, patch, remove; timeout at least 1 s', () => {
    let d = run(base(), ops.addMessage('PAUSA'));
    expect(d.messages.at(-1)).toMatchObject({ id: 'pausa', text: 'PAUSA', dismiss: { kind: 'timeout', ms: 10_000 } });
    expect(run(d, ops.patchMessage('pausa', { dismiss: { kind: 'timeout', ms: 500 } }))).toBe(d);
    d = run(d, ops.patchMessage('pausa', { dismiss: { kind: 'manual' } }));
    expect(d.messages.at(-1)!.dismiss).toEqual({ kind: 'manual' });
    expect(run(d, ops.removeMessage('pausa')).messages.map((m) => m.id)).toEqual(['stringi', 'cam2']);
    expect(run(d, ops.addMessage('x'.repeat(81)))).toBe(d);
  });
  it('patchEpisodeMeta edits an episode, validates, and ignores a format', () => {
    const ep = soloFutsalEpisode();
    const asEp = (e: { apply(d: typeof ep): typeof ep }) => e.apply(ep);
    expect(asEp(ops.patchEpisodeMeta({ plannedStart: '2026-10-12T20:30:00+02:00' })).plannedStart).toBe('2026-10-12T20:30:00+02:00');
    expect(asEp(ops.patchEpisodeMeta({ plannedStart: null })).plannedStart).toBeNull();
    expect(asEp(ops.patchEpisodeMeta({ playlistName: '' })).playlistName).toBeNull();
    expect(asEp(ops.patchEpisodeMeta({ date: '2026-11-01' })).date).toBe('2026-11-01');
    expect(asEp(ops.patchEpisodeMeta({ date: '1/11/2026' }))).toBe(ep);
    expect(asEp(ops.patchEpisodeMeta({ plannedStart: '20:30' }))).toBe(ep);
    expect(Episode.safeParse(asEp(ops.patchEpisodeMeta({ plannedStart: '2026-10-12T20:30:00Z' }))).success).toBe(true);
    const f = base();
    expect(run(f, ops.patchEpisodeMeta({ date: '2026-11-01' }))).toBe(f);
  });
  it('OP_LABELS covers every label an operation can emit', () => {
    const labels = new Set<string>();
    const d = base();
    const edits = [
      ops.moveBlock(0, 1), ops.resizeBlock('b1', 1), ops.patchStudio('b1', {}), ops.patchBreak('br1', {}), ops.convertBlock('b1', 'break'),
      ops.addBlock('studio', 0, 'x'), ops.duplicateBlock('b1', 'x'), ops.deleteBlock('b1'), ops.splitBlock('b1', 1, 'x'),
      ops.addStudioPart('b1'), ops.removeElement('b1', 'x'), ops.moveElement('b1', 0, 1), ops.patchMedia('b1', 'b1-m1', {}),
      ops.renameDoc('x'), ops.setPreset({}), ops.applyMode('tv'), ops.addSceneGroup('x', 's'), ops.patchSceneGroup('x', {}),
      ops.removeSceneGroup('x'), ops.addMessage('x'), ops.patchMessage('x', {}), ops.removeMessage('x'),
      ops.patchEpisodeMeta({}),
    ];
    for (const e of edits) labels.add(e.label);
    for (const l of labels) expect(ops.OP_LABELS).toContain(l);
    void d;
  });
});
```
(`import_media` is in `OP_LABELS` for Task 7/13's single "import" edit; the last test only checks the other direction.)

- [ ] **Step 2: Run, confirm FAIL.** `pnpm vitest run web/test/editor/ids.test.ts web/test/editor/time.test.ts web/test/editor/ops.test.ts`.
- [ ] **Step 3: Create the three source files above verbatim. Run again 3 times → PASS; `pnpm typecheck`.** If `tsc` rejects a spread of the generic `D`, cast the result `as D` at the single helper (`withBlocks`, the `{ ...doc, … }` returns); do not weaken `RundownDoc`.
- [ ] **Step 4: Commit**

```
git add web/src/editor/model web/test/editor/ids.test.ts web/test/editor/time.test.ts web/test/editor/ops.test.ts
git commit -m "feat(web): editor ids, time math and rundown operations"
```

---
### Task 5: Timeline geometry — snap, layout, drop index, resize, key intents (pure)

**Files:**
- Create: `web/src/editor/timeline/geometry.ts`, `web/test/editor/geometry.test.ts`

**Interfaces:**
- Produces: `snapMs`, `clampDuration`, `layout`, `fitScale`, `dropIndex`, `resizeDuration`, `blockKeyIntent`, `Slot`, `BlockIntent`, `MIN_BLOCK_PX`, `MIN_SCALE`, `MAX_SCALE`, `DEFAULT_SCALE`.
- `dropIndex(slots, draggedId, deltaX)` uses the **centre of the dragged block, displaced by the pointer movement**, against the centres of the other blocks. It returns the **final index** of the dragged block (what `moveBlock(from, to)` expects). Using the block's own centre, not the raw pointer, is what keeps wide and narrow neighbours from producing off-by-one drops.

`web/src/editor/timeline/geometry.ts`:
```ts
// SPDX-License-Identifier: GPL-2.0-or-later
import { MIN_BLOCK_MS, SNAP_MS } from '../model/constants';

/** Narrowest a block is drawn, so a 5 s block stays clickable. Positions accumulate the drawn widths. */
export const MIN_BLOCK_PX = 56;
export const MIN_SCALE = 0.0002; // px per ms: 0.2 px per second (a 3 h show fits in 2160 px)
export const MAX_SCALE = 0.2; // 200 px per second
export const DEFAULT_SCALE = 0.02;

export function snapMs(ms: number, step: number = SNAP_MS): number {
  return Math.round(ms / step) * step;
}

export function clampDuration(ms: number): number {
  return Math.max(MIN_BLOCK_MS, snapMs(ms));
}

export interface Slot {
  id: string;
  x: number;
  w: number;
}

export function layout(
  blocks: ReadonlyArray<{ id: string; durationMs: number }>,
  pxPerMs: number,
  minPx: number = MIN_BLOCK_PX,
  gap = 0,
): Slot[] {
  let x = 0;
  return blocks.map((b) => {
    const w = Math.max(minPx, b.durationMs * pxPerMs);
    const slot = { id: b.id, x, w };
    x += w + gap;
    return slot;
  });
}

/** Scale (px per ms) that makes the whole rundown fit `availablePx`, within the zoom limits. */
export function fitScale(totalMs: number, availablePx: number): number {
  if (totalMs <= 0 || availablePx <= 0) return DEFAULT_SCALE;
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, availablePx / totalMs));
}

/** Final index of the dragged block after moving it by `deltaX` px. Unknown id: -1. */
export function dropIndex(slots: readonly Slot[], draggedId: string, deltaX: number): number {
  const dragged = slots.find((s) => s.id === draggedId);
  if (dragged === undefined) return -1;
  const centre = dragged.x + dragged.w / 2 + deltaX;
  let index = 0;
  for (const s of slots) {
    if (s.id === draggedId) continue;
    if (s.x + s.w / 2 < centre) index++;
  }
  return index;
}

/** New duration after dragging the right handle by `deltaPx`: snapped to 5 s, never below the minimum. */
export function resizeDuration(startMs: number, deltaPx: number, pxPerMs: number): number {
  if (!(pxPerMs > 0)) return startMs;
  return clampDuration(startMs + deltaPx / pxPerMs);
}

export type BlockIntent =
  | { type: 'select'; delta: -1 | 1 }
  | { type: 'move'; delta: -1 | 1 }
  | { type: 'resize'; deltaMs: number }
  | { type: 'delete' }
  | { type: 'duplicate' };

export interface KeyLike {
  key: string;
  shiftKey: boolean;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
}

/**
 * Keyboard map of a focused block.
 * Arrow: select neighbour · Alt+Arrow: move · Shift+Arrow: resize ±5 s · Ctrl/Cmd+Shift+Arrow: resize ±60 s ·
 * Delete: delete · Ctrl/Cmd+D: duplicate. Anything else: null (the browser keeps its default).
 */
export function blockKeyIntent(e: KeyLike): BlockIntent | null {
  const mod = e.ctrlKey || e.metaKey;
  const dir = e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowRight' ? 1 : 0;
  if (dir !== 0) {
    if (e.shiftKey && mod) return { type: 'resize', deltaMs: dir * 60_000 };
    if (e.shiftKey) return { type: 'resize', deltaMs: dir * SNAP_MS };
    if (e.altKey) return { type: 'move', delta: dir };
    if (mod) return null;
    return { type: 'select', delta: dir };
  }
  if (e.key === 'Delete' && !mod && !e.altKey) return { type: 'delete' };
  if ((e.key === 'd' || e.key === 'D') && mod && !e.shiftKey && !e.altKey) return { type: 'duplicate' };
  return null;
}
```

- [ ] **Step 1: Write the failing tests** — `web/test/editor/geometry.test.ts`:
```ts
// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import {
  MAX_SCALE, MIN_BLOCK_PX, MIN_SCALE, blockKeyIntent, clampDuration, dropIndex, fitScale, layout, resizeDuration, snapMs,
} from '../../src/editor/timeline/geometry';

const key = (k: string, o: Partial<{ shiftKey: boolean; altKey: boolean; ctrlKey: boolean; metaKey: boolean }> = {}) =>
  blockKeyIntent({ key: k, shiftKey: false, altKey: false, ctrlKey: false, metaKey: false, ...o });

describe('snap and clamp', () => {
  it.each([[0, 0], [2_499, 0], [2_500, 5_000], [7_400, 5_000], [7_500, 10_000], [-3_000, -5_000]])('snapMs(%i) = %i', (a, b) => {
    expect(snapMs(a)).toBe(b);
  });
  it('clampDuration never goes below 5 s', () => {
    expect(clampDuration(0)).toBe(5_000);
    expect(clampDuration(-90_000)).toBe(5_000);
    expect(clampDuration(12_000)).toBe(10_000);
    expect(clampDuration(720_000)).toBe(720_000);
  });
});

describe('layout', () => {
  it('draws widths proportional to the duration and accumulates positions', () => {
    const s = layout([{ id: 'a', durationMs: 100_000 }, { id: 'b', durationMs: 200_000 }], 0.001);
    expect(s).toEqual([{ id: 'a', x: 0, w: 100 }, { id: 'b', x: 100, w: 200 }]);
  });
  it('keeps a minimum drawn width and adds the gap', () => {
    const s = layout([{ id: 'a', durationMs: 5_000 }, { id: 'b', durationMs: 100_000 }], 0.001, MIN_BLOCK_PX, 4);
    expect(s[0]).toEqual({ id: 'a', x: 0, w: MIN_BLOCK_PX });
    expect(s[1]).toEqual({ id: 'b', x: MIN_BLOCK_PX + 4, w: 100 });
  });
  it('fitScale fits the total into the width, within the zoom limits', () => {
    expect(fitScale(1_000_000, 1_000)).toBeCloseTo(0.001);
    expect(fitScale(10_000_000, 1_000)).toBe(MIN_SCALE); // 0.0001 would be below the minimum zoom
    expect(fitScale(100_000, 1_000)).toBeCloseTo(0.01);
    expect(fitScale(1_000, 100_000)).toBe(MAX_SCALE);
    expect(fitScale(0, 500)).toBe(0.02);
    expect(fitScale(500, 0)).toBe(0.02);
  });
});

describe('dropIndex (final index of the dragged block)', () => {
  // A 0-100 (centre 50) · B 100-200 (150) · C 200-300 (250)
  const equal = layout([{ id: 'A', durationMs: 100_000 }, { id: 'B', durationMs: 100_000 }, { id: 'C', durationMs: 100_000 }], 0.001);
  // A 0-100 (50) · B 100-500 (300) · C 500-600 (550)
  const wide = layout([{ id: 'A', durationMs: 100_000 }, { id: 'B', durationMs: 400_000 }, { id: 'C', durationMs: 100_000 }], 0.001);

  it('stays put until the dragged centre passes a neighbour centre', () => {
    expect(dropIndex(equal, 'A', 0)).toBe(0);
    expect(dropIndex(equal, 'A', 99)).toBe(0); // centre 149 < 150
    expect(dropIndex(equal, 'A', 101)).toBe(1); // centre 151 > 150
    expect(dropIndex(equal, 'A', 201)).toBe(2);
  });
  it('goes to the very first and very last place', () => {
    expect(dropIndex(equal, 'C', -1_000)).toBe(0);
    expect(dropIndex(equal, 'A', 1_000)).toBe(2);
  });
  it('moves a middle block both ways', () => {
    expect(dropIndex(equal, 'B', -101)).toBe(0);
    expect(dropIndex(equal, 'B', 101)).toBe(2);
    expect(dropIndex(equal, 'B', 40)).toBe(1);
  });
  it("is correct with a wide neighbour (uses the dragged block's own centre)", () => {
    expect(dropIndex(wide, 'A', 200)).toBe(0); // centre 250 < 300
    expect(dropIndex(wide, 'A', 260)).toBe(1); // centre 310 > 300
    expect(dropIndex(wide, 'C', -300)).toBe(1); // centre 250: past A (50), not past B (300)
    expect(dropIndex(wide, 'C', -240)).toBe(2); // centre 310: past B too, so C stays last
  });
  it('returns -1 for an unknown block', () => {
    expect(dropIndex(equal, 'Z', 10)).toBe(-1);
  });
});

describe('resizeDuration', () => {
  it('converts pixels to time, snaps to 5 s and clamps', () => {
    expect(resizeDuration(60_000, 50, 0.01)).toBe(65_000);
    expect(resizeDuration(60_000, 26, 0.01)).toBe(65_000); // 62 600 ms -> 65 000
    expect(resizeDuration(60_000, 24, 0.01)).toBe(60_000); // 62 400 ms -> 60 000
    expect(resizeDuration(60_000, -10_000, 0.01)).toBe(5_000);
    expect(resizeDuration(60_000, 100, 0)).toBe(60_000);
  });
});

describe('blockKeyIntent', () => {
  it('maps the documented keys', () => {
    expect(key('ArrowRight')).toEqual({ type: 'select', delta: 1 });
    expect(key('ArrowLeft')).toEqual({ type: 'select', delta: -1 });
    expect(key('ArrowRight', { altKey: true })).toEqual({ type: 'move', delta: 1 });
    expect(key('ArrowLeft', { altKey: true })).toEqual({ type: 'move', delta: -1 });
    expect(key('ArrowRight', { shiftKey: true })).toEqual({ type: 'resize', deltaMs: 5_000 });
    expect(key('ArrowLeft', { shiftKey: true })).toEqual({ type: 'resize', deltaMs: -5_000 });
    expect(key('ArrowRight', { shiftKey: true, ctrlKey: true })).toEqual({ type: 'resize', deltaMs: 60_000 });
    expect(key('ArrowLeft', { shiftKey: true, metaKey: true })).toEqual({ type: 'resize', deltaMs: -60_000 });
    expect(key('Delete')).toEqual({ type: 'delete' });
    expect(key('d', { ctrlKey: true })).toEqual({ type: 'duplicate' });
    expect(key('D', { metaKey: true })).toEqual({ type: 'duplicate' });
  });
  it('ignores everything else so the browser keeps its defaults', () => {
    expect(key('a')).toBeNull();
    expect(key('ArrowRight', { ctrlKey: true })).toBeNull();
    expect(key('Delete', { ctrlKey: true })).toBeNull();
    expect(key('d')).toBeNull();
    expect(key('Tab')).toBeNull();
  });
});
```

- [ ] **Step 2: Run, confirm FAIL.**
- [ ] **Step 3: Create `geometry.ts`; run until PASS 3 times; typecheck.**
- [ ] **Step 4: Commit** `git add web/src/editor/timeline/geometry.ts web/test/editor/geometry.test.ts` · `feat(web): timeline geometry (snap, layout, drop index, resize, key intents)`

---
### Task 6: Playlist file parsers in `shared` (JSON, CSV, M3U)

**Where it lives and why:** `shared/src/playlist/parse.ts`, pure, no DOM. The editor reads the file with `File.text()` and passes the text in, so the parsers run in the node test project and nothing travels to the server.

**Verified against the real exporter** (`src/core/PlaylistIO.cpp`, angeloruggieridj/obs-playlist-deck, read 2026-10-12):
- JSON: `{"version":1,"name":"…","items":[{"path":"…","title":"…","duration":<ms>}]}`. `duration` is **milliseconds**, `-1` = unknown; the reader also accepts floats (rounded). An entry without a non-empty string `path` is skipped, not fatal. Paths are relative to the playlist's folder when the user exported "portable".
- M3U: `#EXTM3U`, then per item `#EXTINF:<whole seconds or -1>,<title>` and the path on the next line. Durations are **truncated to whole seconds** by the exporter, so an imported M3U duration is `file_rounded`.
- CSV: header `title,path,duration_ms`; every field double-quoted, embedded `"` doubled (RFC 4180); duration unquoted integer ms. The exporter has no CSV reader, so this parser is written tolerant: header optional, `;` accepted, column names `title|name`, `path|file|filename`, `duration_ms|durationms|duration`.
- Unverifiable: how a plugin version newer than the one read writes these files. The tolerance above is the mitigation, and the editor shows the origin of every duration.

**Files:**
- Create: `shared/src/playlist/parse.ts`, `shared/test/playlist-parse.test.ts`
- Modify: `shared/src/index.ts` (add `export * from './playlist/parse';`)

**Interfaces:**
- `parsePlaylistFile(text, fileName?) → ParseResult`; `ImportedItem`, `ParsedPlaylist`, `DurationOrigin`, `fileStem`, `isAbsolutePath`, `parseCsvRows`.
- An unknown duration is `durationMs: -1, durationOrigin: 'unknown'`. It is never turned into 0 here.

`shared/src/playlist/parse.ts`:
```ts
// SPDX-License-Identifier: GPL-2.0-or-later

export type DurationOrigin = 'file' | 'file_rounded' | 'unknown';
export type PlaylistFormat = 'json' | 'csv' | 'm3u';

export interface ImportedItem {
  title: string;
  path: string;
  /** Milliseconds; -1 when the file does not say. */
  durationMs: number;
  durationOrigin: DurationOrigin;
  /** Not an absolute path or URL. Playlist Deck matches absolute paths, so such an item may not match. */
  pathIsRelative: boolean;
}

export interface ParsedPlaylist {
  format: PlaylistFormat;
  name: string | null;
  items: ImportedItem[];
  /** Entries dropped because they had no usable path. */
  skipped: number;
}

export type ParseResult =
  | { ok: true; playlist: ParsedPlaylist }
  | { ok: false; reason: 'empty' | 'unrecognised' | 'no_items' };

export function fileStem(path: string): string {
  const last = path.split(/[\\/]/).pop() ?? path;
  const dot = last.lastIndexOf('.');
  return dot > 0 ? last.slice(0, dot) : last;
}

export function isAbsolutePath(p: string): boolean {
  return /^[a-zA-Z]:[\\/]/.test(p) || p.startsWith('/') || p.startsWith('\\\\') || /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(p);
}

function makeItem(title: string, path: string, durationMs: number, durationOrigin: DurationOrigin): ImportedItem {
  const t = title.trim();
  return {
    title: t === '' ? fileStem(path) : t,
    path,
    durationMs,
    durationOrigin: durationMs < 0 ? 'unknown' : durationOrigin,
    pathIsRelative: !isAbsolutePath(path),
  };
}

function msFrom(value: unknown): number {
  const n = typeof value === 'string' && /^\s*-?\d+(\.\d+)?\s*$/.test(value) ? Number(value) : value;
  return typeof n === 'number' && Number.isFinite(n) && n >= 0 ? Math.round(n) : -1;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

function parseJson(text: string): ParsedPlaylist | null {
  let root: unknown;
  try {
    root = JSON.parse(text);
  } catch {
    return null;
  }
  const raw = Array.isArray(root) ? root : isRecord(root) && Array.isArray(root.items) ? root.items : null;
  if (raw === null) return null;
  const name = isRecord(root) && typeof root.name === 'string' && root.name.trim() !== '' ? root.name.trim() : null;
  const items: ImportedItem[] = [];
  let skipped = 0;
  for (const e of raw) {
    if (!isRecord(e) || typeof e.path !== 'string' || e.path.trim() === '') {
      skipped++;
      continue;
    }
    const title = typeof e.title === 'string' ? e.title : '';
    items.push(makeItem(title, e.path, msFrom(e.duration ?? e.duration_ms ?? e.durationMs), 'file'));
  }
  return { format: 'json', name, items, skipped };
}

function parseM3u(text: string): ParsedPlaylist {
  const items: ImportedItem[] = [];
  let title = '';
  let ms = -1;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === '') continue;
    if (line.startsWith('#EXTINF:')) {
      const rest = line.slice('#EXTINF:'.length);
      const comma = rest.indexOf(',');
      const secs = Number.parseFloat(comma < 0 ? rest : rest.slice(0, comma));
      ms = Number.isFinite(secs) && secs >= 0 ? Math.round(secs * 1000) : -1;
      title = comma < 0 ? '' : rest.slice(comma + 1);
      continue;
    }
    if (line.startsWith('#')) continue;
    items.push(makeItem(title, line, ms, 'file_rounded'));
    title = '';
    ms = -1;
  }
  return { format: 'm3u', name: null, items, skipped: 0 };
}

/** RFC 4180 rows: quoted cells may hold the delimiter, doubled quotes and line breaks. Blank lines are dropped. */
export function parseCsvRows(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += c;
      continue;
    }
    if (c === '"' && cell === '') {
      quoted = true;
    } else if (c === delimiter) {
      row.push(cell);
      cell = '';
    } else if (c === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else if (c !== '\r') cell += c;
  }
  if (cell !== '' || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => !(r.length === 1 && r[0]!.trim() === ''));
}

const TITLE_COLS = ['title', 'name'];
const PATH_COLS = ['path', 'file', 'filename'];
const DURATION_COLS = ['duration_ms', 'durationms', 'duration'];

function parseCsv(text: string): ParsedPlaylist | null {
  const firstLine = text.split(/\r?\n/, 1)[0]!;
  const delimiter = firstLine.includes(';') && !firstLine.includes(',') ? ';' : ',';
  const rows = parseCsvRows(text, delimiter);
  if (rows.length === 0) return null;
  const head = rows[0]!.map((c) => c.trim().toLowerCase());
  const col = (names: string[]) => head.findIndex((h) => names.includes(h));
  const hasHeader = col(PATH_COLS) >= 0;
  let titleCol = 0;
  let pathCol = 1;
  let durCol = 2;
  let body = rows;
  if (hasHeader) {
    titleCol = col(TITLE_COLS);
    pathCol = col(PATH_COLS);
    durCol = col(DURATION_COLS);
    body = rows.slice(1);
  } else if (rows[0]!.length < 2) {
    return null; // a single headerless column is not recognisable as a playlist
  }
  const items: ImportedItem[] = [];
  let skipped = 0;
  for (const r of body) {
    const path = (r[pathCol] ?? '').trim();
    if (path === '') {
      skipped++;
      continue;
    }
    const title = titleCol >= 0 ? (r[titleCol] ?? '') : '';
    items.push(makeItem(title, path, durCol >= 0 ? msFrom(r[durCol]) : -1, 'file'));
  }
  return { format: 'csv', name: null, items, skipped };
}

export function parsePlaylistFile(input: string, fileName = ''): ParseResult {
  const text = input.replace(/^\uFEFF/, '').trim();
  if (text === '') return { ok: false, reason: 'empty' };
  let parsed: ParsedPlaylist | null;
  if (text.startsWith('{') || text.startsWith('[')) parsed = parseJson(text);
  else if (/^#EXT(M3U|INF)/i.test(text) || /\.m3u8?$/i.test(fileName)) parsed = parseM3u(text);
  else parsed = parseCsv(text);
  if (parsed === null) return { ok: false, reason: 'unrecognised' };
  if (parsed.items.length === 0) return { ok: false, reason: 'no_items' };
  return { ok: true, playlist: parsed };
}
```

- [ ] **Step 1: Write the failing tests** — `shared/test/playlist-parse.test.ts`:
```ts
// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import { fileStem, isAbsolutePath, parseCsvRows, parsePlaylistFile, type ParsedPlaylist } from '../src/index';

function ok(text: string, name?: string): ParsedPlaylist {
  const r = parsePlaylistFile(text, name);
  if (!r.ok) throw new Error(`not ok: ${r.reason}`);
  return r.playlist;
}

describe('helpers', () => {
  it('fileStem', () => {
    expect(fileStem('D:\\media\\Servizio 1.mp4')).toBe('Servizio 1');
    expect(fileStem('/a/b/c.tar.gz')).toBe('c.tar');
    expect(fileStem('.hidden')).toBe('.hidden');
    expect(fileStem('noext')).toBe('noext');
  });
  it('isAbsolutePath', () => {
    for (const p of ['D:\\a.mp4', 'c:/a.mp4', '/mnt/a.mp4', '\\\\nas\\share\\a.mp4', 'http://x/a.mp4']) expect(isAbsolutePath(p), p).toBe(true);
    for (const p of ['a.mp4', 'media/a.mp4', '..\\a.mp4', './a.mp4']) expect(isAbsolutePath(p), p).toBe(false);
  });
});

describe('JSON (as Playlist Deck exports it)', () => {
  const exported = JSON.stringify({
    version: 1,
    name: 'Puntata del 12/10',
    items: [
      { path: 'D:/media/servizio1.mp4', title: 'Servizio 1', duration: 185000 },
      { path: 'D:/media/servizio2.mp4', title: '', duration: -1 },
      { path: 'D:/media/servizio3.mp4', title: 'Float', duration: 61234.6 },
    ],
  });
  it('reads name, titles and millisecond durations; -1 stays unknown', () => {
    const p = ok(exported);
    expect(p.format).toBe('json');
    expect(p.name).toBe('Puntata del 12/10');
    expect(p.items.map((i) => [i.title, i.durationMs, i.durationOrigin])).toEqual([
      ['Servizio 1', 185000, 'file'],
      ['servizio2', -1, 'unknown'],
      ['Float', 61235, 'file'],
    ]);
    expect(p.skipped).toBe(0);
  });
  it('skips an entry without a path and keeps the rest', () => {
    const p = ok(JSON.stringify({ items: [{ title: 'x' }, { path: '' }, 7, { path: 'a.mp4' }] }));
    expect(p.items.map((i) => i.path)).toEqual(['a.mp4']);
    expect(p.skipped).toBe(3);
  });
  it('flags relative paths and accepts a top-level array and a BOM', () => {
    const p = ok('\uFEFF' + JSON.stringify([{ path: 'media/a.mp4', duration: 1000 }, { path: 'D:/b.mp4' }]));
    expect(p.items.map((i) => i.pathIsRelative)).toEqual([true, false]);
    expect(p.items[1]!.durationMs).toBe(-1);
  });
  it('is unrecognised when it is JSON without items', () => {
    expect(parsePlaylistFile('{"a":1}')).toEqual({ ok: false, reason: 'unrecognised' });
    expect(parsePlaylistFile('{broken')).toEqual({ ok: false, reason: 'unrecognised' });
  });
});

describe('M3U (as Playlist Deck exports it)', () => {
  const m3u = '#EXTM3U\r\n#EXTINF:185,Servizio 1\r\nD:\\media\\servizio1.mp4\r\n#EXTINF:-1,Senza durata\r\nD:\\media\\x.mp4\r\nD:\\media\\bare.mp4\r\n# a comment\r\n';
  it('reads whole-second durations as file_rounded, -1 as unknown, and titles from EXTINF or the file name', () => {
    const p = ok(m3u);
    expect(p.format).toBe('m3u');
    expect(p.items.map((i) => [i.title, i.durationMs, i.durationOrigin])).toEqual([
      ['Servizio 1', 185000, 'file_rounded'],
      ['Senza durata', -1, 'unknown'],
      ['bare', -1, 'unknown'],
    ]);
  });
  it('detects M3U by file name even without the header line', () => {
    expect(ok('D:\\a.mp4\nD:\\b.mp4\n', 'list.m3u8').items).toHaveLength(2);
  });
  it('an EXTINF applies to the next path only', () => {
    const p = ok('#EXTM3U\n#EXTINF:10,A\na.mp4\nb.mp4\n');
    expect(p.items.map((i) => [i.title, i.durationMs])).toEqual([['A', 10000], ['b', -1]]);
  });
});

describe('CSV (title,path,duration_ms)', () => {
  const csv = '"title","path","duration_ms"\n"Servizio ""uno"", il ritorno","D:/media/s1.mp4",185000\n"Due","D:/media/s2.mp4",-1\n';
  it('reads quoted fields with commas and doubled quotes', () => {
    const p = ok(csv);
    expect(p.format).toBe('csv');
    expect(p.items.map((i) => [i.title, i.path, i.durationMs])).toEqual([
      ['Servizio "uno", il ritorno', 'D:/media/s1.mp4', 185000],
      ['Due', 'D:/media/s2.mp4', -1],
    ]);
    expect(p.items[1]!.durationOrigin).toBe('unknown');
  });
  it('handles a line break inside a quoted title', () => {
    expect(ok('title,path,duration_ms\n"A\nB","x.mp4",1000\n').items[0]!.title).toBe('A\nB');
  });
  it('accepts a semicolon delimiter and reordered, differently named columns', () => {
    const p = ok('File;Duration;Name\nD:/a.mp4;5000;Alfa\n');
    expect(p.items[0]).toMatchObject({ title: 'Alfa', path: 'D:/a.mp4', durationMs: 5000 });
  });
  it('works without a header when there are at least two columns', () => {
    const p = ok('Alfa,D:/a.mp4,7000\nBeta,D:/b.mp4\n');
    expect(p.items.map((i) => [i.title, i.durationMs])).toEqual([['Alfa', 7000], ['Beta', -1]]);
  });
  it('does not guess a single headerless column; a header with only paths works', () => {
    expect(parsePlaylistFile('hello\nworld')).toEqual({ ok: false, reason: 'unrecognised' });
    expect(ok('path\nD:/a.mp4\n').items[0]).toMatchObject({ title: 'a', durationMs: -1 });
  });
  it('counts rows without a path as skipped', () => {
    const p = ok('title,path,duration_ms\nA,,1000\nB,b.mp4,2000\n');
    expect(p.skipped).toBe(1);
    expect(p.items).toHaveLength(1);
  });
  it('parseCsvRows drops blank lines and handles CRLF', () => {
    expect(parseCsvRows('a,b\r\n\r\nc,"d,e"\r\n', ',')).toEqual([['a', 'b'], ['c', 'd,e']]);
  });
});

describe('failure cases', () => {
  it('reports empty and no_items', () => {
    expect(parsePlaylistFile('  \n ')).toEqual({ ok: false, reason: 'empty' });
    expect(parsePlaylistFile('{"items":[]}')).toEqual({ ok: false, reason: 'no_items' });
    expect(parsePlaylistFile('#EXTM3U\n')).toEqual({ ok: false, reason: 'no_items' });
  });
  it('never turns an unknown duration into zero', () => {
    for (const text of ['{"items":[{"path":"a"}]}', '#EXTM3U\na', 'path\na']) {
      expect(ok(text).items[0]).toMatchObject({ durationMs: -1, durationOrigin: 'unknown' });
    }
  });
});
```
- [ ] **Step 2: Run, confirm FAIL.** `pnpm vitest run shared/test/playlist-parse.test.ts`.
- [ ] **Step 3: Create `parse.ts`, add the export to `shared/src/index.ts`, run until PASS 3 times; `pnpm typecheck`.**
- [ ] **Step 4: Commit** `git add shared/src/playlist shared/src/index.ts shared/test/playlist-parse.test.ts` · `feat(shared): playlist file parsers for JSON, CSV and M3U as Playlist Deck exports them`

---

### Task 7: Import placement — candidates to media elements (pure)

**Files:**
- Create: `web/src/editor/import/place.ts`, `web/test/editor/place.test.ts`

**Interfaces:**
- `Candidate` (deck item or file item), `withOccurrences`, `existingKeys`, `toMedia`, `planPlacement(doc, items, mode)`, `importEdit(plan)`; `PlacementMode = { kind: 'append', blockId } | { kind: 'sequence' }`.
- **Placement rules (simple and explicit):**
  1. **Append to a chosen studio block** (`append`): all new items go to the end of that block's elements, in playlist order.
  2. **Fill in sequence** (`sequence`): studio blocks in order. An item goes into the current block while `media already in the block + item duration ≤ block duration − preset.warnMs` (so the block keeps its warning-threshold of studio time); otherwise the next studio block is tried. The last studio block takes everything left (the validation panel then shows the error). An unknown duration counts as 0 here.
  3. **No duplicates:** an item whose `path#occurrence` already exists anywhere in the rundown is skipped and counted. Applying a plan re-checks at apply time, so a stale plan applied twice adds nothing the second time.
  4. **Unknown duration:** `plannedDurationMs: 0`, `durationSource: 'unknown'`.
  5. The whole import is **one** undo step (`import_media`).

`web/src/editor/import/place.ts`:
```ts
// SPDX-License-Identifier: GPL-2.0-or-later
import type { MediaElement, Rundown, StudioBlock } from '@olc/shared';
import { addMedia, type RundownDoc } from '../model/ops';
import type { Edit } from '../store/document-store';

export interface Candidate {
  title: string;
  path: string;
  /** Position among the playlist items sharing this path (the deck gives it; files: `withOccurrences`). */
  occurrence: number;
  /** -1 = unknown. */
  durationMs: number;
  origin: 'deck' | 'file' | 'file_rounded' | 'unknown';
}

export type PlacementMode = { kind: 'append'; blockId: string } | { kind: 'sequence' };

export interface PlannedAdd {
  blockId: string;
  media: Omit<MediaElement, 'id'>;
}

export interface PlacementPlan {
  adds: PlannedAdd[];
  skippedExisting: number;
  unknownDuration: number;
  error: 'no_studio_block' | 'not_a_studio_block' | null;
}

export const mediaKey = (path: string, occurrence: number): string => `${path}#${occurrence}`;

/** Adds the 0-based count of earlier items with the same path (what the deck reports as `occurrence`). */
export function withOccurrences<T extends { path: string }>(items: readonly T[]): Array<T & { occurrence: number }> {
  const seen = new Map<string, number>();
  return items.map((item) => {
    const occurrence = seen.get(item.path) ?? 0;
    seen.set(item.path, occurrence + 1);
    return { ...item, occurrence };
  });
}

export function existingKeys(doc: Pick<Rundown, 'blocks'>): Set<string> {
  const keys = new Set<string>();
  for (const b of doc.blocks) {
    if (b.kind !== 'studio') continue;
    for (const e of b.elements) if (e.kind === 'media') keys.add(mediaKey(e.path, e.occurrence));
  }
  return keys;
}

export function toMedia(c: Candidate): Omit<MediaElement, 'id'> {
  const known = c.durationMs >= 0 && c.origin !== 'unknown';
  return {
    kind: 'media',
    title: c.title.slice(0, 200),
    path: c.path,
    occurrence: c.occurrence,
    plannedDurationMs: known ? Math.round(c.durationMs) : 0,
    durationSource: known ? c.origin : 'unknown',
  };
}

const mediaMs = (b: StudioBlock) => b.elements.reduce((t, e) => (e.kind === 'media' ? t + e.plannedDurationMs : t), 0);

export function planPlacement(doc: Pick<Rundown, 'blocks' | 'preset'>, items: readonly Candidate[], mode: PlacementMode): PlacementPlan {
  const studios = doc.blocks.filter((b): b is StudioBlock => b.kind === 'studio');
  const empty = (error: PlacementPlan['error']): PlacementPlan => ({ adds: [], skippedExisting: 0, unknownDuration: 0, error });
  if (studios.length === 0) return empty('no_studio_block');
  if (mode.kind === 'append' && !studios.some((b) => b.id === mode.blockId)) return empty('not_a_studio_block');

  const taken = existingKeys(doc);
  const fresh: Candidate[] = [];
  let skippedExisting = 0;
  for (const c of items) {
    const key = mediaKey(c.path, c.occurrence);
    if (taken.has(key)) {
      skippedExisting++;
      continue;
    }
    taken.add(key);
    fresh.push(c);
  }

  const adds: PlannedAdd[] = [];
  if (mode.kind === 'append') {
    for (const c of fresh) adds.push({ blockId: mode.blockId, media: toMedia(c) });
  } else {
    const used = studios.map(mediaMs);
    let bi = 0;
    for (const c of fresh) {
      const dur = Math.max(0, c.durationMs);
      while (bi < studios.length - 1 && used[bi]! + dur > studios[bi]!.durationMs - doc.preset.warnMs) bi++;
      adds.push({ blockId: studios[bi]!.id, media: toMedia(c) });
      used[bi]! += dur;
    }
  }
  return { adds, skippedExisting, unknownDuration: fresh.filter((c) => c.durationMs < 0 || c.origin === 'unknown').length, error: null };
}

/** One undo step. Re-checks every add against the document it is applied to, so a stale plan cannot duplicate. */
export function importEdit<D extends RundownDoc>(plan: PlacementPlan): Edit<D> {
  return {
    label: 'import_media',
    apply: (doc) =>
      plan.adds.reduce<D>((d, a) => {
        if (existingKeys(d).has(mediaKey(a.media.path, a.media.occurrence))) return d;
        return addMedia<D>(a.blockId, a.media).apply(d);
      }, doc),
  };
}
```

- [ ] **Step 1: Write the failing tests** — `web/test/editor/place.test.ts`:
```ts
// SPDX-License-Identifier: GPL-2.0-or-later
import { validateRundown, type Block, type StudioBlock } from '@olc/shared';
import { soloFutsalFormat } from '@olc/shared/testing';
import { describe, expect, it } from 'vitest';
import { type Candidate, existingKeys, importEdit, planPlacement, toMedia, withOccurrences } from '../../src/editor/import/place';
import { DocumentStore } from '../../src/editor/store/document-store';

const cand = (path: string, durationMs: number, over: Partial<Candidate> = {}): Candidate => ({
  title: path, path, occurrence: 0, durationMs, origin: durationMs < 0 ? 'unknown' : 'deck', ...over,
});
const media = (d: { blocks: Block[] }, blockId: string) =>
  (d.blocks.find((b) => b.id === blockId) as StudioBlock).elements.filter((e) => e.kind === 'media');

describe('withOccurrences / toMedia', () => {
  it('counts earlier items with the same path', () => {
    expect(withOccurrences([{ path: 'a' }, { path: 'b' }, { path: 'a' }, { path: 'a' }]).map((i) => i.occurrence)).toEqual([0, 0, 1, 2]);
  });
  it('keeps a known duration with its origin and marks an unknown one', () => {
    expect(toMedia(cand('a.mp4', 90_000))).toMatchObject({ plannedDurationMs: 90_000, durationSource: 'deck' });
    expect(toMedia(cand('a.mp4', 90_000, { origin: 'file_rounded' })).durationSource).toBe('file_rounded');
    expect(toMedia(cand('a.mp4', -1))).toMatchObject({ plannedDurationMs: 0, durationSource: 'unknown' });
  });
});

describe('append', () => {
  it('adds the new items at the end of the chosen block, in order', () => {
    const f = soloFutsalFormat();
    const plan = planPlacement(f, [cand('D:/n1.mp4', 30_000), cand('D:/n2.mp4', 40_000)], { kind: 'append', blockId: 'b3' });
    expect(plan).toMatchObject({ skippedExisting: 0, unknownDuration: 0, error: null });
    const g = importEdit(plan).apply(f);
    expect(media(g, 'b3').map((e) => (e as { path: string }).path)).toEqual(['D:/n1.mp4', 'D:/n2.mp4']);
  });
  it('rejects a break block or an unknown block', () => {
    const f = soloFutsalFormat();
    expect(planPlacement(f, [cand('x', 1)], { kind: 'append', blockId: 'br1' }).error).toBe('not_a_studio_block');
    expect(planPlacement(f, [cand('x', 1)], { kind: 'append', blockId: 'zz' }).error).toBe('not_a_studio_block');
  });
  it('reports a rundown with no studio block', () => {
    const f = soloFutsalFormat();
    f.blocks = f.blocks.filter((b) => b.kind === 'break');
    expect(planPlacement(f, [cand('x', 1)], { kind: 'append', blockId: 'br1' }).error).toBe('no_studio_block');
  });
});

describe('importing twice (Review Focus 4)', () => {
  it('skips what is already in the rundown and counts it', () => {
    const f = soloFutsalFormat();
    const items = [cand('D:/media/servizio1.mp4', 180_000), cand('D:/new.mp4', 10_000)]; // the first one is already in b1
    const plan = planPlacement(f, items, { kind: 'append', blockId: 'b3' });
    expect(plan.skippedExisting).toBe(1);
    expect(plan.adds).toHaveLength(1);
  });
  it('importing the same items twice adds nothing the second time', () => {
    const store = new DocumentStore(soloFutsalFormat());
    const items = [cand('D:/n1.mp4', 30_000), cand('D:/n1.mp4', 30_000, { occurrence: 1 })];
    for (let i = 0; i < 2; i++) {
      const plan = planPlacement(store.getSnapshot().doc, items, { kind: 'append', blockId: 'b3' });
      store.edit(importEdit(plan));
    }
    expect(media(store.getSnapshot().doc, 'b3')).toHaveLength(2);
  });
  it('a stale plan applied twice still adds nothing the second time', () => {
    const f = soloFutsalFormat();
    const plan = planPlacement(f, [cand('D:/n1.mp4', 30_000)], { kind: 'append', blockId: 'b3' });
    const once = importEdit(plan).apply(f);
    const twice = importEdit(plan).apply(once);
    expect(media(twice, 'b3')).toHaveLength(1);
    expect(twice).toBe(once);
  });
  it('the same path with another occurrence is a different item', () => {
    const f = soloFutsalFormat();
    const plan = planPlacement(f, [cand('D:/media/servizio1.mp4', 180_000, { occurrence: 1 })], { kind: 'append', blockId: 'b3' });
    expect(plan.adds).toHaveLength(1);
    expect([...existingKeys(f)]).toContain('D:/media/servizio1.mp4#0');
  });
  it('the whole import is one undo step', () => {
    const store = new DocumentStore(soloFutsalFormat());
    const before = store.getSnapshot().doc;
    store.edit(importEdit(planPlacement(before, [cand('a', 1_000), cand('b', 1_000), cand('c', 1_000)], { kind: 'append', blockId: 'b3' })));
    expect(media(store.getSnapshot().doc, 'b3')).toHaveLength(3);
    store.undo();
    expect(store.getSnapshot().doc).toBe(before);
  });
});

describe('sequence', () => {
  // warnMs 60 000. b1 (720 s, 180 s media) -> room 720-60-180 = 480 s. b2 (600 s, 120 s) -> 420 s. b3 (120 s, 0) -> 60 s.
  it('fills the studio blocks in order, keeping the warning threshold of studio time', () => {
    const f = soloFutsalFormat();
    const items = [cand('a', 400_000), cand('b', 100_000), cand('c', 400_000), cand('d', 50_000), cand('e', 50_000)];
    const plan = planPlacement(f, items, { kind: 'sequence' });
    // a: 180+400=580 <= 660 -> b1 ; b: 580+100=680 > 660 -> b2 (120+100=220 <= 540) ; c: 220+400=620 > 540 -> b3 (0+400 > 60 but last) ;
    // d: b3 (last block takes the rest) ; e: b3
    expect(plan.adds.map((a) => [a.media.path, a.blockId])).toEqual([['a', 'b1'], ['b', 'b2'], ['c', 'b3'], ['d', 'b3'], ['e', 'b3']]);
  });
  it('lets the last block take the overflow, which validation then reports as an error', () => {
    const f = soloFutsalFormat();
    const g = importEdit(planPlacement(f, [cand('big', 900_000)], { kind: 'sequence' })).apply(f);
    expect(validateRundown(g).some((i) => i.code === 'media_exceeds_block' && i.blockId === 'b3')).toBe(true);
  });
  it('counts an unknown duration as zero for placement and reports it', () => {
    const f = soloFutsalFormat();
    const plan = planPlacement(f, [cand('u', -1)], { kind: 'sequence' });
    expect(plan.unknownDuration).toBe(1);
    expect(plan.adds[0]).toMatchObject({ blockId: 'b1', media: { plannedDurationMs: 0, durationSource: 'unknown' } });
  });
});

describe('result validity', () => {
  it('produces unique element ids and keeps the origin of every duration', () => {
    const f = soloFutsalFormat();
    const g = importEdit(planPlacement(f, [cand('a', 1_000), cand('b', -1, { origin: 'unknown' })], { kind: 'append', blockId: 'b3' })).apply(f);
    const ids = g.blocks.flatMap((b) => (b.kind === 'studio' ? b.elements.map((e) => e.id) : []));
    expect(new Set(ids).size).toBe(ids.length);
    expect(media(g, 'b3').map((e) => (e as { durationSource: string }).durationSource)).toEqual(['deck', 'unknown']);
    expect(validateRundown(g).some((i) => i.code === 'duplicate_id')).toBe(false);
  });
});
```
(`media_duration_unknown` in `validateRundown` is Task 2; this test does not depend on it.)

- [ ] **Step 2: Run, confirm FAIL. Step 3: Create `place.ts`; PASS 3 times; typecheck. Step 4: Commit** `git add web/src/editor/import/place.ts web/test/editor/place.test.ts` · `feat(web): import placement with duplicate guard and single undo step`

---
### Task 8: API client, editor session, hooks and test support

**Files:**
- Create: `web/src/editor/api/editor-api.ts`, `web/src/editor/session/{session.ts,selection.ts,context.tsx}`, `web/test/support/editor.tsx`, `web/test/editor/editor-api.test.ts`, `web/test/editor/session.test.ts`

**Interfaces (every later UI task uses exactly these):**
- `EditorApi` and `httpEditorApi(fetchFn?)`; `DocRef`, `DocKind`, `EditorDoc = Format | Episode`; `LiveStatus`, `DeckItemDto`, `DeckResult`, `ObsCheckResult`, `NewEpisodeBody`; `RundownInvalidError extends ApiError { issues }`.
- `EditorSession`: `store: DocumentStore<EditorDoc | null>`, `autosave: Autosave<EditorDoc | null>`, `selection: SelectionStore`, `api`, `getSnapshot()` / `subscribe()` of a `SessionSnapshot`, `open(ref, {discard?}) → Promise<boolean>`, `apply(edit)`, `undo()`, `redo()`, `seal()`, `refreshLive()`, `checkExternal()`, `takeTheirs()`, `keepMine()`, `forget()`, `loadForLive(episodeId) → LoadResult`, `dispose()`.
- `EditorProvider({ session, lang, children })` and hooks `useSession()`, `useDoc()` (the document or `null`), `useStore()` (the full `StoreSnapshot`), `useSaveState()`, `useSessionSnapshot()`, `useSelection()`, `useEditorT()`.
- Test support: `FakeEditorApi`, `sampleFormat()`, `sampleEpisode()`, `renderWithSession(ui, opts)`.

`web/src/editor/api/editor-api.ts`:
```ts
// SPDX-License-Identifier: GPL-2.0-or-later
import { Episode, Format } from '@olc/shared';
import { z } from 'zod';
import { ApiError } from '../../core/http';

export type DocKind = 'format' | 'episode';
export type EditorDoc = Format | Episode;
export interface DocRef {
  kind: DocKind;
  id: string;
}

export interface NewEpisodeBody {
  id: string;
  date: string; // YYYY-MM-DD
  plannedStart: string | null; // ISO 8601 with offset
  playlistName: string | null;
}

export interface LiveStatus {
  episodeId: string | null;
  phase: 'preshow' | 'live' | 'ended' | null;
}

export interface DeckItemDto {
  index: number;
  path: string;
  title: string;
  durationMs: number; // -1 = unknown
  occurrence: number;
}

export type DeckResult =
  | { state: 'ok'; items: DeckItemDto[] }
  | { state: 'unavailable'; reason: 'obs_not_connected' | 'deck_absent' | 'deck_not_ready' };

export interface CheckIssue {
  severity: 'error' | 'warning';
  code: string;
  blockId: string | null;
  message: string;
}

export interface ObsCheckResult {
  connected: boolean;
  obsWebSocketVersion: string | null;
  deck: { capability: 'absent' | 'legacy' | 'events' } | null;
  issues: CheckIssue[];
}

/** 409 `rundown_invalid` from `POST /api/live/load`: the server refuses a rundown with errors. */
export class RundownInvalidError extends ApiError {
  constructor(readonly issues: CheckIssue[]) {
    super(409, 'rundown_invalid');
  }
}

export interface EditorApi {
  listFormats(): Promise<Format[]>;
  listEpisodes(): Promise<Episode[]>;
  getDoc(ref: DocRef): Promise<EditorDoc>;
  /** POST. Throws `ApiError(409, 'exists')` when the id is taken. */
  createFormat(format: Format): Promise<Format>;
  /** PUT = upsert (the autosave). Throws `ApiError(409, 'episode_live')` for a live episode. */
  putDoc(doc: EditorDoc, kind: DocKind): Promise<EditorDoc>;
  /** Throws `ApiError(409, 'episode_loaded')` for the loaded episode. */
  deleteDoc(ref: DocRef): Promise<void>;
  createEpisode(formatId: string, body: NewEpisodeBody): Promise<Episode>;
  liveStatus(): Promise<LiveStatus>;
  /** Throws `RundownInvalidError` (409), `ApiError(409, 'live_running')`, `ApiError(404, 'not_found')`. */
  loadLive(episodeId: string): Promise<void>;
  /** `null` when OBS is not connected. */
  obsScenes(): Promise<string[] | null>;
  deckItems(): Promise<DeckResult>;
  checkObs(episodeId: string): Promise<ObsCheckResult>;
}

const LiveStatusSchema = z.object({
  episodeId: z.string().nullable(),
  phase: z.enum(['preshow', 'live', 'ended']).nullable(),
});
const DeckSchema = z.object({
  items: z.array(z.object({ index: z.number(), path: z.string(), title: z.string(), durationMs: z.number(), occurrence: z.number() })),
});
const CheckSchema = z.object({
  connected: z.boolean(),
  obsWebSocketVersion: z.string().nullable(),
  deck: z.object({ capability: z.enum(['absent', 'legacy', 'events']) }).nullable(),
  issues: z.array(z.object({ severity: z.enum(['error', 'warning']), code: z.string(), blockId: z.string().nullable(), message: z.string() })),
});

async function failure(res: Response): Promise<ApiError> {
  let code = `http_${res.status}`;
  let body: { error?: unknown; issues?: unknown } = {};
  try {
    body = (await res.json()) as typeof body;
    if (typeof body.error === 'string') code = body.error;
  } catch {
    // not JSON: keep the status code
  }
  if (res.status === 409 && code === 'rundown_invalid') {
    const parsed = CheckSchema.shape.issues.safeParse(body.issues);
    return new RundownInvalidError(parsed.success ? parsed.data : []);
  }
  return new ApiError(res.status, code);
}

const JSON_HEADERS = { 'content-type': 'application/json' };
const base = (kind: DocKind) => (kind === 'format' ? '/api/formats' : '/api/episodes');

export function httpEditorApi(fetchFn: typeof fetch = (input, init) => fetch(input, init)): EditorApi {
  async function json<T>(res: Response, parse: (v: unknown) => T): Promise<T> {
    if (!res.ok) throw await failure(res);
    return parse(await res.json());
  }
  return {
    async listFormats() {
      return json(await fetchFn('/api/formats'), (v) => z.array(Format).parse(v));
    },
    async listEpisodes() {
      return json(await fetchFn('/api/episodes'), (v) => z.array(Episode).parse(v));
    },
    async getDoc(ref) {
      const schema = ref.kind === 'format' ? Format : Episode;
      return json(await fetchFn(`${base(ref.kind)}/${encodeURIComponent(ref.id)}`), (v) => schema.parse(v));
    },
    async createFormat(format) {
      return json(await fetchFn('/api/formats', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(format) }), (v) => Format.parse(v));
    },
    async putDoc(doc, kind) {
      const schema = kind === 'format' ? Format : Episode;
      const res = await fetchFn(`${base(kind)}/${encodeURIComponent(doc.id)}`, { method: 'PUT', headers: JSON_HEADERS, body: JSON.stringify(doc) });
      return json(res, (v) => schema.parse(v));
    },
    async deleteDoc(ref) {
      const res = await fetchFn(`${base(ref.kind)}/${encodeURIComponent(ref.id)}`, { method: 'DELETE' });
      if (!res.ok) throw await failure(res);
    },
    async createEpisode(formatId, body) {
      const res = await fetchFn(`/api/formats/${encodeURIComponent(formatId)}/episodes`, { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(body) });
      return json(res, (v) => Episode.parse(v));
    },
    async liveStatus() {
      return json(await fetchFn('/api/live/status'), (v) => LiveStatusSchema.parse(v));
    },
    async loadLive(episodeId) {
      const res = await fetchFn('/api/live/load', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ episodeId }) });
      if (!res.ok) throw await failure(res);
    },
    async obsScenes() {
      const res = await fetchFn('/api/obs/scenes');
      if (res.status === 409) return null;
      return json(res, (v) => z.object({ scenes: z.array(z.string()) }).parse(v).scenes);
    },
    async deckItems(): Promise<DeckResult> {
      const res = await fetchFn('/api/deck/items');
      if (res.ok) return { state: 'ok', items: DeckSchema.parse(await res.json()).items };
      const err = await failure(res);
      if (err.code === 'obs_not_connected' || err.code === 'deck_absent' || err.code === 'deck_not_ready') {
        return { state: 'unavailable', reason: err.code };
      }
      throw err;
    },
    async checkObs(episodeId) {
      const res = await fetchFn('/api/obs/check', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ episodeId }) });
      return json(res, (v) => CheckSchema.parse(v));
    },
  };
}
```

`web/src/editor/session/selection.ts`:
```ts
// SPDX-License-Identifier: GPL-2.0-or-later

export interface SelectionSnapshot {
  blockId: string | null;
  /** Increments each time something asks to bring the selection into view (validation click-to-focus). */
  revealTick: number;
}

export class SelectionStore {
  private snap: SelectionSnapshot = { blockId: null, revealTick: 0 };
  private readonly listeners = new Set<() => void>();

  getSnapshot = (): SelectionSnapshot => this.snap;

  subscribe = (l: () => void): (() => void) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };

  select(blockId: string | null, opts: { reveal?: boolean } = {}): void {
    const revealTick = opts.reveal === true ? this.snap.revealTick + 1 : this.snap.revealTick;
    if (blockId === this.snap.blockId && revealTick === this.snap.revealTick) return;
    this.snap = { blockId, revealTick };
    for (const l of [...this.listeners]) l();
  }
}
```

`web/src/editor/session/session.ts`:
```ts
// SPDX-License-Identifier: GPL-2.0-or-later
import { ApiError } from '../../core/http';
import { RundownInvalidError, type CheckIssue, type DocRef, type EditorApi, type EditorDoc, type LiveStatus } from '../api/editor-api';
import { Autosave, SaveError, type AutosaveOptions, type Timers } from '../store/autosave';
import { DocumentStore, type Edit } from '../store/document-store';
import { SelectionStore } from './selection';

export interface SessionSnapshot {
  ref: DocRef | null;
  phase: 'idle' | 'loading' | 'ready' | 'error';
  /** Error code when phase is 'error'. */
  error: string | null;
  /** 'live': the episode is on air; the store is read-only (SPEC §18.7). */
  lock: 'live' | null;
  live: LiveStatus | null;
  /** The server copy changed while this copy has unsaved edits. The director chooses. */
  conflict: EditorDoc | null;
  /** Counts silent refreshes of a clean copy from a newer server copy. */
  refreshed: number;
  /** open() was refused because the open document has unsaved changes. */
  blocked: boolean;
}

export type LoadResult =
  | { ok: true }
  /** 'unsaved': the open episode could not be saved, so loading would load an older copy. */
  | { ok: false; reason: 'unsaved' | 'invalid' | 'network' | string; issues?: CheckIssue[] };

export const browserTimers: Timers = {
  set(fn, ms) {
    const id = setTimeout(fn, ms);
    return () => clearTimeout(id);
  },
  now: () => Date.now(),
};

/** JSON with sorted keys: two documents with the same content compare equal whatever their key order. */
export function stableStringify(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(',')}]`;
  if (v !== null && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o).sort().map((k) => `${JSON.stringify(k)}:${stableStringify(o[k])}`).join(',')}}`;
  }
  return JSON.stringify(v);
}

const firstBlockId = (doc: EditorDoc): string | null => doc.blocks[0]?.id ?? null;

export class EditorSession {
  readonly store = new DocumentStore<EditorDoc | null>(null);
  readonly selection = new SelectionStore();
  readonly autosave: Autosave<EditorDoc | null>;
  private snap: SessionSnapshot = { ref: null, phase: 'idle', error: null, lock: null, live: null, conflict: null, refreshed: 0, blocked: false };
  private readonly listeners = new Set<() => void>();
  /** The document as the server last confirmed it (loaded or saved). */
  private lastSaved: EditorDoc | null = null;
  private openToken = 0;
  private readonly offAutosave: () => void;

  constructor(
    readonly api: EditorApi,
    timers: Timers = browserTimers,
    autosaveOptions: AutosaveOptions = {},
  ) {
    this.autosave = new Autosave(
      this.store,
      async (doc) => {
        const ref = this.snap.ref;
        if (doc === null || ref === null) return;
        try {
          this.lastSaved = await this.api.putDoc(doc, ref.kind);
        } catch (err) {
          throw err instanceof ApiError ? new SaveError(err.status, err.code) : err;
        }
      },
      timers,
      autosaveOptions,
    );
    this.offAutosave = this.autosave.subscribe(() => {
      if (this.autosave.getState().kind === 'locked' && this.snap.lock === null) this.set({ lock: 'live' });
    });
  }

  getSnapshot = (): SessionSnapshot => this.snap;

  subscribe = (l: () => void): (() => void) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };

  /**
   * Opens a document. First flushes the one that is open: if it still has unsaved changes (the save failed) the
   * switch is REFUSED (`blocked`), so edits are never dropped silently. `discard` overrides that on purpose.
   */
  async open(ref: DocRef, opts: { discard?: boolean } = {}): Promise<boolean> {
    if (this.snap.ref !== null && !opts.discard) {
      await this.autosave.flush();
      const kind = this.autosave.getState().kind;
      if (kind !== 'clean' && kind !== 'locked') {
        this.set({ blocked: true });
        return false;
      }
    }
    const token = ++this.openToken;
    this.set({ ref, phase: 'loading', error: null, lock: null, conflict: null, blocked: false });
    try {
      const [doc, live] = await Promise.all([this.api.getDoc(ref), this.api.liveStatus().catch(() => null)]);
      if (token !== this.openToken) return false; // a newer open() won
      const lock = ref.kind === 'episode' && live !== null && live.episodeId === ref.id && live.phase === 'live' ? 'live' : null;
      this.store.replace(doc, { readOnly: lock !== null });
      this.autosave.markSaved();
      this.lastSaved = doc;
      this.selection.select(firstBlockId(doc));
      this.set({ phase: 'ready', live, lock });
      return true;
    } catch (err) {
      if (token === this.openToken) this.set({ phase: 'error', error: err instanceof ApiError ? err.code : 'network' });
      return false;
    }
  }

  /** Forgets the open document without saving (it was deleted, or the director chose to discard). */
  forget(): void {
    this.openToken++;
    this.store.replace(null);
    this.autosave.markSaved();
    this.lastSaved = null;
    this.selection.select(null);
    this.set({ ref: null, phase: 'idle', error: null, lock: null, conflict: null, blocked: false });
  }

  apply(e: Edit<EditorDoc>): boolean {
    return this.store.edit({ label: e.label, coalesceKey: e.coalesceKey, apply: (d) => (d === null ? d : e.apply(d)) });
  }
  undo(): boolean {
    return this.store.undo();
  }
  redo(): boolean {
    return this.store.redo();
  }
  seal(): void {
    this.store.seal();
  }

  /** Polls the live status; an open episode that is on air becomes read-only. */
  async refreshLive(): Promise<void> {
    let live: LiveStatus;
    try {
      live = await this.api.liveStatus();
    } catch {
      return;
    }
    const ref = this.snap.ref;
    const onAir = ref !== null && ref.kind === 'episode' && live.episodeId === ref.id && live.phase === 'live';
    if (onAir) this.store.setReadOnly(true);
    this.set({ live, lock: onAir ? 'live' : this.snap.lock });
  }

  /**
   * Looks for a newer server copy (other tab, other machine). Clean local copy: refreshed silently. Unsaved local
   * edits: `conflict` is set and the director chooses. Skipped while a save is in flight (its own write would look
   * like a foreign change) and while locked.
   */
  async checkExternal(): Promise<void> {
    const ref = this.snap.ref;
    const kind = this.autosave.getState().kind;
    if (ref === null || this.snap.phase !== 'ready' || this.snap.lock !== null || kind === 'saving' || this.snap.conflict !== null) return;
    let remote: EditorDoc;
    try {
      remote = await this.api.getDoc(ref);
    } catch {
      return;
    }
    if (this.snap.ref !== ref || this.autosave.getState().kind === 'saving') return;
    if (this.lastSaved !== null && stableStringify(remote) === stableStringify(this.lastSaved)) return;
    if (this.autosave.getState().kind === 'clean') {
      this.store.replace(remote);
      this.autosave.markSaved();
      this.lastSaved = remote;
      this.set({ refreshed: this.snap.refreshed + 1 });
    } else {
      this.set({ conflict: remote });
    }
  }

  takeTheirs(): void {
    const theirs = this.snap.conflict;
    if (theirs === null) return;
    this.store.replace(theirs);
    this.autosave.markSaved();
    this.lastSaved = theirs;
    this.set({ conflict: null });
  }

  /** Keeps the local copy: from now on the server copy is the one the next save overwrites. */
  keepMine(): void {
    const theirs = this.snap.conflict;
    if (theirs === null) return;
    this.lastSaved = theirs;
    this.set({ conflict: null });
    void this.autosave.flush();
  }

  /**
   * "Load for live". If this episode is the open one it is saved first (the server loads what is on disk); if the
   * save fails nothing is loaded. The server refuses a rundown with errors (`invalid`, with the issues).
   */
  async loadForLive(episodeId: string): Promise<LoadResult> {
    const ref = this.snap.ref;
    if (ref !== null && ref.kind === 'episode' && ref.id === episodeId) {
      await this.autosave.flush();
      if (this.autosave.getState().kind !== 'clean') return { ok: false, reason: 'unsaved' };
    }
    try {
      await this.api.loadLive(episodeId);
    } catch (err) {
      if (err instanceof RundownInvalidError) return { ok: false, reason: 'invalid', issues: err.issues };
      return { ok: false, reason: err instanceof ApiError ? err.code : 'network' };
    }
    await this.refreshLive();
    return { ok: true };
  }

  dispose(): void {
    this.offAutosave();
    this.autosave.dispose();
  }

  private set(patch: Partial<SessionSnapshot>): void {
    this.snap = { ...this.snap, ...patch };
    for (const l of [...this.listeners]) l();
  }
}
```

`web/src/editor/session/context.tsx`:
```tsx
// SPDX-License-Identifier: GPL-2.0-or-later
import { createContext, useContext, useMemo, useSyncExternalStore, type ReactNode } from 'react';
import type { Lang } from '../../core/i18n';
import type { EditorDoc } from '../api/editor-api';
import { createEditorT, type EditorT } from '../i18n';
import type { SaveState } from '../store/autosave';
import type { StoreSnapshot } from '../store/document-store';
import type { EditorSession, SessionSnapshot } from './session';
import type { SelectionSnapshot } from './selection';

interface Value {
  session: EditorSession;
  t: EditorT;
}
const Ctx = createContext<Value | null>(null);

export function EditorProvider(props: { session: EditorSession; lang: Lang; children: ReactNode }) {
  const t = useMemo(() => createEditorT(props.lang), [props.lang]);
  const value = useMemo(() => ({ session: props.session, t }), [props.session, t]);
  return <Ctx.Provider value={value}>{props.children}</Ctx.Provider>;
}

function useValue(): Value {
  const v = useContext(Ctx);
  if (v === null) throw new Error('EditorProvider is missing');
  return v;
}

export const useSession = (): EditorSession => useValue().session;
export const useEditorT = (): EditorT => useValue().t;

export function useStore(): StoreSnapshot<EditorDoc | null> {
  const { store } = useValue().session;
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}
export const useDoc = (): EditorDoc | null => useStore().doc;

export function useSaveState(): SaveState {
  const { autosave } = useValue().session;
  return useSyncExternalStore(autosave.subscribe, autosave.getState, autosave.getState);
}
export function useSessionSnapshot(): SessionSnapshot {
  const s = useValue().session;
  return useSyncExternalStore(s.subscribe, s.getSnapshot, s.getSnapshot);
}
export function useSelection(): SelectionSnapshot {
  const { selection } = useValue().session;
  return useSyncExternalStore(selection.subscribe, selection.getSnapshot, selection.getSnapshot);
}
```

`web/test/support/editor.tsx`:
```tsx
// SPDX-License-Identifier: GPL-2.0-or-later
import { act, render, type RenderResult } from '@testing-library/react';
import { Episode, Format, createEpisode, validateRundown } from '@olc/shared';
import { soloFutsalEpisode, soloFutsalFormat } from '@olc/shared/testing';
import userEvent from '@testing-library/user-event';
import type { ReactElement } from 'react';
import type { Lang } from '../../src/core/i18n';
import { ApiError } from '../../src/core/http';
import {
  RundownInvalidError, type DeckResult, type DocKind, type DocRef, type EditorApi, type EditorDoc, type LiveStatus,
  type NewEpisodeBody, type ObsCheckResult,
} from '../../src/editor/api/editor-api';
import { EditorProvider } from '../../src/editor/session/context';
import { EditorSession } from '../../src/editor/session/session';
import { fakeTimers } from './fake-timers';

export const sampleFormat = (): Format => soloFutsalFormat();
export const sampleEpisode = (): Episode => soloFutsalEpisode();

/** In-memory EditorApi that behaves like the server: PUT upserts and parses, live episodes answer 409. */
export class FakeEditorApi implements EditorApi {
  formats = new Map<string, Format>();
  episodes = new Map<string, Episode>();
  live: LiveStatus = { episodeId: null, phase: null };
  scenes: string[] | null = ['CAM 1', 'CAM 2', 'CAM 3', 'BREAK', 'PLAYOUT'];
  deck: DeckResult = { state: 'unavailable', reason: 'obs_not_connected' };
  check: ObsCheckResult = { connected: true, obsWebSocketVersion: '5.5.0', deck: { capability: 'events' }, issues: [] };
  calls: string[] = [];
  private failures = new Map<string, Error[]>();
  private gates = new Map<string, Promise<void>>();

  /** The next call of `method` throws `err`. */
  failNext(method: keyof EditorApi, err: Error): void {
    this.failures.set(method, [...(this.failures.get(method) ?? []), err]);
  }
  /** The next call of `method` waits until the returned function is called. */
  hold(method: keyof EditorApi): () => void {
    let release!: () => void;
    this.gates.set(method, new Promise<void>((r) => (release = r)));
    return release;
  }
  count(method: keyof EditorApi): number {
    return this.calls.filter((c) => c === method).length;
  }
  private async enter(method: keyof EditorApi): Promise<void> {
    this.calls.push(method);
    const gate = this.gates.get(method);
    if (gate !== undefined) {
      this.gates.delete(method);
      await gate;
    }
    const f = this.failures.get(method)?.shift();
    if (f !== undefined) throw f;
  }

  async listFormats() {
    await this.enter('listFormats');
    return structuredClone([...this.formats.values()]);
  }
  async listEpisodes() {
    await this.enter('listEpisodes');
    return structuredClone([...this.episodes.values()]);
  }
  async getDoc(ref: DocRef) {
    await this.enter('getDoc');
    const doc = (ref.kind === 'format' ? this.formats : this.episodes).get(ref.id);
    if (doc === undefined) throw new ApiError(404, 'not_found');
    return structuredClone(doc);
  }
  async createFormat(format: Format) {
    await this.enter('createFormat');
    if (this.formats.has(format.id)) throw new ApiError(409, 'exists');
    this.formats.set(format.id, Format.parse(structuredClone(format)));
    return structuredClone(this.formats.get(format.id)!);
  }
  async putDoc(doc: EditorDoc, kind: DocKind) {
    await this.enter('putDoc');
    if (kind === 'episode' && this.live.episodeId === doc.id && this.live.phase === 'live') throw new ApiError(409, 'episode_live');
    const parsed = kind === 'format' ? Format.parse(structuredClone(doc)) : Episode.parse(structuredClone(doc));
    (kind === 'format' ? this.formats : this.episodes).set(doc.id, parsed as never);
    return structuredClone(parsed);
  }
  async deleteDoc(ref: DocRef) {
    await this.enter('deleteDoc');
    if (ref.kind === 'episode' && this.live.episodeId === ref.id) throw new ApiError(409, 'episode_loaded');
    if (!(ref.kind === 'format' ? this.formats : this.episodes).delete(ref.id)) throw new ApiError(404, 'not_found');
  }
  async createEpisode(formatId: string, body: NewEpisodeBody) {
    await this.enter('createEpisode');
    const format = this.formats.get(formatId);
    if (format === undefined) throw new ApiError(404, 'not_found');
    if (this.episodes.has(body.id)) throw new ApiError(409, 'exists');
    const ep = createEpisode(format, body);
    this.episodes.set(ep.id, ep);
    return structuredClone(ep);
  }
  async liveStatus() {
    await this.enter('liveStatus');
    return { ...this.live };
  }
  async loadLive(episodeId: string) {
    await this.enter('loadLive');
    const ep = this.episodes.get(episodeId);
    if (ep === undefined) throw new ApiError(404, 'not_found');
    const errors = validateRundown(ep).filter((i) => i.severity === 'error');
    if (errors.length > 0) throw new RundownInvalidError(errors);
    this.live = { episodeId, phase: 'preshow' };
  }
  async obsScenes() {
    await this.enter('obsScenes');
    return this.scenes === null ? null : [...this.scenes];
  }
  async deckItems() {
    await this.enter('deckItems');
    return structuredClone(this.deck);
  }
  async checkObs() {
    await this.enter('checkObs');
    return structuredClone(this.check);
  }
}

export interface RenderOptions {
  /** Document to open before rendering. */
  open?: DocRef;
  api?: FakeEditorApi;
  lang?: Lang;
}

/** Renders `ui` inside an EditorProvider whose session uses deterministic timers, after opening `opts.open`. */
export async function renderWithSession(ui: ReactElement, opts: RenderOptions = {}) {
  const api = opts.api ?? new FakeEditorApi();
  if (api.formats.size === 0 && api.episodes.size === 0) {
    api.formats.set('solo-futsal', sampleFormat());
    api.episodes.set('ep-2026-10-12', sampleEpisode());
  }
  const time = fakeTimers();
  const session = new EditorSession(api, time.timers);
  if (opts.open !== undefined) await act(async () => void (await session.open(opts.open!)));
  const utils: RenderResult = render(
    <EditorProvider session={session} lang={opts.lang ?? 'it'}>
      {ui}
    </EditorProvider>,
  );
  return {
    ...utils,
    api,
    session,
    user: userEvent.setup(),
    /** Moves the session's timers forward (autosave debounce, retries). */
    advance: (ms: number) => act(async () => time.advance(ms)),
  };
}
```

- [ ] **Step 1: Write the failing tests**

`web/test/editor/editor-api.test.ts`:
```ts
// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import { soloFutsalFormat } from '@olc/shared/testing';
import { ApiError } from '../../src/core/http';
import { RundownInvalidError, httpEditorApi } from '../../src/editor/api/editor-api';

function fakeFetch(handler: (url: string, init?: RequestInit) => { status: number; body?: unknown }) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    const { status, body } = handler(url, init);
    return new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  return { fn, calls };
}

describe('httpEditorApi', () => {
  it('lists, gets and puts documents with the right verbs and urls', async () => {
    const f = soloFutsalFormat();
    const { fn, calls } = fakeFetch((url, init) => ({ status: 200, body: url.endsWith('/api/formats') && init?.method === undefined ? [f] : f }));
    const api = httpEditorApi(fn);
    expect(await api.listFormats()).toEqual([f]);
    expect((await api.getDoc({ kind: 'format', id: 'solo-futsal' })).id).toBe('solo-futsal');
    await api.putDoc(f, 'format');
    expect(calls.map((c) => `${c.init?.method ?? 'GET'} ${c.url}`)).toEqual([
      'GET /api/formats',
      'GET /api/formats/solo-futsal',
      'PUT /api/formats/solo-futsal',
    ]);
    expect(JSON.parse(String(calls[2]!.init!.body)).id).toBe('solo-futsal');
  });

  it('url-encodes ids and rejects a response that is not a valid document', async () => {
    const { fn, calls } = fakeFetch(() => ({ status: 200, body: { nope: true } }));
    const api = httpEditorApi(fn);
    await expect(api.getDoc({ kind: 'episode', id: 'a b' })).rejects.toThrow();
    expect(calls[0]!.url).toBe('/api/episodes/a%20b');
  });

  it('turns an error body into ApiError(status, code)', async () => {
    const { fn } = fakeFetch(() => ({ status: 409, body: { error: 'episode_live' } }));
    const err = await httpEditorApi(fn).putDoc(soloFutsalFormat(), 'format').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 409, code: 'episode_live' });
  });

  it('turns rundown_invalid into RundownInvalidError with the issues', async () => {
    const issues = [{ severity: 'error', code: 'media_exceeds_block', blockId: 'b1', message: 'x' }];
    const { fn } = fakeFetch(() => ({ status: 409, body: { error: 'rundown_invalid', issues } }));
    const err = await httpEditorApi(fn).loadLive('ep-1').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RundownInvalidError);
    expect((err as RundownInvalidError).issues).toEqual(issues);
  });

  it('maps obs scenes (null when not connected) and deck availability', async () => {
    let mode = 'ok';
    const { fn } = fakeFetch((url) => {
      if (url === '/api/obs/scenes') return mode === 'ok' ? { status: 200, body: { scenes: ['A'] } } : { status: 409, body: { error: 'obs_not_connected' } };
      if (mode === 'ok') return { status: 200, body: { items: [{ index: 0, path: 'a', title: 'A', durationMs: -1, occurrence: 0 }] } };
      if (mode === 'absent') return { status: 404, body: { error: 'deck_absent' } };
      return { status: 409, body: { error: 'deck_not_ready' } };
    });
    const api = httpEditorApi(fn);
    expect(await api.obsScenes()).toEqual(['A']);
    expect(await api.deckItems()).toMatchObject({ state: 'ok', items: [{ durationMs: -1 }] });
    mode = 'absent';
    expect(await api.deckItems()).toEqual({ state: 'unavailable', reason: 'deck_absent' });
    mode = 'notready';
    expect(await api.deckItems()).toEqual({ state: 'unavailable', reason: 'deck_not_ready' });
    mode = 'down';
    expect(await api.obsScenes()).toBeNull();
  });

  it('posts the episode creation body and the live load', async () => {
    const { fn, calls } = fakeFetch((url) => ({ status: url.includes('/episodes') ? 201 : 200, body: url.includes('/episodes') ? undefined : {} }));
    const api = httpEditorApi(fn);
    await api.loadLive('ep-1');
    expect(JSON.parse(String(calls[0]!.init!.body))).toEqual({ episodeId: 'ep-1' });
    await expect(api.createEpisode('solo-futsal', { id: 'e', date: '2026-10-12', plannedStart: null, playlistName: null })).rejects.toThrow();
    expect(calls[1]!.url).toBe('/api/formats/solo-futsal/episodes');
  });
});
```

`web/test/editor/session.test.ts`:
```ts
// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import { ApiError } from '../../src/core/http';
import { moveBlock, renameDoc } from '../../src/editor/model/ops';
import { EditorSession, stableStringify } from '../../src/editor/session/session';
import { FakeEditorApi, sampleEpisode, sampleFormat } from '../support/editor';
import { fakeTimers } from '../support/fake-timers';

function setup(live?: FakeEditorApi['live']) {
  const api = new FakeEditorApi();
  api.formats.set('solo-futsal', sampleFormat());
  api.episodes.set('ep-2026-10-12', sampleEpisode());
  if (live !== undefined) api.live = live;
  const time = fakeTimers();
  const session = new EditorSession(api, time.timers);
  return { api, time, session };
}
const FORMAT = { kind: 'format', id: 'solo-futsal' } as const;
const EPISODE = { kind: 'episode', id: 'ep-2026-10-12' } as const;

describe('open', () => {
  it('loads the document, selects the first block and is clean', async () => {
    const { session } = setup();
    expect(await session.open(FORMAT)).toBe(true);
    expect(session.getSnapshot()).toMatchObject({ phase: 'ready', lock: null, ref: FORMAT });
    expect(session.store.getSnapshot().doc?.id).toBe('solo-futsal');
    expect(session.selection.getSnapshot().blockId).toBe('b1');
    expect(session.autosave.getState().kind).toBe('clean');
  });

  it('reports a missing document', async () => {
    const { session } = setup();
    expect(await session.open({ kind: 'format', id: 'nope' })).toBe(false);
    expect(session.getSnapshot()).toMatchObject({ phase: 'error', error: 'not_found' });
  });

  it('a live episode opens read-only with the live lock', async () => {
    const { session } = setup({ episodeId: 'ep-2026-10-12', phase: 'live' });
    await session.open(EPISODE);
    expect(session.getSnapshot().lock).toBe('live');
    expect(session.store.getSnapshot().readOnly).toBe(true);
    expect(session.apply(renameDoc('x'))).toBe(false);
  });

  it('a loaded episode that is only in preshow stays editable', async () => {
    const { session } = setup({ episodeId: 'ep-2026-10-12', phase: 'preshow' });
    await session.open(EPISODE);
    expect(session.getSnapshot().lock).toBeNull();
    expect(session.apply(renameDoc('Nuovo nome'))).toBe(true);
  });

  it('the answer of an older open() is ignored when a newer one started', async () => {
    const { api, session } = setup();
    const release = api.hold('getDoc');
    const first = session.open(FORMAT);
    await Promise.resolve();
    const second = session.open(EPISODE, { discard: true });
    release();
    await Promise.all([first, second]);
    expect(session.getSnapshot().ref).toEqual(EPISODE);
    expect(session.store.getSnapshot().doc?.id).toBe('ep-2026-10-12');
  });
});

describe('autosave through the session', () => {
  it('saves the edited document to the server and ends clean', async () => {
    const { api, time, session } = setup();
    await session.open(FORMAT);
    session.apply(moveBlock(0, 2));
    await time.advance(900);
    expect(api.formats.get('solo-futsal')!.blocks.map((b) => b.id)).toEqual(['br1', 'b2', 'b1', 'b3']);
    expect(session.autosave.getState().kind).toBe('clean');
  });

  it('shows the failure, retries, and the server ends equal to the screen', async () => {
    const { api, time, session } = setup();
    await session.open(FORMAT);
    api.failNext('putDoc', new TypeError('fetch failed'));
    session.apply(renameDoc('Nuovo nome'));
    await time.advance(900);
    expect(session.autosave.getState()).toMatchObject({ kind: 'error', code: 'network' });
    expect(api.formats.get('solo-futsal')!.name).toBe('Solo Futsal');
    await time.advance(1_000);
    expect(session.autosave.getState().kind).toBe('clean');
    expect(api.formats.get('solo-futsal')!.name).toBe('Nuovo nome');
  });

  it('undo after a failed save: the retry carries the undone document', async () => {
    const { api, time, session } = setup();
    await session.open(FORMAT);
    api.failNext('putDoc', new ApiError(500, 'internal'));
    session.apply(renameDoc('Nuovo nome'));
    await time.advance(900);
    expect(session.autosave.getState().kind).toBe('error');
    session.undo();
    await time.advance(1_000);
    expect(api.formats.get('solo-futsal')!.name).toBe('Solo Futsal');
    expect(session.store.getSnapshot().doc?.name).toBe('Solo Futsal');
  });

  it('a 409 episode_live on save locks the session', async () => {
    const { api, time, session } = setup({ episodeId: null, phase: null });
    await session.open(EPISODE);
    api.live = { episodeId: 'ep-2026-10-12', phase: 'live' }; // went live in another tab after we opened it
    session.apply(renameDoc('Nuovo nome'));
    await time.advance(900);
    expect(session.getSnapshot().lock).toBe('live');
    expect(session.store.getSnapshot().readOnly).toBe(true);
  });

  it('refreshLive() locks an open episode that went on air', async () => {
    const { api, session } = setup();
    await session.open(EPISODE);
    api.live = { episodeId: 'ep-2026-10-12', phase: 'live' };
    await session.refreshLive();
    expect(session.getSnapshot().lock).toBe('live');
    expect(session.store.getSnapshot().readOnly).toBe(true);
  });
});

describe('switching documents never drops edits', () => {
  it('flushes pending edits before opening another document', async () => {
    const { api, session } = setup();
    await session.open(FORMAT);
    session.apply(renameDoc('Nuovo nome'));
    expect(await session.open(EPISODE)).toBe(true);
    expect(api.formats.get('solo-futsal')!.name).toBe('Nuovo nome');
  });

  it('refuses to switch while the save keeps failing, and discard overrides on purpose', async () => {
    const { api, session } = setup();
    await session.open(FORMAT);
    api.failNext('putDoc', new TypeError('down'));
    session.apply(renameDoc('Nuovo nome'));
    expect(await session.open(EPISODE)).toBe(false);
    expect(session.getSnapshot()).toMatchObject({ blocked: true, ref: FORMAT });
    expect(session.store.getSnapshot().doc?.name).toBe('Nuovo nome');
    expect(await session.open(EPISODE, { discard: true })).toBe(true);
    expect(session.getSnapshot().blocked).toBe(false);
  });
});

describe('loadForLive', () => {
  it('saves the open episode first, then loads it', async () => {
    const { api, session } = setup();
    await session.open(EPISODE);
    session.apply(renameDoc('Nuovo nome'));
    expect(await session.loadForLive('ep-2026-10-12')).toEqual({ ok: true });
    expect(api.episodes.get('ep-2026-10-12')!.name).toBe('Nuovo nome');
    expect(api.live).toEqual({ episodeId: 'ep-2026-10-12', phase: 'preshow' });
    expect(session.getSnapshot().live?.episodeId).toBe('ep-2026-10-12');
  });

  it('loads nothing when the open episode cannot be saved', async () => {
    const { api, session } = setup();
    await session.open(EPISODE);
    api.failNext('putDoc', new TypeError('down'));
    session.apply(renameDoc('Nuovo nome'));
    expect(await session.loadForLive('ep-2026-10-12')).toEqual({ ok: false, reason: 'unsaved' });
    expect(api.count('loadLive')).toBe(0);
  });

  it('returns the server issues when the rundown has errors', async () => {
    const { api, session } = setup();
    const ep = api.episodes.get('ep-2026-10-12')!;
    (ep.blocks[0] as { elements: Array<{ plannedDurationMs?: number }> }).elements[1]!.plannedDurationMs = 9_999_999;
    const result = await session.loadForLive('ep-2026-10-12');
    expect(result).toMatchObject({ ok: false, reason: 'invalid' });
    expect(result.ok === false && result.issues?.[0]).toMatchObject({ code: 'media_exceeds_block', blockId: 'b1' });
  });

  it('passes on the other refusals', async () => {
    const { api, session } = setup();
    expect(await session.loadForLive('nope')).toEqual({ ok: false, reason: 'not_found' });
    api.failNext('loadLive', new TypeError('down'));
    expect(await session.loadForLive('ep-2026-10-12')).toEqual({ ok: false, reason: 'network' });
  });
});

describe('external changes (another tab)', () => {
  it('does nothing when the server copy is unchanged', async () => {
    const { session } = setup();
    await session.open(FORMAT);
    await session.checkExternal();
    expect(session.getSnapshot()).toMatchObject({ refreshed: 0, conflict: null });
  });

  it('reloads silently when the local copy is clean', async () => {
    const { api, session } = setup();
    await session.open(FORMAT);
    api.formats.set('solo-futsal', { ...sampleFormat(), name: 'Cambiato altrove' });
    await session.checkExternal();
    expect(session.store.getSnapshot().doc?.name).toBe('Cambiato altrove');
    expect(session.getSnapshot().refreshed).toBe(1);
    expect(session.autosave.getState().kind).toBe('clean');
  });

  it('asks when the local copy has unsaved edits; take theirs replaces, keep mine overwrites', async () => {
    const { api, time, session } = setup();
    await session.open(FORMAT);
    session.apply(renameDoc('Mia modifica'));
    api.formats.set('solo-futsal', { ...sampleFormat(), name: 'Loro modifica' });
    await session.checkExternal();
    expect(session.getSnapshot().conflict?.name).toBe('Loro modifica');
    expect(session.store.getSnapshot().doc?.name).toBe('Mia modifica');

    session.takeTheirs();
    expect(session.store.getSnapshot().doc?.name).toBe('Loro modifica');
    expect(session.autosave.getState().kind).toBe('clean');

    session.apply(renameDoc('Mia seconda'));
    api.formats.set('solo-futsal', { ...sampleFormat(), name: 'Loro seconda' });
    await session.checkExternal();
    session.keepMine();
    await time.advance(900);
    expect(api.formats.get('solo-futsal')!.name).toBe('Mia seconda');
  });

  it('ignores the check while its own save is in flight (its own write is not a foreign change)', async () => {
    const { api, time, session } = setup();
    await session.open(FORMAT);
    const release = api.hold('putDoc');
    session.apply(renameDoc('Nuovo nome'));
    await time.advance(900);
    expect(session.autosave.getState().kind).toBe('saving');
    await session.checkExternal();
    expect(session.getSnapshot().conflict).toBeNull();
    release();
    await time.advance(0);
    expect(session.autosave.getState().kind).toBe('clean');
  });
});

describe('stableStringify', () => {
  it('ignores key order', () => {
    expect(stableStringify({ a: 1, b: [{ d: 1, c: 2 }] })).toBe(stableStringify({ b: [{ c: 2, d: 1 }], a: 1 }));
    expect(stableStringify({ a: 1 })).not.toBe(stableStringify({ a: 2 }));
  });
});
```

- [ ] **Step 2: Run, confirm FAIL. Step 3: Create the files above verbatim; run 3 times → PASS; `pnpm typecheck`. Step 4: Commit**

```
git add web/src/editor/api web/src/editor/session web/test/support/editor.tsx web/test/editor/editor-api.test.ts web/test/editor/session.test.ts
git commit -m "feat(web): editor API client, session with conflict handling, hooks and test support"
```

---
## Wave 2 conventions (Tasks 9–14, all UI, all in parallel worktrees)

- Every UI task **fills only its own dictionary module** (`web/src/editor/i18n/<module>.ts`, created empty by Task 1) and **adds only new files** under its own folder. It imports from the shared files of Tasks 1–8 and never edits them.
- A component reads everything through the hooks of `session/context.tsx` and edits only through `session.apply(<op from model/ops.ts>)`. It never calls the store or the API for a document edit any other way (the library is the one exception for documents that are not open).
- A component is disabled/read-only when `useStore().readOnly` is true. The store rejects edits anyway; the disabled state is for the director's eyes.
- Text inputs that edit a value commit on **blur and on Enter** (one edit per commit, so the history stays clean); the operations coalesce repeated commits of the same field.
- Accessible names are part of the contract (the tests query by them). Action buttons that act on a row have `aria-label="{action} {row name}"`.
- Tests use `renderWithSession` and `FakeEditorApi` from `web/test/support/editor.tsx` (Task 8). They do not loosen: if a test cannot pass with the described behaviour, stop and report.
- A panel is rendered by the shell only when a document is open, but it must not crash when `useDoc()` is `null`: it renders nothing.
- Styling: a `*.css` file per task with the class names used; colours only from the `--*` variables (`ui/tokens.ts`) and the `--ed-*` variables of `styles/editor.css`; `min-width: 0` plus ellipsis on every text cell that shows a user-supplied string (block names, titles, paths).

### Task 9: Library — formats and episodes

**Files:**
- Create: `web/src/editor/library/{LibraryPanel.tsx,NewEpisodeDialog.tsx,blank.ts,library.css}`, `web/test/editor/library.test.tsx`, `web/test/editor/blank.test.ts`
- Modify: `web/src/editor/i18n/library.ts` (only)

**Interfaces:**
- `LibraryPanel(props: { now?: () => Date })`.
- `blankFormat(name, id): Format`. The date helpers `localDate` and `toIsoWithOffset` come from `model/time.ts` (Task 4).

`web/src/editor/library/blank.ts`:
```ts
// SPDX-License-Identifier: GPL-2.0-or-later
import { SCHEMA_VERSION, presetForMode, type Format } from '@olc/shared';

/** A new format: one studio block, one scene group with a placeholder scene the director renames. */
export function blankFormat(name: string, id: string): Format {
  return {
    schemaVersion: SCHEMA_VERSION,
    id,
    name,
    preset: presetForMode('streaming'),
    sceneGroups: [{ id: 'studio', name: 'Studio', scenes: ['SCENA 1'] }],
    messages: [],
    blocks: [
      {
        id: 'blk-1',
        kind: 'studio',
        name: 'Blocco 1',
        durationMs: 300_000,
        elastic: true,
        sceneGroupId: 'studio',
        elements: [{ id: 'el-1', kind: 'studio' }],
      },
    ],
  };
}
```

`web/src/editor/i18n/library.ts` (complete):
```ts
// SPDX-License-Identifier: GPL-2.0-or-later
export const IT_LIBRARY = {
  'library.title': 'Libreria',
  'library.formats': 'FORMAT',
  'library.episodes': 'PUNTATE',
  'library.empty': 'Nessun elemento',
  'library.newFormat': 'Nuovo format',
  'library.nameLabel': 'Nome',
  'library.create': 'Crea',
  'library.cancel': 'Annulla',
  'library.rename': 'Rinomina',
  'library.duplicate': 'Duplica',
  'library.delete': 'Elimina',
  'library.confirmDelete': 'Conferma eliminazione',
  'library.copySuffix': '{name} (copia)',
  'library.newEpisode': 'Nuova puntata',
  'library.episodeDate': 'Data',
  'library.episodeStart': 'Inizio previsto',
  'library.episodePlaylist': 'Nome playlist',
  'library.loadForLive': 'Carica per la live',
  'library.loaded': 'CARICATA',
  'library.onAir': 'IN ONDA',
  'library.loadedOk': 'Puntata caricata per la live',
  'library.loadInvalid': 'Rundown con errori: correggili prima di caricare',
  'library.loadLiveRunning': "Live in corso: impossibile caricare un'altra puntata",
  'library.loadUnsaved': 'Salvataggio non riuscito: caricamento annullato',
  'library.loadFailed': 'Caricamento non riuscito ({code})',
  'library.deleteLoaded': 'Puntata caricata per la live: non eliminabile',
  'library.exists': 'Esiste già un elemento con questo nome',
  'library.error': 'Operazione non riuscita ({code})',
  'library.open': 'Apri',
  'library.linkDock': 'Dock',
  'library.linkControl': 'Control',
  'library.linkPresenter': 'Presenter',
} as const;

export const EN_LIBRARY: Record<keyof typeof IT_LIBRARY, string> = {
  'library.title': 'Library',
  'library.formats': 'FORMATS',
  'library.episodes': 'EPISODES',
  'library.empty': 'Nothing here yet',
  'library.newFormat': 'New format',
  'library.nameLabel': 'Name',
  'library.create': 'Create',
  'library.cancel': 'Cancel',
  'library.rename': 'Rename',
  'library.duplicate': 'Duplicate',
  'library.delete': 'Delete',
  'library.confirmDelete': 'Confirm delete',
  'library.copySuffix': '{name} (copy)',
  'library.newEpisode': 'New episode',
  'library.episodeDate': 'Date',
  'library.episodeStart': 'Planned start',
  'library.episodePlaylist': 'Playlist name',
  'library.loadForLive': 'Load for live',
  'library.loaded': 'LOADED',
  'library.onAir': 'ON AIR',
  'library.loadedOk': 'Episode loaded for the live',
  'library.loadInvalid': 'The rundown has errors: fix them before loading',
  'library.loadLiveRunning': 'A live is running: cannot load another episode',
  'library.loadUnsaved': 'Save failed: load cancelled',
  'library.loadFailed': 'Load failed ({code})',
  'library.deleteLoaded': 'This episode is loaded for the live and cannot be deleted',
  'library.exists': 'An item with this name already exists',
  'library.error': 'Operation failed ({code})',
  'library.open': 'Open',
  'library.linkDock': 'Dock',
  'library.linkControl': 'Control',
  'library.linkPresenter': 'Presenter',
};
```

**Behaviour (rules):**
1. On mount and whenever the save state returns to `clean`, list formats and episodes through the API; after the first list call `session.refreshLive()` so the live tags are current. Episodes are sorted by `date` descending, then name. If a list call fails, show `library.error` in the status line.
2. Structure: `<h2>` title; section `FORMAT` with a `Nuovo format` button and `<ul aria-label="FORMAT">`; section `PUNTATE` with `<ul aria-label="PUNTATE">`; an empty list shows `library.empty`. Each row is `<li data-testid="fmt-{id}">` / `<li data-testid="ep-{id}">` holding the name button (`aria-current="true"` when it is the open document) and the action buttons below. A `<nav aria-label="Apri">` with three links `/dock`, `/control`, `/presenter` (`target="_blank" rel="noopener"`). A `<p role="status" data-testid="lib-status">` shows the last message.
3. **Open:** the name button calls `session.open({kind, id})`. If it returns `false` because of `blocked`, nothing else happens (the shell shows the banner).
4. **New format:** the button reveals an input (`aria-label="Nome"`) with `Crea` / `Annulla`; Enter submits. Id = `uniqueSlug(name, new Set(formatIds))`; document = `blankFormat(name.trim(), id)`; `api.createFormat`; refresh; open it. A `409 exists` shows `library.exists`. Empty name: `Crea` disabled.
5. **Rename:** `Rinomina {name}` turns the name into an input (`aria-label="Nome"`, Enter commits, Escape cancels). For the open document use `session.apply(renameDoc(name))`; for another one `getDoc` → copy with the new name → `putDoc` → refresh. The id never changes.
6. **Duplicate:** `Duplica {name}`: `getDoc`, new name `t('library.copySuffix',{name})`, new id `uniqueSlug(newName, taken ids of the same kind)`; a format is created with `createFormat`, an episode with `putDoc(..., 'episode')` (PUT upserts). Then refresh and open the copy.
7. **Delete:** two steps. First click on `Elimina {name}` changes that button to `Conferma eliminazione {name}` (it reverts after 4 s or on blur); the second click calls `deleteDoc`. If the deleted document is open, `session.forget()`. `ApiError 409 episode_loaded` shows `library.deleteLoaded` and keeps the row.
8. **New episode:** `Nuova puntata {format name}` opens `NewEpisodeDialog` (`role="dialog"`, `aria-label="Nuova puntata"`): date input (`aria-label="Data"`, `type=date`, default `localDate(now())` from `model/time`), time input (`aria-label="Inizio previsto"`, `type=time`, optional), text input (`aria-label="Nome playlist"`, optional), `Crea` / `Annulla`. On Crea: id = `uniqueSlug(`${format.name} ${date}`, episode ids)`; body `{ id, date, plannedStart: time === '' ? null : toIsoWithOffset(date, time), playlistName: playlist.trim() === '' ? null : playlist.trim() }`; `api.createEpisode(formatId, body)`; refresh; open the new episode; close the dialog.
9. **Load for live:** `Carica per la live {name}` → `session.loadForLive(id)`. Messages: ok → `library.loadedOk`; `invalid` → `library.loadInvalid`; `live_running` → `library.loadLiveRunning`; `unsaved` → `library.loadUnsaved`; anything else → `library.loadFailed` with the code. After success the panel refreshes the live status (`session.refreshLive()`).
10. **Tags:** from `useSessionSnapshot().live`: the episode whose id equals `live.episodeId` shows `IN ONDA` when `live.phase === 'live'`, otherwise `CARICATA`.
11. Any other API failure shows `library.error` with the code. Buttons are disabled while their request is running (no double submit).

- [ ] **Step 1: Write the failing tests**

`web/test/editor/blank.test.ts`:
```ts
// SPDX-License-Identifier: GPL-2.0-or-later
import { Format, validateRundown } from '@olc/shared';
import { describe, expect, it } from 'vitest';
import { blankFormat } from '../../src/editor/library/blank';

describe('blank', () => {
  it('blankFormat is a valid format with no validation error', () => {
    const f = blankFormat('Notte Basket', 'notte-basket');
    expect(Format.safeParse(f).success).toBe(true);
    expect(validateRundown(f).filter((i) => i.severity === 'error')).toEqual([]);
  });
});
```

`web/test/editor/library.test.tsx`:
```tsx
// SPDX-License-Identifier: GPL-2.0-or-later
import { fireEvent, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ApiError } from '../../src/core/http';
import { LibraryPanel } from '../../src/editor/library/LibraryPanel';
import { toIsoWithOffset } from '../../src/editor/model/time';
import { FakeEditorApi, renderWithSession, sampleEpisode, sampleFormat } from '../support/editor';

const NOW = () => new Date(2026, 9, 20, 10, 0);
const EP = 'ep-2026-10-12';

async function setup(prepare?: (api: FakeEditorApi) => void) {
  const api = new FakeEditorApi();
  api.formats.set('solo-futsal', sampleFormat());
  api.episodes.set(EP, sampleEpisode());
  prepare?.(api);
  const r = await renderWithSession(<LibraryPanel now={NOW} />, { api });
  await screen.findByTestId('fmt-solo-futsal');
  return r;
}

describe('LibraryPanel', () => {
  it('lists formats and episodes, with links to the other pages', async () => {
    await setup();
    expect(within(screen.getByTestId('fmt-solo-futsal')).getByText('Solo Futsal')).toBeTruthy();
    expect(within(screen.getByTestId(`ep-${EP}`)).getByText('Solo Futsal · 12/10/2026')).toBeTruthy();
    const nav = screen.getByRole('navigation', { name: 'Apri' });
    expect(within(nav).getByRole('link', { name: 'Dock' }).getAttribute('href')).toBe('/dock');
    expect(within(nav).getByRole('link', { name: 'Control' }).getAttribute('href')).toBe('/control');
    expect(within(nav).getByRole('link', { name: 'Presenter' }).getAttribute('href')).toBe('/presenter');
  });

  it('opens a document on click and marks it', async () => {
    const { session, user } = await setup();
    await user.click(within(screen.getByTestId('fmt-solo-futsal')).getByRole('button', { name: 'Solo Futsal' }));
    expect(session.getSnapshot().ref).toEqual({ kind: 'format', id: 'solo-futsal' });
    expect(within(screen.getByTestId('fmt-solo-futsal')).getByRole('button', { name: 'Solo Futsal' }).getAttribute('aria-current')).toBe('true');
  });

  it('creates a format with a lowercase slug id, opens it, and avoids an existing id', async () => {
    const { api, session, user } = await setup();
    await user.click(screen.getByRole('button', { name: 'Nuovo format' }));
    await user.type(screen.getByRole('textbox', { name: 'Nome' }), 'Notte Basket{Enter}');
    expect(await screen.findByTestId('fmt-notte-basket')).toBeTruthy();
    expect(api.formats.get('notte-basket')!.name).toBe('Notte Basket');
    expect(session.getSnapshot().ref).toEqual({ kind: 'format', id: 'notte-basket' });
    await user.click(screen.getByRole('button', { name: 'Nuovo format' }));
    await user.type(screen.getByRole('textbox', { name: 'Nome' }), 'Solo Futsal{Enter}');
    expect(await screen.findByTestId('fmt-solo-futsal-2')).toBeTruthy();
  });

  it('shows "exists" when the server refuses the id', async () => {
    const { api, user } = await setup();
    api.failNext('createFormat', new ApiError(409, 'exists'));
    await user.click(screen.getByRole('button', { name: 'Nuovo format' }));
    await user.type(screen.getByRole('textbox', { name: 'Nome' }), 'Altro{Enter}');
    expect((await screen.findByTestId('lib-status')).textContent).toContain('Esiste già');
  });

  it('duplicates a format and an episode', async () => {
    const { api, user } = await setup();
    await user.click(screen.getByRole('button', { name: 'Duplica Solo Futsal' }));
    expect(await screen.findByTestId('fmt-solo-futsal-copia')).toBeTruthy();
    expect(api.formats.get('solo-futsal-copia')!.name).toBe('Solo Futsal (copia)');
    await user.click(screen.getByRole('button', { name: 'Duplica Solo Futsal · 12/10/2026' }));
    expect(api.episodes.size).toBe(2);
  });

  it('renames a stored document without opening it; the id stays', async () => {
    const { api, user } = await setup();
    await user.click(screen.getByRole('button', { name: 'Rinomina Solo Futsal' }));
    const input = screen.getByRole('textbox', { name: 'Nome' });
    await user.clear(input);
    await user.type(input, 'Calcio a 5{Enter}');
    await screen.findByText('Calcio a 5');
    expect(api.formats.get('solo-futsal')!.name).toBe('Calcio a 5');
  });

  it('deletes only after a second click, and forgets the open document', async () => {
    const { api, session, user } = await setup();
    await user.click(within(screen.getByTestId('fmt-solo-futsal')).getByRole('button', { name: 'Solo Futsal' }));
    await user.click(screen.getByRole('button', { name: 'Elimina Solo Futsal' }));
    expect(api.formats.has('solo-futsal')).toBe(true);
    await user.click(screen.getByRole('button', { name: 'Conferma eliminazione Solo Futsal' }));
    expect(api.formats.has('solo-futsal')).toBe(false);
    expect(session.getSnapshot().ref).toBeNull();
  });

  it('refuses to delete the loaded episode and says why', async () => {
    const { api, user } = await setup((a) => {
      a.live = { episodeId: EP, phase: 'preshow' };
    });
    const name = 'Solo Futsal · 12/10/2026';
    await user.click(screen.getByRole('button', { name: `Elimina ${name}` }));
    await user.click(screen.getByRole('button', { name: `Conferma eliminazione ${name}` }));
    expect((await screen.findByTestId('lib-status')).textContent).toContain('non eliminabile');
    expect(api.episodes.has(EP)).toBe(true);
  });

  it('creates an episode from a format with date, planned start and playlist name, then opens it', async () => {
    const { api, session, user } = await setup();
    await user.click(screen.getByRole('button', { name: 'Nuova puntata Solo Futsal' }));
    const dialog = screen.getByRole('dialog', { name: 'Nuova puntata' });
    expect((within(dialog).getByLabelText('Data') as HTMLInputElement).value).toBe('2026-10-20');
    fireEvent.change(within(dialog).getByLabelText('Inizio previsto'), { target: { value: '19:30' } });
    await user.type(within(dialog).getByLabelText('Nome playlist'), 'Puntata del 20/10');
    await user.click(within(dialog).getByRole('button', { name: 'Crea' }));
    const id = 'solo-futsal-2026-10-20';
    expect(await screen.findByTestId(`ep-${id}`)).toBeTruthy();
    const ep = api.episodes.get(id)!;
    expect(ep).toMatchObject({ formatId: 'solo-futsal', date: '2026-10-20', playlistName: 'Puntata del 20/10', plannedStart: toIsoWithOffset('2026-10-20', '19:30') });
    expect(session.getSnapshot().ref).toEqual({ kind: 'episode', id });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('sends nulls when the optional fields are empty', async () => {
    const { api, user } = await setup();
    await user.click(screen.getByRole('button', { name: 'Nuova puntata Solo Futsal' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Crea' }));
    await screen.findByTestId('ep-solo-futsal-2026-10-20');
    expect(api.episodes.get('solo-futsal-2026-10-20')).toMatchObject({ plannedStart: null, playlistName: null });
  });

  it('loads an episode for the live and tags it', async () => {
    const { api, user } = await setup();
    await user.click(screen.getByRole('button', { name: 'Carica per la live Solo Futsal · 12/10/2026' }));
    expect((await screen.findByTestId('lib-status')).textContent).toContain('Puntata caricata per la live');
    expect(api.live.episodeId).toBe(EP);
    expect(within(await screen.findByTestId(`ep-${EP}`)).getByText('CARICATA')).toBeTruthy();
  });

  it('tags the episode that is on air', async () => {
    await setup((a) => {
      a.live = { episodeId: EP, phase: 'live' };
    });
    await screen.findByTestId(`ep-${EP}`);
    expect(within(screen.getByTestId(`ep-${EP}`)).getByText('IN ONDA')).toBeTruthy();
  });

  it('explains a refused load (errors in the rundown)', async () => {
    const { user } = await setup((a) => {
      const ep = a.episodes.get(EP)!;
      (ep.blocks[0] as { elements: Array<{ plannedDurationMs?: number }> }).elements[1]!.plannedDurationMs = 9_999_999;
    });
    await user.click(screen.getByRole('button', { name: 'Carica per la live Solo Futsal · 12/10/2026' }));
    expect((await screen.findByTestId('lib-status')).textContent).toContain('Rundown con errori');
  });
});
```
(The status line is only refreshed by the panel's own actions; the "tags the episode that is on air" test relies on the panel calling `session.refreshLive()` after the first list.)

- [ ] **Step 2: Run, confirm FAIL. Step 3: Implement the files; PASS 3 times; `pnpm typecheck`. Step 4: Commit**

```
git add web/src/editor/library web/src/editor/i18n/library.ts web/test/editor/library.test.tsx web/test/editor/blank.test.ts
git commit -m "feat(web): editor library panel (formats, episodes, load for live)"
```

---

### Task 10: Timeline — blocks, drag, resize, keyboard

**Files:**
- Create: `web/src/editor/timeline/{TimelinePanel.tsx,BlockView.tsx,timeline.css}`, `web/test/editor/timeline.test.tsx`
- Modify: `web/src/editor/i18n/timeline.ts` (only)

**Interfaces:** `TimelinePanel(props: { widthPx?: number; timeZone?: string })`. Uses `layout`, `fitScale`, `dropIndex`, `resizeDuration`, `blockKeyIntent` (Task 5), `moveBlock`, `resizeBlock`, `addBlock`, `duplicateBlock`, `deleteBlock`, `splitBlock` (Task 4), `blockTimings`, `totalMs`, `plannedEndMs` (Task 4), `durationText`, `wallText` (core).

`web/src/editor/i18n/timeline.ts` (complete):
```ts
// SPDX-License-Identifier: GPL-2.0-or-later
export const IT_TIMELINE = {
  'timeline.title': 'Timeline',
  'timeline.addStudio': 'Aggiungi studio',
  'timeline.addBreak': 'Aggiungi break',
  'timeline.duplicate': 'Duplica',
  'timeline.split': 'Dividi',
  'timeline.delete': 'Elimina',
  'timeline.zoomIn': 'Ingrandisci',
  'timeline.zoomOut': 'Riduci',
  'timeline.fit': 'Adatta',
  'timeline.total': 'Durata totale {d}',
  'timeline.plannedEnd': 'Fine prevista {time}',
  'timeline.studioTime': 'Studio {d}',
  'timeline.belowThreshold': 'sotto soglia',
  'timeline.mediaExceeds': 'media oltre il blocco',
  'timeline.mediaCount': '{n} servizi',
  'timeline.unknownMedia': '{n} senza durata',
  'timeline.typeStudio': 'STUDIO',
  'timeline.typeBreak': 'BREAK',
  'timeline.elastic': 'elastico',
  'timeline.fixed': 'fisso',
  'timeline.blockLabel': 'Blocco {n}: {name}, {d}',
  'timeline.resizeHandle': 'Ridimensiona {name}',
  'timeline.empty': 'Nessun blocco: aggiungine uno',
  'timeline.newStudio': 'Blocco {n}',
  'timeline.newBreak': 'Break {n}',
  'timeline.copyOf': '{name} (copia)',
  'timeline.secondPart': '{name} (2)',
  'timeline.keysHelp': 'Frecce: seleziona · Alt+frecce: sposta · Maiusc+frecce: durata ±5 s (Ctrl: ±1 min) · Canc: elimina · Ctrl+D: duplica',
  'timeline.readOnly': 'Sola lettura',
} as const;

export const EN_TIMELINE: Record<keyof typeof IT_TIMELINE, string> = {
  'timeline.title': 'Timeline',
  'timeline.addStudio': 'Add studio',
  'timeline.addBreak': 'Add break',
  'timeline.duplicate': 'Duplicate',
  'timeline.split': 'Split',
  'timeline.delete': 'Delete',
  'timeline.zoomIn': 'Zoom in',
  'timeline.zoomOut': 'Zoom out',
  'timeline.fit': 'Fit',
  'timeline.total': 'Total duration {d}',
  'timeline.plannedEnd': 'Planned end {time}',
  'timeline.studioTime': 'Studio {d}',
  'timeline.belowThreshold': 'below threshold',
  'timeline.mediaExceeds': 'media exceed the block',
  'timeline.mediaCount': '{n} items',
  'timeline.unknownMedia': '{n} without duration',
  'timeline.typeStudio': 'STUDIO',
  'timeline.typeBreak': 'BREAK',
  'timeline.elastic': 'elastic',
  'timeline.fixed': 'fixed',
  'timeline.blockLabel': 'Block {n}: {name}, {d}',
  'timeline.resizeHandle': 'Resize {name}',
  'timeline.empty': 'No blocks: add one',
  'timeline.newStudio': 'Block {n}',
  'timeline.newBreak': 'Break {n}',
  'timeline.copyOf': '{name} (copy)',
  'timeline.secondPart': '{name} (2)',
  'timeline.keysHelp': 'Arrows: select · Alt+arrows: move · Shift+arrows: duration ±5 s (Ctrl: ±1 min) · Del: delete · Ctrl+D: duplicate',
  'timeline.readOnly': 'Read only',
};
```

**Behaviour (rules):**
1. Container `<div className="tl" data-testid="timeline">` with a toolbar (`role="toolbar"`, `aria-label="Timeline"`), a scroll area and the keys help line. Toolbar buttons: `Aggiungi studio`, `Aggiungi break`, `Duplica`, `Dividi`, `Elimina`, `Riduci`, `Ingrandisci`, `Adatta`. Summary: `Durata totale {d}` (`durationText(totalMs)`) and, **when the open document is an episode with a valid planned start**, `Fine prevista {time}` (`wallText(plannedEndMs, timeZone)`).
2. The track is `<ul aria-label="Timeline">`; each block is `<li data-testid="block-{id}" tabindex="0" aria-label="Blocco {n}: {name}, {d}" aria-current="true"|undefined>` positioned by `layout(blocks, scale)` (inline `width` px; `min-width:0`). Inside: the type tag, the name (ellipsis), the duration, for a studio block `Studio {d}` (`studioMs`) plus ` · sotto soglia` (class `is-warn`) when `0 <= studioMs < preset.warnMs`, or `media oltre il blocco` (class `is-error`) when `studioMs < 0`; `{n} servizi` when the block has media, `{n} senza durata` (class `is-warn`) when `unknownMedia > 0`; `elastico`/`fisso` for studio blocks; the scene for a break. A resize handle `<div data-testid="resize-{id}" role="separator" aria-orientation="vertical" aria-label="Ridimensiona {name}">` at the right edge.
3. **Scale:** `widthPx` prop, else the measured width of the scroll area, else 1000. Initial `scale = fitScale(total, widthPx)`; `Adatta` recomputes it; `Ingrandisci`/`Riduci` multiply/divide by 1.5 within `[MIN_SCALE, MAX_SCALE]`. The scale is **not** recomputed when a block is resized (no jitter during a drag). Mount the track under `key={doc.id}` so a different document starts with its own fit.
4. **Selection:** click or focus selects (`session.selection.select(id)`); `aria-current` follows `useSelection()`. When `revealTick` changes, scroll the block into view (`scrollIntoView?.({ block: 'nearest', inline: 'center' })`) and focus it.
5. **Keyboard** (on a focused block): `blockKeyIntent(event)`; when it returns an intent call `event.preventDefault()` and: `select` → select the neighbour and focus it; `move` → `moveBlock(i, i + delta)`; `resize` → `resizeBlock(id, durationMs + deltaMs)`; `delete` → `deleteBlock(id)` and select the neighbour; `duplicate` → `duplicateBlock(id, t('timeline.copyOf', {name}))`, select the copy. A keyboard resize ends its coalescing run on `keyup` (`session.seal()`), so each key press is its own undo step.
6. **Pointer drag (reorder):** `pointerdown` (primary button) on a block outside the handle records the start x and the block index; `pointermove` beyond 4 px shows a drop marker (`data-testid="drop-marker"`, positioned at the target boundary, `data-index` = target) using `dropIndex(slots, id, dx)`; `pointerup` applies `moveBlock(from, target)` when the target differs and then `seal()`. `pointercancel` and `Escape` abort. Under 4 px movement the gesture is a click (select only). Call `setPointerCapture?.()` guarded.
7. **Pointer resize:** `pointerdown` on the handle records the duration and x; every `pointermove` applies `resizeBlock(id, resizeDuration(start, dx, scale))` (coalesced into one undo step); `pointerup` seals.
8. **Toolbar:** `Aggiungi studio`/`Aggiungi break` add after the selected block (or at the end), named `Blocco {n}`/`Break {n}` with `n = blocks.length + 1`, and select the new block; `Duplica` and `Elimina` act on the selection; `Dividi` splits the selected studio block at `snapMs(durationMs / 2)` (`secondPart` name) and is disabled for a break or a block under 10 s. All buttons are disabled when read-only or (for the selection-based ones) with no selection.
9. Read-only: toolbar disabled, pointer gestures ignored, `Sola lettura` shown. Empty rundown: `Nessun blocco: aggiungine uno`.

- [ ] **Step 1: Write the failing tests** — `web/test/editor/timeline.test.tsx`:
```tsx
// SPDX-License-Identifier: GPL-2.0-or-later
import { fireEvent, screen, within } from '@testing-library/react';
import { beforeAll, describe, expect, it } from 'vitest';
import { TimelinePanel } from '../../src/editor/timeline/TimelinePanel';
import { FakeEditorApi, renderWithSession, sampleFormat } from '../support/editor';

beforeAll(() => {
  // jsdom without PointerEvent: a MouseEvent carries clientX/clientY, which is all the gestures read.
  (window as unknown as { PointerEvent?: unknown }).PointerEvent ??= MouseEvent;
});

const FORMAT = { kind: 'format', id: 'solo-futsal' } as const;
const EPISODE = { kind: 'episode', id: 'ep-2026-10-12' } as const;
const ids = (s: { store: { getSnapshot(): { doc: { blocks: Array<{ id: string }> } | null } } }) => s.store.getSnapshot().doc!.blocks.map((b) => b.id);
const block = (id: string) => screen.getByTestId(`block-${id}`);

async function setup(open = FORMAT as typeof FORMAT | typeof EPISODE) {
  const r = await renderWithSession(<TimelinePanel widthPx={1000} timeZone="UTC" />, { open });
  return r;
}

describe('TimelinePanel rendering', () => {
  it('shows every block with its name, duration, studio time and kind', async () => {
    await setup();
    expect(block('b1').getAttribute('aria-label')).toBe('Blocco 1: Primo blocco, 12:00');
    expect(within(block('b1')).getByText('Studio 9:00')).toBeTruthy();
    expect(within(block('b1')).getByText('1 servizi')).toBeTruthy();
    expect(within(block('br1')).getByText('BREAK')).toBeTruthy();
    expect(within(block('b3')).getByText('Studio 2:00')).toBeTruthy();
  });

  it('shows total duration, and the planned end only for an episode', async () => {
    const f = await setup(FORMAT);
    expect(screen.getByText('Durata totale 27:00')).toBeTruthy();
    expect(screen.queryByText(/Fine prevista/)).toBeNull();
    f.unmount();
    await setup(EPISODE);
    expect(screen.getByText('Fine prevista 17:27:00')).toBeTruthy(); // 19:00+02:00 + 27 min, in UTC
  });

  it('flags a block whose media exceed it and one with unknown media', async () => {
    const api = new FakeEditorApi();
    const f = sampleFormat();
    (f.blocks[0] as { elements: Array<Record<string, unknown>> }).elements[1] = {
      id: 'b1-m1', kind: 'media', title: 'S', path: 'x', occurrence: 0, plannedDurationMs: 800_000, durationSource: 'unknown',
    };
    api.formats.set('solo-futsal', f);
    await renderWithSession(<TimelinePanel widthPx={1000} />, { open: FORMAT, api });
    expect(within(block('b1')).getByText(/media oltre il blocco/)).toBeTruthy();
    expect(within(block('b1')).getByText('1 senza durata')).toBeTruthy();
  });

  it('shows an empty state', async () => {
    const api = new FakeEditorApi();
    const f = sampleFormat();
    f.blocks = [];
    api.formats.set('solo-futsal', f);
    await renderWithSession(<TimelinePanel widthPx={1000} />, { open: FORMAT, api });
    expect(screen.getByText('Nessun blocco: aggiungine uno')).toBeTruthy();
  });

  it('shows read-only mode for a live episode', async () => {
    const api = new FakeEditorApi();
    api.live = { episodeId: 'ep-2026-10-12', phase: 'live' };
    await renderWithSession(<TimelinePanel widthPx={1000} />, { open: EPISODE, api });
    expect(screen.getByText('Sola lettura')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Aggiungi studio' }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('selection and keyboard', () => {
  it('selects on click and moves the selection with the arrows', async () => {
    const { user } = await setup();
    await user.click(block('b2'));
    expect(block('b2').getAttribute('aria-current')).toBe('true');
    block('b2').focus();
    await user.keyboard('{ArrowLeft}');
    expect(block('br1').getAttribute('aria-current')).toBe('true');
  });

  it('Alt+Arrow moves the block to the next index', async () => {
    const { session, user } = await setup();
    block('b1').focus();
    await user.keyboard('{Alt>}{ArrowRight}{/Alt}');
    expect(ids(session)).toEqual(['br1', 'b1', 'b2', 'b3']);
  });

  it('Shift+Arrow resizes by 5 s and Ctrl+Shift+Arrow by 1 min; undo reverts the last key press', async () => {
    const { session, user } = await setup();
    block('b3').focus();
    await user.keyboard('{Shift>}{ArrowRight}{ArrowRight}{/Shift}');
    expect(session.store.getSnapshot().doc!.blocks[3]!.durationMs).toBe(130_000);
    await user.keyboard('{Control>}{Shift>}{ArrowLeft}{/Shift}{/Control}');
    expect(session.store.getSnapshot().doc!.blocks[3]!.durationMs).toBe(70_000);
    session.undo();
    expect(session.store.getSnapshot().doc!.blocks[3]!.durationMs).toBe(130_000);
  });

  it('Delete removes the block and Ctrl+D duplicates it; undo brings it back', async () => {
    const { session, user } = await setup();
    block('br1').focus();
    await user.keyboard('{Delete}');
    expect(ids(session)).toEqual(['b1', 'b2', 'b3']);
    session.undo();
    expect(ids(session)).toEqual(['b1', 'br1', 'b2', 'b3']);
    block('b3').focus();
    await user.keyboard('{Control>}d{/Control}');
    expect(ids(session)).toEqual(['b1', 'br1', 'b2', 'b3', 'blk-1']);
    expect(session.store.getSnapshot().doc!.blocks[4]!.name).toBe('Chiusura (copia)');
  });
});

describe('pointer gestures', () => {
  // 1000 px for 1 620 s => 0.000617 px/ms: b1 444 px, br1 111, b2 370, b3 74.
  it('dragging a block past the next one reorders (same result as the keyboard)', async () => {
    const { session } = await setup();
    const b1 = block('b1');
    fireEvent.pointerDown(b1, { clientX: 100, clientY: 5, pointerId: 1, button: 0, isPrimary: true });
    fireEvent.pointerMove(b1, { clientX: 400, clientY: 5, pointerId: 1, isPrimary: true });
    expect(screen.getByTestId('drop-marker').getAttribute('data-index')).toBe('1');
    fireEvent.pointerUp(b1, { clientX: 400, clientY: 5, pointerId: 1, isPrimary: true });
    expect(ids(session)).toEqual(['br1', 'b1', 'b2', 'b3']);
  });

  it('a small movement is a click, not a drag', async () => {
    const { session } = await setup();
    const b2 = block('b2');
    fireEvent.pointerDown(b2, { clientX: 600, clientY: 5, pointerId: 1, button: 0, isPrimary: true });
    fireEvent.pointerMove(b2, { clientX: 602, clientY: 5, pointerId: 1, isPrimary: true });
    fireEvent.pointerUp(b2, { clientX: 602, clientY: 5, pointerId: 1, isPrimary: true });
    expect(ids(session)).toEqual(['b1', 'br1', 'b2', 'b3']);
    expect(b2.getAttribute('aria-current')).toBe('true');
  });

  it('Escape aborts a drag', async () => {
    const { session } = await setup();
    const b1 = block('b1');
    fireEvent.pointerDown(b1, { clientX: 100, clientY: 5, pointerId: 1, button: 0, isPrimary: true });
    fireEvent.pointerMove(b1, { clientX: 400, clientY: 5, pointerId: 1, isPrimary: true });
    fireEvent.keyDown(b1, { key: 'Escape' });
    fireEvent.pointerUp(b1, { clientX: 400, clientY: 5, pointerId: 1, isPrimary: true });
    expect(ids(session)).toEqual(['b1', 'br1', 'b2', 'b3']);
  });

  it('dragging the handle resizes with a 5 s snap, as one undo step', async () => {
    const { session } = await setup();
    const handle = screen.getByTestId('resize-b1');
    fireEvent.pointerDown(handle, { clientX: 444, clientY: 5, pointerId: 1, button: 0, isPrimary: true });
    for (const x of [470, 490, 506]) fireEvent.pointerMove(handle, { clientX: x, clientY: 5, pointerId: 1, isPrimary: true });
    fireEvent.pointerUp(handle, { clientX: 506, clientY: 5, pointerId: 1, isPrimary: true });
    expect(session.store.getSnapshot().doc!.blocks[0]!.durationMs).toBe(820_000); // +62 px = +100.4 s -> snapped
    session.undo();
    expect(session.store.getSnapshot().doc!.blocks[0]!.durationMs).toBe(720_000);
  });

  it('ignores gestures when read-only', async () => {
    const api = new FakeEditorApi();
    api.live = { episodeId: 'ep-2026-10-12', phase: 'live' };
    const { session } = await renderWithSession(<TimelinePanel widthPx={1000} />, { open: EPISODE, api });
    const b1 = block('b1');
    fireEvent.pointerDown(b1, { clientX: 100, clientY: 5, pointerId: 1, button: 0, isPrimary: true });
    fireEvent.pointerMove(b1, { clientX: 400, clientY: 5, pointerId: 1, isPrimary: true });
    fireEvent.pointerUp(b1, { clientX: 400, clientY: 5, pointerId: 1, isPrimary: true });
    expect(ids(session)).toEqual(['b1', 'br1', 'b2', 'b3']);
  });
});

describe('toolbar', () => {
  it('adds a studio block after the selection and selects it', async () => {
    const { session, user } = await setup();
    await user.click(block('b1'));
    await user.click(screen.getByRole('button', { name: 'Aggiungi studio' }));
    expect(ids(session)).toEqual(['b1', 'blk-1', 'br1', 'b2', 'b3']);
    expect(session.selection.getSnapshot().blockId).toBe('blk-1');
    expect(session.store.getSnapshot().doc!.blocks[1]!.name).toBe('Blocco 5');
  });

  it('adds a break at the end when nothing is selected', async () => {
    const { session, user } = await setup();
    session.selection.select(null);
    await user.click(screen.getByRole('button', { name: 'Aggiungi break' }));
    expect(session.store.getSnapshot().doc!.blocks.at(-1)).toMatchObject({ kind: 'break', name: 'Break 5' });
  });

  it('splits the selected studio block in two halves, and not a break', async () => {
    const { session, user } = await setup();
    await user.click(block('b2'));
    await user.click(screen.getByRole('button', { name: 'Dividi' }));
    expect(session.store.getSnapshot().doc!.blocks.slice(2, 4).map((b) => b.durationMs)).toEqual([300_000, 300_000]);
    await user.click(block('br1'));
    expect((screen.getByRole('button', { name: 'Dividi' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('click-to-focus: a reveal request focuses the block', async () => {
    const { session } = await setup();
    session.selection.select('b3', { reveal: true });
    await screen.findByTestId('block-b3');
    expect(document.activeElement).toBe(block('b3'));
  });
});
```
- [ ] **Step 2: Run, confirm FAIL. Step 3: Implement; PASS 3 times; typecheck. Step 4: Commit**

```
git add web/src/editor/timeline/TimelinePanel.tsx web/src/editor/timeline/BlockView.tsx web/src/editor/timeline/timeline.css web/src/editor/i18n/timeline.ts web/test/editor/timeline.test.tsx
git commit -m "feat(web): editor timeline with drag reorder, resize handles and keyboard control"
```

---
### Task 11: Properties panel and elements of a studio block

**Files:**
- Create: `web/src/editor/props/{PropertiesPanel.tsx,ElementsList.tsx,duration-input.ts,props.css}`, `web/test/editor/duration-input.test.ts`, `web/test/editor/props.test.tsx`
- Modify: `web/src/editor/i18n/props.ts` (only)

**Interfaces:** `PropertiesPanel()` (no props; reads the selection); `ElementsList(props: { block: StudioBlock })`; `parseDuration(text): number | null`.

`web/src/editor/props/duration-input.ts`:
```ts
// SPDX-License-Identifier: GPL-2.0-or-later

/** "12:30" → 750000, "1:02:03", "90" (plain number = seconds), "0:05". Anything else, including negatives and decimals: null. */
export function parseDuration(text: string): number | null {
  const s = text.trim();
  if (s === '') return null;
  const parts = s.split(':');
  if (parts.length > 3 || parts.some((p) => !/^\d+$/.test(p))) return null;
  const n = parts.map(Number);
  let seconds: number;
  if (n.length === 1) seconds = n[0]!;
  else if (n.length === 2) {
    if (n[1]! > 59) return null;
    seconds = n[0]! * 60 + n[1]!;
  } else {
    if (n[1]! > 59 || n[2]! > 59) return null;
    seconds = n[0]! * 3600 + n[1]! * 60 + n[2]!;
  }
  return seconds * 1000;
}
```

`web/src/editor/i18n/props.ts` (complete):
```ts
// SPDX-License-Identifier: GPL-2.0-or-later
export const IT_PROPS = {
  'props.title': 'Proprietà',
  'props.none': 'Seleziona un blocco',
  'props.name': 'Nome',
  'props.duration': 'Durata',
  'props.durationInvalid': 'Durata non valida (es. 12:30)',
  'props.type': 'Tipo',
  'props.typeStudio': 'Studio',
  'props.typeBreak': 'Break',
  'props.elastic': 'Elastico',
  'props.sceneGroup': 'Gruppo di scene',
  'props.scene': 'Scena del break',
  'props.mediaInput': 'Sorgente media del break (facoltativa)',
  'props.studioTime': 'Tempo studio: {d}',
  'props.belowThreshold': 'sotto la soglia di {d}',
  'props.mediaExceeds': 'I servizi superano il blocco di {d}',
  'props.elements': 'Elementi',
  'props.studioPart': 'Parte studio',
  'props.addStudioPart': 'Aggiungi parte studio',
  'props.addMedia': 'Aggiungi servizio',
  'props.mediaTitle': 'Titolo servizio',
  'props.mediaPath': 'Percorso file',
  'props.mediaDuration': 'Durata servizio',
  'props.add': 'Aggiungi',
  'props.remove': 'Rimuovi',
  'props.moveUp': 'Su',
  'props.moveDown': 'Giù',
  'props.titleN': 'Titolo',
  'props.durationN': 'Durata',
  'props.originDeck': 'DECK',
  'props.originFile': 'FILE',
  'props.originFileRounded': 'FILE (s)',
  'props.originManual': 'MANUALE',
  'props.originUnknown': 'DURATA IGNOTA',
  'props.unknownDash': '—',
  'props.lastElement': 'Un blocco studio ha almeno un elemento',
} as const;

export const EN_PROPS: Record<keyof typeof IT_PROPS, string> = {
  'props.title': 'Properties',
  'props.none': 'Select a block',
  'props.name': 'Name',
  'props.duration': 'Duration',
  'props.durationInvalid': 'Invalid duration (e.g. 12:30)',
  'props.type': 'Type',
  'props.typeStudio': 'Studio',
  'props.typeBreak': 'Break',
  'props.elastic': 'Elastic',
  'props.sceneGroup': 'Scene group',
  'props.scene': 'Break scene',
  'props.mediaInput': 'Break media source (optional)',
  'props.studioTime': 'Studio time: {d}',
  'props.belowThreshold': 'below the {d} threshold',
  'props.mediaExceeds': 'Media exceed the block by {d}',
  'props.elements': 'Elements',
  'props.studioPart': 'Studio part',
  'props.addStudioPart': 'Add studio part',
  'props.addMedia': 'Add item',
  'props.mediaTitle': 'Item title',
  'props.mediaPath': 'File path',
  'props.mediaDuration': 'Item duration',
  'props.add': 'Add',
  'props.remove': 'Remove',
  'props.moveUp': 'Up',
  'props.moveDown': 'Down',
  'props.titleN': 'Title',
  'props.durationN': 'Duration',
  'props.originDeck': 'DECK',
  'props.originFile': 'FILE',
  'props.originFileRounded': 'FILE (s)',
  'props.originManual': 'MANUAL',
  'props.originUnknown': 'UNKNOWN DURATION',
  'props.unknownDash': '—',
  'props.lastElement': 'A studio block keeps at least one element',
};
```

**Behaviour (rules):**
1. The panel shows the block selected in `useSelection()`. None, or a block that no longer exists: `Seleziona un blocco`. The field inputs are keyed by the block id (and re-synchronised from the document on every change), so they never show the previous block's text.
2. Fields, all committed on blur/Enter through `session.apply`:
   - `Nome` (textbox) → `patchStudio`/`patchBreak({ name })`. An empty value is not committed and the input reverts on blur.
   - `Durata` (textbox showing `durationText(durationMs)`) → `parseDuration`; valid → `patch…({ durationMs })` (the operation snaps to 5 s and clamps to ≥ 5 s, the input then shows the stored value); invalid → `aria-invalid="true"`, the message `Durata non valida (es. 12:30)` under it, no edit.
   - `Tipo` (select, options `Studio` / `Break`) → `convertBlock(id, kind)`.
   - Studio: `Elastico` (checkbox) → `patchStudio({ elastic })`; `Gruppo di scene` (select of the document's groups, by name) → `patchStudio({ sceneGroupId })`.
   - Break: `Scena del break` (textbox with a `<datalist>` of the scenes from `api.obsScenes()` loaded once on mount, empty when OBS is offline) → `patchBreak({ scene })`; `Sorgente media del break (facoltativa)` → `patchBreak({ mediaInput })` (empty → `null`).
3. Studio blocks show `<p data-testid="studio-time">Tempo studio: {d}</p>`; class `is-warn` and ` · sotto la soglia di {warn}` when `0 <= studioMs < preset.warnMs`; class `is-error` and `I servizi superano il blocco di {over}` when negative.
4. **Elements** (`ElementsList`, studio blocks only): `<ol aria-label="Elementi">`, one `<li data-testid="el-{id}">` per element.
   - A studio element shows `Parte studio`.
   - A media element shows: `Titolo {n}` (textbox, edits `patchMedia({ title })`), the path (ellipsis, `title` attribute with the full path), `Durata {n}` (textbox with `durationText`, or empty with placeholder `—` when `durationSource === 'unknown'`) committing `parseDuration` → `patchMedia({ plannedDurationMs })` (which sets `manual`), and the origin badge `<span data-testid="origin-{id}">` with `DECK` / `FILE` / `FILE (s)` / `MANUALE` / `DURATA IGNOTA` (class `is-warn`; absent source: no badge). `n` is the 1-based position in the list.
   - Per row: `Su {n}`, `Giù {n}` (`moveElement`), `Rimuovi {n}` (`removeElement`; disabled when the block has one element, with `title="Un blocco studio ha almeno un elemento"`).
   - `Aggiungi parte studio` → `addStudioPart(blockId)`.
   - `Aggiungi servizio` opens a form: `Titolo servizio`, `Percorso file` (required), `Durata servizio` (optional); `Aggiungi` → `addMedia(blockId, { kind: 'media', title, path, occurrence, plannedDurationMs, durationSource })` where `occurrence` = number of media elements in the whole document with the same path, and a given duration is `manual`, an empty one is `plannedDurationMs: 0, durationSource: 'unknown'`.
5. Read-only: every control disabled.

- [ ] **Step 1: Write the failing tests**

`web/test/editor/duration-input.test.ts`:
```ts
// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import { parseDuration } from '../../src/editor/props/duration-input';

describe('parseDuration', () => {
  it.each([['12:30', 750_000], ['0:05', 5_000], ['1:02:03', 3_723_000], ['90', 90_000], [' 7:00 ', 420_000], ['0', 0]])('%j -> %i', (a, b) => {
    expect(parseDuration(a)).toBe(b);
  });
  it.each([[''], ['abc'], ['12:75'], ['1:60:00'], ['-5'], ['1.5'], ['1:2:3:4'], ['12:'], [':30']])('%j -> null', (a) => {
    expect(parseDuration(a)).toBeNull();
  });
});
```

`web/test/editor/props.test.tsx`:
```tsx
// SPDX-License-Identifier: GPL-2.0-or-later
import { fireEvent, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { StudioBlock } from '@olc/shared';
import { PropertiesPanel } from '../../src/editor/props/PropertiesPanel';
import { FakeEditorApi, renderWithSession, sampleEpisode, sampleFormat } from '../support/editor';

const FORMAT = { kind: 'format', id: 'solo-futsal' } as const;
const blocks = (s: { store: { getSnapshot(): { doc: { blocks: unknown[] } | null } } }) => s.store.getSnapshot().doc!.blocks as Array<Record<string, any>>;

async function setup(select: string | null = 'b1', prepare?: (f: ReturnType<typeof sampleFormat>) => void, api = new FakeEditorApi()) {
  const f = sampleFormat();
  prepare?.(f);
  api.formats.set('solo-futsal', f);
  const r = await renderWithSession(<PropertiesPanel />, { open: FORMAT, api });
  r.session.selection.select(select);
  return r;
}
const commit = (el: HTMLElement, value: string) => {
  fireEvent.change(el, { target: { value } });
  fireEvent.blur(el);
};

describe('block fields', () => {
  it('asks for a selection', async () => {
    await setup(null);
    expect(screen.getByText('Seleziona un blocco')).toBeTruthy();
  });

  it('shows the selected studio block and its studio time', async () => {
    await setup('b1');
    expect((screen.getByRole('textbox', { name: 'Nome' }) as HTMLInputElement).value).toBe('Primo blocco');
    expect((screen.getByRole('textbox', { name: 'Durata' }) as HTMLInputElement).value).toBe('12:00');
    expect((screen.getByRole('checkbox', { name: 'Elastico' }) as HTMLInputElement).checked).toBe(true);
    expect(screen.getByTestId('studio-time').textContent).toBe('Tempo studio: 9:00');
  });

  it('commits a rename on blur as one edit, and refuses an empty name', async () => {
    const { session } = await setup('b1');
    commit(screen.getByRole('textbox', { name: 'Nome' }), 'Apertura');
    expect(blocks(session)[0]!.name).toBe('Apertura');
    commit(screen.getByRole('textbox', { name: 'Nome' }), '   ');
    expect(blocks(session)[0]!.name).toBe('Apertura');
    expect((screen.getByRole('textbox', { name: 'Nome' }) as HTMLInputElement).value).toBe('Apertura');
  });

  it('accepts a valid duration (snapped to 5 s) and flags an invalid one without editing', async () => {
    const { session } = await setup('b3');
    commit(screen.getByRole('textbox', { name: 'Durata' }), '3:02');
    expect(blocks(session)[3]!.durationMs).toBe(180_000);
    commit(screen.getByRole('textbox', { name: 'Durata' }), '12:75');
    expect(screen.getByRole('textbox', { name: 'Durata' }).getAttribute('aria-invalid')).toBe('true');
    expect(screen.getByText('Durata non valida (es. 12:30)')).toBeTruthy();
    expect(blocks(session)[3]!.durationMs).toBe(180_000);
  });

  it('toggles elastic and changes the scene group', async () => {
    const { session } = await setup('b1', (f) => f.sceneGroups.push({ id: 'ospiti', name: 'Ospiti', scenes: ['CAM 4'] }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Elastico' }));
    expect(blocks(session)[0]!.elastic).toBe(false);
    fireEvent.change(screen.getByRole('combobox', { name: 'Gruppo di scene' }), { target: { value: 'ospiti' } });
    expect(blocks(session)[0]!.sceneGroupId).toBe('ospiti');
  });

  it('converts a studio block to a break and back', async () => {
    const { session } = await setup('b3');
    fireEvent.change(screen.getByRole('combobox', { name: 'Tipo' }), { target: { value: 'break' } });
    expect(blocks(session)[3]).toMatchObject({ id: 'b3', kind: 'break', scene: 'BREAK' });
    expect(await screen.findByRole('textbox', { name: 'Scena del break' })).toBeTruthy();
    fireEvent.change(screen.getByRole('combobox', { name: 'Tipo' }), { target: { value: 'studio' } });
    expect(blocks(session)[3]!.kind).toBe('studio');
  });

  it('edits a break scene and clears its optional media input', async () => {
    const { session } = await setup('br1');
    commit(screen.getByRole('textbox', { name: 'Scena del break' }), 'PAUSA');
    commit(screen.getByRole('textbox', { name: 'Sorgente media del break (facoltativa)' }), '');
    expect(blocks(session)[1]).toMatchObject({ scene: 'PAUSA', mediaInput: null });
  });

  it('offers the OBS scenes in a datalist when OBS is connected', async () => {
    await setup('br1');
    const list = document.querySelector('datalist')!;
    expect([...list.querySelectorAll('option')].map((o) => o.getAttribute('value'))).toContain('PLAYOUT');
  });

  it('warns when the studio time is under the threshold and errors when media exceed the block', async () => {
    const { session } = await setup('b3');
    commit(screen.getByRole('textbox', { name: 'Durata' }), '1:30'); // 90 s, no media: 90 s >= 60 s threshold
    expect(screen.getByTestId('studio-time').className).not.toMatch(/is-warn|is-error/);
    commit(screen.getByRole('textbox', { name: 'Durata' }), '0:30');
    expect(screen.getByTestId('studio-time').className).toContain('is-warn');
    expect(screen.getByTestId('studio-time').textContent).toContain('sotto la soglia di 1:00');
    session.selection.select('b1');
    commit(await screen.findByRole('textbox', { name: 'Durata' }), '2:00'); // 120 s block with 180 s media
    expect(screen.getByTestId('studio-time').className).toContain('is-error');
    expect(screen.getByText(/I servizi superano il blocco di 1:00/)).toBeTruthy();
  });

  it('disables everything when the episode is live', async () => {
    const api = new FakeEditorApi();
    api.live = { episodeId: 'ep-2026-10-12', phase: 'live' };
    api.episodes.set('ep-2026-10-12', sampleEpisode());
    await renderWithSession(<PropertiesPanel />, { open: { kind: 'episode', id: 'ep-2026-10-12' }, api });
    expect((screen.getByRole('textbox', { name: 'Nome' }) as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByRole('checkbox', { name: 'Elastico' }) as HTMLInputElement).disabled).toBe(true);
  });
});

describe('elements', () => {
  it('lists the elements with their origin and duration', async () => {
    await setup('b1', (f) => {
      const b = f.blocks[0] as StudioBlock;
      b.elements[1] = { ...(b.elements[1] as object), durationSource: 'deck' } as never;
    });
    const list = screen.getByRole('list', { name: 'Elementi' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(3);
    expect(within(screen.getByTestId('el-b1-s1')).getByText('Parte studio')).toBeTruthy();
    expect((screen.getByRole('textbox', { name: 'Titolo 2' }) as HTMLInputElement).value).toBe('Servizio 1');
    expect((screen.getByRole('textbox', { name: 'Durata 2' }) as HTMLInputElement).value).toBe('3:00');
    expect(screen.getByTestId('origin-b1-m1').textContent).toBe('DECK');
  });

  it('shows an unknown duration as a dash with a warning badge, never 0:00', async () => {
    await setup('b1', (f) => {
      const b = f.blocks[0] as StudioBlock;
      b.elements[1] = { ...(b.elements[1] as object), plannedDurationMs: 0, durationSource: 'unknown' } as never;
    });
    const input = screen.getByRole('textbox', { name: 'Durata 2' }) as HTMLInputElement;
    expect(input.value).toBe('');
    expect(input.placeholder).toBe('—');
    expect(screen.getByTestId('origin-b1-m1').textContent).toBe('DURATA IGNOTA');
    expect(screen.getByTestId('origin-b1-m1').className).toContain('is-warn');
  });

  it('a typed duration becomes MANUALE and moves the studio time', async () => {
    const { session } = await setup('b1');
    commit(screen.getByRole('textbox', { name: 'Durata 2' }), '4:00');
    expect(blocks(session)[0]!.elements[1]).toMatchObject({ plannedDurationMs: 240_000, durationSource: 'manual' });
    expect(screen.getByTestId('origin-b1-m1').textContent).toBe('MANUALE');
    expect(screen.getByTestId('studio-time').textContent).toBe('Tempo studio: 8:00');
  });

  it('removes, moves, and keeps the last element', async () => {
    const { session } = await setup('b1');
    fireEvent.click(screen.getByRole('button', { name: 'Giù 1' }));
    expect(blocks(session)[0]!.elements.map((e: { id: string }) => e.id)).toEqual(['b1-m1', 'b1-s1', 'b1-s2']);
    fireEvent.click(screen.getByRole('button', { name: 'Rimuovi 1' }));
    expect(blocks(session)[0]!.elements).toHaveLength(2);
    session.selection.select('b3');
    const only = await screen.findByRole('button', { name: 'Rimuovi 1' });
    expect((only as HTMLButtonElement).disabled).toBe(true);
    expect(only.getAttribute('title')).toBe('Un blocco studio ha almeno un elemento');
  });

  it('adds a studio part and a manual item with the next occurrence of its path', async () => {
    const { session, user } = await setup('b3');
    fireEvent.click(screen.getByRole('button', { name: 'Aggiungi parte studio' }));
    expect(blocks(session)[3]!.elements).toHaveLength(2);
    await user.click(screen.getByRole('button', { name: 'Aggiungi servizio' }));
    await user.type(screen.getByRole('textbox', { name: 'Titolo servizio' }), 'Ripetuto');
    await user.type(screen.getByRole('textbox', { name: 'Percorso file' }), 'D:/media/servizio1.mp4');
    await user.type(screen.getByRole('textbox', { name: 'Durata servizio' }), '0:45');
    await user.click(screen.getByRole('button', { name: 'Aggiungi' }));
    expect(blocks(session)[3]!.elements.at(-1)).toMatchObject({
      kind: 'media', title: 'Ripetuto', path: 'D:/media/servizio1.mp4', occurrence: 1, plannedDurationMs: 45_000, durationSource: 'manual',
    });
  });

  it('an item added without a duration is unknown, not zero', async () => {
    const { session, user } = await setup('b3');
    await user.click(screen.getByRole('button', { name: 'Aggiungi servizio' }));
    await user.type(screen.getByRole('textbox', { name: 'Titolo servizio' }), 'Senza');
    await user.type(screen.getByRole('textbox', { name: 'Percorso file' }), 'D:/x.mp4');
    await user.click(screen.getByRole('button', { name: 'Aggiungi' }));
    expect(blocks(session)[3]!.elements.at(-1)).toMatchObject({ plannedDurationMs: 0, durationSource: 'unknown' });
  });
});
```
- [ ] **Step 2: Run, confirm FAIL. Step 3: Implement; PASS 3 times; typecheck. Step 4: Commit**

```
git add web/src/editor/props web/src/editor/i18n/props.ts web/test/editor/duration-input.test.ts web/test/editor/props.test.tsx
git commit -m "feat(web): editor properties panel and block elements"
```

---

### Task 12: Format and episode settings — preset, scene groups, messages

**Files:**
- Create: `web/src/editor/settings/{SettingsPanel.tsx,settings.css}`, `web/test/editor/settings.test.tsx`
- Modify: `web/src/editor/i18n/settings.ts` (only)

**Interfaces:** `SettingsPanel()` (no props).

`web/src/editor/i18n/settings.ts` (complete):
```ts
// SPDX-License-Identifier: GPL-2.0-or-later
export const IT_SETTINGS = {
  'settings.title': 'Impostazioni',
  'settings.docName': 'Nome del documento',
  'settings.episode': 'Puntata',
  'settings.date': 'Data',
  'settings.plannedStart': 'Inizio previsto',
  'settings.playlist': 'Nome playlist',
  'settings.mode': 'Modalità di produzione',
  'settings.modeStreaming': 'Streaming',
  'settings.modeTv': 'TV',
  'settings.modeLiveToTape': 'Live-to-tape',
  'settings.modeNote': 'Cambiare modalità ripristina le soglie ai valori di default (annullabile).',
  'settings.warnS': 'Soglia di avviso studio (s)',
  'settings.returnS': 'Rientro imminente (s)',
  'settings.stepS': 'Passo ±tempo (s)',
  'settings.recPause': 'La pausa REC congela il programma',
  'settings.sceneGroups': 'Gruppi di scene',
  'settings.groupNameN': 'Nome gruppo',
  'settings.removeGroup': 'Rimuovi gruppo',
  'settings.groupInUse': 'Gruppo usato da un blocco',
  'settings.sceneN': 'Nome scena',
  'settings.addScene': 'Aggiungi scena',
  'settings.removeScene': 'Rimuovi scena',
  'settings.sceneNotInObs': 'scena assente in OBS',
  'settings.lastScene': 'Un gruppo ha almeno una scena',
  'settings.newGroupName': 'Nome nuovo gruppo',
  'settings.newGroup': 'Nuovo gruppo',
  'settings.placeholderScene': 'SCENA 1',
  'settings.obsOffline': 'OBS non connesso: scrivi i nomi delle scene a mano',
  'settings.messages': 'Messaggi',
  'settings.messageText': 'Testo messaggio',
  'settings.messageDismiss': 'Chiusura',
  'settings.dismissTimeout': 'Dopo un tempo',
  'settings.dismissManual': 'Manuale',
  'settings.messageSeconds': 'Secondi',
  'settings.removeMessage': 'Rimuovi messaggio',
  'settings.newMessageText': 'Testo nuovo messaggio',
  'settings.newMessage': 'Nuovo messaggio',
} as const;

export const EN_SETTINGS: Record<keyof typeof IT_SETTINGS, string> = {
  'settings.title': 'Settings',
  'settings.docName': 'Document name',
  'settings.episode': 'Episode',
  'settings.date': 'Date',
  'settings.plannedStart': 'Planned start',
  'settings.playlist': 'Playlist name',
  'settings.mode': 'Production mode',
  'settings.modeStreaming': 'Streaming',
  'settings.modeTv': 'TV',
  'settings.modeLiveToTape': 'Live-to-tape',
  'settings.modeNote': 'Changing the mode resets the thresholds to their defaults (undoable).',
  'settings.warnS': 'Studio warning threshold (s)',
  'settings.returnS': 'Return imminent (s)',
  'settings.stepS': 'Adjust step (s)',
  'settings.recPause': 'REC pause freezes the program',
  'settings.sceneGroups': 'Scene groups',
  'settings.groupNameN': 'Group name',
  'settings.removeGroup': 'Remove group',
  'settings.groupInUse': 'Group used by a block',
  'settings.sceneN': 'Scene name',
  'settings.addScene': 'Add scene',
  'settings.removeScene': 'Remove scene',
  'settings.sceneNotInObs': 'scene not in OBS',
  'settings.lastScene': 'A group keeps at least one scene',
  'settings.newGroupName': 'New group name',
  'settings.newGroup': 'New group',
  'settings.placeholderScene': 'SCENE 1',
  'settings.obsOffline': 'OBS is not connected: type the scene names by hand',
  'settings.messages': 'Messages',
  'settings.messageText': 'Message text',
  'settings.messageDismiss': 'Dismiss',
  'settings.dismissTimeout': 'After a time',
  'settings.dismissManual': 'Manual',
  'settings.messageSeconds': 'Seconds',
  'settings.removeMessage': 'Remove message',
  'settings.newMessageText': 'New message text',
  'settings.newMessage': 'New message',
};
```

**Behaviour (rules)** — every edit through `session.apply`, commits on blur/Enter (checkboxes and selects commit on change):
1. `Nome del documento` → `renameDoc`.
2. **Episodes only** (`'formatId' in doc`), in a fieldset `Puntata`: `Data` (`type=date`, value `doc.date`) → `patchEpisodeMeta({ date })`; `Inizio previsto` (`type=time`, value `timeOfDay(doc.plannedStart)` or `''`) → `patchEpisodeMeta({ plannedStart: value === '' ? null : toIsoWithOffset(doc.date, value) })`; `Nome playlist` → `patchEpisodeMeta({ playlistName })`.
3. `Modalità di produzione` (select `streaming` / `tv` / `live_to_tape`, value `doc.preset.mode`) → `applyMode`; the note `modeNote` is shown next to it.
4. Number inputs in **seconds**, showing `ms / 1000`, committing `Math.round(value * 1000)` through `setPreset`: `Soglia di avviso studio (s)` → `warnMs`, `Rientro imminente (s)` → `returnImminentMs`, `Passo ±tempo (s)` → `adjustStepMs` (minimum 1 s: a smaller value is not committed and the input reverts). Checkbox `La pausa REC congela il programma` → `setPreset({ recPauseFreezesProgram })`.
5. **Scene groups** (`<section aria-label="Gruppi di scene">`): each group is `<fieldset data-testid="group-{id}">` with `Nome gruppo {id}` (textbox → `patchSceneGroup({ name })`), its scenes as rows (`<li>` with the scene name, `Rimuovi scena {scene}` → `patchSceneGroup({ scenes: without })`, disabled for the last scene with `title="Un gruppo ha almeno una scena"`; the element holding the name of a scene missing from `api.obsScenes()` gets class `is-warn` and `title="scena assente in OBS"`, only when OBS is connected), `Nome scena {id}` (textbox with a `<datalist>` of the OBS scenes) plus `Aggiungi scena {id}` (button, adds the typed name if non-empty and not already in the group), and `Rimuovi gruppo {id}` (→ `removeSceneGroup`; **disabled while a block uses the group**, `title="Gruppo usato da un blocco"`). `Nome nuovo gruppo` + `Nuovo gruppo` → `addSceneGroup(name, 'SCENA 1')`. When `api.obsScenes()` returns `null`, show `OBS non connesso: scrivi i nomi delle scene a mano` once in the section. The scenes are read once on mount.
6. **Messages** (`<section aria-label="Messaggi">`): each `<li data-testid="msg-{id}">` has `Testo messaggio {id}` (maxLength 80 → `patchMessage({ text })`), `Chiusura {id}` (select `timeout` / `manual` → `patchMessage({ dismiss })`; `timeout` uses the current ms or 10 000), `Secondi {id}` (number, only for `timeout`, minimum 1 → `patchMessage({ dismiss: { kind: 'timeout', ms } })`), `Rimuovi messaggio {id}`. `Testo nuovo messaggio` + `Nuovo messaggio` → `addMessage(text)`.
7. Read-only: everything disabled.

- [ ] **Step 1: Write the failing tests** — `web/test/editor/settings.test.tsx`:
```tsx
// SPDX-License-Identifier: GPL-2.0-or-later
import { fireEvent, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { toIsoWithOffset } from '../../src/editor/model/time';
import { SettingsPanel } from '../../src/editor/settings/SettingsPanel';
import { FakeEditorApi, renderWithSession, sampleEpisode, sampleFormat } from '../support/editor';

const FORMAT = { kind: 'format', id: 'solo-futsal' } as const;
const EPISODE = { kind: 'episode', id: 'ep-2026-10-12' } as const;
const doc = (s: { store: { getSnapshot(): { doc: any } } }) => s.store.getSnapshot().doc;
const commit = (el: HTMLElement, value: string) => {
  fireEvent.change(el, { target: { value } });
  fireEvent.blur(el);
};

async function setup(open = FORMAT as typeof FORMAT | typeof EPISODE, api = new FakeEditorApi()) {
  api.formats.set('solo-futsal', sampleFormat());
  api.episodes.set('ep-2026-10-12', sampleEpisode());
  return renderWithSession(<SettingsPanel />, { open, api });
}

describe('document and episode fields', () => {
  it('renames the document', async () => {
    const r = await setup();
    commit(screen.getByRole('textbox', { name: 'Nome del documento' }), 'Calcio a 5');
    expect(doc(r.session).name).toBe('Calcio a 5');
  });

  it('shows the episode fieldset only for an episode and edits date, planned start and playlist', async () => {
    const f = await setup(FORMAT);
    expect(screen.queryByLabelText('Inizio previsto')).toBeNull();
    f.unmount();
    const r = await setup(EPISODE);
    commit(screen.getByLabelText('Data'), '2026-11-02');
    expect(doc(r.session).date).toBe('2026-11-02');
    commit(screen.getByLabelText('Inizio previsto'), '20:15');
    expect(doc(r.session).plannedStart).toBe(toIsoWithOffset('2026-11-02', '20:15'));
    commit(screen.getByLabelText('Inizio previsto'), '');
    expect(doc(r.session).plannedStart).toBeNull();
    commit(screen.getByRole('textbox', { name: 'Nome playlist' }), 'Serata');
    expect(doc(r.session).playlistName).toBe('Serata');
  });
});

describe('preset', () => {
  it('changing the mode resets the preset, and undo restores it', async () => {
    const r = await setup();
    expect((screen.getByRole('combobox', { name: 'Modalità di produzione' }) as HTMLSelectElement).value).toBe('live_to_tape');
    fireEvent.change(screen.getByRole('combobox', { name: 'Modalità di produzione' }), { target: { value: 'tv' } });
    expect(doc(r.session).preset).toMatchObject({ mode: 'tv', recPauseFreezesProgram: false });
    r.session.undo();
    expect(doc(r.session).preset.mode).toBe('live_to_tape');
  });

  it('edits the thresholds in seconds and refuses a step under one second', async () => {
    const r = await setup();
    expect((screen.getByRole('spinbutton', { name: 'Soglia di avviso studio (s)' }) as HTMLInputElement).value).toBe('60');
    commit(screen.getByRole('spinbutton', { name: 'Soglia di avviso studio (s)' }), '90');
    expect(doc(r.session).preset.warnMs).toBe(90_000);
    commit(screen.getByRole('spinbutton', { name: 'Rientro imminente (s)' }), '15');
    expect(doc(r.session).preset.returnImminentMs).toBe(15_000);
    commit(screen.getByRole('spinbutton', { name: 'Passo ±tempo (s)' }), '0.5');
    expect(doc(r.session).preset.adjustStepMs).toBe(30_000);
    expect((screen.getByRole('spinbutton', { name: 'Passo ±tempo (s)' }) as HTMLInputElement).value).toBe('30');
  });

  it('toggles the REC pause rule', async () => {
    const r = await setup();
    fireEvent.click(screen.getByRole('checkbox', { name: 'La pausa REC congela il programma' }));
    expect(doc(r.session).preset.recPauseFreezesProgram).toBe(false);
  });
});

describe('scene groups', () => {
  it('renames a group, adds a scene typed by hand or picked from OBS, and removes one', async () => {
    const r = await setup();
    commit(screen.getByRole('textbox', { name: 'Nome gruppo studio' }), 'Studio principale');
    expect(doc(r.session).sceneGroups[0].name).toBe('Studio principale');
    commit(screen.getByRole('textbox', { name: 'Nome scena studio' }), 'PLAYOUT');
    fireEvent.click(screen.getByRole('button', { name: 'Aggiungi scena studio' }));
    expect(doc(r.session).sceneGroups[0].scenes).toEqual(['CAM 1', 'CAM 2', 'CAM 3', 'PLAYOUT']);
    fireEvent.click(screen.getByRole('button', { name: 'Rimuovi scena CAM 2' }));
    expect(doc(r.session).sceneGroups[0].scenes).toEqual(['CAM 1', 'CAM 3', 'PLAYOUT']);
  });

  it('offers the OBS scenes in a datalist and marks a scene OBS does not have', async () => {
    const api = new FakeEditorApi();
    api.scenes = ['CAM 1', 'CAM 2', 'PLAYOUT'];
    await setup(FORMAT, api);
    const options = [...document.querySelectorAll('datalist option')].map((o) => o.getAttribute('value'));
    expect(options).toContain('PLAYOUT');
    await screen.findByTestId('group-studio');
    expect(within(screen.getByTestId('group-studio')).getByText('CAM 3').className).toContain('is-warn');
    expect(within(screen.getByTestId('group-studio')).getByText('CAM 1').className).not.toContain('is-warn');
  });

  it('says OBS is offline and still lets the director type', async () => {
    const api = new FakeEditorApi();
    api.scenes = null;
    await setup(FORMAT, api);
    expect(await screen.findByText('OBS non connesso: scrivi i nomi delle scene a mano')).toBeTruthy();
  });

  it('keeps a group that a block uses and the last scene of a group; removes an unused group', async () => {
    const r = await setup();
    expect((screen.getByRole('button', { name: 'Rimuovi gruppo studio' }) as HTMLButtonElement).disabled).toBe(true);
    commit(screen.getByRole('textbox', { name: 'Nome nuovo gruppo' }), 'Ospiti');
    fireEvent.click(screen.getByRole('button', { name: 'Nuovo gruppo' }));
    expect(doc(r.session).sceneGroups.map((g: { id: string }) => g.id)).toEqual(['studio', 'ospiti']);
    expect((screen.getByRole('button', { name: 'Rimuovi scena SCENA 1' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Rimuovi gruppo ospiti' }));
    expect(doc(r.session).sceneGroups).toHaveLength(1);
  });
});

describe('messages', () => {
  it('edits, switches the dismissal mode, adds and removes messages', async () => {
    const r = await setup();
    commit(screen.getByRole('textbox', { name: 'Testo messaggio stringi' }), 'STRINGERE');
    expect(doc(r.session).messages[0].text).toBe('STRINGERE');
    expect((screen.getByRole('spinbutton', { name: 'Secondi stringi' }) as HTMLInputElement).value).toBe('10');
    commit(screen.getByRole('spinbutton', { name: 'Secondi stringi' }), '5');
    expect(doc(r.session).messages[0].dismiss).toEqual({ kind: 'timeout', ms: 5_000 });
    fireEvent.change(screen.getByRole('combobox', { name: 'Chiusura stringi' }), { target: { value: 'manual' } });
    expect(doc(r.session).messages[0].dismiss).toEqual({ kind: 'manual' });
    expect(screen.queryByRole('spinbutton', { name: 'Secondi stringi' })).toBeNull();
    commit(screen.getByRole('textbox', { name: 'Testo nuovo messaggio' }), 'PAUSA');
    fireEvent.click(screen.getByRole('button', { name: 'Nuovo messaggio' }));
    expect(doc(r.session).messages.map((m: { id: string }) => m.id)).toEqual(['stringi', 'cam2', 'pausa']);
    fireEvent.click(screen.getByRole('button', { name: 'Rimuovi messaggio cam2' }));
    expect(doc(r.session).messages.map((m: { id: string }) => m.id)).toEqual(['stringi', 'pausa']);
  });

  it('is read-only when the episode is live', async () => {
    const api = new FakeEditorApi();
    api.live = { episodeId: 'ep-2026-10-12', phase: 'live' };
    await setup(EPISODE, api);
    expect((screen.getByRole('textbox', { name: 'Testo messaggio stringi' }) as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByRole('checkbox', { name: 'La pausa REC congela il programma' }) as HTMLInputElement).disabled).toBe(true);
  });
});
```
- [ ] **Step 2: Run, confirm FAIL. Step 3: Implement; PASS 3 times; typecheck. Step 4: Commit**

```
git add web/src/editor/settings web/src/editor/i18n/settings.ts web/test/editor/settings.test.tsx
git commit -m "feat(web): editor settings panel (preset, scene groups, messages, episode data)"
```

---

### Task 13: Playlist import UI — deck and file

**Files:**
- Create: `web/src/editor/import/{ImportPanel.tsx,read-file.ts,import.css}`, `web/test/editor/import-panel.test.tsx`
- Modify: `web/src/editor/i18n/import.ts` (only)

**Interfaces:** `ImportPanel()` (no props); `readFileText(file: Blob): Promise<string>`. Uses `planPlacement`, `importEdit`, `withOccurrences`, `Candidate` (Task 7), `parsePlaylistFile` (Task 6), `api.deckItems()` (Task 8).

`web/src/editor/import/read-file.ts`:
```ts
// SPDX-License-Identifier: GPL-2.0-or-later

/** `Blob.text()` where it exists, a FileReader otherwise (old CEF, some test environments). */
export function readFileText(file: Blob): Promise<string> {
  if (typeof file.text === 'function') return file.text();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });
}
```

`web/src/editor/i18n/import.ts` (complete):
```ts
// SPDX-License-Identifier: GPL-2.0-or-later
export const IT_IMPORT = {
  'import.title': 'Importa servizi',
  'import.fromDeck': 'Da Playlist Deck (dal vivo)',
  'import.readDeck': 'Leggi playlist',
  'import.fromFile': 'Da file',
  'import.chooseFile': 'Scegli file playlist',
  'import.deckObs': 'OBS non connesso',
  'import.deckAbsent': 'Playlist Deck non installato',
  'import.deckNotReady': 'Playlist Deck non ancora pronto: riprova',
  'import.found': '{n} servizi trovati',
  'import.originDeck': 'DECK',
  'import.originFile': 'FILE',
  'import.originFileRounded': 'FILE (s)',
  'import.unknownDuration': 'Durata ignota: da inserire a mano',
  'import.relativePath': 'percorso relativo: potrebbe non corrispondere alla playlist',
  'import.skipped': '{n} righe senza percorso ignorate',
  'import.parseEmpty': 'File vuoto',
  'import.parseUnrecognised': 'Formato non riconosciuto (JSON, CSV o M3U)',
  'import.parseNoItems': 'Nessun servizio nel file',
  'import.where': 'Dove inserirli',
  'import.placeAppend': 'In coda al blocco',
  'import.targetBlock': 'Blocco di destinazione',
  'import.placeSequence': 'Distribuisci nei blocchi studio',
  'import.importN': 'Importa {n} servizi',
  'import.result': 'Aggiunti {added} · già presenti {existing} · senza durata {unknown}',
  'import.nothingNew': 'Nessun servizio nuovo: tutti già presenti',
  'import.noStudio': 'Nessun blocco studio',
  'import.readFailed': 'Impossibile leggere il file',
} as const;

export const EN_IMPORT: Record<keyof typeof IT_IMPORT, string> = {
  'import.title': 'Import items',
  'import.fromDeck': 'From Playlist Deck (live)',
  'import.readDeck': 'Read playlist',
  'import.fromFile': 'From file',
  'import.chooseFile': 'Choose playlist file',
  'import.deckObs': 'OBS is not connected',
  'import.deckAbsent': 'Playlist Deck is not installed',
  'import.deckNotReady': 'Playlist Deck is not ready yet: try again',
  'import.found': '{n} items found',
  'import.originDeck': 'DECK',
  'import.originFile': 'FILE',
  'import.originFileRounded': 'FILE (s)',
  'import.unknownDuration': 'Unknown duration: enter it by hand',
  'import.relativePath': 'relative path: it may not match the playlist',
  'import.skipped': '{n} rows without a path were ignored',
  'import.parseEmpty': 'Empty file',
  'import.parseUnrecognised': 'Unrecognised format (JSON, CSV or M3U)',
  'import.parseNoItems': 'No items in the file',
  'import.where': 'Where to put them',
  'import.placeAppend': 'At the end of block',
  'import.targetBlock': 'Target block',
  'import.placeSequence': 'Spread over the studio blocks',
  'import.importN': 'Import {n} items',
  'import.result': 'Added {added} · already there {existing} · no duration {unknown}',
  'import.nothingNew': 'Nothing new: all items are already in the rundown',
  'import.noStudio': 'No studio block',
  'import.readFailed': 'The file could not be read',
};
```

**Behaviour (rules):**
1. **Deck source:** button `Leggi playlist` → `api.deckItems()`. `unavailable` shows `OBS non connesso` / `Playlist Deck non installato` / `Playlist Deck non ancora pronto: riprova` (in a `role="status"` line); `ok` fills the preview with candidates `{ title, path, occurrence (from the server), durationMs, origin: 'deck' }`.
2. **File source:** `<input type="file" aria-label="Scegli file playlist" accept=".json,.csv,.m3u,.m3u8,.txt">`. On change: `readFileText` → `parsePlaylistFile(text, file.name)`. Success → candidates from `withOccurrences(items)` with `origin` = `durationOrigin` (`file`, `file_rounded`, `unknown`); failure shows `parseEmpty` / `parseUnrecognised` / `parseNoItems`; a read error shows `readFailed`. The file's text is data: rendered as text nodes only.
3. **Preview** (`<ul aria-label="Anteprima">`): `{n} servizi trovati`; each row `<li data-testid="imp-row-{i}">` shows the title, the path (ellipsis), the duration (`durationText`, or `—` when unknown, with the warning `Durata ignota: da inserire a mano` and class `is-warn`), the origin badge (`DECK` / `FILE` / `FILE (s)`), and `percorso relativo: …` (class `is-warn`) for a relative path. When the parser skipped rows: `{n} righe senza percorso ignorate`.
3b. Exactly one element has `role="status"`: the line that shows the deck-unavailable and the parsing messages. The result line and the skipped-rows note are plain paragraphs.
4. **Placement:** radio `In coda al blocco` (default) with a select `Blocco di destinazione` listing the studio blocks by name (default = the selected block if it is a studio block, else the first one), and radio `Distribuisci nei blocchi studio`. No studio block: `Nessun blocco studio` and the import button is disabled.
5. **Import:** button `Importa {n} servizi` (`n` = preview length; disabled when empty or read-only). It computes `planPlacement(doc, candidates, mode)` **against the current document at click time** and applies `importEdit(plan)` as one edit. The result line `<p data-testid="imp-result">` shows `Aggiunti {added} · già presenti {existing} · senza durata {unknown}`; when nothing was added it shows `Nessun servizio nuovo: tutti già presenti`. Pressing the button again therefore adds nothing (Review Focus 4).
6. Read-only: file input, buttons and radios disabled.

- [ ] **Step 1: Write the failing tests** — `web/test/editor/import-panel.test.tsx`:
```tsx
// SPDX-License-Identifier: GPL-2.0-or-later
import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ImportPanel } from '../../src/editor/import/ImportPanel';
import { FakeEditorApi, renderWithSession, sampleEpisode } from '../support/editor';

const FORMAT = { kind: 'format', id: 'solo-futsal' } as const;
const media = (s: { store: { getSnapshot(): { doc: any } } }, blockId: string) =>
  s.store.getSnapshot().doc.blocks.find((b: { id: string }) => b.id === blockId).elements.filter((e: { kind: string }) => e.kind === 'media');

const DECK = {
  state: 'ok' as const,
  items: [
    { index: 0, path: 'D:/media/nuovo1.mp4', title: 'Nuovo 1', durationMs: 90_000, occurrence: 0 },
    { index: 1, path: 'D:/media/ignoto.mp4', title: 'Ignoto', durationMs: -1, occurrence: 0 },
  ],
};

async function setup(prepare?: (api: FakeEditorApi) => void, select: string | null = 'b3') {
  const api = new FakeEditorApi();
  prepare?.(api);
  const r = await renderWithSession(<ImportPanel />, { open: FORMAT, api });
  r.session.selection.select(select);
  return r;
}

describe('deck source', () => {
  it.each([
    ['obs_not_connected', 'OBS non connesso'],
    ['deck_absent', 'Playlist Deck non installato'],
    ['deck_not_ready', 'Playlist Deck non ancora pronto: riprova'],
  ] as const)('explains %s', async (reason, text) => {
    const { user } = await setup((a) => {
      a.deck = { state: 'unavailable', reason };
    });
    await user.click(screen.getByRole('button', { name: 'Leggi playlist' }));
    expect((await screen.findByRole('status')).textContent).toContain(text);
  });

  it('previews the deck items with origin and an unknown duration shown as a dash', async () => {
    const { user } = await setup((a) => {
      a.deck = DECK;
    });
    await user.click(screen.getByRole('button', { name: 'Leggi playlist' }));
    expect(await screen.findByText('2 servizi trovati')).toBeTruthy();
    expect(within(screen.getByTestId('imp-row-0')).getByText('1:30')).toBeTruthy();
    expect(within(screen.getByTestId('imp-row-0')).getByText('DECK')).toBeTruthy();
    const unknown = screen.getByTestId('imp-row-1');
    expect(within(unknown).getByText('—')).toBeTruthy();
    expect(within(unknown).getByText('Durata ignota: da inserire a mano')).toBeTruthy();
  });

  it('imports into the chosen block as media with their origin, one undo step', async () => {
    const { session, user } = await setup((a) => {
      a.deck = DECK;
    });
    await user.click(screen.getByRole('button', { name: 'Leggi playlist' }));
    await user.click(await screen.findByRole('button', { name: 'Importa 2 servizi' }));
    const added = media(session, 'b3');
    expect(added.map((e: { title: string }) => e.title)).toEqual(['Nuovo 1', 'Ignoto']);
    expect(added[0]).toMatchObject({ plannedDurationMs: 90_000, durationSource: 'deck', occurrence: 0 });
    expect(added[1]).toMatchObject({ plannedDurationMs: 0, durationSource: 'unknown' });
    expect(screen.getByTestId('imp-result').textContent).toBe('Aggiunti 2 · già presenti 0 · senza durata 1');
    session.undo();
    expect(media(session, 'b3')).toHaveLength(0);
  });

  it('a second click adds nothing (importing twice must not duplicate)', async () => {
    const { session, user } = await setup((a) => {
      a.deck = DECK;
    });
    await user.click(screen.getByRole('button', { name: 'Leggi playlist' }));
    const button = await screen.findByRole('button', { name: 'Importa 2 servizi' });
    await user.click(button);
    await user.click(button);
    expect(media(session, 'b3')).toHaveLength(2);
    expect(screen.getByTestId('imp-result').textContent).toBe('Nessun servizio nuovo: tutti già presenti');
  });

  it('defaults the target to the selected studio block and can distribute in sequence', async () => {
    const { session, user } = await setup((a) => {
      a.deck = { state: 'ok', items: [{ index: 0, path: 'D:/m/a.mp4', title: 'A', durationMs: 400_000, occurrence: 0 }, { index: 1, path: 'D:/m/b.mp4', title: 'B', durationMs: 400_000, occurrence: 0 }] };
    }, 'b2');
    expect((screen.getByRole('combobox', { name: 'Blocco di destinazione' }) as HTMLSelectElement).value).toBe('b2');
    await user.click(screen.getByRole('button', { name: 'Leggi playlist' }));
    await user.click(await screen.findByRole('radio', { name: 'Distribuisci nei blocchi studio' }));
    await user.click(screen.getByRole('button', { name: 'Importa 2 servizi' }));
    expect(media(session, 'b1').map((e: { title: string }) => e.title)).toEqual(['Servizio 1', 'A']);
    expect(media(session, 'b2').map((e: { title: string }) => e.title)).toEqual(['Servizio 2', 'B']);
  });
});

describe('file source', () => {
  const file = (text: string, name: string) => new File([text], name, { type: 'text/plain' });

  it('reads a JSON export, flags relative paths and skipped rows, and imports with the FILE origin', async () => {
    const json = JSON.stringify({ version: 1, name: 'P', items: [{ path: 'D:/m/a.mp4', title: 'A', duration: 61000 }, { path: 'rel/b.mp4', title: 'B', duration: -1 }, { title: 'senza percorso' }] });
    const { session, user } = await setup();
    await user.upload(screen.getByLabelText('Scegli file playlist'), file(json, 'p.json'));
    expect(await screen.findByText('2 servizi trovati')).toBeTruthy();
    expect(within(screen.getByTestId('imp-row-0')).getByText('FILE')).toBeTruthy();
    expect(within(screen.getByTestId('imp-row-1')).getByText(/percorso relativo/)).toBeTruthy();
    expect(screen.getByText('1 righe senza percorso ignorate')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Importa 2 servizi' }));
    expect(media(session, 'b3')[0]).toMatchObject({ path: 'D:/m/a.mp4', plannedDurationMs: 61_000, durationSource: 'file' });
    expect(media(session, 'b3')[1]).toMatchObject({ durationSource: 'unknown' });
  });

  it('marks M3U durations as whole seconds', async () => {
    const { user } = await setup();
    await user.upload(screen.getByLabelText('Scegli file playlist'), file('#EXTM3U\n#EXTINF:185,Servizio\nD:\\m\\s.mp4\n', 'p.m3u'));
    expect(within(await screen.findByTestId('imp-row-0')).getByText('FILE (s)')).toBeTruthy();
    expect(within(screen.getByTestId('imp-row-0')).getByText('3:05')).toBeTruthy();
  });

  it('numbers repeated paths with their occurrence', async () => {
    const csv = 'title,path,duration_ms\nUno,D:/m/x.mp4,1000\nDue,D:/m/x.mp4,2000\n';
    const { session, user } = await setup();
    await user.upload(screen.getByLabelText('Scegli file playlist'), file(csv, 'p.csv'));
    await user.click(await screen.findByRole('button', { name: 'Importa 2 servizi' }));
    expect(media(session, 'b3').map((e: { occurrence: number }) => e.occurrence)).toEqual([0, 1]);
  });

  it.each([
    ['', 'p.json', 'File vuoto'],
    ['{"a":1}', 'p.json', 'Formato non riconosciuto (JSON, CSV o M3U)'],
    ['{"items":[]}', 'p.json', 'Nessun servizio nel file'],
  ])('reports an unusable file %j', async (text, name, message) => {
    const { user } = await setup();
    await user.upload(screen.getByLabelText('Scegli file playlist'), file(text, name));
    expect((await screen.findByRole('status')).textContent).toContain(message);
    expect(screen.queryByRole('button', { name: /^Importa/ })).toBeNull();
  });
});

describe('guards', () => {
  it('is disabled for a live episode', async () => {
    const api = new FakeEditorApi();
    api.live = { episodeId: 'ep-2026-10-12', phase: 'live' };
    api.deck = DECK;
    api.episodes.set('ep-2026-10-12', sampleEpisode());
    await renderWithSession(<ImportPanel />, { open: { kind: 'episode', id: 'ep-2026-10-12' }, api });
    expect((screen.getByLabelText('Scegli file playlist') as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Leggi playlist' }) as HTMLButtonElement).disabled).toBe(true);
  });
});
```
- [ ] **Step 2: Run, confirm FAIL. Step 3: Implement; PASS 3 times; typecheck. Step 4: Commit**

```
git add web/src/editor/import/ImportPanel.tsx web/src/editor/import/read-file.ts web/src/editor/import/import.css web/src/editor/i18n/import.ts web/test/editor/import-panel.test.tsx
git commit -m "feat(web): playlist import panel from Playlist Deck and from files"
```

---

### Task 14: Validation panel, Check OBS and Load for live

**Files:**
- Create: `web/src/editor/validation/{issues.ts,ValidationPanel.tsx,validation.css}`, `web/test/editor/issues.test.ts`, `web/test/editor/validation-panel.test.tsx`
- Modify: `web/src/editor/i18n/validation.ts` (only)

**Interfaces:** `ValidationPanel()` (no props); `dedupeIssues`, `groupByBlock`, `countBySeverity`, `hasErrors`, `issueText`, `DisplayIssue`, `IssueGroup`.

**Decision implemented (tested):** local validation **errors block "Load for live"**, warnings never do. The server enforces the same rule (Task 2). A Check OBS result with errors does **not** hard-block (OBS may be offline while the director prepares), but the first click on the load button then asks for a second click.

`web/src/editor/validation/issues.ts`:
```ts
// SPDX-License-Identifier: GPL-2.0-or-later
import { EDITOR_MODULES, type EditorKey, type EditorT } from '../i18n';

export interface DisplayIssue {
  severity: 'error' | 'warning';
  code: string;
  blockId: string | null;
  /** English text from the validator or the server: shown as a detail, never as the main text. */
  message: string;
  source: 'rundown' | 'obs';
}

export interface IssueGroup {
  blockId: string | null;
  blockName: string | null;
  issues: DisplayIssue[];
}

/** The same problem reported many times (a repeated id gives one `duplicate_id` per occurrence) is shown once. */
export function dedupeIssues<T extends { severity: string; code: string; blockId: string | null; message: string }>(issues: readonly T[]): T[] {
  const seen = new Set<string>();
  return issues.filter((i) => {
    const key = `${i.severity}|${i.code}|${i.blockId ?? ''}|${i.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Whole-rundown issues first, then one group per block in rundown order; errors before warnings inside a group. */
export function groupByBlock(issues: readonly DisplayIssue[], blocks: ReadonlyArray<{ id: string; name: string }>): IssueGroup[] {
  const names = new Map(blocks.map((b) => [b.id, b.name]));
  const bySeverity = (list: DisplayIssue[]) => [...list.filter((i) => i.severity === 'error'), ...list.filter((i) => i.severity === 'warning')];
  const groups: IssueGroup[] = [];
  const global = issues.filter((i) => i.blockId === null || !names.has(i.blockId));
  if (global.length > 0) groups.push({ blockId: null, blockName: null, issues: bySeverity(global) });
  for (const b of blocks) {
    const mine = issues.filter((i) => i.blockId === b.id);
    if (mine.length > 0) groups.push({ blockId: b.id, blockName: b.name, issues: bySeverity(mine) });
  }
  return groups;
}

export function countBySeverity(issues: readonly { severity: string }[]): { errors: number; warnings: number } {
  return { errors: issues.filter((i) => i.severity === 'error').length, warnings: issues.filter((i) => i.severity === 'warning').length };
}

export const hasErrors = (issues: readonly { severity: string }[]): boolean => issues.some((i) => i.severity === 'error');

/** Translated text for a known code; the server's own message for a code this build does not know. */
export function issueText(t: EditorT, issue: Pick<DisplayIssue, 'code' | 'message'>): string {
  const key = `validation.code.${issue.code}`;
  return key in EDITOR_MODULES.validation.it ? t(key as EditorKey) : issue.message;
}
```

`web/src/editor/i18n/validation.ts` (complete):
```ts
// SPDX-License-Identifier: GPL-2.0-or-later
export const IT_VALIDATION = {
  'validation.title': 'Verifica',
  'validation.none': 'Nessun problema',
  'validation.summary': '{e} errori · {w} avvisi',
  'validation.global': 'Generale',
  'validation.error': 'ERRORE',
  'validation.warning': 'AVVISO',
  'validation.checkObs': 'Check OBS',
  'validation.checkNeedsEpisode': 'Il Check OBS si fa su una puntata',
  'validation.checking': 'Verifica in corso…',
  'validation.checkUnsaved': 'Salvataggio non riuscito: Check OBS annullato',
  'validation.checkFailed': 'Check OBS non riuscito ({code})',
  'validation.checkStale': 'Risultato non aggiornato: la puntata è cambiata dopo il Check OBS',
  'validation.obsOffline': 'OBS non connesso',
  'validation.obsInfo': 'OBS {version} · Playlist Deck: {deck}',
  'validation.deckAbsent': 'assente',
  'validation.deckLegacy': 'versione < 1.4.0',
  'validation.deckEvents': 'eventi',
  'validation.obsClean': 'Il Check OBS non ha trovato problemi',
  'validation.caveat': 'Il Check OBS non può verificare tutto (per esempio le sorgenti media se OBS non risponde): nessuna segnalazione non è una garanzia.',
  'validation.loadForLive': 'Carica per la live',
  'validation.loadBlocked': 'Correggi gli errori prima di caricare',
  'validation.loadConfirm': 'Il Check OBS ha trovato errori: premi di nuovo per caricare lo stesso',
  'validation.loadOk': 'Puntata caricata per la live',
  'validation.loadInvalid': 'Il server rifiuta il rundown: correggi gli errori',
  'validation.loadLiveRunning': "Live in corso: impossibile caricare un'altra puntata",
  'validation.loadUnsaved': 'Salvataggio non riuscito: caricamento annullato',
  'validation.loadFailed': 'Caricamento non riuscito ({code})',
  'validation.code.empty_rundown': 'La scaletta non ha blocchi',
  'validation.code.duplicate_id': 'Identificativo duplicato',
  'validation.code.scene_group_missing': 'Il blocco usa un gruppo di scene che non esiste',
  'validation.code.media_exceeds_block': 'I servizi superano la durata del blocco',
  'validation.code.studio_below_threshold': 'Tempo studio sotto la soglia',
  'validation.code.scene_group_shared': 'Più blocchi usano lo stesso gruppo di scene (distinti dall\'ordine)',
  'validation.code.media_duration_unknown': 'Servizio senza durata: inserirla a mano',
  'validation.code.obs_not_connected': 'OBS non connesso',
  'validation.code.scene_missing': 'Scena assente in OBS',
  'validation.code.media_input_missing': 'Sorgente media assente in OBS',
  'validation.code.media_input_unverified': 'Sorgente media non verificabile',
  'validation.code.deck_absent': 'Playlist Deck non installato',
  'validation.code.deck_legacy': 'Playlist Deck < 1.4.0: abbinamento dei servizi non disponibile',
  'validation.code.deck_item_missing': 'Servizio non presente nella playlist del deck',
  'validation.code.deck_duration_unknown': 'Durata ignota nella playlist del deck',
} as const;

export const EN_VALIDATION: Record<keyof typeof IT_VALIDATION, string> = {
  'validation.title': 'Check',
  'validation.none': 'No problems',
  'validation.summary': '{e} errors · {w} warnings',
  'validation.global': 'General',
  'validation.error': 'ERROR',
  'validation.warning': 'WARNING',
  'validation.checkObs': 'Check OBS',
  'validation.checkNeedsEpisode': 'Check OBS runs on an episode',
  'validation.checking': 'Checking…',
  'validation.checkUnsaved': 'Save failed: Check OBS cancelled',
  'validation.checkFailed': 'Check OBS failed ({code})',
  'validation.checkStale': 'Out of date: the episode changed after the Check OBS',
  'validation.obsOffline': 'OBS is not connected',
  'validation.obsInfo': 'OBS {version} · Playlist Deck: {deck}',
  'validation.deckAbsent': 'absent',
  'validation.deckLegacy': 'version < 1.4.0',
  'validation.deckEvents': 'events',
  'validation.obsClean': 'Check OBS found no problems',
  'validation.caveat': 'Check OBS cannot verify everything (for example media sources when OBS does not answer): no report is not a guarantee.',
  'validation.loadForLive': 'Load for live',
  'validation.loadBlocked': 'Fix the errors before loading',
  'validation.loadConfirm': 'Check OBS found errors: press again to load anyway',
  'validation.loadOk': 'Episode loaded for the live',
  'validation.loadInvalid': 'The server refuses the rundown: fix the errors',
  'validation.loadLiveRunning': 'A live is running: cannot load another episode',
  'validation.loadUnsaved': 'Save failed: load cancelled',
  'validation.loadFailed': 'Load failed ({code})',
  'validation.code.empty_rundown': 'The rundown has no blocks',
  'validation.code.duplicate_id': 'Duplicate identifier',
  'validation.code.scene_group_missing': 'The block uses a scene group that does not exist',
  'validation.code.media_exceeds_block': 'The items are longer than the block',
  'validation.code.studio_below_threshold': 'Studio time below the threshold',
  'validation.code.scene_group_shared': 'Several blocks share a scene group (told apart by order)',
  'validation.code.media_duration_unknown': 'Item without a duration: enter it by hand',
  'validation.code.obs_not_connected': 'OBS is not connected',
  'validation.code.scene_missing': 'Scene not in OBS',
  'validation.code.media_input_missing': 'Media source not in OBS',
  'validation.code.media_input_unverified': 'Media source could not be verified',
  'validation.code.deck_absent': 'Playlist Deck is not installed',
  'validation.code.deck_legacy': 'Playlist Deck < 1.4.0: item matching unavailable',
  'validation.code.deck_item_missing': 'Item not in the deck playlist',
  'validation.code.deck_duration_unknown': 'Unknown duration in the deck playlist',
};
```

**Behaviour of `ValidationPanel` (rules):**
1. Local issues = `dedupeIssues(validateRundown(doc))` mapped to `DisplayIssue` with `source: 'rundown'`, recomputed on every document change. Summary `<p role="status" data-testid="val-summary">`: `Nessun problema` or `{e} errori · {w} avvisi`.
2. Issues are listed by `groupByBlock` under `<h4>` (block name, or `Generale`). Each issue is `<button data-testid="issue-{code}-{blockId|global}">` reading `ERRORE`/`AVVISO` + `issueText`; for OBS issues the English `message` follows as `<small>`. Clicking an issue with a `blockId` calls `session.selection.select(blockId, { reveal: true })`.
3. **Check OBS** button: disabled with `title` `Il Check OBS si fa su una puntata` for a format. On click: label `Verifica in corso…` and disabled; `await session.autosave.flush()` (the server checks the saved copy); if the save state is not `clean` show `Salvataggio non riuscito: Check OBS annullato` and stop; otherwise `api.checkObs(id)`. Result: `OBS non connesso` when `connected === false`, else `OBS {version} · Playlist Deck: {assente|versione < 1.4.0|eventi}`; the issues as a second list (source `obs`, same grouping); no issues → `Il Check OBS non ha trovato problemi`. **Always after a check** show the caveat paragraph `validation.caveat`. If the document changed after the check (`store.rev` differs from the rev at check time) show `Risultato non aggiornato…`. A failing call shows `Check OBS non riuscito ({code})`.
4. **Carica per la live** (episodes only): disabled with the visible text `Correggi gli errori prima di caricare` while the **local** issues contain an error; warnings never disable it. When the last, non-stale Check OBS result contains an error, the first click only changes the hint to `Il Check OBS ha trovato errori: premi di nuovo per caricare lo stesso` and the second click loads. Loading calls `session.loadForLive(id)` and shows: ok → `Puntata caricata per la live`; `invalid` → `Il server rifiuta il rundown: correggi gli errori` plus the server issues listed; `live_running` → `Live in corso: impossibile caricare un'altra puntata`; `unsaved` → `Salvataggio non riuscito: caricamento annullato`; other → `Caricamento non riuscito ({code})`. For a format the button is not rendered.

- [ ] **Step 1: Write the failing tests**

`web/test/editor/issues.test.ts`:
```ts
// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import { createEditorT } from '../../src/editor/i18n';
import { countBySeverity, dedupeIssues, groupByBlock, hasErrors, issueText, type DisplayIssue } from '../../src/editor/validation/issues';

const issue = (over: Partial<DisplayIssue>): DisplayIssue => ({ severity: 'error', code: 'duplicate_id', blockId: 'b1', message: 'm', source: 'rundown', ...over });
const blocks = [{ id: 'b1', name: 'Uno' }, { id: 'b2', name: 'Due' }];

describe('issues', () => {
  it('dedupes the same problem reported several times', () => {
    const list = [issue({}), issue({}), issue({}), issue({ blockId: 'b2' })];
    expect(dedupeIssues(list)).toHaveLength(2);
  });

  it('groups whole-rundown issues first, then blocks in order, errors before warnings', () => {
    const g = groupByBlock(
      [issue({ blockId: 'b2' }), issue({ blockId: 'b1', severity: 'warning', code: 'a' }), issue({ blockId: 'b1', code: 'b' }), issue({ blockId: null, code: 'g' }), issue({ blockId: 'gone', code: 'h' })],
      blocks,
    );
    expect(g.map((x) => x.blockId)).toEqual([null, 'b1', 'b2']);
    expect(g[0]!.issues.map((i) => i.code)).toEqual(['g', 'h']); // a block that no longer exists is a general issue
    expect(g[1]!.issues.map((i) => i.code)).toEqual(['b', 'a']);
  });

  it('counts and detects errors', () => {
    const list = [issue({}), issue({ severity: 'warning' }), issue({ severity: 'warning' })];
    expect(countBySeverity(list)).toEqual({ errors: 1, warnings: 2 });
    expect(hasErrors(list)).toBe(true);
    expect(hasErrors([issue({ severity: 'warning' })])).toBe(false);
  });

  it('translates known codes and falls back to the server message for unknown ones', () => {
    expect(issueText(createEditorT('it'), { code: 'scene_missing', message: 'x' })).toBe('Scena assente in OBS');
    expect(issueText(createEditorT('en'), { code: 'scene_missing', message: 'x' })).toBe('Scene not in OBS');
    expect(issueText(createEditorT('it'), { code: 'brand_new_code', message: 'English text' })).toBe('English text');
  });
});
```

`web/test/editor/validation-panel.test.tsx`:
```tsx
// SPDX-License-Identifier: GPL-2.0-or-later
import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ValidationPanel } from '../../src/editor/validation/ValidationPanel';
import { resizeBlock, patchMedia } from '../../src/editor/model/ops';
import { FakeEditorApi, renderWithSession, sampleEpisode, sampleFormat } from '../support/editor';

const EPISODE = { kind: 'episode', id: 'ep-2026-10-12' } as const;
const FORMAT = { kind: 'format', id: 'solo-futsal' } as const;

async function setup(open = EPISODE as typeof EPISODE | typeof FORMAT, prepare?: (api: FakeEditorApi) => void) {
  const api = new FakeEditorApi();
  api.formats.set('solo-futsal', sampleFormat());
  api.episodes.set('ep-2026-10-12', sampleEpisode());
  prepare?.(api);
  return renderWithSession(<ValidationPanel />, { open, api });
}
const breakMedia = (api: FakeEditorApi) => {
  (api.episodes.get('ep-2026-10-12')!.blocks[0] as { elements: Array<{ plannedDurationMs?: number }> }).elements[1]!.plannedDurationMs = 9_999_999;
};

describe('local validation', () => {
  it('shows no problem for a rundown without any', async () => {
    await setup(FORMAT, (api) => {
      const f = api.formats.get('solo-futsal')!;
      f.blocks = [f.blocks[1]!]; // a single break
    });
    expect(screen.getByTestId('val-summary').textContent).toBe('Nessun problema');
  });

  it('the sample episode only has the shared-scene-group warning (three blocks use one group)', async () => {
    await setup();
    expect(screen.getByTestId('val-summary').textContent).toBe('0 errori · 1 avvisi');
    expect(screen.getByTestId('issue-scene_group_shared-global')).toBeTruthy();
  });

  it('lists errors per block with their text, and updates as the document changes', async () => {
    const { session } = await setup(EPISODE, breakMedia);
    expect(screen.getByTestId('val-summary').textContent).toBe('1 errori · 1 avvisi');
    expect(within(screen.getByTestId('issue-media_exceeds_block-b1')).getByText('I servizi superano la durata del blocco')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Primo blocco' })).toBeTruthy();
    session.apply(patchMedia('b1', 'b1-m1', { plannedDurationMs: 60_000 }));
    expect(await screen.findByText('0 errori · 1 avvisi')).toBeTruthy();
  });

  it('shows a warning for studio time under the threshold and for an unknown media duration', async () => {
    const { session } = await setup();
    session.apply(resizeBlock('b3', 30_000));
    session.apply(patchMedia('b1', 'b1-m1', { plannedDurationMs: 0, durationSource: 'unknown' }));
    expect(await screen.findByTestId('issue-studio_below_threshold-b3')).toBeTruthy();
    expect(screen.getByTestId('issue-media_duration_unknown-b1')).toBeTruthy();
    expect(screen.getByTestId('val-summary').textContent).toBe('0 errori · 3 avvisi');
  });

  it('click-to-focus selects the block and asks to reveal it', async () => {
    const { session, user } = await setup(EPISODE, breakMedia);
    session.selection.select('b3');
    await user.click(screen.getByTestId('issue-media_exceeds_block-b1'));
    expect(session.selection.getSnapshot()).toMatchObject({ blockId: 'b1', revealTick: 1 });
  });
});

describe('load for live', () => {
  it('is blocked while there are errors, and says why', async () => {
    const { api, user } = await setup(EPISODE, breakMedia);
    const button = screen.getByRole('button', { name: 'Carica per la live' }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(screen.getByText('Correggi gli errori prima di caricare')).toBeTruthy();
    await user.click(button);
    expect(api.count('loadLive')).toBe(0);
  });

  it('is not blocked by warnings', async () => {
    const { session, api, user } = await setup();
    session.apply(resizeBlock('b3', 30_000)); // studio time warning only
    const button = screen.getByRole('button', { name: 'Carica per la live' }) as HTMLButtonElement;
    expect(button.disabled).toBe(false);
    await user.click(button);
    expect(await screen.findByText('Puntata caricata per la live')).toBeTruthy();
    expect(api.live.episodeId).toBe('ep-2026-10-12');
  });

  it('saves pending edits first and loads nothing if they cannot be saved', async () => {
    const { session, api, user } = await setup();
    api.failNext('putDoc', new TypeError('down'));
    session.apply(resizeBlock('b3', 130_000));
    await user.click(screen.getByRole('button', { name: 'Carica per la live' }));
    expect(await screen.findByText('Salvataggio non riuscito: caricamento annullato')).toBeTruthy();
    expect(api.count('loadLive')).toBe(0);
  });

  it('shows the server refusal with its issues', async () => {
    const { api, user } = await setup();
    breakMedia(api); // the server copy has an error the local copy does not know about
    await user.click(screen.getByRole('button', { name: 'Carica per la live' }));
    expect(await screen.findByText('Il server rifiuta il rundown: correggi gli errori')).toBeTruthy();
  });

  it('is not offered for a format', async () => {
    await setup(FORMAT);
    expect(screen.queryByRole('button', { name: 'Carica per la live' })).toBeNull();
  });

  it('asks for a second click when the last Check OBS found errors', async () => {
    const { api, user } = await setup(EPISODE, (a) => {
      a.check = { connected: true, obsWebSocketVersion: '5.5.0', deck: { capability: 'events' }, issues: [{ severity: 'error', code: 'scene_missing', blockId: 'br1', message: 'Scene "BREAK" is not in OBS' }] };
    });
    await user.click(screen.getByRole('button', { name: 'Check OBS' }));
    await screen.findByTestId('issue-scene_missing-br1');
    await user.click(screen.getByRole('button', { name: 'Carica per la live' }));
    expect(screen.getByText('Il Check OBS ha trovato errori: premi di nuovo per caricare lo stesso')).toBeTruthy();
    expect(api.count('loadLive')).toBe(0);
    await user.click(screen.getByRole('button', { name: 'Carica per la live' }));
    expect(await screen.findByText('Puntata caricata per la live')).toBeTruthy();
  });
});

describe('Check OBS', () => {
  it('is disabled for a format', async () => {
    await setup(FORMAT);
    const button = screen.getByRole('button', { name: 'Check OBS' }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(button.getAttribute('title')).toBe('Il Check OBS si fa su una puntata');
  });

  it('saves first, then shows the connection, the plugin and the issues, with the caveat', async () => {
    const { session, api, user } = await setup(EPISODE, (a) => {
      a.check = {
        connected: true, obsWebSocketVersion: '5.5.0', deck: { capability: 'legacy' },
        issues: [
          { severity: 'error', code: 'scene_missing', blockId: 'br1', message: 'Scene "BREAK" is not in OBS' },
          { severity: 'warning', code: 'media_input_unverified', blockId: 'br1', message: 'Media input "Tappo" could not be verified' },
          { severity: 'warning', code: 'deck_legacy', blockId: null, message: 'x' },
        ],
      };
    });
    session.apply(resizeBlock('b3', 130_000));
    await user.click(screen.getByRole('button', { name: 'Check OBS' }));
    expect(await screen.findByText('OBS 5.5.0 · Playlist Deck: versione < 1.4.0')).toBeTruthy();
    expect(api.episodes.get('ep-2026-10-12')!.blocks[3]!.durationMs).toBe(130_000); // saved before the check
    expect(within(screen.getByTestId('issue-scene_missing-br1')).getByText('Scena assente in OBS')).toBeTruthy();
    expect(within(screen.getByTestId('issue-media_input_unverified-br1')).getByText('Sorgente media non verificabile')).toBeTruthy();
    expect(screen.getByTestId('issue-deck_legacy-global')).toBeTruthy();
    expect(screen.getByText(/nessuna segnalazione non è una garanzia/)).toBeTruthy();
  });

  it('says so when OBS is not connected', async () => {
    const { user } = await setup(EPISODE, (a) => {
      a.check = { connected: false, obsWebSocketVersion: null, deck: null, issues: [{ severity: 'error', code: 'obs_not_connected', blockId: null, message: 'OBS is not connected' }] };
    });
    await user.click(screen.getByRole('button', { name: 'Check OBS' }));
    expect((await screen.findAllByText('OBS non connesso')).length).toBeGreaterThan(0);
  });

  it('cancels when the pending edits cannot be saved', async () => {
    const { session, api, user } = await setup();
    api.failNext('putDoc', new TypeError('down'));
    session.apply(resizeBlock('b3', 130_000));
    await user.click(screen.getByRole('button', { name: 'Check OBS' }));
    expect(await screen.findByText('Salvataggio non riuscito: Check OBS annullato')).toBeTruthy();
    expect(api.count('checkObs')).toBe(0);
  });

  it('marks a result as out of date after the episode changes', async () => {
    const { session, user } = await setup();
    await user.click(screen.getByRole('button', { name: 'Check OBS' }));
    await screen.findByText('Il Check OBS non ha trovato problemi');
    session.apply(resizeBlock('b3', 130_000));
    expect(await screen.findByText(/Risultato non aggiornato/)).toBeTruthy();
  });

  it('reports a failing call', async () => {
    const { api, user } = await setup();
    api.failNext('checkObs', new Error('boom'));
    await user.click(screen.getByRole('button', { name: 'Check OBS' }));
    expect(await screen.findByText(/Check OBS non riuscito/)).toBeTruthy();
  });
});
```
- [ ] **Step 2: Run, confirm FAIL. Step 3: Implement; PASS 3 times; typecheck. Step 4: Commit**

```
git add web/src/editor/validation web/src/editor/i18n/validation.ts web/test/editor/issues.test.ts web/test/editor/validation-panel.test.tsx
git commit -m "feat(web): validation panel, Check OBS and guarded load for live"
```

---
### Task 15: Shell — toolbar, save indicator, banners, shortcuts, polling

Serial (wave 3): it wires the six panels of wave 2 and replaces the placeholder of Task 1.

**Files:**
- Create: `web/src/editor/shell.css`, `web/test/editor/shell.test.tsx`
- Modify: `web/src/editor/EditorApp.tsx` (replace), `web/src/editor/main.tsx`, `web/src/editor/i18n/shell.ts`, `web/test/editor/scaffold.test.tsx` (render `EditorApp` with `session={new EditorSession(new FakeEditorApi(), fakeTimers().timers)}` and `pollLiveMs={0} pollExternalMs={0}`; its expectations stay)

**Interfaces:** `EditorApp(props: { lang: Lang; session?: EditorSession; api?: EditorApi; pollLiveMs?: number; pollExternalMs?: number })`. Without `session` it builds `new EditorSession(api ?? httpEditorApi())` once and disposes it on unmount. `pollLiveMs` defaults to 3000 and `pollExternalMs` to 10 000; `0` disables a poll.

`web/src/editor/i18n/shell.ts` (complete):
```ts
// SPDX-License-Identifier: GPL-2.0-or-later
export const IT_SHELL = {
  'shell.title': 'Editor',
  'shell.undo': 'Annulla',
  'shell.redo': 'Ripristina',
  'shell.undoTip': 'Annulla: {op}',
  'shell.redoTip': 'Ripristina: {op}',
  'shell.save.clean': 'Salvato',
  'shell.save.dirty': 'Modifiche non salvate',
  'shell.save.saving': 'Salvataggio…',
  'shell.save.error': 'SALVATAGGIO NON RIUSCITO ({code}): nuovo tentativo in corso',
  'shell.save.invalid': 'Contenuto rifiutato dal server ({code})',
  'shell.save.locked': 'Bloccato: puntata in onda',
  'shell.retry': 'Riprova ora',
  'shell.liveBanner': 'Puntata IN ONDA: sola lettura',
  'shell.loadedBanner': 'Puntata caricata per la live: le modifiche valgono per la puntata caricata',
  'shell.conflictBanner': 'Questo documento è stato modificato altrove.',
  'shell.takeTheirs': 'Usa la versione del server',
  'shell.keepMine': 'Mantieni la mia',
  'shell.blockedBanner': 'Impossibile cambiare documento: le modifiche non sono state salvate.',
  'shell.discard': 'Scarta le modifiche',
  'shell.refreshed': "Aggiornato da un'altra sessione",
  'shell.openPrompt': 'Apri o crea un format dal pannello a sinistra',
  'shell.loading': 'Caricamento…',
  'shell.loadError': 'Impossibile aprire il documento ({code})',
  'shell.kindFormat': 'Format',
  'shell.kindEpisode': 'Puntata',
  'shell.op.move_block': 'spostamento blocco',
  'shell.op.resize_block': 'durata blocco',
  'shell.op.edit_block': 'modifica blocco',
  'shell.op.convert_block': 'cambio tipo',
  'shell.op.add_block': 'nuovo blocco',
  'shell.op.duplicate_block': 'duplica blocco',
  'shell.op.delete_block': 'elimina blocco',
  'shell.op.split_block': 'divisione blocco',
  'shell.op.add_element': 'nuovo elemento',
  'shell.op.remove_element': 'elimina elemento',
  'shell.op.move_element': 'spostamento elemento',
  'shell.op.edit_media': 'modifica servizio',
  'shell.op.rename_doc': 'rinomina',
  'shell.op.edit_preset': 'impostazioni',
  'shell.op.edit_scene_group': 'gruppi di scene',
  'shell.op.edit_message': 'messaggi',
  'shell.op.import_media': 'import servizi',
  'shell.op.edit_episode': 'dati puntata',
} as const;

export const EN_SHELL: Record<keyof typeof IT_SHELL, string> = {
  'shell.title': 'Editor',
  'shell.undo': 'Undo',
  'shell.redo': 'Redo',
  'shell.undoTip': 'Undo: {op}',
  'shell.redoTip': 'Redo: {op}',
  'shell.save.clean': 'Saved',
  'shell.save.dirty': 'Unsaved changes',
  'shell.save.saving': 'Saving…',
  'shell.save.error': 'SAVE FAILED ({code}): retrying',
  'shell.save.invalid': 'Content refused by the server ({code})',
  'shell.save.locked': 'Locked: the episode is on air',
  'shell.retry': 'Retry now',
  'shell.liveBanner': 'Episode ON AIR: read only',
  'shell.loadedBanner': 'Episode loaded for the live: changes apply to the loaded episode',
  'shell.conflictBanner': 'This document was changed elsewhere.',
  'shell.takeTheirs': 'Use the server version',
  'shell.keepMine': 'Keep mine',
  'shell.blockedBanner': 'Cannot switch document: your changes are not saved.',
  'shell.discard': 'Discard changes',
  'shell.refreshed': 'Updated from another session',
  'shell.openPrompt': 'Open or create a format in the panel on the left',
  'shell.loading': 'Loading…',
  'shell.loadError': 'The document could not be opened ({code})',
  'shell.kindFormat': 'Format',
  'shell.kindEpisode': 'Episode',
  'shell.op.move_block': 'move block',
  'shell.op.resize_block': 'block duration',
  'shell.op.edit_block': 'edit block',
  'shell.op.convert_block': 'change type',
  'shell.op.add_block': 'new block',
  'shell.op.duplicate_block': 'duplicate block',
  'shell.op.delete_block': 'delete block',
  'shell.op.split_block': 'split block',
  'shell.op.add_element': 'new element',
  'shell.op.remove_element': 'delete element',
  'shell.op.move_element': 'move element',
  'shell.op.edit_media': 'edit item',
  'shell.op.rename_doc': 'rename',
  'shell.op.edit_preset': 'settings',
  'shell.op.edit_scene_group': 'scene groups',
  'shell.op.edit_message': 'messages',
  'shell.op.import_media': 'import items',
  'shell.op.edit_episode': 'episode data',
};
```

**Behaviour (rules):**
1. **Layout** (classes from Task 1's `editor.css`): `<header className="ed-bar">` (title `Editor`, the open document as `<span data-testid="doc-title">{kind}: {name}</span>`, undo, redo, the save indicator, then the banners); regions `library` → `LibraryPanel`; `timeline` → `TimelinePanel` (or the prompt `Apri o crea un format dal pannello a sinistra` when nothing is open, `Caricamento…` while loading, `Impossibile aprire il documento ({code})` on error); `properties` → `PropertiesPanel` + `ImportPanel`; `settings` → `SettingsPanel`; `validation` → `ValidationPanel`. The five panels other than the library are rendered **only when a document is open** (`useDoc() !== null`). All five region `data-testid`s from Task 1 stay.
2. **Undo/redo:** buttons `Annulla` / `Ripristina`, disabled by `canUndo` / `canRedo`, `title` = `Annulla: {t('shell.op.<undoLabel>')}`. Shortcuts on `window`: `Ctrl/Cmd+Z` undo, `Ctrl/Cmd+Shift+Z` and `Ctrl+Y` redo (match `event.key` case-insensitively), `preventDefault`ed; **ignored when the event target is an `input`, `textarea`, `select` or `contenteditable`** (the browser's own text undo stays in charge there).
3. **Save indicator** `<div data-testid="save-state" data-state="{kind}">`: clean `Salvato`, dirty `Modifiche non salvate`, saving `Salvataggio…`, error `SALVATAGGIO NON RIUSCITO ({code}): nuovo tentativo in corso` (class `ed-error`, `role="alert"`, with a `Riprova ora` button calling `autosave.retryNow()`), invalid `Contenuto rifiutato dal server ({code})` (also `role="alert"`), locked `Bloccato: puntata in onda`. It is always visible while a document is open.
4. **Banners** (`role="alert"` for the first three): live lock `Puntata IN ONDA: sola lettura` (`snapshot.lock === 'live'`); conflict `Questo documento è stato modificato altrove.` with buttons `Usa la versione del server` (`takeTheirs`) and `Mantieni la mia` (`keepMine`); blocked `Impossibile cambiare documento: le modifiche non sono state salvate.` with `Riprova ora` and `Scarta le modifiche` (`session.forget()`); info (not an alert) `Puntata caricata per la live: …` when the open episode is `live.episodeId` in phase `preshow`; a status toast `Aggiornato da un'altra sessione` for 4 s after `refreshed` increases.
5. **`beforeunload`:** while the save state is `dirty`, `saving`, `error` or `invalid`, the handler calls `preventDefault()` and sets `returnValue = ''`. Clean or locked: it does nothing.
6. **Polling:** every `pollLiveMs` call `session.refreshLive()`; every `pollExternalMs` call `session.checkExternal()`; both also on the window `focus` event. Intervals are cleared on unmount.
7. `main.tsx`: as before plus `import './shell.css'`; renders `<EditorApp lang={params.lang} />`.
8. `shell.css`: the toolbar as a flex row with wrapping, the banners as full-width bars (`--amber` for warnings, `--red` for the live lock and errors), the save indicator with a coloured dot; nothing hard-coded outside the token variables.

- [ ] **Step 1: Write the failing tests** — `web/test/editor/shell.test.tsx`:
```tsx
// SPDX-License-Identifier: GPL-2.0-or-later
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { ApiError } from '../../src/core/http';
import { EditorApp } from '../../src/editor/EditorApp';
import { EDITOR_MODULES } from '../../src/editor/i18n';
import { OP_LABELS, moveBlock, renameDoc } from '../../src/editor/model/ops';
import { EditorSession } from '../../src/editor/session/session';
import { FakeEditorApi, sampleEpisode, sampleFormat } from '../support/editor';
import { fakeTimers } from '../support/fake-timers';

const FORMAT = { kind: 'format', id: 'solo-futsal' } as const;
const EPISODE = { kind: 'episode', id: 'ep-2026-10-12' } as const;

function boot(prepare?: (api: FakeEditorApi) => void, props: { lang?: 'it' | 'en'; pollLiveMs?: number; pollExternalMs?: number } = {}) {
  const api = new FakeEditorApi();
  api.formats.set('solo-futsal', sampleFormat());
  api.episodes.set('ep-2026-10-12', sampleEpisode());
  prepare?.(api);
  const time = fakeTimers();
  const session = new EditorSession(api, time.timers);
  const utils = render(<EditorApp lang={props.lang ?? 'it'} session={session} pollLiveMs={props.pollLiveMs ?? 0} pollExternalMs={props.pollExternalMs ?? 0} />);
  const open = (ref: typeof FORMAT | typeof EPISODE) => act(async () => void (await session.open(ref)));
  return { api, session, ...utils, open, user: userEvent.setup(), advance: (ms: number) => act(async () => time.advance(ms)) };
}
const saveState = () => screen.getByTestId('save-state');

describe('EditorApp layout', () => {
  it('shows the five regions and the prompt when nothing is open', async () => {
    boot();
    for (const r of ['library', 'timeline', 'properties', 'settings', 'validation']) expect(screen.getByTestId(`region-${r}`)).toBeTruthy();
    expect(screen.getByText('Apri o crea un format dal pannello a sinistra')).toBeTruthy();
    expect(screen.queryByTestId('timeline')).toBeNull();
  });

  it('opens a document from the library and shows the timeline and its title', async () => {
    const { user, session } = boot();
    await user.click(await screen.findByRole('button', { name: 'Solo Futsal' }));
    expect(await screen.findByTestId('timeline')).toBeTruthy();
    expect(screen.getByTestId('doc-title').textContent).toBe('Format: Solo Futsal');
    expect(session.getSnapshot().ref).toEqual(FORMAT);
  });

  it('speaks English with ?lang=en', async () => {
    const { open } = boot(undefined, { lang: 'en' });
    await open(FORMAT);
    expect(saveState().textContent).toBe('Saved');
    expect(screen.getByRole('button', { name: 'Undo' })).toBeTruthy();
  });
});

describe('undo and redo', () => {
  it('buttons follow the history and the tooltip names the operation', async () => {
    const { open, session } = boot();
    await open(FORMAT);
    const undo = screen.getByRole('button', { name: 'Annulla' }) as HTMLButtonElement;
    const redo = screen.getByRole('button', { name: 'Ripristina' }) as HTMLButtonElement;
    expect(undo.disabled).toBe(true);
    act(() => void session.apply(moveBlock(0, 1)));
    expect(undo.disabled).toBe(false);
    expect(undo.title).toBe('Annulla: spostamento blocco');
    fireEvent.click(undo);
    expect(redo.disabled).toBe(false);
    expect(redo.title).toBe('Ripristina: spostamento blocco');
    fireEvent.click(redo);
    expect(session.store.getSnapshot().doc!.blocks[0]!.id).toBe('br1');
  });

  it('Ctrl+Z, Ctrl+Shift+Z and Ctrl+Y work, except inside a text field', async () => {
    const { open, session } = boot();
    await open(FORMAT);
    act(() => void session.apply(moveBlock(0, 1)));
    fireEvent.keyDown(window, { key: 'z', ctrlKey: true });
    expect(session.store.getSnapshot().doc!.blocks[0]!.id).toBe('b1');
    fireEvent.keyDown(window, { key: 'z', ctrlKey: true, shiftKey: true });
    expect(session.store.getSnapshot().doc!.blocks[0]!.id).toBe('br1');
    fireEvent.keyDown(window, { key: 'z', ctrlKey: true });
    fireEvent.keyDown(window, { key: 'y', ctrlKey: true });
    expect(session.store.getSnapshot().doc!.blocks[0]!.id).toBe('br1');
    const field = screen.getByRole('textbox', { name: 'Nome del documento' });
    fireEvent.keyDown(field, { key: 'z', ctrlKey: true, bubbles: true });
    expect(session.store.getSnapshot().doc!.blocks[0]!.id).toBe('br1'); // untouched
  });

  it('every operation label has a translation in both languages', () => {
    for (const label of OP_LABELS) {
      expect(`shell.op.${label}` in EDITOR_MODULES.shell.it, label).toBe(true);
      expect(`shell.op.${label}` in EDITOR_MODULES.shell.en, label).toBe(true);
    }
  });
});

describe('save indicator (Review Focus 1)', () => {
  it('goes unsaved -> saving -> saved', async () => {
    const { open, session, advance } = boot();
    await open(FORMAT);
    expect(saveState().getAttribute('data-state')).toBe('clean');
    act(() => void session.apply(renameDoc('Nuovo nome')));
    expect(saveState().textContent).toBe('Modifiche non salvate');
    await advance(900);
    expect(saveState().textContent).toBe('Salvato');
  });

  it('shows a loud error with a retry button, and never claims "Salvato" while it failed', async () => {
    const { open, session, api, advance } = boot();
    await open(FORMAT);
    api.failNext('putDoc', new ApiError(500, 'internal'));
    act(() => void session.apply(renameDoc('Nuovo nome')));
    await advance(900);
    expect(saveState().getAttribute('data-state')).toBe('error');
    expect(saveState().textContent).toContain('SALVATAGGIO NON RIUSCITO (internal)');
    expect(saveState().textContent).not.toContain('Salvato');
    fireEvent.click(within(saveState()).getByRole('button', { name: 'Riprova ora' }));
    await waitFor(() => expect(saveState().getAttribute('data-state')).toBe('clean'));
    expect(api.formats.get('solo-futsal')!.name).toBe('Nuovo nome');
  });

  it('asks the browser to confirm leaving while there is anything unsaved', async () => {
    const { open, session, advance } = boot();
    await open(FORMAT);
    const clean = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(clean);
    expect(clean.defaultPrevented).toBe(false);
    act(() => void session.apply(renameDoc('Nuovo nome')));
    const dirty = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(dirty);
    expect(dirty.defaultPrevented).toBe(true);
    await advance(900);
    const saved = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(saved);
    expect(saved.defaultPrevented).toBe(false);
  });
});

describe('banners', () => {
  it('shows the live lock for an episode on air', async () => {
    const { open } = boot((a) => {
      a.live = { episodeId: 'ep-2026-10-12', phase: 'live' };
    });
    await open(EPISODE);
    expect(screen.getByText('Puntata IN ONDA: sola lettura')).toBeTruthy();
  });

  it('polling locks an open episode that goes on air in another tab (Review Focus 5)', async () => {
    const { open, api } = boot(undefined, { pollLiveMs: 20 });
    await open(EPISODE);
    expect(screen.queryByText('Puntata IN ONDA: sola lettura')).toBeNull();
    api.live = { episodeId: 'ep-2026-10-12', phase: 'live' };
    expect(await screen.findByText('Puntata IN ONDA: sola lettura')).toBeTruthy();
    expect((screen.getByRole('textbox', { name: 'Nome del documento' }) as HTMLInputElement).disabled).toBe(true);
  });

  it('tells the director when the open episode is the one loaded for the live', async () => {
    const { open } = boot((a) => {
      a.live = { episodeId: 'ep-2026-10-12', phase: 'preshow' };
    });
    await open(EPISODE);
    expect(screen.getByText(/Puntata caricata per la live: le modifiche valgono/)).toBeTruthy();
  });

  it('offers a choice when another tab changed the document and this one has unsaved edits', async () => {
    const { open, session, api, user } = boot();
    await open(FORMAT);
    act(() => void session.apply(renameDoc('Mia modifica')));
    api.formats.set('solo-futsal', { ...sampleFormat(), name: 'Loro modifica' });
    fireEvent(window, new Event('focus'));
    expect(await screen.findByText('Questo documento è stato modificato altrove.')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Usa la versione del server' }));
    expect(session.store.getSnapshot().doc!.name).toBe('Loro modifica');
    expect(screen.queryByText('Questo documento è stato modificato altrove.')).toBeNull();
  });

  it('refreshes silently, with a toast, when the local copy is clean', async () => {
    const { open, session, api } = boot();
    await open(FORMAT);
    api.formats.set('solo-futsal', { ...sampleFormat(), name: 'Cambiato altrove' });
    fireEvent(window, new Event('focus'));
    expect(await screen.findByText("Aggiornato da un'altra sessione")).toBeTruthy();
    expect(session.store.getSnapshot().doc!.name).toBe('Cambiato altrove');
  });

  it('refuses to switch documents while the save fails, and lets the director discard on purpose', async () => {
    const { open, session, api, user } = boot();
    await open(FORMAT);
    api.failNext('putDoc', new TypeError('down'));
    act(() => void session.apply(renameDoc('Nuovo nome')));
    const row = await screen.findByTestId('ep-ep-2026-10-12');
    await user.click(within(row).getByRole('button', { name: 'Solo Futsal · 12/10/2026' }));
    expect(await screen.findByText('Impossibile cambiare documento: le modifiche non sono state salvate.')).toBeTruthy();
    expect(session.getSnapshot().ref).toEqual(FORMAT);
    await user.click(screen.getByRole('button', { name: 'Scarta le modifiche' }));
    expect(session.getSnapshot().ref).toBeNull();
    expect(screen.getByText('Apri o crea un format dal pannello a sinistra')).toBeTruthy();
  });
});
```
- [ ] **Step 2: Run, confirm FAIL. Step 3: Implement; PASS 3 times; `pnpm typecheck`; `pnpm build` and check `web/dist/editor/index.html`. Step 4: Commit**

```
git add web/src/editor/EditorApp.tsx web/src/editor/main.tsx web/src/editor/shell.css web/src/editor/i18n/shell.ts web/test/editor/shell.test.tsx web/test/editor/scaffold.test.tsx
git commit -m "feat(web): editor shell with undo/redo, visible save state, banners and polling"
```

---

### Task 16: Integration — the editor's store and API client against the real server

**Files:**
- Create: `web/test/integration/editor.test.ts`

Node environment (`// @vitest-environment node`, as in Plan 4's `live.test.tsx`). Real `buildServer` with a temp data dir, the real `obs-sim`, real HTTP. A thin `fetch` wrapper can simulate an outage. The session uses real timers with short autosave options.

- [ ] **Step 1: Write the test** — `web/test/integration/editor.test.ts`:
```ts
// SPDX-License-Identifier: GPL-2.0-or-later
// @vitest-environment node
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { Episode, Format, parsePlaylistFile, validateRundown } from '@olc/shared';
import { startObsSim } from '@olc/obs-sim';
import { buildServer } from '@olc/server/app/server';
import { ApiError } from '../../src/core/http';
import { httpEditorApi } from '../../src/editor/api/editor-api';
import { importEdit, planPlacement, withOccurrences, type Candidate } from '../../src/editor/import/place';
import { blankFormat } from '../../src/editor/library/blank';
import { uniqueSlug } from '../../src/editor/model/ids';
import { addBlock, moveBlock, patchBreak, patchMedia, renameDoc, resizeBlock } from '../../src/editor/model/ops';
import { EditorSession, browserTimers, stableStringify } from '../../src/editor/session/session';

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

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()!();
});

const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Bounded polling (25 ms steps) for an async probe. */
async function until<T>(label: string, probe: () => Promise<T | null | undefined | false> | T | null | undefined | false, timeoutMs = 8_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await probe();
    if (value) return value;
    if (Date.now() >= deadline) throw new Error(`Timed out after ${timeoutMs} ms waiting for ${label}`);
    await delay(25);
  }
}

async function boot() {
  const sim = await startObsSim({ port: 0, scenes: SCENES, inputs: ['Deck Media', 'Tappo'], program: 'CAM 1', deck: DECK });
  cleanups.push(() => sim.close());
  const dir = await mkdtemp(join(tmpdir(), 'olc-editor-'));
  cleanups.push(() => rm(dir, { recursive: true, force: true, maxRetries: 5 }));
  const { app } = await buildServer({ dataDir: dir, restrictAcl: async () => {}, obsCredentials: { host: '127.0.0.1', port: sim.port } });
  cleanups.push(() => app.close());
  await app.listen({ port: 0, host: '127.0.0.1' });
  const port = (app.server.address() as AddressInfo).port;

  const net = { down: false, puts: 0 };
  const api = httpEditorApi(async (input, init) => {
    if (net.down) throw new TypeError('fetch failed');
    if (init?.method === 'PUT') net.puts++;
    return fetch(`http://127.0.0.1:${port}${String(input)}`, init);
  });
  const newSession = () => {
    const s = new EditorSession(api, browserTimers, { debounceMs: 30, maxWaitMs: 200, retryBaseMs: 40, retryMaxMs: 80 });
    cleanups.push(() => s.dispose());
    return s;
  };
  const onDisk = async (kind: 'formats' | 'episodes', id: string) => JSON.parse(await readFile(join(dir, kind, `${id}.json`), 'utf8')) as Record<string, any>;
  const settled = (s: EditorSession) => until('autosave clean', () => s.autosave.getState().kind === 'clean');
  const post = (path: string, body: unknown) =>
    fetch(`http://127.0.0.1:${port}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return { api, net, newSession, onDisk, settled, post, dir };
}

const doc = (s: EditorSession) => s.store.getSnapshot().doc!;

describe('the editor against the real server and the OBS simulator', () => {
  it('create a format, edit, undo/redo, autosave, make an episode, import, validate, load for live, get locked', async () => {
    const { api, net, newSession, onDisk, settled, post } = await boot();
    const session = newSession();

    // 1. A new format is persisted with a lowercase slug id.
    const taken = new Set((await api.listFormats()).map((f) => f.id));
    const id = uniqueSlug('Notte Basket', taken);
    expect(id).toBe('notte-basket');
    await api.createFormat(blankFormat('Notte Basket', id));
    expect(await onDisk('formats', id)).toMatchObject({ id: 'notte-basket', name: 'Notte Basket' });

    // 2. A burst of edits is saved by ONE write, and the file equals the screen.
    await session.open({ kind: 'format', id });
    session.apply(renameDoc('Notte Basket 2'));
    session.apply(addBlock('break', 1, 'Pausa'));
    session.apply(addBlock('studio', 2, 'Secondo'));
    for (const ms of [310_000, 320_000, 330_000]) session.apply(resizeBlock('blk-1', ms));
    await settled(session);
    expect(net.puts).toBe(1);
    expect(stableStringify(Format.parse(await onDisk('formats', id)))).toBe(stableStringify(doc(session)));
    expect(doc(session).blocks.map((b) => b.id)).toEqual(['blk-1', 'blk-2', 'blk-3']);

    // 3. Undo reverts the whole resize drag in one step; redo restores it; the file follows each time.
    session.undo();
    await settled(session);
    expect((await onDisk('formats', id)).blocks[0].durationMs).toBe(300_000);
    session.redo();
    await settled(session);
    expect((await onDisk('formats', id)).blocks[0].durationMs).toBe(330_000);
    session.apply(moveBlock(0, 1));
    await settled(session);
    expect((await onDisk('formats', id)).blocks.map((b: { id: string }) => b.id)).toEqual(['blk-2', 'blk-1', 'blk-3']);
    session.undo();
    await settled(session);

    // 4. An episode is an independent copy of the format.
    const epId = uniqueSlug('Notte Basket 2 2026-10-20', new Set((await api.listEpisodes()).map((e) => e.id)));
    const created = await api.createEpisode(id, { id: epId, date: '2026-10-20', plannedStart: '2026-10-20T19:00:00+02:00', playlistName: 'Notte' });
    expect(created.blocks).toEqual((await onDisk('formats', id)).blocks);
    await session.open({ kind: 'episode', id: epId });
    session.apply(resizeBlock('blk-3', 600_000));
    await settled(session);
    expect((await onDisk('episodes', epId)).blocks[2].durationMs).toBe(600_000);
    expect((await onDisk('formats', id)).blocks[2].durationMs).toBe(300_000); // the format did not change

    // 5. Import from the live deck: media with their origin; a second import adds nothing.
    const deck = await until('deck items', async () => {
      const r = await api.deckItems();
      return r.state === 'ok' ? r.items : null;
    });
    const candidates: Candidate[] = deck.map((d) => ({ title: d.title, path: d.path, occurrence: d.occurrence, durationMs: d.durationMs, origin: 'deck' }));
    session.apply(importEdit(planPlacement(doc(session), candidates, { kind: 'append', blockId: 'blk-3' })));
    await settled(session);
    const media = (await onDisk('episodes', epId)).blocks[2].elements.filter((e: { kind: string }) => e.kind === 'media');
    expect(media.map((m: { path: string; durationSource: string }) => [m.path, m.durationSource])).toEqual([
      ['D:/media/servizio1.mp4', 'deck'],
      ['D:/media/servizio2.mp4', 'deck'],
    ]);
    const putsBefore = net.puts;
    const again = planPlacement(doc(session), candidates, { kind: 'append', blockId: 'blk-3' });
    expect(again).toMatchObject({ adds: [], skippedExisting: 2 });
    expect(session.apply(importEdit(again))).toBe(false);
    await delay(150);
    expect(net.puts).toBe(putsBefore);

    // 6. Import from a file with an unknown duration: it stays unknown on disk, never 0:00.
    const parsed = parsePlaylistFile(JSON.stringify({ items: [{ path: 'D:/media/senza-durata.mp4', title: 'Senza durata', duration: -1 }] }), 'p.json');
    if (!parsed.ok) throw new Error('parse failed');
    const fileItems: Candidate[] = withOccurrences(parsed.playlist.items).map((i) => ({ title: i.title, path: i.path, occurrence: i.occurrence, durationMs: i.durationMs, origin: i.durationOrigin }));
    session.apply(importEdit(planPlacement(doc(session), fileItems, { kind: 'append', blockId: 'blk-3' })));
    await settled(session);
    const last = (await onDisk('episodes', epId)).blocks[2].elements.at(-1);
    expect(last).toMatchObject({ title: 'Senza durata', plannedDurationMs: 0, durationSource: 'unknown' });
    expect(validateRundown(doc(session) as Episode).some((i) => i.code === 'media_duration_unknown')).toBe(true);

    // 7. Validation: an error is refused by the server on load; fixing it (undo) lets it through.
    const firstMedia = (doc(session).blocks[2] as { elements: Array<{ id: string; kind: string }> }).elements.find((e) => e.kind === 'media')!;
    session.apply(patchMedia('blk-3', firstMedia.id, { plannedDurationMs: 9_999_000 }));
    expect(validateRundown(doc(session) as Episode).some((i) => i.severity === 'error')).toBe(true);
    const refused = await session.loadForLive(epId);
    expect(refused).toMatchObject({ ok: false, reason: 'invalid' });
    expect(refused.ok === false && refused.issues?.some((i) => i.code === 'media_exceeds_block' && i.blockId === 'blk-3')).toBe(true);
    session.undo();
    expect(await session.loadForLive(epId)).toEqual({ ok: true });
    expect(await api.liveStatus()).toEqual({ episodeId: epId, phase: 'preshow' });

    // 8. Check OBS names a scene OBS does not have, on the right block.
    session.apply(patchBreak('blk-2', { scene: 'NON ESISTE' }));
    await settled(session);
    const check = await until('Check OBS connected', async () => {
      const r = await api.checkObs(epId);
      return r.connected ? r : null;
    });
    expect(check.issues.some((i) => i.code === 'scene_missing' && i.blockId === 'blk-2')).toBe(true);

    // 9. Once the show is on air, the editor locks and the server refuses writes.
    expect((await post('/api/live/command', { name: 'start_program' })).status).toBe(200);
    await session.refreshLive();
    expect(session.getSnapshot().lock).toBe('live');
    expect(session.apply(renameDoc('Troppo tardi'))).toBe(false);
    const err = await api.putDoc(doc(session), 'episode').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 409, code: 'episode_live' });
  }, 60_000);

  it('an outage is shown, never hides the unsaved edit, and the file ends equal to the screen after undo', async () => {
    const { api, net, newSession, onDisk, settled } = await boot();
    await api.createFormat(blankFormat('Serata', 'serata'));
    const session = newSession();
    await session.open({ kind: 'format', id: 'serata' });
    session.apply(renameDoc('A'));
    await settled(session);
    expect((await onDisk('formats', 'serata')).name).toBe('A');

    net.down = true;
    session.apply(renameDoc('B'));
    await until('error state', () => session.autosave.getState().kind === 'error');
    expect(session.autosave.getState().kind).not.toBe('clean');
    expect((await onDisk('formats', 'serata')).name).toBe('A'); // nothing reached the file

    // Review Focus 2: undo while the server is away, then it comes back.
    session.undo();
    expect(doc(session).name).toBe('A');
    net.down = false;
    await settled(session);
    expect((await onDisk('formats', 'serata')).name).toBe('A');
    expect(doc(session).name).toBe('A');
  }, 30_000);

  it('does not switch documents over an unsaved edit', async () => {
    const { api, net, newSession } = await boot();
    await api.createFormat(blankFormat('Uno', 'uno'));
    await api.createFormat(blankFormat('Due', 'due'));
    const session = newSession();
    await session.open({ kind: 'format', id: 'uno' });
    net.down = true;
    session.apply(renameDoc('Uno modificato'));
    expect(await session.open({ kind: 'format', id: 'due' })).toBe(false);
    expect(session.getSnapshot()).toMatchObject({ blocked: true, ref: { kind: 'format', id: 'uno' } });
    expect(doc(session).name).toBe('Uno modificato');
  }, 30_000);

  it('a second session sees the first one\'s save, and a dirty one is asked', async () => {
    const { api, newSession, settled } = await boot();
    await api.createFormat(blankFormat('Condiviso', 'condiviso'));
    const a = newSession();
    const b = newSession();
    await a.open({ kind: 'format', id: 'condiviso' });
    await b.open({ kind: 'format', id: 'condiviso' });

    a.apply(renameDoc('Da A'));
    await settled(a);
    await b.checkExternal();
    expect(doc(b).name).toBe('Da A'); // clean copy: refreshed silently
    expect(b.getSnapshot().refreshed).toBe(1);

    b.apply(renameDoc('Da B'));
    a.apply(renameDoc('Da A bis'));
    await settled(a);
    await b.checkExternal();
    expect(b.getSnapshot().conflict?.name).toBe('Da A bis'); // B has unsaved edits: it must choose
    expect(doc(b).name).toBe('Da B');
  }, 30_000);
});
```
(The file layout `<dataDir>/formats/<id>.json` and `<dataDir>/episodes/<id>.json` is the one `server/src/app/paths.ts` builds; if it differs, fix the two path strings in `onDisk` and say so in the report. If the simulator rejects `deck` without a connected OBS at the first read, the `until` helper retries.)

- [ ] **Step 2: Run** `pnpm vitest run web/test/integration/editor.test.ts` three times → PASS (about 5–8 s each). **Step 3: Commit**

```
git add web/test/integration/editor.test.ts
git commit -m "test(web): editor store and API client against the real server and the OBS simulator"
```

---

### Task 17: Documentation, decision record, backlog

**Files:**
- Modify: `README.md`, `docs/TEST-PLAN.md`, `docs/BACKLOG.md`, `docs/TECH-DESIGN.md`, `docs/DECISIONS.md`

**Rules (documentation task; no tests; `pnpm typecheck` and `pnpm test` stay green):**
1. **README.md:** a short "Editor" section in the existing language of the README: how to open it (`pnpm dev` then `http://localhost:5173/editor`, or `http://localhost:4460/editor` after `pnpm build`); what it does (the seven points of the Scope); the keyboard map of the timeline (from `blockKeyIntent`); `?lang=en`; where the data is stored; the lock of a live episode; the three playlist file formats it reads.
2. **docs/TEST-PLAN.md:** a new section "Editor (controlli manuali)", in Italian, with Setup / Azione / Risultato atteso for each of these checks, each with the exact thing to look at:
   - E1 layout at 1366×768 and 1920×1080, no horizontal page scroll, long names (120 characters) truncated with an ellipsis;
   - E2 drag a block with the mouse and with a finger on a touch screen; the drop marker shows where it lands; Esc aborts;
   - E3 resize a block by the handle: the duration snaps to 5 s; one Ctrl+Z reverts the whole drag;
   - E4 keyboard only: select, move, resize, delete, duplicate, undo, redo;
   - E5 autosave offline: stop the server while editing; the indicator turns red within a few seconds and says what failed; restart the server; it turns to "Salvato" and the file on disk equals the screen; closing the tab while red asks for confirmation;
   - E6 two tabs: change a name in tab A, focus tab B (clean) → silent refresh with the toast; edit in B first (dirty) → the conflict banner with the two choices;
   - E7 import from the real Playlist Deck (≥ 1.4.0): items appear with `DECK` and their durations; a file without a known duration shows `—`; import twice adds nothing; one Ctrl+Z removes the whole import;
   - E8 import the three real exports of the plugin (JSON, CSV, M3U), with and without "portable" (relative) paths; check the origin badges (`FILE`, `FILE (s)`) and the relative-path warning; **this is the check that confirms the formats read from the exporter source**;
   - E9 Check OBS: with a scene renamed in OBS, with the plugin removed, with OBS closed; the issue list, the caveat sentence, and the two-click rule on the load button;
   - E10 load for live: errors block it, warnings do not; after loading, `/dock`, `/control` and `/presenter` show the episode;
   - E11 live lock: start the program, then open the same episode in the editor: banner, everything read-only; an editor tab opened before the start locks within 3 s;
   - E12 Italian and English (`?lang=en`) on every panel; OBS dock browser (CEF) opens `/editor` and works (the editor is not meant for the dock, but must not break there).
3. **docs/BACKLOG.md:** in "Piano 5 — editor" mark as done the items this plan closed (lowercase ids, load refuses invalid rundowns, `issues` of the 400 used by the editor is *not* used: keep it); keep "list() non verifica il nome del file" and the server-side dedupe of `duplicate_id` (the editor dedupes in the UI); add the residuals of this plan: no server ETag (client-side conflict detection only); rename never changes ids; duplicating a block drops its media; Playwright smoke of the editor not in CI; touch drag not covered by automated tests; `Alt+Arrow` may be captured by some browsers (use Shift/Alt alternatives); Check OBS errors do not hard-block loading (decision to confirm).
4. **docs/TECH-DESIGN.md:** §7: add `GET /api/live/status`; replace the `POST /api/episodes/:id/import-playlist` row with "l'import avviene nel client: `GET /api/deck/items` oppure il testo del file letto dal browser e interpretato da `shared/playlist/parse`"; note that `POST /api/live/load` answers `409 rundown_invalid`. §8: the `/editor` entry is built; describe the store/autosave/session split in five lines.
5. **docs/DECISIONS.md:** add `DT-11 · Editor: drag and drop scritto a mano, rilevamento dei conflitti lato client, import dei file nel client` (date 2026-10-12, Stato: accettata) with Contesto / Decisione / Alternative scartate (`@dnd-kit/core` 6.3.1 MIT: needs real layout, jsdom cannot test the drop; a server ETag: kept out of v1, the `409 episode_live` is the only hard lock) / Conseguenze.

- [ ] **Step 1: Make the edits. Step 2: `pnpm typecheck && pnpm test && pnpm build` → green. Step 3: Commit**

```
git add README.md docs/TEST-PLAN.md docs/BACKLOG.md docs/TECH-DESIGN.md docs/DECISIONS.md
git commit -m "docs: editor usage, manual test plan, backlog and design alignment"
```

---

### Task 18 (OPTIONAL, bounded): Playwright smoke of the editor page

Run only if the main session approves it (see "Decisions"). Not part of `pnpm test` or CI. It needs a local Chromium download and the Playwright setup described in Plan 4's optional task (`web/playwright.config.ts`, `web/e2e/serve.ts`): if that task was never done, this one creates them with the same rules (port 4470, `webServer: pnpm exec tsx e2e/serve.ts`, `PLAYWRIGHT_BROWSERS_PATH=0`, devDependencies `@playwright/test` and `tsx`, script `e2e`, `.gitignore` entries for `web/test-results/` and `web/playwright-report/`).

**Files:** Create `web/e2e/editor.spec.ts` (and, if missing, the three Plan 4 files above); modify `web/package.json`, `pnpm-lock.yaml`, `.gitignore`.

**`serve.ts`** (extension): seed a format `e2e-format` whose first block name is 120 × `W`, and an episode `e2e-ep`; do not load it.

**`editor.spec.ts`:**
1. `/editor` loads with no console error and every request goes to `127.0.0.1:4470`.
2. At 1366×768 and 1920×1080: `document.documentElement.scrollWidth <= innerWidth`; open `e2e-format` from the library; the first block's name element has `scrollWidth > clientWidth` is false for its container (ellipsis, no overflow).
3. Real mouse drag of the first block over the second with `page.mouse` (down, move in 5 steps, up): the block order in the document changes (read it from `GET /api/formats/e2e-format` after the autosave: wait for `[data-testid="save-state"][data-state="clean"]`), and `Ctrl+Z` restores it.
4. Stop the server process mid-edit (`serve.ts` listens for a `SIGUSR2`-free signal: use the Playwright `request` to hit a test-only `POST /__e2e/down` handled by `serve.ts` that closes the Fastify instance): the indicator reaches `data-state="error"` within 5 s.

Run `pnpm build && pnpm --filter @olc/web e2e` three times → green.

```
git add web/playwright.config.ts web/e2e web/package.json pnpm-lock.yaml .gitignore
git commit -m "test(web): optional playwright smoke test of the editor page"
```

---

## Decisions for the main session

1. **`MediaElement.durationSource` (optional field in the shared model).** Needed so an unknown duration is never shown as 0:00 and every imported value shows its origin. It is optional, the engine ignores it, existing documents stay valid. *Recommended: accept.* The alternative (a separate side table in the editor) would lose the information on reload.
2. **`POST /api/live/load` refuses a rundown with validation errors (`409 rundown_invalid`).** It also affects the rehearsal picker of `/control` and the dock, which load episodes: a broken episode can no longer be loaded from there. *Recommended: accept* (SPEC F6: errors are blocking; BACKLOG asked for the decision). Warnings never block.
3. **Check OBS errors do not hard-block loading** (OBS may be offline while preparing); the load button asks for a second click when the last check found errors. *Alternative:* block until the check is clean (safer, but unusable without OBS).
4. **Hand-written drag and drop instead of `@dnd-kit/core` (MIT).** Reason in "Architecture". *Alternative:* adopt it and test only through its keyboard sensor.
5. **Client-side conflict handling, no server ETag.** The window-focus/10 s check, the conflict banner and the `409 episode_live` lock cover the real cases (two tabs, one person). *Alternative:* an `If-Match` revision on `PUT`; more server work, only needed if several people edit at once.
6. **Duplicating a block copies its studio parts but not its media** (a copy would point at the same deck item twice). Splitting keeps all elements in the first half.
7. **Renaming never changes the id** (ids are slugs of the original name and are the file names).
8. **`@testing-library/user-event` ^14.6.7 (MIT)** as a dev dependency (Task 1), as the brief asked for `userEvent`.
9. **Task 18 (Playwright) optional**, as Plan 4's task 16 was: *recommended to run once before the first real show, locally.*

---

## Self-review notes (plan author)

- **Spec coverage.**
  - F1/F2 library: Task 9. F3/F4 timeline and undo/redo (AC12): Tasks 3, 4, 5, 10, 11, 15. F5 import: Tasks 6, 7, 13. F6 validation: Tasks 2, 14. F7 Check OBS: Tasks 2, 14. Format-level settings: Task 12. i18n: every UI task plus Task 1. Server additions: Tasks 1 (page), 2 (status, guarded load, unverified inputs).
  - SPEC §18.7 lock: Tasks 3, 8, 15, 16.
  - BACKLOG Piano 5: lowercase ids (Tasks 4, 9), load refusal (Task 2), `duplicate_id` dedupe (Task 14), `media_input_unverified` (Task 2).
- **Verification done while writing.**
  - Every pure module and its tests were extracted from this document into a scratch directory outside the repository and run with the repository's own Vitest: `ids`, `time`, `ops`, `geometry`, `place`, `duration-input`, `blank`, the document store, the autosave, the API client, the session (21 tests including `loadForLive` and the conflict handling), and the playlist parsers: 163 tests green, and `tsc --strict` clean on the sources (with the Task 2 schema applied to the scratch copy of `shared`).
  - The playlist formats come from reading `src/core/PlaylistIO.cpp` of angeloruggieridj/obs-playlist-deck on 2026-10-12. The CSV *reader* does not exist there, so the CSV parser is deliberately tolerant; manual check E8 confirms the real exports.
  - `@dnd-kit/core` 6.3.1 and `@testing-library/user-event` 14.6.7 are MIT (`npm view`, 2026-10-12).
  - **Not run:** the UI component tests (Tasks 9–15), the integration test (Task 16) and the server tests (Tasks 1–2). They are written against the verified pure modules and the existing server code (route shapes and `buildServer` options read from the repository), but nobody has executed them. The implementers must make them pass without loosening an expectation; where a test fails because of a jsdom limit (for example `PointerEvent` fields), the fix goes in the test's setup, not in the expectation.
- **Interfaces stay consistent across tasks:** the `Edit` type, `RundownDoc`, `OP_LABELS` (Task 4) feed the session (Task 8) and the shell's undo tooltips (Task 15, with a test that every label is translated); `EditorApi` (Task 8) is the only HTTP surface; the three date helpers live in `model/time.ts` so the library and the settings panel do not depend on each other; each dictionary key is used by the task that defines it.
- **Where rules replace code:** the React components of Tasks 9–15 (exact rules, labels and complete tests), the docs of Task 17, the optional Task 18.
- **Deferred:** named checkpoints, project export/import, recovery policies beyond `next_elastic`, login (SPEC §17); the plugin (Plan 6); installers (Plan 7); server ETag; touch-drag automated tests; editor in the OBS dock.
