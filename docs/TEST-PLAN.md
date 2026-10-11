# Piano di test manuale — OBS Live Clock con OBS reale

Questo documento è una checklist per l'operatore in regia. Serve a verificare l'integrazione di
OBS Live Clock con **OBS Studio ≥ 30** e **OBS Playlist Deck ≥ 1.4.0** su Windows.

Ogni passo ha tre parti:

- **Setup** — cosa preparare prima.
- **Azione** — cosa fare.
- **Risultato atteso** — cosa si deve vedere.

> **Nota sulla sicurezza.** In questo documento non va mai scritta una password reale. Dove serve,
> usa il segnaposto `<PASSWORD_OBS>` e sostituiscilo solo al momento dell'esecuzione, sulla macchina
> di regia. Il server tiene la password obs-websocket **solo in memoria**: non viene mai scritta su
> disco, restituita in una risposta HTTP né stampata nei log.

---

## Come osservare lo stato (senza la pagina /presenter)

La pagina web `/presenter` **non esiste ancora**: arriverà con un piano successivo (Plan 4). Finché
non c'è, i passi che parlano di "vista presentatore" si verificano interrogando l'API HTTP del
server. La porta viene da `settings.json` (`port`, predefinita `4460`); gli esempi usano
`http://127.0.0.1:4460`.

```bash
curl -sS 'http://127.0.0.1:4460/api/live/view?role=presenter'
```

La risposta è la proiezione presentatore (`PresenterView`) oppure `404 {"error":"no_episode"}` se
nessun episodio è caricato. I campi da leggere sono:

- `phase` — `preshow` / `live` / `ended`.
- `segment` — `studio` / `media` / `break` / `null`: cosa è in onda adesso.
- `onAir` — `{title, anchor, startedAtWall, durationMs}` del media in onda (o `null`).
- `block` — `{index, name, anchor}` del blocco corrente (o `null`).
- `returnTo` — `{blockName, anchor}` del RIENTRO previsto (o `null`).
- `programEnd` — `{anchor, endsAtWall}` fine programma prevista (o `null`).
- `next` — `{title, durationMs, source}` del prossimo elemento (o `null`).
- `delay` — `{ms, source}` ritardo accumulato rispetto al pianificato (o `null`).
- `message` — `{text}` del messaggio in onda (o `null`).
- `rundownFinished` — `true` quando la scaletta è finita.
- `status` — `{rec, stream, recPaused, obs, control}`; in particolare `status.obs` è `ok` / `lost`
  e `status.control` è `auto` / `manual`.

I conti alla rovescia stanno **dentro** questi campi: `onAir.anchor`, `block.anchor`,
`returnTo.anchor` e `programEnd.anchor` hanno forma

```
{ "kind": "countdown", "endsAt": <epoch ms>, "source": "measured" | "planned" | "estimated" }
{ "kind": "frozen",    "valueMs": <ms>,       "source": ... }
{ "kind": "unknown" }
```

`endsAt` è un epoch in millisecondi con l'orologio del server: il conto residuo è
`endsAt - adesso`. Con `kind: "frozen"` il residuo è già pronto in `valueMs`. La `source` è
`measured` (misurata da OBS), `planned` (dal pianificato) o `estimated` (stima, OBS perso).

Con `role=control` la risposta (`ControlView`) aggiunge la scaletta ordinata:

```bash
curl -sS 'http://127.0.0.1:4460/api/live/view?role=control'
```

i campi in più sono `episode` (`{id, name}`), `control`, `obs`, `ambiguous`, `cursor` (indice dello
slot corrente), `returnSlot`, `offScript`, `decisions[]` e `rows[]` (una riga per slot
con `slot`, `kind`, `title`, `status`, `provisional`, `durationMs`, `durationSource`).

In alternativa si può usare il WebSocket `ws://127.0.0.1:4460/ws`: manda
`{"type":"hello","role":"presenter","protocol":1}` e ricevi messaggi
`{"type":"view","rev":<n>,"role":"presenter","view":<proiezione>}`, dove `view` è esattamente la
proiezione descritta sopra. Con un `protocol` diverso da `1` il server risponde `protocol_mismatch`
e chiude.

---

## 1. Prerequisiti

**Setup**

