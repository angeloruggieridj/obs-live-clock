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

## 1. Prerequisiti

**Setup**

- OBS Studio ≥ 30 con **obs-websocket** attivo e protetto da password (Strumenti → Server WebSocket).
- Il plugin **OBS Playlist Deck** ≥ 1.4.0 installato in OBS.
- Una scena `PLAYOUT` con una **Media Source** (`Deck Media`) a cui Playlist Deck è agganciato.
- Le scene `CAM 1`, `CAM 2`, `CAM 3` e una scena `BREAK` con una Media Source `Tappo`.
- Node.js 24 e pnpm installati; `pnpm install` eseguito nella radice del repository.

**Azione**

- Prendi nota della porta di obs-websocket (impostazione predefinita `4455`) e della password.

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

   Il server ascolta su `http://127.0.0.1:4460`.

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

- Server connesso, episodio caricato, vista presentatore aperta su `/presenter`.
- OBS in onda su `CAM 1`.

**Azione**

- Avvia la registrazione in OBS (REC).

**Risultato atteso**

- La vista presentatore passa alla fase **live** (`phase: "live"`).

---

## 5. I cambi camera non avanzano il blocco

**Setup**

- Live avviata (passo 4), blocco in corso.

**Azione**

- Passa il Program da `CAM 1` a `CAM 2`, poi a `CAM 3`, poi di nuovo a `CAM 1`.

**Risultato atteso**

- Il blocco corrente **non** avanza: il cursore e il conto alla rovescia restano gli stessi.
- Solo i media del deck fanno scattare il segmento media (passo 6).

---

## 6. Servizio da Playlist Deck → segmento media con countdown misurato

**Setup**

- Live avviata, playlist di Playlist Deck popolata con almeno un servizio.

**Azione**

- Manda in Program la scena `PLAYOUT` e fai partire un elemento della playlist dal deck.

**Risultato atteso**

- Il segmento presentatore diventa **media** (`segment: "media"`).
- Il countdown è **misurato** (`source: "measured"`), cioè basato sulla riproduzione reale del deck.

---

## 7. Cutaway breve durante un servizio → il RIENTRO è conservato

**Setup**

- Un servizio media in corso (passo 6).

**Azione**

- Fai un cutaway breve su una camera e poi torna su `PLAYOUT`.

**Risultato atteso**

- Il conteggio del **RIENTRO** resta quello pianificato: il cutaway non ricalcola né azzera il rientro.

---

## 8. BREAK con il tappo → countdown RIENTRO, poi conto positivo rosso

**Setup**

- Live avviata; scena `BREAK` con la Media Source `Tappo` disponibile.

**Azione**

- Manda in Program la scena `BREAK` e avvia il `Tappo`.

**Risultato atteso**

- La vista mostra il countdown del **RIENTRO** mentre il `Tappo` va.
- Quando il `Tappo` finisce ma non si è ancora rientrati, il contatore passa in **positivo** e in
  **rosso** (sforamento).

---

## 9. Chiusura di OBS durante la live → STIMATO entro 2 s, poi riallineamento

**Setup**

- Live avviata con un servizio o un break in corso.

**Azione**

1. Chiudi OBS (o scollega la rete verso obs-websocket).
2. Riattiva OBS.

**Risultato atteso**

- Entro **2 s** i valori passano a **STIMATO** (`source: "estimated"`) e il conteggio continua
  basandosi sui tempi pianificati.
- Alla riaccensione, dopo la riconnessione automatica, i valori tornano **misurati** e i tempi si
  riallineano.

---

## 10. Password errata → `auth_failed`, nessuna tempesta di retry

**Setup**

- Server avviato; OBS con una password diversa da quella che stai per inviare.

**Azione**

- Invia credenziali con `password` sbagliata (stesso comando del passo 2, con una password errata).

**Risultato atteso**

- In `GET /api/obs/status` il campo `connection` diventa `auth_failed`.
- Il server **non** riprova in modo aggressivo: non apre connessioni ripetute a raffica. Per
  correggere, invia di nuovo le credenziali giuste e la connessione passa a `connected`.

---

## 11. Rimozione di un servizio dalla playlist → sparisce da NEXT

