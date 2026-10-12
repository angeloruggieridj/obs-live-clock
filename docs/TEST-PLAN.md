# Piano di test manuale — OBS Live Clock con OBS reale

Questo documento è una checklist per l'operatore in regia. Serve a verificare l'integrazione di
OBS Live Clock con **OBS Studio ≥ 30** e **OBS Playlist Deck ≥ 1.4.0** su Windows.

Ogni passo ha tre parti:

- **Setup** — cosa preparare prima.
- **Azione** — cosa fare.
- **Risultato atteso** — cosa si deve vedere.

> **Nota sulla sicurezza.** In questo documento non va mai scritta una password reale. Dove serve,
> usa il segnaposto `<PASSWORD_OBS>` e sostituiscilo solo al momento dell'esecuzione, sulla macchina
> di regia. La password consegnata con `POST /api/internal/obs-credentials` (passo 2) resta **solo in
> memoria**: non viene mai restituita in una risposta HTTP né stampata nei log. Fa eccezione la
> modalità **remote** (nessun plugin che consegna le credenziali): lì l'operatore può scrivere la
> password in `settings.obs.password` dentro `settings.json`, quindi su disco con i permessi del
> file. In quel caso la nota "solo in memoria" non si applica — vale solo per la consegna via
> endpoint.

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
- `preshow` — quando `phase` è `preshow`, `{plannedStart, totalDurationMs, upcoming[]}`; altrimenti
  `null`.

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

Con `role=control` la risposta (`ControlView`) **non è una vista piatta**: la proiezione presentatore
è annidata dentro un campo `presenter`, e accanto ad essa ci sono i campi di controllo e la scaletta
ordinata:

```bash
curl -sS 'http://127.0.0.1:4460/api/live/view?role=control'
```

- `presenter` — la stessa `PresenterView` descritta sopra (fase, segmento, conti alla rovescia,
  `status`, `preshow` …). **Non** è appiattita al livello esterno.
- `episode` — `{id, name}` dell'episodio caricato.
- `control` — `auto` / `manual`.
- `obs` — `ok` / `lost`.
- `ambiguous` — `true` se lo stato è ambiguo.
- `cursor` — indice dello slot corrente.
- `returnSlot` — indice dello slot di rientro (o `null`).
- `offScript` — `{scene, sinceWall}` se OBS è su una scena fuori scaletta (o `null`).
- `decisions[]` — `{id, kind, atWall, defaultChoice, choice, confirmed}`.
- `rows[]` — una riga per slot: `slot`, `blockIndex`, `blockName`, `kind`, `title`, `status`,
  `provisional`, `durationMs`, `durationSource`, `startedAtWall`, `endedAtWall`.

In alternativa si può usare il WebSocket `ws://127.0.0.1:4460/ws`: manda
`{"type":"hello","role":"presenter","protocol":1}` e ricevi messaggi
`{"type":"view","rev":<n>,"role":"presenter","view":<proiezione>}`, dove `view` è esattamente la
proiezione descritta sopra. Con un `protocol` diverso da `1` il server risponde `protocol_mismatch`
e chiude.

---

## 1. Prerequisiti (lato OBS)

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

> **Ordine da seguire.** 1) Prepara OBS e il plugin (questa sezione). 2) Avvia il server e consegna
> le credenziali (sezione 2): senza OBS connesso `GET /api/deck/items` (409 `obs_not_connected`) e
> `POST /api/obs/check` non funzionano. 3) Prepara l'episodio e allinea il deck (sezione
> «Prerequisiti dell'episodio», subito dopo la 2). Solo allora esegui i passi da 3 a 14.

**Risultato atteso**

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
   TOKEN=$(cat "${OLC_DATA_DIR:-$APPDATA/obs-live-clock}/secret.token")
   read -rsp 'Password OBS: ' OBS_PW; echo
   printf '{"host":"127.0.0.1","port":4455,"password":"%s"}' "$OBS_PW" | curl -sS -o /dev/null -w '%{http_code}\n' \
     -X POST http://127.0.0.1:4460/api/internal/obs-credentials \
     -H "Authorization: Bearer $TOKEN" \
     -H 'Content-Type: application/json' \
     --data-binary @-
   unset OBS_PW
   ```

   La password viene chiesta con `read -s` (non compare a schermo né nella cronologia, perché non è mai
   digitata in un comando) e passata a `curl` da **stdin** (`--data-binary @-`), quindi non compare sulla
   riga di comando. Non usare un here-doc con la password scritta dentro: la shell lo registrerebbe nella
   cronologia. L'endpoint accetta solo richieste da **loopback**,
   richiede il token come `Bearer` e risponde `204 No Content` in caso di successo. Corpo: `host`
   (predefinito `127.0.0.1`), `port`, `password`. Se il plugin (Plan 6) non è installato, l'operatore può
   anche mettere `host`/`port`/`password` in `settings.obs` di `settings.json` (modalità remote).

**Risultato atteso**

- Il comando stampa `204`.
- In `GET http://127.0.0.1:4460/api/obs/status` il campo `connection` diventa `connected`.
- Nessun log contiene la password.

