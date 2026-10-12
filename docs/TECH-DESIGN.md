# OBS Live Clock — Progettazione tecnica v1.0

Riferimenti:
- requisiti: [SPEC.md](SPEC.md);
- decisioni: [DECISIONS.md](DECISIONS.md) (DT-1…DT-10).

Etichette:
- **[V]** da verificare in fase di sviluppo con OBS reale;
- **[MVP]** / **[v1.x]** indicano il perimetro.

---

## 1. Visione d'insieme

```
┌──────────────────────── OBS Studio (processo) ────────────────────────┐
│  obs-websocket v5 (integrato)          Playlist Deck ≥ 1.4.0 (vendor) │
│  OBS Live Clock Plugin (C++)                                          │
│   ├─ registra il dock (browser CEF) → http://127.0.0.1:<port>/dock    │
│   ├─ registra le hotkey (slot fissi) → inoltro all'app                │
│   ├─ avvia l'app (processo staccato) se non risponde /api/health      │
│   └─ consegna le credenziali obs-websocket + elenco schermi (loopback)│
└───────────────┬───────────────────────────────────────────────────────┘
                │ obs-websocket (ws://127.0.0.1:4455)
┌───────────────▼──────────── OBS Live Clock App (Node.js) ─────────────┐
│ ObsConnection ─► Adapters (OBS, Playlist Deck) ─► DomainEvents        │
│                                         │                             │
│                              LiveEngine (reducer puro) ◄── Commands   │
│                                         │                             │
│               LiveState ─► Projection (ancoraggi) ─► WsHub ─► client  │
│ Persistence (JSON/JSONL) · ClockService · HTTP API · KioskLauncher    │
└───────────────┬───────────────────────────────────────────────────────┘
                │ HTTP + WebSocket
     /editor   /dock   /control (vista estesa)   /presenter (kiosk)
```

**Principio guida.** Il motore di timing è una **funzione pura**: `(stato, evento, ora) → nuovo stato`. Tutto ciò che è I/O (OBS, file, rete, orologio) vive ai margini. Il motore si testa in modo deterministico e si può rieseguire da un log.

---

## 2. Struttura del repository

```
obs-live-clock/
├─ plugin/                     C++17 · CMake · Qt6 (come Playlist Deck)
│  ├─ src/ plugin-main.cpp, AppLauncher, CredentialBridge, HotkeyBridge, DockHost, ScreenInfo
│  └─ CMakeLists.txt, buildspec.json, cmake/ (riuso impianto Playlist Deck)
├─ shared/                     TS · schemi zod + tipi derivati + costanti di protocollo
│  └─ src/ model/, live/, protocol/, i18n/
├─ server/                     TS · Node 24
│  └─ src/
│     ├─ app/          bootstrap, config, paths, lifecycle
│     ├─ obs/          ObsConnection, ObsAdapter, PlaylistDeckAdapter, SceneGraph
│     ├─ engine/       reducer, matcher, timing, recovery, projection   ← puro
│     ├─ persistence/  JsonStore, repositories, LiveJournal, migrations
│     ├─ api/          http routes, internal routes, ws hub
│     ├─ clock/        ClockService (monotonic + wall, NTP check)
│     └─ kiosk/        browser detection + launch
│  └─ test/ unit/, scenarios/ (simulatore), fixtures/
├─ web/                        TS · React + Vite (multi-entry)
│  └─ src/
│     ├─ core/         ws client, server clock sync, anchored values, i18n
│     ├─ editor/  dock/  control/  presenter/
│     └─ ui/           componenti condivisi
├─ tools/obs-sim/              simulatore OBS + Playlist Deck (WS server finto)
├─ installer/                  inno (win), pkg (mac), deb (linux)
├─ docs/
└─ .github/workflows/          ci.yml (TS + plugin 3 OS), release.yml
```

---

## 3. Plugin OBS (C++)