**Setup**

- Live avviata, vista presentatore aperta, almeno due servizi in playlist.

**Azione**

- Rimuovi un servizio dalla playlist di Playlist Deck.

**Risultato atteso**

- Con Playlist Deck ≥ 1.4.0 l'evento arriva subito (con un breve debounce).
- Con Playlist Deck < 1.4.0 il server se ne accorge al giro di polling successivo (entro ~2 s).
- Il servizio rimosso **non** compare più in **NEXT**.

---

## 12. Plugin più vecchio di 1.4.0 → avviso `deck_legacy` e polling funzionante

**Setup**

- Playlist Deck installato con versione < 1.4.0; episodio con almeno un elemento media di studio.

**Azione**

- Esegui il Check OBS del passo 3.

**Risultato atteso**

- Fra gli `issues` compare un **warning** `deck_legacy`
  (`"The Playlist Deck plugin is older than 1.4.0"`).
- La lista elementi (`GET /api/deck/items`) e i relativi controlli funzionano comunque: il plugin
  legacy viene **interrogato a intervalli** (~2 s), perché non emette eventi.
- Con un plugin legacy **non** arrivano eventi di riproduzione: il matching sul singolo media
  in riproduzione non è disponibile; restano solo la lista elementi e il polling.

---

## 13. Riavvio del server durante la live → riprende STIMATO, poi si riallinea

**Setup**

- Live in corso con OBS connesso.

**Azione**

1. Ferma il server (`Ctrl+C`).
2. Riavvialo (`pnpm --filter @olc/server dev`) e reinvia le credenziali (passo 2).

**Risultato atteso**

- Al riavvio il runtime riprende dallo snapshot con lo stato in **STIMATO**.
- Quando l'adapter si riconnette, lo stato torna **misurato** e i tempi si riallineano.

---

## 14. Dimensione del journal dopo 10 minuti di riproduzione

**Setup**

- Server avviato, live in corso per circa 10 minuti con attività normale (cambi scena, servizi, break).

**Azione**

- Ispeziona il journal dell'episodio in `%APPDATA%\obs-live-clock\live\<ID_EPISODIO>.log.jsonl`.

**Risultato atteso**

- Il file contiene **poche centinaia di righe**, non migliaia: gli eventi sono coalescenti e gli
  aggiornamenti di playback ad alta frequenza non producono una riga per ogni tick.

---

## Riferimenti rapidi (stato attuale del codice)

| Cosa | Dove | Note |
| --- | --- | --- |
| Consegna credenziali | `POST /api/internal/obs-credentials` | Solo loopback, `Authorization: Bearer <secret.token>`, corpo `{host, port, password}`; `204` in caso di successo; password mai in risposta/log. |
| Stato OBS | `GET /api/obs/status` | `{connection, obsWebSocketVersion, programScene, deck}`; `connection` ∈ `idle`, `connecting`, `connected`, `auth_failed`, `disconnected`. |
| Scene OBS | `GET /api/obs/scenes` | `{scenes}` oppure `409 {"error":"obs_not_connected"}`. |
| Elementi del deck | `GET /api/deck/items` | `{items:[...occurrence]}`; `409 obs_not_connected`, `404 deck_absent`, `409 deck_not_ready` (plugin presente ma prima lettura non ancora completata). |
| Check OBS | `POST /api/obs/check` | Corpo `{episodeId}`; `400 invalid_body`, `404 not_found`; risposta con `connected`, `deck` e `issues[]`. |
| Codici issue | — | `obs_not_connected`, `scene_missing`, `media_input_missing`, `deck_absent`, `deck_legacy`, `deck_item_missing`, `deck_duration_unknown`. |
| Simulatore OBS | `pnpm --filter @olc/obs-sim start -- --host <host> --port <porta>` | `--host` predefinito `127.0.0.1`, `--port` predefinito `4455`; comandi da stdin: `program`, `rec`, `stream`, `play`, `media`, `drop`. |
| Playlist Deck legacy (< 1.4.0) | — | Solo polling degli elementi (~2 s); nessun evento di riproduzione e nessun matching del media in onda. |

> Non inserire mai password reali in questo documento né in file versionati.