---

## Prerequisiti dell'episodio (con server e OBS connessi)

Si eseguono **dopo** la sezione 2. Serve un episodio i cui scene group e blocchi corrispondano
all'allestimento OBS:

- uno **scene group** con le scene `CAM 1`, `CAM 2`, `CAM 3`, usato da un blocco `studio`;
- un blocco **`break`** con `scene: "BREAK"` e `mediaInput: "Tappo"` (serve al passo 8);
- almeno un **elemento media** in un blocco `studio`, con `path` uguale a una voce del deck (serve al
  segmento media del passo 6 e agli avvisi `deck_legacy` / `deck_item_missing` dei passi 3 e 12).

**Crea un format di prova** (valido per `shared/src/model/format.ts`) e registralo con
`POST /api/formats`:

```bash
curl -sS -X POST http://127.0.0.1:4460/api/formats \
  -H 'Content-Type: application/json' \
  --data-binary @- <<'JSON'
{
  "schemaVersion": 1,
  "id": "<ID_FORMATO>",
  "name": "Format di prova",
  "preset": {
    "mode": "streaming",
    "warnMs": 60000,
    "returnImminentMs": 10000,
    "adjustStepMs": 30000,
    "recPauseFreezesProgram": false
  },
  "sceneGroups": [
    { "id": "sg-cam", "name": "Camere", "scenes": ["CAM 1", "CAM 2", "CAM 3"] }
  ],
  "messages": [
    { "id": "msg-break", "text": "Pubblicità", "dismiss": { "kind": "manual" } }
  ],
  "blocks": [
    {
      "id": "blk-studio",
      "kind": "studio",
      "name": "Studio",
      "durationMs": 600000,
      "elastic": true,
      "sceneGroupId": "sg-cam",
      "elements": [
        { "id": "el-studio", "kind": "studio" },
        {
          "id": "el-servizio",
          "kind": "media",
          "title": "Servizio",
          "path": "<PERCORSO_ITEM_DECK>",
          "occurrence": 0,
          "plannedDurationMs": 120000
        }
      ]
    },
    {
      "id": "blk-break",
      "kind": "break",
      "name": "Break",
      "durationMs": 120000,
      "scene": "BREAK",
      "mediaInput": "Tappo"
    }
  ]
}
JSON
```

Sostituisci `<ID_FORMATO>` e `<PERCORSO_ITEM_DECK>` (la `path` deve combaciare con una voce del
deck). La risposta è `201` con il format salvato; se `<ID_FORMATO>` esiste già è `409
{"error":"exists"}`.

**Crea l'episodio** come copia del format (`201`):

```bash
curl -sS -X POST http://127.0.0.1:4460/api/formats/<ID_FORMATO>/episodes \
  -H 'Content-Type: application/json' \
  -d '{"id":"<ID_EPISODIO>","date":"2026-10-11","plannedStart":null,"playlistName":null}'
```

**Carica l'episodio** nel runtime (senza avviare il programma):

```bash
curl -sS -X POST http://127.0.0.1:4460/api/live/load \
  -H 'Content-Type: application/json' -d '{"episodeId":"<ID_EPISODIO>"}'
```

**Allinea il deck** (richiede OBS connesso, sezione 2):

```bash
curl -sS http://127.0.0.1:4460/api/deck/items
```

**Risultato atteso**

- Il format è salvato (`201`) e l'episodio è creato (`201`), copia del format (stessi scene group e
  blocchi).
- `POST /api/live/load` risponde `{"episodeId":"<ID_EPISODIO>"}` e
  `GET /api/live/view?role=presenter` mostra `"phase":"preshow"` con `preshow` non `null`: il
  programma **non** è ancora partito.
- `GET /api/deck/items` risponde `200` con `{items:[...occurrence]}`; se OBS non è connesso risponde
  `409 {"error":"obs_not_connected"}`.