| Responsabilità | Dettaglio |
|---|---|
| **Avvio app** | All'evento `OBS_FRONTEND_EVENT_FINISHED_LOADING` interroga `GET http://127.0.0.1:<port>/api/health`. Se l'app non risponde, la avvia con `QProcess::startDetached` (percorso da installazione o impostazioni) e riprova il controllo con backoff fino a 10 s. |
| **Compatibilità** | `/api/health` restituisce `{ version, protocol }`. Se il protocollo non è compatibile, compare un avviso nel dock e nel log di OBS. |
| **Credenziali** (DT-5) | Legge la configurazione di obs-websocket (abilitato, porta, auth, password) **[V: posizione per versione di OBS]** e il token da `<dati app>/secret.token`. Poi esegue `POST /api/internal/obs-credentials`. Rilancia la stessa chiamata quando il controllo di salute rileva un riavvio dell'app (cambio di `instanceId`). |
| **Dock** | Registra un dock con browser CEF (API di obs-browser, `obs_frontend_add_dock_by_id`) che punta a `/dock`. Se CEF non è disponibile, mostra un messaggio con l'URL da aprire nel browser. (verificato in OBS 32.2.2: DT-12) |
| **Hotkey** (DT-9) | `obs_hotkey_register_frontend` per gli slot fissi. Alla pressione esegue `POST /api/internal/hotkey { slot }`. Le assegnazioni dei tasti le carica il plugin dal profilo (DT-12). Ogni pressione parte su un thread separato, mai ritentata. |
| **Schermi** | Elenco `QGuiApplication::screens()` (nome, geometria, principale), inviato con `POST /api/internal/screens` all'avvio e a ogni cambio. |
| **Modalità remota** | Nelle impostazioni del plugin: `server = locale | remoto (URL)`. In modalità remota non avvia l'app, non consegna credenziali e punta il dock all'URL remoto. |
| **Chiusura di OBS** | Non ferma l'app: è un processo indipendente (SPEC §15). |

Tutte le chiamate interne vanno in loopback con `Authorization: Bearer <token>`, con timeout brevi e senza bloccare il thread UI (le richieste girano su un thread di lavoro).

---

## 4. Applicazione server

### 4.1 Ciclo di vita
1. Risolve la cartella dati per piattaforma:
   - `%APPDATA%/obs-live-clock`
   - `~/Library/Application Support/obs-live-clock`
   - `$XDG_CONFIG_HOME/obs-live-clock`
