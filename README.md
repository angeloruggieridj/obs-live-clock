# OBS Live Clock

Production & presenter clock for OBS Studio–based live productions.

A dedicated monitor tells the presenter **how long is left, what is on air, when they are back in studio, what comes next and how long until the end of the show**. The regia does not need to answer those questions over talkback.

OBS Live Clock **observes** OBS Studio (obs-websocket v5) and [OBS Playlist Deck](https://github.com/angeloruggieridj/obs-playlist-deck) ≥ 1.4.0. It does not control them. During the show it runs on its own, and when it does not know something it says so on screen.

> **Status:** server, OBS integration, the live web clients (presenter, dock, control view) and the editor are implemented; the OBS plugin and installers are next.

## Documentation

- [Product specification](docs/SPEC.md) (Italian)
- [Technical design](docs/TECH-DESIGN.md) (Italian)
- [Technical decisions log](docs/DECISIONS.md) (Italian)

## Web clients

The server serves the built web clients:

- Presenter monitor: `http://127.0.0.1:4460/presenter`
- OBS dock: `http://127.0.0.1:4460/dock`
- Control view: `http://127.0.0.1:4460/control` (`/` redirects to `/control`).

They need `pnpm build` first: the server serves the pages produced by Vite.

Both pages accept query parameters: `?lang=en` switches the interface to English (default Italian), and `?screen=<label>` overrides the screen label shown to the presenter.

**OBS dock.** In OBS open **Docks → Custom Browser Docks**, add URL `http://127.0.0.1:4460/dock` and size the dock to at least 300 px wide. The Plan 6 plugin registers the dock automatically.

**Kiosk.** Plan 6 launches the presenter in kiosk mode. Manually it is `chrome --app=http://127.0.0.1:4460/presenter --kiosk`.

## Editor

The editor is where the director prepares the show before it goes on air.

- With `pnpm dev`, open `http://localhost:5173/editor`.
- After `pnpm build`, the server serves it at `http://localhost:4460/editor`.

What it does:

1. **Library.** Lists, creates, duplicates, renames and deletes formats and episodes; creates an episode from a format (date, planned start, playlist name). Ids are lowercase slugs made from the name. "Load for live" plus links to `/dock`, `/control` and `/presenter`. An episode that is live is read-only, with a banner.
2. **Document editing.** A pure, framework-free document store with a bounded undo/redo history, coalescing of rapid edits, and a debounced, ordered autosave with a visible error/retry state and conflict handling.
3. **Timeline.** Blocks proportional to their duration, reorder by drag and by keyboard, resize with a 5 s snap, create/duplicate/delete/split, a properties panel, the elements of a studio block, the computed studio time with the warnings, total duration and planned end time.
4. **Format-level settings.** Production-mode preset, thresholds, adjust step, REC-pause rule, scene groups (scenes picked from OBS when connected) and preset messages.
5. **Playlist import.** From the live Playlist Deck (`GET /api/deck/items`) and from a playlist file.
6. **Validation and Check OBS.** Validation runs live in the editor with click-to-focus; Check OBS lists what OBS lacks. Errors block "Load for live"; warnings do not.
7. **Server support (minimal).** The server serves `/editor`, adds `GET /api/live/status`, refuses an invalid rundown on `POST /api/live/load` (`409 rundown_invalid`) and reports `media_input_unverified` in Check OBS. No new dependency.

**Keyboard map** (timeline, with a block focused):

| Keys | Action |
|---|---|
| `←` / `→` | select the previous/next block |
| `Alt` + `←` / `→` | move the block |
| `Shift` + `←` / `→` | resize, ±5 s |
| `Ctrl` (or `Cmd`) + `Shift` + `←` / `→` | resize, ±1 min |
| `Delete` | delete the block |
| `Ctrl` (or `Cmd`) + `D` | duplicate the block |
| `Ctrl` (or `Cmd`) + `Z` | undo |
| `Ctrl` + `Shift` + `Z`, or `Ctrl` + `Y` | redo |

`?lang=en` switches the interface to English (default Italian).

**Where the data is.** Formats and episodes are JSON files in the platform data directory — `%APPDATA%/obs-live-clock`, `~/Library/Application Support/obs-live-clock` or `~/.config/obs-live-clock`; `formats/<id>.json` and `episodes/<id>.json`. Set `OLC_DATA_DIR` to use another folder.

**The lock of a live episode.** An episode that is on air cannot be edited: the editor shows "Puntata IN ONDA: sola lettura", every control is disabled, and the server refuses a write with `409 episode_live`. The editor polls `GET /api/live/status` every 3 s, so a tab opened before the start locks itself within a few seconds.

**Playlist files.** The file import reads the three formats the Playlist Deck exporter writes — JSON (`duration` in milliseconds, `-1` when unknown), CSV (`title,path,duration_ms`) and M3U (`#EXTM3U` + `#EXTINF:<seconds>,<title>` + path) — with absolute or portable (relative) paths.

## Development

Requirements: Node.js 24, pnpm (via `corepack enable`).

```bash
pnpm install
pnpm test        # all tests
pnpm typecheck
pnpm build       # vite build (web clients), served by the server
pnpm dev         # obs-sim + server + Vite with [sim] [server] [web] prefixes
pnpm --filter @olc/server dev   # start the local server on http://127.0.0.1:4460
```

`pnpm dev` starts three processes from the repo root with prefixed output: `[sim]` runs the OBS simulator, `[server]` runs the API server against `.dev-data`, and `[web]` runs Vite on `http://localhost:5173`. Once the server answers, it seeds a Solo Futsal format and rehearsal episode (`ep-dev`) and prints the three URLs. Type simulator commands directly in the terminal (`program <scene> | rec <state> | stream <state> | play <index> | media <input> <state> <cursor> <duration> | drop`, for example `rec started`). Run it in an interactive terminal: the simulator exits when its stdin closes; Ctrl+C stops all three processes.

Data is stored in the platform data directory (`%APPDATA%/obs-live-clock`, `~/Library/Application Support/obs-live-clock`, `~/.config/obs-live-clock`); set `OLC_DATA_DIR` to use another folder.

The web clients bundle the [Inter](https://github.com/rsms/inter) font from `@fontsource/inter` (SIL OFL 1.1). See [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).

## License

GPL-2.0-or-later. See [LICENSE](LICENSE).