- OBS Studio ≥ 30 con **obs-websocket** attivo e protetto da password (Strumenti → Server WebSocket).
- Il plugin **OBS Playlist Deck** ≥ 1.4.0 installato in OBS.
- Una scena `PLAYOUT` con una **Media Source** (`Deck Media`) a cui Playlist Deck è agganciato.
- Le scene `CAM 1`, `CAM 2`, `CAM 3` e una scena `BREAK` con una Media Source `Tappo`.
- Node.js 24 e pnpm installati; `pnpm install` eseguito nella radice del repository.
- Prendi nota della porta di obs-websocket (impostazione predefinita `4455`) e della password.
- La cartella dati è quella predefinita (`%APPDATA%\obs-live-clock` su Windows). Per usarne un'altra
  esporta **`OLC_DATA_DIR`** prima di avviare il server: settings, token, episodi, snapshot e journal
  finiscono tutti lì. Host e porta HTTP vengono da `settings.json` (`port`, predefinita `4460`).
- Senza OBS reale puoi pre-testare il piano con il simulatore
  `pnpm --filter @olc/obs-sim start` (vedi la tabella finale): non usa password, quindi **non**
  riproduce `auth_failed`, ma copre scenari, deck, REC/stream e il distacco (`drop`).

**Preparare l'episodio**

Serve un episodio i cui scene group e blocchi corrispondano all'allestimento OBS:

- uno **scene group** con le scene `CAM 1`, `CAM 2`, `CAM 3`, usato da un blocco `studio`;
- un blocco **`break`** con `scene: "BREAK"` e `mediaInput: "Tappo"` (serve al passo 8);
- almeno un **elemento media** in un blocco `studio`, con `path` uguale a una voce del deck (serve al
  segmento media del passo 6 e agli avvisi `deck_legacy` / `deck_item_missing` dei passi 3 e 12).

Per scegliere o creare l'episodio:

1. Elenca gli episodi esistenti e prendi l'`id`:

   ```bash
   curl -sS http://127.0.0.1:4460/api/episodes
   ```

   Se uno ha già le scene giuste, usa il suo `id` come `<ID_EPISODIO>`.

2. Altrimenti creane uno da un format che abbia le scene giuste (`GET /api/formats` per l'`id`):

   ```bash
   curl -sS -X POST http://127.0.0.1:4460/api/formats/<ID_FORMATO>/episodes \
     -H 'Content-Type: application/json' \
     -d '{"id":"<ID_EPISODIO>","date":"2026-10-11","plannedStart":null,"playlistName":"<NOME_PLAYLIST>"}'
   ```

   L'episodio è una copia del format, quindi eredita scene group e blocchi. Per completare o
   correggere le scene e l'elemento media manda l'episodio intero con
   `PUT /api/episodes/<ID_EPISODIO>`.

3. Carica l'episodio nel runtime e avvia il programma:

   ```bash
   curl -sS -X POST http://127.0.0.1:4460/api/live/load \
     -H 'Content-Type: application/json' -d '{"episodeId":"<ID_EPISODIO>"}'

   curl -sS -X POST http://127.0.0.1:4460/api/live/command \
     -H 'Content-Type: application/json' -d '{"name":"start_program"}'
   ```

   L'`id` del comando è quello del protocollo (`ClientCommand`), non quello HTTP: `start_program`,
   `end_program`, `next`, `prev`, `goto` (`{name, slot}`), `adjust` (`{name, deltaMs}`),
   `set_control` (`{name, control}`), `send_message`, `clear_message`, `resolve_decision`.
   Il `load` risponde `{"episodeId": ...}`, il `command` risponde `{"changed": <bool>}`.

4. Controlla le voci del deck e allinea la `path` dell'elemento media (richiede OBS connesso,
   passo 2):

   ```bash
   curl -sS http://127.0.0.1:4460/api/deck/items
   ```

**Risultato atteso**

- `GET /api/episodes` restituisce un episodio `<ID_EPISODIO>` le cui scene (`CAM 1/2/3`, `BREAK`) e
  il cui `mediaInput` `Tappo` coincidono con l'OBS configurato.
- `POST /api/live/load` risponde `{"episodeId":"<ID_EPISODIO>"}` e
  `GET /api/live/view?role=presenter` non è più `404`.
- OBS offre il server WebSocket sulla porta annotata e Playlist Deck risulta attivo.

---

## 2. Avvio del server e consegna delle credenziali

**Setup**

- Da Git Bash, nella radice del repository.

**Azione**

1. Avvia il server:

   ```bash
   pnpm --filter @olc/server dev
   ```

   Il server ascolta sull'host e sulla porta HTTP di `settings.json`; con i valori predefiniti è
   `http://127.0.0.1:4460`. Se hai esportato `OLC_DATA_DIR`, usa quella cartella anche per il token.