2. Crea `secret.token` se non esiste, con permessi ristretti.
3. Carica le impostazioni, esegue le migrazioni e costruisce gli indici di format e puntate.
4. Se esiste `live/snapshot.json` di una puntata `live`, esegue la **ripresa** (§5.7).
5. Avvia HTTP e WS su `127.0.0.1` (o `0.0.0.0` se l'accesso LAN è attivo), sulla porta di default `4460` **[da confermare: libera e non in conflitto con obs-websocket 4455]**.
6. Collega OBS appena ha le credenziali (dal plugin o dalle impostazioni).
7. Avvia il kiosk sul monitor configurato, se abilitato.

Esiste una sola istanza per volta: un lock file nella cartella dati. Un secondo avvio segnala l'istanza già attiva ed esce.

### 4.2 ObsConnection
- Usa `obs-websocket-js` con riconnessione a backoff esponenziale (0,5 s → 5 s max), senza jitter.
- Si iscrive agli eventi: `General`, `Scenes`, `Inputs`, `MediaInputs`, `Outputs`, `SceneItems`, `Vendors`.
- **Sincronizzazione iniziale** a ogni connessione: `GetVersion`, `GetCurrentProgramScene`, `GetSceneList`, `GetRecordStatus`, `GetStreamStatus`, grafo delle scene (`GetSceneItemList` ricorsivo, gruppi compresi), `CallVendorRequest(obs-playlist-deck, GetStatus)` e `GetItems`.
- Produce `ObsConnectionState`: `disconnected | connecting | auth_failed | connected`.

### 4.3 Adapter → DomainEvent
Gli adapter traducono eventi OBS e vendor in **DomainEvent** normalizzati, ciascuno con `at` (ora monotona del server). Il motore non conosce OBS.

| DomainEvent | Da |
|---|---|
| `ProgramSceneChanged { scene, visibleSources[] }` | `CurrentProgramSceneChanged` + SceneGraph |
| `SceneGraphChanged` | `SceneItemEnableStateChanged`, `SceneItemCreated/Removed`, `SceneListChanged` |
| `OutputChanged { kind: rec|stream, state: started|stopped|paused|resumed }` | `RecordStateChanged`, `StreamStateChanged` |
| `RecordFileChanged { path }` | `RecordFileChanged` |
| `DeckItemStarted { index, path, title, durationMs }` | vendor `item-started` |
| `DeckPlayback { index, positionMs, durationMs, playing }` | vendor `playback-state` |
| `DeckPlaylistChanged { items[] }` | vendor `playlist-changed` → `GetItems` (debounce 150 ms) |
| `DeckCompleted` | vendor `playlist-completed` |
| `MediaStatus { input, state, cursorMs, durationMs }` | `MediaInputPlaybackStarted/Ended` + interrogazione `GetMediaInputStatus` (4 Hz, solo per i media dei break visibili in Program) |
| `SourceLost` / `SourceRestored { source: obs|deck }` | stato della connessione, presenza del vendor |

**SceneGraph.** Mantiene l'albero scena → elementi (scene annidate e gruppi compresi) e ne ricava `visibleSources(scene)`: tutte le sorgenti abilitate raggiungibili dalla scena in Program. Viene ricalcolato a ogni `SceneGraphChanged`.

**Versione di Playlist Deck.** Se `pluginVersion` è inferiore a 1.4.0, oppure se `playlist-changed` non arriva, l'adapter passa all'interrogazione di `GetItems` ogni 2 s e segnala `capabilities.deckEvents = false`.

---

## 5. LiveEngine (puro)

### 5.1 Stato
```ts
LiveState {
  episodeId, phase: 'idle'|'preshow'|'live'|'overrun_rundown'|'ended',
  t0: MonoTime|null,                       // inizio programma (tempo monotono)
  outputs: { rec, stream, recInterrupted },
  control: 'auto'|'manual',
  source: { obs: 'ok'|'lost', deck: 'ok'|'lost'|'legacy' },
  cursor: { blockIdx, elementIdx },        // dove siamo
  blocks: BlockRuntime[],                  // piano + reale per blocco
  items: ElementRuntime[],                 // per elemento: planned/actual/status
  media: MediaRuntime|null,                // media in onda (deck o break)
  adjustments: { blockId: deltaMs }[],     // ±tempo
  message: ActiveMessage|null,
  pendingDecisions: Decision[],            // es. REC riavviata
  offScript: OffScriptInfo|null
}
```
Le durate sono in millisecondi. I tempi sono **monotoni** (`MonoTime`) per i calcoli e vengono convertiti in orario reale solo nella proiezione.

### 5.2 Reducer
`reduce(state, input, now) → { state, effects[] }`

- `input` è un `DomainEvent`, un `Command` (dalla UI o dalle hotkey) o un `Tick` (timer interno per timeout e passaggi di soglia).
- Gli `effects` sono dichiarativi: `persistSnapshot`, `appendJournal`, `broadcast`, `scheduleTick(at)`.
- Non ci sono chiamate di I/O dentro il reducer.

### 5.3 Matcher (cursore sequenziale)
Dato un `ProgramSceneChanged` o un `DeckItemStarted`, cerca a partire da `cursor` **in avanti** il primo elemento compatibile:

1. **Media di Playlist Deck.** L'elemento è compatibile se `path` coincide con quello collegato (a parità di path si usa l'occorrenza: la n-esima non ancora andata in onda). Il riconoscimento di un media vince su quello per scena.
2. **Break.** La scena in Program è quella collegata al blocco break.
3. **Studio.** La scena appartiene al gruppo Studio **ed** è il primo elemento Studio successivo. I cambi di camera all'interno dello stesso gruppo **non** fanno avanzare il cursore.
4. **Nessuna corrispondenza in avanti:**
   - si cerca **all'indietro** tra gli elementi `postponed` (rimandati), per il caso "Servizio 2 dopo il 3";
   - se non si trova nulla, si imposta `offScript` e il blocco corrente continua (SPEC F9).

