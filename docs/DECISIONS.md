# OBS Live Clock — Registro delle decisioni tecniche

Ogni decisione riporta il contesto, la scelta, le alternative scartate e le conseguenze. Riferimento funzionale: [SPEC.md](SPEC.md).

---

## DT-1 · Stack del server: TypeScript su Node.js

**Data:** 2026-09-28 · **Stato:** accettata

**Contesto.** Il server deve fare quattro cose:
- mantenere la connessione con obs-websocket v5 e con il vendor di Playlist Deck;
- eseguire il motore di timing;
- servire quattro interfacce web e inviare loro lo stato via WebSocket;
- salvare i dati su file.

Deve inoltre funzionare offline come applicazione locale: su Windows in primo luogo, possibilmente anche su macOS e Linux.

**Decisione.** Tutto in TypeScript. Il server gira su Node.js e le interfacce web sono scritte in TypeScript. I tipi dello stato live e del modello dati sono definiti una sola volta e condivisi tra server e client. Per parlare con OBS si usa la libreria ufficiale `obs-websocket-js`.

**Alternative scartate.**
- **Go + TypeScript.** Produce un binario singolo più piccolo, ma usa due linguaggi e una libreria OBS non ufficiale.
- **Tauri (Rust).** Offre funzioni native, ma è lo stack più complesso da mantenere. Il server deve comunque essere raggiungibile via LAN.
- **C++/Qt.** Le interfacce web sarebbero comunque necessarie, quindi si lavorerebbe con due tecnologie.

**Conseguenze.**
- Il pacchetto finale include il runtime di Node (circa 40–80 MB).
- La distribuzione su Windows avviene tramite installer, sul modello di Inno Setup già usato per Playlist Deck.

---

## DT-2 · Interfacce web: React + Vite

**Data:** 2026-09-28 · **Stato:** accettata

**Contesto.** Le interfacce da realizzare sono quattro:
- l'editor, con timeline drag & drop e undo/redo;
- il dock di OBS, che gira nel CEF e deve funzionare anche a 300 px di larghezza;
- la vista estesa;
- il monitor del conduttore, con contatori aggiornati a frequenza alta.

**Decisione.** React e Vite per tutte e quattro. I contatori ad alta frequenza si aggiornano in modo isolato: si interpola localmente con `requestAnimationFrame` e si modifica solo il nodo del testo, senza ridisegnare l'albero dei componenti.

**Alternative scartate.**
- **Svelte 5:** ha un ecosistema più piccolo per timeline e drag & drop.
- **Vue 3:** non offre vantaggi specifici per questo progetto.
- **Soluzione mista** (React più JS puro): costringerebbe a due modi diversi di scrivere la UI.

**Conseguenze.** L'editor può usare librerie come `dnd-kit`. Il dock e il monitor devono restare leggeri, senza dipendenze pesanti.

---

## Requisito aggiornato · Multipiattaforma

**Data:** 2026-09-28

Il supporto a Windows, macOS e Linux passa da "possibilmente" a **requisito**. Ne derivano tre vincoli:
- le parti native (launcher, apertura del browser kiosk, avvio automatico) si scrivono per ogni piattaforma;
- ogni piattaforma ha il proprio installer;
- la CI compila per tutte e tre, come per Playlist Deck.

---

## DT-3 · Distribuzione: plugin OBS "sottile" + applicazione separata (già nell'MVP)

**Data:** 2026-09-28 · **Stato:** accettata

**Contesto.** Il server deve continuare a funzionare anche se OBS va in crash: è il fallback "STIMATO" descritto in SPEC §15. L'installazione e l'avvio però devono essere semplici per chi lavora in regia.

**Decisione.** Il sistema è composto da due parti.

1. **Plugin OBS nativo** (C++, stesso stack di Playlist Deck):
   - registra automaticamente il dock di OBS Live Clock;
   - avvia l'applicazione in un **processo separato e staccato** da OBS, se non è già in esecuzione;
   - se configurato con "server remoto", non avvia nulla e si limita a puntare il dock all'URL indicato.
2. **Applicazione OBS Live Clock** (Node.js/TypeScript): server, motore di timing, interfacce web, apertura del monitor kiosk. È un processo indipendente e sopravvive a un crash o alla chiusura di OBS.