- `PUT /api/episodes/<ID_EPISODIO>` mentre la puntata è **live** risponde `409
  {"error":"episode_live"}`: la modifica non tocca la puntata in onda.
- `POST /api/live/load` mentre **un altro** episodio è già live risponde `409
  {"error":"live_running"}`.

> **Avviare il programma senza REC.** Dopo il `load` la fase è `preshow`. Il comando
> `POST /api/live/command -d '{"name":"start_program"}'` fa partire la scaletta e porta la fase a
> `live` **senza registrare**. Usalo solo per i passi che richiedono un programma in corso senza REC:
> se lo invii qui, il passo 4 ("REC start → live") non è più osservabile, perché la fase è già
> `live` (il motore accetta `start_program` solo da `preshow`). Nel percorso principale **non**
> inviarlo: la fase diventa `live` al passo 4, quando OBS inizia a registrare; i passi da 5 a 11
> valgono da lì in avanti.

---

## 3. Check OBS senza problemi

**Setup**

- Server connesso a OBS; episodio caricato (`POST /api/live/load`, vedi «Prerequisiti
  dell'episodio»).

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

- Server connesso, episodio `<ID_EPISODIO>` caricato (`POST /api/live/load`), OBS in onda su `CAM 1`,
  fase ancora `preshow` (non hai inviato `start_program`).

**Azione**

- Avvia la registrazione in OBS (REC).
- Leggi la proiezione presentatore:

  ```bash
  curl -sS 'http://127.0.0.1:4460/api/live/view?role=presenter'
  ```

**Risultato atteso**

- La proiezione passa alla fase **live**: `"phase":"live"`.
- `status.rec` diventa `true`.
- I passi da **5 a 11** richiedono questa fase `live`, raggiunta qui avviando REC.

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
- Anche in `role=control` il `cursor` non cambia e `returnSlot` resta `null`. Nella `ControlView` i
  conti alla rovescia stanno dentro `presenter`, non al livello esterno.
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

Per misurare la latenza, interroga la vista in un ciclo breve, stampando il timestamp di ogni
lettura, e guarda `status.obs` e le `source`:

```bash
for i in $(seq 1 20); do
  printf '%s ' "$(date +%s.%N)"
  curl -sS 'http://127.0.0.1:4460/api/live/view?role=presenter'; echo
  sleep 0.5
done
```

**Risultato atteso**

- Entro una **tolleranza di ~2 s** `status.obs` passa a `"lost"` e i valori passano a **STIMATO**
  (`source: "estimated"`), continuando a contare sui tempi pianificati. Il distacco arriva
  dall'evento `ConnectionClosed` di obs-websocket, quindi in pratica è quasi immediato: 2 s è il
  margine ammesso (i timestamp stampati dal ciclo permettono di misurare quando avviene il
  passaggio).
- Il server tenta la riconnessione da solo con un **backoff da 0,5 s fino a 5 s** (raddoppia a ogni
  tentativo fino al tetto di 5 s).
- Alla riaccensione, dopo la riconnessione automatica, i valori tornano **misurati** (`source`
  `measured`) e i tempi si riallineano.

---

## 10. Password errata → `auth_failed`, nessuna tempesta di retry

**Setup**

- Server avviato; OBS con una password diversa da quella che stai per inviare.

**Azione**

1. Invia credenziali con `password` sbagliata (stesso comando del passo 2, con una password errata).
2. Interroga lo stato più volte per qualche secondo:

   ```bash
   for i in $(seq 1 10); do
     curl -sS http://127.0.0.1:4460/api/obs/status; echo; sleep 1
   done
   ```

3. In OBS apri **Aiuto → File di log → Visualizza registro corrente**.

**Risultato atteso**

- In `GET /api/obs/status` il campo `connection` diventa `"auth_failed"` e **resta** lì:
  interrogando lo stato come al punto 2 non lo si vede mai tornare a `"connecting"`.
- Il server **non** riprova: un errore di autenticazione ferma i tentativi (in
  `server/src/obs/connection.ts` il ramo `auth_failed` ritorna senza schedulare una riconnessione),
  quindi nel log di OBS compare **una sola** voce di autenticazione fallita e, nel tempo, **nessuna
  nuova connessione** (nessun tentativo ripetuto). Lo stesso silenzio si osserva dal lato
  simulatore/OBS: nessun nuovo handshake in arrivo.
- **Come ripristinare:** invia di nuovo le credenziali giuste (stesso comando del passo 2, con
  `<PASSWORD_OBS>` corretto). Un nuovo `POST` riparte da zero e `connection` passa a `"connected"`.

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
  (`"Media matching is unavailable with this Playlist Deck version (events need >= 1.4.0)"`).
- La lista elementi (`GET /api/deck/items`) e i relativi controlli funzionano comunque. In modalità
  legacy l'adapter **non** aggancia gli eventi del vendor: il plugin viene **interrogato** a
  intervalli (`GetStatus` + `GetItems` ogni 2 s, `POLL_MS = 2_000` in `server/src/obs/deck-adapter.ts`).
- Poiché gli eventi `VendorEvent` non sono agganciati, in modalità legacy **non** arrivano eventi
  `item-started`, `playback-state` o `playlist-changed`: gli aggiornamenti della lista arrivano solo
  dal polling del punto precedente.
- Di conseguenza, con un plugin legacy **nessun** evento di riproduzione (`item-started`,
  `playback-state`) raggiunge il motore: il countdown **misurato** del passo 6 non si applica. Qui la
  durata resta quella pianificata o ricavata dal polling, non la misura live di OBS.

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
| Creazione format | `POST /api/formats` | Corpo `Format` (schemaVersion 1); `201` creato, `409 {"error":"exists"}` se l'id esiste già. |
| Creazione episodio | `POST /api/formats/:id/episodes` | Corpo `{id, date, plannedStart, playlistName}`; `201` creato, `404 not_found`, `409 {"error":"exists"}`. |
| Modifica episodio | `PUT /api/episodes/:id` | `400 id_mismatch`; `409 {"error":"episode_live"}` se l'episodio è in onda. |
| Elenco episodi | `GET /api/episodes` | Restituisce gli episodi salvati; prendi l'`id` (`<ID_EPISODIO>`). |
| Carica episodio | `POST /api/live/load` | Corpo `{episodeId}`; risponde `{episodeId}`; `404 not_found`, `409 {"error":"live_running"}` se un altro episodio è live; dopo il load la fase è `preshow`. |
| Comandi live | `POST /api/live/command` | Corpo `ClientCommand`, es. `{"name":"start_program"}`; risponde `{changed}`. `start_program` è accettato solo da `preshow`. |
| Vista presentatore | `GET /api/live/view?role=presenter` | `PresenterView`; `400 invalid_role`, `404 no_episode`. La pagina `/presenter` arriverà con un piano successivo. |
| Vista control | `GET /api/live/view?role=control` | `ControlView`: `presenter` (annidata), `episode`, `control`, `obs`, `ambiguous`, `cursor`, `returnSlot`, `offScript`, `decisions[]`, `rows[]`. |
| WebSocket | `ws://127.0.0.1:4460/ws` | `hello` (`{type, role, protocol:1}`) → `view` / `heartbeat` / `ack`; `protocol` diverso → `protocol_mismatch`. |
| Cartella dati | `OLC_DATA_DIR` (env) | Sostituisce il percorso predefinito; host/porta HTTP da `settings.json` (`port`, default `4460`). Token in `${OLC_DATA_DIR:-$APPDATA/obs-live-clock}/secret.token`. |
| Simulatore OBS | `pnpm --filter @olc/obs-sim start -- --host <host> --port <porta>` | `--host` default `127.0.0.1`, `--port` default `4455`; comandi da stdin: `program`, `rec`, `stream`, `play`, `media`, `drop`. Non usa password, quindi **non** riproduce `auth_failed`; utile per pre-testare il piano senza OBS reale. |
| Playlist Deck legacy (< 1.4.0) | — | Solo polling degli elementi (~2 s); nessun evento `VendorEvent` agganciato (niente `item-started`/`playback-state`/`playlist-changed`). |
| Backoff riconnessione | `server/src/obs/connection.ts` | Da 0,5 s raddoppiando fino a un tetto di 5 s; l'errore di autenticazione non riprova. |

> Non inserire mai password reali in questo documento né in file versionati.

---

## Client web (Piano 4)

Questa sezione verifica i tre client web — `/presenter`, `/dock` e `/control` — con OBS reale. La build
(`web/dist`) è servita dal server stesso, quindi non serve un web server separato. Vale lo stesso
formato: **Setup**, **Azione**, **Risultato atteso**.

### 15.1 Prerequisiti

**Setup**

- `pnpm build` eseguito e server avviato (`pnpm --filter @olc/server dev`), come alla sezione 2.
- Un TV da **32"** sulla **seconda uscita HDMI**, in regia.
- Chrome o Edge in **modalità kiosk** su `http://127.0.0.1:4460/presenter`.
- OBS 30.x con il **Custom Browser Dock** puntato a `http://127.0.0.1:4460/dock`.
- `/control` aperta in un'altra scheda.

**Risultato atteso**

- Le tre pagine si aprono; senza OBS il presenter mostra i valori stimati, non un errore.

### 15.2 Leggibilità sul TV (AC10)

**Setup**

- Presenter su uno slot `studio`, TV in regia alla distanza di visione.

**Azione**

- Con un righello sul TV misura l'altezza delle cifre principali.
- Osserva il presenter da **4 m**.

**Risultato atteso**

- Le cifre principali occupano **almeno il 20 % dell'altezza dello schermo** (circa **8 cm** su un
  32" 16:9).
- Da 4 m si leggono a colpo d'occhio il blocco, il prossimo elemento e la fine programma.

### 15.3 Colori

**Setup**

- Live in corso con un blocco in onda; dock aperto.

**Azione**

- Portati a **1:00** dalla fine del blocco (dalla dock puoi usare `+0:30` per arrivarci più in fretta).
- Lascia scadere il conto e supera lo zero.
- Manda un **break** e osserva gli ultimi 10 s prima del rientro; poi lascia finire il tappo senza
  rientrare.

**Risultato atteso**

- Da **1:00** il conto diventa **ambra**.
- Oltre lo zero conta in **rosso**, in avanti (`+0:01` …).
- Negli ultimi **10 s** prima del rientro da break lo schermo diventa **verde a tutto campo**; se il
  tappo finisce senza rientrare, torna **rosso** con `+0:00` e riprende a contare.

### 15.4 Titoli lunghi

**Setup**

- Un format con un nome di blocco da **120 caratteri** e un titolo media da **200 caratteri**.

**Azione**

- Manda in onda quel blocco e quel media.

**Risultato atteso**

- Sul TV nulla **esce** dai riquadri (testo troncato o ridotto, senza sbordare).
- Il dock, alla larghezza di **300 px**, **non** scorre in orizzontale.

### 15.5 Offline

**Setup**

- Le tre pagine aperte; DevTools → Network aperto.

**Azione**

- Scollega la rete.

**Risultato atteso**

- Tutte e tre le pagine si caricano correttamente, **font inclusi** (nessuna risorsa esterna).
- In DevTools → Network le uniche richieste sono verso **`127.0.0.1`**.

### 15.6 Riconnessione

**Setup**

- Live in corso, presenter e dock in onda.

**Azione**

1. Ferma il server a metà spettacolo.
2. Riavvialo.
3. Riavvia il server **dieci volte** in rapida successione.

**Risultato atteso**

- Alla caduta, entro **3 s** compare `RICONNESSIONE…`; i conti si **fermano e si attenuano**; dopo
  **10 s** mostrano `—`.
- Al riavvio le schermate si **riprendono da sole** con i valori corretti.
- I dieci riavvii ravvicinati **non** producono una tempesta di riconnessioni: al massimo una
  connessione per client per ogni passo del backoff.

### 15.7 OBS perso

**Setup**

- Live in corso con OBS connesso.

**Azione**

1. Chiudi OBS.
2. Riapri OBS.

**Risultato atteso**

- Alla chiusura, sul presenter compaiono `⚠ OBS NON CONNESSO` e l'etichetta `STIMATO`; nel dock
  compare un **avviso**.
- Alla riapertura tutto torna normale (valori misurati).

### 15.8 Kiosk

**Setup**

- Presenter in modalità kiosk sul TV.

**Azione**

- Muovi il mouse sul TV.
- Lascia la pagina aperta **15 minuti** senza interagire.

**Risultato atteso**

- Il puntatore **non** è visibile sul presenter.
- Il TV **non** va in standby né si attenua (Wake Lock attivo).

### 15.9 Dock in OBS 30 (CEF 103)

**Setup**

- Dock caricato nel Custom Browser Dock di OBS 30.

**Azione**

- Verifica che la pagina funzioni e che la sezione **Emergenza** sia chiusa all'apertura.
- Premi **NEXT**; poi invia un messaggio e infine premi **CLEAR**.

**Risultato atteso**

- La pagina funziona nel CEF di OBS.
- La sezione **Emergenza** è **chiusa per impostazione predefinita**.
- **NEXT** richiede **doppio click** o **pressione prolungata**.
- Un messaggio inviato dalla dock compare sul presenter entro **500 ms** (AC9) e sparisce dopo il suo
  timeout.
- **CLEAR** lo rimuove.

### 15.10 Decisioni

**Setup**

- Live in corso.

**Azione**

- Ferma e riavvia la REC.
- Cambia la scelta della decisione mostrata.

**Risultato atteso**

- Nel dock compare la decisione con il **default già premuto**.
- Cambiando scelta, la scelta si riflette nella **vista di regia**.

### 15.11 Vista di regia

**Setup**

- Live in corso; `/control` aperta.

**Azione**

- Osserva il rundown durante la live.
- Guarda il feed degli eventi.
- Prova a **caricare un'altra puntata** mentre lo spettacolo è in onda.

**Risultato atteso**

- Il rundown mostra i tempi **pianificati** e **reali**; le righe di studio hanno durata `—`; con OBS
  chiuso le durate stimate portano l'etichetta `STIMATO`.
- Il feed elenca gli **eventi della sessione**.
- Il caricamento di un'altra puntata durante la live è **rifiutato** con il messaggio esplicito.

### 15.12 Lingua

**Setup**

- Le tre pagine aperte.

**Azione**

- Aggiungi `?lang=en` all'URL di ciascuna pagina.

**Risultato atteso**

- Tutte e tre le pagine passano all'inglese.

---

## Editor (controlli manuali)

Questa sezione verifica l'editor (`/editor`, Piano 5) con OBS reale. Vale la stessa forma:
**Setup**, **Azione**, **Risultato atteso**. Due comandi ricorrenti:

```bash
pnpm dev                                            # Vite su http://localhost:5173, editor su /editor
pnpm build                                          # poi il server serve http://127.0.0.1:4460/editor
```

Il campo `data-state` di `[data-testid="save-state"]` dice lo stato del salvataggio: `clean`, `dirty`,
`saving`, `error`, `invalid`, `locked`.

### E1 — Layout e nomi lunghi

**Setup**

- `/editor` con un format aperto e almeno tre blocchi, di cui uno con un nome di **120 caratteri**.
- DevTools → Console aperta (`window.innerWidth`).

**Azione**

- Imposta la finestra a **1366×768**, poi a **1920×1080**.
- Cerca lo scorrimento orizzontale della **pagina** (non della timeline): `document.documentElement.scrollWidth` deve restare ≤ `window.innerWidth`.
- Guarda il blocco dal nome lungo dentro la timeline e il titolo del documento in alto.

**Risultato atteso**

- Le cinque regioni (libreria, timeline, proprietà, impostazioni, verifica) restano leggibili a entrambe le risoluzioni.
- La **pagina** non scorre in orizzontale; scorre soltanto la traccia della timeline (`.tl-scroll`).
- Il nome da 120 caratteri è **troncato con i puntini** (`…`) e non sborda dal blocco; il titolo del documento è troncato allo stesso modo.

### E2 — Trascinamento con mouse e touch

**Setup**

- Almeno tre blocchi; `/editor` aperta.

**Azione**

1. Con il **mouse**, tieni premuto su un blocco e trascinalo a destra di un altro, senza lasciare.
2. Con un **dito**, su uno schermo touch (o con l'emulazione touch di DevTools), ripeti lo stesso gesto.
3. A metà di un trascinamento, premi **Esc**; poi rilascia.

**Risultato atteso**

- Dopo i primi 4 px di movimento compare la **barra di rilascio** (`[data-testid="drop-marker"]`) nel punto in cui il blocco atterrerà.
- Al rilascio il blocco è nell'ordine indicato dalla barra (mouse e touch si comportano allo stesso modo).
- **Esc** annulla: la barra sparisce e, al rilascio, il blocco resta dov'era.

### E3 — Ridimensionamento e annullamento

**Setup**

- Un blocco selezionato; zoom tale che il blocco sia largo a sufficienza.

**Azione**

1. Trascina la **maniglia destra** del blocco di una quantità qualsiasi.
2. Premi **Ctrl+Z** una sola volta.

**Risultato atteso**

- La durata del blocco durante il trascinamento è **multipla di 5 s** (la durata non è mai sotto il minimo).
- **Un** Ctrl+Z riporta la durata a quella di partenza: l'intero trascinamento è **un solo passo** di undo.

### E4 — Solo tastiera

**Setup**

- Tre blocchi; nessun campo di testo a fuoco.

**Azione**

1. Porta il fuoco su un blocco con **Tab** e seleziona con le **frecce**.
2. Spostalo con **Alt+frecce**, cambia la durata con **Maiusc+frecce** (±5 s) e con **Ctrl+Maiusc+frecce** (±1 min).
3. Duplicalo con **Ctrl+D**, eliminalo con **Canc**.
4. Annulla con **Ctrl+Z** e ripristina con **Ctrl+Shift+Z** (o **Ctrl+Y**).

**Risultato atteso**

- Frecce = selezione del blocco vicino; Alt+frecce = spostamento; Maiusc+frecce = durata ±5 s; Ctrl+Maiusc+frecce = ±1 min.
- `Ctrl+D` duplica, `Canc` elimina; l'annullamento e il ripristino agiscono sulla modifica giusta (i pulsanti **Annulla**/**Ripristina** mostrano l'operazione nel `title`).
- L'aiuto in fondo alla timeline (`timeline.keysHelp`) elenca la stessa mappa. Se **Alt+frecce** non fa nulla, il browser l'ha intercettato: usa i pulsanti della toolbar (vedi i residui nel `BACKLOG`).

### E5 — Salvataggio automatico offline

**Setup**

- `/editor` con un documento aperto; indicatore di salvataggio su **"Salvato"**.

**Azione**

1. Ferma il server (Ctrl+C, o chiudi `[server]`).
2. Modifica un nome.
3. Aspetta qualche secondo, poi **riavvia il server**.
4. Con l'indicatore ancora rosso, prova a **chiudere la scheda**.

**Risultato atteso**

- Dopo qualche secondo l'indicatore diventa **rosso** con `data-state="error"` e dice cosa è fallito: **"SALVATAGGIO NON RIUSCITO (network): nuovo tentativo in corso"** e il pulsante **"Riprova ora"**.
- Al riavvio del server l'indicatore torna **"Salvato"** (`clean`) da solo (backoff) o con **"Riprova ora"**.
- Il file su disco è **uguale a ciò che è a schermo**: apri `episodes/<id>.json` o `formats/<id>.json` nella cartella dati e confronta il nome modificato.
- Tentando di chiudere la scheda mentre è rosso, il browser mostra la **conferma di uscita**.

### E6 — Due schede

**Setup**

- Lo stesso documento aperto in due schede, **A** e **B**, entrambe su **"Salvato"**.

**Azione**

1. In **A** cambia il nome del documento e attendi che salvi.
2. Porta il fuoco su **B** (clicca dentro).
3. In **B**, modifica un nome **senza** lasciar finire il salvataggio; poi in **A** cambia un altro nome e attendi; infine torna su **B**.

**Risultato atteso**

- Caso pulito: **B** si aggiorna **da sola** con il contenuto di A e compare per 4 s il messaggio **"Aggiornato da un'altra sessione"** (`[role="status"]`, classe `ed-toast`).
- Caso sporco: in **B** compare la **banner di conflitto** **"Questo documento è stato modificato altrove."** con i due pulsanti **"Usa la versione del server"** e **"Mantieni la mia"**.
- "Usa la versione del server" adotta il contenuto di A; "Mantieni la mia" tiene quello di B e lo riscrive.

### E7 — Import dalla Playlist Deck vera (≥ 1.4.0)

**Setup**

- OBS 30.x con **Playlist Deck ≥ 1.4.0** connesso e una playlist con almeno due servizi; una puntata aperta, con almeno un blocco **studio**.
- Pannello **Importa servizi** visibile.

**Azione**

1. Premi **"Leggi playlist"** e importa in coda al blocco.
2. Importa di nuovo gli stessi servizi.
3. Premi **Ctrl+Z** una volta.

**Risultato atteso**

- I servizi compaiono con l'etichetta di origine **`DECK`** e la loro **durata**.
- Un servizio senza durata nota mostra **`—`** e l'avviso **"Durata ignota: da inserire a mano"**.
- Il secondo import non aggiunge nulla: **"Nessun servizio nuovo: tutti già presenti"** (e il riepilogo **"Aggiunti n · già presenti n · senza durata n"**).
- **Un** Ctrl+Z rimuove **tutto** l'import.

### E8 — Import delle tre esportazioni reali (JSON, CSV, M3U)

**Setup**

- Dalla Playlist Deck esporta le stesse voci in **JSON**, **CSV** e **M3U**, una volta con percorsi **assoluti** e una con l'opzione **"portable"** (percorsi **relativi**).

**Azione**

1. Importa i tre file assoluti, uno per volta, in una puntata con un blocco studio.
2. Importa i tre file "portable".
3. Osserva le etichette di origine accanto a ciascun servizio.

**Risultato atteso**

- Da JSON e CSV l'origine è **`FILE`**; dall'M3U (secondi interi nel `#EXTINF`) è **`FILE (s)`**, cioè durata arrotondata al secondo.
- Nei file "portable" compare per ogni voce l'avviso **"percorso relativo: potrebbe non corrispondere alla playlist"**.
- I formati riconosciuti sono esattamente i tre dell'esportatore: JSON (`duration` in ms, `-1` = ignota), CSV (`title,path,duration_ms`) e M3U (`#EXTM3U` + `#EXTINF`). **Questo è il controllo che conferma i formati letti dal sorgente dell'esportatore.**

### E9 — Check OBS

**Setup**

- Episodio con scene e sorgenti che esistono in OBS; pannello **Verifica** aperto.

**Azione**

1. Rinomina in OBS una **scena** usata da un blocco; esegui **Check OBS**.
2. Rimuovi il **plugin Playlist Deck** (o usa una versione < 1.4.0); esegui di nuovo.
3. **Chiudi OBS**; esegui di nuovo.
4. Con almeno un errore nel Check, premi **una** volta **"Carica per la live"**, poi premi di nuovo.

**Risultato atteso**

- Scena rinominata: l'elenco mostra l'issue **`scene_missing`** "Scena assente in OBS" (e `media_input_missing` per una sorgente assente). Playlist Deck assente: **`deck_absent`** "Playlist Deck non installato" (con versione vecchia, `deck_legacy`). OBS chiuso: **`obs_not_connected`** "OBS non connesso".
- Le issue sono divise in **ERRORE** e **AVVISO**, raggruppate per blocco, e cliccandole il blocco va a fuoco nella timeline.
- È sempre presente la frase di cautela: **"Il Check OBS non può verificare tutto (per esempio le sorgenti media se OBS non risponde): nessuna segnalazione non è una garanzia."**
- Il primo clic mostra **"Il Check OBS ha trovato errori: premi di nuovo per caricare lo stesso"**; il **secondo** clic carica.

### E10 — Carica per la live

**Setup**

- Una puntata con un **errore** di validazione (per esempio un gruppo di scene inesistente) e una **senza errori ma con avvisi** (per esempio un media senza durata).

**Azione**

1. Sulla puntata con errore, premi **"Carica per la live"**.
2. Correggi l'errore e carica; oppure carica la puntata con soli avvisi.
3. Apri `/dock`, `/control` e `/presenter`.

**Risultato atteso**

- Con l'errore il caricamento è **bloccato**: **"Correggi gli errori prima di caricare"** (o il rifiuto del server `rundown_invalid`).
- Gli **avvisi non bloccano**: il caricamento riesce e compare **"Puntata caricata per la live"**.
- Dopo il caricamento, `/dock`, `/control` e `/presenter` mostrano quella puntata.

### E11 — Blocco della puntata in onda

**Setup**

- Un editor con la puntata aperta, ma **non** ancora in onda.

**Azione**

1. Avvia il programma (`START PROGRAM` da OBS, o `POST /api/live/command`).
2. Apri la stessa puntata nell'editor; aspetta fino a **3 s**.
3. Prova a modificare un nome.

**Risultato atteso**

- Compare la banner **"Puntata IN ONDA: sola lettura"**; la timeline mostra **"Sola lettura"** e ogni controllo (toolbar, proprietà, trascinamento, tastiera) è **disabilitato**.
- Una scheda dell'editor **aperta prima** dell'avvio si blocca **entro 3 s** da sola (il polling di `GET /api/live/status` è ogni 3 s).
- Il server rifiuta comunque la scrittura con **`409 episode_live`** e l'indicatore mostra **"Bloccato: puntata in onda"**.

### E12 — Lingue e browser del dock

**Setup**

- `/editor` aperta; un Custom Browser Dock di OBS puntato a `http://127.0.0.1:4460/editor`.

**Azione**

1. Guarda ogni pannello: libreria, timeline, proprietà, import, impostazioni, verifica.
2. Aggiungi **`?lang=en`** all'URL.
3. Apri `/editor` nel **dock di OBS** (CEF) e prova a fare qualche operazione.

**Risultato atteso**

- In italiano tutti i testi sono in italiano; con `?lang=en` **tutti** i pannelli passano all'inglese.
- Nel CEF del dock la pagina **si apre e funziona** senza errori in console: l'editor non è pensato per il dock (300 px), ma non deve rompersi.