Gli elementi scavalcati diventano `postponed`. Diventano `dropped` solo se vengono rimossi dalla playlist (`DeckPlaylistChanged`).

In modalità `manual` il matcher è spento: comandano solo `NEXT`, `PREV` e `GOTO`.

### 5.4 Timing
- **Pianificato.** `plannedStart[b] = t0 + Σ durate(0..b-1)`, dove la durata tiene conto di `adjustments`.
- **Media in un blocco.** `studioMs[b] = durata[b] − Σ media(b)` (usa le durate reali dal deck quando sono note).
- **Ritardo corrente.** `delay = (actualStart[b] − plannedStart[b]) + max(0, now − plannedEnd[b])`, quest'ultima solo in sforamento.
- **Recupero** (`next_elastic` di default). Il ritardo positivo viene sottratto al prossimo blocco elastico non ancora iniziato, fino alla sua quota di studio. L'eventuale residuo passa al successivo. Il risultato è `targetDuration[b]`, che è la durata mostrata al conduttore.
- **Fine prevista.** `forecastEnd = plannedEnd(ultimo) + ritardo residuo non assorbibile`.
- **Break misurato.** La fine del break è `media.startAt + media.durationMs − media.positionMs`, riallineata a ogni `MediaStatus`. Per un **break pianificato** si usa `blockStart + durata` con `source = planned`.
- **Soglie.** `warn` se il rimanente è sotto `format.thresholds.warnMs`, `over` se è sotto 0, `returnImminent` se il rientro è entro `N` secondi.

### 5.5 Fallback "stimato"
Quando `SourceLost(obs)` arriva, la fase resta invariata e il cursore avanza **solo** per scadenza delle durate pianificate (tick). Tutti gli ancoraggi prendono `source = estimated`.

Al `SourceRestored` segue la sincronizzazione iniziale, poi il matcher riallinea il cursore alla realtà. La differenza viene registrata nel journal.

### 5.6 Output, pausa della REC, interruzioni
- **T0** = primo `OutputChanged(started)` in fase `preshow`.
- **Pausa della REC** (§18.2): nel preset `live-to-tape` congela `t0` (si sposta in avanti della durata della pausa). Negli altri preset non ha effetto sui tempi.
- **Stop seguito da start durante la live.** Viene creata una `Decision { kind: 'output_restart', default per preset, deadline: null }`. Il default si applica subito, e una conferma successiva ricalcola retroattivamente journal e marker.
- **Stop di tutte le uscite:**
  - dalla fase `overrun_rundown`, o dall'ultimo blocco → `ended`;
  - prima → `Decision` "fine anticipata o interruzione?", con default `interruzione`.

### 5.7 Persistenza e ripresa
- Ogni input accettato viene aggiunto a `live/<episodeId>.log.jsonl` come `{ seq, wallAt, input }`. L'input contiene già `at`, il tempo monotono.
- `snapshot.json` viene riscritto in modo atomico dopo ogni cambiamento, con `{ schemaVersion, episodeId, wallAt, state }`. I salvataggi ravvicinati sono **accorpati** (coalescing): resta in coda al più un salvataggio, che quando esegue rilegge lo stato più recente, senza un debounce a tempo.
- **Ripresa validata.** Prima di accettare lo stato ripristinato, il runtime lo valida: schema della puntata, coerenza dell'id, lunghezze degli array, proiezione di prova. Uno snapshot rotto viene segnalato e ignorato, e uno spettacolo già concluso (`ended`) non viene ripreso.
- **Ripresa dopo il riavvio.** Il tempo monotono è ancorato all'epoca (`performance.timeOrigin + performance.now()`), quindi i tempi salvati nello snapshot restano validi anche dopo il riavvio, senza bisogno di convertirli. Al riavvio il runtime ricarica lo snapshot e segna OBS come perso (`SourceLost`), quindi tutti i valori sono `estimated`. Quando l'adapter si riconnette, la sincronizzazione iniziale riallinea il rundown. Un salto dell'orologio di sistema (NTP) fra due esecuzioni viene accettato.