**Alternative scartate.**
- **Solo applicazione separata:** il dock va configurato a mano e i componenti da avviare sono due.
- **Tutto dentro OBS:** se OBS cade, cade anche il monitor. Viola SPEC §15.

**Conseguenze.**
- Due componenti da versionare. Serve un contratto di compatibilità tra plugin e applicazione (per esempio un endpoint `/api/health` che restituisce la versione).
- Il plugin va compilato per Windows, macOS e Linux e per ogni versione di OBS supportata. Si può riusare l'impianto CMake e CI di Playlist Deck.
- L'applicazione deve poter partire **anche senza il plugin**, per esempio sulla macchina in LAN o per test.

---

## DT-4 · Organizzazione del codice: monorepo

**Data:** 2026-09-28 · **Stato:** accettata

**Decisione.** Il progetto vive in un unico repository con questa struttura:

```
obs-live-clock/
├─ plugin/    C++ · CMake · plugin OBS "sottile" (dock + avvio app + consegna credenziali)
├─ server/    TypeScript · Node.js · motore live, adapter OBS e Playlist Deck, API, persistenza
├─ web/       TypeScript · React + Vite · editor, dock, vista estesa, monitor conduttore
├─ shared/    TypeScript · tipi e schemi condivisi (modello dati, stato live, protocollo WS)
└─ docs/
```

La parte TypeScript è organizzata come workspace. Il prodotto ha una sola versione e una sola CI, che genera gli installer completi (plugin + app) per Windows, macOS e Linux.

**Alternativa scartata.** Due repository separati, uno per il plugin e uno per l'app. Il contratto tra plugin e app andrebbe versionato su due fronti, con il rischio di rilasciare versioni incompatibili.

---

## DT-5 · Connessione a OBS senza configurazione, con passaggio sicuro delle credenziali

**Data:** 2026-09-28 · **Stato:** accettata

**Contesto.** Il plugin gira dentro OBS e può leggere la configurazione di obs-websocket (abilitazione, porta, autenticazione, password). Passando questi dati all'app, OBS Live Clock si collega a OBS senza che l'utente configuri nulla. La password però non deve mai essere esposta.

**Decisione.**

1. **Segreto locale dell'app.** Al primo avvio l'app genera un token casuale di 256 bit e lo scrive in un file nella cartella dati dell'utente. Il file è leggibile solo dall'utente: ACL utente su Windows, permessi `0600` su macOS e Linux.
2. **Endpoint interno solo in loopback.** L'app espone `POST /api/internal/obs-credentials`, che risponde soltanto a richieste da `127.0.0.1` o `::1`. Anche con l'accesso LAN attivo, questo endpoint resta non raggiungibile dalla rete.
3. **Consegna delle credenziali.** Il plugin legge il token dal file e invia porta e password di obs-websocket a quell'endpoint, con `Authorization: Bearer <token>`. Lo fa ogni volta che:
   - OBS si avvia;
   - il plugin avvia l'app;
   - il plugin rileva che l'app è stata riavviata (controllo di salute).
4. **Solo in memoria.** L'app conserva la password esclusivamente in memoria. Non la scrive mai su disco, nei log o nelle risposte delle API, e non la mostra mai nelle interfacce.
5. **Mai nella riga di comando.** Nessuna credenziale passa come argomento di avvio, che sarebbe visibile ad altri processi e utenti. Anche l'eventuale variabile d'ambiente contiene solo la porta dell'app, mai segreti.

**Casi limite.**
- **Password cambiata in OBS.** Al riavvio di OBS il plugin invia di nuovo le credenziali. Se viene rifiutata l'autenticazione, l'app mostra "OBS: autenticazione fallita" e non riprova a oltranza.
- **App riavviata con OBS spento.** L'app non ha le credenziali e mostra "OBS non connesso", che è la situazione reale. Le riceve di nuovo all'avvio di OBS.
- **App su un'altra macchina in LAN.** Il plugin non può consegnare le credenziali. Porta e password si inseriscono a mano nell'app. Nell'MVP vengono salvate in un file di configurazione con permessi ristretti; **[F]** in seguito nel portachiavi del sistema (Credential Manager, Keychain, Secret Service).

**[I] Da verificare.** La posizione della configurazione di obs-websocket cambia tra le versioni di OBS: `plugin_config/obs-websocket/config.json` oppure la configurazione globale/utente di OBS. Il plugin deve leggerla attraverso le API di OBS, dove disponibili, e gestire entrambe le posizioni.