2. In un secondo terminale Git Bash, leggi il token condiviso e invia le credenziali a mano
   (finché il Plan 6 non le consegnerà automaticamente):

   ```bash
   TOKEN=$(cat "$APPDATA/obs-live-clock/secret.token")
   curl -sS -o /dev/null -w '%{http_code}\n' \
     -X POST http://127.0.0.1:4460/api/internal/obs-credentials \
     -H "Authorization: Bearer $TOKEN" \
     -H 'Content-Type: application/json' \
     -d '{"host":"127.0.0.1","port":4455,"password":"<PASSWORD_OBS>"}'
   ```

   L'endpoint accetta solo richieste da **loopback**, richiede il token come `Bearer` e risponde
   `204 No Content` in caso di successo. Corpo: `host` (predefinito `127.0.0.1`), `port`, `password`.

**Risultato atteso**

- Il comando stampa `204`.
- In `GET http://127.0.0.1:4460/api/obs/status` il campo `connection` diventa `connected`.
- Nessun log contiene la password.

---

## 3. Check OBS senza problemi

**Setup**

- Server connesso a OBS; episodio caricato nell'editor.

**Azione**

- Esegui il controllo:

  ```bash
  curl -sS -X POST http://127.0.0.1:4460/api/obs/check \
    -H 'Content-Type: application/json' \
    -d '{"episodeId":"<ID_EPISODIO>"}'
  ```

**Risultato atteso**

- Risposta con `connected: true` e `issues: []` (nessun problema).
- Se qualcosa manca compaiono le voci corrispondenti, fra cui: `scene_missing`,
  `media_input_missing`, `deck_absent`, `deck_legacy`, `deck_item_missing`,
  `deck_duration_unknown`; a OBS scollegato `obs_not_connected`.

---

## 4. REC start → la fase presentatore diventa live

**Setup**

- Server connesso, episodio `<ID_EPISODIO>` caricato (`POST /api/live/load`), OBS in onda su `CAM 1`.

**Azione**

- Avvia la registrazione in OBS (REC).
- Leggi la proiezione presentatore:

  ```bash
  curl -sS 'http://127.0.0.1:4460/api/live/view?role=presenter'
  ```

**Risultato atteso**

- La proiezione passa alla fase **live**: `"phase":"live"`.
- `status.rec` diventa `true`.

---

## 5. I cambi camera non avanzano il blocco

**Setup**

- Live avviata (passo 4), blocco in corso.

**Azione**

- Passa il Program da `CAM 1` a `CAM 2`, poi a `CAM 3`, poi di nuovo a `CAM 1`, leggendo la vista
  presentatore dopo ogni cambio.

**Risultato atteso**

- `phase` resta `live` e `segment` resta `studio`.
- Il blocco corrente **non** avanza: `block.index` e `block.name` non cambiano.
- L'`anchor` del blocco resta lo stesso conto alla rovescia: con `block.anchor.kind === "countdown"`
  `endsAt` non cambia; con `kind === "frozen"` `valueMs` non cambia. La `source` resta la stessa
  (`measured` o `estimated`).
- Anche in `role=control` il `cursor` non cambia e `returnSlot` resta `null`.
- Solo i media del deck fanno scattare il segmento media (passo 6).

---

## 6. Servizio da Playlist Deck → segmento media con countdown misurato

**Setup**

- Live avviata, playlist di Playlist Deck popolata con almeno un servizio.

**Azione**

- Manda in Program la scena `PLAYOUT` e fai partire un elemento della playlist dal deck.
- Leggi la proiezione presentatore.

**Risultato atteso**

- Il segmento presentatore diventa **media**: `"segment":"media"`.
- Il conto in onda è **misurato**: `onAir.anchor.source === "measured"`, con
  `kind: "countdown"` e un `endsAt` coerente con la durata reale dell'elemento.

---

## 7. Cutaway breve durante un servizio → il RIENTRO è conservato

**Setup**

- Un servizio media in corso (passo 6).

**Azione**

- Fai un cutaway breve su una camera e poi torna su `PLAYOUT`.

**Risultato atteso**

- Il conteggio del **RIENTRO** resta quello pianificato: `returnTo.anchor` (e `returnTo.blockName`)
  non vengono ricalcolati né azzerati dal cutaway.

---

## 8. BREAK con il tappo → countdown RIENTRO, poi conto positivo rosso

**Setup**

- Live avviata; scena `BREAK` con la Media Source `Tappo` disponibile.

**Azione**

- Manda in Program la scena `BREAK` e avvia il `Tappo`.

**Risultato atteso**