---

## 6. Proiezione e protocollo WebSocket

### 6.1 Ancoraggi
La proiezione trasforma `LiveState` in una **vista per ruolo** (`presenter`, `control`) composta da ancoraggi:

```ts
Anchor =
 | { kind: 'countdown', endsAt: ServerWallMs, source: 'measured'|'planned'|'estimated' }
 | { kind: 'frozen',    valueMs: number, source }
 | { kind: 'unknown' }                                     // mostrato come "—"
```

Un conto oltre lo zero si mostra come **sforamento positivo** (`+0:00`, `+0:01` …): **non** esiste un
`countup`. Con `kind: 'frozen'` (`valueMs` è già pronto) il valore è in pausa — media in pausa o REC in
pausa — e si mostra con l'etichetta "PAUSA". Tutti gli schemi vivono in `shared/src/live/views.ts`.

Esempio di vista `presenter` (il payload `view` del messaggio `{ "type": "view", "rev", "role", "view" }`):
```json
{
  "phase": "live", "segment": "studio", "rundownFinished": false,
  "block": { "index": 1, "name": "Secondo blocco", "anchor": { "kind":"countdown","endsAt":1790000000000,"source":"measured" } },
  "onAir": null,
  "returnTo": { "blockName": "Terzo blocco", "anchor": { "kind":"countdown","endsAt":1790000600000,"source":"planned" } },
  "next": { "title": "Servizio 2 · Intervista", "durationMs": 184000, "source": "planned" },
  "programEnd": { "anchor": { "kind":"countdown","endsAt":1790002520000,"source":"planned" }, "endsAtWall": 1790002520000 },
  "delay": { "ms": 42000, "source": "measured" },
  "thresholds": { "warnMs": 60000, "returnImminentMs": 10000 },
  "message": null,
  "status": { "rec": true, "stream": false, "recPaused": false, "obs": "ok", "control": "auto" },
  "preshow": null,
  "ended": null
}
```

### 6.2 Messaggi
Ruoli dei client: `presenter` (solo visualizzazione) e `control` (dock e vista estesa: può inviare comandi). Il dock usa il ruolo `control`.

| Direzione | Tipo | Contenuto |
|---|---|---|
| C→S | `hello` | `{ role, protocol }` |
| S→C | `welcome` | `{ serverVersion, instanceId, protocol }`, seguito subito dalla prima `view` (`null` se non è caricata nessuna puntata) |
| C→S / S→C | `time.ping` / `time.pong` | `{ t0 }` / `{ t0, serverWall }`. Il client stima offset e RTT e tiene il campione con RTT minimo |
| S→C | `view` | Vista completa per ruolo con `rev` crescente. Viene inviata solo quando il JSON è cambiato per quel client |
| S→C | `heartbeat` | Ogni 1 s, `{ rev, serverWall }`, dove `rev` è l'ultima view inviata **a quel client**. Se manca per più di 2 s, il client considera i dati non aggiornati |
| C→S | `command` | `{ id, command }`. `command.name` è uno di `start_program`, `end_program`, `next`, `prev`, `goto`, `adjust`, `set_control`, `send_message`, `clear_message`, `resolve_decision`. Il ruolo `presenter` riceve `forbidden` |
| S→C | `ack` / `error` | `ack { id, changed }`; `error { id, code, message }` con `code` uno di `invalid_message`, `protocol_mismatch` (chiusura 4001), `hello_required`, `no_episode`, `forbidden`, `internal` |