---

## DT-6 · Persistenza su file JSON

**Data:** 2026-09-28 · **Stato:** accettata

**Decisione.** Tutti i dati sono salvati in file JSON nella cartella dati dell'utente. Ogni tipo di dato ha un file o una cartella dedicati:

```
<cartella dati>/
├─ settings.json
├─ formats/<id>.json
├─ episodes/<id>.json                    (puntate)
├─ checkpoints/<entità>/<id>/<timestamp>.json
├─ live/
│  ├─ snapshot.json                      (stato live per la ripresa, riscritto a ogni cambio)
│  └─ <episodeId>.log.jsonl              (log della live, solo in aggiunta)
└─ secret.token                          (DT-5, permessi ristretti)
```

- **Scritture atomiche:** si scrive su un file temporaneo, si esegue `fsync`, poi lo si rinomina sul file finale. Così un crash non lascia mai un file scritto a metà.
- **Versione dello schema:** ogni file ha un campo `schemaVersion`. All'avvio l'app esegue le migrazioni necessarie.
- **Log in JSONL:** il log della live ha una riga per evento e si scrive solo in aggiunta. Dopo un crash, al massimo va persa l'ultima riga.
- **Export e checkpoint:** l'export è la copia del file JSON, validato all'import. Un checkpoint è una copia con data e ora.
- **Elenchi:** si costruisce un indice in memoria all'avvio, leggendo le cartelle.

**Alternative scartate.**
- **SQLite:** richiede un modulo nativo da gestire per 3 piattaforme, e export/checkpoint andrebbero implementati da zero.
- **Soluzione mista JSON + SQLite:** due meccanismi di persistenza senza un bisogno reale.

---

## DT-7 · Distribuzione dei tempi ai client: ancoraggi + sincronizzazione dell'orologio

**Data:** 2026-09-28 · **Stato:** accettata

**Decisione.**

- **Il server non invia valori che scorrono.** Invia solo **ancoraggi**, cioè fatti con un istante di riferimento, e solo quando cambiano.
  - Esempio: "fine prevista del blocco alle T (ora del server)".
  - Esempio: "posizione del media P all'istante T, in riproduzione".
  - Ogni ancoraggio indica la propria **fonte**: `measured`, `planned` o `estimated`.
- **Ogni client calcola da sé il valore da mostrare** a ogni fotogramma (`requestAnimationFrame`), usando:
  - l'ancoraggio ricevuto;
  - lo **scarto tra il proprio orologio e quello del server**, stimato con ping periodici in stile NTP (si tiene la misura con il ritardo di andata e ritorno più basso).
- **Invio dello stato:**
  - lo **stato completo** viene inviato a ogni cambiamento (pochi KB);
  - un **heartbeat** parte ogni secondo;
  - alla connessione e alla riconnessione il client riceve lo stato completo.
- **Staleness.** Se il client non riceve heartbeat per più di 2 s, mostra "RICONNESSIONE…" e declassa i valori. Non continua a contare come se nulla fosse.
- **Orologi del server:**
  - **monotono** per durate e intervalli, immune ai cambi dell'ora di sistema;
  - **reale** (wall clock) per gli orari mostrati.
- **Protocollo:** i messaggi sono definiti come schemi in `shared/` e validati su entrambi i lati.

**Alternativa scartata.** Il server che trasmette i valori ogni 100 ms genera traffico continuo e scatti, e soprattutto lascia sullo schermo valori congelati che sembrano validi quando la connessione cade.

---

## DT-8 · Decisioni tecniche minori (default adottati, rivedibili)

**Data:** 2026-09-28 · **Stato:** accettata come default

