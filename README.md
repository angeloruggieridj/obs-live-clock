# OBS Live Clock

Production & presenter clock for OBS Studio–based live productions.

A dedicated monitor tells the presenter **how long is left, what is on air, when they are back in studio, what comes next and how long until the end of the show**. The regia does not need to answer those questions over talkback.

OBS Live Clock **observes** OBS Studio (obs-websocket v5) and [OBS Playlist Deck](https://github.com/angeloruggieridj/obs-playlist-deck) ≥ 1.4.0. It does not control them. During the show it runs on its own, and when it does not know something it says so on screen.

> **Status:** server, OBS integration and the live web clients (presenter, dock, control view) are implemented; the editor, the OBS plugin and installers are next.

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