Gli schemi zod sono in `shared/protocol` e vengono validati su entrambi i lati. `protocol` è un intero: un client incompatibile viene rifiutato con un messaggio chiaro.

### 6.3 Rendering nei client
- `useServerClock()` restituisce l'ora del server stimata (`Date.now() + offset`). L'offset è il campione
  con **RTT minimo su una finestra di 8** (`CLOCK_WINDOW = 8`): il campione meno ritardato è il meno
  distorto. Il server è l'unica fonte di tempo: il client non mostra mai il proprio orologio a parete.
- `<AnchoredTime anchor>` si aggiorna con `requestAnimationFrame` scrivendo direttamente nel nodo di testo,
  senza rendere React a 60 fps. Il display arrotonda **per eccesso al secondo intero** (ceil) e cambia sul
  bordo del secondo; la **tally** deriva dai tick mostrati, non dal valore grezzo.
- I conti alla rovescia avanzano solo in avanti: un **passo indietro di un tick** (mostrato 41, ora 42) viene
  trattenuto finché non è più di **250 ms** oltre il bordo (`TICK_HYSTERESIS_MS = 250`), perché quasi sempre
  è jitter da un nuovo ancoraggio o da un nuovo campione dell'orologio; ogni altra variazione si mostra
  subito.
- **Staleness.** Se manca un aggiornamento per più di **2 s** i dati sono *stale*: i conti si **congelano
  all'istante** in cui sono diventati vecchi (non proseguono come se fossero freschi) e, dopo **10 s**
  (`STALE_BLANK_MS`), mostrano `—`.
- `source` e *stale* determinano lo stile: stimato (etichetta "STIMATO" e stile attenuato) e sconosciuto ("—").

---

## 7. API HTTP

| Metodo e percorso | Uso |
|---|---|
| `GET /api/health` | `{ version, protocol, instanceId }` |
| `GET/POST/PUT/DELETE /api/formats[/:id]` | CRUD dei format |
| `POST /api/formats/:id/episodes` | Crea una puntata dal format |
| `GET/PUT/DELETE /api/episodes[/:id]` | CRUD delle puntate. `PUT` è rifiutato (409) se la puntata è live e bloccata |
| `POST /api/episodes/:id/validate` | Errori e avvisi (F6) |
| `POST /api/obs/check` | Check OBS (F7) |
| `GET /api/live/status` | `{ episodeId, phase }`: stato della puntata per il blocco dell'editor |
| `POST /api/live/load` · `POST /api/live/unload` | Carica o scarica la puntata per la live. `load` risponde **`409 rundown_invalid`** (con le `issues`) se il rundown ha errori |
| `GET /api/obs/scenes` | Scene e gruppi, per l'editor |
| `GET /api/deck/items` | Elementi della playlist corrente, per l'editor |
| `POST /api/messages/send` · `/clear` | Endpoint pubblico per Stream Deck, Companion e script |
| `GET/PUT /api/settings` | Impostazioni del kiosk (solo `kiosk`; `browserPath` modificabile solo da loopback) |
| `GET /api/hotkeys/pending` | Ultima hotkey d'emergenza in attesa di conferma (DT-9), per il dock |
| `GET /api/kiosk` · `POST /api/kiosk/{start,stop,restart}` | Stato e comandi del monitor conduttore |
| `POST /api/internal/*` | Solo loopback + bearer: `obs-credentials`, `hotkey`, `screens` |

**L'import avviene nel client:** `GET /api/deck/items` oppure il testo del file letto dal browser e interpretato da `shared/playlist/parse` (JSON, CSV, M3U). Non c'è un endpoint di import lato server.

**[v1.x]** `GET /api/episodes/:id/export`, `POST /api/import`, checkpoint, `GET /api/episodes/:id/markers.csv`.

L'undo/redo dell'editor è **lato client** (stack di comandi sul documento), con salvataggio automatico con debounce verso `PUT`.