| Tema | Scelta | Motivo |
|---|---|---|
| Runtime | Node.js LTS corrente (24.x) | Supporto lungo |
| Workspace | pnpm workspaces | Monorepo veloce e rigoroso sulle dipendenze |
| Server HTTP/WS | Fastify + `@fastify/websocket` | Maturo, veloce, con validazione degli schemi |
| Schemi e tipi | `zod` in `shared/`, tipi derivati | Un'unica fonte per tipi e validazione runtime |
| Client OBS | `obs-websocket-js` (ufficiale) | DT-1 |
| Test | Vitest | Vedi sotto |
| Test: motore | Funzioni pure e deterministiche con orologio finto | Vedi sotto |
| Test: integrazione | **Simulatore OBS/Playlist Deck** che riproduce sequenze di eventi | Vedi sotto |
| Test: UI | Playwright, in un secondo momento | Vedi sotto |
| Pacchetto app | Bundle esbuild + runtime Node ufficiale incluso nell'installer | Robusto. I Single Executable Applications di Node si valuteranno dopo |
| Installer | Windows: Inno Setup (come Playlist Deck) · macOS: `.pkg` firmato e notarizzato · Linux: `.deb` + archivio | Formati nativi |
| Versione minima di OBS | 30.0 (obs-websocket 5.x integrato) | Allineata a Playlist Deck |
| Versione minima di Playlist Deck | 1.4.0 | Serve per `durationMs` e `playlist-changed` |
| Monitor kiosk | L'app avvia Chrome/Edge/Chromium con `--app`, `--kiosk`, un profilo dedicato e la posizione dello schermo scelto | Indipendente da OBS (SPEC §7) |
| Elenco degli schermi | **[I]** Lo fornisce il plugin (Qt `QGuiApplication::screens()`). Alternativa: Window Management API del browser | Node non sa enumerare i monitor |

**Note sul Test.**
- Il cuore del prodotto è il **motore di timing**. Lo si tiene come funzioni pure e deterministiche, testabili con un orologio finto.
- Il **simulatore OBS/Playlist Deck** permette di provare scenari di live senza avviare OBS.
- I test UI con Playwright arriveranno in una fase successiva.

**Da verificare.** Per distribuire su macOS servono un account Apple Developer e la notarizzazione.

---

## DT-9 · Hotkey tramite il sistema di OBS

**Data:** 2026-09-28 · **Stato:** accettata

**Decisione.** Il plugin registra delle hotkey native di OBS (`obs_hotkey_register_frontend`). Quando una hotkey viene premuta, il plugin la inoltra all'app tramite l'endpoint interno in loopback, autenticato con il token di DT-5.

- **Slot fissi, non uno per preset.** Le hotkey sono registrate come `OBS Live Clock: Messaggio 1…12`, `CLEAR`, `NEXT`, `PREV`, `+tempo`, `−tempo`, `MANUALE/AUTO`. L'app associa gli slot ai messaggi predefiniti del format in base al loro ordine. In questo modo le assegnazioni dei tasti, salvate da OBS per nome, restano valide quando cambiano format o messaggi.
- **Etichette visibili.** Il dock mostra accanto a ogni messaggio lo slot associato, ad esempio "F1 · STRINGI".
- **Stream Deck.** Funziona subito tramite il plugin OBS ufficiale di Stream Deck, che attiva le hotkey di OBS.
- **Endpoint HTTP.** L'endpoint HTTP pubblico resta disponibile per altri strumenti (Companion, script).

**Limite.** Le hotkey funzionano solo con OBS aperto. È accettabile, perché le usa l'operatore che lavora dentro OBS.

**Protezione dei comandi d'emergenza via hotkey.** Per evitare pressioni accidentali, i comandi di emergenza (NEXT, PREV, ±tempo, MANUALE/AUTO) richiedono una **doppia pressione entro 1 s**. Il dock mostra "premi di nuovo per confermare". È coerente con la protezione dei pulsanti del dock (F16).

---

## DT-10 · Licenza: GPL-2.0-or-later per tutto il progetto

**Data:** 2026-09-28 · **Stato:** accettata

**Decisione.** Plugin e applicazione sono entrambi distribuiti con licenza **GPL-2.0-or-later**.

**Motivi.**
- È la licenza di Playlist Deck.
- È compatibile con libobs, a cui il plugin si collega.

**Conseguenze.**
- Nel repository vanno aggiunti il file `LICENSE` e le intestazioni SPDX nei sorgenti.
- Ogni dipendenza deve avere una licenza compatibile con la GPL-2.0-or-later: vanno bene MIT, BSD e ISC. Apache-2.0 è compatibile solo con GPL-3, quindi una dipendenza Apache-2.0 è ammessa soltanto se il prodotto finale viene distribuito sotto GPL-3; ogni caso va verificato.
- La CI controlla le licenze delle dipendenze.
