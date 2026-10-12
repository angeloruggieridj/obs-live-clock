# Plan 6 — OBS Plugin (C++) and Kiosk Launcher Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the system start itself and be drivable from inside OBS. The plugin shows the dock, starts the app if it is not running, hands it the obs-websocket credentials with zero configuration, turns OBS hotkeys (and so Stream Deck keys) into app commands, and reports the monitors. The app opens the presenter on the chosen monitor and keeps it open without ever fighting the operator. The app keeps working without the plugin, and the plugin never blocks OBS.

**Scope:**
- **Plugin (`plugin/`, C++17, CMake, Qt6, libobs, obs-frontend-api, libcurl), thin per DT-3:** dock (obs-browser panel API with a fallback page), AppLauncher, CredentialBridge, HotkeyBridge (18 fixed slots), ScreenInfo, settings dialog (Tools menu), local/remote mode.
- **Testable without OBS:** all logic lives in `plugin/core` (no OBS, no Qt, no network); 104 doctest cases.
- **Server additions (TypeScript):** `POST /api/internal/hotkey` (double press confirmed in the server, pure and tested), `POST /api/internal/screens`, `GET /api/hotkeys/pending`, `GET /api/screens`, `GET/PUT /api/settings` (kiosk only, never the OBS password), `GET /api/kiosk` + start/stop/restart, richer `runtime.json`.
- **KioskLauncher (Node):** browser detection (Chrome, Edge, Chromium, Brave), placement on the monitor the plugin reported, supervised restart with limits.
- **Web:** "press again to confirm" banner in the dock and the extended view; kiosk panel in the extended view.
- **CI:** C++ tests on three OSes, plugin build on three OSes, plugin <-> server contract test, ABI check of the dock panel API.
- **Docs:** real-OBS checklist, README, BACKLOG, DECISIONS, TECH-DESIGN alignment.

**Out of scope:** installers, packaging of the Node runtime, signing (Plan 7: the installer writes `launch.json`, see Task 3); a dedicated Stream Deck plugin; authentication.

**Architecture (decisions fixed by the research below):**
- **Split by dependency.** `plugin/core` links nothing but the C++ standard library and a vendored JSON header. `plugin/net` is libcurl behind the `IHttpClient` interface. `plugin/src` is the OBS module (libobs, Qt) and holds no logic worth a unit test; it is covered by a handful of source-inspection tests and by the manual checklist. `plugin/tools/olc-cli` is the core plus real HTTP and no OBS: the contract test uses it to drive a real server.
- **Two worker threads, never the UI thread.** A `TickLoop` (250 ms) runs `Supervisor::tick()` (health probe, launch, credentials, screens). A separate `Dispatcher` runs hotkey requests, so a slow health probe can never delay a key press. Hotkey presses are sent once, in order, never retried; the app deduplicates by `(session, seq)`.
- **Hotkeys are persisted by the plugin.** OBS saves the key a user assigns to a plugin's frontend hotkey in the profile's `basic.ini` under `[Hotkeys]`, keyed by registration name, but libobs reloads such bindings only for OBS's own hotkeys. The plugin loads them itself after registering and on profile change (verified on a real OBS 32.2.2, see "Research record").
- **The dock is registered in `obs_module_post_load`**, not on FINISHED_LOADING (OBS restores the dock layout in between; lesson of Playlist Deck) and not in `obs_module_load` (obs-browser may not be loaded yet).
- **The kiosk never opens on the wrong monitor.** A named monitor that is not in the list means "do not launch" (`screen_missing`), never "use the primary one".
- **No new runtime dependency in the TypeScript side.** C++ side: doctest 2.4.11 (MIT) and nlohmann/json 3.11.3 (MIT), both vendored exactly as Playlist Deck does, both GPL-2.0-or-later compatible.

**Tech Stack:** C++17, CMake >= 3.22, Qt 6 (the Qt that OBS ships), libobs and obs-frontend-api (OBS 32.2.2 SDK, supported floor OBS 30.0), libcurl, doctest, nlohmann/json; Node 24, TypeScript 5.9 strict, Fastify 5, zod 4, Vitest 3.2; Python 3 for CI helpers.

**Spec:** [SPEC.md](../../SPEC.md) §7, §15, F13, F16, F17, NF3 · [TECH-DESIGN.md](../../TECH-DESIGN.md) §3, §9, §10, §13 (R1, R2, R4, R7), §14 · [DECISIONS.md](../../DECISIONS.md) DT-3, DT-5, DT-9, DT-10 · [BACKLOG.md](../../BACKLOG.md).

**Roadmap:**

| Plan | Scope |
|---|---|
| 1 ✅ | engine |
| 2 ✅ | server core |
| 3 ✅ | OBS integration |
| 4 ✅ | web presenter, dock, control |
| 5 ✅ | editor |
| **6 (this)** | plugin C++ + kiosk |
| 7 | installers |

---

## Research record (read before implementing)

Everything below was checked on 2026-10-12 against real sources, or on this machine (Windows 11, OBS 32.2.2 installed, Visual Studio 18 Build Tools). It is the reason the code looks the way it does.

**Verified**
1. **Dock with a web page.** obs-browser exports two C symbols, `obs_browser_create_qcef` and `obs_browser_qcef_version_export` (checked with a string search in the installed `obs-browser.dll` and in `panel/browser-panel.cpp`). `QCef` is a table of virtual functions; its header `panel/browser-panel.hpp` is **not part of the OBS SDK** and is GPL-2.0-only, so the plugin declares the same virtual-function order itself (`plugin/src/BrowserPanel.hpp`) and finds the module at run time with `obs_get_module("obs-browser")`, `obs_get_module_lib`, `os_dlsym`. The panel version is 3 in OBS 30.0.0, 31.0.0, 32.0.0, 32.2.2 and 33.0.0-rc1, and the header differs between them only in formatting (diffed). `plugin/ci/check_browser_panel_abi.py` compares the virtual-function names and order with upstream for any OBS tag (run against 30.0.0, 32.2.2, 33.0.0-rc1: identical). OBS itself disables panels on Wayland; the plugin does the same and shows its fallback page. A plugin docks a widget with `obs_frontend_add_dock_by_id(id, title, QWidget*)` (OBS 30.0+); on a fresh profile OBS hides every plugin dock until the user ticks it in the Docks menu.
2. **obs-websocket configuration.** `<OBS config>/plugin_config/obs-websocket/config.json`, keys `server_enabled`, `server_port`, `auth_required`, `server_password` (obs-websocket `Config.cpp`; the real file on this machine has exactly these plus `first_load` and `alerts_enabled`). Path obtained with `obs_module_get_config_path(obs_get_module("obs-websocket"), "config.json")`. Defaults when a key is missing (`Config.h`): disabled, port 4455, auth required. Older versions kept the values in `global.ini` `[OBSWebSocket]` (`ServerEnabled`, `ServerPort`, `AuthRequired`, `ServerPassword`): the plugin reads them as a fallback. The command line `--websocket_port` / `--websocket_password` wins over the file (obs-websocket `Config::Load`); the plugin honours both.
3. **Hotkeys.** `obs_hotkey_register_frontend(name, description, func, data)`; `func(data, id, hotkey, pressed)` is called for press **and** release. Bindings: OBS Settings stores them in the profile `basic.ini` `[Hotkeys]`, key = registration name, value = `{"bindings":[...]}` (frontend `OBSBasicSettings.cpp`), and nothing reloads them for a plugin: the plugin calls `obs_hotkey_load(id, array)` itself (`obs_data_array_count(NULL)` is 0, so a null array clears).
4. **Real OBS run** (an isolated portable copy of OBS 32.2.2 in a scratch folder, never the user's profile): the module loads; `dock registered (browser panel)` is logged; the app is started detached and **survives OBS being killed**; the credentials reach the real server with zero configuration and the server connects to obs-websocket; a real key press (F14, assigned in `basic.ini`) became `POST /api/internal/hotkey` and the server showed the pending confirmation (`remainingMs` 561) that expired after 1 s; the dock shows the real `/dock` page and the banner "Il server WebSocket di OBS è spento…". The password never appeared in OBS's log.
5. **Build.** CMake 4.4.3 + the Visual Studio generator works from Git Bash with no environment setup (`-G "Visual Studio 18 2026" -A x64`). On this machine only the "18" Build Tools carry the C++ tools, so `Visual Studio 17 2022` fails with "could not find any instance"; `plugin/scripts/lib.sh` picks the generator with `vswhere`. A build directory under `%TEMP%` fails (MSB8029): the repo and worktrees are fine. Paths **with spaces** (like this repo's) work for the whole flow. Playlist Deck's unit-test target builds here (1 min); the full OBS dev tree (prebuilt deps, Qt 6.11.1, `obs-frontend-api`) builds in 5-10 min and then the plugin module in about 1.5 min. OBS configure writes a `build_x86` folder into its own source tree: always unzip a fresh source.
5b. **Contract.** The real C++ core (`olc-cli`) against the real server: credentials delivered, an emergency hotkey pending then executed, 401 reported. 1081 TypeScript tests pass with the server and web code of this plan.

**Not verified (cannot be, without more than this environment)**
- macOS and Linux builds (no compiler here; CI is the first check). The C++ was written to the standard and compiled with MSVC `/W4` only.
- The Linux/macOS install layouts and `--kiosk` + multi-monitor behaviour on macOS and Linux (R4). On Windows, whether `--window-position`/`--window-size` interpret Qt's logical coordinates correctly on mixed-DPI setups (the settings allow a fixed position override).
- OBS 30.x/31.x run time (only 32.2.2 was run; the ABI is checked by diff, not by running).
- Wayland fallback page, console-window suppression when launching `node.exe` from OBS (code present, not seen), Stream Deck via OBS hotkeys, the kiosk on a real second monitor, the browser-panel behaviour on a fresh CEF profile: **one observed quirk**, the dock showed OBS's own "browser source" logo page on the first show with a fresh profile and stayed there; navigating once more 1.5 s after the first show fixes it (verified), and that is what `DockHost::showEvent` does. Root cause unknown.
- Everything is on the manual checklist (Task 18).

---

## Execution model (user's instruction)

- **Plan author:** Sonnet (this document).
- **Orchestrator:** a **Sonnet** agent that does the minimum. It runs shell drivers that print one line each (`bash plugin/scripts/verify.sh` prints `PASS cpp=<n> test cases py=<n> tests` or `FAIL`; `.superpowers/sdd/verify.sh` for the TypeScript side; `deepseek-review.sh`) and reads only those lines. It reads a diff only when a script reports a problem.
- **Implementer:** **DeepSeek v4.1 Flash through OpenCode**, through `.superpowers/sdd/deepseek-task.sh`. The 4th argument by task kind:
  - **TypeScript tasks (2, 7, 8, 12, 16-server part):** `The repository is a pnpm monorepo (shared, server, web). Do not add dependencies.`
  - **C++ core tasks (1, 3, 4, 5, 6, 10):** `This is a C++ task. Ignore the instruction about pnpm test and typecheck. The code lives in plugin/ (C++17, CMake, doctest). Verify with: bash plugin/scripts/verify.sh (one PASS/FAIL line). Windows 11, Git Bash: the scripts pick the Visual Studio generator themselves. Never create build output under %TEMP%. Install nothing.`
  - **C++ glue tasks (9, 13, 14, 15):** same, plus `Also build the OBS module with: OLC_DEPS_DIR=<main repo>/plugin/.deps bash plugin/scripts/build-plugin.sh (the OBS dev tree is built once in the main repo with plugin/scripts/setup-obs-dev.sh, 5-10 min; worktrees share it through OLC_DEPS_DIR).`
- **Parallel DeepSeek instances are allowed and expected.** Each parallel task runs in its **own `git worktree` on a temp branch** (`git worktree add ../olc-wt-tN -b plan6/tN`), forked from the commit holding all its dependencies. The orchestrator merges branches one by one with `git merge --no-ff` in the order of the table. Tasks of a wave own **disjoint files** (see "File ownership"); a merge conflict means a task touched a file it does not own, and it goes back.
- **Reviews:** first-pass review of every task by **DeepSeek** (`deepseek-review.sh`). A **Sonnet** gate only for Tasks 4, 5, 6, 8, 10, 11, 15, 17 (launch policy, credential hand-off, threading/HTTP, internal routes, supervisor, kiosk supervision, glue, CI) and for the final whole-branch review. **No Opus anywhere.**
- **Task sizing:** every task fits in one Flash run. The code and tests in this plan were all compiled and run before being written here (C++ with MSVC, TypeScript with Vitest); the implementer types them as given and must not loosen a test. An ambiguity goes back to the orchestrator.
- **No AI attribution** in any commit. Nothing is pushed until the controller merges.

### Dependency graph and waves

```
Wave 0 (3 parallel):  T1 plugin scaffold + foundation    T2 server pure modules (hotkeys, screens, kiosk settings)    T12 web (hint + kiosk panel)
Wave 1 (6 parallel):  T3 core paths/settings/screens (T1)   T4 launch policy (T1)   T5 obs-websocket config + credentials (T1)
                      T6 http client, workers, hotkey forwarder (T1)   T9 module bootstrap: net, BrowserPanel, build scripts (T1)   T7 kiosk controller + node adapters (T2)
Wave 2 (3 parallel):  T8 server routes + wiring + runtime.json (T2, T7)   T10 supervisor + texts (T3, T4, T5, T6)   T14 hotkey registrar + screen reporter (T3, T6, T9)
Wave 3 (2 parallel):  T13 dock host, settings dialog, adapters (T9, T10)   T16 contract fixture, olc-cli, contract tests (T3, T6, T8, T10)
Wave 4 (2 parallel):  T15 controller + plugin-main + glue rules (T10, T13, T14)   T17 CI (T1, T9, T16)
Wave 5 (serial):      T18 docs and real-OBS checklist (all)
```

| Task | Depends on | Parallel group | Worktree | First review | Sonnet gate |
|---|---|---|---|---|---|
| 1 Plugin scaffold + foundation | — | W0 | yes | DeepSeek | no |
| 2 Server pure modules | — | W0 | yes | DeepSeek | no |
| 12 Web: hotkey hint + kiosk panel | — | W0 | yes | DeepSeek | no |
| 3 Core: paths, plugin settings, screens | 1 | W1 | yes | DeepSeek | no |
| 4 Core: launch policy | 1 | W1 | yes | DeepSeek | **yes** |
| 5 Core: obs-websocket config, credentials | 1 | W1 | yes | DeepSeek | **yes** |
| 6 Core: http client, workers, hotkey forwarder | 1 | W1 | yes | DeepSeek | **yes** |
| 9 Module bootstrap | 1 | W1 | yes | DeepSeek | no |
| 7 Kiosk controller + node adapters | 2 | W1 | yes | DeepSeek | **yes** |
| 8 Server routes, wiring, runtime.json | 2, 7 | W2 | yes | DeepSeek | **yes** |
| 10 Supervisor + texts | 3, 4, 5, 6 | W2 | yes | DeepSeek | **yes** |
| 14 Hotkey registrar + screen reporter | 3, 6, 9 | W2 | yes | DeepSeek | no |
| 13 Dock host, settings dialog, adapters | 9, 10 | W3 | yes | DeepSeek | no |
| 16 Contract + olc-cli | 3, 6, 8, 10 | W3 | yes | DeepSeek | no |
| 15 Controller, plugin-main, glue rules | 10, 13, 14 | W4 | yes | DeepSeek | **yes** |
| 17 CI | 1, 9, 16 | W4 | yes | DeepSeek | **yes** |
| 18 Docs, checklist | all | W5 | no (serial) | DeepSeek | no |

### File ownership (what makes the waves conflict-free)

CMake lists use `file(GLOB ... CONFIGURE_DEPENDS)`, so later tasks only **add** files and never edit a list. Shared files and their single owner:

| Shared file | Created by | Later touched by |
|---|---|---|
| `plugin/CMakeLists.txt`, `plugin/core/CMakeLists.txt`, `plugin/net/CMakeLists.txt`, `plugin/tools/CMakeLists.txt`, `plugin/tests/CMakeLists.txt`, `plugin/tests/main.cpp`, `plugin/third_party/**` | T1 | nobody |
| `plugin/src/CMakeLists.txt`, `plugin/src/plugin-main.cpp` | T9 | `plugin-main.cpp` is replaced by T15 only |
| `plugin/tests/support/fakes.hpp` | T6 | read-only for others (T10 uses it) |
| `server/src/app/settings.ts`, `server/src/app/paths.ts`, `server/test/app/basics.test.ts` | T2 | nobody |
| `server/src/api/internal.ts`, `server/src/app/server.ts`, `server/src/app/main.ts`, `server/test/api/internal.test.ts` | T8 | nobody |
| `web/src/core/http.ts`, `web/src/core/i18n.ts`, `web/test/support/api.ts`, `web/src/dock/DockScreen.tsx`, `web/src/control/ControlScreen.tsx`, the two CSS files | T12 | nobody |
| `.github/workflows/ci.yml` | existing | T17 only |
| `THIRD-PARTY-NOTICES.md` | existing | T1 only; `docs/*`, `README.md` | existing | T18 only |

## Global Constraints

- **SPDX header in every new source file**, C++ and CMake and shell and Python included: `// SPDX-License-Identifier: GPL-2.0-or-later` (`#` for CMake, shell, Python, YAML; `/* */` for CSS). Vendored third-party files keep their own MIT notice. **LF line endings.**
- **No AI attribution** and no co-author trailers in any commit message.
- **Secrets are never logged, never on a command line, never in a URL.** The obs-websocket password and the `secret.token` bearer live in memory (the `Secret` type in C++), travel only in a request body or an `Authorization` header over loopback, and `GET /api/settings` returns `hasPassword`, never the password. Pinned by tests listed in Review Focus.
- **Internal routes (`/api/internal/*`) are loopback-only and bearer-protected**, constant-time token comparison, loopback checked first (403) then token (401), and no route echoes a request body or zod issues.
- **Never block OBS's UI thread.** No HTTP, file wait, process wait or `join` on the UI thread or in an OBS hotkey callback. Everything slow runs on the `TickLoop` or the hotkey `Dispatcher`, with request timeouts of 1.5 to 2 s. Results return to Qt through queued calls.
- **The app must keep working without the plugin** (SPEC §15, DT-3): nothing in the server requires the plugin; every plugin-fed feature degrades to "waiting" or "configure by hand".
- **CI on three OS:** the existing `ts` job is not modified and must not slow down; the plugin jobs are separate, skippable (`vars.SKIP_PLUGIN_CI`) and gated by a path filter.
- **Licenses:** every dependency MIT/BSD/ISC/Zlib/Boost. The obs-browser panel header (GPL-2.0-only) is **not** copied.
- **Time and timers are injected** in pure code (C++ `nowMs` function, TypeScript `Clock`/`Scheduler`); tests use fakes.

## Review Focus

The five failure modes most likely to hurt in a live show, and the test that pins each.

1. **OBS UI freezes on a slow or hung HTTP call.** *Tests:* T6 `test_dispatcher.cpp` "post() returns at once even while a job blocks (the OBS thread must never wait)", "a full queue drops new jobs", `test_hotkeys.cpp` "onPress returns immediately while the app hangs, and presses are sent once each, in order", `test_tick_loop.cpp` "stop() returns promptly"; T15 `test_glue_rules.cpp` "the OBS hotkey callback only numbers the press and queues it", "only the worker side calls the network", "the app's status reaches the GUI thread through a queued call"; manual checklist "kill the app while OBS is open".
2. **Double app launch** (a slow start, a flapping health probe, a crash loop). *Tests:* T4 "a slow start never produces a second launch", "the cooldown stops a crash loop…", "a plugin session launches the app at most three times", "remote mode never launches"; T10 "an app that is slow to start (9 s) is still launched only once", "an app that never starts ends as Failed… without a second launch".
3. **Credentials leak** into a log, a URL, a command line or a response. *Tests:* T10 "the password never appears in a log line, a URL, a header or a launch command"; T5 "describe(config) is log-safe"; T1 "a Secret never shows its value"; T15 "a secret is read out of its wrapper in exactly one place", "the app is launched with an argument list… no secret on the command line"; T8 internal route "never writes the token nor a request body to the log", `GET /api/settings` "returns the settings without the OBS password", `PUT` keeps the file's password; T7 "carries no secret of any kind" (kiosk args).
4. **A hotkey double-fire executes an emergency action by accident** (key bounce, a duplicate delivery, a retried request, two different keys). *Tests:* T2 "key bounce (a second press within 120 ms) neither confirms nor resets the window", "a duplicate delivery (same session and seq) is ignored and never confirms", "a different slot never confirms another one", "pressing a message or CLEAR between two presses cancels the confirmation", "a triple tap executes once and then starts a new confirmation"; T6 "a failed hotkey request is logged but never retried"; T16 contract: the real C++ core sends two presses 300 ms apart and the server answers `pending` then `executed`.
5. **The kiosk fights the operator or opens on the wrong monitor.** *Tests:* T2 `choosePlacement` "never replaces a named monitor that is not there", "waits for the plugin when it needs the list"; T7 controller "wrong screen is never an option", "stops after four restarts in the window and says so (suspended)…", "a quick clean exit is a hand-off…", "Stop kills the browser and nothing reopens it", "the named monitor unplugged while running: the window is left alone", node adapter "a configured browserPath that does not exist is not replaced by a detected one"; T8 "a named monitor waits for the list, opens when the plugin reports it".

Also pinned: a password changed in OBS while it runs is delivered again (T10), an app restart (new `instanceId`) re-delivers credentials and screens (T10), the contract between plugin and server (T16), the browser-panel ABI (T9, T17), slot names frozen because OBS stores key bindings by name (T6, T16).

---

## Local build and test commands (verified on this machine)

Run from Git Bash in the repo root. The scripts need nothing on PATH beyond `cmake`, `python` and `bash`.

```bash
# C++ unit tests of the pure core + Python helper tests (about 1.5 min the first time; prints one line)
bash plugin/scripts/verify.sh                    # -> PASS cpp=104 test cases py=14 tests

# OBS development tree, once per machine (5-10 min, about 1 GB, Windows only; macOS and Linux are built by CI)
bash plugin/scripts/setup-obs-dev.sh             # -> plugin/.deps (git-ignored); OLC_DEPS_DIR=<dir> shares one tree between worktrees

# The real OBS module + olc-cli (about 1.5 min)
bash plugin/scripts/build-plugin.sh              # -> plugin/build-plugin/src/Release/obs-live-clock.dll

# TypeScript (existing)
pnpm vitest run server/test/hotkeys server/test/kiosk && pnpm typecheck
# The contract test against the real C++ core
OLC_CLI="$PWD/plugin/build-plugin/tools/Release/olc-cli.exe" OLC_CLI_DLL_DIR="$PWD/plugin/.deps/deps/bin" pnpm vitest run server/test/contract
```

How the scripts enter the Visual Studio environment: they do not need to. `cmake -G "Visual Studio 18 2026" -A x64` finds the compiler itself; `lib.sh` chooses the generator name with `vswhere -latest -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64` (18 -> "Visual Studio 18 2026", 17 -> "Visual Studio 17 2022"). `OLC_CMAKE_GENERATOR=Ninja` overrides it.

## File structure

```
plugin/CMakeLists.txt  .clang-format  contract/plugin-contract.json
plugin/core/      Secret.hpp Http.hpp Health.* Paths.* PluginSettings.* ScreenInfo.* LaunchPolicy.* ObsWsConfig.* CredentialTracker.*
                  ApiClient.* Dispatcher.* TickLoop.* HotkeySlots.* HotkeyForwarder.* Supervisor.* Texts.*       (T1,T3,T4,T5,T6,T10)
plugin/net/       CurlHttp.hpp CurlHttp.cpp                                                                   (T9)
plugin/src/       BrowserPanel.* plugin-main.cpp (T9)  DockHost.* SettingsStore.* SettingsDialog.* SystemAdapters.* (T13)
                  HotkeyRegistrar.* ScreenReporter.* (T14)  PluginController.* plugin-main.cpp (T15)
plugin/tools/     cli.cpp                                                                                    (T16)
plugin/tests/     main.cpp support/fakes.hpp test_*.cpp (one per unit; test_glue_rules.cpp T15, test_contract.cpp T16)
plugin/scripts/   lib.sh test.sh verify.sh (T1)  setup-obs-dev.sh build-plugin.sh (T9)
plugin/ci/        obs_deps.py test_obs_deps.py (T1)  check_browser_panel_abi.py test_check_browser_panel_abi.py (T9)
plugin/third_party/  doctest/  nlohmann/                                                                      (T1)
server/src/hotkeys/  slots.ts hotkey-service.ts                                                              (T2)
server/src/kiosk/    settings.ts screens.ts placement.ts restart-policy.ts (T2)  detect.ts controller.ts node-kiosk.ts (T7)
server/src/api/      internal.ts (changed) system.ts (new)      server/src/app/ runtime-file.ts settings.ts paths.ts server.ts main.ts
web/src/ui/control/HotkeyHint.tsx   web/src/control/KioskPanel.tsx   web/src/core/http.ts i18n.ts
.github/workflows/ci.yml   docs/TEST-PLAN.md README.md BACKLOG.md DECISIONS.md TECH-DESIGN.md THIRD-PARTY-NOTICES.md
```

---

### Task 1: Plugin scaffold and foundation

**Files:**
- Create: `plugin/CMakeLists.txt`, `plugin/core/CMakeLists.txt`, `plugin/net/CMakeLists.txt`, `plugin/tools/CMakeLists.txt`, `plugin/tests/CMakeLists.txt`, `plugin/tests/main.cpp`, `plugin/core/Secret.hpp`, `plugin/core/Http.hpp`, `plugin/core/Health.hpp`, `plugin/core/Health.cpp`, `plugin/tests/test_health.cpp`, `plugin/scripts/lib.sh`, `plugin/scripts/test.sh`, `plugin/scripts/verify.sh`, `plugin/ci/obs_deps.py`, `plugin/ci/test_obs_deps.py`, `plugin/.clang-format`, `plugin/third_party/doctest/doctest.h`, `plugin/third_party/doctest/LICENSE.txt`, `plugin/third_party/nlohmann/json.hpp`, `plugin/third_party/nlohmann/LICENSE.MIT`
- Modify: `THIRD-PARTY-NOTICES.md`

**What is reused from Playlist Deck** (`angeloruggieridj/obs-playlist-deck` at commit `092baa2`): the CMake layout (a static core library + a doctest test executable + a MODULE for the plugin, `/utf-8` for MSVC, the Qt-version guard), vendored single-header doctest and nlohmann/json, `tools/obs_deps.py` (which reads OBS's own `CMakePresets.json` to learn the obs-deps and Qt versions) and its test, and `.clang-format`. Its tests are doctest plus a few source-inspection tests; this plan keeps that style.

**Interfaces:**
- Produces: CMake targets `olc-core` (static, all `plugin/core/*.cpp`), `olc-tests` (all `plugin/tests/test_*.cpp`), `olc-net` (when libcurl is found and `plugin/net/*.cpp` exist), `olc-cli` (when `plugin/tools/cli.cpp` exists), and later `obs-live-clock` (MODULE, `plugin/src`); `olc::Secret`, `olc::IHttpClient`, `olc::HttpRequest/HttpResponse`, `olc::HealthInfo`, `olc::parseHealth`, `olc::checkProtocol`, `olc::kProtocolVersion`; the scripts `verify.sh`, `test.sh`.

- [ ] **Step 1: Vendor the third-party files (exact commands)**

```bash
PD=https://raw.githubusercontent.com/angeloruggieridj/obs-playlist-deck/092baa2eda0e0762786e8d370d3bf15d0dbfdac1
mkdir -p plugin/third_party/doctest plugin/third_party/nlohmann plugin/ci plugin/scripts plugin/core plugin/net plugin/tools plugin/tests/support
curl -fsSL $PD/third_party/doctest/doctest.h -o plugin/third_party/doctest/doctest.h                     # doctest 2.4.11, MIT
curl -fsSL https://raw.githubusercontent.com/doctest/doctest/v2.4.11/LICENSE.txt -o plugin/third_party/doctest/LICENSE.txt
curl -fsSL $PD/third_party/nlohmann/json.hpp -o plugin/third_party/nlohmann/json.hpp                     # nlohmann/json 3.11.3, MIT
curl -fsSL https://raw.githubusercontent.com/nlohmann/json/v3.11.3/LICENSE.MIT -o plugin/third_party/nlohmann/LICENSE.MIT
curl -fsSL $PD/.clang-format -o plugin/.clang-format
curl -fsSL $PD/tools/obs_deps.py -o plugin/ci/obs_deps.py
curl -fsSL $PD/tools/test_obs_deps.py -o plugin/ci/test_obs_deps.py
# our changes to the two Python files: an SPDX line after the shebang, and our own User-Agent
sed -i '1a # SPDX-License-Identifier: GPL-2.0-or-later' plugin/ci/obs_deps.py plugin/ci/test_obs_deps.py
sed -i 's/obs-playlist-deck-ci/obs-live-clock-ci/' plugin/ci/obs_deps.py
grep -c "define DOCTEST_VERSION_STR" plugin/third_party/doctest/doctest.h   # 1
grep -n "NLOHMANN_JSON_VERSION_MINOR 11" plugin/third_party/nlohmann/json.hpp | head -1
```

Add to `THIRD-PARTY-NOTICES.md` (after the Inter section):

```markdown
## doctest (C++ test framework, plugin tests only)

`plugin/third_party/doctest/doctest.h`, version **2.4.11**, Copyright (c) 2016-2023 Viktor Kirilov, **MIT** (SPDX: `MIT`). Used only to build the plugin's unit tests; not part of the shipped plugin. Licence text: `plugin/third_party/doctest/LICENSE.txt`.

## nlohmann/json (C++ JSON library, linked into the plugin)

`plugin/third_party/nlohmann/json.hpp`, version **3.11.3**, Copyright (c) 2013-2022 Niels Lohmann, **MIT** (SPDX: `MIT`). Linked into the OBS plugin to read and write JSON. Licence text: `plugin/third_party/nlohmann/LICENSE.MIT`.
```

- [ ] **Step 2: Write the build files, scripts and the failing test**

`plugin/CMakeLists.txt`
```cmake
# SPDX-License-Identifier: GPL-2.0-or-later
cmake_minimum_required(VERSION 3.22)
project(obs-live-clock-plugin VERSION 0.1.0 LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

# MSVC reads a UTF-8 source file as the system ANSI code page unless told otherwise.
if(MSVC)
  add_compile_options(/utf-8 /W4)
else()
  add_compile_options(-Wall -Wextra)
endif()

option(BUILD_PLUGIN "Build the OBS plugin module (needs libobs, obs-frontend-api, Qt6, libcurl)" ON)
option(BUILD_TESTS "Build the unit tests (no OBS needed)" ON)

add_subdirectory(core)
add_subdirectory(net)
add_subdirectory(tools)

if(BUILD_TESTS)
  enable_testing()
  add_subdirectory(tests)
endif()

if(BUILD_PLUGIN AND EXISTS "${CMAKE_CURRENT_SOURCE_DIR}/src/CMakeLists.txt")
  add_subdirectory(src)
endif()
```

`plugin/core/CMakeLists.txt`
```cmake
# SPDX-License-Identifier: GPL-2.0-or-later
# Every .cpp in this folder is part of the core. Later tasks only ADD files; nobody edits this list.
file(GLOB OLC_CORE_SOURCES CONFIGURE_DEPENDS "${CMAKE_CURRENT_SOURCE_DIR}/*.cpp")
add_library(olc-core STATIC ${OLC_CORE_SOURCES})
target_include_directories(olc-core PUBLIC "${CMAKE_CURRENT_SOURCE_DIR}" PUBLIC "${CMAKE_SOURCE_DIR}/third_party")
target_compile_features(olc-core PUBLIC cxx_std_17)
set_target_properties(olc-core PROPERTIES POSITION_INDEPENDENT_CODE ON)
find_package(Threads REQUIRED)
target_link_libraries(olc-core PUBLIC Threads::Threads)
```

`plugin/net/CMakeLists.txt`
```cmake
# SPDX-License-Identifier: GPL-2.0-or-later
# libcurl behind IHttpClient. Built only when libcurl is found, so the unit-test-only builds need nothing extra.
# Every .cpp in this folder is part of olc-net. Later tasks only ADD files; nobody edits this list.
find_package(CURL)
file(GLOB OLC_NET_SOURCES CONFIGURE_DEPENDS "${CMAKE_CURRENT_SOURCE_DIR}/*.cpp")
if(CURL_FOUND AND OLC_NET_SOURCES)
  add_library(olc-net STATIC ${OLC_NET_SOURCES})
  target_include_directories(olc-net PUBLIC "${CMAKE_CURRENT_SOURCE_DIR}")
  target_link_libraries(olc-net PUBLIC olc-core CURL::libcurl)
  set_target_properties(olc-net PROPERTIES POSITION_INDEPENDENT_CODE ON)
else()
  message(STATUS "OBS Live Clock: libcurl not found (or no net sources yet) - olc-net and olc-cli are not built")
endif()
```

`plugin/tools/CMakeLists.txt`
```cmake
# SPDX-License-Identifier: GPL-2.0-or-later
# olc-cli: the plugin's core with a real HTTP client and no OBS, used by the contract test (server/test/contract).
if(TARGET olc-net AND EXISTS "${CMAKE_CURRENT_SOURCE_DIR}/cli.cpp")
  add_executable(olc-cli cli.cpp)
  target_link_libraries(olc-cli PRIVATE olc-net)
endif()
```

`plugin/tests/CMakeLists.txt`
```cmake
# SPDX-License-Identifier: GPL-2.0-or-later
# Every test_*.cpp in this folder is a test. Later tasks only ADD files; nobody edits this list.
file(GLOB OLC_TEST_SOURCES CONFIGURE_DEPENDS "${CMAKE_CURRENT_SOURCE_DIR}/test_*.cpp")
add_executable(olc-tests main.cpp ${OLC_TEST_SOURCES})
target_link_libraries(olc-tests PRIVATE olc-core)
target_compile_definitions(olc-tests PRIVATE OLC_SOURCE_DIR="${CMAKE_SOURCE_DIR}")
add_test(NAME core COMMAND olc-tests)
```

`plugin/tests/main.cpp`
```cpp
// SPDX-License-Identifier: GPL-2.0-or-later
#define DOCTEST_CONFIG_IMPLEMENT_WITH_MAIN
#include "doctest/doctest.h"
```

`plugin/scripts/lib.sh`
```bash
# SPDX-License-Identifier: GPL-2.0-or-later
# Shared helpers for the plugin scripts. Source it: . "$(dirname "$0")/lib.sh"
# Works in Git Bash on Windows, and in bash on macOS and Linux.

OLC_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# Where the OBS development tree lives. Set OLC_DEPS_DIR to share one tree between git worktrees (about 1 GB).
OLC_DEPS_DIR="${OLC_DEPS_DIR:-$OLC_ROOT/.deps}"
export OLC_ROOT OLC_DEPS_DIR

olc_is_windows() { case "$(uname -s)" in MINGW*|MSYS*|CYGWIN*) return 0 ;; *) return 1 ;; esac; }

# Native path with forward slashes ("C:/Users/..."), which CMake accepts everywhere. A no-op off Windows.
olc_native_path() { if olc_is_windows && command -v cygpath >/dev/null 2>&1; then cygpath -m "$1"; else printf '%s' "$1"; fi; }

# Fills GEN_ARGS with the CMake generator arguments.
#   OLC_CMAKE_GENERATOR overrides the choice (for example "Ninja").
#   Windows: the newest Visual Studio that has the C++ tools, found with vswhere. This machine has Visual Studio 2022
#   and "18" (2026) Build Tools but only "18" carries the C++ tools, so "Visual Studio 17 2022" would fail with
#   "could not find any instance of Visual Studio". No `cl` or `ninja` on PATH is needed.
#   Elsewhere: Ninja when it is installed, else CMake's default.
olc_pick_generator() {
  GEN_ARGS=()
  if [ -n "${OLC_CMAKE_GENERATOR:-}" ]; then
    GEN_ARGS=(-G "$OLC_CMAKE_GENERATOR")
  elif olc_is_windows; then
    local vswhere="/c/Program Files (x86)/Microsoft Visual Studio/Installer/vswhere.exe" version name
    if [ ! -x "$vswhere" ]; then echo "vswhere.exe not found: install Visual Studio Build Tools with the C++ workload" >&2; return 1; fi
    version="$("$vswhere" -latest -products '*' -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationVersion | tr -d '\r')"
    case "${version%%.*}" in
      18) name="Visual Studio 18 2026" ;;
      17) name="Visual Studio 17 2022" ;;
      16) name="Visual Studio 16 2019" ;;
      *) echo "no Visual Studio with the C++ tools found (vswhere said '$version')" >&2; return 1 ;;
    esac
    GEN_ARGS=(-G "$name" -A x64)
  elif command -v ninja >/dev/null 2>&1; then
    GEN_ARGS=(-G Ninja)
  fi
}
```

`plugin/scripts/test.sh`
```bash
#!/usr/bin/env bash
# SPDX-License-Identifier: GPL-2.0-or-later
# Build the plugin's pure core and run its C++ unit tests. Needs only CMake and a C++17 compiler: no OBS, no Qt.
# Usage: plugin/scripts/test.sh            (from anywhere)
#        OLC_CMAKE_GENERATOR=Ninja plugin/scripts/test.sh
set -euo pipefail
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
olc_pick_generator
build="$OLC_ROOT/build"
cmake -S "$OLC_ROOT" -B "$build" "${GEN_ARGS[@]}" -DBUILD_PLUGIN=OFF -DBUILD_TESTS=ON
cmake --build "$build" --config Release --parallel
ctest --test-dir "$build" -C Release --output-on-failure
```

`plugin/scripts/verify.sh`
```bash
#!/usr/bin/env bash
# SPDX-License-Identifier: GPL-2.0-or-later
# One-line result for the orchestrator: C++ unit tests + the Python CI helper tests.
# Prints "PASS cpp=<n> test cases py=<n> tests" or "FAIL ..." followed by the last lines of the failing step.
set -u
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
log="$(mktemp)"
trap 'rm -f "$log"' EXIT
if ! bash "$OLC_ROOT/scripts/test.sh" >"$log" 2>&1; then
  echo "FAIL cpp"; tail -25 "$log"; exit 1
fi
cpp="$(grep -E '^\[doctest\] test cases:' "$log" | tail -1 | sed -E 's/.*test cases: *([0-9]+).*/\1/')"
if [ -z "$cpp" ]; then
  # ctest hides the doctest summary on success: run the binary once more for the count.
  exe="$(find "$OLC_ROOT/build" -name 'olc-tests*' -type f \( -name '*.exe' -o -perm -u+x \) | head -1)"
  cpp="$("$exe" 2>&1 | grep -E '^\[doctest\] test cases:' | sed -E 's/.*test cases: *([0-9]+).*/\1/')"
fi
py="$(command -v python3 || command -v python)"
if ! "$py" -I -m unittest discover -s "$OLC_ROOT/ci" -p 'test_*.py' >"$log" 2>&1; then
  echo "FAIL python"; tail -25 "$log"; exit 1
fi
pytests="$(grep -E '^Ran [0-9]+ tests' "$log" | sed -E 's/Ran ([0-9]+) tests.*/\1/')"
echo "PASS cpp=${cpp} test cases py=${pytests} tests"
```

`plugin/tests/test_health.cpp`
```cpp
// SPDX-License-Identifier: GPL-2.0-or-later
#include "doctest/doctest.h"

#include <sstream>

#include "Health.hpp"
#include "Secret.hpp"

using namespace olc;

TEST_CASE("parseHealth reads the three fields of /api/health") {
    const auto h = parseHealth(R"({"version":"0.5.0","protocol":1,"instanceId":"2f1c"})");
    REQUIRE(h.has_value());
    CHECK(h->version == "0.5.0");
    CHECK(h->protocol == 1);
    CHECK(h->instanceId == "2f1c");
}

TEST_CASE("parseHealth rejects anything that is not our app") {
    CHECK_FALSE(parseHealth("").has_value());
    CHECK_FALSE(parseHealth("<html>nginx</html>").has_value());
    CHECK_FALSE(parseHealth("[]").has_value());
    CHECK_FALSE(parseHealth(R"({"version":"1","protocol":"1","instanceId":"x"})").has_value());
    CHECK_FALSE(parseHealth(R"({"version":"1","protocol":1})").has_value());
    CHECK_FALSE(parseHealth(R"({"version":"1","protocol":1,"instanceId":""})").has_value());
}

TEST_CASE("checkProtocol tells which side to update") {
    CHECK(checkProtocol(1, 1) == Compat::Ok);
    CHECK(checkProtocol(2, 1) == Compat::AppNewer);
    CHECK(checkProtocol(0, 1) == Compat::AppOlder);
    CHECK(kProtocolVersion == 1);
}

TEST_CASE("a Secret never shows its value when streamed or described") {
    const Secret s("hunter2-hunter2");
    CHECK(describe(s) == "<secret>");
    CHECK(describe(Secret()) == "<empty>");
    std::ostringstream os;
    os << s;
    CHECK(os.str().find("hunter2") == std::string::npos);
    CHECK(s.reveal() == "hunter2-hunter2");
    CHECK(s == Secret("hunter2-hunter2"));
}
```


- [ ] **Step 3: Run the tests, confirm they fail**

`bash plugin/scripts/verify.sh`. Expected: `FAIL cpp` (the build fails: `Health.hpp` is missing, and a static library with no sources).

- [ ] **Step 4: Implement the foundation**

`plugin/core/Secret.hpp`
```cpp
// SPDX-License-Identifier: GPL-2.0-or-later
#pragma once
#include <ostream>
#include <string>
#include <utility>

namespace olc {

/**
 * A value that must never reach a log line, a command line or a test message (DT-5).
 * There is deliberately no implicit conversion to std::string: the one way out is reveal(),
 * which is greppable. Streaming a Secret prints a fixed marker, never the value.
 */
class Secret {
public:
    Secret() = default;
    explicit Secret(std::string value) : value_(std::move(value)) {}
    const std::string& reveal() const { return value_; }
    bool empty() const { return value_.empty(); }
    bool operator==(const Secret& other) const { return value_ == other.value_; }
    bool operator!=(const Secret& other) const { return !(*this == other); }

private:
    std::string value_;
};

inline std::string describe(const Secret& secret) { return secret.empty() ? "<empty>" : "<secret>"; }
inline std::ostream& operator<<(std::ostream& os, const Secret& secret) { return os << describe(secret); }

} // namespace olc
```

`plugin/core/Http.hpp`
```cpp
// SPDX-License-Identifier: GPL-2.0-or-later
#pragma once
#include <string>
#include <utility>
#include <vector>

namespace olc {

struct HttpRequest {
    std::string method;                                        // "GET" | "POST"
    std::string url;                                           // absolute, http(s)
    std::vector<std::pair<std::string, std::string>> headers;  // includes Authorization: never logged
    std::string body;                                          // may hold a password: never logged
    int timeoutMs = 1500;                                      // whole request, connect included
};

struct HttpResponse {
    int status = 0;     // 0 = no HTTP answer (see error)
    std::string body;
    std::string error;  // transport failure, short, free of request data
    bool answered() const { return status > 0 && error.empty(); }
};

/** The only door to the network. The real one (libcurl) lives in src/; tests use fakes. Blocking by contract. */
class IHttpClient {
public:
    virtual ~IHttpClient() = default;
    virtual HttpResponse perform(const HttpRequest& request) = 0;
};

} // namespace olc
```

`plugin/core/Health.hpp`
```cpp
// SPDX-License-Identifier: GPL-2.0-or-later
#pragma once
#include <optional>
#include <string>
#include <string_view>

namespace olc {

/** shared PROTOCOL_VERSION of the app this plugin was written for. A contract test pins it to the server. */
inline constexpr int kProtocolVersion = 1;

struct HealthInfo {
    std::string version;
    int protocol = 0;
    std::string instanceId;
};

/** Body of GET /api/health: {"version":"..","protocol":1,"instanceId":".."}. Anything else is not our app. */
std::optional<HealthInfo> parseHealth(std::string_view body);

enum class Compat { Ok, AppNewer, AppOlder };
Compat checkProtocol(int appProtocol, int expected = kProtocolVersion);

} // namespace olc
```

`plugin/core/Health.cpp`
```cpp
// SPDX-License-Identifier: GPL-2.0-or-later
#include "Health.hpp"

#include <nlohmann/json.hpp>

namespace olc {

std::optional<HealthInfo> parseHealth(std::string_view body) {
    const auto doc = nlohmann::json::parse(body.begin(), body.end(), nullptr, false);
    if (!doc.is_object()) return std::nullopt;
    const auto version = doc.find("version");
    const auto protocol = doc.find("protocol");
    const auto instance = doc.find("instanceId");
    if (version == doc.end() || !version->is_string()) return std::nullopt;
    if (protocol == doc.end() || !protocol->is_number_integer()) return std::nullopt;
    if (instance == doc.end() || !instance->is_string() || instance->get<std::string>().empty()) return std::nullopt;
    HealthInfo info;
    info.version = version->get<std::string>();
    info.protocol = protocol->get<int>();
    info.instanceId = instance->get<std::string>();
    return info;
}

Compat checkProtocol(int appProtocol, int expected) {
    if (appProtocol == expected) return Compat::Ok;
    return appProtocol > expected ? Compat::AppNewer : Compat::AppOlder;
}

} // namespace olc
```


- [ ] **Step 5: Run the tests, confirm they pass**

`bash plugin/scripts/verify.sh`. Expected: `PASS cpp=4 test cases py=...` (4 doctest cases in `test_health.cpp`, plus the Python tests of `obs_deps.py`). Also run `git status`: `plugin/build/` must not appear (it is ignored by the existing `.gitignore`).

- [ ] **Step 6: Commit**

```
git add plugin THIRD-PARTY-NOTICES.md
git commit -m "feat(plugin): CMake scaffold, vendored doctest and nlohmann/json, test scripts, Secret, Http, Health"
```

---

### Task 2: Server pure modules — hotkey slots and confirmation, kiosk settings, screens, placement

**Files:**
- Create: `server/src/hotkeys/slots.ts`, `server/src/hotkeys/hotkey-service.ts`, `server/src/kiosk/settings.ts`, `server/src/kiosk/screens.ts`, `server/src/kiosk/placement.ts`, `server/src/kiosk/restart-policy.ts`, `server/test/hotkeys/hotkey-service.test.ts`, `server/test/kiosk/screens.test.ts`, `server/test/kiosk/placement.test.ts`, `server/test/app/settings-kiosk.test.ts`
- Modify: `server/src/app/paths.ts`, `server/src/app/settings.ts`, `server/test/app/basics.test.ts`

**Interfaces:**
- Produces: `HOTKEY_SLOT_IDS`, `HotkeySlotId`, `EMERGENCY_SLOTS`, `CONFIRM_WINDOW_MS` (1000), `MIN_CONFIRM_GAP_MS` (120), `HotkeyBody` (zod); `HotkeyService.press(slot, {session?, seq?}) → HotkeyResult`, `.pending()`; `KioskSettings`/`KioskScreen` (zod + types); `ScreenInfo`, `ScreensBody`, `ScreenRegistry`; `choosePlacement`, `buildKioskArgs`, `WINDOW_INSET`; `RestartPolicy`; `Settings.kiosk`, `publicSettings`, `SettingsHolder` (the only settings write path), `SettingsFileInvalidError`; `DataPaths.screens`, `DataPaths.kioskProfile`.
- The slot ids, their order and which are emergency are a **contract with `plugin/core/HotkeySlots.cpp`** (Task 6 and the contract test of Task 16).

Rules the tests pin (DT-9): emergency slots (`next`, `prev`, `time-plus`, `time-minus`, `control-toggle`) execute only on a second press of the **same** slot within 1 s and not sooner than 120 ms after the first (key bounce); any other slot, a message or CLEAR, cancels a pending confirmation; a repeated `(session, seq)` is a duplicate delivery and is ignored; with no episode loaded every press is ignored (`no_episode`); message slot N sends the Nth preset of the loaded episode (`no_preset` when there is none). A named monitor is never replaced by another one.

- [ ] **Step 1: Write the failing tests**

`server/test/hotkeys/hotkey-service.test.ts`
```ts
// SPDX-License-Identifier: GPL-2.0-or-later
import type { ClientCommand } from '@olc/shared';
import { describe, expect, it } from 'vitest';
import { FakeTime } from '../../src/clock/clock';
import { HotkeyService, type HotkeyRuntime } from '../../src/hotkeys/hotkey-service';
import { CONFIRM_WINDOW_MS, EMERGENCY_SLOTS, HOTKEY_SLOT_IDS, MIN_CONFIRM_GAP_MS } from '../../src/hotkeys/slots';

function setup(opts: { episode?: boolean; messages?: number; control?: 'auto' | 'manual' } = {}) {
  const time = new FakeTime();
  const commands: ClientCommand[] = [];
  const messages = Array.from({ length: opts.messages ?? 3 }, (_, i) => ({
    text: `MSG ${i + 1}`,
    dismiss: { kind: 'timeout' as const, ms: 5_000 },
  }));
  const state =
    opts.episode === false
      ? null
      : { control: opts.control ?? ('auto' as const), episode: { messages, preset: { adjustStepMs: 30_000 } } };
  const runtime: HotkeyRuntime = {
    getState: () => state,
    command: (c) => {
      commands.push(c);
      return true;
    },
  };
  const service = new HotkeyService({ runtime, clock: time });
  return { time, commands, service };
}

describe('HotkeyService', () => {
  it('has the 18 fixed slots, five of them emergency', () => {
    expect(HOTKEY_SLOT_IDS).toHaveLength(18);
    expect([...EMERGENCY_SLOTS].sort()).toEqual(['control-toggle', 'next', 'prev', 'time-minus', 'time-plus']);
  });

  it('message slots send the preset at that position, immediately', () => {
    const { service, commands } = setup();
    expect(service.press('message-2')).toEqual({ result: 'executed', slot: 'message-2', changed: true });
    expect(commands).toEqual([{ name: 'send_message', text: 'MSG 2', dismiss: { kind: 'timeout', ms: 5_000 } }]);
  });

  it('a message slot with no preset behind it is ignored, not an error', () => {
    const { service, commands } = setup({ messages: 3 });
    expect(service.press('message-12')).toEqual({ result: 'ignored', slot: 'message-12', reason: 'no_preset' });
    expect(commands).toEqual([]);
  });

  it('CLEAR is immediate', () => {
    const { service, commands } = setup();
    service.press('clear');
    expect(commands).toEqual([{ name: 'clear_message' }]);
  });

  it('nothing runs without an episode', () => {
    const { service, commands } = setup({ episode: false });
    expect(service.press('message-1')).toMatchObject({ result: 'ignored', reason: 'no_episode' });
    expect(service.press('next')).toMatchObject({ result: 'ignored', reason: 'no_episode' });
    expect(commands).toEqual([]);
  });

  it('an emergency slot needs a second press of the same slot within 1 s', () => {
    const { service, commands, time } = setup();
    expect(service.press('next')).toEqual({ result: 'pending', slot: 'next', remainingMs: CONFIRM_WINDOW_MS });
    expect(commands).toEqual([]);
    time.mono += 300;
    expect(service.press('next')).toEqual({ result: 'executed', slot: 'next', changed: true });
    expect(commands).toEqual([{ name: 'next' }]);
  });

  it('a second press after the window starts a new confirmation instead of executing', () => {
    const { service, commands, time } = setup();
    service.press('prev');
    time.mono += CONFIRM_WINDOW_MS + 1;
    expect(service.press('prev')).toMatchObject({ result: 'pending' });
    expect(commands).toEqual([]);
  });

  it('the last millisecond of the window still confirms', () => {
    const { service, commands, time } = setup();
    service.press('prev');
    time.mono += CONFIRM_WINDOW_MS;
    expect(service.press('prev')).toMatchObject({ result: 'executed' });
    expect(commands).toEqual([{ name: 'prev' }]);
  });

  it('a different slot never confirms another one', () => {
    const { service, commands, time } = setup();
    service.press('next');
    time.mono += 300;
    expect(service.press('prev')).toMatchObject({ result: 'pending', slot: 'prev' });
    time.mono += 300;
    expect(service.press('next')).toMatchObject({ result: 'pending', slot: 'next' });
    expect(commands).toEqual([]);
  });

  it('pressing a message or CLEAR between two presses cancels the confirmation', () => {
    const { service, commands, time } = setup();
    service.press('next');
    time.mono += 200;
    service.press('message-1');
    time.mono += 200;
    expect(service.press('next')).toMatchObject({ result: 'pending' });
    expect(commands.map((c) => c.name)).toEqual(['send_message']);
  });

  it('key bounce (a second press within 120 ms) neither confirms nor resets the window', () => {
    const { service, commands, time } = setup();
    service.press('next');
    time.mono += MIN_CONFIRM_GAP_MS - 1;
    expect(service.press('next')).toEqual({ result: 'ignored', slot: 'next', reason: 'bounce' });
    expect(commands).toEqual([]);
    time.mono += 500;
    expect(service.press('next')).toMatchObject({ result: 'executed' });
  });

  it('a triple tap executes once and then starts a new confirmation', () => {
    const { service, commands, time } = setup();
    service.press('next');
    time.mono += 300;
    service.press('next');
    time.mono += 300;
    expect(service.press('next')).toMatchObject({ result: 'pending' });
    expect(commands).toEqual([{ name: 'next' }]);
  });

  it('a duplicate delivery (same session and seq) is ignored and never confirms', () => {
    const { service, commands, time } = setup();
    expect(service.press('next', { session: 's1', seq: 1 })).toMatchObject({ result: 'pending' });
    time.mono += 300;
    expect(service.press('next', { session: 's1', seq: 1 })).toMatchObject({ result: 'ignored', reason: 'duplicate' });
    expect(commands).toEqual([]);
    expect(service.press('next', { session: 's1', seq: 2 })).toMatchObject({ result: 'executed' });
  });

  it('a restarted plugin (new session, seq back at 1) is not mistaken for a duplicate', () => {
    const { service } = setup();
    service.press('message-1', { session: 'old', seq: 40 });
    expect(service.press('message-1', { session: 'new', seq: 1 })).toMatchObject({ result: 'executed' });
  });

  it('time-plus and time-minus adjust by the episode step, control-toggle flips the mode', () => {
    const a = setup();
    a.service.press('time-plus');
    a.time.mono += 300;
    a.service.press('time-plus');
    a.service.press('time-minus');
    a.time.mono += 300;
    a.service.press('time-minus');
    expect(a.commands).toEqual([
      { name: 'adjust', deltaMs: 30_000 },
      { name: 'adjust', deltaMs: -30_000 },
    ]);
    const auto = setup({ control: 'auto' });
    auto.service.press('control-toggle');
    auto.time.mono += 300;
    auto.service.press('control-toggle');
    expect(auto.commands).toEqual([{ name: 'set_control', control: 'manual' }]);
    const manual = setup({ control: 'manual' });
    manual.service.press('control-toggle');
    manual.time.mono += 300;
    manual.service.press('control-toggle');
    expect(manual.commands).toEqual([{ name: 'set_control', control: 'auto' }]);
  });

  it('pending() reports the live confirmation for the dock and expires with the window', () => {
    const { service, time } = setup();
    expect(service.pending()).toBeNull();
    service.press('next');
    time.mono += 400;
    expect(service.pending()).toEqual({ slot: 'next', remainingMs: 600 });
    time.mono += 700;
    expect(service.pending()).toBeNull();
  });

  it('forgets old sessions beyond eight', () => {
    const { service } = setup();
    for (let i = 0; i < 12; i++) service.press('message-1', { session: `s${i}`, seq: 5 });
    expect(service.press('message-1', { session: 's0', seq: 5 })).toMatchObject({ result: 'executed' });
  });
});
```

`server/test/kiosk/screens.test.ts`
```ts
// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it, vi } from 'vitest';
import { ScreenRegistry, ScreensBody, type ScreenInfo, type ScreenStore } from '../../src/kiosk/screens';

const a: ScreenInfo = { name: 'DISPLAY1', x: 0, y: 0, width: 1920, height: 1080, devicePixelRatio: 1, primary: true };
const b: ScreenInfo = { name: 'DISPLAY2', x: 1920, y: 0, width: 1920, height: 1080, devicePixelRatio: 1, primary: false };

function store(initial: ScreenInfo[] = []): ScreenStore & { saved: ScreenInfo[][] } {
  const saved: ScreenInfo[][] = [];
  return { saved, load: async () => initial, save: async (s) => void saved.push(s) };
}

describe('ScreensBody', () => {
  it('accepts what the plugin sends and defaults the pixel ratio', () => {
    const parsed = ScreensBody.parse({ screens: [{ name: 'D', x: -1920, y: 0, width: 1920, height: 1080, primary: false }] });
    expect(parsed.screens[0]!.devicePixelRatio).toBe(1);
  });
  it('rejects empty names, zero sizes, fractional positions and more than 16 screens', () => {
    expect(ScreensBody.safeParse({ screens: [{ ...a, name: '' }] }).success).toBe(false);
    expect(ScreensBody.safeParse({ screens: [{ ...a, width: 0 }] }).success).toBe(false);
    expect(ScreensBody.safeParse({ screens: [{ ...a, x: 0.5 }] }).success).toBe(false);
    expect(ScreensBody.safeParse({ screens: Array.from({ length: 17 }, () => a) }).success).toBe(false);
  });
});

describe('ScreenRegistry', () => {
  it('starts with the remembered list marked as not live', async () => {
    const r = new ScreenRegistry(store([a, b]));
    await r.init();
    expect(r.get()).toEqual({ screens: [a, b], live: false });
  });

  it('a corrupt memory file means an empty list, reported, not a crash', async () => {
    const report = vi.fn();
    const r = new ScreenRegistry({ load: async () => Promise.reject(new Error('bad json')), save: async () => {} }, report);
    await r.init();
    expect(r.get()).toEqual({ screens: [], live: false });
    expect(report).toHaveBeenCalled();
  });

  it('set() makes the list live, remembers it and tells listeners', async () => {
    const s = store();
    const r = new ScreenRegistry(s);
    await r.init();
    const heard = vi.fn();
    r.onChange(heard);
    r.set([a, b]);
    expect(r.get()).toEqual({ screens: [a, b], live: true });
    expect(heard).toHaveBeenCalledTimes(1);
    expect(s.saved).toEqual([[a, b]]);
  });

  it('the plugin repeating the same list does not rewrite the file or wake anyone again', async () => {
    const s = store();
    const r = new ScreenRegistry(s);
    await r.init();
    r.set([a, b]);
    const heard = vi.fn();
    r.onChange(heard);
    r.set([a, b]);
    expect(heard).not.toHaveBeenCalled();
    expect(s.saved).toHaveLength(1);
  });

  it('the first live list after a restart wakes listeners even when it equals the remembered one, but writes nothing', async () => {
    const s = store([a, b]);
    const r = new ScreenRegistry(s);
    await r.init();
    const heard = vi.fn();
    r.onChange(heard);
    r.set([a, b]);
    expect(heard).toHaveBeenCalledTimes(1);
    expect(s.saved).toHaveLength(0);
    expect(r.get().live).toBe(true);
  });

  it('a failing save is reported and does not break the registry', async () => {
    const report = vi.fn();
    const r = new ScreenRegistry({ load: async () => [], save: async () => Promise.reject(new Error('disk full')) }, report);
    await r.init();
    r.set([a]);
    await new Promise((res) => setTimeout(res, 0));
    expect(report).toHaveBeenCalled();
    expect(r.get().screens).toEqual([a]);
  });

  it('get() returns copies', async () => {
    const r = new ScreenRegistry(store());
    await r.init();
    r.set([a]);
    r.get().screens[0]!.name = 'hacked';
    expect(r.get().screens[0]!.name).toBe('DISPLAY1');
  });
});
```

`server/test/kiosk/placement.test.ts`
```ts
// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import { buildKioskArgs, choosePlacement, WINDOW_INSET } from '../../src/kiosk/placement';
import type { ScreenInfo } from '../../src/kiosk/screens';
import { DEFAULT_RESTART_POLICY, RestartPolicy } from '../../src/kiosk/restart-policy';

const main: ScreenInfo = { name: '\\\\.\\DISPLAY1', x: 0, y: 0, width: 1920, height: 1080, devicePixelRatio: 1, primary: true };
const tv: ScreenInfo = { name: '\\\\.\\DISPLAY2', x: 1920, y: 0, width: 1920, height: 1080, devicePixelRatio: 1, primary: false };
const left: ScreenInfo = { name: 'LEFT', x: -1280, y: -100, width: 1280, height: 1024, devicePixelRatio: 1, primary: false };

describe('choosePlacement', () => {
  it('opens on the named monitor, a little inside it', () => {
    expect(choosePlacement({ kind: 'name', name: tv.name }, [main, tv])).toEqual({
      ok: true,
      x: 1920 + WINDOW_INSET,
      y: WINDOW_INSET,
      width: 1920,
      height: 1080,
      screen: tv.name,
    });
  });

  it('works for a monitor left of / above the primary one (negative origin)', () => {
    expect(choosePlacement({ kind: 'name', name: 'LEFT' }, [main, left])).toMatchObject({
      ok: true,
      x: -1280 + WINDOW_INSET,
      y: -100 + WINDOW_INSET,
    });
  });

  it('never replaces a named monitor that is not there: no launch, a reason instead', () => {
    expect(choosePlacement({ kind: 'name', name: 'GONE' }, [main, tv])).toEqual({ ok: false, reason: 'screen_missing' });
  });

  it('waits for the plugin when it needs the list and has none', () => {
    expect(choosePlacement({ kind: 'name', name: tv.name }, null)).toEqual({ ok: false, reason: 'waiting_for_screens' });
    expect(choosePlacement({ kind: 'name', name: tv.name }, [])).toEqual({ ok: false, reason: 'waiting_for_screens' });
  });

  it('a fixed position needs no list, and borrows the monitor size when the list knows it', () => {
    expect(choosePlacement({ kind: 'position', x: 2000, y: 40 }, null)).toEqual({
      ok: true,
      x: 2000,
      y: 40,
      width: null,
      height: null,
      screen: null,
    });
    expect(choosePlacement({ kind: 'position', x: 2000, y: 40 }, [main, tv])).toMatchObject({
      width: 1920,
      height: 1080,
      screen: tv.name,
    });
  });

  it('primary uses the monitor flagged primary, or the origin when there is no list', () => {
    expect(choosePlacement({ kind: 'primary' }, [tv, main])).toMatchObject({ ok: true, screen: main.name });
    expect(choosePlacement({ kind: 'primary' }, null)).toMatchObject({
      ok: true,
      x: WINDOW_INSET,
      y: WINDOW_INSET,
      width: null,
    });
  });
});

describe('buildKioskArgs', () => {
  const placement = { ok: true as const, x: 1936, y: 16, width: 1920, height: 1080, screen: 'DISPLAY2' };

  it('builds the TECH-DESIGN §9 command line', () => {
    const args = buildKioskArgs({ url: 'http://127.0.0.1:4460/presenter', profileDir: 'C:/d/kiosk-profile', placement });
    expect(args.slice(0, 5)).toEqual([
      '--app=http://127.0.0.1:4460/presenter',
      '--kiosk',
      '--user-data-dir=C:/d/kiosk-profile',
      '--window-position=1936,16',
      '--window-size=1920,1080',
    ]);
    for (const flag of ['--no-first-run', '--disable-translate', '--autoplay-policy=no-user-gesture-required']) {
      expect(args).toContain(flag);
    }
  });

  it('omits the size when it is unknown', () => {
    const args = buildKioskArgs({ url: 'u', profileDir: 'p', placement: { ...placement, width: null, height: null } });
    expect(args.some((a) => a.startsWith('--window-size'))).toBe(false);
  });

  it('carries no secret of any kind', () => {
    const args = buildKioskArgs({ url: 'http://127.0.0.1:4460/presenter', profileDir: 'p', placement }).join(' ');
    expect(args).not.toMatch(/token|password|secret/i);
  });
});

describe('RestartPolicy', () => {
  it('restarts with growing delays, then suspends (never fights the operator)', () => {
    const p = new RestartPolicy();
    const decisions = [0, 1, 2, 3, 4].map((i) => p.onExit(i * 60_000, { livedMs: 30_000, code: 1 }));
    expect(decisions.map((d) => (d.action === 'restart' ? d.delayMs : d.action))).toEqual([
      2_000,
      5_000,
      15_000,
      30_000,
      'suspend',
    ]);
  });

  it('forgets restarts older than the window', () => {
    const p = new RestartPolicy();
    for (let i = 0; i < 4; i++) p.onExit(i * 1_000, { livedMs: 5_000, code: 1 });
    expect(p.onExit(DEFAULT_RESTART_POLICY.windowMs + 10_000, { livedMs: 5_000, code: 1 })).toEqual({
      action: 'restart',
      delayMs: 2_000,
    });
  });

  it('a clean exit right after the start is a hand-off to a browser already running: not restarted, not counted', () => {
    const p = new RestartPolicy();
    expect(p.onExit(0, { livedMs: 800, code: 0 })).toEqual({ action: 'handoff' });
    expect(p.restarts).toBe(0);
  });

  it('a clean exit after a long life is the operator closing the window: restarted once, then it counts', () => {
    const p = new RestartPolicy();
    expect(p.onExit(0, { livedMs: 600_000, code: 0 })).toEqual({ action: 'restart', delayMs: 2_000 });
    expect(p.restarts).toBe(1);
  });

  it('reset() gives the operator a fresh start', () => {
    const p = new RestartPolicy();
    for (let i = 0; i < 5; i++) p.onExit(i, { livedMs: 5_000, code: 1 });
    p.reset();
    expect(p.onExit(10, { livedMs: 5_000, code: 1 })).toMatchObject({ action: 'restart' });
  });
});
```

`server/test/app/settings-kiosk.test.ts`
```ts
// SPDX-License-Identifier: GPL-2.0-or-later
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { KioskScreen, KioskSettings } from '../../src/kiosk/settings';
import { Settings, SettingsFileInvalidError, SettingsHolder, publicSettings } from '../../src/app/settings';
import { tempDir } from '../support/tmp';

describe('kiosk settings', () => {
  it('an old settings file without a kiosk block gets the safe defaults: off, primary monitor, restart on', () => {
    expect(Settings.parse({ port: 4461 }).kiosk).toEqual({ enabled: false, screen: { kind: 'primary' }, restart: true });
  });

  it('accepts the three screen choices and a browser override', () => {
    const k = KioskSettings.parse({ enabled: true, browserPath: 'C:/chrome.exe', screen: { kind: 'name', name: 'DISPLAY2' }, restart: false });
    expect(k).toEqual({ enabled: true, browserPath: 'C:/chrome.exe', screen: { kind: 'name', name: 'DISPLAY2' }, restart: false });
    expect(KioskScreen.parse({ kind: 'position', x: -1920, y: 0 })).toEqual({ kind: 'position', x: -1920, y: 0 });
  });

  it('rejects unknown screen kinds, fractional positions, empty names and an empty browser path', () => {
    expect(KioskScreen.safeParse({ kind: 'nope' }).success).toBe(false);
    expect(KioskScreen.safeParse({ kind: 'position', x: 1.5, y: 0 }).success).toBe(false);
    expect(KioskScreen.safeParse({ kind: 'name', name: '' }).success).toBe(false);
    expect(KioskSettings.safeParse({ browserPath: '' }).success).toBe(false);
  });
});

describe('publicSettings', () => {
  it('never contains the OBS password, only whether there is one', () => {
    const s = Settings.parse({ obs: { host: '10.0.0.5', port: 4455, password: 'hunter2' } });
    const pub = publicSettings(s);
    expect(pub.obs).toEqual({ host: '10.0.0.5', port: 4455, hasPassword: true });
    expect(JSON.stringify(pub)).not.toContain('hunter2');
    expect(publicSettings(Settings.parse({})).obs).toBeNull();
    expect(publicSettings(Settings.parse({ obs: { port: 4455 } })).obs).toMatchObject({ hasPassword: false });
  });
});

describe('SettingsHolder.setKiosk', () => {
  it('writes only the kiosk block and keeps every other key, the OBS password included', async () => {
    const dir = await tempDir();
    const path = join(dir, 'settings.json');
    await writeFile(path, JSON.stringify({ port: 4470, obs: { host: '127.0.0.1', port: 4455, password: 'hunter2' }, custom: 7 }));
    const holder = new SettingsHolder(path, Settings.parse(JSON.parse(await readFile(path, 'utf8'))));
    const next = await holder.setKiosk(KioskSettings.parse({ enabled: true, screen: { kind: 'name', name: 'DISPLAY2' } }));
    expect(next.kiosk.enabled).toBe(true);
    expect(holder.get().kiosk.screen).toEqual({ kind: 'name', name: 'DISPLAY2' });
    expect(holder.get().obs?.password).toBe('hunter2');
    const onDisk = JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>;
    expect(onDisk).toMatchObject({ port: 4470, custom: 7, obs: { password: 'hunter2' }, kiosk: { enabled: true } });
  });

  it('creates the file when there is none', async () => {
    const path = join(await tempDir(), 'settings.json');
    const holder = new SettingsHolder(path, Settings.parse({}));
    await holder.setKiosk(KioskSettings.parse({ enabled: true }));
    expect(JSON.parse(await readFile(path, 'utf8'))).toEqual({ kiosk: { enabled: true, screen: { kind: 'primary' }, restart: true } });
  });

  it('refuses to overwrite a settings file it cannot parse, and says nothing about its content', async () => {
    const path = join(await tempDir(), 'settings.json');
    await writeFile(path, '{"obs":{"password":hunter2');
    const holder = new SettingsHolder(path, Settings.parse({}));
    const error = await holder.setKiosk(KioskSettings.parse({})).then(
      () => null,
      (err: unknown) => err,
    );
    expect(error).toBeInstanceOf(SettingsFileInvalidError);
    expect((error as Error).message).not.toContain('hunter2');
    expect(await readFile(path, 'utf8')).toBe('{"obs":{"password":hunter2');
  });
});
```


In `server/test/app/basics.test.ts` the two `toEqual({ port: 4460, lanAccess: false })` expectations gain the kiosk defaults, and the data-layout test gains the two new paths:

Changes to `server/test/app/basics.test.ts`:
```diff
--- a/server/test/app/basics.test.ts
+++ b/server/test/app/basics.test.ts
@@ -31,4 +31,6 @@ describe('defaultDataDir', () => {
     expect(p.journal('ep-1')).toBe(join('/r', 'live', 'ep-1.log.jsonl'));
     expect(p.formats).toBe(join('/r', 'formats'));
+    expect(p.screens).toBe(join('/r', 'screens.json'));
+    expect(p.kioskProfile).toBe(join('/r', 'kiosk-profile'));
   });
 
@@ -44,5 +46,5 @@ describe('settings', () => {
   it('defaults to localhost:4460 when the file is missing', async () => {
     const s = await loadSettings(join(await tempDir(), 'settings.json'));
-    expect(s).toEqual({ port: 4460, lanAccess: false });
+    expect(s).toEqual({ port: 4460, lanAccess: false, kiosk: { enabled: false, screen: { kind: 'primary' }, restart: true } });
     expect(listenHost(s)).toBe('127.0.0.1');
   });
@@ -61,5 +63,5 @@ describe('settings', () => {
     const errors: unknown[] = [];
     const s = await loadSettings(join(dir, 'settings.json'), (err) => errors.push(err));
-    expect(s).toEqual({ port: 4460, lanAccess: false });
+    expect(s).toEqual({ port: 4460, lanAccess: false, kiosk: { enabled: false, screen: { kind: 'primary' }, restart: true } });
     expect(errors).toHaveLength(1);
   });
```


- [ ] **Step 2: Run the tests, confirm they fail**

`pnpm vitest run server/test/hotkeys server/test/kiosk server/test/app`. Expected: FAIL (modules missing).

- [ ] **Step 3: Implement**

`server/src/hotkeys/slots.ts`
```ts
// SPDX-License-Identifier: GPL-2.0-or-later
import { z } from 'zod';

/** The fixed OBS hotkey slots (DT-9). Order and ids are a contract with plugin/core/HotkeySlots.cpp. */
export const HOTKEY_SLOT_IDS = [
  'message-1', 'message-2', 'message-3', 'message-4', 'message-5', 'message-6',
  'message-7', 'message-8', 'message-9', 'message-10', 'message-11', 'message-12',
  'clear', 'next', 'prev', 'time-plus', 'time-minus', 'control-toggle',
] as const;
export type HotkeySlotId = (typeof HOTKEY_SLOT_IDS)[number];

/** DT-9: these need a second press of the SAME slot within CONFIRM_WINDOW_MS. */
export const EMERGENCY_SLOTS: ReadonlySet<HotkeySlotId> = new Set<HotkeySlotId>([
  'next', 'prev', 'time-plus', 'time-minus', 'control-toggle',
]);

export const CONFIRM_WINDOW_MS = 1_000;
/** A second press closer than this to the first is key bounce or a duplicate delivery, not a confirmation. */
export const MIN_CONFIRM_GAP_MS = 120;

/** Body of POST /api/internal/hotkey. */
export const HotkeyBody = z.object({
  slot: z.enum(HOTKEY_SLOT_IDS),
  session: z.string().min(1).max(64).optional(),
  seq: z.number().int().nonnegative().optional(),
});
export type HotkeyBody = z.infer<typeof HotkeyBody>;
```

`server/src/hotkeys/hotkey-service.ts`
```ts
// SPDX-License-Identifier: GPL-2.0-or-later
import type { ClientCommand, MessageDismiss } from '@olc/shared';
import type { Clock } from '../clock/clock';
import { CONFIRM_WINDOW_MS, EMERGENCY_SLOTS, MIN_CONFIRM_GAP_MS, type HotkeySlotId } from './slots';

/** What the service needs from the live runtime (LiveRuntime satisfies it). */
export interface HotkeyRuntime {
  getState(): {
    control: 'auto' | 'manual';
    episode: { messages: { text: string; dismiss: MessageDismiss }[]; preset: { adjustStepMs: number } };
  } | null;
  command(command: ClientCommand): boolean;
}

export type HotkeyResult =
  | { result: 'executed'; slot: HotkeySlotId; changed: boolean }
  | { result: 'pending'; slot: HotkeySlotId; remainingMs: number }
  | { result: 'ignored'; slot: HotkeySlotId; reason: 'duplicate' | 'bounce' | 'no_episode' | 'no_preset' };

export interface PressSource {
  /** Random id of one plugin run, with a per-run counter: a repeated (session, seq) is a duplicate delivery. */
  session?: string;
  seq?: number;
}

const MAX_SESSIONS = 8;

export class HotkeyService {
  private pendingSlot: HotkeySlotId | null = null;
  private firstPressAt = 0;
  private readonly lastSeq = new Map<string, number>();

  constructor(private readonly deps: { runtime: HotkeyRuntime; clock: Clock }) {}

  /** The confirmation the dock should announce ("press again to confirm"), or null. */
  pending(): { slot: HotkeySlotId; remainingMs: number } | null {
    if (this.pendingSlot === null) return null;
    const remainingMs = this.firstPressAt + CONFIRM_WINDOW_MS - this.deps.clock.now();
    if (remainingMs < 0) {
      this.pendingSlot = null;
      return null;
    }
    return { slot: this.pendingSlot, remainingMs };
  }

  press(slot: HotkeySlotId, source: PressSource = {}): HotkeyResult {
    if (this.isDuplicate(source)) return { result: 'ignored', slot, reason: 'duplicate' };
    const state = this.deps.runtime.getState();
    if (state === null) {
      this.pendingSlot = null;
      return { result: 'ignored', slot, reason: 'no_episode' };
    }
    if (!EMERGENCY_SLOTS.has(slot)) {
      this.pendingSlot = null; // pressing anything else cancels a pending confirmation
      return this.immediate(slot, state);
    }
    const now = this.deps.clock.now();
    const pending = this.pending();
    if (pending !== null && pending.slot === slot) {
      if (now - this.firstPressAt < MIN_CONFIRM_GAP_MS) return { result: 'ignored', slot, reason: 'bounce' };
      this.pendingSlot = null;
      const changed = this.deps.runtime.command(this.emergencyCommand(slot, state));
      return { result: 'executed', slot, changed };
    }
    this.pendingSlot = slot;
    this.firstPressAt = now;
    return { result: 'pending', slot, remainingMs: CONFIRM_WINDOW_MS };
  }

  private isDuplicate(source: PressSource): boolean {
    if (source.session === undefined || source.seq === undefined) return false;
    const last = this.lastSeq.get(source.session);
    if (last !== undefined && source.seq <= last) return true;
    this.lastSeq.delete(source.session);
    this.lastSeq.set(source.session, source.seq);
    if (this.lastSeq.size > MAX_SESSIONS) {
      const oldest = this.lastSeq.keys().next().value;
      if (oldest !== undefined) this.lastSeq.delete(oldest);
    }
    return false;
  }

  private immediate(slot: HotkeySlotId, state: NonNullable<ReturnType<HotkeyRuntime['getState']>>): HotkeyResult {
    if (slot === 'clear') {
      return { result: 'executed', slot, changed: this.deps.runtime.command({ name: 'clear_message' }) };
    }
    const index = Number(slot.slice('message-'.length)) - 1;
    const preset = state.episode.messages[index];
    if (preset === undefined) return { result: 'ignored', slot, reason: 'no_preset' };
    const changed = this.deps.runtime.command({ name: 'send_message', text: preset.text, dismiss: preset.dismiss });
    return { result: 'executed', slot, changed };
  }

  private emergencyCommand(slot: HotkeySlotId, state: NonNullable<ReturnType<HotkeyRuntime['getState']>>): ClientCommand {
    const step = state.episode.preset.adjustStepMs;
    switch (slot) {
      case 'next':
        return { name: 'next' };
      case 'prev':
        return { name: 'prev' };
      case 'time-plus':
        return { name: 'adjust', deltaMs: step };
      case 'time-minus':
        return { name: 'adjust', deltaMs: -step };
      default:
        return { name: 'set_control', control: state.control === 'auto' ? 'manual' : 'auto' };
    }
  }
}
```

`server/src/kiosk/settings.ts`
```ts
// SPDX-License-Identifier: GPL-2.0-or-later
import { z } from 'zod';

/** Which monitor the presenter window goes to. `primary` is the default; `name` needs the plugin's screen list. */
export const KioskScreen = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('primary') }),
  z.object({ kind: z.literal('name'), name: z.string().min(1).max(200) }),
  z.object({ kind: z.literal('position'), x: z.number().int(), y: z.number().int() }),
]);
export type KioskScreen = z.infer<typeof KioskScreen>;

/** settings.json "kiosk" block (TECH-DESIGN §9). Off by default: opening a window must be the operator's choice. */
export const KioskSettings = z.object({
  enabled: z.boolean().default(false),
  /** Overrides browser detection. A path that does not exist is an error, never silently replaced. */
  browserPath: z.string().min(1).max(500).optional(),
  screen: KioskScreen.default({ kind: 'primary' }),
  /** Reopen the window when it closes or crashes (with limits: see RestartPolicy). */
  restart: z.boolean().default(true),
});
export type KioskSettings = z.infer<typeof KioskSettings>;
```

`server/src/kiosk/screens.ts`
```ts
// SPDX-License-Identifier: GPL-2.0-or-later
import { z } from 'zod';

/** One monitor as the OBS plugin reports it (Qt QScreen). Mirrors plugin/core/ScreenInfo.hpp. */
export const ScreenInfo = z.object({
  name: z.string().min(1).max(200),
  x: z.number().int(),
  y: z.number().int(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  devicePixelRatio: z.number().positive().max(10).default(1),
  primary: z.boolean(),
});
export type ScreenInfo = z.infer<typeof ScreenInfo>;

/** Body of POST /api/internal/screens. */
export const ScreensBody = z.object({ screens: z.array(ScreenInfo).max(16) });
export type ScreensBody = z.infer<typeof ScreensBody>;

export interface ScreenStore {
  load(): Promise<ScreenInfo[]>;
  save(screens: ScreenInfo[]): Promise<void>;
}

export interface ScreenSnapshot {
  screens: ScreenInfo[];
  /** true = reported by the plugin since this app started; false = the list remembered from an earlier run. */
  live: boolean;
}

const same = (a: ScreenInfo[], b: ScreenInfo[]): boolean => JSON.stringify(a) === JSON.stringify(b);

/** The monitor list the plugin reports, kept in memory and remembered on disk for the next start. */
export class ScreenRegistry {
  private screens: ScreenInfo[] = [];
  private live = false;
  private readonly listeners = new Set<() => void>();

  constructor(
    private readonly store: ScreenStore,
    private readonly report: (err: unknown) => void = () => {},
  ) {}

  /** Loads the remembered list (marked not live). A missing or unreadable file means an empty list. */
  async init(): Promise<void> {
    try {
      this.screens = await this.store.load();
    } catch (err) {
      this.report(err);
      this.screens = [];
    }
  }

  get(): ScreenSnapshot {
    return { screens: this.screens.map((s) => ({ ...s })), live: this.live };
  }

  /** The plugin's list. Listeners hear about it only when it differs from what they already know. */
  set(screens: ScreenInfo[]): void {
    const changed = !this.live || !same(this.screens, screens);
    this.live = true;
    if (!changed) return;
    const listChanged = !same(this.screens, screens);
    this.screens = screens.map((s) => ({ ...s }));
    if (listChanged) this.store.save(this.screens).catch((err: unknown) => this.report(err));
    for (const listener of this.listeners) listener();
  }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}
```

`server/src/kiosk/placement.ts`
```ts
// SPDX-License-Identifier: GPL-2.0-or-later

import type { KioskScreen } from './settings';
import type { ScreenInfo } from './screens';

export type Placement =
  | { ok: true; x: number; y: number; width: number | null; height: number | null; screen: string | null }
  | { ok: false; reason: 'waiting_for_screens' | 'screen_missing' };

/** The window starts this far inside the monitor, so rounding or DPI scaling cannot push it onto a neighbour. */
export const WINDOW_INSET = 16;

function inside(screen: ScreenInfo): Placement {
  return {
    ok: true,
    x: screen.x + WINDOW_INSET,
    y: screen.y + WINDOW_INSET,
    width: screen.width,
    height: screen.height,
    screen: screen.name,
  };
}

/**
 * Where to open the kiosk. The rule that matters on air: a screen the operator named is never replaced by another
 * one. If it is not in the list the answer is "screen_missing" (the caller shows a warning and does not launch),
 * because opening the presenter on the director's own monitor would cover the multiview.
 */
export function choosePlacement(setting: KioskScreen, screens: readonly ScreenInfo[] | null): Placement {
  const list = screens ?? [];
  switch (setting.kind) {
    case 'position': {
      const hit = list.find(
        (s) => setting.x >= s.x && setting.x < s.x + s.width && setting.y >= s.y && setting.y < s.y + s.height,
      );
      return {
        ok: true,
        x: setting.x,
        y: setting.y,
        width: hit?.width ?? null,
        height: hit?.height ?? null,
        screen: hit?.name ?? null,
      };
    }
    case 'name': {
      if (list.length === 0) return { ok: false, reason: 'waiting_for_screens' };
      const hit = list.find((s) => s.name === setting.name);
      return hit === undefined ? { ok: false, reason: 'screen_missing' } : inside(hit);
    }
    case 'primary': {
      const hit = list.find((s) => s.primary);
      if (hit !== undefined) return inside(hit);
      // No list (no plugin): the primary monitor's origin is (0,0) on Windows and macOS.
      return { ok: true, x: WINDOW_INSET, y: WINDOW_INSET, width: null, height: null, screen: null };
    }
  }
}

export interface KioskArgsInput {
  url: string;
  profileDir: string;
  placement: Extract<Placement, { ok: true }>;
}

/** TECH-DESIGN §9 plus the flags that keep a crashed kiosk from opening a dialog nobody can click. */
export function buildKioskArgs({ url, profileDir, placement }: KioskArgsInput): string[] {
  const args = [
    `--app=${url}`,
    '--kiosk',
    `--user-data-dir=${profileDir}`,
    `--window-position=${placement.x},${placement.y}`,
  ];
  if (placement.width !== null && placement.height !== null) {
    args.push(`--window-size=${placement.width},${placement.height}`);
  }
  args.push(
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-translate',
    '--noerrdialogs',
    '--disable-session-crashed-bubble',
    '--autoplay-policy=no-user-gesture-required',
  );
  return args;
}
```

`server/src/kiosk/restart-policy.ts`
```ts
// SPDX-License-Identifier: GPL-2.0-or-later

export interface RestartPolicyConfig {
  /** Sliding window in which restarts are counted. */
  windowMs: number;
  /** Delay before restart number 1, 2, 3, ... inside the window. */
  delaysMs: number[];
  /** A clean exit this soon after the start means Chrome handed the window to an instance already running. */
  handoffMs: number;
}

export const DEFAULT_RESTART_POLICY: RestartPolicyConfig = {
  windowMs: 10 * 60_000,
  delaysMs: [2_000, 5_000, 15_000, 30_000],
  handoffMs: 3_000,
};

export type ExitDecision =
  | { action: 'restart'; delayMs: number }
  /** The browser we started is not the process that shows the window: do not restart, do not count. */
  | { action: 'handoff' }
  /** Too many restarts in the window: stop and let the operator decide (never fight the operator). */
  | { action: 'suspend'; restarts: number };

/**
 * When the kiosk browser exits, decide whether to open it again. At most `delaysMs.length` restarts per sliding
 * window, with growing delays; one more and we stop, because a window the operator keeps closing, or a browser
 * that keeps crashing, must not be reopened in a loop in front of a live show.
 */
export class RestartPolicy {
  private readonly restartTimes: number[] = [];

  constructor(private readonly config: RestartPolicyConfig = DEFAULT_RESTART_POLICY) {}

  onExit(now: number, info: { livedMs: number; code: number | null }): ExitDecision {
    if (info.code === 0 && info.livedMs < this.config.handoffMs) return { action: 'handoff' };
    while (this.restartTimes.length > 0 && now - this.restartTimes[0]! > this.config.windowMs) this.restartTimes.shift();
    const index = this.restartTimes.length;
    if (index >= this.config.delaysMs.length) return { action: 'suspend', restarts: index };
    this.restartTimes.push(now);
    return { action: 'restart', delayMs: this.config.delaysMs[index]! };
  }

  /** Operator pressed Start/Restart: a fresh start. */
  reset(): void {
    this.restartTimes.length = 0;
  }

  get restarts(): number {
    return this.restartTimes.length;
  }
}
```

Changes to `server/src/app/paths.ts`:
```diff
--- a/server/src/app/paths.ts
+++ b/server/src/app/paths.ts
@@ -34,4 +34,8 @@ export interface DataPaths {
   lock: string;
   runtime: string;
+  /** Last monitor list the OBS plugin reported (kiosk placement after a restart). */
+  screens: string;
+  /** Chromium user-data-dir of the kiosk browser: its own profile, never the operator's. */
+  kioskProfile: string;
 }
 
@@ -48,4 +52,6 @@ export function dataPaths(root: string): DataPaths {
     lock: join(root, 'instance.lock'),
     runtime: join(root, 'runtime.json'),
+    screens: join(root, 'screens.json'),
+    kioskProfile: join(root, 'kiosk-profile'),
   };
 }
```

Changes to `server/src/app/settings.ts`:
```diff
--- a/server/src/app/settings.ts
+++ b/server/src/app/settings.ts
@@ -1,5 +1,7 @@
 // SPDX-License-Identifier: GPL-2.0-or-later
+import { readFile } from 'node:fs/promises';
 import { z } from 'zod';
-import { readJson } from '../persistence/json-file';
+import { KioskSettings } from '../kiosk/settings';
+import { isNotFound, readJson, writeJsonAtomic } from '../persistence/json-file';
 
 /** DT-5 remote mode: credentials used when no plugin hands them over at runtime. */
@@ -14,7 +16,64 @@ export const Settings = z.object({
   lanAccess: z.boolean().default(false),
   obs: ObsSettings.optional(),
+  kiosk: KioskSettings.default(() => KioskSettings.parse({})),
 });
 export type Settings = z.infer<typeof Settings>;
 
+/** What GET /api/settings returns. The OBS password is never part of it: only whether one is set. */
+export interface PublicSettings {
+  port: number;
+  lanAccess: boolean;
+  obs: { host: string; port: number; hasPassword: boolean } | null;
+  kiosk: KioskSettings;
+}
+
+export function publicSettings(settings: Settings): PublicSettings {
+  return {
+    port: settings.port,
+    lanAccess: settings.lanAccess,
+    obs: settings.obs === undefined ? null : { host: settings.obs.host, port: settings.obs.port, hasPassword: settings.obs.password !== undefined },
+    kiosk: settings.kiosk,
+  };
+}
+
+export class SettingsFileInvalidError extends Error {
+  constructor() {
+    super('settings.json is not a valid JSON object; fix or delete it before changing settings from the app');
+    this.name = 'SettingsFileInvalidError';
+  }
+}
+
+/**
+ * The settings the running app uses, and the one write path (kiosk only: port and LAN access need a restart and are
+ * edited in the file). The write keeps every other key of settings.json exactly as it is, the OBS password included,
+ * and refuses to overwrite a file it cannot parse.
+ */
+export class SettingsHolder {
+  constructor(
+    private readonly path: string,
+    private current: Settings,
+  ) {}
+
+  get(): Settings {
+    return this.current;
+  }
+
+  async setKiosk(kiosk: KioskSettings): Promise<Settings> {
+    let raw: Record<string, unknown> = {};
+    try {
+      const parsed: unknown = JSON.parse(await readFile(this.path, 'utf8'));
+      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new SettingsFileInvalidError();
+      raw = parsed as Record<string, unknown>;
+    } catch (err) {
+      if (err instanceof SettingsFileInvalidError) throw err;
+      if (!isNotFound(err)) throw new SettingsFileInvalidError();
+    }
+    raw.kiosk = kiosk;
+    await writeJsonAtomic(this.path, raw);
+    this.current = { ...this.current, kiosk };
+    return this.current;
+  }
+}
+
 export async function loadSettings(path: string, onInvalid?: (err: unknown) => void): Promise<Settings> {
   try {
```


- [ ] **Step 4: Run the tests and the typecheck**

`pnpm vitest run server/test/hotkeys server/test/kiosk server/test/app && pnpm typecheck`. Expected: PASS. (`server.ts` still compiles: the new `Settings.kiosk` has a default.)

- [ ] **Step 5: Commit**

```
git add server/src/hotkeys server/src/kiosk server/src/app/paths.ts server/src/app/settings.ts server/test/hotkeys server/test/kiosk server/test/app
git commit -m "feat(server): hotkey slots with double-press confirmation, kiosk settings, screen registry, placement, restart policy"
```

---

### Task 3: Core — data paths, plugin settings, screen list

**Files:**
- Create: `plugin/core/Paths.hpp`, `plugin/core/Paths.cpp`, `plugin/core/PluginSettings.hpp`, `plugin/core/PluginSettings.cpp`, `plugin/core/ScreenInfo.hpp`, `plugin/core/ScreenInfo.cpp`, `plugin/tests/test_paths.cpp`, `plugin/tests/test_plugin_settings.cpp`

**Interfaces:**
- Produces: `olc::Platform`, `EnvVars`, `defaultDataDir(Platform, EnvVars)` (mirror of `server/src/app/paths.ts`), `DataPaths dataPaths(root)` (`settings.json`, `runtime.json`, `secret.token`, `launch.json`), `RuntimeInfo`, `parseRuntimeJson`, `parseSettingsPort`, `resolvePort` (runtime.json, then settings.json, then 4460), `kDefaultPort`; `PluginSettings` (`mode` local/remote, `remoteUrl`, `appCommand`, `autoStart`), `parsePluginSettings`, `serializePluginSettings`, `normalizeRemoteUrl`, `apiBaseUrl`, `dockUrl`, `LaunchSpec`, `parseLaunchJson`, `resolveLaunch`; `ScreenInfo`, `screensToJson`.
- **`launch.json` is the contract with the installer (Plan 7):** `{"command": "<path of the app executable>", "args": [...], "cwd": "<folder>"}` in the app's data folder. The plugin setting `appCommand` overrides it. During development write it by hand (README, Task 18).

Rules: a remote URL must be `http(s)://host[:port][/prefix]` with no credentials, query or fragment; a mode `remote` with an invalid URL stays remote with an empty URL (nothing is shown or called; it never silently becomes local).

- [ ] **Step 1: Write the failing tests**

`plugin/tests/test_paths.cpp`
```cpp
// SPDX-License-Identifier: GPL-2.0-or-later
#include "doctest/doctest.h"

#include "Paths.hpp"

using namespace olc;

TEST_CASE("defaultDataDir mirrors server/src/app/paths.ts") {
    EnvVars env;
    env.home = "/home/ann";
    SUBCASE("OLC_DATA_DIR wins everywhere") {
        env.olcDataDir = "/data/olc";
        CHECK(defaultDataDir(Platform::Windows, env) == "/data/olc");
        CHECK(defaultDataDir(Platform::MacOS, env) == "/data/olc");
        CHECK(defaultDataDir(Platform::Linux, env) == "/data/olc");
    }
    SUBCASE("Windows uses APPDATA, else <home>/AppData/Roaming") {
        env.appData = "C:\\Users\\ann\\AppData\\Roaming";
        CHECK(defaultDataDir(Platform::Windows, env) == "C:\\Users\\ann\\AppData\\Roaming/obs-live-clock");
        env.appData.clear();
        env.home = "C:/Users/ann";
        CHECK(defaultDataDir(Platform::Windows, env) == "C:/Users/ann/AppData/Roaming/obs-live-clock");
    }
    SUBCASE("macOS uses Application Support") {
        CHECK(defaultDataDir(Platform::MacOS, env) == "/home/ann/Library/Application Support/obs-live-clock");
    }
    SUBCASE("Linux uses XDG_CONFIG_HOME, else ~/.config") {
        CHECK(defaultDataDir(Platform::Linux, env) == "/home/ann/.config/obs-live-clock");
        env.xdgConfigHome = "/xdg";
        CHECK(defaultDataDir(Platform::Linux, env) == "/xdg/obs-live-clock");
    }
}

TEST_CASE("dataPaths names the four files the plugin reads") {
    const auto p = dataPaths("/d");
    CHECK(p.settings == "/d/settings.json");
    CHECK(p.runtime == "/d/runtime.json");
    CHECK(p.secret == "/d/secret.token");
    CHECK(p.launch == "/d/launch.json");
}

TEST_CASE("runtime.json: the port is required and validated, the rest is optional") {
    const auto ok = parseRuntimeJson(R"({"port":4461,"pid":99,"instanceId":"abc"})");
    REQUIRE(ok.has_value());
    CHECK(ok->port == 4461);
    CHECK(ok->instanceId == "abc");
    CHECK(parseRuntimeJson(R"({"port":4461})")->instanceId.empty());
    CHECK_FALSE(parseRuntimeJson(R"({"pid":1})").has_value());
    CHECK_FALSE(parseRuntimeJson(R"({"port":0})").has_value());
    CHECK_FALSE(parseRuntimeJson(R"({"port":70000})").has_value());
    CHECK_FALSE(parseRuntimeJson(R"({"port":"4461"})").has_value());
    CHECK_FALSE(parseRuntimeJson("not json").has_value());
    CHECK_FALSE(parseRuntimeJson("").has_value());
}

TEST_CASE("resolvePort: runtime.json, then settings.json, then 4460") {
    CHECK(resolvePort(RuntimeInfo{4461, "x"}, 4470) == 4461);
    CHECK(resolvePort(std::nullopt, 4470) == 4470);
    CHECK(resolvePort(std::nullopt, std::nullopt) == 4460);
    CHECK(parseSettingsPort(R"({"port":4470,"lanAccess":false})") == 4470);
    CHECK_FALSE(parseSettingsPort(R"({"lanAccess":false})").has_value());
}
```

`plugin/tests/test_plugin_settings.cpp`
```cpp
// SPDX-License-Identifier: GPL-2.0-or-later
#include "doctest/doctest.h"

#include <nlohmann/json.hpp>

#include "PluginSettings.hpp"
#include "ScreenInfo.hpp"

using namespace olc;

TEST_CASE("normalizeRemoteUrl accepts http(s) host[:port][/prefix] and strips trailing slashes") {
    CHECK(normalizeRemoteUrl("http://studio-pc:4460") == "http://studio-pc:4460");
    CHECK(normalizeRemoteUrl("  https://clock.example.org/  ") == "https://clock.example.org");
    CHECK(normalizeRemoteUrl("http://192.168.1.20:4460//") == "http://192.168.1.20:4460");
    CHECK(normalizeRemoteUrl("https://example.org/olc") == "https://example.org/olc");
    CHECK(normalizeRemoteUrl("http://[::1]:4460") == "http://[::1]:4460");
}

TEST_CASE("normalizeRemoteUrl rejects anything that could surprise") {
    for (const char* bad : {"", "studio-pc:4460", "ftp://x", "http://", "http:///dock", "http://user:pw@host", "http://host:99999",
                            "http://host:abc", "http://host:", "http://host/a b", "http://host?x=1", "http://host#frag",
                            "http://:4460", "javascript:alert(1)"}) {
        CHECK_MESSAGE(!normalizeRemoteUrl(bad).has_value(), bad);
    }
}

TEST_CASE("settings round-trip and tolerate garbage") {
    PluginSettings s;
    s.mode = ServerMode::Remote;
    s.remoteUrl = "http://studio-pc:4460";
    s.appCommand = "D:/olc/obs-live-clock.exe";
    s.autoStart = false;
    CHECK(parsePluginSettings(serializePluginSettings(s)) == s);

    CHECK(parsePluginSettings("") == PluginSettings{});
    CHECK(parsePluginSettings("[1]") == PluginSettings{});
    const auto odd = parsePluginSettings(R"({"mode":7,"remoteUrl":5,"appCommand":false,"autoStart":"no"})");
    CHECK(odd == PluginSettings{});
}

TEST_CASE("an invalid remote URL is dropped but Remote mode stays: it never silently becomes local") {
    const auto s = parsePluginSettings(R"({"mode":"remote","remoteUrl":"not a url"})");
    CHECK(s.isRemote());
    CHECK(s.remoteUrl.empty());
    CHECK(dockUrl(s, 4460).empty());
    CHECK(apiBaseUrl(s, 4460).empty());
}

TEST_CASE("dockUrl points at the local port or the remote URL") {
    PluginSettings local;
    CHECK(dockUrl(local, 4461) == "http://127.0.0.1:4461/dock");
    CHECK(apiBaseUrl(local, 4461) == "http://127.0.0.1:4461");
    PluginSettings remote;
    remote.mode = ServerMode::Remote;
    remote.remoteUrl = "https://clock.example.org";
    CHECK(dockUrl(remote, 4461) == "https://clock.example.org/dock");
}

TEST_CASE("launch.json: command required, args and cwd optional, the settings command wins") {
    const auto spec = parseLaunchJson(R"({"command":" C:/olc/app.exe ","args":["--a",5,"--b"],"cwd":"C:/olc"})");
    REQUIRE(spec.has_value());
    CHECK(spec->command == "C:/olc/app.exe");
    CHECK(spec->args == std::vector<std::string>{"--a", "--b"});
    CHECK(spec->workingDir == "C:/olc");
    CHECK_FALSE(parseLaunchJson(R"({"args":[]})").has_value());
    CHECK_FALSE(parseLaunchJson(R"({"command":"  "})").has_value());
    CHECK_FALSE(parseLaunchJson("nope").has_value());

    PluginSettings s;
    CHECK(resolveLaunch(s, spec)->command == "C:/olc/app.exe");
    s.appCommand = "D:/mine.exe";
    CHECK(resolveLaunch(s, spec)->command == "D:/mine.exe");
    CHECK(resolveLaunch(s, spec)->args.empty());
    CHECK_FALSE(resolveLaunch(PluginSettings{}, std::nullopt).has_value());
}

TEST_CASE("screensToJson is the body the app's /api/internal/screens expects") {
    const auto body = nlohmann::json::parse(
        screensToJson({ScreenInfo{"\\\\.\\DISPLAY1", 0, 0, 1920, 1080, 1.25, true}, ScreenInfo{"\\\\.\\DISPLAY2", 1920, -100, 2560, 1440, 1.0, false}}));
    REQUIRE(body["screens"].size() == 2);
    CHECK(body["screens"][0]["name"] == "\\\\.\\DISPLAY1");
    CHECK(body["screens"][0]["primary"] == true);
    CHECK(body["screens"][0]["devicePixelRatio"] == 1.25);
    CHECK(body["screens"][1]["x"] == 1920);
    CHECK(body["screens"][1]["y"] == -100);
    CHECK(body["screens"][1]["width"] == 2560);
}
```


- [ ] **Step 2: Run, confirm failure**

`bash plugin/scripts/verify.sh` -> `FAIL cpp` (headers missing).

- [ ] **Step 3: Implement**

`plugin/core/Paths.hpp`
```cpp
// SPDX-License-Identifier: GPL-2.0-or-later
#pragma once
#include <optional>
#include <string>
#include <string_view>

namespace olc {

enum class Platform { Windows, MacOS, Linux };
Platform currentPlatform();

/** The environment variables that decide where the app keeps its data. Empty = not set. */
struct EnvVars {
    std::string olcDataDir;     // OLC_DATA_DIR
    std::string appData;        // APPDATA (Windows)
    std::string xdgConfigHome;  // XDG_CONFIG_HOME (Linux)
    std::string home;           // user home directory
};

/** Mirror of server/src/app/paths.ts defaultDataDir(); a contract test pins both to the same vectors. */
std::string defaultDataDir(Platform platform, const EnvVars& env);

struct DataPaths {
    std::string root;
    std::string settings;  // settings.json (port)
    std::string runtime;   // runtime.json  (port, pid, instanceId; written once the app listens)
    std::string secret;    // secret.token  (bearer for /api/internal/*)
    std::string launch;    // launch.json   (written by the installer: how to start the app)
};
DataPaths dataPaths(const std::string& root);

inline constexpr int kDefaultPort = 4460;

struct RuntimeInfo {
    int port = 0;
    std::string instanceId;
};
/** runtime.json is a hint, never the truth: the port must be 1..65535, the rest may be missing. */
std::optional<RuntimeInfo> parseRuntimeJson(std::string_view jsonText);
std::optional<int> parseSettingsPort(std::string_view jsonText);
/** runtime.json port, else settings.json port, else 4460. */
int resolvePort(const std::optional<RuntimeInfo>& runtime, std::optional<int> settingsPort);

} // namespace olc
```

`plugin/core/Paths.cpp`
```cpp
// SPDX-License-Identifier: GPL-2.0-or-later
#include "Paths.hpp"

#include <nlohmann/json.hpp>

namespace olc {

Platform currentPlatform() {
#if defined(_WIN32)
    return Platform::Windows;
#elif defined(__APPLE__)
    return Platform::MacOS;
#else
    return Platform::Linux;
#endif
}

std::string defaultDataDir(Platform platform, const EnvVars& env) {
    const std::string app = "obs-live-clock";
    if (!env.olcDataDir.empty()) return env.olcDataDir;
    switch (platform) {
    case Platform::Windows:
        return (env.appData.empty() ? env.home + "/AppData/Roaming" : env.appData) + "/" + app;
    case Platform::MacOS:
        return env.home + "/Library/Application Support/" + app;
    case Platform::Linux:
        return (env.xdgConfigHome.empty() ? env.home + "/.config" : env.xdgConfigHome) + "/" + app;
    }
    return env.home + "/" + app;
}

DataPaths dataPaths(const std::string& root) {
    return {root, root + "/settings.json", root + "/runtime.json", root + "/secret.token", root + "/launch.json"};
}

namespace {
std::optional<int> portOf(const nlohmann::json& doc) {
    if (!doc.is_object()) return std::nullopt;
    const auto it = doc.find("port");
    if (it == doc.end() || !it->is_number_integer()) return std::nullopt;
    const auto port = it->get<long long>();
    if (port < 1 || port > 65535) return std::nullopt;
    return static_cast<int>(port);
}
}  // namespace

std::optional<RuntimeInfo> parseRuntimeJson(std::string_view jsonText) {
    const auto doc = nlohmann::json::parse(jsonText.begin(), jsonText.end(), nullptr, false);
    const auto port = portOf(doc);
    if (!port) return std::nullopt;
    RuntimeInfo info;
    info.port = *port;
    if (const auto it = doc.find("instanceId"); it != doc.end() && it->is_string()) info.instanceId = it->get<std::string>();
    return info;
}

std::optional<int> parseSettingsPort(std::string_view jsonText) {
    return portOf(nlohmann::json::parse(jsonText.begin(), jsonText.end(), nullptr, false));
}

int resolvePort(const std::optional<RuntimeInfo>& runtime, std::optional<int> settingsPort) {
    if (runtime) return runtime->port;
    if (settingsPort) return *settingsPort;
    return kDefaultPort;
}

}  // namespace olc
```

`plugin/core/PluginSettings.hpp`
```cpp
// SPDX-License-Identifier: GPL-2.0-or-later
#pragma once
#include <optional>
#include <string>
#include <string_view>
#include <vector>

namespace olc {

enum class ServerMode { Local, Remote };

/** What the operator can set in OBS (Tools > OBS Live Clock). Stored as JSON in the plugin's OBS config folder. */
struct PluginSettings {
    ServerMode mode = ServerMode::Local;
    std::string remoteUrl;   // normalised; only meaningful when mode == Remote
    std::string appCommand;  // optional path of the app executable; empty = use launch.json
    bool autoStart = true;   // launch the app when OBS finishes loading and it does not answer

    bool operator==(const PluginSettings& o) const {
        return mode == o.mode && remoteUrl == o.remoteUrl && appCommand == o.appCommand && autoStart == o.autoStart;
    }
    bool operator!=(const PluginSettings& o) const { return !(*this == o); }
    /** Remote never falls back to local: with an invalid URL there is simply nothing to show or call. */
    bool isRemote() const { return mode == ServerMode::Remote; }
};

/** http(s)://host[:port][/prefix], no credentials, query or fragment; trailing slashes removed. */
std::optional<std::string> normalizeRemoteUrl(std::string_view text);

/** Tolerant: unreadable text gives the defaults; an invalid remote URL is dropped (mode stays Remote, URL empty). */
PluginSettings parsePluginSettings(std::string_view jsonText);
std::string serializePluginSettings(const PluginSettings& settings);

/** Base URL of the app's API: http://127.0.0.1:<port> locally, the remote URL otherwise ("" if the remote URL is invalid). */
std::string apiBaseUrl(const PluginSettings& settings, int localPort);
/** apiBaseUrl + "/dock"; "" when there is nothing valid to show. */
std::string dockUrl(const PluginSettings& settings, int localPort);

struct LaunchSpec {
    std::string command;
    std::vector<std::string> args;
    std::string workingDir;
};
/** launch.json: {"command":"C:/.../obs-live-clock.exe","args":["--x"],"cwd":"C:/..."} (written by the installer, Plan 7). */
std::optional<LaunchSpec> parseLaunchJson(std::string_view jsonText);
/** The settings' appCommand wins; else launch.json; else nullopt. */
std::optional<LaunchSpec> resolveLaunch(const PluginSettings& settings, const std::optional<LaunchSpec>& fromFile);

} // namespace olc
```

`plugin/core/PluginSettings.cpp`
```cpp
// SPDX-License-Identifier: GPL-2.0-or-later
#include "PluginSettings.hpp"

#include <algorithm>
#include <cctype>
#include <nlohmann/json.hpp>

namespace olc {

namespace {
std::string trim(std::string s) {
    const auto notSpace = [](unsigned char c) { return !std::isspace(c); };
    s.erase(s.begin(), std::find_if(s.begin(), s.end(), notSpace));
    s.erase(std::find_if(s.rbegin(), s.rend(), notSpace).base(), s.end());
    return s;
}
}  // namespace

std::optional<std::string> normalizeRemoteUrl(std::string_view text) {
    std::string url = trim(std::string(text));
    std::string rest;
    if (url.rfind("http://", 0) == 0) rest = url.substr(7);
    else if (url.rfind("https://", 0) == 0) rest = url.substr(8);
    else return std::nullopt;
    if (rest.find_first_of("?# \t\r\n") != std::string::npos) return std::nullopt;
    const auto slash = rest.find('/');
    const std::string authority = rest.substr(0, slash);
    if (authority.empty() || authority.find('@') != std::string::npos) return std::nullopt;
    // host[:port] with a numeric port, or [ipv6][:port]
    const auto colon = authority.rfind(':');
    const bool bracketed = authority.front() == '[';
    if (colon != std::string::npos && (!bracketed || authority.find(']') < colon)) {
        const std::string port = authority.substr(colon + 1);
        if (port.empty() || !std::all_of(port.begin(), port.end(), [](unsigned char c) { return std::isdigit(c); })) return std::nullopt;
        if (std::stoi(port) < 1 || std::stoi(port) > 65535) return std::nullopt;
        if (colon == 0) return std::nullopt;
    }
    while (!url.empty() && url.back() == '/') url.pop_back();
    return url;
}

PluginSettings parsePluginSettings(std::string_view jsonText) {
    PluginSettings s;
    const auto doc = nlohmann::json::parse(jsonText.begin(), jsonText.end(), nullptr, false);
    if (!doc.is_object()) return s;
    if (const auto it = doc.find("mode"); it != doc.end() && it->is_string()) {
        if (it->get<std::string>() == "remote") s.mode = ServerMode::Remote;
    }
    if (const auto it = doc.find("remoteUrl"); it != doc.end() && it->is_string()) {
        if (const auto url = normalizeRemoteUrl(it->get<std::string>())) s.remoteUrl = *url;
    }
    if (const auto it = doc.find("appCommand"); it != doc.end() && it->is_string()) s.appCommand = trim(it->get<std::string>());
    if (const auto it = doc.find("autoStart"); it != doc.end() && it->is_boolean()) s.autoStart = it->get<bool>();
    return s;
}

std::string serializePluginSettings(const PluginSettings& s) {
    const nlohmann::json doc = {{"mode", s.mode == ServerMode::Remote ? "remote" : "local"},
                                {"remoteUrl", s.remoteUrl},
                                {"appCommand", s.appCommand},
                                {"autoStart", s.autoStart}};
    return doc.dump(2);
}

std::string apiBaseUrl(const PluginSettings& settings, int localPort) {
    if (settings.isRemote()) return settings.remoteUrl;
    return "http://127.0.0.1:" + std::to_string(localPort);
}

std::string dockUrl(const PluginSettings& settings, int localPort) {
    const std::string base = apiBaseUrl(settings, localPort);
    return base.empty() ? std::string() : base + "/dock";
}

std::optional<LaunchSpec> parseLaunchJson(std::string_view jsonText) {
    const auto doc = nlohmann::json::parse(jsonText.begin(), jsonText.end(), nullptr, false);
    if (!doc.is_object()) return std::nullopt;
    const auto command = doc.find("command");
    if (command == doc.end() || !command->is_string() || trim(command->get<std::string>()).empty()) return std::nullopt;
    LaunchSpec spec;
    spec.command = trim(command->get<std::string>());
    if (const auto it = doc.find("args"); it != doc.end() && it->is_array()) {
        for (const auto& arg : *it)
            if (arg.is_string()) spec.args.push_back(arg.get<std::string>());
    }
    if (const auto it = doc.find("cwd"); it != doc.end() && it->is_string()) spec.workingDir = it->get<std::string>();
    return spec;
}

std::optional<LaunchSpec> resolveLaunch(const PluginSettings& settings, const std::optional<LaunchSpec>& fromFile) {
    if (!settings.appCommand.empty()) {
        LaunchSpec spec;
        spec.command = settings.appCommand;
        return spec;
    }
    return fromFile;
}

}  // namespace olc
```

`plugin/core/ScreenInfo.hpp`
```cpp
// SPDX-License-Identifier: GPL-2.0-or-later
#pragma once
#include <string>
#include <vector>

namespace olc {

/** One monitor as Qt reports it (QScreen). Sent to the app so the kiosk can open on the right one. */
struct ScreenInfo {
    std::string name;  // QScreen::name(), e.g. "\\\\.\\DISPLAY2"
    int x = 0;
    int y = 0;
    int width = 0;
    int height = 0;
    double devicePixelRatio = 1.0;
    bool primary = false;

    bool operator==(const ScreenInfo& o) const {
        return name == o.name && x == o.x && y == o.y && width == o.width && height == o.height &&
               devicePixelRatio == o.devicePixelRatio && primary == o.primary;
    }
};

/** Body of POST /api/internal/screens: {"screens":[{"name","x","y","width","height","devicePixelRatio","primary"}]}. */
std::string screensToJson(const std::vector<ScreenInfo>& screens);

} // namespace olc
```

`plugin/core/ScreenInfo.cpp`
```cpp
// SPDX-License-Identifier: GPL-2.0-or-later
#include "ScreenInfo.hpp"

#include <nlohmann/json.hpp>

namespace olc {

std::string screensToJson(const std::vector<ScreenInfo>& screens) {
    nlohmann::json list = nlohmann::json::array();
    for (const auto& s : screens) {
        list.push_back({{"name", s.name},
                        {"x", s.x},
                        {"y", s.y},
                        {"width", s.width},
                        {"height", s.height},
                        {"devicePixelRatio", s.devicePixelRatio},
                        {"primary", s.primary}});
    }
    return nlohmann::json{{"screens", list}}.dump();
}

}  // namespace olc
```


- [ ] **Step 4: Run, confirm pass**

`bash plugin/scripts/verify.sh` -> `PASS`.

- [ ] **Step 5: Commit**

```
git add plugin/core plugin/tests
git commit -m "feat(plugin): data paths, runtime.json and launch.json parsing, plugin settings, screen list"
```

---

### Task 4: Core — launch policy (AppLauncher state machine)

**Files:**
- Create: `plugin/core/LaunchPolicy.hpp`, `plugin/core/LaunchPolicy.cpp`, `plugin/tests/test_launch_policy.cpp`

**Interfaces:**
- Produces: `HealthObservation {Ok, Incompatible, Unreachable}`, `LaunchPhase {Checking, Launching, Running, Incompatible, Unavailable, Failed}`, `LaunchPolicyConfig`, `PolicyDecision {launch, nextCheckInMs, phase}`, `LaunchPolicy::onHealth(nowMs, observed)`, `setAllowLaunch`, `reset`, `launches()`.

Rules (TECH-DESIGN §3: "retry with backoff up to 10 s"): a first unreachable probe launches once and re-checks after 250, 500, 1000, 1500, then every 2000 ms; after 10 s without an answer the phase is `Failed` and nothing is launched again; a running app that disappears is relaunched only after 4 consecutive misses (about 8 s), not within 30 s of the previous launch, and at most 3 times per plugin session; remote mode / auto start off / an incompatible protocol never launch. The policy only *says* "launch"; it starts nothing.

- [ ] **Step 1: Write the failing test**

`plugin/tests/test_launch_policy.cpp`
```cpp
// SPDX-License-Identifier: GPL-2.0-or-later
#include "doctest/doctest.h"

#include "LaunchPolicy.hpp"

using namespace olc;

namespace {
constexpr auto U = HealthObservation::Unreachable;
constexpr auto OK = HealthObservation::Ok;
}  // namespace

TEST_CASE("the first unreachable probe launches the app once and schedules a quick re-check") {
    LaunchPolicy p;
    const auto d = p.onHealth(0, U);
    CHECK(d.launch);
    CHECK(d.phase == LaunchPhase::Launching);
    CHECK(d.nextCheckInMs == 250);
    CHECK(p.launches() == 1);
}

TEST_CASE("a slow start never produces a second launch (double launch is the failure to avoid)") {
    LaunchPolicy p;
    int launches = p.onHealth(0, U).launch ? 1 : 0;
    std::vector<int> delays;
    int64_t t = 0;
    while (t + 250 < 10'000) {
        t += 250;
        const auto d = p.onHealth(t, U);
        if (d.launch) ++launches;
        delays.push_back(d.nextCheckInMs);
        CHECK(d.phase == LaunchPhase::Launching);
    }
    CHECK(launches == 1);
    // The delay schedule is 500, 1000, 1500, 2000, 2000, ... (the first 250 was returned with the launch).
    REQUIRE(delays.size() > 6);
    CHECK(delays[0] == 500);
    CHECK(delays[1] == 1000);
    CHECK(delays[2] == 1500);
    CHECK(delays[3] == 2000);
    CHECK(delays[4] == 2000);
    CHECK(delays[5] == 2000);
}

TEST_CASE("after the 10 s budget the policy gives up without launching again") {
    LaunchPolicy p;
    p.onHealth(0, U);
    const auto d = p.onHealth(10'000, U);
    CHECK_FALSE(d.launch);
    CHECK(d.phase == LaunchPhase::Failed);
    CHECK(d.nextCheckInMs == 5'000);
    CHECK_FALSE(p.onHealth(40'000, U).launch);
    CHECK(p.launches() == 1);
}

TEST_CASE("an answer after the launch means Running, with one launch on the books") {
    LaunchPolicy p;
    p.onHealth(0, U);
    p.onHealth(250, U);
    const auto d = p.onHealth(900, OK);
    CHECK(d.phase == LaunchPhase::Running);
    CHECK_FALSE(d.launch);
    CHECK(d.nextCheckInMs == 5'000);
    CHECK(p.launches() == 1);
}

TEST_CASE("an app that is already running is never launched") {
    LaunchPolicy p;
    CHECK_FALSE(p.onHealth(0, OK).launch);
    CHECK(p.launches() == 0);
}

TEST_CASE("a running app that disappears is relaunched only after four misses in a row") {
    LaunchPolicy p;
    p.onHealth(0, OK);
    CHECK_FALSE(p.onHealth(100'000, U).launch);
    CHECK_FALSE(p.onHealth(102'000, U).launch);
    CHECK_FALSE(p.onHealth(104'000, U).launch);
    const auto d = p.onHealth(106'000, U);
    CHECK(d.launch);
    CHECK(p.launches() == 1);
}

TEST_CASE("one answer in between resets the miss counter (a hiccup is not a death)") {
    LaunchPolicy p;
    p.onHealth(0, OK);
    p.onHealth(5'000, U);
    p.onHealth(7'000, U);
    p.onHealth(9'000, U);
    p.onHealth(11'000, OK);
    CHECK_FALSE(p.onHealth(16'000, U).launch);
    CHECK_FALSE(p.onHealth(18'000, U).launch);
    CHECK_FALSE(p.onHealth(20'000, U).launch);
}

TEST_CASE("the cooldown stops a crash loop from relaunching faster than every 30 s") {
    LaunchPolicy p;
    CHECK(p.onHealth(0, U).launch);   // launch #1 at t=0
    p.onHealth(1'000, OK);            // it came up
    p.onHealth(5'000, U);
    p.onHealth(7'000, U);
    p.onHealth(9'000, U);
    const auto early = p.onHealth(11'000, U);  // dead again, but only 11 s after the last launch
    CHECK_FALSE(early.launch);
    CHECK(early.phase == LaunchPhase::Unavailable);
    CHECK_FALSE(p.onHealth(20'000, U).launch);
    CHECK(p.onHealth(30'000, U).launch);  // the cooldown has passed: now it may
    CHECK(p.launches() == 2);
}

TEST_CASE("a plugin session launches the app at most three times") {
    LaunchPolicy p;
    int64_t t = 0;
    int launches = 0;
    for (int round = 0; round < 6; ++round) {
        if (p.onHealth(t, U).launch) ++launches;
        t += 1'000;
        p.onHealth(t, OK);  // each launch comes up, then dies
        for (int miss = 0; miss < 4; ++miss) {
            t += 35'000;
            if (p.onHealth(t, U).launch) ++launches;
        }
    }
    CHECK(launches == 3);
    CHECK(p.launches() == 3);
}

TEST_CASE("remote mode (launch not allowed) never launches and says Unavailable") {
    LaunchPolicyConfig cfg;
    cfg.allowLaunch = false;
    LaunchPolicy p(cfg);
    for (int i = 0; i < 10; ++i) {
        const auto d = p.onHealth(i * 5'000, U);
        CHECK_FALSE(d.launch);
        CHECK(d.phase == LaunchPhase::Unavailable);
    }
    CHECK(p.launches() == 0);
}

TEST_CASE("an incompatible app is never launched over and never counts as running") {
    LaunchPolicy p;
    const auto d = p.onHealth(0, HealthObservation::Incompatible);
    CHECK(d.phase == LaunchPhase::Incompatible);
    CHECK_FALSE(d.launch);
    CHECK(p.onHealth(5'000, OK).phase == LaunchPhase::Running);
}

TEST_CASE("reset forgets the launch count so a settings change can start over") {
    LaunchPolicy p;
    p.onHealth(0, U);
    p.onHealth(10'000, U);  // Failed
    p.reset();
    CHECK(p.phase() == LaunchPhase::Checking);
    CHECK(p.launches() == 0);
    CHECK(p.onHealth(20'000, U).launch);
}
```


- [ ] **Step 2: Run, confirm failure** — `bash plugin/scripts/verify.sh` -> `FAIL cpp`.

- [ ] **Step 3: Implement**

`plugin/core/LaunchPolicy.hpp`
```cpp
// SPDX-License-Identifier: GPL-2.0-or-later
#pragma once
#include <cstdint>
#include <vector>

namespace olc {

/** What one health probe saw. */
enum class HealthObservation { Ok, Incompatible, Unreachable };

enum class LaunchPhase {
    Checking,      // nothing observed yet
    Launching,     // we started the app and are waiting for it to answer
    Running,       // the app answered and is compatible
    Incompatible,  // the app answered but speaks another protocol: never launch, never deliver
    Unavailable,   // unreachable and we may not (or not yet) launch it: remote mode, cooldown, limit
    Failed,        // we launched it and it never answered within the budget
};

struct LaunchPolicyConfig {
    bool allowLaunch = true;                                     // false in remote mode or when auto start is off
    int64_t startupBudgetMs = 10'000;                            // TECH-DESIGN §3: retry up to 10 s
    std::vector<int> retryDelaysMs{250, 500, 1000, 1500, 2000};  // checks while Launching; the last one repeats
    int steadyIntervalMs = 5'000;                                // checks once Running, Unavailable or Failed
    int confirmIntervalMs = 2'000;                               // checks while a running app might have died
    int unreachableBeforeRelaunch = 4;                           // consecutive misses before "dead" (about 8 s)
    int64_t relaunchCooldownMs = 30'000;                         // never two launches closer than this
    int maxLaunches = 3;                                         // per plugin session
};

struct PolicyDecision {
    bool launch = false;    // start the app now (exactly once per true)
    int nextCheckInMs = 0;  // when to probe again
    LaunchPhase phase = LaunchPhase::Checking;
};

/**
 * Pure state machine behind the AppLauncher. It never starts anything itself: it says "launch" at most once
 * per launch window, so a slow start can never produce two processes (Review Focus 2).
 */
class LaunchPolicy {
public:
    explicit LaunchPolicy(LaunchPolicyConfig config = {});

    PolicyDecision onHealth(int64_t nowMs, HealthObservation observed);

    LaunchPhase phase() const { return phase_; }
    int launches() const { return launches_; }

    void setAllowLaunch(bool allow) { config_.allowLaunch = allow; }
    /** Settings changed: forget the past (launch count included) and start observing again. */
    void reset();

private:
    PolicyDecision tryLaunch(int64_t nowMs);
    int retryDelay(int attempt) const;

    LaunchPolicyConfig config_;
    LaunchPhase phase_ = LaunchPhase::Checking;
    int launches_ = 0;
    int attempt_ = 0;
    int unreachable_ = 0;
    int64_t lastLaunchAt_ = 0;
};

} // namespace olc
```

`plugin/core/LaunchPolicy.cpp`
```cpp
// SPDX-License-Identifier: GPL-2.0-or-later
#include "LaunchPolicy.hpp"

#include <algorithm>
#include <utility>

namespace olc {

LaunchPolicy::LaunchPolicy(LaunchPolicyConfig config) : config_(std::move(config)) {
    if (config_.retryDelaysMs.empty()) config_.retryDelaysMs = {1000};
}

void LaunchPolicy::reset() {
    phase_ = LaunchPhase::Checking;
    launches_ = 0;
    attempt_ = 0;
    unreachable_ = 0;
    lastLaunchAt_ = 0;
}

int LaunchPolicy::retryDelay(int attempt) const {
    const auto last = static_cast<int>(config_.retryDelaysMs.size()) - 1;
    return config_.retryDelaysMs[static_cast<size_t>(std::min(attempt, last))];
}

PolicyDecision LaunchPolicy::tryLaunch(int64_t nowMs) {
    const bool cooled = launches_ == 0 || nowMs - lastLaunchAt_ >= config_.relaunchCooldownMs;
    if (!config_.allowLaunch || launches_ >= config_.maxLaunches || !cooled) {
        phase_ = LaunchPhase::Unavailable;
        unreachable_ = 0;
        return {false, config_.steadyIntervalMs, phase_};
    }
    ++launches_;
    lastLaunchAt_ = nowMs;
    attempt_ = 1;  // the first delay is returned right now
    unreachable_ = 0;
    phase_ = LaunchPhase::Launching;
    return {true, retryDelay(0), phase_};
}

PolicyDecision LaunchPolicy::onHealth(int64_t nowMs, HealthObservation observed) {
    if (observed == HealthObservation::Ok) {
        phase_ = LaunchPhase::Running;
        unreachable_ = 0;
        attempt_ = 0;
        return {false, config_.steadyIntervalMs, phase_};
    }
    if (observed == HealthObservation::Incompatible) {
        phase_ = LaunchPhase::Incompatible;
        unreachable_ = 0;
        return {false, config_.steadyIntervalMs, phase_};
    }
    // Unreachable.
    switch (phase_) {
    case LaunchPhase::Launching:
        if (nowMs - lastLaunchAt_ >= config_.startupBudgetMs) {
            phase_ = LaunchPhase::Failed;
            return {false, config_.steadyIntervalMs, phase_};
        }
        return {false, retryDelay(attempt_++), phase_};
    case LaunchPhase::Failed:
        return {false, config_.steadyIntervalMs, phase_};
    case LaunchPhase::Running:
    case LaunchPhase::Incompatible:
        // An app we knew went away. One missed probe is not a death: wait for several in a row.
        if (++unreachable_ < config_.unreachableBeforeRelaunch) return {false, config_.confirmIntervalMs, phase_};
        return tryLaunch(nowMs);
    case LaunchPhase::Checking:
    case LaunchPhase::Unavailable:
        return tryLaunch(nowMs);
    }
    return {false, config_.steadyIntervalMs, phase_};
}

} // namespace olc
```


- [ ] **Step 4: Run, confirm pass** — `bash plugin/scripts/verify.sh` -> `PASS`.

- [ ] **Step 5: Commit**

```
git add plugin/core plugin/tests
git commit -m "feat(plugin): launch policy state machine (one launch per window, backoff, cooldown, limits)"
```

---

### Task 5: Core — obs-websocket configuration and credential delivery rules

**Files:**
- Create: `plugin/core/ObsWsConfig.hpp`, `plugin/core/ObsWsConfig.cpp`, `plugin/core/CredentialTracker.hpp`, `plugin/core/CredentialTracker.cpp`, `plugin/tests/test_obsws_config.cpp`, `plugin/tests/test_credential_tracker.cpp`

**Interfaces:**
- Produces: `ObsWsConfig {serverEnabled, port, authRequired, Secret password}`, `parseObsWsConfig(json)`, `LegacyObsWsValues`, `fromLegacyValues`, `applyCommandLineOverrides`, `loadObsWsConfig(readFile, path, legacy, args)`, `describe(ObsWsConfig)` (log-safe), `buildCredentialsBody` (host `127.0.0.1`, port, password only when authentication is on); `DeliveryOutcome`, `classifyDelivery(HttpResponse)`, `CredentialTracker::{due, record, forget}`.

Rules (DT-5): deliver on the first healthy probe, whenever the app's `instanceId` changes, whenever obs-websocket's own settings change; after a failure back off 2/4/8/16/30 s (transport, 5xx), 1/2/5/30 s (401: the token file is re-read each call), 30 s (400/403/404). The password is held only in memory as a `Secret`.

- [ ] **Step 1: Write the failing tests**

`plugin/tests/test_obsws_config.cpp`
```cpp
// SPDX-License-Identifier: GPL-2.0-or-later
#include "doctest/doctest.h"

#include <nlohmann/json.hpp>

#include "ObsWsConfig.hpp"

using namespace olc;

TEST_CASE("parseObsWsConfig reads the file exactly as obs-websocket 5.x writes it") {
    // Shape verified on a real OBS 32.2.2 install (password replaced).
    const auto cfg = parseObsWsConfig(
        R"({"alerts_enabled":false,"auth_required":true,"first_load":false,"server_enabled":true,"server_password":"s3cret-pw","server_port":4455})");
    REQUIRE(cfg.has_value());
    CHECK(cfg->serverEnabled);
    CHECK(cfg->authRequired);
    CHECK(cfg->port == 4455);
    CHECK(cfg->password.reveal() == "s3cret-pw");
}

TEST_CASE("missing keys keep obs-websocket's own defaults") {
    const auto cfg = parseObsWsConfig("{}");
    REQUIRE(cfg.has_value());
    CHECK_FALSE(cfg->serverEnabled);
    CHECK(cfg->authRequired);
    CHECK(cfg->port == 4455);
    CHECK(cfg->password.empty());
}

TEST_CASE("wrongly typed keys and out-of-range ports are ignored, not trusted") {
    const auto cfg = parseObsWsConfig(R"({"server_enabled":"yes","server_port":70000,"auth_required":1,"server_password":42})");
    REQUIRE(cfg.has_value());
    CHECK_FALSE(cfg->serverEnabled);
    CHECK(cfg->port == 4455);
    CHECK(cfg->authRequired);
    CHECK(cfg->password.empty());
}

TEST_CASE("a corrupt or non-object file is nullopt") {
    CHECK_FALSE(parseObsWsConfig("").has_value());
    CHECK_FALSE(parseObsWsConfig("{\"server_port\": 44").has_value());
    CHECK_FALSE(parseObsWsConfig("[1,2]").has_value());
}

TEST_CASE("legacy global.ini values fill the same struct") {
    LegacyObsWsValues v;
    v.serverEnabled = true;
    v.port = 4466;
    v.authRequired = true;
    v.password = "old-pw";
    const auto cfg = fromLegacyValues(v);
    CHECK(cfg.serverEnabled);
    CHECK(cfg.port == 4466);
    CHECK(cfg.password.reveal() == "old-pw");
    CHECK(fromLegacyValues({}).port == 4455);
}

TEST_CASE("command line overrides win, like in obs-websocket") {
    ObsWsConfig base;
    base.serverEnabled = true;
    base.authRequired = false;
    SUBCASE("port, spaced and with equals") {
        CHECK(applyCommandLineOverrides(base, {"obs64.exe", "--websocket_port", "4466"}).port == 4466);
        CHECK(applyCommandLineOverrides(base, {"--websocket_port=4477"}).port == 4477);
        CHECK(applyCommandLineOverrides(base, {"-websocket_port=4488"}).port == 4488);
    }
    SUBCASE("an invalid port is ignored") {
        CHECK(applyCommandLineOverrides(base, {"--websocket_port", "99999"}).port == 4455);
        CHECK(applyCommandLineOverrides(base, {"--websocket_port", "abc"}).port == 4455);
        CHECK(applyCommandLineOverrides(base, {"--websocket_port"}).port == 4455);
    }
    SUBCASE("a password override turns authentication on") {
        const auto cfg = applyCommandLineOverrides(base, {"--websocket_password", "cli-pw"});
        CHECK(cfg.authRequired);
        CHECK(cfg.password.reveal() == "cli-pw");
    }
    SUBCASE("no arguments changes nothing") { CHECK(applyCommandLineOverrides(base, {}) == base); }
}

TEST_CASE("the credentials body carries host, port and the password only when authentication is on") {
    ObsWsConfig cfg;
    cfg.serverEnabled = true;
    cfg.port = 4455;
    cfg.password = Secret("pw");
    auto body = nlohmann::json::parse(buildCredentialsBody(cfg));
    CHECK(body["host"] == "127.0.0.1");
    CHECK(body["port"] == 4455);
    CHECK(body["password"] == "pw");

    cfg.authRequired = false;  // password still stored in the file, but OBS does not ask for it
    body = nlohmann::json::parse(buildCredentialsBody(cfg));
    CHECK_FALSE(body.contains("password"));

    cfg.authRequired = true;
    cfg.password = Secret();
    body = nlohmann::json::parse(buildCredentialsBody(cfg));
    CHECK_FALSE(body.contains("password"));
}

TEST_CASE("describe(config) is log-safe") {
    ObsWsConfig cfg;
    cfg.password = Secret("do-not-print-me");
    const auto line = describe(cfg);
    CHECK(line.find("do-not-print-me") == std::string::npos);
    CHECK(line.find("port=4455") != std::string::npos);
    CHECK(line.find("<secret>") != std::string::npos);
}

TEST_CASE("loadObsWsConfig: file first, legacy second, command line last, nothing readable = nullopt") {
    const auto file = [](const char* text) {
        return [text](const std::string&) -> std::optional<std::string> { return std::string(text); };
    };
    const auto missing = [](const std::string&) -> std::optional<std::string> { return std::nullopt; };
    LegacyObsWsValues legacy;
    legacy.port = 4466;
    legacy.serverEnabled = true;

    const auto fromFile = loadObsWsConfig(file(R"({"server_enabled":true,"server_port":4477})"), "p", legacy, {});
    REQUIRE(fromFile.has_value());
    CHECK(fromFile->port == 4477);

    const auto fromLegacy = loadObsWsConfig(missing, "p", legacy, {});
    REQUIRE(fromLegacy.has_value());
    CHECK(fromLegacy->port == 4466);

    const auto corruptFallsBack = loadObsWsConfig(file("{broken"), "p", legacy, {});
    REQUIRE(corruptFallsBack.has_value());
    CHECK(corruptFallsBack->port == 4466);

    CHECK_FALSE(loadObsWsConfig(missing, "p", std::nullopt, {}).has_value());
    CHECK_FALSE(loadObsWsConfig(file("{broken"), "p", std::nullopt, {}).has_value());

    const auto overridden = loadObsWsConfig(file(R"({"server_enabled":true})"), "p", std::nullopt, {"--websocket_port=4488"});
    REQUIRE(overridden.has_value());
    CHECK(overridden->port == 4488);
}
```

`plugin/tests/test_credential_tracker.cpp`
```cpp
// SPDX-License-Identifier: GPL-2.0-or-later
#include "doctest/doctest.h"

#include "CredentialTracker.hpp"

using namespace olc;

namespace {
ObsWsConfig config(const char* pw = "pw", int port = 4455) {
    ObsWsConfig c;
    c.serverEnabled = true;
    c.port = port;
    c.password = Secret(pw);
    return c;
}
HttpResponse answered(int status) {
    HttpResponse r;
    r.status = status;
    return r;
}
HttpResponse failed() {
    HttpResponse r;
    r.error = "timeout";
    return r;
}
}  // namespace

TEST_CASE("classifyDelivery maps HTTP answers to what the tracker needs") {
    CHECK(classifyDelivery(answered(204)) == DeliveryOutcome::Delivered);
    CHECK(classifyDelivery(answered(401)) == DeliveryOutcome::TokenRejected);
    CHECK(classifyDelivery(answered(403)) == DeliveryOutcome::Refused);
    CHECK(classifyDelivery(answered(400)) == DeliveryOutcome::Refused);
    CHECK(classifyDelivery(answered(404)) == DeliveryOutcome::Refused);
    CHECK(classifyDelivery(answered(503)) == DeliveryOutcome::TransportError);
    CHECK(classifyDelivery(failed()) == DeliveryOutcome::TransportError);
}

TEST_CASE("the first healthy probe is due, and once delivered nothing is due") {
    CredentialTracker t;
    CHECK(t.due(0, config(), "i1"));
    t.record(0, DeliveryOutcome::Delivered, config(), "i1");
    CHECK_FALSE(t.due(1'000, config(), "i1"));
    CHECK_FALSE(t.due(600'000, config(), "i1"));
}

TEST_CASE("a new instanceId (the app restarted) makes the delivery due again") {
    CredentialTracker t;
    t.record(0, DeliveryOutcome::Delivered, config(), "i1");
    CHECK(t.due(10, config(), "i2"));
}

TEST_CASE("a changed password or port in obs-websocket makes the delivery due again") {
    CredentialTracker t;
    t.record(0, DeliveryOutcome::Delivered, config("old"), "i1");
    CHECK(t.due(10, config("new"), "i1"));
    CHECK(t.due(10, config("old", 4466), "i1"));
}

TEST_CASE("failures back off, then a delivery resets everything") {
    CredentialTracker t;
    t.record(1'000, DeliveryOutcome::TransportError, config(), "i1");
    CHECK_FALSE(t.due(2'999, config(), "i1"));
    CHECK(t.due(3'000, config(), "i1"));  // 2 s
    t.record(3'000, DeliveryOutcome::TransportError, config(), "i1");
    CHECK_FALSE(t.due(6'999, config(), "i1"));
    CHECK(t.due(7'000, config(), "i1"));  // 4 s
    CHECK(t.consecutiveFailures() == 2);
    t.record(7'000, DeliveryOutcome::Delivered, config(), "i1");
    CHECK(t.consecutiveFailures() == 0);
    CHECK_FALSE(t.due(7'001, config(), "i1"));
}

TEST_CASE("a rejected token is retried quickly, a refusal slowly") {
    CredentialTracker t;
    t.record(0, DeliveryOutcome::TokenRejected, config(), "i1");
    CHECK(t.due(1'000, config(), "i1"));
    CredentialTracker r;
    r.record(0, DeliveryOutcome::Refused, config(), "i1");
    CHECK_FALSE(r.due(29'999, config(), "i1"));
    CHECK(r.due(30'000, config(), "i1"));
}

TEST_CASE("the backoff is capped at 30 s however long the outage lasts") {
    CredentialTracker t;
    int64_t now = 0;
    for (int i = 0; i < 20; ++i) {
        t.record(now, DeliveryOutcome::TransportError, config(), "i1");
        now = t.retryAt();
    }
    t.record(now, DeliveryOutcome::TransportError, config(), "i1");
    CHECK(t.retryAt() - now == 30'000);
}

TEST_CASE("forget() makes the next healthy probe deliver again") {
    CredentialTracker t;
    t.record(0, DeliveryOutcome::Delivered, config(), "i1");
    t.forget();
    CHECK(t.due(1, config(), "i1"));
}
```


- [ ] **Step 2: Run, confirm failure** — `bash plugin/scripts/verify.sh` -> `FAIL cpp`.

- [ ] **Step 3: Implement**

`plugin/core/ObsWsConfig.hpp`
```cpp
// SPDX-License-Identifier: GPL-2.0-or-later
#pragma once
#include <functional>
#include <optional>
#include <ostream>
#include <string>
#include <string_view>
#include <vector>

#include "Secret.hpp"

namespace olc {

/**
 * What obs-websocket 5.x stores. File: <OBS config>/plugin_config/obs-websocket/config.json, keys
 * server_enabled (bool), server_port (unsigned), auth_required (bool), server_password (string).
 * Defaults are obs-websocket's own (Config.h): ServerEnabled=false, port 4455, AuthRequired=true.
 */
struct ObsWsConfig {
    bool serverEnabled = false;
    int port = 4455;
    bool authRequired = true;
    Secret password;

    bool operator==(const ObsWsConfig& o) const {
        return serverEnabled == o.serverEnabled && port == o.port && authRequired == o.authRequired &&
               password == o.password;
    }
    bool operator!=(const ObsWsConfig& o) const { return !(*this == o); }
};

/** nullopt = the text is not a JSON object (a corrupt or half-written file). Wrongly typed keys keep the default. */
std::optional<ObsWsConfig> parseObsWsConfig(std::string_view jsonText);

/** Pre-5.1 location: [OBSWebSocket] in OBS's global.ini. The glue reads the four values, this fills the struct. */
struct LegacyObsWsValues {
    std::optional<bool> serverEnabled;   // ServerEnabled
    std::optional<int> port;             // ServerPort
    std::optional<bool> authRequired;    // AuthRequired
    std::optional<std::string> password; // ServerPassword
};
ObsWsConfig fromLegacyValues(const LegacyObsWsValues& values);

/**
 * obs-websocket lets the OBS command line win over the file: --websocket_port N (only when 1..65535) and
 * --websocket_password P (which also turns authentication on). Accepts "--name value", "--name=value" and the
 * single-dash spelling, like QCommandLineParser does.
 */
ObsWsConfig applyCommandLineOverrides(ObsWsConfig config, const std::vector<std::string>& args);

/**
 * The whole read: config.json first, else the legacy values (when the glue found any), then the command line.
 * nullopt = nothing readable (the file is missing or corrupt and there are no legacy values).
 */
std::optional<ObsWsConfig> loadObsWsConfig(const std::function<std::optional<std::string>(const std::string&)>& readFile,
                                           const std::string& configPath, const std::optional<LegacyObsWsValues>& legacy,
                                           const std::vector<std::string>& args);

/** One log-safe line: enabled/port/auth and the Secret marker, never the password. */
std::string describe(const ObsWsConfig& config);
inline std::ostream& operator<<(std::ostream& os, const ObsWsConfig& config) { return os << describe(config); }

/** JSON body for POST /api/internal/obs-credentials. The password is left out when authentication is off. */
std::string buildCredentialsBody(const ObsWsConfig& config);

} // namespace olc
```

`plugin/core/ObsWsConfig.cpp`
```cpp
// SPDX-License-Identifier: GPL-2.0-or-later
#include "ObsWsConfig.hpp"

#include <charconv>
#include <nlohmann/json.hpp>

namespace olc {

namespace {
bool validPort(long long port) { return port >= 1 && port <= 65535; }

/** Value of option `name` in args, or nullopt. "--name v", "--name=v", "-name v" and "-name=v". */
std::optional<std::string> optionValue(const std::vector<std::string>& args, const std::string& name) {
    for (size_t i = 0; i < args.size(); ++i) {
        for (const char* dashes : {"--", "-"}) {
            const std::string flag = std::string(dashes) + name;
            if (args[i] == flag) {
                if (i + 1 < args.size()) return args[i + 1];
                return std::nullopt;
            }
            if (args[i].rfind(flag + "=", 0) == 0) return args[i].substr(flag.size() + 1);
        }
    }
    return std::nullopt;
}
}  // namespace

std::optional<ObsWsConfig> parseObsWsConfig(std::string_view jsonText) {
    const auto doc = nlohmann::json::parse(jsonText.begin(), jsonText.end(), nullptr, false);
    if (!doc.is_object()) return std::nullopt;
    ObsWsConfig cfg;
    if (const auto it = doc.find("server_enabled"); it != doc.end() && it->is_boolean()) cfg.serverEnabled = it->get<bool>();
    if (const auto it = doc.find("server_port"); it != doc.end() && it->is_number_unsigned()) {
        const auto port = it->get<unsigned long long>();
        if (port >= 1 && port <= 65535) cfg.port = static_cast<int>(port);
    }
    if (const auto it = doc.find("auth_required"); it != doc.end() && it->is_boolean()) cfg.authRequired = it->get<bool>();
    if (const auto it = doc.find("server_password"); it != doc.end() && it->is_string()) {
        cfg.password = Secret(it->get<std::string>());
    }
    return cfg;
}

ObsWsConfig fromLegacyValues(const LegacyObsWsValues& values) {
    ObsWsConfig cfg;
    if (values.serverEnabled) cfg.serverEnabled = *values.serverEnabled;
    if (values.port && validPort(*values.port)) cfg.port = *values.port;
    if (values.authRequired) cfg.authRequired = *values.authRequired;
    if (values.password) cfg.password = Secret(*values.password);
    return cfg;
}

ObsWsConfig applyCommandLineOverrides(ObsWsConfig config, const std::vector<std::string>& args) {
    if (const auto port = optionValue(args, "websocket_port")) {
        long long parsed = 0;
        const auto* end = port->data() + port->size();
        const auto r = std::from_chars(port->data(), end, parsed);
        if (r.ec == std::errc() && r.ptr == end && validPort(parsed)) config.port = static_cast<int>(parsed);
    }
    if (const auto password = optionValue(args, "websocket_password"); password && !password->empty()) {
        config.authRequired = true;
        config.password = Secret(*password);
    }
    return config;
}

std::optional<ObsWsConfig> loadObsWsConfig(const std::function<std::optional<std::string>(const std::string&)>& readFile,
                                           const std::string& configPath, const std::optional<LegacyObsWsValues>& legacy,
                                           const std::vector<std::string>& args) {
    if (const auto text = readFile(configPath)) {
        if (const auto cfg = parseObsWsConfig(*text)) return applyCommandLineOverrides(*cfg, args);
    }
    if (legacy) return applyCommandLineOverrides(fromLegacyValues(*legacy), args);
    return std::nullopt;
}

std::string describe(const ObsWsConfig& config) {
    return std::string("obs-websocket{enabled=") + (config.serverEnabled ? "true" : "false") +
           ", port=" + std::to_string(config.port) + ", auth=" + (config.authRequired ? "true" : "false") +
           ", password=" + describe(config.password) + "}";
}

std::string buildCredentialsBody(const ObsWsConfig& config) {
    nlohmann::json body = {{"host", "127.0.0.1"}, {"port", config.port}};
    if (config.authRequired && !config.password.empty()) body["password"] = config.password.reveal();
    return body.dump();
}

}  // namespace olc
```

`plugin/core/CredentialTracker.hpp`
```cpp
// SPDX-License-Identifier: GPL-2.0-or-later
#pragma once
#include <cstdint>
#include <string>

#include "Http.hpp"
#include "ObsWsConfig.hpp"

namespace olc {

enum class DeliveryOutcome {
    Delivered,       // 204
    TokenRejected,  // 401: the secret.token we read is not the app's current one (re-read it and retry soon)
    Refused,         // 400/403/404/...: the app understood and said no; retrying fast will not help
    TransportError,  // no HTTP answer, or 5xx
};

DeliveryOutcome classifyDelivery(const HttpResponse& response);

/**
 * Decides WHEN the credentials (DT-5) must be POSTed: on the first healthy probe, whenever the app's instanceId
 * changes, whenever obs-websocket's own settings change, and again after a failure with a backoff. It holds the
 * last delivered config in memory (a Secret), never on disk, and never prints it.
 */
class CredentialTracker {
public:
    bool due(int64_t nowMs, const ObsWsConfig& config, const std::string& instanceId) const;
    void record(int64_t nowMs, DeliveryOutcome outcome, const ObsWsConfig& config, const std::string& instanceId);
    /** Settings changed, or the app vanished: deliver again next time regardless of what was delivered. */
    void forget();

    int consecutiveFailures() const { return failures_; }
    int64_t retryAt() const { return retryAt_; }

private:
    bool delivered_ = false;
    ObsWsConfig deliveredConfig_;
    std::string deliveredInstance_;
    int failures_ = 0;
    int64_t retryAt_ = 0;
};

} // namespace olc
```

`plugin/core/CredentialTracker.cpp`
```cpp
// SPDX-License-Identifier: GPL-2.0-or-later
#include "CredentialTracker.hpp"

#include <algorithm>

namespace olc {

DeliveryOutcome classifyDelivery(const HttpResponse& response) {
    if (!response.answered()) return DeliveryOutcome::TransportError;
    if (response.status == 204 || response.status == 200) return DeliveryOutcome::Delivered;
    if (response.status == 401) return DeliveryOutcome::TokenRejected;
    if (response.status >= 500) return DeliveryOutcome::TransportError;
    return DeliveryOutcome::Refused;
}

namespace {
int64_t backoffMs(DeliveryOutcome outcome, int failures) {
    const int step = std::min(failures, 5);
    switch (outcome) {
    case DeliveryOutcome::TransportError: {
        static const int64_t kSchedule[] = {2'000, 4'000, 8'000, 16'000, 30'000};
        return kSchedule[step - 1];
    }
    case DeliveryOutcome::TokenRejected: {
        static const int64_t kSchedule[] = {1'000, 2'000, 5'000, 30'000, 30'000};
        return kSchedule[step - 1];
    }
    case DeliveryOutcome::Refused:
        return 30'000;
    case DeliveryOutcome::Delivered:
        return 0;
    }
    return 30'000;
}
}  // namespace

bool CredentialTracker::due(int64_t nowMs, const ObsWsConfig& config, const std::string& instanceId) const {
    if (nowMs < retryAt_) return false;
    if (!delivered_) return true;
    if (instanceId != deliveredInstance_) return true;
    return config != deliveredConfig_;
}

void CredentialTracker::record(int64_t nowMs, DeliveryOutcome outcome, const ObsWsConfig& config,
                               const std::string& instanceId) {
    if (outcome == DeliveryOutcome::Delivered) {
        delivered_ = true;
        deliveredConfig_ = config;
        deliveredInstance_ = instanceId;
        failures_ = 0;
        retryAt_ = 0;
        return;
    }
    ++failures_;
    retryAt_ = nowMs + backoffMs(outcome, failures_);
}

void CredentialTracker::forget() {
    delivered_ = false;
    deliveredConfig_ = ObsWsConfig{};
    deliveredInstance_.clear();
    failures_ = 0;
    retryAt_ = 0;
}

}  // namespace olc
```


- [ ] **Step 4: Run, confirm pass** — `bash plugin/scripts/verify.sh` -> `PASS`.

- [ ] **Step 5: Commit**

```
git add plugin/core plugin/tests
git commit -m "feat(plugin): obs-websocket config parsing, credential body, delivery tracker with backoff"
```

---

### Task 6: Core — API client, worker threads, hotkey slots and forwarder

**Files:**
- Create: `plugin/core/ApiClient.hpp`, `plugin/core/ApiClient.cpp`, `plugin/core/Dispatcher.hpp`, `plugin/core/Dispatcher.cpp`, `plugin/core/TickLoop.hpp`, `plugin/core/TickLoop.cpp`, `plugin/core/HotkeySlots.hpp`, `plugin/core/HotkeySlots.cpp`, `plugin/core/HotkeyForwarder.hpp`, `plugin/core/HotkeyForwarder.cpp`, `plugin/tests/support/fakes.hpp`, `plugin/tests/test_dispatcher.cpp`, `plugin/tests/test_tick_loop.cpp`, `plugin/tests/test_hotkeys.cpp`

**Interfaces:**
- Produces: `ApiClient(IHttpClient&, baseUrl, TokenProvider)` with `health()`, `postCredentials`, `postScreens`, `postHotkey(slot, session, seq)`, `setBaseUrl`, `trimToken`; `Dispatcher` (one worker, bounded queue, `post` never blocks, `stop` waits only for the running job); `TickLoop(tick, period)`; `SlotDef`, `hotkeySlots()` (18 fixed slots), `findSlot`; `HotkeyForwarder(api, worker, log, session)` with `onPress(slotId)`; `randomSessionId()`; test fakes `FakeHttp`, `reply`, `unreachable`.
- **Slot names are frozen**: OBS stores a user's key assignments by `obsName` (`obs-live-clock.message.1` …). Descriptions use ASCII `+tempo` / `-tempo` (DT-9 writes U+2212; ASCII keeps the OBS settings list and the contract file simple).

Rules: hotkey requests go to their own `Dispatcher` (a hung health probe cannot delay a key press), are numbered `(session, seq)`, sent once each in order and **never retried** (a retried press could confirm an emergency slot); the bearer token is read from `secret.token` on every call and trimmed.

- [ ] **Step 1: Write the failing tests**

`plugin/tests/support/fakes.hpp`
```cpp
// SPDX-License-Identifier: GPL-2.0-or-later
#pragma once
#include <deque>
#include <functional>
#include <map>
#include <mutex>
#include <string>
#include <vector>

#include "Http.hpp"

namespace olc::testing {

/** Records every request; answers from a script, or with the default response. Thread-safe. */
class FakeHttp : public IHttpClient {
public:
    HttpResponse perform(const HttpRequest& request) override {
        std::lock_guard<std::mutex> lock(mutex_);
        requests_.push_back(request);
        if (handler_) return handler_(request);
        if (!script_.empty()) {
            auto r = script_.front();
            if (script_.size() > 1) script_.pop_front();
            return r;
        }
        HttpResponse ok;
        ok.status = 204;
        return ok;
    }

    void setHandler(std::function<HttpResponse(const HttpRequest&)> handler) {
        std::lock_guard<std::mutex> lock(mutex_);
        handler_ = std::move(handler);
    }
    void script(std::vector<HttpResponse> responses) {
        std::lock_guard<std::mutex> lock(mutex_);
        script_.assign(responses.begin(), responses.end());
    }
    std::vector<HttpRequest> requests() const {
        std::lock_guard<std::mutex> lock(mutex_);
        return requests_;
    }
    std::vector<HttpRequest> requestsTo(const std::string& pathPart) const {
        std::vector<HttpRequest> out;
        for (const auto& r : requests())
            if (r.url.find(pathPart) != std::string::npos) out.push_back(r);
        return out;
    }

private:
    mutable std::mutex mutex_;
    std::vector<HttpRequest> requests_;
    std::deque<HttpResponse> script_;
    std::function<HttpResponse(const HttpRequest&)> handler_;
};

inline HttpResponse reply(int status, std::string body = {}) {
    HttpResponse r;
    r.status = status;
    r.body = std::move(body);
    return r;
}
inline HttpResponse unreachable() {
    HttpResponse r;
    r.error = "connection refused";
    return r;
}

}  // namespace olc::testing
```

`plugin/tests/test_dispatcher.cpp`
```cpp
// SPDX-License-Identifier: GPL-2.0-or-later
#include "doctest/doctest.h"

#include <atomic>
#include <chrono>
#include <future>
#include <vector>

#include "Dispatcher.hpp"

using namespace olc;
using namespace std::chrono_literals;

namespace {
template <class Pred>
bool waitFor(Pred pred, std::chrono::milliseconds limit = 2000ms) {
    const auto end = std::chrono::steady_clock::now() + limit;
    while (std::chrono::steady_clock::now() < end) {
        if (pred()) return true;
        std::this_thread::sleep_for(2ms);
    }
    return pred();
}
}  // namespace

TEST_CASE("jobs run on another thread, in the order they were posted") {
    Dispatcher d;
    std::mutex m;
    std::vector<int> seen;
    std::atomic<bool> otherThread{false};
    const auto caller = std::this_thread::get_id();
    for (int i = 0; i < 10; ++i) {
        CHECK(d.post([&, i] {
            if (std::this_thread::get_id() != caller) otherThread = true;
            std::lock_guard<std::mutex> lock(m);
            seen.push_back(i);
        }));
    }
    CHECK(waitFor([&] {
        std::lock_guard<std::mutex> lock(m);
        return seen.size() == 10;
    }));
    CHECK(otherThread.load());
    for (int i = 0; i < 10; ++i) CHECK(seen[static_cast<size_t>(i)] == i);
}

TEST_CASE("post() returns at once even while a job blocks (the OBS thread must never wait)") {
    Dispatcher d;
    std::promise<void> release;
    auto gate = release.get_future().share();
    std::atomic<bool> started{false};
    d.post([&] {
        started = true;
        gate.wait();  // a hung HTTP call
    });
    REQUIRE(waitFor([&] { return started.load(); }));
    const auto t0 = std::chrono::steady_clock::now();
    for (int i = 0; i < 5; ++i) d.post([] {});
    const auto spent = std::chrono::steady_clock::now() - t0;
    CHECK(spent < 100ms);
    release.set_value();
}

TEST_CASE("a full queue drops new jobs and counts them instead of growing without bound") {
    Dispatcher d(2);
    std::promise<void> release;
    auto gate = release.get_future().share();
    std::atomic<bool> started{false};
    d.post([&] {
        started = true;
        gate.wait();
    });
    REQUIRE(waitFor([&] { return started.load(); }));
    CHECK(d.post([] {}));
    CHECK(d.post([] {}));
    CHECK_FALSE(d.post([] {}));
    CHECK(d.dropped() == 1);
    release.set_value();
}

TEST_CASE("a throwing job does not kill the worker") {
    Dispatcher d;
    d.post([] { throw 42; });
    std::atomic<bool> ran{false};
    d.post([&] { ran = true; });
    CHECK(waitFor([&] { return ran.load(); }));
}

TEST_CASE("stop() waits for the running job, drops the queue, and later posts are refused") {
    Dispatcher d;
    std::atomic<bool> started{false};
    std::atomic<bool> finished{false};
    std::atomic<int> queuedRan{0};
    d.post([&] {
        started = true;
        std::this_thread::sleep_for(100ms);
        finished = true;
    });
    REQUIRE(waitFor([&] { return started.load(); }));
    d.post([&] { ++queuedRan; });
    d.stop();
    CHECK(finished.load());
    CHECK(queuedRan.load() == 0);
    CHECK_FALSE(d.post([] {}));
    d.stop();  // idempotent
}
```

`plugin/tests/test_tick_loop.cpp`
```cpp
// SPDX-License-Identifier: GPL-2.0-or-later
#include "doctest/doctest.h"

#include <atomic>
#include <chrono>
#include <thread>

#include "TickLoop.hpp"

using namespace olc;
using namespace std::chrono_literals;

TEST_CASE("the loop ticks repeatedly on its own thread") {
    std::atomic<int> ticks{0};
    std::atomic<bool> otherThread{false};
    const auto caller = std::this_thread::get_id();
    TickLoop loop(
        [&] {
            ++ticks;
            if (std::this_thread::get_id() != caller) otherThread = true;
        },
        10ms);
    const auto end = std::chrono::steady_clock::now() + 2s;
    while (ticks.load() < 5 && std::chrono::steady_clock::now() < end) std::this_thread::sleep_for(5ms);
    CHECK(ticks.load() >= 5);
    CHECK(otherThread.load());
}

TEST_CASE("stop() returns promptly even with a long period, and no tick runs afterwards") {
    std::atomic<int> ticks{0};
    TickLoop loop([&] { ++ticks; }, 60s);
    std::this_thread::sleep_for(50ms);
    const auto t0 = std::chrono::steady_clock::now();
    loop.stop();
    CHECK(std::chrono::steady_clock::now() - t0 < 500ms);
    const int after = ticks.load();
    std::this_thread::sleep_for(50ms);
    CHECK(ticks.load() == after);
    loop.stop();  // idempotent
}

TEST_CASE("a throwing tick does not end the loop") {
    std::atomic<int> ticks{0};
    TickLoop loop(
        [&] {
            if (++ticks == 1) throw 7;
        },
        10ms);
    const auto end = std::chrono::steady_clock::now() + 2s;
    while (ticks.load() < 3 && std::chrono::steady_clock::now() < end) std::this_thread::sleep_for(5ms);
    CHECK(ticks.load() >= 3);
}
```

`plugin/tests/test_hotkeys.cpp`
```cpp
// SPDX-License-Identifier: GPL-2.0-or-later
#include "doctest/doctest.h"

#include <atomic>
#include <chrono>
#include <future>
#include <nlohmann/json.hpp>
#include <set>
#include <thread>

#include "ApiClient.hpp"
#include "HotkeyForwarder.hpp"
#include "HotkeySlots.hpp"
#include "support/fakes.hpp"

using namespace olc;
using namespace olc::testing;
using namespace std::chrono_literals;

namespace {
template <class Pred>
bool waitFor(Pred pred, std::chrono::milliseconds limit = 2000ms) {
    const auto end = std::chrono::steady_clock::now() + limit;
    while (std::chrono::steady_clock::now() < end) {
        if (pred()) return true;
        std::this_thread::sleep_for(2ms);
    }
    return pred();
}
}  // namespace

TEST_CASE("there are exactly 18 fixed slots with unique ids and unique OBS names") {
    const auto& slots = hotkeySlots();
    REQUIRE(slots.size() == 18);
    std::set<std::string> ids, names;
    for (const auto& s : slots) {
        ids.insert(s.id);
        names.insert(s.obsName);
        CHECK(s.description.rfind("OBS Live Clock: ", 0) == 0);
        CHECK(s.obsName.rfind("obs-live-clock.", 0) == 0);
    }
    CHECK(ids.size() == 18);
    CHECK(names.size() == 18);
}

TEST_CASE("slot ids and OBS names are frozen (OBS stores key bindings by name)") {
    const auto& s = hotkeySlots();
    CHECK(s[0].id == "message-1");
    CHECK(s[0].obsName == "obs-live-clock.message.1");
    CHECK(s[0].description == "OBS Live Clock: Messaggio 1");
    CHECK(s[11].id == "message-12");
    CHECK(s[12].id == "clear");
    CHECK(s[13].id == "next");
    CHECK(s[14].id == "prev");
    CHECK(s[15].id == "time-plus");
    CHECK(s[16].id == "time-minus");
    CHECK(s[17].id == "control-toggle");
    CHECK(s[17].obsName == "obs-live-clock.control.toggle");
}

TEST_CASE("only messages and CLEAR are immediate; the five emergency slots need confirmation") {
    for (const auto& s : hotkeySlots()) {
        const bool immediate = s.id.rfind("message-", 0) == 0 || s.id == "clear";
        CHECK(s.emergency == !immediate);
    }
    CHECK(findSlot("next")->emergency);
    CHECK(findSlot("nope") == nullptr);
}

TEST_CASE("postHotkey sends slot, session and seq with the bearer token and a short timeout") {
    FakeHttp http;
    ApiClient api(http, "http://127.0.0.1:4460", [] { return std::string("tok\r\n"); });
    api.postHotkey("next", "abc123", 7);
    const auto requests = http.requests();
    REQUIRE(requests.size() == 1);
    const auto& r = requests[0];
    CHECK(r.method == "POST");
    CHECK(r.url == "http://127.0.0.1:4460/api/internal/hotkey");
    CHECK(r.timeoutMs <= 2000);
    const auto body = nlohmann::json::parse(r.body);
    CHECK(body["slot"] == "next");
    CHECK(body["session"] == "abc123");
    CHECK(body["seq"] == 7);
    bool bearer = false;
    for (const auto& h : r.headers)
        if (h.first == "Authorization") bearer = h.second == "Bearer tok";
    CHECK(bearer);
}

TEST_CASE("health() is a GET without credentials") {
    FakeHttp http;
    ApiClient api(http, "http://127.0.0.1:4460/", [] { return std::string("tok"); });
    api.setBaseUrl("http://127.0.0.1:4461/");
    api.health();
    const auto r = http.requests().at(0);
    CHECK(r.method == "GET");
    CHECK(r.url == "http://127.0.0.1:4461/api/health");
    CHECK(r.headers.empty());
}

TEST_CASE("onPress returns immediately while the app hangs, and presses are sent once each, in order") {
    FakeHttp http;
    std::promise<void> release;
    auto gate = release.get_future().share();
    std::atomic<int> inFlight{0};
    http.setHandler([&](const HttpRequest&) {
        ++inFlight;
        gate.wait();  // the app is hung: every request would block until released
        return reply(200);
    });
    ApiClient api(http, "http://127.0.0.1:4460", [] { return std::string("tok"); });
    Dispatcher worker;
    HotkeyForwarder fwd(api, worker, nullptr, "sess");

    const auto t0 = std::chrono::steady_clock::now();
    CHECK(fwd.onPress("next"));
    CHECK(fwd.onPress("next"));
    CHECK(fwd.onPress("clear"));
    CHECK(std::chrono::steady_clock::now() - t0 < 100ms);

    REQUIRE(waitFor([&] { return inFlight.load() == 1; }));
    release.set_value();
    REQUIRE(waitFor([&] { return http.requests().size() == 3; }));
    const auto reqs = http.requests();
    CHECK(nlohmann::json::parse(reqs[0].body)["seq"] == 1);
    CHECK(nlohmann::json::parse(reqs[1].body)["seq"] == 2);
    CHECK(nlohmann::json::parse(reqs[2].body)["seq"] == 3);
    CHECK(nlohmann::json::parse(reqs[2].body)["slot"] == "clear");
    worker.stop();
}

TEST_CASE("a failed hotkey request is logged but never retried") {
    FakeHttp http;
    http.setHandler([](const HttpRequest&) { return unreachable(); });
    ApiClient api(http, "http://127.0.0.1:4460", [] { return std::string("tok"); });
    Dispatcher worker;
    std::mutex m;
    std::vector<std::string> lines;
    HotkeyForwarder fwd(api, worker, [&](const std::string& l) {
        std::lock_guard<std::mutex> lock(m);
        lines.push_back(l);
    });
    fwd.onPress("next");
    REQUIRE(waitFor([&] {
        std::lock_guard<std::mutex> lock(m);
        return !lines.empty();
    }));
    std::this_thread::sleep_for(100ms);
    CHECK(http.requests().size() == 1);
    CHECK(lines[0].find("next") != std::string::npos);
    CHECK(lines[0].find("tok") == std::string::npos);
    worker.stop();
}

TEST_CASE("an unknown slot is refused locally and a full queue drops the press") {
    FakeHttp http;
    ApiClient api(http, "http://127.0.0.1:4460", [] { return std::string("tok"); });
    Dispatcher worker(1);
    HotkeyForwarder fwd(api, worker, nullptr);
    CHECK_FALSE(fwd.onPress("bogus"));
    worker.stop();
    CHECK_FALSE(fwd.onPress("next"));
}

TEST_CASE("session ids are 16 hex characters and differ between runs") {
    const auto a = randomSessionId();
    const auto b = randomSessionId();
    CHECK(a.size() == 16);
    CHECK(a.find_first_not_of("0123456789abcdef") == std::string::npos);
    CHECK(a != b);
}
```


- [ ] **Step 2: Run, confirm failure** — `bash plugin/scripts/verify.sh` -> `FAIL cpp`.

- [ ] **Step 3: Implement**

`plugin/core/ApiClient.hpp`
```cpp
// SPDX-License-Identifier: GPL-2.0-or-later
#pragma once
#include <cstdint>
#include <functional>
#include <mutex>
#include <string>

#include "Http.hpp"

namespace olc {

/**
 * Builds the app's HTTP requests. Blocking: call it from a Dispatcher job, never from OBS's UI thread.
 * The bearer token is asked for on every call (the file may have been rewritten), trimmed, and only ever put in
 * the Authorization header. Request bodies are not logged by anything in this class.
 */
class ApiClient {
public:
    using TokenProvider = std::function<std::string()>;

    ApiClient(IHttpClient& http, std::string baseUrl, TokenProvider token);

    /** "http://127.0.0.1:4460", no trailing slash. Thread-safe. */
    void setBaseUrl(std::string baseUrl);
    std::string baseUrl() const;

    HttpResponse health();                                    // GET  /api/health                      (no auth)
    HttpResponse postCredentials(const std::string& body);    // POST /api/internal/obs-credentials
    HttpResponse postScreens(const std::string& body);        // POST /api/internal/screens
    /** POST /api/internal/hotkey {"slot","session","seq"}. Never retried: a repeated press could confirm an emergency. */
    HttpResponse postHotkey(const std::string& slotId, const std::string& session, uint64_t seq);

private:
    HttpResponse postJson(const std::string& path, std::string body, int timeoutMs);

    IHttpClient& http_;
    TokenProvider token_;
    mutable std::mutex mutex_;
    std::string baseUrl_;
};

std::string trimToken(const std::string& raw);

} // namespace olc
```

`plugin/core/ApiClient.cpp`
```cpp
// SPDX-License-Identifier: GPL-2.0-or-later
#include "ApiClient.hpp"

#include <nlohmann/json.hpp>
#include <utility>

namespace olc {

std::string trimToken(const std::string& raw) {
    const auto first = raw.find_first_not_of(" \t\r\n");
    if (first == std::string::npos) return {};
    const auto last = raw.find_last_not_of(" \t\r\n");
    return raw.substr(first, last - first + 1);
}

ApiClient::ApiClient(IHttpClient& http, std::string baseUrl, TokenProvider token)
    : http_(http), token_(std::move(token)), baseUrl_(std::move(baseUrl)) {}

void ApiClient::setBaseUrl(std::string baseUrl) {
    while (!baseUrl.empty() && baseUrl.back() == '/') baseUrl.pop_back();
    std::lock_guard<std::mutex> lock(mutex_);
    baseUrl_ = std::move(baseUrl);
}

std::string ApiClient::baseUrl() const {
    std::lock_guard<std::mutex> lock(mutex_);
    return baseUrl_;
}

HttpResponse ApiClient::health() {
    HttpRequest request;
    request.method = "GET";
    request.url = baseUrl() + "/api/health";
    request.timeoutMs = 1500;
    return http_.perform(request);
}

HttpResponse ApiClient::postJson(const std::string& path, std::string body, int timeoutMs) {
    HttpRequest request;
    request.method = "POST";
    request.url = baseUrl() + path;
    request.timeoutMs = timeoutMs;
    request.headers.emplace_back("Content-Type", "application/json");
    const std::string token = trimToken(token_ ? token_() : std::string());
    if (!token.empty()) request.headers.emplace_back("Authorization", "Bearer " + token);
    request.body = std::move(body);
    return http_.perform(request);
}

HttpResponse ApiClient::postCredentials(const std::string& body) {
    return postJson("/api/internal/obs-credentials", body, 2000);
}

HttpResponse ApiClient::postScreens(const std::string& body) { return postJson("/api/internal/screens", body, 2000); }

HttpResponse ApiClient::postHotkey(const std::string& slotId, const std::string& session, uint64_t seq) {
    const nlohmann::json body = {{"slot", slotId}, {"session", session}, {"seq", seq}};
    return postJson("/api/internal/hotkey", body.dump(), 1500);
}

}  // namespace olc
```

`plugin/core/Dispatcher.hpp`
```cpp
// SPDX-License-Identifier: GPL-2.0-or-later
#pragma once
#include <atomic>
#include <condition_variable>
#include <cstddef>
#include <deque>
#include <functional>
#include <mutex>
#include <thread>

namespace olc {

/**
 * One worker thread with a bounded FIFO queue. Everything that can block (HTTP, process start, file reads) runs
 * here, never on OBS's UI or hotkey thread (Review Focus 1). post() takes a mutex for a few instructions and
 * returns at once: false when the queue is full or the dispatcher stopped (the job is dropped, never waited for).
 */
class Dispatcher {
public:
    explicit Dispatcher(std::size_t maxQueue = 32);
    ~Dispatcher();
    Dispatcher(const Dispatcher&) = delete;
    Dispatcher& operator=(const Dispatcher&) = delete;

    bool post(std::function<void()> job);
    /** Stops the worker: waits for the job that is running, drops the ones still queued. Idempotent. */
    void stop();

    std::size_t dropped() const { return dropped_.load(); }
    std::size_t queued() const;

private:
    void run();

    const std::size_t maxQueue_;
    mutable std::mutex mutex_;
    std::condition_variable wake_;
    std::deque<std::function<void()>> queue_;
    bool stopping_ = false;
    std::atomic<std::size_t> dropped_{0};
    std::thread thread_;
};

} // namespace olc
```

`plugin/core/Dispatcher.cpp`
```cpp
// SPDX-License-Identifier: GPL-2.0-or-later
#include "Dispatcher.hpp"

#include <utility>

namespace olc {

Dispatcher::Dispatcher(std::size_t maxQueue) : maxQueue_(maxQueue), thread_([this] { run(); }) {}

Dispatcher::~Dispatcher() { stop(); }

bool Dispatcher::post(std::function<void()> job) {
    {
        std::lock_guard<std::mutex> lock(mutex_);
        if (stopping_ || queue_.size() >= maxQueue_) {
            ++dropped_;
            return false;
        }
        queue_.push_back(std::move(job));
    }
    wake_.notify_one();
    return true;
}

std::size_t Dispatcher::queued() const {
    std::lock_guard<std::mutex> lock(mutex_);
    return queue_.size();
}

void Dispatcher::stop() {
    {
        std::lock_guard<std::mutex> lock(mutex_);
        stopping_ = true;
        queue_.clear();
    }
    wake_.notify_all();
    if (thread_.joinable() && thread_.get_id() != std::this_thread::get_id()) thread_.join();
}

void Dispatcher::run() {
    for (;;) {
        std::function<void()> job;
        {
            std::unique_lock<std::mutex> lock(mutex_);
            wake_.wait(lock, [this] { return stopping_ || !queue_.empty(); });
            if (stopping_) return;
            job = std::move(queue_.front());
            queue_.pop_front();
        }
        try {
            job();
        } catch (...) {
            // A failing job must never take the worker (and with it the hotkeys) down.
        }
    }
}

} // namespace olc
```

`plugin/core/TickLoop.hpp`
```cpp
// SPDX-License-Identifier: GPL-2.0-or-later
#pragma once
#include <chrono>
#include <condition_variable>
#include <functional>
#include <mutex>
#include <thread>

namespace olc {

/**
 * Calls `tick` on its own thread every `period` (measured start to start, so a slow tick does not stack up).
 * stop() wakes the thread at once and joins it; a tick that is running is waited for, so keep ticks short
 * (HTTP calls carry timeouts of 1.5 to 2 s). An exception in `tick` is swallowed: the loop must outlive it.
 */
class TickLoop {
public:
    TickLoop(std::function<void()> tick, std::chrono::milliseconds period);
    ~TickLoop();
    TickLoop(const TickLoop&) = delete;
    TickLoop& operator=(const TickLoop&) = delete;

    void stop();

private:
    void run();

    std::function<void()> tick_;
    std::chrono::milliseconds period_;
    std::mutex mutex_;
    std::condition_variable wake_;
    bool stopping_ = false;
    std::thread thread_;
};

} // namespace olc
```

`plugin/core/TickLoop.cpp`
```cpp
// SPDX-License-Identifier: GPL-2.0-or-later
#include "TickLoop.hpp"

#include <utility>

namespace olc {

TickLoop::TickLoop(std::function<void()> tick, std::chrono::milliseconds period)
    : tick_(std::move(tick)), period_(period), thread_([this] { run(); }) {}

TickLoop::~TickLoop() { stop(); }

void TickLoop::stop() {
    {
        std::lock_guard<std::mutex> lock(mutex_);
        stopping_ = true;
    }
    wake_.notify_all();
    if (thread_.joinable() && thread_.get_id() != std::this_thread::get_id()) thread_.join();
}

void TickLoop::run() {
    auto next = std::chrono::steady_clock::now();
    for (;;) {
        {
            std::lock_guard<std::mutex> lock(mutex_);
            if (stopping_) return;
        }
        try {
            tick_();
        } catch (...) {
            // keep going
        }
        next += period_;
        const auto now = std::chrono::steady_clock::now();
        if (next < now) next = now;  // we fell behind: do not burst to catch up
        std::unique_lock<std::mutex> lock(mutex_);
        if (wake_.wait_until(lock, next, [this] { return stopping_; })) return;
    }
}

}  // namespace olc
```

`plugin/core/HotkeySlots.hpp`
```cpp
// SPDX-License-Identifier: GPL-2.0-or-later
#pragma once
#include <string>
#include <vector>

namespace olc {

/**
 * The fixed OBS hotkey slots (DT-9). OBS stores key assignments by the registration NAME, so these names are a
 * contract with the user's profile: never rename one. `id` is what the app receives in POST /api/internal/hotkey;
 * a contract test pins this table against server/src/hotkeys/slots.ts.
 */
struct SlotDef {
    std::string id;           // "message-1" .. "message-12", "clear", "next", "prev", "time-plus", "time-minus", "control-toggle"
    std::string obsName;      // "obs-live-clock.message.1" ...
    std::string description;  // what OBS shows in Settings > Hotkeys
    bool emergency;           // the app asks for a second press within 1 s (DT-9)
};

const std::vector<SlotDef>& hotkeySlots();
const SlotDef* findSlot(const std::string& id);

} // namespace olc
```

`plugin/core/HotkeySlots.cpp`
```cpp
// SPDX-License-Identifier: GPL-2.0-or-later
#include "HotkeySlots.hpp"

namespace olc {

namespace {
std::vector<SlotDef> build() {
    std::vector<SlotDef> slots;
    for (int n = 1; n <= 12; ++n) {
        const auto s = std::to_string(n);
        slots.push_back({"message-" + s, "obs-live-clock.message." + s, "OBS Live Clock: Messaggio " + s, false});
    }
    slots.push_back({"clear", "obs-live-clock.clear", "OBS Live Clock: CLEAR", false});
    slots.push_back({"next", "obs-live-clock.next", "OBS Live Clock: NEXT", true});
    slots.push_back({"prev", "obs-live-clock.prev", "OBS Live Clock: PREV", true});
    slots.push_back({"time-plus", "obs-live-clock.time.plus", "OBS Live Clock: +tempo", true});
    slots.push_back({"time-minus", "obs-live-clock.time.minus", "OBS Live Clock: -tempo", true});
    slots.push_back({"control-toggle", "obs-live-clock.control.toggle", "OBS Live Clock: MANUALE/AUTO", true});
    return slots;
}
}  // namespace

const std::vector<SlotDef>& hotkeySlots() {
    static const std::vector<SlotDef> slots = build();
    return slots;
}

const SlotDef* findSlot(const std::string& id) {
    for (const auto& slot : hotkeySlots())
        if (slot.id == id) return &slot;
    return nullptr;
}

}  // namespace olc
```

`plugin/core/HotkeyForwarder.hpp`
```cpp
// SPDX-License-Identifier: GPL-2.0-or-later
#pragma once
#include <atomic>
#include <cstdint>
#include <functional>
#include <string>

#include "ApiClient.hpp"
#include "Dispatcher.hpp"

namespace olc {

/** 16 hex characters from std::random_device: tells the app which plugin run a press sequence belongs to. */
std::string randomSessionId();

/**
 * Turns an OBS hotkey press into POST /api/internal/hotkey on a worker. onPress() is called on OBS's hotkey
 * thread and must return immediately: it only numbers the press and queues a job. Presses are sent in order, once
 * each, never retried. The double-press confirmation of emergency slots is decided by the APP, not here.
 */
class HotkeyForwarder {
public:
    using Log = std::function<void(const std::string&)>;

    HotkeyForwarder(ApiClient& api, Dispatcher& worker, Log log, std::string session = randomSessionId());

    /** false = the press was dropped (unknown slot, or the worker queue is full). */
    bool onPress(const std::string& slotId);

    const std::string& session() const { return session_; }

private:
    ApiClient& api_;
    Dispatcher& worker_;
    Log log_;
    std::string session_;
    std::atomic<uint64_t> seq_{0};
};

} // namespace olc
```

`plugin/core/HotkeyForwarder.cpp`
```cpp
// SPDX-License-Identifier: GPL-2.0-or-later
#include "HotkeyForwarder.hpp"

#include <cstdio>
#include <random>
#include <utility>

#include "HotkeySlots.hpp"

namespace olc {

std::string randomSessionId() {
    std::random_device rd;
    const uint64_t value = (static_cast<uint64_t>(rd()) << 32) ^ static_cast<uint64_t>(rd());
    char buf[17];
    std::snprintf(buf, sizeof buf, "%016llx", static_cast<unsigned long long>(value));
    return buf;
}

HotkeyForwarder::HotkeyForwarder(ApiClient& api, Dispatcher& worker, Log log, std::string session)
    : api_(api), worker_(worker), log_(std::move(log)), session_(std::move(session)) {}

bool HotkeyForwarder::onPress(const std::string& slotId) {
    if (findSlot(slotId) == nullptr) return false;
    const uint64_t seq = ++seq_;
    const bool queued = worker_.post([this, slotId, seq] {
        const HttpResponse response = api_.postHotkey(slotId, session_, seq);
        if (!response.answered()) {
            if (log_) log_("hotkey " + slotId + ": app not reachable (" + response.error + ")");
        } else if (response.status >= 300) {
            if (log_) log_("hotkey " + slotId + ": app answered HTTP " + std::to_string(response.status));
        }
    });
    if (!queued && log_) log_("hotkey " + slotId + ": dropped, the worker queue is full");
    return queued;
}

}  // namespace olc
```


- [ ] **Step 4: Run, confirm pass** — `bash plugin/scripts/verify.sh` -> `PASS`. Run it three times (thread tests): all green.

- [ ] **Step 5: Commit**

```
git add plugin/core plugin/tests
git commit -m "feat(plugin): API client, dispatcher and tick loop workers, fixed hotkey slots, hotkey forwarder"
```

---

### Task 7: Kiosk controller, browser detection, Node adapters

**Files:**
- Create: `server/src/kiosk/detect.ts`, `server/src/kiosk/controller.ts`, `server/src/kiosk/node-kiosk.ts`, `server/test/kiosk/detect.test.ts`, `server/test/kiosk/controller.test.ts`, `server/test/kiosk/node-kiosk.test.ts`

**Interfaces:**
- Consumes (Task 2): `KioskSettings`, `choosePlacement`, `buildKioskArgs`, `RestartPolicy`, `ScreenInfo`.
- Produces: `detectBrowser(deps, override?)` (Chrome, Edge, Chromium, Brave; Windows registry `App Paths` then known folders, macOS `/Applications` then `~/Applications`, Linux `which`); `KioskController` (`start`, `stop`, `restart`, `applySettings`, `onScreensChanged`, `status`, `dispose`), `KioskState`, `KioskStatus`, `KioskDeps`, `KioskProcess`; `nodeSpawn`, `nodeDetectDeps`, `parseRegQuery`.

Rules (the supervision policy, TECH-DESIGN §9 "never fight the operator"): launch only when the placement is known (a named monitor not in the list gives `screen_missing`, no list gives `waiting_for_screens`; never the primary monitor instead); a browser path from the settings that does not exist is an error, not replaced; a process that cannot start is `spawn_failed` and not retried; a closed or crashed browser is reopened after 2, 5, 15, 30 s, and after 4 reopenings within 10 minutes the controller is `suspended` until the operator presses Start; a clean exit within 3 s of the start means Chrome handed the window to an instance already using the same profile (`handed_off`, no loop); Stop and application shutdown kill the browser and nothing reopens it; a monitor that moved while running reopens the window once, a monitor that disappeared leaves it alone. Registry values are read with `reg query ... /ve` and parsed on `REG_SZ`/`REG_EXPAND_SZ` only, because the label is localised ("(Predefinito)"); verified on this machine for Chrome and Edge.

- [ ] **Step 1: Write the failing tests**

`server/test/kiosk/detect.test.ts`
```ts
// SPDX-License-Identifier: GPL-2.0-or-later
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { detectBrowser, type DetectDeps } from '../../src/kiosk/detect';

function deps(over: Partial<DetectDeps> & { files?: string[]; onPath?: Record<string, string>; registry?: Record<string, string> }): DetectDeps {
  const files = new Set(over.files ?? []);
  return {
    platform: 'win32',
    env: { ProgramFiles: 'C:\\Program Files', 'ProgramFiles(x86)': 'C:\\Program Files (x86)', LOCALAPPDATA: 'C:\\Users\\ann\\AppData\\Local' },
    home: '/home/ann',
    exists: async (p) => files.has(p),
    which: async (n) => over.onPath?.[n] ?? null,
    appPath: async (exe) => over.registry?.[exe] ?? null,
    ...over,
  };
}

describe('detectBrowser', () => {
  it('Windows: the registry App Paths entry wins, in the order Chrome, Edge, Chromium, Brave', async () => {
    const d = deps({
      registry: { 'chrome.exe': 'D:/chrome.exe', 'msedge.exe': 'D:/edge.exe' },
      files: ['D:/chrome.exe', 'D:/edge.exe'],
    });
    expect(await detectBrowser(d)).toEqual({ kind: 'chrome', path: 'D:/chrome.exe' });
  });

  it('Windows: falls back to the known folders, and skips a registry entry whose file is gone', async () => {
    const edge = join('C:\\Program Files (x86)', 'Microsoft', 'Edge', 'Application', 'msedge.exe');
    const d = deps({ registry: { 'chrome.exe': 'D:/gone.exe' }, files: [edge] });
    expect(await detectBrowser(d)).toEqual({ kind: 'edge', path: edge });
  });

  it('Windows: finds Brave in Program Files', async () => {
    const brave = join('C:\\Program Files', 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe');
    expect(await detectBrowser(deps({ files: [brave] }))).toEqual({ kind: 'brave', path: brave });
  });

  it('macOS: looks in /Applications then ~/Applications', async () => {
    const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
    expect(await detectBrowser(deps({ platform: 'darwin', files: [chrome] }))).toEqual({ kind: 'chrome', path: chrome });
    const mine = join('/home/ann', 'Applications', 'Chromium.app', 'Contents', 'MacOS', 'Chromium');
    expect(await detectBrowser(deps({ platform: 'darwin', files: [mine] }))).toEqual({ kind: 'chromium', path: mine });
  });

  it('Linux: uses PATH names, google-chrome-stable first', async () => {
    const d = deps({ platform: 'linux', onPath: { chromium: '/usr/bin/chromium', 'google-chrome-stable': '/usr/bin/google-chrome-stable' } });
    expect(await detectBrowser(d)).toEqual({ kind: 'chrome', path: '/usr/bin/google-chrome-stable' });
    expect(await detectBrowser(deps({ platform: 'linux', onPath: { 'brave-browser': '/usr/bin/brave-browser' } }))).toEqual({
      kind: 'brave',
      path: '/usr/bin/brave-browser',
    });
  });

  it('nothing installed: null', async () => {
    expect(await detectBrowser(deps({}))).toBeNull();
    expect(await detectBrowser(deps({ platform: 'linux' }))).toBeNull();
  });

  it('an override wins, and a missing override is NOT replaced by something else', async () => {
    const d = deps({ files: ['E:/mine/chrome.exe', 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'] });
    expect(await detectBrowser(d, 'E:/mine/chrome.exe')).toEqual({ kind: 'custom', path: 'E:/mine/chrome.exe' });
    expect(await detectBrowser(d, 'E:/typo/chrome.exe')).toBeNull();
  });
});
```

`server/test/kiosk/controller.test.ts`
```ts
// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import { FakeTime } from '../../src/clock/clock';
import { KioskController, type ExitInfo, type KioskDeps, type KioskProcess } from '../../src/kiosk/controller';
import type { DetectedBrowser } from '../../src/kiosk/detect';
import type { ScreenInfo } from '../../src/kiosk/screens';
import type { KioskSettings } from '../../src/kiosk/settings';

const main: ScreenInfo = { name: 'DISPLAY1', x: 0, y: 0, width: 1920, height: 1080, devicePixelRatio: 1, primary: true };
const tv: ScreenInfo = { name: 'DISPLAY2', x: 1920, y: 0, width: 1920, height: 1080, devicePixelRatio: 1, primary: false };

class FakeProcess implements KioskProcess {
  killed = false;
  private cb: ((e: ExitInfo) => void) | null = null;
  constructor(readonly pid: number) {}
  kill(): void {
    this.killed = true;
  }
  onExit(cb: (e: ExitInfo) => void): void {
    this.cb = cb;
  }
  exit(code: number | null = 1, error?: string): void {
    this.cb?.({ code, error });
  }
}

function setup(over: Partial<KioskSettings> = {}, opts: { screens?: ScreenInfo[] | null; browser?: DetectedBrowser | null } = {}) {
  const time = new FakeTime();
  const spawned: { command: string; args: string[]; proc: FakeProcess }[] = [];
  const logs: string[] = [];
  let screens: ScreenInfo[] | null = opts.screens === undefined ? [main, tv] : opts.screens;
  let browser: DetectedBrowser | null = opts.browser === undefined ? { kind: 'chrome', path: 'C:/chrome.exe' } : opts.browser;
  let spawnError: Error | null = null;
  const deps: KioskDeps = {
    clock: time,
    scheduler: time,
    spawn: (command, args) => {
      if (spawnError !== null) throw spawnError;
      const proc = new FakeProcess(1000 + spawned.length);
      spawned.push({ command, args, proc });
      return proc;
    },
    detect: async () => browser,
    screens: () => screens,
    port: () => 4460,
    profileDir: 'C:/d/kiosk-profile',
    log: (m) => logs.push(m),
  };
  const settings: KioskSettings = { enabled: true, screen: { kind: 'name', name: 'DISPLAY2' }, restart: true, ...over };
  const kiosk = new KioskController(deps, settings);
  return {
    time,
    kiosk,
    spawned,
    logs,
    setScreens: (s: ScreenInfo[] | null) => (screens = s),
    setBrowser: (b: DetectedBrowser | null) => (browser = b),
    failSpawn: (e: Error | null) => (spawnError = e),
  };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('KioskController start', () => {
  it('opens the presenter on the configured monitor with the TECH-DESIGN §9 command line', async () => {
    const t = setup();
    await t.kiosk.start();
    expect(t.spawned).toHaveLength(1);
    expect(t.spawned[0]!.command).toBe('C:/chrome.exe');
    expect(t.spawned[0]!.args).toContain('--app=http://127.0.0.1:4460/presenter');
    expect(t.spawned[0]!.args).toContain('--kiosk');
    expect(t.spawned[0]!.args).toContain('--user-data-dir=C:/d/kiosk-profile');
    expect(t.spawned[0]!.args).toContain('--window-position=1936,16');
    expect(t.kiosk.status()).toMatchObject({ state: 'running', screen: 'DISPLAY2', pid: 1000 });
  });

  it('does nothing when the kiosk is disabled', async () => {
    const t = setup({ enabled: false });
    await t.kiosk.start();
    expect(t.spawned).toHaveLength(0);
    expect(t.kiosk.status().state).toBe('disabled');
  });

  it('wrong screen is never an option: a named monitor that is not there means no window and a clear state', async () => {
    const t = setup({}, { screens: [main] });
    await t.kiosk.start();
    expect(t.spawned).toHaveLength(0);
    expect(t.kiosk.status().state).toBe('screen_missing');
  });

  it('waits for the plugin when it needs the list, then opens as soon as the list arrives', async () => {
    const t = setup({}, { screens: null });
    await t.kiosk.start();
    expect(t.kiosk.status().state).toBe('waiting_for_screens');
    t.setScreens([main, tv]);
    t.kiosk.onScreensChanged();
    await flush();
    expect(t.spawned).toHaveLength(1);
    expect(t.kiosk.status().state).toBe('running');
  });

  it('reports a missing browser and does not retry by itself', async () => {
    const t = setup({}, { browser: null });
    await t.kiosk.start();
    expect(t.kiosk.status().state).toBe('browser_not_found');
    t.time.advance(10 * 60_000);
    expect(t.spawned).toHaveLength(0);
  });

  it('a spawn that throws is reported and not retried', async () => {
    const t = setup();
    t.failSpawn(new Error('spawn EACCES'));
    await t.kiosk.start();
    expect(t.kiosk.status().state).toBe('spawn_failed');
    t.time.advance(60_000);
    expect(t.spawned).toHaveLength(0);
  });

  it('a process that reports it could not start is spawn_failed, not a crash to restart', async () => {
    const t = setup();
    await t.kiosk.start();
    t.spawned[0]!.proc.exit(null, 'spawn ENOENT');
    expect(t.kiosk.status().state).toBe('spawn_failed');
    t.time.advance(60_000);
    expect(t.spawned).toHaveLength(1);
  });
});

describe('KioskController supervision (never fight the operator)', () => {
  it('reopens a closed browser after a pause, with growing pauses', async () => {
    const t = setup();
    await t.kiosk.start();
    t.time.advance(30_000);
    t.spawned[0]!.proc.exit(1);
    expect(t.kiosk.status().state).toBe('restarting');
    t.time.advance(1_999);
    expect(t.spawned).toHaveLength(1);
    t.time.advance(1);
    await flush();
    expect(t.spawned).toHaveLength(2);
    t.time.advance(30_000);
    t.spawned[1]!.proc.exit(1);
    t.time.advance(4_999);
    await flush();
    expect(t.spawned).toHaveLength(2);
    t.time.advance(1);
    await flush();
    expect(t.spawned).toHaveLength(3);
  });

  it('stops after four restarts in the window and says so (suspended), until the operator starts it again', async () => {
    const t = setup();
    await t.kiosk.start();
    for (let i = 0; i < 4; i++) {
      t.time.advance(20_000);
      t.spawned.at(-1)!.proc.exit(0);
      t.time.advance(40_000);
      await flush();
    }
    expect(t.spawned).toHaveLength(5);
    t.time.advance(20_000);
    t.spawned.at(-1)!.proc.exit(0);
    expect(t.kiosk.status().state).toBe('suspended');
    t.time.advance(60 * 60_000);
    await flush();
    expect(t.spawned).toHaveLength(5);
    await t.kiosk.start();
    expect(t.spawned).toHaveLength(6);
    expect(t.kiosk.status().state).toBe('running');
  });

  it('with restart off, a closed window stays closed', async () => {
    const t = setup({ restart: false });
    await t.kiosk.start();
    t.time.advance(30_000);
    t.spawned[0]!.proc.exit(0);
    expect(t.kiosk.status().state).toBe('stopped');
    t.time.advance(60_000);
    expect(t.spawned).toHaveLength(1);
  });

  it('a quick clean exit is a hand-off to a browser that was already running: no restart loop', async () => {
    const t = setup();
    await t.kiosk.start();
    t.time.advance(800);
    t.spawned[0]!.proc.exit(0);
    expect(t.kiosk.status().state).toBe('handed_off');
    t.time.advance(10 * 60_000);
    expect(t.spawned).toHaveLength(1);
  });

  it('Stop kills the browser and nothing reopens it', async () => {
    const t = setup();
    await t.kiosk.start();
    t.kiosk.stop();
    expect(t.spawned[0]!.proc.killed).toBe(true);
    t.spawned[0]!.proc.exit(1); // the kill arrives as an exit
    t.time.advance(60_000);
    await flush();
    expect(t.spawned).toHaveLength(1);
    expect(t.kiosk.status().state).toBe('stopped');
  });

  it('dispose (application shutdown) kills the browser and cancels a pending restart', async () => {
    const t = setup();
    await t.kiosk.start();
    t.time.advance(30_000);
    t.spawned[0]!.proc.exit(1);
    t.kiosk.dispose();
    t.time.advance(60_000);
    await flush();
    expect(t.spawned).toHaveLength(1);
    const t2 = setup();
    await t2.kiosk.start();
    t2.kiosk.dispose();
    expect(t2.spawned[0]!.proc.killed).toBe(true);
  });
});

describe('KioskController follows the monitors', () => {
  it('a monitor that moved gets the window reopened there, once', async () => {
    const t = setup();
    await t.kiosk.start();
    t.setScreens([main, { ...tv, x: 2560 }]);
    t.kiosk.onScreensChanged();
    await flush();
    expect(t.spawned[0]!.proc.killed).toBe(true);
    expect(t.spawned).toHaveLength(2);
    expect(t.spawned[1]!.args).toContain('--window-position=2576,16');
  });

  it('an unchanged list (the plugin reports again) does not restart anything', async () => {
    const t = setup();
    await t.kiosk.start();
    t.kiosk.onScreensChanged();
    await flush();
    expect(t.spawned).toHaveLength(1);
    expect(t.spawned[0]!.proc.killed).toBe(false);
  });

  it('the named monitor unplugged while running: the window is left alone (no jump to another monitor)', async () => {
    const t = setup();
    await t.kiosk.start();
    t.setScreens([main]);
    t.kiosk.onScreensChanged();
    await flush();
    expect(t.spawned).toHaveLength(1);
    expect(t.kiosk.status().state).toBe('running');
  });
});

describe('KioskController settings', () => {
  it('disabling stops the browser; enabling starts it', async () => {
    const t = setup();
    await t.kiosk.start();
    await t.kiosk.applySettings({ enabled: false, screen: { kind: 'primary' }, restart: true });
    expect(t.spawned[0]!.proc.killed).toBe(true);
    expect(t.kiosk.status().state).toBe('disabled');
    await t.kiosk.applySettings({ enabled: true, screen: { kind: 'primary' }, restart: true });
    expect(t.spawned).toHaveLength(2);
    expect(t.spawned[1]!.args).toContain('--window-position=16,16');
  });

  it('a superseded start (settings changed while detecting) does not open a second window', async () => {
    const t = setup();
    const a = t.kiosk.start();
    const b = t.kiosk.restart();
    await Promise.all([a, b]);
    expect(t.spawned).toHaveLength(1);
  });
});
```

`server/test/kiosk/node-kiosk.test.ts`
```ts
// SPDX-License-Identifier: GPL-2.0-or-later
import { chmod, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ExitInfo } from '../../src/kiosk/controller';
import { detectBrowser } from '../../src/kiosk/detect';
import { nodeDetectDeps, nodeSpawn, parseRegQuery } from '../../src/kiosk/node-kiosk';
import { tempDir } from '../support/tmp';

function exitOf(command: string, args: string[]): Promise<ExitInfo> {
  return new Promise((resolve) => nodeSpawn(command, args).onExit(resolve));
}

describe('nodeSpawn', () => {
  it('reports the exit code of a process that ends', async () => {
    expect(await exitOf(process.execPath, ['-e', 'process.exit(3)'])).toEqual({ code: 3 });
  });

  it('reports a command that cannot be started as an error, not as a crash', async () => {
    const info = await exitOf(join(await tempDir(), 'no-such-browser'), []);
    expect(info.code).toBeNull();
    expect(info.error).toMatch(/ENOENT|EACCES|spawn/);
  });

  it('kill() ends a running process', async () => {
    const proc = nodeSpawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)']);
    const ended = new Promise<ExitInfo>((resolve) => proc.onExit(resolve));
    expect(proc.pid).toBeGreaterThan(0);
    proc.kill();
    const info = await ended;
    expect(info.error).toBeUndefined();
  });

  it('delivers an exit that happened before onExit was registered', async () => {
    const proc = nodeSpawn(process.execPath, ['-e', 'process.exit(0)']);
    await new Promise((r) => setTimeout(r, 600));
    expect(await new Promise<ExitInfo>((resolve) => proc.onExit(resolve))).toEqual({ code: 0 });
  });
});

describe('parseRegQuery', () => {
  it('reads the default value whatever the language of the label', () => {
    const en = '\r\nHKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\chrome.exe\r\n    (Default)    REG_SZ    C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe\r\n\r\n';
    const it = '\r\nHKEY_LOCAL_MACHINE\\SOFTWARE\\...\\msedge.exe\r\n    (Predefinito)    REG_SZ    C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe\r\n';
    expect(parseRegQuery(en)).toBe('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe');
    expect(parseRegQuery(it)).toBe('C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe');
  });

  it('accepts REG_EXPAND_SZ and answers null when there is no value', () => {
    expect(parseRegQuery('    (Default)    REG_EXPAND_SZ    %ProgramFiles%\\x.exe')).toBe('%ProgramFiles%\\x.exe');
    expect(parseRegQuery('ERROR: The system was unable to find the specified registry key or value.')).toBeNull();
    expect(parseRegQuery('')).toBeNull();
  });
});

describe('nodeDetectDeps', () => {
  it('which() finds an executable on PATH and ignores a missing one', async () => {
    const dir = await tempDir();
    const exe = join(dir, process.platform === 'win32' ? 'fake-browser.exe' : 'fake-browser');
    await writeFile(exe, '#!/bin/sh\n');
    await chmod(exe, 0o755);
    const deps = nodeDetectDeps(process.platform, { ...process.env, PATH: dir });
    expect(await deps.which(process.platform === 'win32' ? 'fake-browser.exe' : 'fake-browser')).toBe(exe);
    expect(await deps.which('definitely-not-here')).toBeNull();
  });

  it('exists() is true for files only', async () => {
    const dir = await tempDir();
    const file = join(dir, 'a.txt');
    await writeFile(file, 'x');
    const deps = nodeDetectDeps();
    expect(await deps.exists(file)).toBe(true);
    expect(await deps.exists(dir)).toBe(false);
    expect(await deps.exists(join(dir, 'missing'))).toBe(false);
  });

  it('a configured browserPath that does not exist is not replaced by a detected one', async () => {
    expect(await detectBrowser(nodeDetectDeps(), join(await tempDir(), 'typo.exe'))).toBeNull();
  });
});
```


- [ ] **Step 2: Run, confirm failure** — `pnpm vitest run server/test/kiosk` -> FAIL (modules missing).

- [ ] **Step 3: Implement**

`server/src/kiosk/detect.ts`
```ts
// SPDX-License-Identifier: GPL-2.0-or-later
import { join } from 'node:path';

export type BrowserKind = 'chrome' | 'edge' | 'chromium' | 'brave' | 'custom';
export interface DetectedBrowser {
  kind: BrowserKind;
  path: string;
}

export interface DetectDeps {
  platform: NodeJS.Platform;
  env: NodeJS.ProcessEnv;
  home: string;
  /** true when the file exists and is a regular file. */
  exists(path: string): Promise<boolean>;
  /** Linux/macOS `which`: the first match on PATH, or null. */
  which(name: string): Promise<string | null>;
  /** Windows: the default value of HKLM or HKCU `SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\<exe>`, or null. */
  appPath(exe: string): Promise<string | null>;
}

interface Candidate {
  kind: Exclude<BrowserKind, 'custom'>;
  /** Windows App Paths executable name, Linux `which` names. */
  exe?: string;
  which?: string[];
  paths: (d: DetectDeps) => string[];
}

const win = (d: DetectDeps, ...rel: string[]): string[] =>
  [d.env.ProgramFiles, d.env['ProgramFiles(x86)'], d.env.LOCALAPPDATA]
    .filter((root): root is string => root !== undefined && root !== '')
    .map((root) => join(root, ...rel));

/** Chrome, then Edge, then Chromium, then Brave (TECH-DESIGN §9). Order inside a browser: registry, then known folders. */
const CANDIDATES: Candidate[] = [
  {
    kind: 'chrome',
    exe: 'chrome.exe',
    which: ['google-chrome-stable', 'google-chrome'],
    paths: (d) =>
      d.platform === 'win32'
        ? win(d, 'Google', 'Chrome', 'Application', 'chrome.exe')
        : [
            '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
            join(d.home, 'Applications', 'Google Chrome.app', 'Contents', 'MacOS', 'Google Chrome'),
          ],
  },
  {
    kind: 'edge',
    exe: 'msedge.exe',
    which: ['microsoft-edge-stable', 'microsoft-edge'],
    paths: (d) =>
      d.platform === 'win32'
        ? win(d, 'Microsoft', 'Edge', 'Application', 'msedge.exe')
        : [
            '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
            join(d.home, 'Applications', 'Microsoft Edge.app', 'Contents', 'MacOS', 'Microsoft Edge'),
          ],
  },
  {
    kind: 'chromium',
    which: ['chromium', 'chromium-browser'],
    paths: (d) =>
      d.platform === 'win32'
        ? win(d, 'Chromium', 'Application', 'chrome.exe')
        : ['/Applications/Chromium.app/Contents/MacOS/Chromium', join(d.home, 'Applications', 'Chromium.app', 'Contents', 'MacOS', 'Chromium')],
  },
  {
    kind: 'brave',
    exe: 'brave.exe',
    which: ['brave-browser', 'brave'],
    paths: (d) =>
      d.platform === 'win32'
        ? win(d, 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe')
        : [
            '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
            join(d.home, 'Applications', 'Brave Browser.app', 'Contents', 'MacOS', 'Brave Browser'),
          ],
  },
];

/**
 * The first installed Chromium-family browser, or null. `override` (settings.kiosk.browserPath) wins and is never
 * silently replaced: when it does not exist the answer is null, so the caller can say "browser not found".
 */
export async function detectBrowser(deps: DetectDeps, override?: string): Promise<DetectedBrowser | null> {
  if (override !== undefined && override !== '') {
    return (await deps.exists(override)) ? { kind: 'custom', path: override } : null;
  }
  for (const c of CANDIDATES) {
    if (deps.platform === 'win32' && c.exe !== undefined) {
      const registered = await deps.appPath(c.exe);
      if (registered !== null && (await deps.exists(registered))) return { kind: c.kind, path: registered };
    }
    if (deps.platform === 'linux') {
      for (const name of c.which ?? []) {
        const found = await deps.which(name);
        if (found !== null) return { kind: c.kind, path: found };
      }
      continue;
    }
    for (const path of c.paths(deps)) {
      if (await deps.exists(path)) return { kind: c.kind, path };
    }
  }
  return null;
}
```

`server/src/kiosk/controller.ts`
```ts
// SPDX-License-Identifier: GPL-2.0-or-later
import type { Clock, Scheduler } from '../clock/clock';
import type { DetectedBrowser } from './detect';
import { buildKioskArgs, choosePlacement, type Placement } from './placement';
import { RestartPolicy } from './restart-policy';
import type { ScreenInfo } from './screens';
import type { KioskSettings } from './settings';

export interface ExitInfo {
  code: number | null;
  /** Set when the process could not be started at all (ENOENT, EACCES). */
  error?: string;
}

export interface KioskProcess {
  readonly pid: number | undefined;
  kill(): void;
  /** Called once, when the process ends (or never started). */
  onExit(callback: (info: ExitInfo) => void): void;
}

export interface KioskDeps {
  clock: Clock;
  scheduler: Scheduler;
  spawn(command: string, args: string[]): KioskProcess;
  detect(override: string | undefined): Promise<DetectedBrowser | null>;
  screens(): ScreenInfo[] | null;
  port(): number;
  profileDir: string;
  log(message: string): void;
}

export type KioskState =
  | 'disabled'
  | 'stopped'
  | 'running'
  | 'restarting'
  | 'waiting_for_screens'
  | 'screen_missing'
  | 'browser_not_found'
  | 'spawn_failed'
  | 'suspended'
  | 'handed_off';

export interface KioskStatus {
  state: KioskState;
  enabled: boolean;
  pid: number | null;
  restarts: number;
  browser: string | null;
  screen: string | null;
}

/**
 * Keeps the presenter window open on the right monitor, and gets out of the way when it should. It never opens the
 * window on a monitor other than the one configured (screen_missing / waiting_for_screens instead), restarts a
 * closed or crashed browser with growing delays, and stops for good after too many restarts (suspended) until the
 * operator presses Start.
 */
export class KioskController {
  private state: KioskState = 'stopped';
  private process: KioskProcess | null = null;
  private startedAt = 0;
  private placement: Extract<Placement, { ok: true }> | null = null;
  private browser: DetectedBrowser | null = null;
  private cancelTimer: (() => void) | null = null;
  private generation = 0;
  private disposed = false;
  private readonly policy: RestartPolicy;

  constructor(
    private readonly deps: KioskDeps,
    private settings: KioskSettings,
    policy?: RestartPolicy,
  ) {
    this.policy = policy ?? new RestartPolicy();
    if (!settings.enabled) this.state = 'disabled';
  }

  status(): KioskStatus {
    return {
      state: this.state,
      enabled: this.settings.enabled,
      pid: this.process?.pid ?? null,
      restarts: this.policy.restarts,
      browser: this.browser?.path ?? null,
      screen: this.placement?.screen ?? null,
    };
  }

  /** Boot, or the operator's Start: a fresh start with a clean restart history. */
  async start(): Promise<void> {
    this.policy.reset();
    await this.launch();
  }

  /** The operator's Stop: kills the browser and stays stopped. */
  stop(): void {
    this.teardown();
    this.state = this.settings.enabled ? 'stopped' : 'disabled';
  }

  async restart(): Promise<void> {
    this.teardown();
    await this.start();
  }

  async applySettings(settings: KioskSettings): Promise<void> {
    this.settings = settings;
    if (!settings.enabled) {
      this.teardown();
      this.state = 'disabled';
      return;
    }
    await this.restart();
  }

  /** The monitor list changed: retry what was waiting for it, and follow a monitor that moved. */
  onScreensChanged(): void {
    if (this.disposed || !this.settings.enabled) return;
    if (this.state === 'waiting_for_screens' || this.state === 'screen_missing') {
      void this.launch();
      return;
    }
    if (this.state === 'running' && this.placement !== null) {
      const next = choosePlacement(this.settings.screen, this.deps.screens());
      if (next.ok && (next.x !== this.placement.x || next.y !== this.placement.y || next.width !== this.placement.width || next.height !== this.placement.height)) {
        this.deps.log('the kiosk monitor moved: reopening the presenter there');
        void this.restart();
      }
    }
  }

  /** Application shutdown: close the browser we opened and never restart it. */
  dispose(): void {
    this.disposed = true;
    this.teardown();
  }

  private teardown(): void {
    this.generation++;
    this.cancelTimer?.();
    this.cancelTimer = null;
    const proc = this.process;
    this.process = null;
    if (proc !== null) {
      try {
        proc.kill();
      } catch {
        // already gone
      }
    }
  }

  private async launch(): Promise<void> {
    if (this.disposed) return;
    const generation = ++this.generation;
    this.cancelTimer?.();
    this.cancelTimer = null;
    if (!this.settings.enabled) {
      this.state = 'disabled';
      return;
    }
    const browser = await this.deps.detect(this.settings.browserPath);
    if (generation !== this.generation || this.disposed) return; // superseded while detecting
    this.browser = browser;
    if (browser === null) {
      this.state = 'browser_not_found';
      this.deps.log('no Chromium-family browser found for the kiosk');
      return;
    }
    const placement = choosePlacement(this.settings.screen, this.deps.screens());
    if (!placement.ok) {
      this.state = placement.reason;
      this.placement = null;
      this.deps.log(`kiosk not started: ${placement.reason}`);
      return;
    }
    this.placement = placement;
    const url = `http://127.0.0.1:${this.deps.port()}/presenter`;
    const args = buildKioskArgs({ url, profileDir: this.deps.profileDir, placement });
    let proc: KioskProcess;
    try {
      proc = this.deps.spawn(browser.path, args);
    } catch (err) {
      this.state = 'spawn_failed';
      this.deps.log(`could not start the kiosk browser: ${err instanceof Error ? err.message : String(err)}`);
      return;
    }
    this.process = proc;
    this.startedAt = this.deps.clock.now();
    this.state = 'running';
    proc.onExit((info) => this.onExit(proc, generation, info));
  }

  private onExit(proc: KioskProcess, generation: number, info: { code: number | null; error?: string }): void {
    if (proc !== this.process || generation !== this.generation || this.disposed) return; // we closed it ourselves
    this.process = null;
    if (info.error !== undefined) {
      this.state = 'spawn_failed';
      this.deps.log(`could not start the kiosk browser: ${info.error}`);
      return;
    }
    const now = this.deps.clock.now();
    const decision = this.policy.onExit(now, { livedMs: now - this.startedAt, code: info.code });
    if (decision.action === 'handoff') {
      this.state = 'handed_off';
      this.deps.log('the kiosk browser handed its window to an instance that was already running');
      return;
    }
    if (decision.action === 'suspend') {
      this.state = 'suspended';
      this.deps.log(`the kiosk browser closed ${decision.restarts} times in a row: not reopening it (press Start to try again)`);
      return;
    }
    if (!this.settings.restart) {
      this.state = 'stopped';
      return;
    }
    this.state = 'restarting';
    const at = now + decision.delayMs;
    this.cancelTimer = this.deps.scheduler.setTimer(at, () => {
      this.cancelTimer = null;
      void this.launch();
    });
  }
}
```

`server/src/kiosk/node-kiosk.ts`
```ts
// SPDX-License-Identifier: GPL-2.0-or-later
import { execFile, spawn } from 'node:child_process';
import { constants } from 'node:fs';
import { access, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { delimiter, join } from 'node:path';
import { promisify } from 'node:util';
import type { ExitInfo, KioskProcess } from './controller';
import type { DetectDeps } from './detect';

const execFileAsync = promisify(execFile);

/** Starts the browser. A failure to start (ENOENT, EACCES) arrives through onExit with `error` set. */
export function nodeSpawn(command: string, args: string[]): KioskProcess {
  const child = spawn(command, args, { stdio: 'ignore' });
  let callback: ((info: ExitInfo) => void) | null = null;
  let early: ExitInfo | null = null;
  let finished = false;
  const finish = (info: ExitInfo): void => {
    if (finished) return;
    finished = true;
    if (callback !== null) callback(info);
    else early = info;
  };
  child.once('error', (err) => finish({ code: null, error: err.message }));
  child.once('exit', (code) => finish({ code }));
  return {
    get pid() {
      return child.pid;
    },
    kill() {
      child.kill();
    },
    onExit(cb) {
      callback = cb;
      if (early !== null) {
        const info = early;
        early = null;
        cb(info);
      }
    },
  };
}

/**
 * The default value of a `reg query ... /ve` answer. The label before REG_SZ is localised ("(Default)",
 * "(Predefinito)"), so only REG_SZ / REG_EXPAND_SZ is used as the anchor.
 */
export function parseRegQuery(stdout: string): string | null {
  for (const line of stdout.split(/\r?\n/)) {
    const match = /REG_(?:EXPAND_)?SZ\s+(.+?)\s*$/.exec(line);
    if (match !== null) return match[1]!;
  }
  return null;
}

async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

/** Detection dependencies backed by the real machine. */
export function nodeDetectDeps(platform: NodeJS.Platform = process.platform, env: NodeJS.ProcessEnv = process.env): DetectDeps {
  return {
    platform,
    env,
    home: homedir(),
    exists: isFile,
    async which(name) {
      for (const dir of (env.PATH ?? '').split(delimiter)) {
        if (dir === '') continue;
        const candidate = join(dir, name);
        try {
          await access(candidate, constants.X_OK);
          if (await isFile(candidate)) return candidate;
        } catch {
          // not here
        }
      }
      return null;
    },
    async appPath(exe) {
      if (platform !== 'win32') return null;
      for (const hive of ['HKLM', 'HKCU']) {
        const key = `${hive}\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\${exe}`;
        try {
          const { stdout } = await execFileAsync('reg', ['query', key, '/ve'], { windowsHide: true, encoding: 'utf8' });
          const value = parseRegQuery(stdout);
          if (value !== null) return value;
        } catch {
          // key not in this hive
        }
      }
      return null;
    },
  };
}
```


- [ ] **Step 4: Run, confirm pass** — `pnpm vitest run server/test/kiosk && pnpm typecheck`.

- [ ] **Step 5: Commit**

```
git add server/src/kiosk server/test/kiosk
git commit -m "feat(server): kiosk controller with supervision limits, browser detection, node spawn adapters"
```

---

### Task 8: Server — internal routes, system routes, runtime.json, wiring

**Files:**
- Create: `server/src/api/system.ts`, `server/src/app/runtime-file.ts`, `server/test/api/internal-plugin.test.ts`, `server/test/api/system.test.ts`, `server/test/app/runtime-file.test.ts`
- Modify: `server/src/api/internal.ts`, `server/src/app/server.ts`, `server/src/app/main.ts`, `server/test/api/internal.test.ts`

**Interfaces:**
- Consumes: Tasks 2 and 7. Produces: `POST /api/internal/hotkey` (200 `HotkeyResult`), `POST /api/internal/screens` (204), the existing credentials route unchanged; public `GET /api/hotkeys/pending`, `GET /api/screens`, `GET /api/settings`, `PUT /api/settings` (`{kiosk}` only, strict), `GET /api/kiosk`, `POST /api/kiosk/{start,stop,restart}`; `writeRuntimeFile`, `removeRuntimeFile`; `BuiltServer.{kiosk, hotkeys, screens}`; `ServerOptions.{settings, kioskDeps}`.
- `runtime.json` is now `{port, pid, instanceId, version, protocol}` (the first three are read by the single-instance check and by the plugin) and is removed on a clean shutdown only when it still names this instance.
- `buildServer` creates but does not start the kiosk; `main.ts` starts it after `listen` when `settings.kiosk.enabled`; `onClose` disposes it first.

- [ ] **Step 1: Write the failing tests**

`server/test/api/internal-plugin.test.ts`
```ts
// SPDX-License-Identifier: GPL-2.0-or-later
import { Writable } from 'node:stream';
import Fastify, { type FastifyInstance } from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import { registerInternal } from '../../src/api/internal';
import type { HotkeyResult } from '../../src/hotkeys/hotkey-service';
import type { ScreenInfo } from '../../src/kiosk/screens';

const TOKEN = 'shared-secret-token';
const AUTH = { authorization: `Bearer ${TOKEN}` };
const SCREEN: ScreenInfo = { name: 'DISPLAY2', x: 1920, y: 0, width: 1920, height: 1080, devicePixelRatio: 1, primary: false };

function setup(logger: boolean | object = false) {
  const press = vi.fn<(slot: string, source: { session?: string; seq?: number }) => HotkeyResult>(() => ({
    result: 'pending',
    slot: 'next',
    remainingMs: 1000,
  }));
  const set = vi.fn();
  const app: FastifyInstance = Fastify({ logger: logger as never });
  registerInternal(app, { token: TOKEN, obs: { setCredentials: vi.fn() }, hotkeys: { press: press as never }, screens: { set } });
  return { app, press, set };
}

describe('POST /api/internal/hotkey', () => {
  it('passes the slot, session and seq to the service and returns its answer', async () => {
    const { app, press } = setup();
    const res = await app.inject({ method: 'POST', url: '/api/internal/hotkey', headers: AUTH, payload: { slot: 'next', session: 's1', seq: 4 } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ result: 'pending', slot: 'next', remainingMs: 1000 });
    expect(press).toHaveBeenCalledWith('next', { session: 's1', seq: 4 });
  });

  it('session and seq are optional', async () => {
    const { app, press } = setup();
    await app.inject({ method: 'POST', url: '/api/internal/hotkey', headers: AUTH, payload: { slot: 'clear' } });
    expect(press).toHaveBeenCalledWith('clear', { session: undefined, seq: undefined });
  });

  it.each([
    ['an unknown slot', { slot: 'self-destruct' }],
    ['a missing slot', {}],
    ['a negative seq', { slot: 'next', seq: -1 }],
    ['a fractional seq', { slot: 'next', seq: 1.5 }],
    ['an over-long session', { slot: 'next', session: 'x'.repeat(65) }],
  ])('rejects %s with 400 and does not press anything', async (_label, payload) => {
    const { app, press } = setup();
    const res = await app.inject({ method: 'POST', url: '/api/internal/hotkey', headers: AUTH, payload });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'invalid_body' });
    expect(press).not.toHaveBeenCalled();
  });

  it('needs the bearer token (401) and refuses non-loopback callers even with it (403)', async () => {
    const { app, press } = setup();
    const noAuth = await app.inject({ method: 'POST', url: '/api/internal/hotkey', payload: { slot: 'next' } });
    expect(noAuth.statusCode).toBe(401);
    const wrong = await app.inject({ method: 'POST', url: '/api/internal/hotkey', headers: { authorization: 'Bearer nope' }, payload: { slot: 'next' } });
    expect(wrong.statusCode).toBe(401);
    const lan = await app.inject({ method: 'POST', url: '/api/internal/hotkey', headers: AUTH, payload: { slot: 'next' }, remoteAddress: '192.168.1.20' });
    expect(lan.statusCode).toBe(403);
    expect(press).not.toHaveBeenCalled();
  });
});

describe('POST /api/internal/screens', () => {
  it('stores the list the plugin reports', async () => {
    const { app, set } = setup();
    const res = await app.inject({ method: 'POST', url: '/api/internal/screens', headers: AUTH, payload: { screens: [SCREEN] } });
    expect(res.statusCode).toBe(204);
    expect(set).toHaveBeenCalledWith([SCREEN]);
  });

  it('rejects a bad list, and anything without the token or from the LAN', async () => {
    const { app, set } = setup();
    const bad = await app.inject({ method: 'POST', url: '/api/internal/screens', headers: AUTH, payload: { screens: [{ ...SCREEN, width: 0 }] } });
    expect(bad.statusCode).toBe(400);
    const noAuth = await app.inject({ method: 'POST', url: '/api/internal/screens', payload: { screens: [SCREEN] } });
    expect(noAuth.statusCode).toBe(401);
    const lan = await app.inject({ method: 'POST', url: '/api/internal/screens', headers: AUTH, payload: { screens: [SCREEN] }, remoteAddress: '10.1.1.1' });
    expect(lan.statusCode).toBe(403);
    expect(set).not.toHaveBeenCalled();
  });
});

describe('the internal routes never leak secrets', () => {
  it('writes neither the token nor a request body to the log', async () => {
    const chunks: string[] = [];
    const stream = new Writable({
      write(chunk: Buffer | string, _enc, cb) {
        chunks.push(chunk.toString());
        cb();
      },
    });
    const { app } = setup({ level: 'info', stream });
    await app.ready();
    await app.inject({ method: 'POST', url: '/api/internal/hotkey', headers: AUTH, payload: { slot: 'next', session: 'secret-session-id' } });
    await app.inject({ method: 'POST', url: '/api/internal/hotkey', headers: AUTH, payload: { slot: 'bogus', session: 'secret-session-id' } });
    await app.close();
    const log = chunks.join('');
    expect(log.length).toBeGreaterThan(0);
    expect(log).not.toContain(TOKEN);
    expect(log).not.toContain('secret-session-id');
  });
});
```

`server/test/api/system.test.ts`
```ts
// SPDX-License-Identifier: GPL-2.0-or-later
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { soloFutsalFormat } from '@olc/shared/testing';
import { FakeTime } from '../../src/clock/clock';
import { Settings } from '../../src/app/settings';
import type { ExitInfo, KioskProcess } from '../../src/kiosk/controller';
import { buildTestServer } from '../support/server';
import { tempDir } from '../support/tmp';

const apps: Array<{ close(): Promise<unknown> }> = [];
afterEach(async () => {
  while (apps.length > 0) await apps.pop()!.close();
});

class FakeBrowser implements KioskProcess {
  readonly pid = 4242;
  killed = false;
  kill(): void {
    this.killed = true;
  }
  onExit(_cb: (e: ExitInfo) => void): void {}
}

async function boot(opts: { settings?: Settings; dataDir?: string } = {}) {
  const dataDir = opts.dataDir ?? (await tempDir());
  const spawned: { command: string; args: string[]; proc: FakeBrowser }[] = [];
  const time = new FakeTime();
  const server = await buildTestServer({
    dataDir,
    clock: time,
    scheduler: time,
    settings: opts.settings,
    kioskDeps: {
      detect: async (override) => ({ kind: 'chrome', path: override ?? 'C:/chrome.exe' }),
      spawn: (command, args) => {
        const proc = new FakeBrowser();
        spawned.push({ command, args, proc });
        return proc;
      },
    },
  });
  apps.push(server.app);
  return { ...server, dataDir, spawned, time };
}

describe('GET /api/settings', () => {
  it('returns the settings without the OBS password', async () => {
    const settings = Settings.parse({ obs: { host: '10.0.0.5', port: 4455, password: 'hunter2' } });
    const { app } = await boot({ settings });
    const res = await app.inject({ method: 'GET', url: '/api/settings' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ port: 4460, lanAccess: false, obs: { host: '10.0.0.5', port: 4455, hasPassword: true } });
    expect(res.body).not.toContain('hunter2');
  });
});

describe('PUT /api/settings', () => {
  it('saves the kiosk block, keeps the rest of the file, and applies it at once', async () => {
    const dataDir = await tempDir();
    await writeFile(join(dataDir, 'settings.json'), JSON.stringify({ obs: { port: 4455, password: 'hunter2' } }));
    const settings = Settings.parse(JSON.parse(await readFile(join(dataDir, 'settings.json'), 'utf8')));
    const { app, spawned } = await boot({ dataDir, settings });
    const res = await app.inject({
      method: 'PUT',
      url: '/api/settings',
      payload: { kiosk: { enabled: true, screen: { kind: 'position', x: 1920, y: 0 } } },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().kiosk).toEqual({ enabled: true, screen: { kind: 'position', x: 1920, y: 0 }, restart: true });
    expect(res.body).not.toContain('hunter2');
    const onDisk = JSON.parse(await readFile(join(dataDir, 'settings.json'), 'utf8')) as { obs: { password: string }; kiosk: { enabled: boolean } };
    expect(onDisk.obs.password).toBe('hunter2');
    expect(onDisk.kiosk.enabled).toBe(true);
    expect(spawned).toHaveLength(1);
    expect(spawned[0]!.args).toContain('--window-position=1920,0');
  });

  it.each([
    ['unknown fields (port needs a restart and is edited in the file)', { kiosk: {}, port: 4999 }],
    ['an unknown screen kind', { kiosk: { screen: { kind: 'tv' } } }],
    ['no kiosk block', {}],
  ])('rejects %s with 400', async (_label, payload) => {
    const { app } = await boot();
    const res = await app.inject({ method: 'PUT', url: '/api/settings', payload });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'invalid_body' });
  });

  it('refuses with 409 when settings.json cannot be parsed, and leaves it alone', async () => {
    const dataDir = await tempDir();
    await writeFile(join(dataDir, 'settings.json'), '{ broken');
    const { app } = await boot({ dataDir });
    const res = await app.inject({ method: 'PUT', url: '/api/settings', payload: { kiosk: { enabled: true } } });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ error: 'settings_file_invalid' });
    expect(await readFile(join(dataDir, 'settings.json'), 'utf8')).toBe('{ broken');
  });
});

describe('kiosk routes', () => {
  it('reports the status and starts and stops the browser on request', async () => {
    const settings = Settings.parse({ kiosk: { enabled: true } });
    const { app, spawned } = await boot({ settings });
    expect((await app.inject({ method: 'GET', url: '/api/kiosk' })).json()).toMatchObject({ enabled: true, state: 'stopped' });
    const started = await app.inject({ method: 'POST', url: '/api/kiosk/start' });
    expect(started.json()).toMatchObject({ state: 'running', pid: 4242 });
    expect(spawned).toHaveLength(1);
    const stopped = await app.inject({ method: 'POST', url: '/api/kiosk/stop' });
    expect(stopped.json()).toMatchObject({ state: 'stopped' });
    expect(spawned[0]!.proc.killed).toBe(true);
    const restarted = await app.inject({ method: 'POST', url: '/api/kiosk/restart' });
    expect(restarted.json()).toMatchObject({ state: 'running' });
    expect(spawned).toHaveLength(2);
  });

  it('closes the browser when the application shuts down', async () => {
    const settings = Settings.parse({ kiosk: { enabled: true } });
    const { app, spawned } = await boot({ settings });
    await app.inject({ method: 'POST', url: '/api/kiosk/start' });
    await app.close();
    expect(spawned[0]!.proc.killed).toBe(true);
  });
});

describe('screens from the plugin reach the kiosk', () => {
  it('a named monitor waits for the list, opens when the plugin reports it, and GET /api/screens shows it', async () => {
    const settings = Settings.parse({ kiosk: { enabled: true, screen: { kind: 'name', name: 'DISPLAY2' } } });
    const { app, spawned, dataDir } = await boot({ settings });
    const token = (await readFile(join(dataDir, 'secret.token'), 'utf8')).trim();
    expect((await app.inject({ method: 'POST', url: '/api/kiosk/start' })).json()).toMatchObject({ state: 'waiting_for_screens' });
    const list = [
      { name: 'DISPLAY1', x: 0, y: 0, width: 1920, height: 1080, primary: true },
      { name: 'DISPLAY2', x: 1920, y: 0, width: 1920, height: 1080, primary: false },
    ];
    const post = await app.inject({ method: 'POST', url: '/api/internal/screens', headers: { authorization: `Bearer ${token}` }, payload: { screens: list } });
    expect(post.statusCode).toBe(204);
    await new Promise((r) => setTimeout(r, 20));
    expect(spawned).toHaveLength(1);
    expect(spawned[0]!.args).toContain('--window-position=1936,16');
    const shown = (await app.inject({ method: 'GET', url: '/api/screens' })).json() as { live: boolean; screens: unknown[] };
    expect(shown.live).toBe(true);
    expect(shown.screens).toHaveLength(2);
    expect(JSON.parse(await readFile(join(dataDir, 'screens.json'), 'utf8')).screens).toHaveLength(2);
  });

  it('the list is remembered across a restart (marked not live)', async () => {
    const dataDir = await tempDir();
    const first = await boot({ dataDir });
    const token = (await readFile(join(dataDir, 'secret.token'), 'utf8')).trim();
    await first.app.inject({
      method: 'POST',
      url: '/api/internal/screens',
      headers: { authorization: `Bearer ${token}` },
      payload: { screens: [{ name: 'DISPLAY1', x: 0, y: 0, width: 1920, height: 1080, primary: true }] },
    });
    await new Promise((r) => setTimeout(r, 50));
    await first.app.close();
    apps.pop();
    const second = await boot({ dataDir });
    expect((await second.app.inject({ method: 'GET', url: '/api/screens' })).json()).toMatchObject({ live: false, screens: [{ name: 'DISPLAY1' }] });
  });
});

describe('hotkeys end to end through the internal route', () => {
  async function liveServer() {
    const boot1 = await boot();
    await boot1.app.inject({ method: 'POST', url: '/api/formats', payload: soloFutsalFormat() });
    await boot1.app.inject({
      method: 'POST',
      url: '/api/formats/solo-futsal/episodes',
      payload: { id: 'ep-1', date: '2026-10-12', plannedStart: null, playlistName: null },
    });
    await boot1.app.inject({ method: 'POST', url: '/api/live/load', payload: { episodeId: 'ep-1' } });
    const token = (await readFile(join(boot1.dataDir, 'secret.token'), 'utf8')).trim();
    const press = (slot: string, seq?: number) =>
      boot1.app.inject({
        method: 'POST',
        url: '/api/internal/hotkey',
        headers: { authorization: `Bearer ${token}` },
        payload: { slot, session: 'run-1', ...(seq === undefined ? {} : { seq }) },
      });
    return { ...boot1, press };
  }

  it('message slot 1 sends the first preset message of the loaded episode', async () => {
    const { press, runtime } = await liveServer();
    const first = runtime.getState()!.episode.messages[0]!;
    const res = await press('message-1');
    expect(res.json()).toMatchObject({ result: 'executed', slot: 'message-1' });
    expect(runtime.presenterView()!.message).toMatchObject({ text: first.text });
  });

  it('an emergency slot needs the second press, and the pending confirmation is visible to the dock', async () => {
    const { app, press, time } = await liveServer();
    expect((await press('control-toggle')).json()).toMatchObject({ result: 'pending' });
    expect((await app.inject({ method: 'GET', url: '/api/hotkeys/pending' })).json()).toMatchObject({ pending: { slot: 'control-toggle' } });
    time.mono += 300;
    expect((await press('control-toggle')).json()).toMatchObject({ result: 'executed', slot: 'control-toggle' });
    expect((await app.inject({ method: 'GET', url: '/api/hotkeys/pending' })).json()).toEqual({ pending: null });
  });

  it('a press with no episode loaded is ignored, not an error', async () => {
    const { app, dataDir } = await boot();
    const token = (await readFile(join(dataDir, 'secret.token'), 'utf8')).trim();
    const res = await app.inject({ method: 'POST', url: '/api/internal/hotkey', headers: { authorization: `Bearer ${token}` }, payload: { slot: 'next' } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ result: 'ignored', reason: 'no_episode' });
  });
});
```

`server/test/app/runtime-file.test.ts`
```ts
// SPDX-License-Identifier: GPL-2.0-or-later
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { removeRuntimeFile, writeRuntimeFile, type RuntimeInfo } from '../../src/app/runtime-file';
import { tempDir } from '../support/tmp';

const info: RuntimeInfo = { port: 4460, pid: 1234, instanceId: 'inst-1', version: '0.1.0', protocol: 1 };

describe('runtime.json', () => {
  it('holds port, pid and instanceId (read by the single-instance check and by the plugin) plus version and protocol', async () => {
    const path = join(await tempDir(), 'runtime.json');
    await writeRuntimeFile(path, info);
    expect(JSON.parse(await readFile(path, 'utf8'))).toEqual(info);
  });

  it('is removed on a clean shutdown, but only when it still names this instance', async () => {
    const dir = await tempDir();
    const path = join(dir, 'runtime.json');
    await writeRuntimeFile(path, info);
    await removeRuntimeFile(path, 'someone-else');
    expect(JSON.parse(await readFile(path, 'utf8')).instanceId).toBe('inst-1');
    await removeRuntimeFile(path, 'inst-1');
    await expect(readFile(path, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('removing a missing or unreadable file is not an error', async () => {
    const dir = await tempDir();
    await removeRuntimeFile(join(dir, 'missing.json'), 'x');
    await writeFile(join(dir, 'broken.json'), '{ nope');
    await removeRuntimeFile(join(dir, 'broken.json'), 'x');
    expect(await readFile(join(dir, 'broken.json'), 'utf8')).toBe('{ nope');
  });
});
```

Changes to `server/test/api/internal.test.ts`:
```diff
--- a/server/test/api/internal.test.ts
+++ b/server/test/api/internal.test.ts
@@ -18,5 +18,10 @@ function newObs(): { obs: Obs; setCredentials: ReturnType<typeof vi.fn> } {
 function makeApp(obs: Obs, logger: boolean | object = false): FastifyInstance {
   const app = Fastify({ logger: logger as never });
-  registerInternal(app, { token: TOKEN, obs });
+  registerInternal(app, {
+    token: TOKEN,
+    obs,
+    hotkeys: { press: vi.fn(() => ({ result: 'ignored', slot: 'clear', reason: 'no_episode' }) as const) },
+    screens: { set: vi.fn() },
+  });
   return app;
 }
```


- [ ] **Step 2: Run, confirm failure** — `pnpm vitest run server/test/api server/test/app` -> FAIL.

- [ ] **Step 3: Implement**

`server/src/api/internal.ts`
```ts
// SPDX-License-Identifier: GPL-2.0-or-later
import { timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { HotkeyService } from '../hotkeys/hotkey-service';
import { HotkeyBody } from '../hotkeys/slots';
import { ScreensBody, type ScreenRegistry } from '../kiosk/screens';
import type { ObsService } from '../obs/obs-service';

export interface InternalContext {
  token: string;
  obs: Pick<ObsService, 'setCredentials'>;
  hotkeys: Pick<HotkeyService, 'press'>;
  screens: Pick<ScreenRegistry, 'set'>;
}

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

/** The plugin only ever talks to us over loopback (DT-5); anything else is refused before auth. */
function isLoopback(address: string | undefined): boolean {
  return address !== undefined && LOOPBACK.has(address);
}

const CredentialsBody = z.object({
  host: z.string().min(1).default('127.0.0.1'),
  port: z.number().int().min(1).max(65_535),
  password: z.string().optional(),
});

/** Constant-time bearer check; a length mismatch rejects before `timingSafeEqual` (which requires equal lengths). */
function tokenMatches(header: string | undefined, token: string): boolean {
  const prefix = 'Bearer ';
  if (header === undefined || !header.startsWith(prefix)) return false;
  const provided = Buffer.from(header.slice(prefix.length), 'utf8');
  const expected = Buffer.from(token, 'utf8');
  if (provided.length !== expected.length) return false;
  return timingSafeEqual(provided, expected);
}

/** Loopback first (403), then the bearer token (401). Sends the error itself; true = go on. */
function authorize(req: FastifyRequest, reply: FastifyReply, token: string): boolean {
  if (!isLoopback(req.socket.remoteAddress)) {
    void reply.code(403).send({ error: 'forbidden' });
    return false;
  }
  if (!tokenMatches(req.headers.authorization, token)) {
    void reply.code(401).send({ error: 'unauthorized' });
    return false;
  }
  return true;
}

/**
 * The plugin's door (DT-3, DT-5, DT-9). Every route is loopback-only and bearer-protected, and none of them ever
 * echoes a request body in a response or an error (the zod issues are deliberately dropped: the credentials body
 * carries the OBS password).
 *   POST /api/internal/obs-credentials  host/port/password of obs-websocket          -> 204
 *   POST /api/internal/hotkey           { slot, session?, seq? }                      -> 200 HotkeyResult
 *   POST /api/internal/screens          { screens: [...] }                            -> 204
 */
export function registerInternal(app: FastifyInstance, ctx: InternalContext): void {
  app.post('/api/internal/obs-credentials', async (req, reply) => {
    if (!authorize(req, reply, ctx.token)) return reply;
    const parsed = CredentialsBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_body' });
    ctx.obs.setCredentials(parsed.data);
    return reply.code(204).send();
  });

  app.post('/api/internal/hotkey', async (req, reply) => {
    if (!authorize(req, reply, ctx.token)) return reply;
    const parsed = HotkeyBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_body' });
    const { slot, session, seq } = parsed.data;
    return reply.code(200).send(ctx.hotkeys.press(slot, { session, seq }));
  });

  app.post('/api/internal/screens', async (req, reply) => {
    if (!authorize(req, reply, ctx.token)) return reply;
    const parsed = ScreensBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_body' });
    ctx.screens.set(parsed.data.screens);
    return reply.code(204).send();
  });
}
```

`server/src/api/system.ts`
```ts
// SPDX-License-Identifier: GPL-2.0-or-later
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { SettingsFileInvalidError, publicSettings, type SettingsHolder } from '../app/settings';
import type { HotkeyService } from '../hotkeys/hotkey-service';
import type { KioskController } from '../kiosk/controller';
import type { ScreenRegistry } from '../kiosk/screens';
import { KioskSettings } from '../kiosk/settings';

export interface SystemContext {
  settings: Pick<SettingsHolder, 'get' | 'setKiosk'>;
  hotkeys: Pick<HotkeyService, 'pending'>;
  screens: Pick<ScreenRegistry, 'get'>;
  kiosk: Pick<KioskController, 'status' | 'start' | 'stop' | 'restart' | 'applySettings'>;
}

/** Only the kiosk block can be changed from the app; port and LAN access need a restart and live in the file. */
const PutSettingsBody = z.strictObject({ kiosk: KioskSettings });

/**
 * The operator-facing side of the plugin/kiosk work (public like the other /api routes: localhost by default).
 * Nothing here returns the OBS password or the bearer token.
 */
export function registerSystem(app: FastifyInstance, ctx: SystemContext): void {
  // The dock polls this to show "press again to confirm" after a first press of an emergency hotkey (DT-9).
  app.get('/api/hotkeys/pending', async () => ({ pending: ctx.hotkeys.pending() }));

  app.get('/api/screens', async () => ctx.screens.get());

  app.get('/api/settings', async () => publicSettings(ctx.settings.get()));

  app.put('/api/settings', async (req, reply) => {
    const parsed = PutSettingsBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_body' });
    try {
      const next = await ctx.settings.setKiosk(parsed.data.kiosk);
      await ctx.kiosk.applySettings(next.kiosk);
      return publicSettings(next);
    } catch (err) {
      if (err instanceof SettingsFileInvalidError) return reply.code(409).send({ error: 'settings_file_invalid' });
      throw err;
    }
  });

  app.get('/api/kiosk', async () => ctx.kiosk.status());
  app.post('/api/kiosk/start', async () => {
    await ctx.kiosk.start();
    return ctx.kiosk.status();
  });
  app.post('/api/kiosk/stop', async () => {
    ctx.kiosk.stop();
    return ctx.kiosk.status();
  });
  app.post('/api/kiosk/restart', async () => {
    await ctx.kiosk.restart();
    return ctx.kiosk.status();
  });
}
```

`server/src/app/runtime-file.ts`
```ts
// SPDX-License-Identifier: GPL-2.0-or-later
import { readFile, rm } from 'node:fs/promises';
import { writeJsonAtomic } from '../persistence/json-file';

/**
 * runtime.json: how the OBS plugin finds a running app (TECH-DESIGN R7). A HINT, never the truth: the plugin
 * confirms it with GET /api/health, and a file left behind by a crash is harmless (nothing answers, the plugin
 * launches the app, the new instance rewrites the file). `port`, `pid` and `instanceId` are read by the
 * single-instance check (instance-lock.ts) and by plugin/core/Paths.cpp: do not rename them.
 */
export interface RuntimeInfo {
  port: number;
  pid: number;
  instanceId: string;
  version: string;
  protocol: number;
}

export function writeRuntimeFile(path: string, info: RuntimeInfo): Promise<void> {
  return writeJsonAtomic(path, info);
}

/** Removes the file on a clean shutdown, but only if it still names THIS instance (never another one's). */
export async function removeRuntimeFile(path: string, instanceId: string): Promise<void> {
  try {
    const current = JSON.parse(await readFile(path, 'utf8')) as { instanceId?: unknown };
    if (current.instanceId !== instanceId) return;
    await rm(path, { force: true });
  } catch {
    // missing or unreadable: nothing to remove
  }
}
```

Changes to `server/src/app/server.ts`:
```diff
--- a/server/src/app/server.ts
+++ b/server/src/app/server.ts
@@ -10,10 +10,17 @@ import { registerInternal } from '../api/internal';
 import { registerObsRoutes } from '../api/obs';
 import { registerStatic } from '../api/static';
+import { registerSystem } from '../api/system';
 import { registerWs } from '../api/ws';
 import { systemClock, systemScheduler, type Clock, type Scheduler } from '../clock/clock';
+import { HotkeyService } from '../hotkeys/hotkey-service';
+import { KioskController, type KioskDeps } from '../kiosk/controller';
+import { detectBrowser } from '../kiosk/detect';
+import { nodeDetectDeps, nodeSpawn } from '../kiosk/node-kiosk';
+import { ScreenRegistry, ScreensBody } from '../kiosk/screens';
 import { createObsClient, type ObsClient } from '../obs/client';
 import type { ObsCredentials } from '../obs/connection';
 import { ObsService } from '../obs/obs-service';
 import { LiveJournal } from '../persistence/journal';
+import { readJson, writeJsonAtomic } from '../persistence/json-file';
 import { DocumentRepository, type InvalidDocument } from '../persistence/repository';
 import { SnapshotStore } from '../persistence/snapshot-store';
@@ -21,4 +28,5 @@ import { LiveRuntime } from '../runtime/live-runtime';
 import { dataPaths } from './paths';
 import { ensureSecretToken } from './secret';
+import { Settings, SettingsHolder } from './settings';
 import { APP_VERSION } from './version';
 
@@ -46,4 +54,8 @@ export interface ServerOptions {
   /** Built web app directory; null (default) answers 503 on the pages. */
   webRoot?: string | null;
+  /** The settings the app runs with (main.ts loads them from settings.json). Defaults to all-defaults. */
+  settings?: Settings;
+  /** Test seam: replaces how the kiosk browser is detected and started. The defaults are the real ones. */
+  kioskDeps?: Partial<Pick<KioskDeps, 'spawn' | 'detect'>>;
 }
 
@@ -52,4 +64,8 @@ export interface BuiltServer {
   runtime: LiveRuntime;
   instanceId: string;
+  /** Not started by buildServer: main.ts starts it once the app is listening, when settings.kiosk.enabled. */
+  kiosk: KioskController;
+  hotkeys: HotkeyService;
+  screens: ScreenRegistry;
 }
 
@@ -102,4 +118,35 @@ export async function buildServer(opts: ServerOptions): Promise<BuiltServer> {
 
   const instanceId = randomUUID();
+
+  // Plugin and kiosk (Plan 6): hotkeys with their confirmation rule, the monitor list, the kiosk browser.
+  const settings = opts.settings ?? Settings.parse({});
+  const settingsHolder = new SettingsHolder(paths.settings, settings);
+  const hotkeys = new HotkeyService({ runtime, clock });
+  const screens = new ScreenRegistry(
+    {
+      load: async () => (await readJson(paths.screens, ScreensBody))?.screens ?? [],
+      save: (list) => writeJsonAtomic(paths.screens, { screens: list }),
+    },
+    (err) => app.log.warn({ error: err instanceof Error ? err.message : String(err) }, 'Screen list file problem'),
+  );
+  await screens.init();
+  const detectDeps = nodeDetectDeps();
+  const kiosk = new KioskController(
+    {
+      clock,
+      scheduler,
+      spawn: opts.kioskDeps?.spawn ?? nodeSpawn,
+      detect: opts.kioskDeps?.detect ?? ((override) => detectBrowser(detectDeps, override)),
+      screens: () => {
+        const known = screens.get().screens;
+        return known.length > 0 ? known : null;
+      },
+      port: () => settings.port,
+      profileDir: paths.kioskProfile,
+      log: (message) => app.log.info(message),
+    },
+    settings.kiosk,
+  );
+  screens.onChange(() => kiosk.onScreensChanged());
   // Close live sockets with 1001 "going away" on shutdown (the plugin's default sends no code → clients see 1005).
   await app.register(websocket, {
@@ -124,9 +171,11 @@ export async function buildServer(opts: ServerOptions): Promise<BuiltServer> {
     instanceId,
   });
-  registerInternal(app, { token: secret.token, obs });
+  registerInternal(app, { token: secret.token, obs, hotkeys, screens });
+  registerSystem(app, { settings: settingsHolder, hotkeys, screens, kiosk });
   registerObsRoutes(app, { obs, episodes, clock, scheduler });
   registerWs(app, { runtime, clock, version, instanceId, heartbeatMs: opts.heartbeatMs ?? 1_000 });
   registerStatic(app, { root: opts.webRoot ?? null });
   app.addHook('onClose', async () => {
+    kiosk.dispose(); // close the browser we opened, before anything else can delay it
     try {
       await withTimeout(obs.stop(), OBS_STOP_TIMEOUT_MS, clock, scheduler);
@@ -137,5 +186,5 @@ export async function buildServer(opts: ServerOptions): Promise<BuiltServer> {
     }
   });
-  return { app, runtime, instanceId };
+  return { app, runtime, instanceId, kiosk, hotkeys, screens };
 }
```

Changes to `server/src/app/main.ts`:
```diff
--- a/server/src/app/main.ts
+++ b/server/src/app/main.ts
@@ -1,9 +1,11 @@
 // SPDX-License-Identifier: GPL-2.0-or-later
 import { mkdir } from 'node:fs/promises';
-import { writeJsonAtomic } from '../persistence/json-file';
+import { PROTOCOL_VERSION } from '@olc/shared';
 import { acquireLock, olcInstanceAlive } from './instance-lock';
 import { dataPaths, defaultDataDir, defaultWebRoot } from './paths';
+import { removeRuntimeFile, writeRuntimeFile } from './runtime-file';
 import { buildServer } from './server';
 import { listenHost, loadSettings } from './settings';
+import { APP_VERSION } from './version';
 
 async function main(): Promise<void> {
@@ -18,5 +20,5 @@ async function main(): Promise<void> {
       ),
     );
-    const { app, instanceId } = await buildServer({
+    const { app, instanceId, kiosk } = await buildServer({
       dataDir: paths.root,
       logger: true,
@@ -24,7 +26,17 @@ async function main(): Promise<void> {
       obsCredentials: settings.obs,
       webRoot: defaultWebRoot(),
+      settings,
     });
     await app.listen({ port: settings.port, host: listenHost(settings) });
-    await writeJsonAtomic(paths.runtime, { port: settings.port, pid: process.pid, instanceId });
+    await writeRuntimeFile(paths.runtime, {
+      port: settings.port,
+      pid: process.pid,
+      instanceId,
+      version: APP_VERSION,
+      protocol: PROTOCOL_VERSION,
+    });
+    if (settings.kiosk.enabled) {
+      kiosk.start().catch((err: unknown) => app.log.error({ error: err instanceof Error ? err.message : String(err) }, 'Kiosk start failed'));
+    }
 
     const shutdown = async (): Promise<void> => {
@@ -32,4 +44,5 @@ async function main(): Promise<void> {
         await app.close();
       } finally {
+        await removeRuntimeFile(paths.runtime, instanceId);
         await release();
       }
```


- [ ] **Step 4: Run everything**

`pnpm test && pnpm typecheck && pnpm build`. Expected: all green (the whole suite was 946 tests; with Plan 6's server and web additions it was 1081 passed, 4 skipped, in the reference run).

- [ ] **Step 5: Commit**

```
git add server
git commit -m "feat(server): internal hotkey and screens routes, settings and kiosk routes, runtime.json with version, kiosk wiring"
```

---

### Task 9: Plugin module bootstrap — libcurl client, browser-panel shim, build scripts

**Files:**
- Create: `plugin/net/CurlHttp.hpp`, `plugin/net/CurlHttp.cpp`, `plugin/src/CMakeLists.txt`, `plugin/src/BrowserPanel.hpp`, `plugin/src/BrowserPanel.cpp`, `plugin/src/plugin-main.cpp`, `plugin/scripts/setup-obs-dev.sh`, `plugin/scripts/build-plugin.sh`, `plugin/ci/check_browser_panel_abi.py`, `plugin/ci/test_check_browser_panel_abi.py`

**Interfaces:**
- Produces: `olc::CurlHttp : IHttpClient` (one easy handle per call, `CURLOPT_NOSIGNAL`, `NOPROXY` for loopback, 1 MiB body cap, error text from `curl_easy_strerror` only); `olc::panel::QCef`, `QCefWidget`, `createQCef()`, `createBrowserWidget(parent, url)`; the CMake target `obs-live-clock` (MODULE) with `OLC_EXPECTED_QT` Qt guard and the install layout (Windows `obs-live-clock/` and `obs-live-clock/bin/64bit/`; Linux per-user `~/.local/share/obs-studio/plugins/...` and `~/.config/...`; macOS `obs-plugins/`); a bootstrap `plugin-main.cpp` that only loads (replaced in Task 15).

- [ ] **Step 1: Write the ABI check test first**

`plugin/ci/test_check_browser_panel_abi.py`
```python
#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-2.0-or-later
"""Unit tests for check_browser_panel_abi.py, on the shapes the real header and our shim have."""
from __future__ import annotations

import unittest

import check_browser_panel_abi as abi

UPSTREAM = """
struct QCefCookieManager { virtual ~QCefCookieManager() {} virtual bool DeleteCookies(const std::string &url) = 0; };
class QCefWidget : public QWidget {
	Q_OBJECT
protected:
	inline QCefWidget(QWidget *parent) : QWidget(parent) {}
public:
	virtual void setURL(const std::string &url) = 0;
	virtual void setStartupScript(const std::string &script) = 0;
	virtual void allowAllPopups(bool allow) = 0;
	virtual void closeBrowser() = 0;
	virtual void reloadPage() = 0;
	virtual bool zoomPage(int direction) = 0;
	virtual void executeJavaScript(const std::string &script) = 0;
signals:
	void titleChanged(const QString &title);
};
struct QCef {
	virtual ~QCef() {}
	virtual bool init_browser(void) = 0;
	virtual bool initialized(void) = 0;
	virtual bool wait_for_browser_init(void) = 0;
	virtual QCefWidget *create_widget(QWidget *parent, const std::string &url,
					  QCefCookieManager *cookie_manager = nullptr) = 0;
	virtual QCefCookieManager *create_cookie_manager(const std::string &storage_path,
							 bool persist_session_cookies = false) = 0;
	virtual BPtr<char> get_cookie_path(const std::string &storage_path) = 0;
	virtual void add_popup_whitelist_url(const std::string &url, QObject *obj) = 0;
	virtual void add_force_popup_url(const std::string &url, QObject *obj) = 0;
};
"""

OURS = """
class QCefWidget : public QWidget {
public:
    virtual void setURL(const std::string& url) = 0;
    virtual void setStartupScript(const std::string& script) = 0;
    virtual void allowAllPopups(bool allow) = 0;
    virtual void closeBrowser() = 0;
    virtual void reloadPage() = 0;
    virtual bool zoomPage(int direction) = 0;
    virtual void executeJavaScript(const std::string& script) = 0;
};
struct QCef {
    virtual ~QCef() {}
    virtual bool init_browser() = 0;
    virtual bool initialized() = 0;
    virtual bool wait_for_browser_init() = 0;
    virtual QCefWidget* create_widget(QWidget* parent, const std::string& url, QCefCookieManager* cookieManager = nullptr) = 0;
    virtual QCefCookieManager* create_cookie_manager(const std::string& storagePath, bool persistSessionCookies = false) = 0;
    virtual void* get_cookie_path_never_called(const std::string& storagePath) = 0;  // BPtr<char> upstream
    virtual void add_popup_whitelist_url(const std::string& url, QObject* obj) = 0;
    virtual void add_force_popup_url(const std::string& url, QObject* obj) = 0;
};
"""


class VirtualMethods(unittest.TestCase):
    def test_reads_names_in_order_and_ignores_signals_and_comments(self):
        self.assertEqual(abi.virtual_methods(UPSTREAM, "QCefWidget"),
                         ["setURL", "setStartupScript", "allowAllPopups", "closeBrowser", "reloadPage",
                          "zoomPage", "executeJavaScript"])
        self.assertEqual(abi.virtual_methods(UPSTREAM, "QCef")[:4],
                         ["~QCef", "init_browser", "initialized", "wait_for_browser_init"])

    def test_handles_multi_line_declarations_and_return_types_with_templates(self):
        self.assertIn("get_cookie_path", abi.virtual_methods(UPSTREAM, "QCef"))
        self.assertIn("create_cookie_manager", abi.virtual_methods(UPSTREAM, "QCef"))

    def test_a_missing_class_is_an_error(self):
        with self.assertRaises(abi.AbiError):
            abi.virtual_methods("struct Other {};", "QCef")


class Compare(unittest.TestCase):
    def test_our_shim_matches_upstream(self):
        self.assertEqual(abi.compare(OURS, UPSTREAM), [])

    def test_a_reordered_function_is_reported(self):
        swapped = OURS.replace("virtual void closeBrowser() = 0;\n    virtual void reloadPage() = 0;",
                               "virtual void reloadPage() = 0;\n    virtual void closeBrowser() = 0;")
        self.assertEqual(len(abi.compare(swapped, UPSTREAM)), 1)

    def test_an_added_function_is_reported(self):
        added = OURS.replace("virtual bool initialized() = 0;", "virtual bool initialized() = 0;\n    virtual void extra() = 0;")
        self.assertEqual(len(abi.compare(added, UPSTREAM)), 1)

    def test_a_new_upstream_function_is_reported(self):
        newer = UPSTREAM.replace("virtual void executeJavaScript(const std::string &script) = 0;",
                                 "virtual void executeJavaScript(const std::string &script) = 0;\n\tvirtual void brandNew() = 0;")
        self.assertEqual(len(abi.compare(OURS, newer)), 1)


if __name__ == "__main__":
    unittest.main()
```


`python -I -m unittest discover -s plugin/ci -p "test_check*.py"` -> FAIL (module missing).

- [ ] **Step 2: Implement the ABI check, then the net library, shim and module**

`plugin/ci/check_browser_panel_abi.py`
```python
#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-2.0-or-later
"""Fail when plugin/src/BrowserPanel.hpp no longer matches obs-browser's panel ABI.

The plugin hosts its dock page through obs-browser's QCef / QCefWidget virtual-function tables. The ABI is the
ORDER of those functions, so our own declarations (written, not copied: upstream is GPL-2.0-only) must list the same
names in the same order. This script reads upstream's panel/browser-panel.hpp and compares.

Usage: python3 check_browser_panel_abi.py --local plugin/src/BrowserPanel.hpp [--upstream-file FILE | --obs-tag 32.2.2]
With --obs-tag it resolves the obs-browser commit that OBS tag pins (a submodule) and downloads that header.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
import urllib.request

UPSTREAM_RAW = "https://raw.githubusercontent.com/obsproject/obs-browser/{sha}/panel/browser-panel.hpp"
SUBMODULE_API = "https://api.github.com/repos/obsproject/obs-studio/contents/plugins/obs-browser?ref={tag}"


class AbiError(Exception):
    pass


def class_body(text: str, name: str) -> str:
    """Text between the braces of `class NAME ... {` or `struct NAME ... {` (first definition)."""
    match = re.search(r"\b(?:class|struct)\s+" + re.escape(name) + r"\b[^;{]*\{", text)
    if not match:
        raise AbiError(f"no definition of {name} found")
    depth, i = 1, match.end()
    while i < len(text) and depth:
        depth += {"{": 1, "}": -1}.get(text[i], 0)
        i += 1
    if depth:
        raise AbiError(f"unbalanced braces in {name}")
    return text[match.end():i - 1]


def virtual_methods(text: str, name: str) -> list[str]:
    """Names of the virtual functions of `name`, in declaration order. Comments are ignored."""
    body = class_body(re.sub(r"//[^\n]*|/\*.*?\*/", "", text, flags=re.S), name)
    names = []
    for match in re.finditer(r"\bvirtual\b([^;{]*?)(~?\w+)\s*\(", body, flags=re.S):
        names.append(match.group(2))
    return [n.removesuffix("_never_called") for n in names]


def compare(local: str, upstream: str) -> list[str]:
    problems = []
    for cls in ("QCefWidget", "QCef"):
        ours, theirs = virtual_methods(local, cls), virtual_methods(upstream, cls)
        if ours != theirs:
            problems.append(f"{cls}: ours {ours} != upstream {theirs}")
    return problems


def _fetch(url: str) -> str:
    request = urllib.request.Request(url, headers={"User-Agent": "obs-live-clock-ci"})
    with urllib.request.urlopen(request, timeout=30) as response:
        return response.read().decode("utf-8")


def upstream_for_tag(tag: str) -> str:
    sha = json.loads(_fetch(SUBMODULE_API.format(tag=tag)))["sha"]
    return _fetch(UPSTREAM_RAW.format(sha=sha))


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--local", required=True)
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--upstream-file")
    group.add_argument("--obs-tag")
    args = parser.parse_args()
    try:
        with open(args.local, encoding="utf-8") as handle:
            local = handle.read()
        if args.upstream_file:
            with open(args.upstream_file, encoding="utf-8") as handle:
                upstream = handle.read()
        else:
            upstream = upstream_for_tag(args.obs_tag)
        problems = compare(local, upstream)
    except (AbiError, OSError, ValueError, KeyError) as error:
        print(f"::error::browser-panel ABI check could not run: {error}", file=sys.stderr)
        return 1
    for problem in problems:
        print(f"::error::{problem}", file=sys.stderr)
    return 1 if problems else 0


if __name__ == "__main__":
    raise SystemExit(main())
```

`plugin/net/CurlHttp.hpp`
```cpp
// SPDX-License-Identifier: GPL-2.0-or-later
#pragma once
#include "Http.hpp"

namespace olc {

/**
 * libcurl behind IHttpClient. One easy handle per call, so any thread may call it. libcurl is the same library OBS
 * ships on all three platforms and, unlike Qt Network inside OBS, it carries its own TLS (needed for https remotes).
 * Nothing about the request (URL with a token, body, headers) is ever put in the returned error text.
 */
class CurlHttp : public IHttpClient {
public:
    HttpResponse perform(const HttpRequest& request) override;
};

}  // namespace olc
```

`plugin/net/CurlHttp.cpp`
```cpp
// SPDX-License-Identifier: GPL-2.0-or-later
#include "CurlHttp.hpp"

#include <curl/curl.h>

#include <algorithm>
#include <memory>

namespace olc {

namespace {
constexpr size_t kMaxBody = 1 << 20;  // 1 MiB: the app answers with a few hundred bytes

size_t onBody(char* data, size_t size, size_t count, void* user) {
    auto* out = static_cast<std::string*>(user);
    const size_t bytes = size * count;
    if (out->size() + bytes > kMaxBody) return 0;  // abort the transfer
    out->append(data, bytes);
    return bytes;
}

struct HandleDeleter {
    void operator()(CURL* h) const { curl_easy_cleanup(h); }
};
struct ListDeleter {
    void operator()(curl_slist* l) const { curl_slist_free_all(l); }
};

bool isLoopback(const std::string& url) {
    return url.rfind("http://127.0.0.1", 0) == 0 || url.rfind("http://localhost", 0) == 0 || url.rfind("http://[::1]", 0) == 0;
}
}  // namespace

HttpResponse CurlHttp::perform(const HttpRequest& request) {
    HttpResponse response;
    std::unique_ptr<CURL, HandleDeleter> easy(curl_easy_init());
    if (!easy) {
        response.error = "curl_easy_init failed";
        return response;
    }
    std::unique_ptr<curl_slist, ListDeleter> headers;
    for (const auto& h : request.headers) {
        curl_slist* next = curl_slist_append(headers.get(), (h.first + ": " + h.second).c_str());
        if (!next) {
            response.error = "out of memory";
            return response;
        }
        headers.release();
        headers.reset(next);
    }
    const long timeout = (std::max)(100, request.timeoutMs);
    curl_easy_setopt(easy.get(), CURLOPT_URL, request.url.c_str());
    curl_easy_setopt(easy.get(), CURLOPT_NOSIGNAL, 1L);  // required when curl is used from non-main threads
    curl_easy_setopt(easy.get(), CURLOPT_TIMEOUT_MS, timeout);
    curl_easy_setopt(easy.get(), CURLOPT_CONNECTTIMEOUT_MS, (std::min<long>)(timeout, 1000L));
    curl_easy_setopt(easy.get(), CURLOPT_FOLLOWLOCATION, 0L);
    curl_easy_setopt(easy.get(), CURLOPT_HTTPHEADER, headers.get());
    curl_easy_setopt(easy.get(), CURLOPT_WRITEFUNCTION, onBody);
    curl_easy_setopt(easy.get(), CURLOPT_WRITEDATA, &response.body);
    if (isLoopback(request.url)) curl_easy_setopt(easy.get(), CURLOPT_NOPROXY, "*");
    if (request.method == "POST") {
        curl_easy_setopt(easy.get(), CURLOPT_POST, 1L);
        curl_easy_setopt(easy.get(), CURLOPT_POSTFIELDS, request.body.c_str());
        curl_easy_setopt(easy.get(), CURLOPT_POSTFIELDSIZE, static_cast<long>(request.body.size()));
    }
    const CURLcode code = curl_easy_perform(easy.get());
    if (code != CURLE_OK) {
        response.body.clear();
        response.error = curl_easy_strerror(code);  // fixed text per code: carries nothing from the request
        return response;
    }
    long status = 0;
    curl_easy_getinfo(easy.get(), CURLINFO_RESPONSE_CODE, &status);
    response.status = static_cast<int>(status);
    return response;
}

}  // namespace olc
```

`plugin/src/CMakeLists.txt`
```cmake
# SPDX-License-Identifier: GPL-2.0-or-later
# The OBS module: the only place that sees libobs, obs-frontend-api, Qt and libcurl.
find_package(libobs QUIET)
if(NOT libobs_FOUND)
  find_package(LibObs REQUIRED)
endif()
find_package(obs-frontend-api REQUIRED)
find_package(Qt6 REQUIRED COMPONENTS Core Gui Widgets)
if(NOT TARGET olc-net)
  message(FATAL_ERROR "The plugin module needs libcurl (olc-net): pass CMAKE_PREFIX_PATH with the OBS deps")
endif()

# A Qt plugin loaded into OBS runs against the Qt that OBS itself ships. A major.minor mismatch does not fail to
# load, it crashes later somewhere unrelated. Pass -DOLC_EXPECTED_QT=6.11 (the Qt of the OBS being targeted) and the
# build refuses to produce a binary for another one. Empty = only a printed note.
set(OLC_EXPECTED_QT "" CACHE STRING "major.minor of the Qt that the target OBS ships")
message(STATUS "OBS Live Clock: building against Qt ${Qt6_VERSION}")
if(OLC_EXPECTED_QT)
  string(REGEX MATCH "^[0-9]+\\.[0-9]+" _olc_qt_found "${Qt6_VERSION}")
  if(NOT _olc_qt_found VERSION_EQUAL OLC_EXPECTED_QT)
    message(FATAL_ERROR "Qt ${Qt6_VERSION} found, but this build targets an OBS that ships Qt ${OLC_EXPECTED_QT}.")
  endif()
endif()

set(CMAKE_AUTOMOC ON)

# Every .cpp in this folder is part of the module. Later tasks only ADD files; nobody edits this list.
file(GLOB OLC_GLUE_SOURCES CONFIGURE_DEPENDS "${CMAKE_CURRENT_SOURCE_DIR}/*.cpp")
add_library(obs-live-clock MODULE ${OLC_GLUE_SOURCES})
target_link_libraries(obs-live-clock PRIVATE olc-core olc-net OBS::libobs OBS::obs-frontend-api Qt6::Core Qt6::Gui Qt6::Widgets)
target_compile_definitions(obs-live-clock PRIVATE OLC_VERSION="${PROJECT_VERSION}")
target_include_directories(obs-live-clock PRIVATE "${CMAKE_CURRENT_SOURCE_DIR}")

if(WIN32)
  # Relative to a plugins folder (C:\ProgramData\obs-studio\plugins). OBS 33 loads <name>\<name>.dll, OBS 32 and
  # earlier <name>\bin\64bit\<name>.dll: install both, OBS 33 skips the legacy duplicate.
  set(OLC_PLUGIN_DESTINATIONS "obs-live-clock" "obs-live-clock/bin/64bit")
elseif(APPLE)
  set(OLC_PLUGIN_DESTINATIONS "obs-plugins")
else()
  # OBS names a module after its file minus the extension: no "lib" prefix.
  set_target_properties(obs-live-clock PROPERTIES PREFIX "")
  # Per-user layout, relative to $HOME, searched by every OBS (same choice as Playlist Deck).
  set(OLC_PLUGIN_DESTINATIONS ".local/share/obs-studio/plugins/obs-live-clock" ".config/obs-studio/plugins/obs-live-clock/bin/64bit")
endif()
foreach(destination IN LISTS OLC_PLUGIN_DESTINATIONS)
  install(TARGETS obs-live-clock LIBRARY DESTINATION "${destination}")
endforeach()
```

`plugin/src/BrowserPanel.hpp`
```cpp
// SPDX-License-Identifier: GPL-2.0-or-later
#pragma once
/*
 * How a plugin shows a web page in a dock (verified against obs-browser at the commits of OBS 30.0.0, 31.0.0,
 * 32.0.0, 32.2.2 and 33.0.0-rc1: panel/browser-panel.hpp changed only in formatting between them).
 *
 * obs-browser exports two C symbols from its module: obs_browser_create_qcef() returns a QCef*, a table of virtual
 * functions, and obs_browser_qcef_version_export() returns its version (3 in every OBS from 30.0 to 33.0-rc1).
 * obs-browser's header is not part of the OBS SDK, and it is GPL-2.0-only, so it is not copied: the declarations
 * below are written from the observable virtual-function ORDER, which is the whole ABI. tools/check-browser-panel-abi.py
 * (CI) compares this order with upstream's header so a future change cannot slip through.
 *
 * NEVER reorder, insert or remove a virtual function here.
 */
#include <QWidget>
#include <string>

namespace olc::panel {

class QCefWidget : public QWidget {
protected:
    explicit QCefWidget(QWidget* parent) : QWidget(parent) {}

public:
    virtual void setURL(const std::string& url) = 0;
    virtual void setStartupScript(const std::string& script) = 0;
    virtual void allowAllPopups(bool allow) = 0;
    virtual void closeBrowser() = 0;
    virtual void reloadPage() = 0;
    virtual bool zoomPage(int direction) = 0;
    virtual void executeJavaScript(const std::string& script) = 0;
};

struct QCefCookieManager;  // never used here; only its pointer type appears in QCef

struct QCef {
    virtual ~QCef() {}
    virtual bool init_browser() = 0;
    virtual bool initialized() = 0;
    virtual bool wait_for_browser_init() = 0;
    virtual QCefWidget* create_widget(QWidget* parent, const std::string& url, QCefCookieManager* cookieManager = nullptr) = 0;
    virtual QCefCookieManager* create_cookie_manager(const std::string& storagePath, bool persistSessionCookies = false) = 0;
    virtual void* get_cookie_path_never_called(const std::string& storagePath) = 0;  // BPtr<char> upstream
    virtual void add_popup_whitelist_url(const std::string& url, QObject* obj) = 0;
    virtual void add_force_popup_url(const std::string& url, QObject* obj) = 0;
};

/** nullptr when obs-browser is absent, too old, disabled, or OBS runs on Wayland (obs-browser panels are off there). */
QCef* createQCef();

/** A live browser widget showing `url`, or nullptr (see createQCef). Parent owns it. */
QCefWidget* createBrowserWidget(QWidget* parent, const std::string& url);

}  // namespace olc::panel
```

`plugin/src/BrowserPanel.cpp`
```cpp
// SPDX-License-Identifier: GPL-2.0-or-later
#include "BrowserPanel.hpp"

#include <obs-module.h>
#include <util/platform.h>
#if defined(__linux__)
#include <obs-nix-platform.h>
#endif

namespace olc::panel {

namespace {
constexpr int kMinPanelVersion = 3;  // what OBS 30.0 .. 33.0-rc1 export; allowAllPopups() needs >= 1

void* browserLib() {
#if defined(__linux__)
    if (obs_get_nix_platform() == OBS_NIX_PLATFORM_WAYLAND) return nullptr;  // same rule as OBS itself
#endif
    obs_module_t* module = obs_get_module("obs-browser");
    return module ? obs_get_module_lib(module) : nullptr;
}
}  // namespace

QCef* createQCef() {
    static QCef* cached = nullptr;
    static bool tried = false;
    if (tried) return cached;
    tried = true;
    void* lib = browserLib();
    if (!lib) return nullptr;
    using VersionFn = int (*)();
    using CreateFn = QCef* (*)();
    const auto version = reinterpret_cast<VersionFn>(os_dlsym(lib, "obs_browser_qcef_version_export"));
    if (!version || version() < kMinPanelVersion) return nullptr;
    const auto create = reinterpret_cast<CreateFn>(os_dlsym(lib, "obs_browser_create_qcef"));
    cached = create ? create() : nullptr;
    return cached;
}

QCefWidget* createBrowserWidget(QWidget* parent, const std::string& url) {
    QCef* cef = createQCef();
    if (!cef) return nullptr;
    QCefWidget* widget = cef->create_widget(parent, url, nullptr);
    if (widget) widget->allowAllPopups(true);  // same as OBS's own custom browser docks
    return widget;
}

}  // namespace olc::panel
```


`plugin/src/plugin-main.cpp` (bootstrap):

```cpp
// SPDX-License-Identifier: GPL-2.0-or-later
#include <curl/curl.h>
#include <obs-module.h>

#ifndef OLC_VERSION
#define OLC_VERSION "0.0.0"
#endif

OBS_DECLARE_MODULE()

MODULE_EXPORT const char* obs_module_description(void) {
    return "OBS Live Clock - presenter clock dock, app launcher and hotkeys";
}
MODULE_EXPORT const char* obs_module_name(void) { return "OBS Live Clock"; }
MODULE_EXPORT const char* obs_module_author(void) { return "OBS Live Clock contributors"; }

bool obs_module_load(void) {
    blog(LOG_INFO, "[obs-live-clock] loaded (v%s)", OLC_VERSION);
    curl_global_init(CURL_GLOBAL_DEFAULT);
    return true;
}

void obs_module_unload(void) { curl_global_cleanup(); }
```

`plugin/scripts/setup-obs-dev.sh`
```bash
#!/usr/bin/env bash
# SPDX-License-Identifier: GPL-2.0-or-later
# Builds the OBS development tree the plugin module needs (libobs + obs-frontend-api headers and import libraries,
# OBS's own prebuilt dependencies and Qt) into $OLC_DEPS_DIR (default plugin/.deps, git-ignored). Same recipe as CI: it mirrors
# the Windows job of Playlist Deck's build_project.yml. Takes 5 to 10 minutes the first time (downloads about 400 MB), nothing afterwards.
#
# VERIFIED on Windows 11 with OBS 32.2.2 (Git Bash, Visual Studio 18 Build Tools, paths with spaces included).
# NOT verified on macOS or Linux: CI builds there (see .github/workflows/ci.yml); do not use this script on them.
set -euo pipefail
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
olc_is_windows || { echo "setup-obs-dev.sh supports Windows only; macOS and Linux are built by CI." >&2; exit 2; }

OBS_VERSION="${OBS_VERSION:-32.2.2}"   # keep equal to OBS_VERSION in .github/workflows/ci.yml
deps_root="$OLC_DEPS_DIR"
mkdir -p "$deps_root/dl"
py="$(command -v python3 || command -v python)"

# 1. Which obs-deps / Qt does this OBS use? (from OBS's own CMakePresets.json)
eval "$("$py" "$OLC_ROOT/ci/obs_deps.py" --obs-version "$OBS_VERSION" --platform windows | sed -E 's/^([A-Z0-9_]+)=(.*)$/\1="\2"/')"
echo "OBS $OBS_VERSION: obs-deps $OBS_DEPS_VERSION, Qt deps $OBS_QT6_DEPS_VERSION, Qt ABI $OBS_QT_ABI"

stamp="$deps_root/stamp-$OBS_VERSION-$OBS_DEPS_VERSION"
if [ -f "$stamp" ]; then echo "already set up ($stamp)"; exit 0; fi
rm -rf "$deps_root/deps" "$deps_root/qt" "$deps_root/obs-src" "$deps_root/obs-build" "$deps_root/obs-dev"
mkdir -p "$deps_root/deps" "$deps_root/qt" "$deps_root/obs-src"

# 2. Download (OBS's own release assets) and unpack.
dl="$deps_root/dl"
curl -fsSL -o "$dl/deps.zip" "https://github.com/obsproject/obs-deps/releases/download/$OBS_DEPS_VERSION/windows-deps-$OBS_DEPS_VERSION-x64.zip"
curl -fsSL -o "$dl/qt.zip" "https://github.com/obsproject/obs-deps/releases/download/$OBS_QT6_DEPS_VERSION/windows-deps-qt6-$OBS_QT6_DEPS_VERSION-x64.zip"
curl -fsSL -o "$dl/obs.zip" "https://github.com/obsproject/obs-studio/archive/refs/tags/$OBS_VERSION.zip"
unzip_to() { powershell.exe -NoProfile -Command "Expand-Archive -LiteralPath '$(olc_native_path "$1")' -DestinationPath '$(olc_native_path "$2")' -Force"; }
unzip_to "$dl/deps.zip" "$deps_root/deps"
unzip_to "$dl/qt.zip" "$deps_root/qt"
unzip_to "$dl/obs.zip" "$deps_root/obs-src"

# 3. Configure OBS with nothing enabled, build only obs-frontend-api (libobs comes with it), install the dev files.
olc_pick_generator
D="$(olc_native_path "$deps_root/deps")"; Q="$(olc_native_path "$deps_root/qt")"
S="$(olc_native_path "$deps_root/obs-src/obs-studio-$OBS_VERSION")"; B="$(olc_native_path "$deps_root/obs-build")"
cmake -B "$B" -S "$S" "${GEN_ARGS[@]}" \
  -DENABLE_PLUGINS=OFF -DENABLE_CORE_MODULES=OFF -DENABLE_SCRIPTING=OFF -DENABLE_BROWSER=OFF -DENABLE_UPDATER=OFF \
  -DCMAKE_SYSTEM_VERSION=10.0 "-DDepsPath=$D" "-DFFMPEG_PATH=$D" "-DQTDIR=$Q" "-DCMAKE_PREFIX_PATH=$D;$Q" >"$deps_root/obs-configure.log" 2>&1 \
  || { tail -30 "$deps_root/obs-configure.log"; exit 1; }
cmake --build "$B" --target obs-frontend-api --config Release --parallel >"$deps_root/obs-build.log" 2>&1 \
  || { tail -30 "$deps_root/obs-build.log"; exit 1; }
cmake --install "$B" --config Release --component Development --prefix "$(olc_native_path "$deps_root/obs-dev")" >"$deps_root/obs-install.log" 2>&1 \
  || { tail -30 "$deps_root/obs-install.log"; exit 1; }

printf 'OBS_QT_ABI=%s\nOBS_VERSION=%s\n' "$OBS_QT_ABI" "$OBS_VERSION" >"$deps_root/env.sh"
touch "$stamp"
echo "done: $deps_root/obs-dev"
```

`plugin/scripts/build-plugin.sh`
```bash
#!/usr/bin/env bash
# SPDX-License-Identifier: GPL-2.0-or-later
# Builds the real OBS module (obs-live-clock.dll / .so) plus olc-cli, against plugin/.deps made by setup-obs-dev.sh.
# Prints the path of the built module. The OBS glue has no unit tests: compiling and linking IS its automatic check.
set -euo pipefail
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
olc_is_windows || { echo "build-plugin.sh supports Windows only; macOS and Linux are built by CI." >&2; exit 2; }
deps_root="$OLC_DEPS_DIR"
[ -f "$deps_root/env.sh" ] || { echo "run plugin/scripts/setup-obs-dev.sh first" >&2; exit 1; }
# shellcheck disable=SC1091
. "$deps_root/env.sh"
olc_pick_generator
prefix="$(olc_native_path "$deps_root/obs-dev");$(olc_native_path "$deps_root/qt");$(olc_native_path "$deps_root/deps")"
cmake -S "$OLC_ROOT" -B "$OLC_ROOT/build-plugin" "${GEN_ARGS[@]}" -DBUILD_TESTS=ON -DBUILD_PLUGIN=ON \
  "-DOLC_EXPECTED_QT=$OBS_QT_ABI" "-DCMAKE_PREFIX_PATH=$prefix"
cmake --build "$OLC_ROOT/build-plugin" --config Release --parallel
ls "$OLC_ROOT/build-plugin/src/Release/obs-live-clock.dll"
```


- [ ] **Step 3: Run the checks**

1. `python -I -m unittest discover -s plugin/ci -p "test_*.py"` -> PASS.
2. `python plugin/ci/check_browser_panel_abi.py --local plugin/src/BrowserPanel.hpp --obs-tag 32.2.2` -> exit 0 (also `30.0.0` and `33.0.0-rc1`; needs network).
3. Once per machine: `bash plugin/scripts/setup-obs-dev.sh` (5-10 min). Then `bash plugin/scripts/build-plugin.sh` -> prints `.../obs-live-clock.dll`. `bash plugin/scripts/verify.sh` -> PASS. Check the exports: `dumpbin /exports plugin/build-plugin/src/Release/obs-live-clock.dll` shows `obs_module_load`, `obs_module_ver`.

- [ ] **Step 4: Commit**

```
git add plugin
git commit -m "feat(plugin): libcurl HTTP client, obs-browser panel shim with ABI check, OBS module build and dev-tree scripts"
```

---

### Task 10: Core — supervisor and texts

**Files:**
- Create: `plugin/core/Supervisor.hpp`, `plugin/core/Supervisor.cpp`, `plugin/core/Texts.hpp`, `plugin/core/Texts.cpp`, `plugin/tests/test_supervisor.cpp`, `plugin/tests/test_texts.cpp`

**Interfaces:**
- Consumes: Tasks 3, 4, 5, 6 (`tests/support/fakes.hpp` from Task 6). Produces: `Supervisor(SupervisorDeps, PluginSettings)` with `tick()`, `api()` (shared with the hotkey forwarder), `applySettings`, `setScreens`, `status()`, `setOnStatus`; `Status`, `CredentialState`; `Lang`, `langFromLocale`, `Msg`, `text(lang, msg)`, `describeStatus(lang, status)`.
- `SupervisorDeps` are all injected (`http`, `nowMs`, `readFile`, `launch`, `readObsWs`, `log`, `dataDir`): the supervisor has no OBS, no Qt and no thread of its own; the glue calls `tick()` from a `TickLoop`.

Rules: probe `GET /api/health` (port from `runtime.json`, else `settings.json`, else 4460, re-read on every probe; remote mode uses the remote URL); `Ok` + protocol 1 means running; launch only through `LaunchPolicy`; the launch command is `appCommand` from the plugin settings, else `launch.json`, else "no command" (reported in `Status.launchSpecMissing`); on the first healthy probe and on every new `instanceId` deliver credentials (re-reading obs-websocket's config on every probe, so a changed password is delivered at once) and the screen list; a rejected token is retried quickly, an app without the screens route (404) backs off 2/4/8/16/30 s and is logged once; remote mode hands over nothing (DT-3); phase changes are logged once each, e.g. `app running on port 4460`; nothing secret is ever logged (`describe(ObsWsConfig)` prints `<secret>`).

- [ ] **Step 1: Write the failing tests**

`plugin/tests/test_supervisor.cpp`
```cpp
// SPDX-License-Identifier: GPL-2.0-or-later
#include "doctest/doctest.h"

#include <map>
#include <nlohmann/json.hpp>

#include "Supervisor.hpp"
#include "support/fakes.hpp"

using namespace olc;
using namespace olc::testing;

namespace {

const char* kPassword = "pw-must-never-leak-42";

struct Harness {
    FakeHttp http;
    int64_t now = 1'000;
    std::map<std::string, std::string> files;
    std::vector<std::string> logs;
    std::vector<LaunchSpec> launched;
    bool launchOk = true;
    bool appUp = false;
    int protocol = 1;
    std::string instance = "inst-1";
    int credentialsStatus = 204;
    int screensStatus = 204;
    std::optional<ObsWsConfig> obsWs;
    std::vector<Status> statuses;
    std::unique_ptr<Supervisor> sup;

    explicit Harness(PluginSettings settings = {}) {
        ObsWsConfig cfg;
        cfg.serverEnabled = true;
        cfg.port = 4455;
        cfg.password = Secret(kPassword);
        obsWs = cfg;
        files["/data/secret.token"] = "tok-123\n";
        files["/data/launch.json"] = R"({"command":"C:/app/obs-live-clock.exe","args":["--headless"]})";
        http.setHandler([this](const HttpRequest& r) {
            if (r.url.find("/api/health") != std::string::npos) {
                if (!appUp) return unreachable();
                return reply(200, nlohmann::json{{"version", "0.6.0"}, {"protocol", protocol}, {"instanceId", instance}}.dump());
            }
            if (r.url.find("/obs-credentials") != std::string::npos) return reply(credentialsStatus);
            if (r.url.find("/screens") != std::string::npos) return reply(screensStatus);
            return reply(404);
        });
        SupervisorDeps deps{http,
                            [this] { return now; },
                            [this](const std::string& p) -> std::optional<std::string> {
                                const auto it = files.find(p);
                                if (it == files.end()) return std::nullopt;
                                return it->second;
                            },
                            [this](const LaunchSpec& s) {
                                launched.push_back(s);
                                return launchOk;
                            },
                            [this] { return obsWs; },
                            [this](const std::string& l) { logs.push_back(l); },
                            "/data"};
        sup = std::make_unique<Supervisor>(std::move(deps), settings);
        sup->setOnStatus([this](const Status& s) { statuses.push_back(s); });
    }

    /** Ticks every 250 ms for `ms` of fake time. */
    void run(int64_t ms) {
        const auto end = now + ms;
        while (now < end) {
            sup->tick();
            now += 250;
        }
    }
    std::vector<HttpRequest> posts(const std::string& part) const { return http.requestsTo(part); }
    /** Every place a secret must not appear: logs, URLs, launch commands, and (optionally) headers. */
    std::string everything(bool withHeaders = true) const {
        std::string all;
        for (const auto& l : logs) all += l + "\n";
        for (const auto& r : http.requests()) {
            all += r.url + "\n";
            if (withHeaders)
                for (const auto& h : r.headers) all += h.first + h.second + "\n";
        }
        for (const auto& s : launched) {
            all += s.command + s.workingDir;
            for (const auto& a : s.args) all += a;
        }
        return all;
    }
};

}  // namespace

TEST_CASE("a healthy app gets the credentials once, with the bearer token and the password only in the body") {
    Harness h;
    h.appUp = true;
    h.run(3'000);
    const auto posts = h.posts("/obs-credentials");
    REQUIRE(posts.size() == 1);
    CHECK(posts[0].method == "POST");
    CHECK(posts[0].url == "http://127.0.0.1:4460/api/internal/obs-credentials");
    bool bearer = false;
    for (const auto& hd : posts[0].headers)
        if (hd.first == "Authorization") bearer = hd.second == "Bearer tok-123";
    CHECK(bearer);
    const auto body = nlohmann::json::parse(posts[0].body);
    CHECK(body["port"] == 4455);
    CHECK(body["password"] == kPassword);
    CHECK(h.launched.empty());
    CHECK(h.sup->status().credentials == CredentialState::Delivered);
    CHECK(h.sup->status().phase == LaunchPhase::Running);
    CHECK(h.sup->status().appVersion == "0.6.0");
}

TEST_CASE("the password never appears in a log line, a URL, a header or a launch command") {
    Harness h;
    h.run(2'000);        // app down: it is launched
    h.appUp = true;
    h.run(8'000);        // up: credentials delivered
    h.instance = "inst-2";
    h.run(8'000);        // restarted: delivered again
    h.credentialsStatus = 500;
    h.obsWs->password = Secret(std::string(kPassword) + "-changed");
    h.run(10'000);       // failing deliveries
    REQUIRE_FALSE(h.posts("/obs-credentials").empty());
    CHECK(h.everything().find("pw-must-never-leak") == std::string::npos);
    // The bearer token belongs in the Authorization header and nowhere else.
    CHECK(h.everything(false).find("tok-123") == std::string::npos);
}

TEST_CASE("when the app does not answer it is launched exactly once, then the credentials follow") {
    Harness h;
    h.run(4'000);
    REQUIRE(h.launched.size() == 1);
    CHECK(h.launched[0].command == "C:/app/obs-live-clock.exe");
    CHECK(h.launched[0].args == std::vector<std::string>{"--headless"});
    CHECK(h.posts("/obs-credentials").empty());
    CHECK(h.sup->status().phase == LaunchPhase::Launching);
    h.appUp = true;
    h.run(3'000);
    CHECK(h.launched.size() == 1);
    CHECK(h.posts("/obs-credentials").size() == 1);
    CHECK(h.sup->status().phase == LaunchPhase::Running);
}

TEST_CASE("an app that is slow to start (9 s) is still launched only once") {
    Harness h;
    h.run(9'000);
    h.appUp = true;
    h.run(2'000);
    CHECK(h.launched.size() == 1);
    CHECK(h.sup->status().phase == LaunchPhase::Running);
}

TEST_CASE("an app that never starts ends as Failed after about 10 s, without a second launch") {
    Harness h;
    h.run(30'000);
    CHECK(h.launched.size() == 1);
    CHECK(h.sup->status().phase == LaunchPhase::Failed);
}

TEST_CASE("the settings' app command wins over launch.json") {
    PluginSettings s;
    s.appCommand = "D:/custom/olc.exe";
    Harness h(s);
    h.run(500);
    REQUIRE(h.launched.size() == 1);
    CHECK(h.launched[0].command == "D:/custom/olc.exe");
    CHECK(h.launched[0].args.empty());
}

TEST_CASE("no launch command anywhere: nothing is started and the status says why") {
    Harness h;
    h.files.erase("/data/launch.json");
    h.run(1'000);
    CHECK(h.launched.empty());
    CHECK(h.sup->status().launchSpecMissing);
}

TEST_CASE("a command the OS refuses to start is reported") {
    Harness h;
    h.launchOk = false;
    h.run(500);
    CHECK(h.launched.size() == 1);
    CHECK(h.sup->status().launchFailed);
}

TEST_CASE("auto start off: the app is never launched") {
    PluginSettings s;
    s.autoStart = false;
    Harness h(s);
    h.run(20'000);
    CHECK(h.launched.empty());
    CHECK(h.sup->status().phase == LaunchPhase::Unavailable);
}

TEST_CASE("remote mode never launches and never hands over credentials or screens, and shows the remote dock") {
    PluginSettings s;
    s.mode = ServerMode::Remote;
    s.remoteUrl = "http://studio-pc.local:4460";
    Harness h(s);
    h.appUp = true;
    h.sup->setScreens({ScreenInfo{"DISPLAY1", 0, 0, 1920, 1080, 1.0, true}});
    h.run(8'000);
    CHECK(h.launched.empty());
    CHECK(h.posts("/obs-credentials").empty());
    CHECK(h.posts("/screens").empty());
    CHECK(h.sup->status().remote);
    CHECK(h.sup->status().dockUrl == "http://studio-pc.local:4460/dock");
    CHECK(h.sup->status().credentials == CredentialState::NotApplicable);
    for (const auto& r : h.http.requests()) CHECK(r.url.rfind("http://studio-pc.local:4460", 0) == 0);
}

TEST_CASE("remote mode with an unreachable app only waits (no launch, Unavailable)") {
    PluginSettings s;
    s.mode = ServerMode::Remote;
    s.remoteUrl = "https://clock.example.org";
    Harness h(s);
    h.run(20'000);
    CHECK(h.launched.empty());
    CHECK(h.sup->status().phase == LaunchPhase::Unavailable);
}

TEST_CASE("remote mode with an invalid URL calls nothing") {
    PluginSettings s;
    s.mode = ServerMode::Remote;
    s.remoteUrl = "";
    Harness h(s);
    h.run(5'000);
    CHECK(h.http.requests().empty());
    CHECK(h.sup->status().dockUrl.empty());
}

TEST_CASE("a new instanceId (the app restarted) delivers credentials and screens again") {
    Harness h;
    h.appUp = true;
    h.sup->setScreens({ScreenInfo{"DISPLAY1", 0, 0, 1920, 1080, 1.0, true}});
    h.run(6'000);
    CHECK(h.posts("/obs-credentials").size() == 1);
    CHECK(h.posts("/screens").size() == 1);
    h.instance = "inst-2";
    h.run(6'000);
    CHECK(h.posts("/obs-credentials").size() == 2);
    CHECK(h.posts("/screens").size() == 2);
}

TEST_CASE("a password changed in OBS while it runs is delivered again without any restart") {
    Harness h;
    h.appUp = true;
    h.run(6'000);
    h.obsWs->password = Secret("new-password");
    h.run(6'000);
    const auto posts = h.posts("/obs-credentials");
    REQUIRE(posts.size() == 2);
    CHECK(nlohmann::json::parse(posts[1].body)["password"] == "new-password");
}

TEST_CASE("obs-websocket server switched off: nothing is delivered and the status says so") {
    Harness h;
    h.appUp = true;
    h.obsWs->serverEnabled = false;
    h.run(6'000);
    CHECK(h.posts("/obs-credentials").empty());
    CHECK(h.sup->status().credentials == CredentialState::ServerDisabled);
}

TEST_CASE("an unreadable obs-websocket config is reported, not guessed") {
    Harness h;
    h.appUp = true;
    h.obsWs.reset();
    h.run(6'000);
    CHECK(h.posts("/obs-credentials").empty());
    CHECK(h.sup->status().credentials == CredentialState::ConfigUnreadable);
}

TEST_CASE("authentication switched off: the body has no password") {
    Harness h;
    h.appUp = true;
    h.obsWs->authRequired = false;
    h.run(3'000);
    const auto posts = h.posts("/obs-credentials");
    REQUIRE(posts.size() == 1);
    CHECK_FALSE(nlohmann::json::parse(posts[0].body).contains("password"));
}

TEST_CASE("a rejected token is retried within a couple of seconds, not after the 5 s health interval") {
    Harness h;
    h.appUp = true;
    h.credentialsStatus = 401;
    h.run(250);
    CHECK(h.posts("/obs-credentials").size() == 1);
    h.files["/data/secret.token"] = "tok-new";
    h.credentialsStatus = 204;
    h.run(2'000);
    const auto posts = h.posts("/obs-credentials");
    REQUIRE(posts.size() == 2);
    bool bearer = false;
    for (const auto& hd : posts[1].headers)
        if (hd.first == "Authorization") bearer = hd.second == "Bearer tok-new";
    CHECK(bearer);
    CHECK(h.sup->status().credentials == CredentialState::Delivered);
}

TEST_CASE("an incompatible protocol is reported and nothing is delivered or launched") {
    Harness h;
    h.appUp = true;
    h.protocol = 2;
    h.run(8'000);
    CHECK(h.sup->status().phase == LaunchPhase::Incompatible);
    CHECK(h.sup->status().compat == Compat::AppNewer);
    CHECK(h.posts("/obs-credentials").empty());
    CHECK(h.launched.empty());
}

TEST_CASE("something else on the port is not our app: it is treated as down, once-logged") {
    Harness h;
    h.http.setHandler([](const HttpRequest&) { return reply(200, "<html>hello</html>"); });
    h.run(1'000);
    CHECK(h.launched.size() == 1);
    int notOurs = 0;
    for (const auto& l : h.logs)
        if (l.find("not OBS Live Clock") != std::string::npos) ++notOurs;
    CHECK(notOurs == 1);
}

TEST_CASE("runtime.json decides the port, then settings.json, then 4460") {
    Harness h;
    h.appUp = true;
    h.files["/data/settings.json"] = R"({"port":4470})";
    h.run(250);
    CHECK(h.http.requestsTo("/api/health").back().url == "http://127.0.0.1:4470/api/health");
    h.files["/data/runtime.json"] = R"({"port":4480,"pid":1,"instanceId":"inst-1"})";
    h.run(5'000);
    CHECK(h.http.requestsTo("/api/health").back().url == "http://127.0.0.1:4480/api/health");
    CHECK(h.sup->status().dockUrl == "http://127.0.0.1:4480/dock");
}

TEST_CASE("screens are delivered when healthy, again when they change, and retried after a failure") {
    Harness h;
    h.appUp = true;
    h.run(3'000);
    CHECK(h.posts("/screens").empty());  // nothing to send yet
    h.sup->setScreens({ScreenInfo{"DISPLAY1", 0, 0, 1920, 1080, 1.0, true}});
    h.run(500);
    CHECK(h.posts("/screens").size() == 1);
    h.run(6'000);
    CHECK(h.posts("/screens").size() == 1);  // unchanged: not repeated
    h.sup->setScreens({ScreenInfo{"DISPLAY1", 0, 0, 1920, 1080, 1.0, true}, ScreenInfo{"DISPLAY2", 1920, 0, 1920, 1080, 1.0, false}});
    h.screensStatus = 500;
    h.run(500);
    CHECK(h.posts("/screens").size() == 2);
    h.screensStatus = 204;
    h.run(3'000);
    CHECK(h.posts("/screens").size() == 3);  // retried after the 2 s pause
    h.run(6'000);
    CHECK(h.posts("/screens").size() == 3);
    const auto body = nlohmann::json::parse(h.posts("/screens").back().body);
    CHECK(body["screens"].size() == 2);
    CHECK(body["screens"][1]["name"] == "DISPLAY2");
}

TEST_CASE("changing the settings starts over: remote to local launches again") {
    PluginSettings remote;
    remote.mode = ServerMode::Remote;
    remote.remoteUrl = "http://other:4460";
    Harness h(remote);
    h.run(2'000);
    CHECK(h.launched.empty());
    h.sup->applySettings(PluginSettings{});
    h.run(1'000);
    CHECK(h.launched.size() == 1);
}

TEST_CASE("the status callback fires on change only") {
    Harness h;
    h.appUp = true;
    h.run(20'000);
    const auto n = h.statuses.size();
    CHECK(n >= 1);
    h.run(20'000);
    CHECK(h.statuses.size() == n);
}

TEST_CASE("an app that dies while running is relaunched after about 8 s of misses, once") {
    Harness h;
    h.appUp = true;
    h.run(5'000);
    h.appUp = false;
    h.run(60'000);
    CHECK(h.launched.size() == 1);
}

TEST_CASE("an app without the screens route (404) is asked with a growing pause and logged once") {
    Harness h;
    h.appUp = true;
    h.screensStatus = 404;
    h.sup->setScreens({ScreenInfo{"DISPLAY1", 0, 0, 1920, 1080, 1.0, true}});
    h.run(60'000);
    CHECK(h.posts("/screens").size() <= 6);  // 2, 4, 8, 16, 30 s pauses: far fewer than one per 2 s
    int logged = 0;
    for (const auto& l : h.logs)
        if (l.find("screen list") != std::string::npos) ++logged;
    CHECK(logged == 1);
}

TEST_CASE("phase changes are logged once each, with the port") {
    Harness h;
    h.run(2'000);
    h.appUp = true;
    h.run(3'000);
    int launching = 0, running = 0;
    for (const auto& l : h.logs) {
        if (l == "app launching on port 4460") ++launching;
        if (l == "app running on port 4460") ++running;
    }
    CHECK(launching == 1);
    CHECK(running == 1);
}
```

`plugin/tests/test_texts.cpp`
```cpp
// SPDX-License-Identifier: GPL-2.0-or-later
#include "doctest/doctest.h"

#include "Texts.hpp"

using namespace olc;

TEST_CASE("every message exists in Italian and English and is not empty") {
    for (size_t i = 0; i < static_cast<size_t>(Msg::COUNT_); ++i) {
        CHECK_MESSAGE(!text(Lang::It, static_cast<Msg>(i)).empty(), "it #" << i);
        CHECK_MESSAGE(!text(Lang::En, static_cast<Msg>(i)).empty(), "en #" << i);
    }
}

TEST_CASE("langFromLocale follows OBS locale names") {
    CHECK(langFromLocale("it-IT") == Lang::It);
    CHECK(langFromLocale("it_IT") == Lang::It);
    CHECK(langFromLocale("it") == Lang::It);
    CHECK(langFromLocale("en-US") == Lang::En);
    CHECK(langFromLocale("de-DE") == Lang::En);
    CHECK(langFromLocale("") == Lang::En);
    CHECK(langFromLocale("ita") == Lang::En);
}

TEST_CASE("describeStatus names the most important problem, and is empty when all is well") {
    Status ok;
    ok.phase = LaunchPhase::Running;
    ok.credentials = CredentialState::Delivered;
    CHECK(describeStatus(Lang::En, ok).empty());

    Status newer = ok;
    newer.compat = Compat::AppNewer;
    CHECK(describeStatus(Lang::En, newer) == text(Lang::En, Msg::StatusIncompatibleAppNewer));

    Status noSpec = ok;
    noSpec.phase = LaunchPhase::Failed;
    noSpec.launchSpecMissing = true;
    CHECK(describeStatus(Lang::It, noSpec) == text(Lang::It, Msg::LaunchSpecMissing));

    Status off = ok;
    off.credentials = CredentialState::ServerDisabled;
    CHECK(describeStatus(Lang::En, off) == text(Lang::En, Msg::CredentialsServerDisabled));

    Status remoteDown;
    remoteDown.phase = LaunchPhase::Unavailable;
    remoteDown.remote = true;
    CHECK(describeStatus(Lang::En, remoteDown) == text(Lang::En, Msg::StatusUnavailableRemote));
}
```


- [ ] **Step 2: Run, confirm failure** — `bash plugin/scripts/verify.sh` -> `FAIL cpp`.

- [ ] **Step 3: Implement**

`plugin/core/Supervisor.hpp`
```cpp
// SPDX-License-Identifier: GPL-2.0-or-later
#pragma once
#include <cstdint>
#include <functional>
#include <memory>
#include <mutex>
#include <optional>
#include <string>
#include <vector>

#include "ApiClient.hpp"
#include "CredentialTracker.hpp"
#include "Health.hpp"
#include "LaunchPolicy.hpp"
#include "ObsWsConfig.hpp"
#include "Paths.hpp"
#include "PluginSettings.hpp"
#include "ScreenInfo.hpp"

namespace olc {

enum class CredentialState {
    NotApplicable,    // remote mode, or the app is not up yet
    Delivered,        // the app has the current obs-websocket settings
    Failing,          // the last delivery failed; retrying with backoff
    ServerDisabled,   // obs-websocket's server is switched off in OBS: nothing to deliver
    ConfigUnreadable, // obs-websocket's config could not be read
};

/** Everything the dock fallback widget and the settings dialog may show. Plain data: safe to copy across threads. */
struct Status {
    LaunchPhase phase = LaunchPhase::Checking;
    Compat compat = Compat::Ok;
    bool remote = false;
    int port = 0;                      // local port in use (0 in remote mode)
    std::string dockUrl;               // "" when remote mode has no valid URL
    std::string appVersion;
    std::string instanceId;
    CredentialState credentials = CredentialState::NotApplicable;
    bool launchSpecMissing = false;    // we needed to start the app and had no command to start it with
    bool launchFailed = false;         // the OS refused to start the command
    int launches = 0;

    bool operator==(const Status& o) const {
        return phase == o.phase && compat == o.compat && remote == o.remote && port == o.port && dockUrl == o.dockUrl &&
               appVersion == o.appVersion && instanceId == o.instanceId && credentials == o.credentials &&
               launchSpecMissing == o.launchSpecMissing && launchFailed == o.launchFailed && launches == o.launches;
    }
    bool operator!=(const Status& o) const { return !(*this == o); }
};

struct SupervisorDeps {
    IHttpClient& http;
    std::function<int64_t()> nowMs;                                          // monotonic
    std::function<std::optional<std::string>(const std::string&)> readFile;  // nullopt = missing or unreadable
    std::function<bool(const LaunchSpec&)> launch;                           // start detached; false = failed to start
    std::function<std::optional<ObsWsConfig>()> readObsWs;                   // config.json (+legacy, +command line)
    std::function<void(const std::string&)> log;                             // one line; callers guarantee no secrets
    std::string dataDir;                                                     // defaultDataDir(...) resolved by the glue
};

/**
 * The plugin's brain, with no OBS and no Qt in it. tick() runs on ONE worker thread about every 250 ms and
 * does whatever is due: probe /api/health, launch the app (LaunchPolicy decides), deliver the credentials
 * (CredentialTracker decides) and the screen list. applySettings/setScreens/status are safe from any thread.
 */
class Supervisor {
public:
    Supervisor(SupervisorDeps deps, PluginSettings settings);

    void tick();
    /** The client the glue's HotkeyForwarder shares. Thread-safe; its base URL follows the settings. */
    ApiClient& api();
    void applySettings(const PluginSettings& settings);
    void setScreens(std::vector<ScreenInfo> screens);
    Status status() const;
    /** Called on the tick thread whenever status() changed. */
    void setOnStatus(std::function<void(const Status&)> callback);

private:
    void probe(int64_t now, const PluginSettings& settings);
    CredentialState deliverCredentials(int64_t now, const std::string& instanceId);
    void deliverScreens(int64_t now);
    int policyIntervalMs() const;
    void publish(const Status& status);

    SupervisorDeps deps_;
    DataPaths paths_;
    ApiClient api_;
    LaunchPolicy policy_;
    CredentialTracker creds_;

    mutable std::mutex mutex_;  // guards the members below
    PluginSettings settings_;
    bool settingsDirty_ = true;
    std::vector<ScreenInfo> screens_;
    bool screensDirty_ = false;
    Status status_;
    std::function<void(const Status&)> onStatus_;

    // tick-thread only
    int64_t nextProbeAt_ = 0;
    std::string lastInstance_;
    bool screensSentOnce_ = false;
    int64_t screensRetryAt_ = 0;
    int screensFailures_ = 0;
    int lastScreensFailure_ = 0;
    bool notOurAppLogged_ = false;
};

} // namespace olc
```

`plugin/core/Supervisor.cpp`
```cpp
// SPDX-License-Identifier: GPL-2.0-or-later
#include "Supervisor.hpp"

#include <algorithm>
#include <utility>

namespace olc {

namespace {
LaunchPolicyConfig policyConfig(const PluginSettings& settings) {
    LaunchPolicyConfig cfg;
    cfg.allowLaunch = !settings.isRemote() && settings.autoStart;
    return cfg;
}
}  // namespace

Supervisor::Supervisor(SupervisorDeps deps, PluginSettings settings)
    : deps_(std::move(deps)),
      paths_(dataPaths(deps_.dataDir)),
      api_(
          deps_.http, "",
          [this] { return deps_.readFile(paths_.secret).value_or(std::string()); }),
      policy_(policyConfig(settings)),
      settings_(std::move(settings)) {}

ApiClient& Supervisor::api() { return api_; }

void Supervisor::applySettings(const PluginSettings& settings) {
    std::lock_guard<std::mutex> lock(mutex_);
    if (settings == settings_) return;
    settings_ = settings;
    settingsDirty_ = true;
}

void Supervisor::setScreens(std::vector<ScreenInfo> screens) {
    std::lock_guard<std::mutex> lock(mutex_);
    if (screens == screens_) return;
    screens_ = std::move(screens);
    screensDirty_ = true;
}

Status Supervisor::status() const {
    std::lock_guard<std::mutex> lock(mutex_);
    return status_;
}

void Supervisor::setOnStatus(std::function<void(const Status&)> callback) {
    std::lock_guard<std::mutex> lock(mutex_);
    onStatus_ = std::move(callback);
}

const char* phaseName(LaunchPhase phase) {
    switch (phase) {
    case LaunchPhase::Checking: return "checking";
    case LaunchPhase::Launching: return "launching";
    case LaunchPhase::Running: return "running";
    case LaunchPhase::Incompatible: return "incompatible";
    case LaunchPhase::Unavailable: return "unavailable";
    case LaunchPhase::Failed: return "failed";
    }
    return "?";
}

void Supervisor::publish(const Status& next) {
    std::function<void(const Status&)> callback;
    bool phaseChanged = false;
    {
        std::lock_guard<std::mutex> lock(mutex_);
        if (next == status_) return;
        phaseChanged = next.phase != status_.phase;
        status_ = next;
        callback = onStatus_;
    }
    if (phaseChanged) deps_.log(std::string("app ") + phaseName(next.phase) + (next.port != 0 ? " on port " + std::to_string(next.port) : std::string(" (remote)")));
    if (callback) callback(next);
}

void Supervisor::tick() {
    const int64_t now = deps_.nowMs();
    PluginSettings settings;
    bool settingsChanged = false;
    bool screensWanted = false;
    {
        std::lock_guard<std::mutex> lock(mutex_);
        settings = settings_;
        settingsChanged = settingsDirty_;
        settingsDirty_ = false;
        screensWanted = screensDirty_ && now >= screensRetryAt_;
    }
    if (settingsChanged) {
        policy_.setAllowLaunch(!settings.isRemote() && settings.autoStart);
        policy_.reset();
        creds_.forget();
        lastInstance_.clear();
        screensSentOnce_ = false;
        screensRetryAt_ = 0;
        nextProbeAt_ = 0;
    }
    if (now < nextProbeAt_ && !screensWanted) return;
    probe(now, settings);
}

void Supervisor::probe(int64_t now, const PluginSettings& settings) {
    Status st = status();
    st.remote = settings.isRemote();
    int port = 0;
    if (!settings.isRemote()) {
        const auto runtime = parseRuntimeJson(deps_.readFile(paths_.runtime).value_or(std::string()));
        const auto settingsPort = parseSettingsPort(deps_.readFile(paths_.settings).value_or(std::string()));
        port = resolvePort(runtime, settingsPort);
    }
    st.port = port;
    st.dockUrl = dockUrl(settings, port);
    const std::string base = apiBaseUrl(settings, port);
    if (base.empty()) {  // remote mode with no valid URL: nothing to call, nothing to launch
        st.phase = LaunchPhase::Unavailable;
        st.credentials = CredentialState::NotApplicable;
        nextProbeAt_ = now + policyIntervalMs();
        publish(st);
        return;
    }
    api_.setBaseUrl(base);

    const HttpResponse response = api_.health();
    std::optional<HealthInfo> info;
    if (response.answered() && response.status == 200) info = parseHealth(response.body);
    if (response.answered() && !info && !notOurAppLogged_) {
        notOurAppLogged_ = true;
        deps_.log("something answers on " + base + " but it is not OBS Live Clock");
    }
    HealthObservation observed = HealthObservation::Unreachable;
    Compat compat = Compat::Ok;
    if (info) {
        compat = checkProtocol(info->protocol);
        observed = compat == Compat::Ok ? HealthObservation::Ok : HealthObservation::Incompatible;
    }

    const PolicyDecision decision = policy_.onHealth(now, observed);
    st.phase = decision.phase;
    st.compat = compat;
    st.appVersion = info ? info->version : std::string();
    st.instanceId = info ? info->instanceId : std::string();
    nextProbeAt_ = now + decision.nextCheckInMs;

    if (decision.launch) {
        st.launchSpecMissing = false;
        st.launchFailed = false;
        const auto fileSpec = parseLaunchJson(deps_.readFile(paths_.launch).value_or(std::string()));
        const auto spec = resolveLaunch(settings, fileSpec);
        if (!spec) {
            st.launchSpecMissing = true;
            deps_.log("the app does not answer and no launch command is known (see Tools > OBS Live Clock)");
        } else if (deps_.launch(*spec)) {
            deps_.log("started the app: " + spec->command);
        } else {
            st.launchFailed = true;
            deps_.log("could not start the app: " + spec->command);
        }
    } else if (observed == HealthObservation::Ok) {
        st.launchSpecMissing = false;
        st.launchFailed = false;
    }
    st.launches = policy_.launches();

    if (observed == HealthObservation::Ok) {
        if (info->instanceId != lastInstance_) {  // first sight, or the app restarted
            if (!lastInstance_.empty()) deps_.log("the app restarted: delivering again");
            lastInstance_ = info->instanceId;
            creds_.forget();
            screensSentOnce_ = false;
            screensRetryAt_ = 0;
        }
        if (settings.isRemote()) {
            st.credentials = CredentialState::NotApplicable;  // DT-3: remote mode hands over nothing
        } else {
            st.credentials = deliverCredentials(now, info->instanceId);
            if (creds_.consecutiveFailures() > 0) {
                nextProbeAt_ = std::min(nextProbeAt_, std::max(now + 250, creds_.retryAt()));
            }
            deliverScreens(now);
        }
    } else {
        st.credentials = CredentialState::NotApplicable;
    }
    publish(st);
}

int Supervisor::policyIntervalMs() const { return 5'000; }

CredentialState Supervisor::deliverCredentials(int64_t now, const std::string& instanceId) {
    const auto config = deps_.readObsWs();
    if (!config) return CredentialState::ConfigUnreadable;
    if (!config->serverEnabled) return CredentialState::ServerDisabled;
    if (creds_.due(now, *config, instanceId)) {
        const HttpResponse response = api_.postCredentials(buildCredentialsBody(*config));
        const DeliveryOutcome outcome = classifyDelivery(response);
        creds_.record(now, outcome, *config, instanceId);
        deps_.log(outcome == DeliveryOutcome::Delivered ? "obs-websocket settings delivered to the app (" + describe(*config) + ")"
                                                        : "could not deliver the obs-websocket settings (HTTP " +
                                                              std::to_string(response.status) + ")");
        if (outcome != DeliveryOutcome::Delivered) return CredentialState::Failing;
    } else if (creds_.consecutiveFailures() > 0) {
        return CredentialState::Failing;
    }
    return CredentialState::Delivered;
}

void Supervisor::deliverScreens(int64_t now) {
    std::vector<ScreenInfo> screens;
    bool dirty = false;
    {
        std::lock_guard<std::mutex> lock(mutex_);
        screens = screens_;
        dirty = screensDirty_;
    }
    if (screens.empty() || (screensSentOnce_ && !dirty) || now < screensRetryAt_) return;
    const HttpResponse response = api_.postScreens(screensToJson(screens));
    if (response.answered() && (response.status == 204 || response.status == 200)) {
        screensSentOnce_ = true;
        screensRetryAt_ = 0;
        screensFailures_ = 0;
        lastScreensFailure_ = 0;
        std::lock_guard<std::mutex> lock(mutex_);
        if (screens_ == screens) screensDirty_ = false;
        return;
    }
    // Same backoff as the credentials: 2, 4, 8, 16, then every 30 s. An app without this route (older version)
    // answers 404 forever and must not be asked every 2 s, nor fill the log.
    static const int64_t kBackoffMs[] = {2'000, 4'000, 8'000, 16'000, 30'000};
    screensFailures_ = (std::min)(screensFailures_ + 1, 5);
    screensRetryAt_ = now + kBackoffMs[screensFailures_ - 1];
    if (response.status != lastScreensFailure_) {  // log a streak once, and again if the answer changes
        lastScreensFailure_ = response.status;
        deps_.log("could not deliver the screen list (HTTP " + std::to_string(response.status) + ")");
    }
}

}  // namespace olc
```

`plugin/core/Texts.hpp`
```cpp
// SPDX-License-Identifier: GPL-2.0-or-later
#pragma once
#include <string>
#include <string_view>

#include "Supervisor.hpp"

namespace olc {

enum class Lang { It, En };

/** "it", "it-IT", "it_IT" -> It; everything else -> En (OBS's own default is en-US). */
Lang langFromLocale(std::string_view locale);

enum class Msg {
    DockTitle,
    FallbackBody,          // shown when OBS has no browser panel (CEF) to host the dock
    OpenInBrowser,
    CopyUrl,
    UrlLabel,
    StatusChecking,
    StatusLaunching,
    StatusRunning,
    StatusFailed,          // launched, never answered
    StatusUnavailableLocal,
    StatusUnavailableRemote,
    StatusIncompatibleAppNewer,
    StatusIncompatibleAppOlder,
    LaunchSpecMissing,
    LaunchFailed,
    CredentialsServerDisabled,
    CredentialsUnreadable,
    CredentialsFailing,
    SettingsTitle,
    ModeLocal,
    ModeRemote,
    RemoteUrlLabel,
    RemoteUrlInvalid,
    AppCommandLabel,
    AppCommandHint,
    AutoStart,
    Browse,
    MenuEntry,
    COUNT_,  // keep last
};

std::string text(Lang lang, Msg msg);

/** One line for the dock banner / settings dialog: the most important problem in the status, "" when all is well. */
std::string describeStatus(Lang lang, const Status& status);

} // namespace olc
```

`plugin/core/Texts.cpp`
```cpp
// SPDX-License-Identifier: GPL-2.0-or-later
#include "Texts.hpp"

#include <array>

namespace olc {

Lang langFromLocale(std::string_view locale) {
    if (locale.size() >= 2 && (locale[0] == 'i' || locale[0] == 'I') && (locale[1] == 't' || locale[1] == 'T') &&
        (locale.size() == 2 || locale[2] == '-' || locale[2] == '_'))
        return Lang::It;
    return Lang::En;
}

namespace {
struct Row {
    const char* it;
    const char* en;
};

// Order = enum order. A test checks the count and that nothing is empty.
const std::array<Row, static_cast<size_t>(Msg::COUNT_)> kRows = {{
    /* DockTitle */ {"OBS Live Clock", "OBS Live Clock"},
    /* FallbackBody */
    {"Questa versione di OBS non può mostrare pagine web in un pannello. Apri OBS Live Clock nel browser, oppure "
     "aggiungi l'indirizzo qui sotto da Docks > Pannelli browser personalizzati.",
     "This OBS cannot show web pages in a dock. Open OBS Live Clock in your browser, or add the address below under "
     "Docks > Custom Browser Docks."},
    /* OpenInBrowser */ {"Apri nel browser", "Open in browser"},
    /* CopyUrl */ {"Copia indirizzo", "Copy address"},
    /* UrlLabel */ {"Indirizzo", "Address"},
    /* StatusChecking */ {"Controllo dell'app in corso…", "Checking the app…"},
    /* StatusLaunching */ {"Avvio dell'app in corso…", "Starting the app…"},
    /* StatusRunning */ {"App collegata", "App connected"},
    /* StatusFailed */
    {"L'app è stata avviata ma non risponde. Controlla il comando di avvio nelle impostazioni.",
     "The app was started but does not answer. Check the launch command in the settings."},
    /* StatusUnavailableLocal */
    {"L'app non risponde e non viene riavviata (avvio automatico spento o limite raggiunto).",
     "The app does not answer and is not restarted (auto start is off or the limit was reached)."},
    /* StatusUnavailableRemote */ {"Il server remoto non risponde.", "The remote server does not answer."},
    /* StatusIncompatibleAppNewer */
    {"L'app è più recente del plugin: aggiorna il plugin di OBS Live Clock.",
     "The app is newer than the plugin: update the OBS Live Clock plugin."},
    /* StatusIncompatibleAppOlder */
    {"L'app è più vecchia del plugin: aggiorna l'app di OBS Live Clock.",
     "The app is older than the plugin: update the OBS Live Clock app."},
    /* LaunchSpecMissing */
    {"L'app non è in esecuzione e non so come avviarla: indica il comando nelle impostazioni.",
     "The app is not running and I do not know how to start it: set the command in the settings."},
    /* LaunchFailed */
    {"Il sistema non ha potuto avviare l'app. Controlla il comando nelle impostazioni.",
     "The system could not start the app. Check the command in the settings."},
    /* CredentialsServerDisabled */
    {"Il server WebSocket di OBS è spento: attivalo in Strumenti > Impostazioni server WebSocket.",
     "The OBS WebSocket server is off: enable it under Tools > WebSocket Server Settings."},
    /* CredentialsUnreadable */
    {"Non riesco a leggere le impostazioni del server WebSocket di OBS: inseriscile a mano nell'app.",
     "I cannot read the OBS WebSocket server settings: enter them by hand in the app."},
    /* CredentialsFailing */
    {"Non riesco a consegnare le credenziali di OBS all'app: riprovo.",
     "I cannot hand the OBS credentials to the app: retrying."},
    /* SettingsTitle */ {"Impostazioni di OBS Live Clock", "OBS Live Clock settings"},
    /* ModeLocal */ {"App su questo computer", "App on this computer"},
    /* ModeRemote */ {"App su un altro computer", "App on another computer"},
    /* RemoteUrlLabel */ {"Indirizzo del server", "Server address"},
    /* RemoteUrlInvalid */
    {"Indirizzo non valido: usa http:// o https:// seguito dal nome del computer (e dalla porta).",
     "Invalid address: use http:// or https:// followed by the computer name (and the port)."},
    /* AppCommandLabel */ {"Comando di avvio dell'app", "App launch command"},
    /* AppCommandHint */ {"Vuoto = usa quello dell'installazione", "Empty = use the installed one"},
    /* AutoStart */ {"Avvia l'app quando OBS è pronto", "Start the app when OBS is ready"},
    /* Browse */ {"Sfoglia…", "Browse…"},
    /* MenuEntry */ {"OBS Live Clock…", "OBS Live Clock…"},
}};
}  // namespace

std::string text(Lang lang, Msg msg) {
    const auto index = static_cast<size_t>(msg);
    if (index >= kRows.size()) return {};
    return lang == Lang::It ? kRows[index].it : kRows[index].en;
}

std::string describeStatus(Lang lang, const Status& s) {
    if (s.compat == Compat::AppNewer) return text(lang, Msg::StatusIncompatibleAppNewer);
    if (s.compat == Compat::AppOlder) return text(lang, Msg::StatusIncompatibleAppOlder);
    if (s.launchSpecMissing) return text(lang, Msg::LaunchSpecMissing);
    if (s.launchFailed) return text(lang, Msg::LaunchFailed);
    switch (s.phase) {
    case LaunchPhase::Checking: return text(lang, Msg::StatusChecking);
    case LaunchPhase::Launching: return text(lang, Msg::StatusLaunching);
    case LaunchPhase::Failed: return text(lang, Msg::StatusFailed);
    case LaunchPhase::Unavailable:
        return text(lang, s.remote ? Msg::StatusUnavailableRemote : Msg::StatusUnavailableLocal);
    case LaunchPhase::Incompatible: return text(lang, Msg::StatusIncompatibleAppNewer);
    case LaunchPhase::Running: break;
    }
    switch (s.credentials) {
    case CredentialState::ServerDisabled: return text(lang, Msg::CredentialsServerDisabled);
    case CredentialState::ConfigUnreadable: return text(lang, Msg::CredentialsUnreadable);
    case CredentialState::Failing: return text(lang, Msg::CredentialsFailing);
    case CredentialState::NotApplicable:
    case CredentialState::Delivered: break;
    }
    return {};
}

}  // namespace olc
```


- [ ] **Step 4: Run, confirm pass** — `bash plugin/scripts/verify.sh` three times, all `PASS`.

- [ ] **Step 5: Commit**

```
git add plugin/core plugin/tests
git commit -m "feat(plugin): supervisor (health, launch, credential and screen delivery) and Italian/English texts"
```

---

### Task 12: Web — "press again to confirm" hint and kiosk panel

**Files:**
- Create: `web/src/ui/control/HotkeyHint.tsx`, `web/src/control/KioskPanel.tsx`, `web/test/ui/hotkey-hint.test.tsx`, `web/test/control/kiosk-panel.test.tsx`, `web/test/core/http-plugin.test.ts`, `web/test/dock/dock-hotkey.test.tsx`
- Modify: `web/src/core/http.ts`, `web/src/core/i18n.ts`, `web/test/support/api.ts`, `web/src/dock/DockScreen.tsx`, `web/src/control/ControlScreen.tsx`, `web/src/ui/control/panels.css`, `web/src/control/control.css`

**Interfaces:**
- Consumes (HTTP contract of Task 8, no code dependency): `GET /api/hotkeys/pending`, `GET /api/kiosk`, `POST /api/kiosk/{start,stop,restart}`, `GET /api/screens`, `GET/PUT /api/settings`.
- Produces: `ApiClient.{hotkeyPending, kioskStatus, kioskAction, screens, kioskConfig, saveKioskConfig}`; `<HotkeyHint api>` (polls every 300 ms, `role="alert"`, hidden on null or error; shown in the dock and in the extended view); `<KioskPanel api>` (enabled, reopen-if-closed, screen select with the monitors OBS reported, Save, Open/Reopen/Close, status every 5 s; a configured monitor that is not connected stays visible and marked, never silently swapped; renders nothing until the settings are known).
- The hint uses `role="alert"` because the dock already has a `role="status"` (command feedback); `fakeApi` gets defaults for all new methods so existing tests are unchanged.
- The Italian string `in attesa dell’elenco schermi da OBS` uses a typographic apostrophe on purpose (no escaping inside the single-quoted TypeScript literal).

- [ ] **Step 1: Write the failing tests**

`web/test/ui/hotkey-hint.test.tsx`
```tsx
// SPDX-License-Identifier: GPL-2.0-or-later
import { act, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { HotkeyPending } from '../../src/core/http';
import { HOTKEY_POLL_MS, HotkeyHint } from '../../src/ui/control/HotkeyHint';
import { fakeApi } from '../support/api';
import { renderLive } from '../support/render';
import { StaticStore, snapshotOf } from '../support/store';

afterEach(() => {
  vi.useRealTimers();
});

function hint(initial: HotkeyPending | null, lang: 'it' | 'en' = 'it') {
  vi.useFakeTimers();
  let current: HotkeyPending | null | Error = initial;
  const api = fakeApi({
    hotkeyPending: async () => {
      if (current instanceof Error) throw current;
      return current;
    },
  });
  const utils = renderLive(<HotkeyHint api={api} />, new StaticStore(snapshotOf<'control'>(null)), lang);
  return { ...utils, set: (v: HotkeyPending | null | Error) => (current = v) };
}

describe('<HotkeyHint>', () => {
  it('shows nothing when no emergency hotkey is waiting for its second press', async () => {
    const h = hint(null);
    await act(async () => {});
    expect(h.container.querySelector('.hotkey-hint')).toBeNull();
  });

  it('asks for the second press by name', async () => {
    const h = hint({ slot: 'next', remainingMs: 800 });
    await act(async () => {});
    expect(screen.getByRole('alert').textContent).toBe('PREMI DI NUOVO NEXT PER CONFERMARE');
    h.unmount();
    const en = hint({ slot: 'time-plus', remainingMs: 800 }, 'en');
    await act(async () => {});
    expect(screen.getByRole('alert').textContent).toBe('PRESS +time AGAIN TO CONFIRM');
    en.unmount();
  });

  it('names every emergency slot, and shows an unknown slot id as it is', async () => {
    for (const [slot, label] of [['prev', 'PREV'], ['time-minus', '−tempo'], ['control-toggle', 'MANUALE/AUTO'], ['future-slot', 'future-slot']] as const) {
      const h = hint({ slot, remainingMs: 500 });
      await act(async () => {});
      expect(screen.getByRole('alert').textContent).toContain(label);
      h.unmount();
    }
  });

  it('follows the server: it disappears once the confirmation is gone, and on an error', async () => {
    const h = hint({ slot: 'next', remainingMs: 800 });
    await act(async () => {});
    expect(screen.queryByRole('alert')).not.toBeNull();
    h.set(null);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(HOTKEY_POLL_MS);
    });
    expect(screen.queryByRole('alert')).toBeNull();
    h.set({ slot: 'prev', remainingMs: 900 });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(HOTKEY_POLL_MS);
    });
    expect(screen.queryByRole('alert')).not.toBeNull();
    h.set(new Error('offline'));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(HOTKEY_POLL_MS);
    });
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('stops polling when it is removed', async () => {
    vi.useFakeTimers();
    const hotkeyPending = vi.fn(async () => null);
    const utils = renderLive(<HotkeyHint api={fakeApi({ hotkeyPending })} />, new StaticStore(snapshotOf<'control'>(null)));
    await act(async () => {});
    utils.unmount();
    const calls = hotkeyPending.mock.calls.length;
    await vi.advanceTimersByTimeAsync(5 * HOTKEY_POLL_MS);
    expect(hotkeyPending.mock.calls.length).toBe(calls);
  });
});
```

`web/test/control/kiosk-panel.test.tsx`
```tsx
// SPDX-License-Identifier: GPL-2.0-or-later
import { act, fireEvent, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ApiClient, KioskConfig, KioskStatusLite } from '../../src/core/http';
import { KioskPanel } from '../../src/control/KioskPanel';
import { fakeApi } from '../support/api';
import { renderLive } from '../support/render';
import { StaticStore, snapshotOf } from '../support/store';

afterEach(() => {
  vi.useRealTimers();
});

const status = (state: string): KioskStatusLite => ({ state, enabled: true, pid: null, restarts: 0, browser: null, screen: null });
const SCREENS = [
  { name: 'DISPLAY1', width: 1920, height: 1080, primary: true },
  { name: 'DISPLAY2', width: 1920, height: 1080, primary: false },
];

async function panel(over: Partial<ApiClient> = {}) {
  const api = fakeApi({ screens: async () => ({ screens: SCREENS, live: true }), kioskStatus: async () => status('stopped'), ...over });
  const utils = renderLive(<KioskPanel api={api} />, new StaticStore(snapshotOf<'control'>(null)));
  await act(async () => {});
  return { ...utils, api };
}
const select = () => screen.getByRole('combobox') as HTMLSelectElement;
const button = (name: string) => screen.getByRole('button', { name }) as HTMLButtonElement;

describe('<KioskPanel>', () => {
  it('lists the primary screen and the monitors OBS reported, and shows the status', async () => {
    await panel();
    expect([...select().options].map((o) => o.textContent)).toEqual(['Schermo principale', 'DISPLAY1 · 1920×1080', 'DISPLAY2 · 1920×1080']);
    expect(screen.getByText('Stato: chiuso')).toBeTruthy();
  });

  it('saves exactly what was chosen, and only when something changed', async () => {
    const saved: KioskConfig[] = [];
    await panel({ saveKioskConfig: async (k) => (saved.push(k), k) });
    expect(button('Salva').disabled).toBe(true);
    fireEvent.change(select(), { target: { value: 'name:DISPLAY2' } });
    fireEvent.click(screen.getByLabelText('Apri il monitor automaticamente'));
    expect(button('Salva').disabled).toBe(false);
    await act(async () => {
      fireEvent.click(button('Salva'));
    });
    expect(saved).toEqual([{ enabled: true, screen: { kind: 'name', name: 'DISPLAY2' }, restart: true }]);
    expect(button('Salva').disabled).toBe(true);
  });

  it('a configured monitor that is not connected stays visible and is marked, never silently swapped', async () => {
    await panel({ kioskConfig: async () => ({ enabled: true, screen: { kind: 'name', name: 'TV-SALA' }, restart: true }) });
    expect(select().value).toBe('name:TV-SALA');
    expect([...select().options].map((o) => o.textContent)).toContain('TV-SALA (non collegato)');
  });

  it('a fixed position set in the settings file is shown and kept', async () => {
    await panel({ kioskConfig: async () => ({ enabled: true, screen: { kind: 'position', x: 1920, y: 0 }, restart: true }) });
    expect(select().value).toBe('fixed');
    expect([...select().options].map((o) => o.textContent)).toContain('Posizione fissa 1920,0');
  });

  it('shows a plain explanation for every state, and the warning ones in the alert colour', async () => {
    const { container } = await panel({ kioskStatus: async () => status('screen_missing') });
    expect(screen.getByText('Stato: schermo non trovato: non apro nulla')).toBeTruthy();
    expect(container.querySelector('.kiosk-status')?.getAttribute('data-state')).toBe('screen_missing');
  });

  it('Open, Reopen and Close call the server and show the answer', async () => {
    const kioskAction = vi.fn(async (a: 'start' | 'stop' | 'restart') => status(a === 'stop' ? 'stopped' : 'running'));
    await panel({ kioskAction });
    await act(async () => {
      fireEvent.click(button('Apri'));
    });
    expect(kioskAction).toHaveBeenLastCalledWith('start');
    expect(screen.getByText('Stato: aperto')).toBeTruthy();
    await act(async () => {
      fireEvent.click(button('Riapri'));
    });
    expect(kioskAction).toHaveBeenLastCalledWith('restart');
    await act(async () => {
      fireEvent.click(button('Chiudi'));
    });
    expect(kioskAction).toHaveBeenLastCalledWith('stop');
    expect(screen.getByText('Stato: chiuso')).toBeTruthy();
  });

  it('a failed save is shown and the draft is kept', async () => {
    await panel({ saveKioskConfig: async () => Promise.reject(new Error('409')) });
    fireEvent.click(screen.getByLabelText('Riapri se si chiude'));
    await act(async () => {
      fireEvent.click(button('Salva'));
    });
    expect(screen.getByText('Impostazioni non salvate')).toBeTruthy();
    expect(button('Salva').disabled).toBe(false);
  });

  it('refreshes the status every five seconds', async () => {
    vi.useFakeTimers();
    const kioskStatus = vi.fn(async () => status('running'));
    renderLive(<KioskPanel api={fakeApi({ kioskStatus })} />, new StaticStore(snapshotOf<'control'>(null)));
    await act(async () => {});
    const first = kioskStatus.mock.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    expect(kioskStatus.mock.calls.length).toBe(first + 1);
  });

  it('renders nothing until the settings are known (no guessed defaults)', async () => {
    const { container } = await panel({ kioskConfig: async () => Promise.reject(new Error('offline')) });
    expect(container.querySelector('.kiosk')).toBeNull();
  });
});
```

`web/test/core/http-plugin.test.ts`
```ts
// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it, vi } from 'vitest';
import { ApiError, httpApi } from '../../src/core/http';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

describe('httpApi: hotkeys, screens, kiosk', () => {
  it('hotkeyPending returns the pending confirmation or null', async () => {
    const fetchFn = vi.fn(async () => json({ pending: { slot: 'next', remainingMs: 640 } }));
    expect(await httpApi(fetchFn).hotkeyPending()).toEqual({ slot: 'next', remainingMs: 640 });
    expect(fetchFn).toHaveBeenCalledWith('/api/hotkeys/pending');
    expect(await httpApi(async () => json({ pending: null })).hotkeyPending()).toBeNull();
  });

  it('kioskAction POSTs to the right path and parses the status', async () => {
    const fetchFn = vi.fn(async () => json({ state: 'running', enabled: true, pid: 7, restarts: 0, browser: 'chrome.exe', screen: 'DISPLAY2' }));
    const status = await httpApi(fetchFn).kioskAction('restart');
    expect(status.state).toBe('running');
    expect(fetchFn).toHaveBeenCalledWith('/api/kiosk/restart', { method: 'POST' });
  });

  it('screens parses the plugin list', async () => {
    const api = httpApi(async () => json({ live: true, screens: [{ name: 'D1', x: 0, y: 0, width: 1920, height: 1080, devicePixelRatio: 1, primary: true }] }));
    expect(await api.screens()).toEqual({ live: true, screens: [{ name: 'D1', width: 1920, height: 1080, primary: true }] });
  });

  it('kioskConfig reads only the kiosk block and never touches the OBS settings', async () => {
    const api = httpApi(async () => json({ port: 4460, lanAccess: false, obs: { host: 'x', port: 1, hasPassword: true }, kiosk: { enabled: true, screen: { kind: 'primary' }, restart: true } }));
    expect(await api.kioskConfig()).toEqual({ enabled: true, screen: { kind: 'primary' }, restart: true });
  });

  it('saveKioskConfig PUTs {kiosk} as JSON', async () => {
    const fetchFn = vi.fn(async () => json({ kiosk: { enabled: false, screen: { kind: 'name', name: 'D2' }, restart: true } }));
    await httpApi(fetchFn).saveKioskConfig({ enabled: false, screen: { kind: 'name', name: 'D2' }, restart: true });
    expect(fetchFn).toHaveBeenCalledWith('/api/settings', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ kiosk: { enabled: false, screen: { kind: 'name', name: 'D2' }, restart: true } }),
    });
  });

  it('an error answer becomes an ApiError with the server code', async () => {
    const api = httpApi(async () => json({ error: 'settings_file_invalid' }, 409));
    await expect(api.saveKioskConfig({ enabled: true, screen: { kind: 'primary' }, restart: true })).rejects.toMatchObject({
      status: 409,
      code: 'settings_file_invalid',
    });
    await expect(api.saveKioskConfig({ enabled: true, screen: { kind: 'primary' }, restart: true })).rejects.toBeInstanceOf(ApiError);
  });
});
```

`web/test/dock/dock-hotkey.test.tsx`
```tsx
// SPDX-License-Identifier: GPL-2.0-or-later
import { act, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DockScreen } from '../../src/dock/DockScreen';
import { fakeApi } from '../support/api';
import { renderLive } from '../support/render';
import { StaticStore, snapshotOf } from '../support/store';
import { controlView } from '../support/views';

afterEach(() => {
  vi.useRealTimers();
});

describe('<DockScreen> hotkey confirmation (DT-9)', () => {
  it('says "press again to confirm" while an emergency hotkey waits for its second press', async () => {
    const api = fakeApi({ hotkeyPending: async () => ({ slot: 'next', remainingMs: 700 }) });
    renderLive(<DockScreen api={api} search="" />, new StaticStore(snapshotOf<'control'>(controlView())));
    await act(async () => {});
    expect(screen.getByRole('alert').textContent).toBe('PREMI DI NUOVO NEXT PER CONFERMARE');
  });

  it('shows nothing extra when no hotkey is pending', async () => {
    renderLive(<DockScreen api={fakeApi()} search="" />, new StaticStore(snapshotOf<'control'>(controlView())));
    await act(async () => {});
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
```

Changes to `web/test/support/api.ts`:
```diff
--- a/web/test/support/api.ts
+++ b/web/test/support/api.ts
@@ -7,4 +7,10 @@ export function fakeApi(over: Partial<ApiClient> = {}): ApiClient {
     loadEpisode: async () => {},
     obsStatus: async () => ({ connection: 'connected', deck: { capability: 'events' } }),
+    hotkeyPending: async () => null,
+    kioskStatus: async () => ({ state: 'disabled', enabled: false, pid: null, restarts: 0, browser: null, screen: null }),
+    kioskAction: async () => ({ state: 'running', enabled: true, pid: 1, restarts: 0, browser: 'chrome.exe', screen: 'DISPLAY2' }),
+    screens: async () => ({ screens: [], live: false }),
+    kioskConfig: async () => ({ enabled: false, screen: { kind: 'primary' }, restart: true }),
+    saveKioskConfig: async (kiosk) => kiosk,
     ...over,
   };
```


- [ ] **Step 2: Run, confirm failure** — `pnpm vitest run web/test/ui/hotkey-hint web/test/control/kiosk web/test/core/http-plugin web/test/dock/dock-hotkey` -> FAIL.

- [ ] **Step 3: Implement**

Changes to `web/src/core/http.ts`:
```diff
--- a/web/src/core/http.ts
+++ b/web/src/core/http.ts
@@ -13,4 +13,32 @@ export interface ObsStatusLite {
 }
 
+/** A first press of an emergency hotkey that still waits for its second press (DT-9). */
+export interface HotkeyPending {
+  slot: string;
+  remainingMs: number;
+}
+
+export type KioskScreenChoice = { kind: 'primary' } | { kind: 'name'; name: string } | { kind: 'position'; x: number; y: number };
+export interface KioskConfig {
+  enabled: boolean;
+  screen: KioskScreenChoice;
+  restart: boolean;
+  browserPath?: string;
+}
+export interface KioskStatusLite {
+  state: string;
+  enabled: boolean;
+  pid: number | null;
+  restarts: number;
+  browser: string | null;
+  screen: string | null;
+}
+export interface ScreenLite {
+  name: string;
+  width: number;
+  height: number;
+  primary: boolean;
+}
+
 /** The HTTP calls the dock and the control view make (same origin; Vite proxies /api in dev). */
 export interface ApiClient {
@@ -18,4 +46,10 @@ export interface ApiClient {
   loadEpisode(id: string): Promise<void>;
   obsStatus(): Promise<ObsStatusLite>;
+  hotkeyPending(): Promise<HotkeyPending | null>;
+  kioskStatus(): Promise<KioskStatusLite>;
+  kioskAction(action: 'start' | 'stop' | 'restart'): Promise<KioskStatusLite>;
+  screens(): Promise<{ screens: ScreenLite[]; live: boolean }>;
+  kioskConfig(): Promise<KioskConfig>;
+  saveKioskConfig(kiosk: KioskConfig): Promise<KioskConfig>;
 }
 
@@ -36,4 +70,30 @@ const ObsStatusSchema = z.object({
 });
 
+const HotkeyPendingSchema = z.object({ pending: z.object({ slot: z.string(), remainingMs: z.number() }).nullable() });
+const KioskScreenSchema = z.discriminatedUnion('kind', [
+  z.object({ kind: z.literal('primary') }),
+  z.object({ kind: z.literal('name'), name: z.string() }),
+  z.object({ kind: z.literal('position'), x: z.number(), y: z.number() }),
+]);
+const KioskConfigSchema = z.object({
+  enabled: z.boolean(),
+  screen: KioskScreenSchema,
+  restart: z.boolean(),
+  browserPath: z.string().optional(),
+});
+const KioskStatusSchema = z.object({
+  state: z.string(),
+  enabled: z.boolean(),
+  pid: z.number().nullable(),
+  restarts: z.number(),
+  browser: z.string().nullable(),
+  screen: z.string().nullable(),
+});
+const ScreensSchema = z.object({
+  screens: z.array(z.object({ name: z.string(), width: z.number(), height: z.number(), primary: z.boolean() })),
+  live: z.boolean(),
+});
+const SettingsSchema = z.object({ kiosk: KioskConfigSchema });
+
 async function failure(res: Response): Promise<ApiError> {
   let code = `http_${res.status}`;
@@ -69,4 +129,38 @@ export function httpApi(fetchFn: typeof fetch = (input, init) => fetch(input, in
       return ObsStatusSchema.parse(await res.json());
     },
+    async hotkeyPending() {
+      const res = await fetchFn('/api/hotkeys/pending');
+      if (!res.ok) throw await failure(res);
+      return HotkeyPendingSchema.parse(await res.json()).pending;
+    },
+    async kioskStatus() {
+      const res = await fetchFn('/api/kiosk');
+      if (!res.ok) throw await failure(res);
+      return KioskStatusSchema.parse(await res.json());
+    },
+    async kioskAction(action) {
+      const res = await fetchFn(`/api/kiosk/${action}`, { method: 'POST' });
+      if (!res.ok) throw await failure(res);
+      return KioskStatusSchema.parse(await res.json());
+    },
+    async screens() {
+      const res = await fetchFn('/api/screens');
+      if (!res.ok) throw await failure(res);
+      return ScreensSchema.parse(await res.json());
+    },
+    async kioskConfig() {
+      const res = await fetchFn('/api/settings');
+      if (!res.ok) throw await failure(res);
+      return SettingsSchema.parse(await res.json()).kiosk;
+    },
+    async saveKioskConfig(kiosk) {
+      const res = await fetchFn('/api/settings', {
+        method: 'PUT',
+        headers: { 'content-type': 'application/json' },
+        body: JSON.stringify({ kiosk }),
+      });
+      if (!res.ok) throw await failure(res);
+      return SettingsSchema.parse(await res.json()).kiosk;
+    },
   };
 }
```

Changes to `web/src/core/i18n.ts`:
```diff
--- a/web/src/core/i18n.ts
+++ b/web/src/core/i18n.ts
@@ -126,4 +126,34 @@ export const IT = {
   evOffScriptEnd: 'Rientrati in scaletta',
   evAmbiguous: 'Posizione incerta',
+  hotkeyConfirm: 'PREMI DI NUOVO {slot} PER CONFERMARE',
+  hotkeySlotNext: 'NEXT',
+  hotkeySlotPrev: 'PREV',
+  hotkeySlotTimePlus: '+tempo',
+  hotkeySlotTimeMinus: '−tempo',
+  hotkeySlotControl: 'MANUALE/AUTO',
+  kioskTitle: 'MONITOR CONDUTTORE',
+  kioskEnabled: 'Apri il monitor automaticamente',
+  kioskReopen: 'Riapri se si chiude',
+  kioskScreen: 'Schermo',
+  kioskScreenPrimary: 'Schermo principale',
+  kioskScreenNamed: '{name} · {w}×{h}',
+  kioskScreenMissing: '{name} (non collegato)',
+  kioskScreenFixed: 'Posizione fissa {x},{y}',
+  kioskStart: 'Apri',
+  kioskStop: 'Chiudi',
+  kioskRestartNow: 'Riapri',
+  kioskSave: 'Salva',
+  kioskStatus: 'Stato: {state}',
+  kioskStateDisabled: 'spento',
+  kioskStateStopped: 'chiuso',
+  kioskStateRunning: 'aperto',
+  kioskStateRestarting: 'riapertura in corso…',
+  kioskStateWaiting: 'in attesa dell’elenco schermi da OBS',
+  kioskStateScreenMissing: 'schermo non trovato: non apro nulla',
+  kioskStateBrowserMissing: 'browser non trovato',
+  kioskStateSpawnFailed: 'impossibile avviare il browser',
+  kioskStateSuspended: 'fermato dopo troppe riaperture: premi Apri',
+  kioskStateHandedOff: 'aperto in un browser già in esecuzione',
+  kioskSaveFailed: 'Impostazioni non salvate',
 } as const;
 
@@ -252,4 +282,34 @@ export const EN: Record<MessageKey, string> = {
   evOffScriptEnd: 'Back on script',
   evAmbiguous: 'Uncertain position',
+  hotkeyConfirm: 'PRESS {slot} AGAIN TO CONFIRM',
+  hotkeySlotNext: 'NEXT',
+  hotkeySlotPrev: 'PREV',
+  hotkeySlotTimePlus: '+time',
+  hotkeySlotTimeMinus: '−time',
+  hotkeySlotControl: 'MANUAL/AUTO',
+  kioskTitle: 'PRESENTER MONITOR',
+  kioskEnabled: 'Open the monitor automatically',
+  kioskReopen: 'Reopen if it closes',
+  kioskScreen: 'Screen',
+  kioskScreenPrimary: 'Primary screen',
+  kioskScreenNamed: '{name} · {w}×{h}',
+  kioskScreenMissing: '{name} (not connected)',
+  kioskScreenFixed: 'Fixed position {x},{y}',
+  kioskStart: 'Open',
+  kioskStop: 'Close',
+  kioskRestartNow: 'Reopen',
+  kioskSave: 'Save',
+  kioskStatus: 'Status: {state}',
+  kioskStateDisabled: 'off',
+  kioskStateStopped: 'closed',
+  kioskStateRunning: 'open',
+  kioskStateRestarting: 'reopening…',
+  kioskStateWaiting: 'waiting for the screen list from OBS',
+  kioskStateScreenMissing: 'screen not found: nothing is opened',
+  kioskStateBrowserMissing: 'browser not found',
+  kioskStateSpawnFailed: 'could not start the browser',
+  kioskStateSuspended: 'stopped after too many reopenings: press Open',
+  kioskStateHandedOff: 'opened in a browser that was already running',
+  kioskSaveFailed: 'Settings not saved',
 };
```

`web/src/ui/control/HotkeyHint.tsx`
```tsx
// SPDX-License-Identifier: GPL-2.0-or-later
import { useEffect, useState } from 'react';
import type { ApiClient, HotkeyPending } from '../../core/http';
import type { MessageKey } from '../../core/i18n';
import { useLive } from '../live-context';

export const HOTKEY_POLL_MS = 300;

const SLOT_KEY: Record<string, MessageKey> = {
  next: 'hotkeySlotNext',
  prev: 'hotkeySlotPrev',
  'time-plus': 'hotkeySlotTimePlus',
  'time-minus': 'hotkeySlotTimeMinus',
  'control-toggle': 'hotkeySlotControl',
};

/** Polls GET /api/hotkeys/pending. null while unknown or on error: no hint is better than a wrong one. */
export function useHotkeyPending(api: ApiClient, intervalMs = HOTKEY_POLL_MS): HotkeyPending | null {
  const [pending, setPending] = useState<HotkeyPending | null>(null);
  useEffect(() => {
    let alive = true;
    const poll = () => {
      api.hotkeyPending().then(
        (p) => {
          if (alive) setPending(p);
        },
        () => {
          if (alive) setPending(null);
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
  return pending;
}

/** DT-9: after the first press of an emergency hotkey the dock says "press again to confirm". */
export function HotkeyHint({ api }: { api: ApiClient }) {
  const { t } = useLive();
  const pending = useHotkeyPending(api);
  if (pending === null) return null;
  const key = SLOT_KEY[pending.slot];
  return (
    <div className="hotkey-hint" role="alert">
      {t('hotkeyConfirm', { slot: key === undefined ? pending.slot : t(key) })}
    </div>
  );
}
```

`web/src/control/KioskPanel.tsx`
```tsx
// SPDX-License-Identifier: GPL-2.0-or-later
import { useCallback, useEffect, useState } from 'react';
import type { ApiClient, KioskConfig, KioskScreenChoice, KioskStatusLite, ScreenLite } from '../core/http';
import type { MessageKey } from '../core/i18n';
import { useLive } from '../ui/live-context';

export const KIOSK_POLL_MS = 5_000;

const STATE_KEY: Record<string, MessageKey> = {
  disabled: 'kioskStateDisabled',
  stopped: 'kioskStateStopped',
  running: 'kioskStateRunning',
  restarting: 'kioskStateRestarting',
  waiting_for_screens: 'kioskStateWaiting',
  screen_missing: 'kioskStateScreenMissing',
  browser_not_found: 'kioskStateBrowserMissing',
  spawn_failed: 'kioskStateSpawnFailed',
  suspended: 'kioskStateSuspended',
  handed_off: 'kioskStateHandedOff',
};

const PRIMARY = 'primary';
const FIXED = 'fixed';
const nameValue = (name: string) => `name:${name}`;
const choiceValue = (c: KioskScreenChoice) => (c.kind === 'primary' ? PRIMARY : c.kind === 'name' ? nameValue(c.name) : FIXED);

/** TECH-DESIGN §9 / SPEC §7: choose the monitor of the presenter and open or close it. Lives in the extended view. */
export function KioskPanel({ api }: { api: ApiClient }) {
  const { t } = useLive();
  const [config, setConfig] = useState<KioskConfig | null>(null);
  const [draft, setDraft] = useState<KioskConfig | null>(null);
  const [screens, setScreens] = useState<ScreenLite[]>([]);
  const [status, setStatus] = useState<KioskStatusLite | null>(null);
  const [failed, setFailed] = useState(false);

  const refresh = useCallback(() => {
    api.kioskStatus().then(setStatus, () => setStatus(null));
    api.screens().then((s) => setScreens(s.screens), () => setScreens([]));
  }, [api]);

  useEffect(() => {
    let alive = true;
    api.kioskConfig().then(
      (c) => {
        if (!alive) return;
        setConfig(c);
        setDraft(c);
      },
      () => {},
    );
    refresh();
    const handle = setInterval(refresh, KIOSK_POLL_MS);
    return () => {
      alive = false;
      clearInterval(handle);
    };
  }, [api, refresh]);

  if (draft === null) return null;
  const dirty = JSON.stringify(draft) !== JSON.stringify(config);
  const current = choiceValue(draft.screen);
  const known = new Set(screens.map((s) => s.name));
  const missing = draft.screen.kind === 'name' && !known.has(draft.screen.name) ? draft.screen.name : null;

  const choose = (value: string) => {
    if (value === PRIMARY) setDraft({ ...draft, screen: { kind: 'primary' } });
    else if (value.startsWith('name:')) setDraft({ ...draft, screen: { kind: 'name', name: value.slice(5) } });
  };
  const save = () => {
    setFailed(false);
    api.saveKioskConfig(draft).then(
      (saved) => {
        setConfig(saved);
        setDraft(saved);
        refresh();
      },
      () => setFailed(true),
    );
  };
  const act = (action: 'start' | 'stop' | 'restart') => () => void api.kioskAction(action).then(setStatus, () => {});

  return (
    <section className="panel kiosk">
      <h2 className="panel-title">{t('kioskTitle')}</h2>
      <label className="kiosk-row">
        <input type="checkbox" checked={draft.enabled} onChange={(e) => setDraft({ ...draft, enabled: e.target.checked })} />
        {t('kioskEnabled')}
      </label>
      <label className="kiosk-row">
        <input type="checkbox" checked={draft.restart} onChange={(e) => setDraft({ ...draft, restart: e.target.checked })} />
        {t('kioskReopen')}
      </label>
      <label className="kiosk-row">
        {t('kioskScreen')}
        <select value={current} onChange={(e) => choose(e.target.value)}>
          <option value={PRIMARY}>{t('kioskScreenPrimary')}</option>
          {screens.map((s) => (
            <option key={s.name} value={nameValue(s.name)}>
              {t('kioskScreenNamed', { name: s.name, w: s.width, h: s.height })}
            </option>
          ))}
          {missing !== null ? <option value={nameValue(missing)}>{t('kioskScreenMissing', { name: missing })}</option> : null}
          {draft.screen.kind === 'position' ? (
            <option value={FIXED}>{t('kioskScreenFixed', { x: draft.screen.x, y: draft.screen.y })}</option>
          ) : null}
        </select>
      </label>
      {status !== null ? (
        <div className="kiosk-status" data-state={status.state}>
          {t('kioskStatus', { state: STATE_KEY[status.state] === undefined ? status.state : t(STATE_KEY[status.state]!) })}
        </div>
      ) : null}
      {failed ? <div className="alert">{t('kioskSaveFailed')}</div> : null}
      <div className="kiosk-actions">
        <button type="button" disabled={!dirty} onClick={save}>
          {t('kioskSave')}
        </button>
        <button type="button" onClick={act('start')}>
          {t('kioskStart')}
        </button>
        <button type="button" onClick={act('restart')}>
          {t('kioskRestartNow')}
        </button>
        <button type="button" onClick={act('stop')}>
          {t('kioskStop')}
        </button>
      </div>
    </section>
  );
}
```

Changes to `web/src/dock/DockScreen.tsx`:
```diff
--- a/web/src/dock/DockScreen.tsx
+++ b/web/src/dock/DockScreen.tsx
@@ -5,4 +5,5 @@ import { Alerts } from '../ui/control/Alerts';
 import { CommandFeedback } from '../ui/control/CommandFeedback';
 import { EmergencyPanel } from '../ui/control/EmergencyPanel';
+import { HotkeyHint } from '../ui/control/HotkeyHint';
 import { MessagePanel } from '../ui/control/MessagePanel';
 import { StatusPanel } from '../ui/control/StatusPanel';
@@ -25,4 +26,5 @@ export function DockScreen({ api = defaultApi, search = typeof window === 'undef
   return (
     <div className="dock">
+      <HotkeyHint api={api} />
       {ready && view === null ? (
         <section className="panel">
```

Changes to `web/src/control/ControlScreen.tsx`:
```diff
--- a/web/src/control/ControlScreen.tsx
+++ b/web/src/control/ControlScreen.tsx
@@ -5,4 +5,5 @@ import { Alerts } from '../ui/control/Alerts';
 import { CommandFeedback } from '../ui/control/CommandFeedback';
 import { EmergencyPanel } from '../ui/control/EmergencyPanel';
+import { HotkeyHint } from '../ui/control/HotkeyHint';
 import { MessagePanel } from '../ui/control/MessagePanel';
 import { StatusPanel } from '../ui/control/StatusPanel';
@@ -12,4 +13,5 @@ import { useLive, useSnapshot } from '../ui/live-context';
 import { EpisodePicker } from './EpisodePicker';
 import { EventFeed, useEventFeed } from './EventFeed';
+import { KioskPanel } from './KioskPanel';
 import { RundownTable } from './RundownTable';
 
@@ -33,4 +35,5 @@ export function ControlScreen({ api = defaultApi }: { api?: ApiClient }) {
         <h1 className="label-text">{view === null ? t('noEpisode') : view.episode.name}</h1>
       </header>
+      <HotkeyHint api={api} />
       <main className="c-main">
         <div className="c-rundown">{ready && view !== null ? <RundownTable view={view} run={run} disabled={commandsDisabled} /> : null}</div>
@@ -51,4 +54,5 @@ export function ControlScreen({ api = defaultApi }: { api?: ApiClient }) {
           <EventFeed entries={feed} />
           <EpisodePicker api={api} loadedId={view?.episode.id ?? null} />
+          <KioskPanel api={api} />
         </div>
       </main>
```

Changes to `web/src/ui/control/panels.css`:
```diff
--- a/web/src/ui/control/panels.css
+++ b/web/src/ui/control/panels.css
@@ -43,2 +43,7 @@ button[aria-pressed='true'] { border-color: var(--fg); font-weight: 700; }
 .confirm-button[data-danger='true'] { border-color: var(--red); }
 .cmd-feedback { min-height: 1.4em; color: var(--amber); font-weight: 700; }
+
+.hotkey-hint {
+  position: sticky; top: 0; z-index: 5; text-align: center; font-weight: 700; padding: 8px 10px;
+  color: var(--bg); background: var(--amber); border-radius: 6px;
+}
```

Changes to `web/src/control/control.css`:
```diff
--- a/web/src/control/control.css
+++ b/web/src/control/control.css
@@ -30,2 +30,8 @@
 .episode-date { color: var(--fg-dim); }
 .empty { color: var(--fg-dim); }
+
+.kiosk-row { display: flex; align-items: center; gap: 8px; }
+.kiosk-row select { flex: 1 1 auto; min-width: 0; font: inherit; color: var(--fg); background: var(--bg); border: 1px solid var(--tile-border); border-radius: 6px; padding: 4px 6px; }
+.kiosk-status { color: var(--fg-dim); font-weight: 700; }
+.kiosk-status[data-state='suspended'], .kiosk-status[data-state='screen_missing'], .kiosk-status[data-state='browser_not_found'], .kiosk-status[data-state='spawn_failed'] { color: var(--amber); }
+.kiosk-actions { display: flex; flex-wrap: wrap; gap: 6px; }
```


- [ ] **Step 4: Run everything** — `pnpm test && pnpm typecheck && pnpm build`. The i18n parity test (`web/test/core/i18n.test.ts`) must still pass.

- [ ] **Step 5: Commit**

```
git add web
git commit -m "feat(web): hotkey confirmation hint in dock and extended view, kiosk panel"
```

---

### Task 13: Glue — dock host, settings dialog, OBS adapters

**Files:**
- Create: `plugin/src/DockHost.hpp`, `plugin/src/DockHost.cpp`, `plugin/src/SettingsStore.hpp`, `plugin/src/SettingsStore.cpp`, `plugin/src/SettingsDialog.hpp`, `plugin/src/SettingsDialog.cpp`, `plugin/src/SystemAdapters.hpp`, `plugin/src/SystemAdapters.cpp`

**Interfaces:**
- Consumes: Tasks 9 and 10. Produces: `olc::DockHost : QWidget` (browser widget when the panel API exists, else the fallback page with the address, "open in browser" and "copy address"; a banner for the one problem to show; `present(url, problem)`, `reloadBrowser()`, `hasBrowser()`; **it navigates again 1.5 s after it is first shown**, because on a fresh CEF profile the first page stayed on OBS's own logo page — verified fix); `SettingsStore` (`<OBS config>/plugin_config/obs-live-clock/settings.json`, atomic `QSaveFile`); `SettingsDialog` (local/remote, address, launch command, auto start; an invalid remote address keeps the dialog open); `readTextFile`, `launchDetached(LaunchSpec)` (`QProcess` with an argument list, never a shell; on Windows `CREATE_NO_WINDOW | CREATE_NEW_PROCESS_GROUP` and a hidden window so `node.exe` shows no console), `monotonicMs`, `obsWebsocketConfigPath`, `readLegacyObsWsValues`, `commandLineArguments`, `resolveDataDir`.
- No unit tests (they need OBS and Qt): the rules are pinned by Task 15's source-inspection tests and by the checklist. **Compile and link is the check**: `bash plugin/scripts/build-plugin.sh` must succeed with no warning from these files.

- [ ] **Step 1: Implement**

`plugin/src/DockHost.hpp`
```cpp
// SPDX-License-Identifier: GPL-2.0-or-later
#pragma once
#include <QShowEvent>
#include <QString>
#include <QWidget>

#include "Texts.hpp"

class QLabel;
class QLineEdit;
class QPushButton;
class QStackedLayout;
namespace olc::panel {
class QCefWidget;
}

namespace olc {

/**
 * The content of the "OBS Live Clock" dock. With obs-browser's panel API available it holds a browser widget on
 * /dock; otherwise (Wayland, obs-browser missing or too old) a small page with the address to paste into
 * Docks > Custom Browser Docks and an "open in browser" button. A banner above shows the one thing that is wrong.
 * All methods run on the GUI thread.
 */
class DockHost : public QWidget {
    Q_OBJECT
public:
    explicit DockHost(Lang lang, QWidget* parent = nullptr);

    bool hasBrowser() const { return browser_ != nullptr; }
    QString url() const { return url_; }

    /** Points the dock at `url` ("" = nothing valid to show) and shows `problem` in the banner ("" = hide it). */
    void present(const QString& url, const QString& problem);
    /** The app just became reachable (or restarted): reload the page, it may be showing a connection error. */
    void reloadBrowser();

protected:
    void showEvent(QShowEvent* event) override;

private slots:
    void openInBrowser();
    void copyUrl();

private:
    Lang lang_;
    QString url_;
    QLabel* banner_ = nullptr;
    QStackedLayout* stack_ = nullptr;
    panel::QCefWidget* browser_ = nullptr;
    QLabel* fallbackBody_ = nullptr;
    QLineEdit* urlEdit_ = nullptr;
    QPushButton* openButton_ = nullptr;
    QPushButton* copyButton_ = nullptr;
};

}  // namespace olc
```

`plugin/src/DockHost.cpp`
```cpp
// SPDX-License-Identifier: GPL-2.0-or-later
#include "DockHost.hpp"

#include <QApplication>
#include <QClipboard>
#include <QDesktopServices>
#include <QHBoxLayout>
#include <QLabel>
#include <QLineEdit>
#include <QPushButton>
#include <QStackedLayout>
#include <QTimer>
#include <QUrl>
#include <QVBoxLayout>

#include "BrowserPanel.hpp"

namespace olc {

DockHost::DockHost(Lang lang, QWidget* parent) : QWidget(parent), lang_(lang) {
    auto* root = new QVBoxLayout(this);
    root->setContentsMargins(0, 0, 0, 0);
    root->setSpacing(0);

    banner_ = new QLabel(this);
    banner_->setWordWrap(true);
    banner_->setStyleSheet("background:#7a1f1f;color:#fff;padding:6px 8px;");
    banner_->hide();
    root->addWidget(banner_);

    auto* content = new QWidget(this);
    stack_ = new QStackedLayout(content);
    root->addWidget(content, 1);

    // The browser starts on about:blank: the real URL is known only once the plugin has resolved the app's port.
    browser_ = panel::createBrowserWidget(content, "about:blank");
    if (browser_) stack_->addWidget(browser_);

    auto* fallback = new QWidget(content);
    auto* fb = new QVBoxLayout(fallback);
    fallbackBody_ = new QLabel(QString::fromStdString(text(lang_, Msg::FallbackBody)), fallback);
    fallbackBody_->setWordWrap(true);
    fb->addWidget(fallbackBody_);
    fb->addWidget(new QLabel(QString::fromStdString(text(lang_, Msg::UrlLabel)), fallback));
    urlEdit_ = new QLineEdit(fallback);
    urlEdit_->setReadOnly(true);
    fb->addWidget(urlEdit_);
    auto* row = new QHBoxLayout();
    openButton_ = new QPushButton(QString::fromStdString(text(lang_, Msg::OpenInBrowser)), fallback);
    copyButton_ = new QPushButton(QString::fromStdString(text(lang_, Msg::CopyUrl)), fallback);
    row->addWidget(openButton_);
    row->addWidget(copyButton_);
    fb->addLayout(row);
    fb->addStretch(1);
    stack_->addWidget(fallback);
    connect(openButton_, &QPushButton::clicked, this, &DockHost::openInBrowser);
    connect(copyButton_, &QPushButton::clicked, this, &DockHost::copyUrl);

    stack_->setCurrentWidget(browser_ ? static_cast<QWidget*>(browser_) : fallback);
}

void DockHost::present(const QString& url, const QString& problem) {
    if (url != url_) {
        url_ = url;
        urlEdit_->setText(url);
        openButton_->setEnabled(!url.isEmpty());
        copyButton_->setEnabled(!url.isEmpty());
        if (browser_ && !url.isEmpty()) browser_->setURL(url.toStdString());
    }
    banner_->setText(problem);
    banner_->setVisible(!problem.isEmpty());
}

void DockHost::showEvent(QShowEvent* event) {
    QWidget::showEvent(event);
    // The browser creates its page when it is first shown. Navigate again once it had time to start: a page that
    // was created before the app answered, or on a fresh CEF profile, would otherwise stay on whatever it first showed.
    if (browser_ && !url_.isEmpty()) QTimer::singleShot(1500, this, [this] { if (browser_ && !url_.isEmpty() && isVisible()) browser_->setURL(url_.toStdString()); });
}

void DockHost::reloadBrowser() {
    if (browser_ && !url_.isEmpty()) browser_->reloadPage();
}

void DockHost::openInBrowser() {
    if (!url_.isEmpty()) QDesktopServices::openUrl(QUrl(url_));
}

void DockHost::copyUrl() {
    if (!url_.isEmpty()) QApplication::clipboard()->setText(url_);
}

}  // namespace olc
```

`plugin/src/SettingsStore.hpp`
```cpp
// SPDX-License-Identifier: GPL-2.0-or-later
#pragma once
#include <QString>

#include "PluginSettings.hpp"

namespace olc {

/** settings.json in OBS's per-module config folder: <OBS config>/plugin_config/obs-live-clock/settings.json. */
class SettingsStore {
public:
    QString path() const;
    PluginSettings load() const;  // defaults when the file is missing or unreadable
    bool save(const PluginSettings& settings) const;  // atomic (QSaveFile)
};

}  // namespace olc
```

`plugin/src/SettingsStore.cpp`
```cpp
// SPDX-License-Identifier: GPL-2.0-or-later
#include "SettingsStore.hpp"

#include <obs-module.h>
#include <util/bmem.h>

#include <QDir>
#include <QFile>
#include <QFileInfo>
#include <QSaveFile>

namespace olc {

QString SettingsStore::path() const {
    char* raw = obs_module_config_path("settings.json");
    const QString result = raw ? QString::fromUtf8(raw) : QString();
    bfree(raw);
    return result;
}

PluginSettings SettingsStore::load() const {
    QFile file(path());
    if (!file.open(QIODevice::ReadOnly)) return {};
    const QByteArray bytes = file.readAll();
    return parsePluginSettings(std::string_view(bytes.constData(), static_cast<size_t>(bytes.size())));
}

bool SettingsStore::save(const PluginSettings& settings) const {
    const QString target = path();
    if (target.isEmpty()) return false;
    QDir().mkpath(QFileInfo(target).absolutePath());
    QSaveFile file(target);
    if (!file.open(QIODevice::WriteOnly)) return false;
    const std::string json = serializePluginSettings(settings);
    file.write(json.data(), static_cast<qint64>(json.size()));
    return file.commit();
}

}  // namespace olc
```

`plugin/src/SettingsDialog.hpp`
```cpp
// SPDX-License-Identifier: GPL-2.0-or-later
#pragma once
#include <QDialog>
#include <optional>

#include "PluginSettings.hpp"
#include "Texts.hpp"

class QCheckBox;
class QLabel;
class QLineEdit;
class QRadioButton;

namespace olc {

/** Tools > OBS Live Clock…: server mode, remote address, launch command, auto start. Modal, GUI thread. */
class SettingsDialog : public QDialog {
    Q_OBJECT
public:
    SettingsDialog(Lang lang, const PluginSettings& current, const QString& statusLine, QWidget* parent);

    /** The settings to apply, or nullopt while the form is invalid (the dialog then stays open). */
    std::optional<PluginSettings> result() const { return result_; }

public slots:
    void accept() override;

private slots:
    void browse();
    void updateEnabled();

private:
    Lang lang_;
    QRadioButton* local_ = nullptr;
    QRadioButton* remote_ = nullptr;
    QLineEdit* remoteUrl_ = nullptr;
    QLineEdit* command_ = nullptr;
    QCheckBox* autoStart_ = nullptr;
    QLabel* error_ = nullptr;
    std::optional<PluginSettings> result_;
};

}  // namespace olc
```

`plugin/src/SettingsDialog.cpp`
```cpp
// SPDX-License-Identifier: GPL-2.0-or-later
#include "SettingsDialog.hpp"

#include <QCheckBox>
#include <QDialogButtonBox>
#include <QFileDialog>
#include <QHBoxLayout>
#include <QLabel>
#include <QLineEdit>
#include <QPushButton>
#include <QRadioButton>
#include <QVBoxLayout>

namespace olc {

namespace {
QString tr8(Lang lang, Msg msg) { return QString::fromStdString(text(lang, msg)); }
}  // namespace

SettingsDialog::SettingsDialog(Lang lang, const PluginSettings& current, const QString& statusLine, QWidget* parent)
    : QDialog(parent), lang_(lang) {
    setWindowTitle(tr8(lang_, Msg::SettingsTitle));
    auto* root = new QVBoxLayout(this);

    if (!statusLine.isEmpty()) {
        auto* status = new QLabel(statusLine, this);
        status->setWordWrap(true);
        root->addWidget(status);
    }

    local_ = new QRadioButton(tr8(lang_, Msg::ModeLocal), this);
    remote_ = new QRadioButton(tr8(lang_, Msg::ModeRemote), this);
    (current.isRemote() ? remote_ : local_)->setChecked(true);
    root->addWidget(local_);
    root->addWidget(remote_);

    root->addWidget(new QLabel(tr8(lang_, Msg::RemoteUrlLabel), this));
    remoteUrl_ = new QLineEdit(QString::fromStdString(current.remoteUrl), this);
    remoteUrl_->setPlaceholderText("http://studio-pc:4460");
    root->addWidget(remoteUrl_);

    root->addWidget(new QLabel(tr8(lang_, Msg::AppCommandLabel), this));
    auto* row = new QHBoxLayout();
    command_ = new QLineEdit(QString::fromStdString(current.appCommand), this);
    command_->setPlaceholderText(tr8(lang_, Msg::AppCommandHint));
    auto* browse = new QPushButton(tr8(lang_, Msg::Browse), this);
    row->addWidget(command_, 1);
    row->addWidget(browse);
    root->addLayout(row);

    autoStart_ = new QCheckBox(tr8(lang_, Msg::AutoStart), this);
    autoStart_->setChecked(current.autoStart);
    root->addWidget(autoStart_);

    error_ = new QLabel(this);
    error_->setStyleSheet("color:#b00020;");
    error_->setWordWrap(true);
    error_->hide();
    root->addWidget(error_);

    auto* buttons = new QDialogButtonBox(QDialogButtonBox::Ok | QDialogButtonBox::Cancel, this);
    root->addWidget(buttons);

    connect(buttons, &QDialogButtonBox::accepted, this, &SettingsDialog::accept);
    connect(buttons, &QDialogButtonBox::rejected, this, &QDialog::reject);
    connect(browse, &QPushButton::clicked, this, &SettingsDialog::browse);
    connect(local_, &QRadioButton::toggled, this, &SettingsDialog::updateEnabled);
    updateEnabled();
}

void SettingsDialog::updateEnabled() {
    const bool isRemote = remote_->isChecked();
    remoteUrl_->setEnabled(isRemote);
    command_->setEnabled(!isRemote);
    autoStart_->setEnabled(!isRemote);
}

void SettingsDialog::browse() {
    const QString file = QFileDialog::getOpenFileName(this, tr8(lang_, Msg::AppCommandLabel));
    if (!file.isEmpty()) command_->setText(file);
}

void SettingsDialog::accept() {
    PluginSettings settings;
    settings.mode = remote_->isChecked() ? ServerMode::Remote : ServerMode::Local;
    settings.appCommand = command_->text().trimmed().toStdString();
    settings.autoStart = autoStart_->isChecked();
    const auto url = normalizeRemoteUrl(remoteUrl_->text().toStdString());
    if (settings.isRemote() && !url) {
        error_->setText(tr8(lang_, Msg::RemoteUrlInvalid));
        error_->show();
        return;  // stay open
    }
    settings.remoteUrl = url.value_or(std::string());  // kept in local mode too, so switching back needs no retyping
    result_ = settings;
    QDialog::accept();
}

}  // namespace olc
```

`plugin/src/SystemAdapters.hpp`
```cpp
// SPDX-License-Identifier: GPL-2.0-or-later
#pragma once
#include <cstdint>
#include <optional>
#include <string>
#include <vector>

#include "ObsWsConfig.hpp"
#include "PluginSettings.hpp"

namespace olc {

/** Whole-file read as UTF-8 bytes; nullopt when missing or unreadable. Safe from any thread. */
std::optional<std::string> readTextFile(const std::string& path);

/** Starts the app detached from OBS (it must survive OBS closing or crashing, SPEC §15). false = the OS refused. */
bool launchDetached(const LaunchSpec& spec);

/** Milliseconds on a monotonic clock. */
int64_t monotonicMs();

/** Path of obs-websocket's config.json inside OBS's config folder, "" when obs-websocket is not loaded. UI thread. */
std::string obsWebsocketConfigPath();

/** The pre-5.1 [OBSWebSocket] values from OBS's global.ini, when any are there. UI thread. */
std::optional<LegacyObsWsValues> readLegacyObsWsValues();

/** The OBS process' own command line (for --websocket_port / --websocket_password). UI thread. */
std::vector<std::string> commandLineArguments();

/** Where the app keeps its data (defaultDataDir with the real environment). */
std::string resolveDataDir();

}  // namespace olc
```

`plugin/src/SystemAdapters.cpp`
```cpp
// SPDX-License-Identifier: GPL-2.0-or-later
#include "SystemAdapters.hpp"

#include <obs-frontend-api.h>
#include <obs-module.h>
#include <util/bmem.h>
#include <util/config-file.h>

#include <QCoreApplication>
#include <QDir>
#include <QFile>
#include <QProcess>
#include <QStringList>
#include <chrono>

#include "Paths.hpp"

#ifdef Q_OS_WIN
#include <windows.h>
#endif

namespace olc {

std::optional<std::string> readTextFile(const std::string& path) {
    QFile file(QString::fromStdString(path));
    if (!file.open(QIODevice::ReadOnly)) return std::nullopt;
    const QByteArray bytes = file.readAll();
    return std::string(bytes.constData(), static_cast<size_t>(bytes.size()));
}

bool launchDetached(const LaunchSpec& spec) {
    QProcess process;
    process.setProgram(QString::fromStdString(spec.command));
    QStringList args;
    for (const auto& a : spec.args) args << QString::fromStdString(a);
    process.setArguments(args);
    if (!spec.workingDir.empty()) process.setWorkingDirectory(QString::fromStdString(spec.workingDir));
#ifdef Q_OS_WIN
    // A console program (node.exe) must not flash a console window in front of the show.
    process.setCreateProcessArgumentsModifier([](QProcess::CreateProcessArguments* a) {
        a->flags |= CREATE_NO_WINDOW | CREATE_NEW_PROCESS_GROUP;
        a->startupInfo->dwFlags |= STARTF_USESHOWWINDOW;
        a->startupInfo->wShowWindow = SW_HIDE;
    });
#endif
    qint64 pid = 0;
    return process.startDetached(&pid);
}

int64_t monotonicMs() {
    using namespace std::chrono;
    return duration_cast<milliseconds>(steady_clock::now().time_since_epoch()).count();
}

std::string obsWebsocketConfigPath() {
    obs_module_t* module = obs_get_module("obs-websocket");
    if (!module) return {};
    char* raw = obs_module_get_config_path(module, "config.json");
    std::string result = raw ? raw : "";
    bfree(raw);
    return result;
}

std::optional<LegacyObsWsValues> readLegacyObsWsValues() {
    config_t* config = obs_frontend_get_app_config();
    if (!config) return std::nullopt;
    LegacyObsWsValues values;
    bool any = false;
    if (config_has_user_value(config, "OBSWebSocket", "ServerEnabled")) {
        values.serverEnabled = config_get_bool(config, "OBSWebSocket", "ServerEnabled");
        any = true;
    }
    if (config_has_user_value(config, "OBSWebSocket", "ServerPort")) {
        values.port = static_cast<int>(config_get_uint(config, "OBSWebSocket", "ServerPort"));
        any = true;
    }
    if (config_has_user_value(config, "OBSWebSocket", "AuthRequired")) {
        values.authRequired = config_get_bool(config, "OBSWebSocket", "AuthRequired");
        any = true;
    }
    if (config_has_user_value(config, "OBSWebSocket", "ServerPassword")) {
        values.password = config_get_string(config, "OBSWebSocket", "ServerPassword");
        any = true;
    }
    if (!any) return std::nullopt;
    return values;
}

std::vector<std::string> commandLineArguments() {
    std::vector<std::string> out;
    for (const QString& a : QCoreApplication::arguments()) out.push_back(a.toStdString());
    return out;
}

std::string resolveDataDir() {
    const auto env = [](const char* name) { return qEnvironmentVariable(name).toStdString(); };
    EnvVars vars;
    vars.olcDataDir = env("OLC_DATA_DIR");
    vars.appData = env("APPDATA");
    vars.xdgConfigHome = env("XDG_CONFIG_HOME");
    vars.home = QDir::homePath().toStdString();
    return defaultDataDir(currentPlatform(), vars);
}

}  // namespace olc
```


- [ ] **Step 2: Build** — `bash plugin/scripts/build-plugin.sh` (success) and `bash plugin/scripts/verify.sh` (`PASS`).

- [ ] **Step 3: Commit**

```
git add plugin/src
git commit -m "feat(plugin): dock host with fallback page, settings dialog and store, system adapters"
```

---

### Task 14: Glue — hotkey registrar and screen reporter

**Files:**
- Create: `plugin/src/HotkeyRegistrar.hpp`, `plugin/src/HotkeyRegistrar.cpp`, `plugin/src/ScreenReporter.hpp`, `plugin/src/ScreenReporter.cpp`

**Interfaces:**
- Consumes: Tasks 3, 6, 9. Produces: `HotkeyRegistrar(HotkeyForwarder&)` with `registerAll()` (18 `obs_hotkey_register_frontend` calls from `hotkeySlots()`, then loads bindings), `reloadBindings()` (profile change), `unregisterAll()`; `ScreenReporter(sink)` with `start()` and `snapshot()` (QScreen name, geometry, devicePixelRatio, primary; `screenAdded/Removed`, `primaryScreenChanged`, `geometryChanged`, debounced 500 ms).
- The hotkey callback ignores the release (`if (!pressed) return;`) and only calls `forwarder_.onPress(slotId)`. Bindings are read from the profile config `[Hotkeys]` by registration name (see "Research record" item 3); a missing entry clears the bindings.

- [ ] **Step 1: Implement**

`plugin/src/HotkeyRegistrar.hpp`
```cpp
// SPDX-License-Identifier: GPL-2.0-or-later
#pragma once
#include <obs.h>

#include <memory>
#include <string>
#include <vector>

#include "HotkeyForwarder.hpp"

namespace olc {

/**
 * Registers the 18 fixed slots with OBS (DT-9) and forwards presses to the HotkeyForwarder.
 *
 * Key assignments: when the operator assigns a key in OBS Settings > Hotkeys, OBS stores it in the profile's
 * basic.ini under [Hotkeys], keyed by the registration name. OBS reloads such bindings only for its own hotkeys;
 * for a plugin's frontend hotkeys libobs does nothing, so this class loads them itself after registering and again
 * when the profile changes.
 */
class HotkeyRegistrar {
public:
    explicit HotkeyRegistrar(HotkeyForwarder& forwarder);
    ~HotkeyRegistrar();

    void registerAll();       // UI thread, after OBS finished loading (a profile is active)
    void reloadBindings();    // UI thread, on profile change
    void unregisterAll();     // UI thread, before the forwarder and its worker are destroyed

    HotkeyForwarder& forwarder() { return forwarder_; }

private:
    struct Target {
        HotkeyRegistrar* owner;
        std::string slotId;
    };
    static void onHotkey(void* data, obs_hotkey_id id, obs_hotkey_t* hotkey, bool pressed);

    HotkeyForwarder& forwarder_;
    std::vector<std::unique_ptr<Target>> targets_;
    std::vector<obs_hotkey_id> ids_;
};

}  // namespace olc
```

`plugin/src/HotkeyRegistrar.cpp`
```cpp
// SPDX-License-Identifier: GPL-2.0-or-later
#include "HotkeyRegistrar.hpp"

#include <obs-frontend-api.h>
#include <obs-module.h>
#include <util/config-file.h>

#include "HotkeySlots.hpp"

namespace olc {

HotkeyRegistrar::HotkeyRegistrar(HotkeyForwarder& forwarder) : forwarder_(forwarder) {}

HotkeyRegistrar::~HotkeyRegistrar() { unregisterAll(); }

void HotkeyRegistrar::onHotkey(void* data, obs_hotkey_id, obs_hotkey_t*, bool pressed) {
    if (!pressed) return;  // OBS calls back on release too; only the press counts
    const auto* target = static_cast<Target*>(data);
    // This runs on OBS's hotkey thread: onPress() only numbers the press and queues a job.
    target->owner->forwarder_.onPress(target->slotId);
}

void HotkeyRegistrar::registerAll() {
    if (!ids_.empty()) return;
    for (const SlotDef& slot : hotkeySlots()) {
        auto target = std::make_unique<Target>(Target{this, slot.id});
        const obs_hotkey_id id = obs_hotkey_register_frontend(slot.obsName.c_str(), slot.description.c_str(), &HotkeyRegistrar::onHotkey, target.get());
        targets_.push_back(std::move(target));
        ids_.push_back(id);
    }
    reloadBindings();
}

void HotkeyRegistrar::reloadBindings() {
    config_t* profile = obs_frontend_get_profile_config();
    if (!profile) return;
    const auto& slots = hotkeySlots();
    for (size_t i = 0; i < ids_.size() && i < slots.size(); ++i) {
        if (ids_[i] == OBS_INVALID_HOTKEY_ID) continue;
        const char* json = config_get_string(profile, "Hotkeys", slots[i].obsName.c_str());
        obs_data_array_t* bindings = nullptr;
        obs_data_t* data = json ? obs_data_create_from_json(json) : nullptr;
        if (data) bindings = obs_data_get_array(data, "bindings");
        obs_hotkey_load(ids_[i], bindings);  // a null array clears the bindings: the new profile has none
        if (bindings) obs_data_array_release(bindings);
        if (data) obs_data_release(data);
    }
}

void HotkeyRegistrar::unregisterAll() {
    for (const obs_hotkey_id id : ids_)
        if (id != OBS_INVALID_HOTKEY_ID) obs_hotkey_unregister(id);
    ids_.clear();
    targets_.clear();  // only now: no callback can reach them any more
}

}  // namespace olc
```

`plugin/src/ScreenReporter.hpp`
```cpp
// SPDX-License-Identifier: GPL-2.0-or-later
#pragma once
#include <QObject>
#include <QTimer>
#include <functional>
#include <vector>

#include "ScreenInfo.hpp"

class QScreen;

namespace olc {

/** Watches the monitors Qt knows about and reports the list (once at start, then after every change, debounced). */
class ScreenReporter : public QObject {
    Q_OBJECT
public:
    using Sink = std::function<void(std::vector<ScreenInfo>)>;
    explicit ScreenReporter(Sink sink, QObject* parent = nullptr);

    void start();
    static std::vector<ScreenInfo> snapshot();

private slots:
    void watch(QScreen* screen);
    void changed();
    void publish();

private:
    Sink sink_;
    QTimer debounce_;
};

}  // namespace olc
```

`plugin/src/ScreenReporter.cpp`
```cpp
// SPDX-License-Identifier: GPL-2.0-or-later
#include "ScreenReporter.hpp"

#include <QGuiApplication>
#include <QScreen>
#include <utility>

namespace olc {

ScreenReporter::ScreenReporter(Sink sink, QObject* parent) : QObject(parent), sink_(std::move(sink)) {
    debounce_.setSingleShot(true);
    debounce_.setInterval(500);  // a monitor change fires several signals in a row
    connect(&debounce_, &QTimer::timeout, this, &ScreenReporter::publish);
}

std::vector<ScreenInfo> ScreenReporter::snapshot() {
    std::vector<ScreenInfo> out;
    const QScreen* primary = QGuiApplication::primaryScreen();
    for (QScreen* screen : QGuiApplication::screens()) {
        const QRect g = screen->geometry();
        ScreenInfo info;
        info.name = screen->name().toStdString();
        info.x = g.x();
        info.y = g.y();
        info.width = g.width();
        info.height = g.height();
        info.devicePixelRatio = screen->devicePixelRatio();
        info.primary = screen == primary;
        out.push_back(std::move(info));
    }
    return out;
}

void ScreenReporter::start() {
    for (QScreen* screen : QGuiApplication::screens()) watch(screen);
    connect(qGuiApp, &QGuiApplication::screenAdded, this, [this](QScreen* s) {
        watch(s);
        changed();
    });
    connect(qGuiApp, &QGuiApplication::screenRemoved, this, &ScreenReporter::changed);
    connect(qGuiApp, &QGuiApplication::primaryScreenChanged, this, &ScreenReporter::changed);
    publish();
}

void ScreenReporter::watch(QScreen* screen) {
    connect(screen, &QScreen::geometryChanged, this, &ScreenReporter::changed);
    connect(screen, &QScreen::physicalDotsPerInchChanged, this, &ScreenReporter::changed);
}

void ScreenReporter::changed() { debounce_.start(); }

void ScreenReporter::publish() {
    if (sink_) sink_(snapshot());
}

}  // namespace olc
```


- [ ] **Step 2: Build** — `bash plugin/scripts/build-plugin.sh`; `bash plugin/scripts/verify.sh` -> `PASS`.

- [ ] **Step 3: Commit**

```
git add plugin/src
git commit -m "feat(plugin): hotkey registrar (18 fixed slots, bindings loaded from the profile), screen reporter"
```

---

### Task 15: Glue — controller, plugin-main, glue rule tests

**Files:**
- Create: `plugin/src/PluginController.hpp`, `plugin/src/PluginController.cpp`, `plugin/tests/test_glue_rules.cpp`
- Replace: `plugin/src/plugin-main.cpp` (the Task 9 bootstrap)

**Interfaces:**
- Consumes: Tasks 10, 13, 14. `PluginController` owns the `DockHost`, `CurlHttp`, `Supervisor`, the hotkey `Dispatcher`, `HotkeyForwarder`, `HotkeyRegistrar`, `ScreenReporter` and the `TickLoop`, and runs on the UI thread. `onFinishedLoading()` captures from OBS, once, on the UI thread, everything the tick thread needs (obs-websocket config path, legacy values, command line, data dir), then starts the workers, registers the hotkeys, starts the screen reporter and adds `Tools > OBS Live Clock…`. Status goes back to Qt through a queued `QMetaObject::invokeMethod(this, …, Qt::QueuedConnection)`. `shutdown()` runs on `OBS_FRONTEND_EVENT_EXIT`: it joins the tick loop, unregisters hotkeys, stops the worker.
- `plugin-main.cpp`: the dock is created and registered in `obs_module_post_load` (log line `dock registered (browser panel|fallback page)`), the event callback handles FINISHED_LOADING, PROFILE_CHANGED (reload bindings) and EXIT.

- [ ] **Step 1: Write the glue rule tests** (they read the sources as text, Playlist Deck style; they fail until the code below exists)

`plugin/tests/test_glue_rules.cpp`
```cpp
// SPDX-License-Identifier: GPL-2.0-or-later
// Source-inspection tests for the OBS glue in src/, which cannot run without OBS. Each one pins a rule that keeps
// OBS's UI thread free and the secrets out of sight; the real behaviour is covered by the manual checklist in
// docs/TEST-PLAN.md. They read the sources as text, so keep the pinned fragments in step with the code.
#include "doctest/doctest.h"

#include <filesystem>
#include <fstream>
#include <iterator>
#include <string>

namespace {
std::string readSource(const std::string& relative) {
    std::ifstream input(std::string(OLC_SOURCE_DIR) + "/" + relative, std::ios::binary);
    return {std::istreambuf_iterator<char>(input), std::istreambuf_iterator<char>()};
}

/** Text of the function whose signature starts with `signature`, from its first '{' to the matching '}'. */
std::string bodyOf(const std::string& source, const std::string& signature) {
    const auto start = source.find(signature);
    if (start == std::string::npos) return {};
    const auto open = source.find('{', start);
    if (open == std::string::npos) return {};
    int depth = 0;
    for (auto i = open; i < source.size(); ++i) {
        if (source[i] == '{') ++depth;
        else if (source[i] == '}' && --depth == 0) return source.substr(open, i - open + 1);
    }
    return {};
}

bool has(const std::string& text, const std::string& fragment) { return text.find(fragment) != std::string::npos; }

std::vector<std::string> sourceFiles(const std::string& dir) {
    std::vector<std::string> out;
    for (const auto& entry : std::filesystem::directory_iterator(std::string(OLC_SOURCE_DIR) + "/" + dir)) {
        const auto ext = entry.path().extension().string();
        if (ext == ".cpp" || ext == ".hpp") out.push_back(dir + "/" + entry.path().filename().string());
    }
    return out;
}
}  // namespace

TEST_CASE("the OBS hotkey callback only numbers the press and queues it: no network, no waiting") {
    const auto body = bodyOf(readSource("src/HotkeyRegistrar.cpp"), "void HotkeyRegistrar::onHotkey(");
    REQUIRE_FALSE(body.empty());
    CHECK(has(body, "forwarder_.onPress("));
    for (const char* forbidden : {"perform(", "curl", "postHotkey", "sleep", "wait(", "exec(", "QProcess", ".join("}) CHECK_FALSE_MESSAGE(has(body, forbidden), forbidden);
    CHECK(has(body, "if (!pressed) return;"));  // the release callback is not a press
}

TEST_CASE("only the worker side calls the network: no glue file performs an HTTP request except through core jobs") {
    for (const auto& file : sourceFiles("src")) {
        if (file == "src/plugin-main.cpp") continue;
        const auto text = readSource(file);
        CHECK_MESSAGE(!has(text, ".perform("), file);
        CHECK_MESSAGE(!has(text, "curl_easy"), file);
    }
}

TEST_CASE("the app's status reaches the GUI thread through a queued call") {
    const auto controller = readSource("src/PluginController.cpp");
    const auto init = bodyOf(controller, "void PluginController::onFinishedLoading()");
    REQUIRE_FALSE(init.empty());
    CHECK(has(init, "QMetaObject::invokeMethod(this"));
    CHECK(has(init, "Qt::QueuedConnection"));
}

TEST_CASE("the dock is registered while modules load, never on FINISHED_LOADING (it would lose its saved place)") {
    const auto main = readSource("src/plugin-main.cpp");
    const auto post = bodyOf(main, "void obs_module_post_load(void)");
    REQUIRE_FALSE(post.empty());
    CHECK(has(post, "obs_frontend_add_dock_by_id"));
    const auto onEvent = bodyOf(main, "static void on_frontend_event(");
    REQUIRE_FALSE(onEvent.empty());
    CHECK_FALSE(has(onEvent, "obs_frontend_add_dock_by_id"));
    CHECK_FALSE(has(onEvent, "new olc::"));
}

TEST_CASE("everything stops before libobs goes away: the EXIT event shuts the controller down") {
    const auto onEvent = bodyOf(readSource("src/plugin-main.cpp"), "static void on_frontend_event(");
    CHECK(has(onEvent, "OBS_FRONTEND_EVENT_EXIT"));
    CHECK(has(onEvent, "shutdown()"));
}

TEST_CASE("a secret is read out of its wrapper in exactly one place") {
    // Secret::reveal() may appear in the wrapper itself, in the one function that builds the credentials body,
    // and in tests. Never in a log call, never in glue.
    for (const auto& file : sourceFiles("core")) {
        const auto text = readSource(file);
        if (file == "core/Secret.hpp" || file == "core/ObsWsConfig.cpp") continue;
        CHECK_MESSAGE(!has(text, "reveal()"), file);
    }
    for (const auto& file : sourceFiles("src")) CHECK_MESSAGE(!has(readSource(file), "reveal()"), file);
    for (const auto& file : sourceFiles("net")) CHECK_MESSAGE(!has(readSource(file), "reveal()"), file);
}

TEST_CASE("the app is launched with an argument list, never through a shell, and with no secret on the command line") {
    const auto adapters = readSource("src/SystemAdapters.cpp");
    const auto launch = bodyOf(adapters, "bool launchDetached(");
    REQUIRE_FALSE(launch.empty());
    CHECK(has(launch, "startDetached"));
    for (const char* forbidden : {"cmd.exe", "/c ", "system(", "sh -c", "password", "Secret"}) CHECK_FALSE_MESSAGE(has(launch, forbidden), forbidden);
}

TEST_CASE("log lines never carry request bodies or headers") {
    for (const auto& file : sourceFiles("core")) {
        const auto text = readSource(file);
        CHECK_MESSAGE(!has(text, "log(request.body"), file);
        CHECK_MESSAGE(!has(text, "log(\"Authorization"), file);
    }
    const auto curl = readSource("net/CurlHttp.cpp");
    CHECK_FALSE(has(curl, "blog("));
}
```


- [ ] **Step 2: Implement**

`plugin/src/PluginController.hpp`
```cpp
// SPDX-License-Identifier: GPL-2.0-or-later
#pragma once
#include <QObject>
#include <memory>

#include "CurlHttp.hpp"
#include "Dispatcher.hpp"
#include "DockHost.hpp"
#include "HotkeyForwarder.hpp"
#include "HotkeyRegistrar.hpp"
#include "ScreenReporter.hpp"
#include "SettingsStore.hpp"
#include "Supervisor.hpp"
#include "TickLoop.hpp"

namespace olc {

/**
 * Owns everything the module runs and wires it together. All public methods run on OBS's UI thread. Threads:
 * the TickLoop (Supervisor.tick: health, launch, credentials, screens) and the hotkey Dispatcher; neither ever
 * touches Qt or libobs UI state: results come back through queued calls on the DockHost.
 */
class PluginController : public QObject {
    Q_OBJECT
public:
    explicit PluginController(QObject* parent = nullptr);
    ~PluginController() override;

    /** OBS_FRONTEND_EVENT_FINISHED_LOADING: a profile is active, the main window exists. */
    void onFinishedLoading();
    void onProfileChanged();
    /** OBS_FRONTEND_EVENT_EXIT: stop the threads while libobs is still alive. */
    void shutdown();

    DockHost* dock() { return dock_; }
    void openSettings();

private:
    void applyStatus(const Status& status);

    Lang lang_;
    SettingsStore store_;
    CurlHttp http_;
    DockHost* dock_ = nullptr;  // owned by OBS (the dock wraps it)
    std::unique_ptr<Supervisor> supervisor_;
    std::unique_ptr<Dispatcher> hotkeyWorker_;
    std::unique_ptr<HotkeyForwarder> forwarder_;
    std::unique_ptr<HotkeyRegistrar> hotkeys_;
    std::unique_ptr<ScreenReporter> screens_;
    std::unique_ptr<TickLoop> loop_;
    LaunchPhase lastPhase_ = LaunchPhase::Checking;
    std::string lastInstance_;
    bool shutDown_ = false;
};

}  // namespace olc
```

`plugin/src/PluginController.cpp`
```cpp
// SPDX-License-Identifier: GPL-2.0-or-later
#include "PluginController.hpp"

#include <obs-frontend-api.h>
#include <obs-module.h>

#include <QMainWindow>
#include <QMetaObject>
#include <chrono>

#include "SettingsDialog.hpp"
#include "SystemAdapters.hpp"

namespace olc {

namespace {
void logLine(const std::string& line) { blog(LOG_INFO, "[obs-live-clock] %s", line.c_str()); }
}  // namespace

PluginController::PluginController(QObject* parent) : QObject(parent) {
    lang_ = langFromLocale(obs_get_locale() ? obs_get_locale() : "");
    dock_ = new DockHost(lang_);
}

PluginController::~PluginController() { shutdown(); }

void PluginController::onFinishedLoading() {
    if (supervisor_ || shutDown_) return;
    const PluginSettings settings = store_.load();

    // Everything the tick thread needs from OBS is captured here, on the UI thread, once.
    const std::string wsConfigPath = obsWebsocketConfigPath();
    const auto legacy = readLegacyObsWsValues();
    const auto args = commandLineArguments();

    SupervisorDeps deps{http_,
                        &monotonicMs,
                        &readTextFile,
                        &launchDetached,
                        [wsConfigPath, legacy, args] { return loadObsWsConfig(&readTextFile, wsConfigPath, legacy, args); },
                        &logLine,
                        resolveDataDir()};
    supervisor_ = std::make_unique<Supervisor>(std::move(deps), settings);
    supervisor_->setOnStatus([this](const Status& s) {
        // Tick thread -> GUI thread. A queued call to a destroyed context object is dropped by Qt.
        QMetaObject::invokeMethod(this, [this, s] { applyStatus(s); }, Qt::QueuedConnection);
    });

    hotkeyWorker_ = std::make_unique<Dispatcher>(32);
    forwarder_ = std::make_unique<HotkeyForwarder>(supervisor_->api(), *hotkeyWorker_, &logLine);
    hotkeys_ = std::make_unique<HotkeyRegistrar>(*forwarder_);
    hotkeys_->registerAll();

    screens_ = std::make_unique<ScreenReporter>([this](std::vector<ScreenInfo> list) { supervisor_->setScreens(std::move(list)); });
    screens_->start();

    obs_frontend_add_tools_menu_item(
        text(lang_, Msg::MenuEntry).c_str(), [](void* self) { static_cast<PluginController*>(self)->openSettings(); }, this);

    loop_ = std::make_unique<TickLoop>([this] { supervisor_->tick(); }, std::chrono::milliseconds(250));
    logLine("started");
}

void PluginController::onProfileChanged() {
    if (hotkeys_) hotkeys_->reloadBindings();
}

void PluginController::applyStatus(const Status& status) {
    if (shutDown_) return;
    dock_->present(QString::fromStdString(status.dockUrl), QString::fromStdString(describeStatus(lang_, status)));
    const bool cameUp = status.phase == LaunchPhase::Running && (lastPhase_ != LaunchPhase::Running || status.instanceId != lastInstance_);
    if (cameUp) dock_->reloadBrowser();  // the page may be showing a connection error from before the app was up
    lastPhase_ = status.phase;
    lastInstance_ = status.instanceId;
}

void PluginController::openSettings() {
    if (!supervisor_) return;
    const PluginSettings current = store_.load();
    auto* parent = static_cast<QMainWindow*>(obs_frontend_get_main_window());
    SettingsDialog dialog(lang_, current, QString::fromStdString(describeStatus(lang_, supervisor_->status())), parent);
    if (dialog.exec() != QDialog::Accepted || !dialog.result()) return;
    store_.save(*dialog.result());
    supervisor_->applySettings(*dialog.result());
}

void PluginController::shutdown() {
    if (shutDown_) return;
    shutDown_ = true;
    if (loop_) loop_->stop();            // joins: no tick runs after this line
    if (hotkeys_) hotkeys_->unregisterAll();
    if (hotkeyWorker_) hotkeyWorker_->stop();
    forwarder_.reset();
    hotkeys_.reset();
    hotkeyWorker_.reset();
    screens_.reset();
    loop_.reset();
    supervisor_.reset();
}

}  // namespace olc
```

`plugin/src/plugin-main.cpp`
```cpp
// SPDX-License-Identifier: GPL-2.0-or-later
#include <curl/curl.h>
#include <obs-frontend-api.h>
#include <obs-module.h>

#include <QMainWindow>

#include "PluginController.hpp"

#ifndef OLC_VERSION
#define OLC_VERSION "0.0.0"
#endif

OBS_DECLARE_MODULE()

MODULE_EXPORT const char* obs_module_description(void) {
    return "OBS Live Clock - presenter clock dock, app launcher and hotkeys";
}
MODULE_EXPORT const char* obs_module_name(void) { return "OBS Live Clock"; }
MODULE_EXPORT const char* obs_module_author(void) { return "OBS Live Clock contributors"; }

static olc::PluginController* g_controller = nullptr;
static constexpr const char* DOCK_ID = "obs-live-clock-dock";

static void on_frontend_event(enum obs_frontend_event event, void*) {
    if (!g_controller) return;
    switch (event) {
    case OBS_FRONTEND_EVENT_FINISHED_LOADING:
        g_controller->onFinishedLoading();
        break;
    case OBS_FRONTEND_EVENT_PROFILE_CHANGED:
        g_controller->onProfileChanged();
        break;
    case OBS_FRONTEND_EVENT_EXIT:
        g_controller->shutdown();
        break;
    default:
        break;
    }
}

bool obs_module_load(void) {
    blog(LOG_INFO, "[obs-live-clock] loaded (v%s)", OLC_VERSION);
    curl_global_init(CURL_GLOBAL_DEFAULT);
    return true;
}

// The dock is registered in post_load, not on FINISHED_LOADING: OBS restores the saved dock layout right after all
// modules are loaded and before that event, so a dock added later would lose its place (lesson from Playlist Deck).
// post_load rather than module_load because obs-browser must already be loaded to host the page.
MODULE_EXPORT void obs_module_post_load(void) {
    auto* controller = new olc::PluginController();
    if (!obs_frontend_add_dock_by_id(DOCK_ID, "OBS Live Clock", controller->dock())) {
        blog(LOG_ERROR, "[obs-live-clock] dock registration failed");
        delete controller->dock();
        delete controller;
        return;
    }
    g_controller = controller;
    blog(LOG_INFO, "[obs-live-clock] dock registered (%s)", controller->dock()->hasBrowser() ? "browser panel" : "fallback page");
    obs_frontend_add_event_callback(on_frontend_event, nullptr);
}

void obs_module_unload(void) {
    obs_frontend_remove_event_callback(on_frontend_event, nullptr);
    if (g_controller) g_controller->shutdown();
    // The controller object is left to process exit: OBS owns the dock widget and tears Qt down itself.
    g_controller = nullptr;
    curl_global_cleanup();
}
```


- [ ] **Step 3: Build and test**

`bash plugin/scripts/build-plugin.sh && bash plugin/scripts/verify.sh`. Expected: module links; `PASS` (99 test cases here; 104 once Task 16 adds the contract cases). The orchestrator also runs the module in a **portable copy of OBS** only if asked (Task 18 checklist); never in the user's profile.

- [ ] **Step 4: Commit**

```
git add plugin
git commit -m "feat(plugin): controller wiring dock, supervisor, hotkeys and screens; module entry points; glue rule tests"
```

---

### Task 16: Contract between plugin and server, `olc-cli`, contract tests

**Files:**
- Create: `plugin/contract/plugin-contract.json`, `plugin/tests/test_contract.cpp`, `plugin/tools/cli.cpp`, `server/test/contract/plugin-contract.test.ts`

**Interfaces:**
- Consumes: Tasks 3, 6, 8, 10 (and Task 9 for libcurl). The JSON file is read by **both** test suites: protocol version, a sample `/api/health` body, a sample `runtime.json`, the data-directory vectors (all platforms) and the 18 hotkey slots with their frozen names and emergency flags. Change it only together with both sides.
- `olc-cli supervise --data-dir D --ws-config FILE [--screens FILE] [--seconds N] [--no-launch]` runs the real `Supervisor` against a real server and prints the final status as JSON; `olc-cli hotkey --data-dir D --slot ID [--presses N] [--gap-ms M]` sends presses through the real `HotkeyForwarder` path. It is built only when libcurl is found.
- The TypeScript part runs the two CLI scenarios **only when `OLC_CLI` points at the binary** (`OLC_CLI_DLL_DIR` is prepended to `PATH`, needed on Windows for `libcurl.dll`); the five contract checks always run. Reference run on this machine: 8 passed with the CLI, 5 passed + 3 skipped without.

- [ ] **Step 1: Write the failing tests**

`plugin/contract/plugin-contract.json`
```json
{
  "_comment": "Contract between plugin/ (C++) and server/ (TypeScript). Both test suites read this file; change it only together with both sides.",
  "protocol": 1,
  "health": {
    "version": "0.1.0",
    "protocol": 1,
    "instanceId": "00000000-0000-4000-8000-000000000000"
  },
  "runtimeJson": {
    "port": 4460,
    "pid": 1234,
    "instanceId": "00000000-0000-4000-8000-000000000000"
  },
  "dataDirVectors": [
    {
      "platform": "win32",
      "env": {
        "APPDATA": "C:/Users/ann/AppData/Roaming"
      },
      "home": "C:/Users/ann",
      "expected": "C:/Users/ann/AppData/Roaming/obs-live-clock"
    },
    {
      "platform": "win32",
      "env": {},
      "home": "C:/Users/ann",
      "expected": "C:/Users/ann/AppData/Roaming/obs-live-clock"
    },
    {
      "platform": "darwin",
      "env": {},
      "home": "/Users/ann",
      "expected": "/Users/ann/Library/Application Support/obs-live-clock"
    },
    {
      "platform": "linux",
      "env": {},
      "home": "/home/ann",
      "expected": "/home/ann/.config/obs-live-clock"
    },
    {
      "platform": "linux",
      "env": {
        "XDG_CONFIG_HOME": "/xdg"
      },
      "home": "/home/ann",
      "expected": "/xdg/obs-live-clock"
    },
    {
      "platform": "linux",
      "env": {
        "OLC_DATA_DIR": "/data/olc"
      },
      "home": "/home/ann",
      "expected": "/data/olc"
    }
  ],
  "slots": [
    {
      "id": "message-1",
      "obsName": "obs-live-clock.message.1",
      "description": "OBS Live Clock: Messaggio 1",
      "emergency": false
    },
    {
      "id": "message-2",
      "obsName": "obs-live-clock.message.2",
      "description": "OBS Live Clock: Messaggio 2",
      "emergency": false
    },
    {
      "id": "message-3",
      "obsName": "obs-live-clock.message.3",
      "description": "OBS Live Clock: Messaggio 3",
      "emergency": false
    },
    {
      "id": "message-4",
      "obsName": "obs-live-clock.message.4",
      "description": "OBS Live Clock: Messaggio 4",
      "emergency": false
    },
    {
      "id": "message-5",
      "obsName": "obs-live-clock.message.5",
      "description": "OBS Live Clock: Messaggio 5",
      "emergency": false
    },
    {
      "id": "message-6",
      "obsName": "obs-live-clock.message.6",
      "description": "OBS Live Clock: Messaggio 6",
      "emergency": false
    },
    {
      "id": "message-7",
      "obsName": "obs-live-clock.message.7",
      "description": "OBS Live Clock: Messaggio 7",
      "emergency": false
    },
    {
      "id": "message-8",
      "obsName": "obs-live-clock.message.8",
      "description": "OBS Live Clock: Messaggio 8",
      "emergency": false
    },
    {
      "id": "message-9",
      "obsName": "obs-live-clock.message.9",
      "description": "OBS Live Clock: Messaggio 9",
      "emergency": false
    },
    {
      "id": "message-10",
      "obsName": "obs-live-clock.message.10",
      "description": "OBS Live Clock: Messaggio 10",
      "emergency": false
    },
    {
      "id": "message-11",
      "obsName": "obs-live-clock.message.11",
      "description": "OBS Live Clock: Messaggio 11",
      "emergency": false
    },
    {
      "id": "message-12",
      "obsName": "obs-live-clock.message.12",
      "description": "OBS Live Clock: Messaggio 12",
      "emergency": false
    },
    {
      "id": "clear",
      "obsName": "obs-live-clock.clear",
      "description": "OBS Live Clock: CLEAR",
      "emergency": false
    },
    {
      "id": "next",
      "obsName": "obs-live-clock.next",
      "description": "OBS Live Clock: NEXT",
      "emergency": true
    },
    {
      "id": "prev",
      "obsName": "obs-live-clock.prev",
      "description": "OBS Live Clock: PREV",
      "emergency": true
    },
    {
      "id": "time-plus",
      "obsName": "obs-live-clock.time.plus",
      "description": "OBS Live Clock: +tempo",
      "emergency": true
    },
    {
      "id": "time-minus",
      "obsName": "obs-live-clock.time.minus",
      "description": "OBS Live Clock: -tempo",
      "emergency": true
    },
    {
      "id": "control-toggle",
      "obsName": "obs-live-clock.control.toggle",
      "description": "OBS Live Clock: MANUALE/AUTO",
      "emergency": true
    }
  ]
}
```

`plugin/tests/test_contract.cpp`
```cpp
// SPDX-License-Identifier: GPL-2.0-or-later
// The C++ side of the plugin <-> server contract. server/test/contract/plugin-contract.test.ts reads the same file.
#include "doctest/doctest.h"

#include <fstream>
#include <nlohmann/json.hpp>
#include <sstream>

#include "Health.hpp"
#include "HotkeySlots.hpp"
#include "Paths.hpp"

using namespace olc;

namespace {
nlohmann::json contract() {
    std::ifstream in(std::string(OLC_SOURCE_DIR) + "/contract/plugin-contract.json");
    REQUIRE_MESSAGE(in.good(), "plugin/contract/plugin-contract.json is missing");
    std::ostringstream ss;
    ss << in.rdbuf();
    return nlohmann::json::parse(ss.str());
}
Platform platformOf(const std::string& name) {
    if (name == "win32") return Platform::Windows;
    if (name == "darwin") return Platform::MacOS;
    return Platform::Linux;
}
}  // namespace

TEST_CASE("contract: the protocol version is the one the server speaks") {
    CHECK(contract()["protocol"].get<int>() == kProtocolVersion);
}

TEST_CASE("contract: the sample /api/health body parses and is compatible") {
    const auto c = contract();
    const auto health = parseHealth(c["health"].dump());
    REQUIRE(health.has_value());
    CHECK(checkProtocol(health->protocol) == Compat::Ok);
}

TEST_CASE("contract: the sample runtime.json parses") {
    const auto runtime = parseRuntimeJson(contract()["runtimeJson"].dump());
    REQUIRE(runtime.has_value());
    CHECK(runtime->port == 4460);
    CHECK(runtime->instanceId == "00000000-0000-4000-8000-000000000000");
}

TEST_CASE("contract: defaultDataDir gives the same folder as the server for every vector") {
    for (const auto& v : contract()["dataDirVectors"]) {
        EnvVars env;
        env.home = v["home"].get<std::string>();
        const auto& e = v["env"];
        if (e.contains("APPDATA")) env.appData = e["APPDATA"].get<std::string>();
        if (e.contains("XDG_CONFIG_HOME")) env.xdgConfigHome = e["XDG_CONFIG_HOME"].get<std::string>();
        if (e.contains("OLC_DATA_DIR")) env.olcDataDir = e["OLC_DATA_DIR"].get<std::string>();
        CHECK(defaultDataDir(platformOf(v["platform"].get<std::string>()), env) == v["expected"].get<std::string>());
    }
}

TEST_CASE("contract: the hotkey slot table is identical to the server's") {
    const auto c = contract();
    const auto& slots = hotkeySlots();
    REQUIRE(c["slots"].size() == slots.size());
    for (size_t i = 0; i < slots.size(); ++i) {
        const auto& j = c["slots"][i];
        CHECK(slots[i].id == j["id"].get<std::string>());
        CHECK(slots[i].obsName == j["obsName"].get<std::string>());
        CHECK(slots[i].description == j["description"].get<std::string>());
        CHECK(slots[i].emergency == j["emergency"].get<bool>());
    }
}
```

`server/test/contract/plugin-contract.test.ts`
```ts
// SPDX-License-Identifier: GPL-2.0-or-later
// The server side of the plugin <-> app contract. plugin/tests/test_contract.cpp reads the same file.
// Part 2 drives the REAL C++ core (olc-cli) against a REAL server; it runs only when OLC_CLI points at the binary
// (built by `plugin/scripts/test.sh` style builds that have libcurl; CI runs it on Ubuntu).
import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { delimiter, join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import { PROTOCOL_VERSION } from '@olc/shared';
import { soloFutsalFormat } from '@olc/shared/testing';
import { defaultDataDir } from '../../src/app/paths';
import { writeRuntimeFile } from '../../src/app/runtime-file';
import { HOTKEY_SLOT_IDS, EMERGENCY_SLOTS } from '../../src/hotkeys/slots';
import { buildTestServer } from '../support/server';
import { FakeObsClient } from '../support/fake-obs';
import { tempDir } from '../support/tmp';

interface Contract {
  protocol: number;
  health: Record<string, unknown>;
  runtimeJson: Record<string, unknown>;
  dataDirVectors: { platform: NodeJS.Platform; env: Record<string, string>; home: string; expected: string }[];
  slots: { id: string; obsName: string; description: string; emergency: boolean }[];
}
const contract = JSON.parse(readFileSync(new URL('../../../plugin/contract/plugin-contract.json', import.meta.url), 'utf8')) as Contract;
const run = promisify(execFile);

const apps: Array<{ close(): Promise<unknown> }> = [];
afterEach(async () => {
  while (apps.length > 0) await apps.pop()!.close();
});

describe('plugin contract (server side)', () => {
  it('speaks the protocol version the plugin was written for', () => {
    expect(contract.protocol).toBe(PROTOCOL_VERSION);
  });

  it('GET /api/health has exactly the fields the plugin parses', async () => {
    const server = await buildTestServer({ dataDir: await tempDir() });
    apps.push(server.app);
    const body = (await server.app.inject({ method: 'GET', url: '/api/health' })).json() as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(Object.keys(contract.health).sort());
    expect(body.protocol).toBe(contract.protocol);
    expect(typeof body.version).toBe('string');
    expect(typeof body.instanceId).toBe('string');
  });

  it('runtime.json carries the keys the plugin reads', async () => {
    const path = join(await tempDir(), 'runtime.json');
    await writeRuntimeFile(path, { port: 4460, pid: 1234, instanceId: 'x', version: '0.1.0', protocol: PROTOCOL_VERSION });
    const written = JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>;
    for (const key of Object.keys(contract.runtimeJson)) expect(written).toHaveProperty(key);
  });

  it('defaultDataDir gives the folder the plugin computes, for every vector', () => {
    for (const v of contract.dataDirVectors) {
      expect(defaultDataDir(v.env, v.platform, v.home).replaceAll('\\', '/')).toBe(v.expected);
    }
  });

  it('the hotkey slot ids, their order and which ones are emergency match the plugin table', () => {
    expect(contract.slots.map((s) => s.id)).toEqual([...HOTKEY_SLOT_IDS]);
    expect(contract.slots.filter((s) => s.emergency).map((s) => s.id).sort()).toEqual([...EMERGENCY_SLOTS].sort());
    for (const s of contract.slots) {
      expect(s.obsName.startsWith('obs-live-clock.')).toBe(true);
      expect(s.description.startsWith('OBS Live Clock: ')).toBe(true);
    }
  });
});

const cli = process.env.OLC_CLI;

class SpyObs extends FakeObsClient {
  readonly connects: { url: string; password: string | undefined }[] = [];
  override async connect(url: string, password: string | undefined) {
    this.connects.push({ url, password });
    return super.connect(url, password);
  }
}

describe.skipIf(cli === undefined)('the real C++ core (olc-cli) against the real server', () => {
  async function boot() {
    const dataDir = await tempDir();
    const spy = new SpyObs();
    const server = await buildTestServer({ dataDir, obsClientFactory: () => spy });
    apps.push(server.app);
    await server.app.listen({ port: 0, host: '127.0.0.1' });
    const port = (server.app.server.address() as { port: number }).port;
    await writeRuntimeFile(join(dataDir, 'runtime.json'), { port, pid: process.pid, instanceId: server.instanceId, version: '0.1.0', protocol: PROTOCOL_VERSION });
    const env = { ...process.env, PATH: [process.env.OLC_CLI_DLL_DIR, process.env.PATH].filter(Boolean).join(delimiter) };
    const exec = (args: string[]) => run(cli!, args, { env, timeout: 20_000 });
    return { ...server, dataDir, spy, exec };
  }

  it('hands over the obs-websocket credentials and the screen list with zero configuration', async () => {
    const { dataDir, spy, exec, app } = await boot();
    const wsConfig = join(dataDir, 'ws.json');
    await writeFile(wsConfig, JSON.stringify({ server_enabled: true, server_port: 4466, auth_required: true, server_password: 'cli-pw-123' }));
    const screens = join(dataDir, 'screens-in.json');
    await writeFile(screens, JSON.stringify([{ name: 'DISPLAY2', x: 1920, y: 0, width: 1920, height: 1080, devicePixelRatio: 1, primary: false }]));
    const { stdout, stderr } = await exec(['supervise', '--data-dir', dataDir, '--ws-config', wsConfig, '--screens', screens, '--seconds', '3', '--no-launch']);
    const status = JSON.parse(stdout.trim().split('\n').at(-1)!) as { phase: string; credentials: string };
    expect(status).toMatchObject({ phase: 'running', credentials: 'delivered' });
    expect(spy.connects[0]).toEqual({ url: 'ws://127.0.0.1:4466', password: 'cli-pw-123' });
    expect(stderr).not.toContain('cli-pw-123');
    expect(((await app.inject({ method: 'GET', url: '/api/screens' })).json() as { live: boolean }).live).toBe(true);
  });

  it('delivers presses in order: a message executes, an emergency slot needs the second press', async () => {
    const { dataDir, exec, app } = await boot();
    await app.inject({ method: 'POST', url: '/api/formats', payload: soloFutsalFormat() });
    await app.inject({ method: 'POST', url: '/api/formats/solo-futsal/episodes', payload: { id: 'ep-1', date: '2026-10-12', plannedStart: null, playlistName: null } });
    await app.inject({ method: 'POST', url: '/api/live/load', payload: { episodeId: 'ep-1' } });
    const lines = (out: string) => out.trim().split('\n').map((l) => JSON.parse(l) as { status: number; body: string });
    const message = lines((await exec(['hotkey', '--data-dir', dataDir, '--slot', 'message-1'])).stdout);
    expect(message[0]!.status).toBe(200);
    expect(JSON.parse(message[0]!.body)).toMatchObject({ result: 'executed' });
    const twice = lines((await exec(['hotkey', '--data-dir', dataDir, '--slot', 'control-toggle', '--presses', '2', '--gap-ms', '300'])).stdout);
    expect(twice.map((l) => (JSON.parse(l.body) as { result: string }).result)).toEqual(['pending', 'executed']);
  });

  it('a rejected token is reported, not hidden (wrong secret.token)', async () => {
    const { dataDir, exec } = await boot();
    await writeFile(join(dataDir, 'secret.token'), 'not-the-token');
    const out = (await exec(['hotkey', '--data-dir', dataDir, '--slot', 'clear'])).stdout;
    expect((JSON.parse(out.trim()) as { status: number }).status).toBe(401);
  });
});
```


Run `pnpm vitest run server/test/contract` (the contract checks pass, the CLI scenarios are skipped) and `bash plugin/scripts/verify.sh` (the new C++ case passes: the fixture already matches the code of Tasks 3 and 6).

- [ ] **Step 2: Implement the CLI**

`plugin/tools/cli.cpp`
```cpp
// SPDX-License-Identifier: GPL-2.0-or-later
// olc-cli: drives the plugin's core against a real app, with no OBS. Used by server/test/contract.
//
//   olc-cli supervise --data-dir D --ws-config FILE [--screens FILE] [--seconds N] [--no-launch]
//       runs the Supervisor (health, credentials, screens) for N seconds and prints the final Status as JSON.
//   olc-cli hotkey --data-dir D --slot ID [--presses N] [--gap-ms M] [--session S]
//       sends N presses of one slot M milliseconds apart through HotkeyForwarder and prints one line per press.
#include <chrono>
#include <cstdio>
#include <cstdlib>
#include <fstream>
#include <iostream>
#include <map>
#include <nlohmann/json.hpp>
#include <sstream>
#include <thread>

#include "ApiClient.hpp"
#include "CurlHttp.hpp"
#include "Dispatcher.hpp"
#include "HotkeyForwarder.hpp"
#include "ObsWsConfig.hpp"
#include "Paths.hpp"
#include "ScreenInfo.hpp"
#include "Supervisor.hpp"

using namespace olc;

namespace {
std::optional<std::string> readFile(const std::string& path) {
    std::ifstream in(path, std::ios::binary);
    if (!in) return std::nullopt;
    std::ostringstream ss;
    ss << in.rdbuf();
    return ss.str();
}

int64_t nowMs() {
    using namespace std::chrono;
    return duration_cast<milliseconds>(steady_clock::now().time_since_epoch()).count();
}

std::map<std::string, std::string> parseArgs(int argc, char** argv) {
    std::map<std::string, std::string> out;
    for (int i = 2; i < argc; ++i) {
        const std::string a = argv[i];
        if (a.rfind("--", 0) != 0) continue;
        const std::string key = a.substr(2);
        if (i + 1 < argc && std::string(argv[i + 1]).rfind("--", 0) != 0) out[key] = argv[++i];
        else out[key] = "1";
    }
    return out;
}

const char* phaseName(LaunchPhase p) {
    switch (p) {
    case LaunchPhase::Checking: return "checking";
    case LaunchPhase::Launching: return "launching";
    case LaunchPhase::Running: return "running";
    case LaunchPhase::Incompatible: return "incompatible";
    case LaunchPhase::Unavailable: return "unavailable";
    case LaunchPhase::Failed: return "failed";
    }
    return "?";
}
const char* credName(CredentialState c) {
    switch (c) {
    case CredentialState::NotApplicable: return "not_applicable";
    case CredentialState::Delivered: return "delivered";
    case CredentialState::Failing: return "failing";
    case CredentialState::ServerDisabled: return "server_disabled";
    case CredentialState::ConfigUnreadable: return "config_unreadable";
    }
    return "?";
}

int supervise(const std::map<std::string, std::string>& args) {
    const std::string dataDir = args.at("data-dir");
    const std::string wsConfig = args.at("ws-config");
    std::vector<ScreenInfo> screens;
    if (const auto it = args.find("screens"); it != args.end()) {
        const auto doc = nlohmann::json::parse(readFile(it->second).value_or("[]"), nullptr, false);
        if (doc.is_array())
            for (const auto& s : doc)
                screens.push_back({s.value("name", ""), s.value("x", 0), s.value("y", 0), s.value("width", 0), s.value("height", 0),
                                   s.value("devicePixelRatio", 1.0), s.value("primary", false)});
    }
    CurlHttp http;
    SupervisorDeps deps{http, &nowMs, &readFile, [](const LaunchSpec&) { return false; },
                        [wsConfig] { return loadObsWsConfig(&readFile, wsConfig, std::nullopt, {}); },
                        [](const std::string& line) { std::cerr << "[log] " << line << "\n"; }, dataDir};
    PluginSettings settings;
    settings.autoStart = args.count("no-launch") == 0;
    Supervisor sup(std::move(deps), settings);
    sup.setScreens(screens);
    const int seconds = args.count("seconds") ? std::atoi(args.at("seconds").c_str()) : 3;
    const auto end = std::chrono::steady_clock::now() + std::chrono::seconds(seconds);
    while (std::chrono::steady_clock::now() < end) {
        sup.tick();
        std::this_thread::sleep_for(std::chrono::milliseconds(100));
    }
    const Status st = sup.status();
    std::cout << nlohmann::json{{"phase", phaseName(st.phase)}, {"credentials", credName(st.credentials)}, {"instanceId", st.instanceId},
                                {"port", st.port}, {"dockUrl", st.dockUrl}, {"version", st.appVersion}}.dump()
              << std::endl;
    return 0;
}

int hotkey(const std::map<std::string, std::string>& args) {
    const std::string dataDir = args.at("data-dir");
    const auto paths = dataPaths(dataDir);
    const int port = resolvePort(parseRuntimeJson(readFile(paths.runtime).value_or("")), parseSettingsPort(readFile(paths.settings).value_or("")));
    CurlHttp http;
    ApiClient api(http, "http://127.0.0.1:" + std::to_string(port), [paths] { return readFile(paths.secret).value_or(""); });
    const int presses = args.count("presses") ? std::atoi(args.at("presses").c_str()) : 1;
    const int gap = args.count("gap-ms") ? std::atoi(args.at("gap-ms").c_str()) : 300;
    const std::string session = args.count("session") ? args.at("session") : randomSessionId();
    uint64_t seq = 0;
    for (int i = 0; i < presses; ++i) {
        const auto r = api.postHotkey(args.at("slot"), session, ++seq);
        std::cout << nlohmann::json{{"status", r.status}, {"body", r.body}, {"error", r.error}}.dump() << std::endl;
        if (i + 1 < presses) std::this_thread::sleep_for(std::chrono::milliseconds(gap));
    }
    return 0;
}
}  // namespace

int main(int argc, char** argv) {
    if (argc < 2) {
        std::cerr << "usage: olc-cli supervise|hotkey ...\n";
        return 2;
    }
    try {
        const std::string cmd = argv[1];
        const auto args = parseArgs(argc, argv);
        if (cmd == "supervise") return supervise(args);
        if (cmd == "hotkey") return hotkey(args);
    } catch (const std::exception& e) {
        std::cerr << "error: " << e.what() << "\n";
        return 1;
    }
    std::cerr << "unknown command\n";
    return 2;
}
```


- [ ] **Step 3: Build it and run the real thing**

```bash
bash plugin/scripts/build-plugin.sh          # builds olc-cli too (needs the dev tree for libcurl on Windows)
OLC_CLI="$PWD/plugin/build-plugin/tools/Release/olc-cli.exe" OLC_CLI_DLL_DIR="$PWD/plugin/.deps/deps/bin" pnpm vitest run server/test/contract
```
Expected: 8 passed, 0 skipped. On Linux/macOS the binary is `plugin/build/tools/olc-cli` after `plugin/scripts/test.sh` when libcurl is installed (CI does this).

- [ ] **Step 4: Commit**

```
git add plugin/contract plugin/tests/test_contract.cpp plugin/tools/cli.cpp server/test/contract
git commit -m "test(plugin): plugin-server contract fixture, olc-cli, contract tests against the real C++ core"
```

---

### Task 17: CI — plugin tests and builds on three OS

**Files:**
- Modify: `.github/workflows/ci.yml` (the `ts` job stays **byte-identical**)

**What is reused:** Playlist Deck's `build_project.yml` at commit `092baa2`: the Windows job (obs-deps and Qt downloaded with `gh release download`, OBS built from source for `obs-frontend-api`, both cached), the Linux job (OBS's own `.deb` in an `ubuntu:24.04` container, then a check that the module needs `libobs.so.30`), the macOS universal job (Xcode generator, `macos-26`), and the pinned action SHAs. Left out: installers, signing, the compat matrix, the Ubuntu 26.04 leg (we do not link FFmpeg).

**Interfaces:**
- Jobs: `changes` (path filter on `plugin/` and this file; `vars.SKIP_PLUGIN_CI == 'true'` turns the plugin jobs off; manual runs always build), `plugin-tests` (matrix ubuntu-24.04, windows-2022, macos-15: `bash plugin/scripts/verify.sh`; on Linux also the ABI check against OBS 32.2.2's obs-browser and the contract test with the real `olc-cli`), `plugin-windows`, `plugin-linux`, `plugin-macos` (build the module, check the package, upload the binaries as artifacts; installers are Plan 7). The plugin jobs `needs` the tests. The YAML parses (checked with PyYAML) and the `ts` job is unchanged (compared as parsed data); **the jobs themselves cannot be run here: the first push is their first test.** Expect to iterate on the macOS and Linux legs.

- [ ] **Step 1: Replace the file with**

`.github/workflows/ci.yml`
```yaml
# SPDX-License-Identifier: GPL-2.0-or-later
name: ci
on:
  push:
    branches: [main]
  pull_request:
  workflow_dispatch:

# The plugin jobs follow Playlist Deck's build_project.yml (angeloruggieridj/obs-playlist-deck @ 092baa2): the OBS
# development tree is built from OBS's own source and prebuilt deps, so the plugin links what OBS ships. Actions of
# the plugin jobs are pinned to a commit (tag in the trailing comment); the `ts` job is unchanged from Plan 1.
env:
  # Keep equal to OBS_VERSION in plugin/scripts/setup-obs-dev.sh.
  OBS_VERSION: "32.2.2"
  # What the shipped macOS binary supports; OBS 32.2 itself targets 13.0.
  MACOS_DEPLOYMENT_TARGET: "13.0"

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
      - run: pnpm build

  # Decides whether the plugin jobs run. They are skipped when nothing under plugin/ (or this file) changed, and
  # always when the repository variable SKIP_PLUGIN_CI is "true" (Settings > Variables). Manual runs always build.
  changes:
    permissions:
      contents: read
    runs-on: ubuntu-24.04
    outputs:
      plugin: ${{ steps.filter.outputs.plugin }}
    steps:
      - uses: actions/checkout@d23441a48e516b6c34aea4fa41551a30e30af803 # v6
        with:
          fetch-depth: 0
      - id: filter
        env:
          SKIP: ${{ vars.SKIP_PLUGIN_CI }}
          EVENT: ${{ github.event_name }}
          PR_BASE: ${{ github.event.pull_request.base.sha }}
          PUSH_BEFORE: ${{ github.event.before }}
        run: |
          if [ "$SKIP" = "true" ]; then echo "plugin=false" >> "$GITHUB_OUTPUT"; echo "SKIP_PLUGIN_CI is set"; exit 0; fi
          base=""
          if [ "$EVENT" = "pull_request" ]; then base="$PR_BASE"; fi
          if [ "$EVENT" = "push" ]; then base="$PUSH_BEFORE"; fi
          if [ -z "$base" ] || [ "$base" = "0000000000000000000000000000000000000000" ] || ! git cat-file -e "$base^{commit}" 2>/dev/null; then
            echo "plugin=true" >> "$GITHUB_OUTPUT"; echo "no usable base: building"; exit 0
          fi
          if git diff --name-only "$base" HEAD | grep -qE '^(plugin/|\.github/workflows/ci\.yml$)'; then
            echo "plugin=true" >> "$GITHUB_OUTPUT"
          else
            echo "plugin=false" >> "$GITHUB_OUTPUT"
          fi

  # C++ unit tests of the pure core + the Python helpers, on the three platforms. No OBS, no Qt: this is the same
  # command a developer runs locally (plugin/scripts/verify.sh).
  plugin-tests:
    permissions:
      contents: read
    name: Plugin unit tests (${{ matrix.os }})
    needs: changes
    if: needs.changes.outputs.plugin == 'true'
    strategy:
      fail-fast: false
      matrix:
        os: [ubuntu-24.04, windows-2022, macos-15]
    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/checkout@d23441a48e516b6c34aea4fa41551a30e30af803 # v6
      - name: Build tools (Linux)
        if: runner.os == 'Linux'
        run: sudo apt-get update && sudo apt-get install -y cmake ninja-build libcurl4-openssl-dev
      - name: Build tools (macOS)
        if: runner.os == 'macOS'
        run: brew install cmake ninja
      - name: C++ unit tests and Python helper tests
        shell: bash
        run: bash plugin/scripts/verify.sh
      # Our browser-panel declarations must list the same virtual functions, in the same order, as obs-browser's
      # header of the OBS release we build against (and of the newest tag, informationally).
      - name: Browser panel ABI matches obs-browser
        if: runner.os == 'Linux'
        run: python3 plugin/ci/check_browser_panel_abi.py --local plugin/src/BrowserPanel.hpp --obs-tag "$OBS_VERSION"
      # Linux only: the contract test drives the real C++ core (olc-cli) against a real server.
      - uses: pnpm/action-setup@v4
        if: runner.os == 'Linux'
      - uses: actions/setup-node@v4
        if: runner.os == 'Linux'
        with:
          node-version: 24
          cache: pnpm
      - name: Plugin <-> server contract (C++ core against the real server)
        if: runner.os == 'Linux'
        run: |
          cli="$(find plugin/build -name olc-cli -type f | head -1)"
          test -n "$cli" || { echo "::error::olc-cli was not built"; exit 1; }
          pnpm install --frozen-lockfile
          OLC_CLI="$GITHUB_WORKSPACE/$cli" pnpm vitest run server/test/contract

  plugin-windows:
    permissions:
      contents: read
    name: Plugin build (Windows x64)
    needs: [changes, plugin-tests]
    if: needs.changes.outputs.plugin == 'true'
    runs-on: windows-2022
    steps:
      - uses: actions/checkout@d23441a48e516b6c34aea4fa41551a30e30af803 # v6
      # Qt and the prebuilt deps are OBS's own for OBS_VERSION (read from its CMakePresets.json).
      - name: Resolve OBS dependencies
        run: python plugin/ci/obs_deps.py --obs-version "${{ env.OBS_VERSION }}" --platform windows
      - name: Cache obs-deps
        id: cache-deps
        uses: actions/cache@caa296126883cff596d87d8935842f9db880ef25 # v5
        with:
          path: |
            C:\obs-deps
            C:\obs-deps-qt6
          key: olc-obsdeps-win-x64-${{ env.OBS_DEPS_VERSION }}-qt6-${{ env.OBS_QT6_DEPS_VERSION }}-v1
      - name: Download OBS pre-built deps and Qt
        if: steps.cache-deps.outputs.cache-hit != 'true'
        env:
          GH_TOKEN: ${{ github.token }}
        shell: powershell
        run: |
          $ErrorActionPreference = 'Stop'
          function Get-Deps($release, $asset, $destination) {
            $raw = "C:\deps-raw\$asset"
            New-Item -ItemType Directory -Path $raw, $destination -Force | Out-Null
            gh release download $release --repo obsproject/obs-deps --pattern "$asset.zip" --dir $raw
            if ($LASTEXITCODE -ne 0) { throw "could not download $asset.zip from obs-deps $release" }
            Expand-Archive "$raw\$asset.zip" -DestinationPath "$raw\x"
            $top = Get-ChildItem "$raw\x"
            if ($top.Count -eq 1 -and $top[0].PSIsContainer) { $top = Get-ChildItem $top[0].FullName }
            $top | Move-Item -Destination $destination
          }
          Get-Deps $env:OBS_DEPS_VERSION "windows-deps-$env:OBS_DEPS_VERSION-x64" C:\obs-deps
          Get-Deps $env:OBS_QT6_DEPS_VERSION "windows-deps-qt6-$env:OBS_QT6_DEPS_VERSION-x64" C:\obs-deps-qt6
      - name: Qt environment
        shell: powershell
        run: |
          "Qt6_DIR=C:\obs-deps-qt6" | Out-File -FilePath $env:GITHUB_ENV -Encoding utf8 -Append
          "C:\obs-deps-qt6\bin" | Out-File -FilePath $env:GITHUB_PATH -Encoding utf8 -Append
      - name: Cache OBS dev
        id: cache-obsdev
        uses: actions/cache@caa296126883cff596d87d8935842f9db880ef25 # v5
        with:
          path: C:\obs-dev
          key: olc-obsdev-win-${{ env.OBS_VERSION }}-${{ env.OBS_DEPS_VERSION }}-v1
      - name: Download OBS source
        if: steps.cache-obsdev.outputs.cache-hit != 'true'
        shell: cmd
        run: |
          curl -L "https://github.com/obsproject/obs-studio/archive/refs/tags/%OBS_VERSION%.zip" -o obs.zip
          tar -xf obs.zip -C C:\
      - name: Configure OBS
        if: steps.cache-obsdev.outputs.cache-hit != 'true'
        shell: cmd
        run: |
          cmake -B C:\obs-build -S "C:\obs-studio-${{ env.OBS_VERSION }}" -A x64 ^
            -DENABLE_PLUGINS=OFF ^
            -DENABLE_CORE_MODULES=OFF ^
            -DENABLE_SCRIPTING=OFF ^
            -DENABLE_BROWSER=OFF ^
            -DENABLE_UPDATER=OFF ^
            -DCMAKE_SYSTEM_VERSION=10.0 ^
            -DDepsPath="C:\obs-deps" ^
            -DFFMPEG_PATH="C:\obs-deps" ^
            -DQTDIR="%Qt6_DIR%" ^
            -DCMAKE_PREFIX_PATH="C:\obs-deps;%Qt6_DIR%"
      - name: Build OBS
        if: steps.cache-obsdev.outputs.cache-hit != 'true'
        run: cmake --build C:\obs-build --target obs-frontend-api --config Release --parallel
      - name: Install OBS dev
        if: steps.cache-obsdev.outputs.cache-hit != 'true'
        run: cmake --install C:\obs-build --config Release --component Development --prefix C:\obs-dev
      - name: Configure plugin
        shell: cmd
        run: |
          cmake -B build -S plugin -A x64 ^
            -DCMAKE_BUILD_TYPE=Release ^
            -DBUILD_TESTS=OFF ^
            -DOLC_EXPECTED_QT=%OBS_QT_ABI% ^
            -DCMAKE_PREFIX_PATH="C:\obs-dev;%Qt6_DIR%;C:\obs-deps"
      - name: Build plugin
        run: cmake --build build --config Release
      - name: Install plugin (C:\ProgramData\obs-studio\plugins layout, OBS 33 and legacy)
        run: cmake --install build --config Release --prefix "${{ github.workspace }}\pkg"
      - name: Check the package
        shell: powershell
        run: |
          $ErrorActionPreference = 'Stop'
          foreach ($f in 'obs-live-clock.dll', 'bin\64bit\obs-live-clock.dll') {
            if (-not (Test-Path "${{ github.workspace }}\pkg\obs-live-clock\$f")) { throw "missing from the package: obs-live-clock\$f" }
          }
      - uses: actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a # v7
        with:
          name: obs-live-clock-plugin-windows
          path: pkg

  plugin-linux:
    permissions:
      contents: read
    name: Plugin build (Linux x86_64, Ubuntu 24.04)
    needs: [changes, plugin-tests]
    if: needs.changes.outputs.plugin == 'true'
    runs-on: ubuntu-24.04
    container: ubuntu:24.04
    steps:
      - uses: actions/checkout@d23441a48e516b6c34aea4fa41551a30e30af803 # v6
      # Built against OBS's own .deb (headers and CMake packages under /usr/local), not Ubuntu's libobs-dev: the two
      # disagree on libobs's soname, and a plugin linked against the wrong one does not load into the real OBS.
      - name: Install OBS ${{ env.OBS_VERSION }} and build deps
        run: |
          apt-get update
          DEBIAN_FRONTEND=noninteractive apt-get install -y curl ca-certificates
          deb="OBS-Studio-${OBS_VERSION}-Ubuntu-24.04-x86_64.deb"
          curl -fsSLO "https://github.com/obsproject/obs-studio/releases/download/${OBS_VERSION}/${deb}" \
            || { echo "::error::OBS ${OBS_VERSION} publishes no ${deb}"; exit 1; }
          DEBIAN_FRONTEND=noninteractive apt-get install -y "./${deb}" \
            qt6-base-dev cmake ninja-build g++ pkg-config libsimde-dev libcurl4-openssl-dev
      - name: Configure
        run: cmake -B build -S plugin -G Ninja -DCMAKE_BUILD_TYPE=Release -DBUILD_TESTS=OFF -DCMAKE_PREFIX_PATH="/usr/local;/usr"
      - name: Build
        run: cmake --build build
      - name: Links against OBS's libobs
        run: |
          needed="$(objdump -p build/src/obs-live-clock.so | awk '/NEEDED/ && /libobs/ {print $2}')"
          echo "$needed"
          echo "$needed" | grep -qx "libobs.so.30" || { echo "::error::expected NEEDED libobs.so.30, got: $needed"; exit 1; }
      - name: Install (per-user layout, relative to $HOME)
        run: cmake --install build --prefix "$GITHUB_WORKSPACE/release"
      - name: Package
        run: |
          new=.local/share/obs-studio/plugins/obs-live-clock
          legacy=.config/obs-studio/plugins/obs-live-clock
          for f in "$new/obs-live-clock.so" "$legacy/bin/64bit/obs-live-clock.so"; do
            [ -f "release/$f" ] || { echo "::error::missing from the package: ~/$f"; exit 1; }
          done
          tar -czf obs-live-clock-plugin-linux.tar.gz -C "$GITHUB_WORKSPACE/release" "$new" "$legacy"
      - uses: actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a # v7
        with:
          name: obs-live-clock-plugin-linux
          path: obs-live-clock-plugin-linux.tar.gz

  plugin-macos:
    permissions:
      contents: read
    name: Plugin build (macOS universal)
    needs: [changes, plugin-tests]
    if: needs.changes.outputs.plugin == 'true'
    # OBS 32.2's build refuses an SDK older than macOS 26.5, hence macos-26 (macos-15 ships 15.5).
    runs-on: macos-26
    steps:
      - uses: actions/checkout@d23441a48e516b6c34aea4fa41551a30e30af803 # v6
      - name: Install dependencies
        run: brew install cmake ninja
      - name: Resolve OBS dependencies
        run: python3 plugin/ci/obs_deps.py --obs-version "${{ env.OBS_VERSION }}" --platform macos
      - name: Cache obs-deps
        id: cache-deps
        uses: actions/cache@caa296126883cff596d87d8935842f9db880ef25 # v5
        with:
          path: |
            /tmp/obs-deps
            /tmp/obs-deps-qt6
          key: olc-obsdeps-mac-universal-${{ env.OBS_DEPS_VERSION }}-qt6-${{ env.OBS_QT6_DEPS_VERSION }}-v1
      - name: Download universal OBS pre-built deps
        if: steps.cache-deps.outputs.cache-hit != 'true'
        run: |
          mkdir -p /tmp/obs-deps /tmp/obs-deps-qt6
          curl -fsSL \
            "https://github.com/obsproject/obs-deps/releases/download/${{ env.OBS_DEPS_VERSION }}/macos-deps-${{ env.OBS_DEPS_VERSION }}-universal.tar.xz" \
            | tar -xJ -C /tmp/obs-deps
          curl -fsSL \
            "https://github.com/obsproject/obs-deps/releases/download/${{ env.OBS_QT6_DEPS_VERSION }}/macos-deps-qt6-${{ env.OBS_QT6_DEPS_VERSION }}-universal.tar.xz" \
            | tar -xJ -C /tmp/obs-deps-qt6
      - name: Cache OBS dev
        id: cache-obsdev
        uses: actions/cache@caa296126883cff596d87d8935842f9db880ef25 # v5
        with:
          path: /tmp/obs-dev
          key: olc-obsdev-mac-universal-${{ env.OBS_VERSION }}-${{ env.OBS_DEPS_VERSION }}-${{ env.MACOS_DEPLOYMENT_TARGET }}-v1
      - name: Clone OBS source
        if: steps.cache-obsdev.outputs.cache-hit != 'true'
        run: |
          git clone --depth=1 --branch ${{ env.OBS_VERSION }} https://github.com/obsproject/obs-studio.git /tmp/obs
          # libobs-metal is a Swift-only target nothing here links; it breaks CMake generate. Drop it.
          sed -i.bak 's/^\( *\)add_subdirectory(libobs-metal)/\1# disabled for dev build: add_subdirectory(libobs-metal)/' /tmp/obs/CMakeLists.txt
      - name: Configure OBS (universal)
        if: steps.cache-obsdev.outputs.cache-hit != 'true'
        run: |
          cmake -B /tmp/obs-build -S /tmp/obs \
            -G Xcode \
            -DENABLE_PLUGINS=OFF \
            -DENABLE_CORE_MODULES=OFF \
            -DENABLE_SCRIPTING=OFF \
            -DENABLE_BROWSER=OFF \
            -DENABLE_VLC=OFF \
            -DCMAKE_OSX_ARCHITECTURES="arm64;x86_64" \
            -DCMAKE_OSX_DEPLOYMENT_TARGET="${{ env.MACOS_DEPLOYMENT_TARGET }}" \
            -DCMAKE_OSX_SYSROOT="$(xcrun --sdk macosx --show-sdk-path)" \
            -DCMAKE_PREFIX_PATH="/tmp/obs-deps-qt6;/tmp/obs-deps"
      - name: Build OBS
        if: steps.cache-obsdev.outputs.cache-hit != 'true'
        run: cmake --build /tmp/obs-build --target obs-frontend-api --config Release --parallel
      - name: Install OBS dev
        if: steps.cache-obsdev.outputs.cache-hit != 'true'
        run: cmake --install /tmp/obs-build --config Release --component Development --prefix /tmp/obs-dev
      - name: Configure plugin (universal)
        run: |
          cmake -B build -S plugin \
            -G Ninja \
            -DCMAKE_BUILD_TYPE=Release \
            -DBUILD_TESTS=OFF \
            -DOLC_EXPECTED_QT="$OBS_QT_ABI" \
            -DCMAKE_OSX_ARCHITECTURES="arm64;x86_64" \
            -DCMAKE_OSX_DEPLOYMENT_TARGET="${{ env.MACOS_DEPLOYMENT_TARGET }}" \
            -Dlibobs_DIR="/tmp/obs-dev/Frameworks/libobs.framework/Resources/cmake" \
            -Dobs-frontend-api_DIR="/tmp/obs-dev/lib/cmake/obs-frontend-api" \
            -DQt6_DIR="/tmp/obs-deps-qt6/lib/cmake/Qt6" \
            -DCMAKE_PREFIX_PATH="/tmp/obs-dev;/tmp/obs-deps-qt6;/tmp/obs-deps"
      - name: Build plugin
        run: cmake --build build
      - name: Universal binary check
        run: |
          binary="$(find build -name 'obs-live-clock.so' -o -name 'libobs-live-clock.so' | head -1)"
          test -n "$binary" || { echo "::error::module not found"; find build -maxdepth 3 -type f | head -30; exit 1; }
          archs="$(lipo -archs "$binary")"
          echo "archs: $archs"
          echo "$archs" | grep -q x86_64 && echo "$archs" | grep -q arm64 || { echo "::error::binary is not universal"; exit 1; }
      - name: Install plugin
        run: DESTDIR="${{ github.workspace }}/release" cmake --install build
      - uses: actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a # v7
        with:
          name: obs-live-clock-plugin-macos
          path: release
```


- [ ] **Step 2: Check locally**

`python -c "import yaml,sys; yaml.safe_load(open('.github/workflows/ci.yml'))"` (use a local venv if PyYAML is missing; install nothing globally) and `git diff .github/workflows/ci.yml` shows the `ts` job untouched.

- [ ] **Step 3: Commit**

```
git add .github/workflows/ci.yml
git commit -m "ci: plugin unit tests, contract test and module builds on three OS, path filter and skip switch"
```

- [ ] **Step 4 (after the first push, by the controller):** fix whatever the first run of the Linux/macOS legs reports in a follow-up commit; record the real timings in BACKLOG.

---

### Task 18: Docs and the real-OBS checklist

**Files:**
- Modify: `docs/TEST-PLAN.md`, `README.md`, `docs/BACKLOG.md`, `docs/DECISIONS.md`, `docs/TECH-DESIGN.md`

- [ ] **Step 1: `docs/TEST-PLAN.md`** — append this section (Italian, same style as the existing ones; each item is a check with OBS open):

```markdown
## Plugin e kiosk (Piano 6)

### P0 — Prerequisiti
- OBS ≥ 30 (provato solo con 32.2.2), obs-websocket attivo con password, Node 24, il repository con `pnpm build` eseguito.
- Il plugin installato: `plugin/scripts/build-plugin.sh` e copia di `obs-live-clock.dll` in `C:\ProgramData\obs-studio\plugins\obs-live-clock\` (e in `bin\64bit\`).
- Un file `launch.json` nella cartella dati dell'app (`%APPDATA%\obs-live-clock`) che dice come avviarla, per esempio `{"command":"C:/Program Files/nodejs/node.exe","args":["<repo>/server/node_modules/tsx/dist/cli.mjs","src/app/main.ts"],"cwd":"<repo>/server"}`. Non mettere password nei `args`.
- **Non provare mai nel profilo di produzione**: usa una copia portatile di OBS (`obs64.exe --portable`).

### P1 — Il pannello compare
Avvia OBS. **Pannelli → OBS Live Clock** (al primo avvio il pannello è nascosto: è il comportamento di OBS). Atteso: il pannello mostra la pagina `/dock` entro 5 s; nel log di OBS `dock registered (browser panel)`. Se compare il logo di OBS, attendi 2 s (il pannello naviga di nuovo da solo); se resta, segnalalo (causa non nota, vedi BACKLOG). Con un OBS senza pannelli browser (o su Wayland) compaiono invece il messaggio, l'indirizzo e il pulsante «Apri nel browser».

### P2 — L'app parte da sola
Chiudi l'app, poi riavvia OBS. Atteso: nel log `started the app`, entro 10 s `app running on port 4460`; nessuna finestra nera di console; l'app è un processo indipendente (**chiudi OBS dal gestore attività: l'app resta in esecuzione**, il presenter continua con STIMATO).

### P3 — Credenziali senza configurazione
Elimina `settings.json` dell'app, riavvia tutto. Atteso: nel log di OBS `obs-websocket settings delivered to the app (… password=<secret>)`, in `GET /api/obs/status` `connected`; **la password non compare mai** nel log di OBS né nei log dell'app. Cambia la password in OBS (Strumenti → Impostazioni server WebSocket): entro 10 s l'app si ricollega da sola. Server WebSocket spento: il pannello dice come attivarlo. Password sbagliata inserita a mano nell'app: `auth_failed`, nessuna tempesta di tentativi (vedi sezione 10).

### P4 — Hotkey
In OBS Impostazioni → Tasti scelta rapida compaiono 18 voci «OBS Live Clock: …». Assegna F13 a «CLEAR», F14 a «NEXT», un tasto a «Messaggio 1», chiudi e riapri OBS: le assegnazioni restano. Con una puntata caricata: «Messaggio 1» invia il primo messaggio predefinito entro 500 ms; **NEXT una volta** mostra nel dock «PREMI DI NUOVO NEXT PER CONFERMARE» e non fa nulla; entro 1 s una seconda pressione esegue; dopo 1 s torna al primo stato; due pressioni a meno di 120 ms non confermano. Stream Deck (plugin ufficiale OBS) che attiva la stessa hotkey funziona allo stesso modo. Con l'app spenta premere un tasto non blocca OBS (nessun rallentamento dell'interfaccia).

### P5 — Kiosk sul secondo monitor
Con due monitor: nella vista estesa, pannello «MONITOR CONDUTTORE», scegli il secondo schermo, spunta «Apri il monitor automaticamente», Salva, Apri. Atteso: il presenter in schermo intero **sul monitor scelto**, mai sul principale; scollega il monitor scelto e premi Riapri: stato «schermo non trovato: non apro nulla». Chiudi la finestra a mano: si riapre dopo 2 s; chiudila 5 volte di fila: si ferma («fermato dopo troppe riaperture») e non ricompare finché non premi Apri. Con schermi a scala diversa (125 % / 100 %) verifica la posizione; se sbaglia, imposta una posizione fissa in `settings.json`. **Da provare anche su macOS e Linux (R4): non verificato.**

### P6 — OBS cade durante la live
Con la live in corso uccidi OBS dal gestore attività. Atteso: il presenter continua a contare con l'etichetta STIMATO entro 2 s; riavviando OBS il plugin non lancia una seconda app (un solo processo `node`), consegna di nuovo le credenziali e l'app si riallinea.

### P7 — App remota
Impostazioni del plugin (Strumenti → OBS Live Clock…): «App su un altro computer», indirizzo `http://<pc>:4460`. Atteso: il pannello punta a quell'indirizzo, il plugin non avvia nulla e non consegna credenziali; un indirizzo non valido tiene aperta la finestra con un messaggio.

### P8 — Versioni non compatibili
Con un'app a protocollo diverso (modifica temporanea di `PROTOCOL_VERSION`): banner rosso nel pannello e riga nel log di OBS, nessuna consegna di credenziali, nessun avvio di una seconda app.
```

- [ ] **Step 2: `README.md`** — add a section "OBS plugin" before "Development":

```markdown
## OBS plugin

The `plugin/` folder holds the OBS plugin (C++17, CMake, Qt 6): it shows the dock, starts the app when it is not running, hands it the obs-websocket credentials without any configuration, turns OBS hotkeys into app commands and reports the monitors for the kiosk. The app also works without it.

```bash
bash plugin/scripts/verify.sh          # C++ unit tests (no OBS needed): PASS cpp=… py=…
bash plugin/scripts/setup-obs-dev.sh   # once, Windows only: OBS dev tree into plugin/.deps (5-10 min, ~1 GB)
bash plugin/scripts/build-plugin.sh    # builds obs-live-clock.dll (+ olc-cli)
```

macOS and Linux are built by CI (`.github/workflows/ci.yml`). The plugin needs OBS 30 or newer. Copy the built `obs-live-clock.dll` to `C:\ProgramData\obs-studio\plugins\obs-live-clock\` and to `...\obs-live-clock\bin\64bit\`, then tick **Docks → OBS Live Clock**. Until the installer exists (Plan 7) tell the plugin how to start the app with `launch.json` in the data folder: `{"command": "<executable>", "args": [], "cwd": "<folder>"}` (no secrets in `args`), or set the command in Tools → OBS Live Clock…. The plugin settings (local or remote server, launch command, auto start) live in `plugin_config/obs-live-clock/settings.json` of OBS's config folder. Hotkeys appear in OBS Settings → Hotkeys as "OBS Live Clock: …" (18 slots; the emergency ones — NEXT, PREV, ±time, MANUAL/AUTO — need a second press within one second).

**Kiosk.** `settings.json` of the app may hold `"kiosk": {"enabled": true, "screen": {"kind": "name", "name": "<monitor>"}, "restart": true}` (`kind` is `primary`, `name` or `position` with `x`, `y`; optional `browserPath`). The extended view has a panel to choose the monitor from the list OBS reported and to open or close the window.
```

- [ ] **Step 3: `docs/BACKLOG.md`** — append:

```markdown
## Residui del Piano 6 (accettati, minori)

- **Non verificato fuori da Windows.** Build e test C++ su macOS e Linux (primo controllo: la CI), cartelle di installazione, `--kiosk` e posizionamento multi-monitor su macOS e Linux (R4), Wayland (pannello di ripiego).
- **Coordinate dei monitor.** Il plugin invia la geometria logica di Qt più `devicePixelRatio`; Chrome potrebbe interpretare `--window-position` in pixel fisici con schermi a scala diversa. Rimedio già disponibile: posizione fissa in `settings.json`.
- **Primo avvio del pannello con un profilo CEF nuovo.** Il pannello mostrava la pagina del logo di OBS e restava lì; oggi naviga di nuovo 1,5 s dopo la prima visualizzazione. Causa non nota.
- **OBS 30 e 31 non eseguiti.** L'ABI del pannello è confrontato con l'header di obs-browser dei tag 30.0.0, 32.2.2 e 33.0.0-rc1, non provato a runtime. OBS 33 non provato.
- **Hotkey con Playlist Deck.** Playlist Deck registra le sue hotkey senza ricaricare le assegnazioni salvate nel profilo (libobs non lo fa per le hotkey dei plugin): verificare se ha lo stesso problema.
- **`launch.json`** lo scrive l'installer (Piano 7); oggi a mano. Il processo dell'app eredita l'ambiente di OBS: da controllare con il runtime Node del Piano 7.
- **Altri:** il plugin controlla la salute ogni 5 s e rilancia al massimo 3 volte per sessione; l'elenco schermi salvato è usato come ultimo noto dopo un riavvio e corretto appena il plugin riferisce; il pannello browser non si ricarica se la porta cambia a OBS aperto oltre il normale `setURL`.
```

- [ ] **Step 4: `docs/DECISIONS.md`** — append DT-12 (Italian, same format):

```markdown
## DT-12 · Plugin: pannello browser tramite l'API di obs-browser, hotkey caricate dal plugin, kiosk con limiti

**Data:** 2026-10-12 · **Stato:** accettata

**Decisione.**
1. **Dock.** Il plugin trova il modulo `obs-browser` a runtime (`obs_get_module`, `os_dlsym`), usa `obs_browser_create_qcef` (versione pannello ≥ 3) e registra il widget con `obs_frontend_add_dock_by_id` in `obs_module_post_load`. L'header di obs-browser (GPL-2.0-only) non viene copiato: le dichiarazioni sono scritte dall'ordine delle funzioni virtuali e un controllo di CI lo confronta con l'upstream. Senza pannelli (Wayland, obs-browser assente) il pannello mostra l'indirizzo e un pulsante «Apri nel browser».
2. **Hotkey.** Il plugin carica da sé le assegnazioni salvate da OBS in `basic.ini` `[Hotkeys]`; i nomi di registrazione sono congelati. La conferma della doppia pressione sta nel server (puro, testato), con deduplica per `(session, seq)` e distanza minima di 120 ms; le richieste non vengono mai ritentate.
3. **Kiosk.** Mai su un monitor diverso da quello indicato; riapertura con pause crescenti, al massimo 4 volte in 10 minuti, poi «sospeso» finché l'operatore preme Apri.
4. **Contratto plugin-app.** `plugin/contract/plugin-contract.json` è letto dai test di entrambe le parti. `launch.json` nella cartella dati dice al plugin come avviare l'app (lo scrive l'installer).

**Conseguenze.** Due thread di lavoro nel plugin (nessuna chiamata di rete sul thread dell'interfaccia di OBS). La CI compila il plugin su tre sistemi con l'albero di sviluppo di OBS costruito dai sorgenti.
```

- [ ] **Step 5: `docs/TECH-DESIGN.md`** — three edits: in §3 the row "Dock" ends with "(verificato in OBS 32.2.2: DT-12)" and the **[V]** note is dropped; the row "Hotkey" gets "Le assegnazioni dei tasti le carica il plugin dal profilo (DT-12). Ogni pressione parte su un thread separato, mai ritentata."; §9 gets after the command line: "Se lo schermo scelto non è nell'elenco il kiosk non parte (`screen_missing`); la riapertura ha pause 2, 5, 15, 30 s e si ferma dopo 4 riaperture in 10 minuti. Endpoint: `GET /api/kiosk`, `POST /api/kiosk/{start,stop,restart}`, `GET /api/screens`." and in the table of §7 the line `/api/internal/*` lists `hotkey` and `screens` as built, plus the new public routes `GET /api/hotkeys/pending`, `GET/PUT /api/settings` (solo `kiosk`), `GET /api/kiosk`. In §13: R2 "risolto in 32.2.2, da provare su 30/31" and R7 "`runtime.json` ora contiene anche `version` e `protocol`".

- [ ] **Step 6: Verify and commit**

`pnpm test && pnpm typecheck && pnpm build && bash plugin/scripts/verify.sh`.

```
git add docs README.md
git commit -m "docs: plugin and kiosk checklist, README plugin section, backlog, DT-12, tech design alignment"
```

---

**Final step (controller):** whole-branch Sonnet review, merge, push, watch the first CI run of the plugin jobs.