---

## 8. Web app

Una build Vite servita dal server stesso dalla cartella `web/dist`. Le entry sono quattro —
`/dock`, `/control`, `/presenter` e **`/editor`** (Piano 5, costruita).

Il server **non** usa `@fastify/static` (tira dentro una dipendenza con licenza BlueOak): ha un
**gestore statico scritto a mano** (`server/src/api/static.ts`). Serve una `index.html` per pagina
**non cachata** (`cache-control: no-cache`) e gli asset con hash sotto `/assets` come **immutabili**
(`max-age=31536000, immutable`); `/` reindirizza a `/control`. Se la build manca risponde `503` con
l'istruzione per eseguirla.

Per lo sviluppo si usa **`pnpm dev`** (simulatore OBS, server e Vite insieme).

- **Editor (Piano 5).** Libreria dei format e delle puntate, timeline orizzontale con blocchi proporzionali alla durata, trascinamento **scritto a mano** (pointer event più `timeline/geometry.ts` puro), maniglie di ridimensionamento con passo di 5 s, pannello proprietà, collegamento a scene e gruppi da `/api/obs/scenes`, import della playlist **nel client**, pannello di validazione, Check OBS, undo/redo. La logica sta in tre pezzi puri, separati dalla UI:
  - `store/document-store.ts` — il documento è un valore immutabile con uno stack di undo/redo limitato; le edit con la stessa `coalesceKey` si fondono in un solo passo;
  - `store/autosave.ts` — guarda lo store, tiene **una sola** scrittura in volo, salva con debounce in ordine e riprova con backoff, con lo stato di errore/riprova **visibile**;
  - `session/session.ts` — apre i documenti, unisce store e autosave, gestisce i conflitti e il blocco della live;
  - la session conserva l'**ultima copia confermata dal server** per accorgersi di una modifica altrui **lato client** (nessun ETag);
  - i componenti (`EditorApp.tsx` e i pannelli) chiamano solo questi moduli e non parlano mai direttamente col server.
- **Dock.** Layout verticale a partire da 300 px:
  - stato e blocco corrente;
  - ritardo e fine prevista;
  - avvisi e decisioni;
  - griglia dei messaggi con lo slot della hotkey;
  - campo per il testo libero;
  - sezione Emergenza (chiusa, con conferma);
  - link alla vista estesa.
- **Control (vista estesa).** Rundown in tabella con stato, pianificato, previsto e reale, journal in tempo reale e gli stessi comandi del dock.
- **Presenter.** Layout Multiview su sfondo nero, a griglia CSS, con font a cifre di larghezza fissa (`font-variant-numeric: tabular-nums`) incluso localmente. Parametri da query string: `?screen=` e `?lang=`. Wake Lock, cursore nascosto, overlay di riconnessione.

**Font e risorse** sono inclusi nella build: nessuna risorsa esterna (NF2).

---

## 9. Kiosk
- Rilevamento del browser per piattaforma, in quest'ordine: Chrome, Edge, Chromium, Brave. È possibile indicare un percorso personalizzato nelle impostazioni.
- Comando: `--app=http://127.0.0.1:<port>/presenter --kiosk --user-data-dir=<dati app>/kiosk-profile --window-position=<x>,<y> --no-first-run --disable-translate --autoplay-policy=no-user-gesture-required`.
- Se lo schermo scelto non è nell'elenco il kiosk non parte (`screen_missing`); la riapertura ha pause 2, 5, 15, 30 s e si ferma dopo 4 riaperture in 10 minuti. Endpoint: `GET /api/kiosk`, `POST /api/kiosk/{start,stop,restart}`, `GET /api/screens`.
- Lo schermo di destinazione viene scelto nelle impostazioni dall'elenco inviato dal plugin (§3). Senza plugin si usa uno schermo fisso configurato a mano.
- Il processo del browser è sorvegliato: se viene chiuso per errore, l'app lo riapre (opzione attiva di default) **[V: comportamento di `--kiosk` su macOS e Linux]**.