- La proiezione mostra il countdown del **RIENTRO** (`returnTo.anchor`) mentre il `Tappo` va.
- Quando il `Tappo` finisce ma non si è ancora rientrati, il conto va oltre lo zero: `returnTo`
  (o `onAir`) continua a scorrere e `delay.ms` diventa **positivo** (sforamento).
- Il colore **rosso** è solo un dettaglio di resa della futura pagina `/presenter`; qui l'osservabile
  è `delay.ms > 0` con la relativa `source`.

---

## 9. Chiusura di OBS durante la live → STIMATO entro 2 s, poi riallineamento

**Setup**

- Live avviata con un servizio o un break in corso.

**Azione**

1. Chiudi OBS.
2. Riattiva OBS.

Per misurare la latenza, interroga la vista in un ciclo breve e guarda `status.obs` e le `source`:

```bash
for i in $(seq 1 20); do
  curl -sS 'http://127.0.0.1:4460/api/live/view?role=presenter'; echo; sleep 0.5
done
```

**Risultato atteso**

- Entro una **tolleranza di ~2 s** `status.obs` passa a `"lost"` e i valori passano a **STIMATO**
  (`source: "estimated"`), continuando a contare sui tempi pianificati. Il distacco arriva
  dall'evento `ConnectionClosed` di obs-websocket, quindi in pratica è quasi immediato: 2 s è il
  margine ammesso.
- Il server tenta la riconnessione da solo con un **backoff da 0,5 s fino a 5 s** (raddoppia a ogni
  tentativo fino al tetto di 5 s).
- Alla riaccensione, dopo la riconnessione automatica, i valori tornano **misurati** (`source`
  `measured`) e i tempi si riallineano.

---

## 10. Password errata → `auth_failed`, nessuna tempesta di retry

**Setup**

- Server avviato; OBS con una password diversa da quella che stai per inviare.

**Azione**

- Invia credenziali con `password` sbagliata (stesso comando del passo 2, con una password errata).
- In OBS apri **Strumenti → Registro dei file di log → Visualizza registro corrente**.

**Risultato atteso**

- In `GET /api/obs/status` il campo `connection` diventa `"auth_failed"`.
- Il server **non** riprova: un errore di autenticazione ferma i tentativi (nessun retry schedulato),
  quindi nel log di OBS compare **una sola** voce di autenticazione fallita, non tentativi ripetuti.
- **Come ripristinare:** invia di nuovo le credenziali giuste (stesso comando del passo 2, con
  `<PASSWORD_OBS>` corretto). Il nuovo invio riparte da zero e `connection` passa a `"connected"`.

---

## 11. Rimozione di un servizio dalla playlist → sparisce da NEXT

**Setup**

- Live avviata, almeno due servizi in playlist.

**Azione**

- Rimuovi un servizio dalla playlist di Playlist Deck.
- Leggi il campo `next` della proiezione presentatore.

**Risultato atteso**

- Con Playlist Deck ≥ 1.4.0 l'evento arriva subito (con un breve debounce di 150 ms).
- Con Playlist Deck < 1.4.0 il server se ne accorge al giro di polling successivo (entro ~2 s).
- Il servizio rimosso **non** compare più in `next.title` (né come elemento pronto in scaletta).

---

## 12. Plugin più vecchio di 1.4.0 → avviso `deck_legacy` e polling funzionante

**Setup**

- Playlist Deck installato con versione < 1.4.0; episodio con almeno un elemento media di studio.

**Azione**

- Esegui il Check OBS del passo 3.
- Apri `GET /api/deck/items` e osservane gli aggiornamenti.

**Risultato atteso**

- Fra gli `issues` compare un **warning** `deck_legacy`
  (`"The Playlist Deck plugin is older than 1.4.0"`).
- La lista elementi (`GET /api/deck/items`) e i relativi controlli funzionano comunque. In modalità
  legacy l'adapter **non** aggancia gli eventi del vendor: il plugin viene **interrogato** a
  intervalli (`GetStatus` + `GetItems` ogni 2 s, `POLL_MS = 2_000` in `server/src/obs/deck-adapter.ts`).
- Poiché gli eventi `VendorEvent` non sono agganciati, in modalità legacy **non** arrivano eventi
  `item-started`, `playback-state` o `playlist-changed`: gli aggiornamenti della lista arrivano solo
  dal polling del punto precedente.

---

## 13. Riavvio del server durante la live → riprende STIMATO, poi si riallinea

**Setup**

- Live in corso con OBS connesso.

**Azione**

1. Ferma il server (`Ctrl+C`).
2. Riavvia (`pnpm --filter @olc/server dev`) e reinvia le credenziali (passo 2).

**Risultato atteso**

- Al riavvio il runtime riprende dallo snapshot con lo stato in **STIMATO** (`source: "estimated"`).
- Quando l'adapter si riconnette, lo stato torna **misurato** e i tempi si riallineano.

---

## 14. Dimensione del journal dopo 10 minuti di riproduzione

**Setup**

- Server avviato, live in corso per circa 10 minuti con attività normale (cambi scena, servizi, break).

**Azione**

- Ispeziona il journal dell'episodio in `%APPDATA%\obs-live-clock\live\<ID_EPISODIO>.log.jsonl`
  (o sotto `OLC_DATA_DIR` se l'hai impostata).

**Risultato atteso**

- Il file contiene **poche centinaia di righe**, non migliaia. Il journal scrive **una riga per ogni
  input accettato**, cioè solo quando lo stato cambia: i `Tick` che non modificano nulla non
  producono righe.
- In modalità eventi l'adapter scarta gli aggiornamenti di playback che restano entro 500 ms
  (`DRIFT_MS` in `server/src/obs/deck-adapter.ts`) dalla posizione attesa, quindi non arriva una
  riga per ogni `playback-state` del plugin.

---

## Riferimenti rapidi (stato attuale del codice)

| Cosa | Dove | Note |
| --- | --- | --- |
| Consegna credenziali | `POST /api/internal/obs-credentials` | Solo loopback, `Authorization: Bearer <secret.token>`, corpo `{host, port, password}`; `204` in caso di successo; password mai in risposta/log. |
| Stato OBS | `GET /api/obs/status` | `{connection, obsWebSocketVersion, programScene, deck}`; `connection` ∈ `idle`, `connecting`, `connected`, `auth_failed`, `disconnected`. Su `auth_failed` nessun retry. |
| Scene OBS | `GET /api/obs/scenes` | `{scenes}` oppure `409 {"error":"obs_not_connected"}`. |
| Elementi del deck | `GET /api/deck/items` | `{items:[...occurrence]}`; `409 obs_not_connected`, `404 deck_absent`, `409 deck_not_ready` (plugin presente ma prima lettura non ancora completata). |
| Check OBS | `POST /api/obs/check` | Corpo `{episodeId}`; `400 invalid_body`, `404 not_found`; risposta con `connected`, `deck` e `issues[]`. |
| Codici issue | — | `obs_not_connected`, `scene_missing`, `media_input_missing`, `deck_absent`, `deck_legacy`, `deck_item_missing`, `deck_duration_unknown`. |
| Elenco episodi | `GET /api/episodes` | Restituisce gli episodi salvati; prendi l'`id` (`<ID_EPISODIO>`). |
| Carica episodio | `POST /api/live/load` | Corpo `{episodeId}`; risponde `{episodeId}`; `404 not_found`, `409 live_running`. |
| Comandi live | `POST /api/live/command` | Corpo `ClientCommand`, es. `{"name":"start_program"}`; risponde `{changed}`. |
| Vista presentatore | `GET /api/live/view?role=presenter` | `PresenterView`; `400 invalid_role`, `404 no_episode`. La pagina `/presenter` arriverà con un piano successivo. |
| Vista control | `GET /api/live/view?role=control` | `ControlView`; include `cursor`, `rows[]`, `decisions[]`. |
| WebSocket | `ws://127.0.0.1:4460/ws` | `hello` (`{type, role, protocol:1}`) → `view` / `heartbeat` / `ack`; `protocol` diverso → `protocol_mismatch`. |
| Cartella dati | `OLC_DATA_DIR` (env) | Sostituisce il percorso predefinito; host/porta HTTP da `settings.json` (`port`, default `4460`). |
| Simulatore OBS | `pnpm --filter @olc/obs-sim start -- --host <host> --port <porta>` | `--host` default `127.0.0.1`, `--port` default `4455`; comandi da stdin: `program`, `rec`, `stream`, `play`, `media`, `drop`. Non usa password, quindi **non** riproduce `auth_failed`; utile per pre-testare il piano senza OBS reale. |
| Playlist Deck legacy (< 1.4.0) | — | Solo polling degli elementi (~2 s); nessun evento `VendorEvent` agganciato (niente `item-started`/`playback-state`/`playlist-changed`). |
| Backoff riconnessione | `server/src/obs/connection.ts` | Da 0,5 s raddoppiando fino a un tetto di 5 s; l'errore di autenticazione non riprova. |

> Non inserire mai password reali in questo documento né in file versionati.