---

## 10. Sicurezza
- Default `127.0.0.1`. L'accesso LAN va abilitato esplicitamente e mostra un avviso: "senza login, chiunque in LAN può modificare".
- `/api/internal/*`: solo loopback, con bearer token a confronto a tempo costante.
- La password di obs-websocket non viene mai inclusa in log, risposte o journal. È presente un test automatico che lo verifica.
- CORS chiuso: stessa origine. WebSocket con controllo `Origin`.

---

## 11. Test
| Livello | Cosa | Strumento |
|---|---|---|
| Unità | Reducer, matcher, timing, recupero, proiezione, schemi | Vitest, orologio finto |
| Scenari | Sequenze di DomainEvent → viste attese (es. "servizio saltato", "OBS cade a metà break", "REC riavviata nel live-to-tape") | Vitest + fixture JSON |
| Integrazione | Server reale ↔ `tools/obs-sim` (WS che parla obs-websocket v5 e il vendor Playlist Deck) | Vitest |
| Protocollo | Client WS reale: sincronizzazione dell'orologio, staleness, riconnessione | Vitest |
| UI (dopo) | Editor e presenter | Playwright |
| Manuale | Checklist con OBS reale + Playlist Deck 1.4.0 su 3 OS | docs/TEST-PLAN.md |

I criteri di accettazione AC1–AC12 della SPEC diventano scenari automatici dove possibile.

---

## 12. Build, CI, rilascio
- `pnpm -r build`: prima `shared`, poi `server` (bundle esbuild), poi `web` (Vite).
- Il plugin usa CMake + buildspec, riusando l'impianto di Playlist Deck.
- **CI:**
  - lint e typecheck;
  - test TS;
  - build del plugin per Windows, macOS universal e Linux;
  - controllo delle licenze.
- **Release:** l'installer per piattaforma contiene il plugin (nella cartella plugin di OBS), l'app (bundle + runtime Node) e le scorciatoie. Opzione di avvio automatico al login.

---

## 13. Rischi e verifiche
| # | Rischio / verifica | Mitigazione |
|---|---|---|
| R1 | Posizione della configurazione di obs-websocket che cambia tra le versioni di OBS | Il plugin legge entrambe le posizioni. Fallback: inserimento manuale |
| R2 | API per il dock CEF da plugin (OBS 30+) | risolto in 32.2.2, da provare su 30/31 |
| R3 | `MediaInputActionTriggered` non copre pausa e seek fatti dalla UI | Interrogazione di `GetMediaInputStatus` a 4 Hz sui media visibili |
| R4 | Kiosk su macOS e Linux (posizionamento sullo schermo giusto) | Spike. Fallback: finestra `--app` a schermo intero manuale |
| R5 | Notarizzazione su macOS | Account Apple Developer. Fallback: istruzioni per lo sblocco manuale |
| R6 | Deriva del timer JS e throttling delle schede in background | I client usano ancoraggi e l'ora del server, non timer cumulativi. Il presenter è in primo piano (kiosk) |
| R7 | Conflitto di porta | Porta configurabile. Il plugin la legge da `<dati app>/runtime.json`, che ora contiene anche `version` e `protocol` |

---

## 14. Ordine di costruzione proposto
1. **Base:** monorepo, `shared` (schemi), persistenza JSON, CI TS.
2. **Motore:** reducer, matcher e timing, con test di scenario. È il cuore del prodotto e si testa senza OBS.
3. **Simulatore OBS/Playlist Deck** e adapter OBS reali.
4. **Protocollo WS**, sincronizzazione dell'orologio, **presenter**: primo risultato visibile end-to-end.
5. **Dock e vista estesa**, con messaggi ed emergenza.
6. **Editor**: format, puntate, timeline, import, validazione, Check OBS, undo/redo.
7. **Plugin C++:** avvio app, credenziali, dock, hotkey, schermi.
8. **Kiosk, installer, rilascio.**
