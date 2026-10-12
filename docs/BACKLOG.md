# OBS Live Clock — Backlog tecnico

Punti noti e rimandati, emersi dalle revisioni. Per ogni voce: dove intervenire e in quale piano.

## Piano 3 — integrazione OBS (con test su OBS reale)

**Motore live**

- **Slot provvisorio rimosso dalla playlist.** Conserva il flag `provisional` (`reconcileDropped`).
- **Stacco breve durante un servizio** con OBS reale: verificare la ripresa del clip.
- **Pausa della REC nel live-to-tape.** Congela anche il conto alla rovescia di un servizio che in realtà sta andando (`snapshot.ts`).
- **Tick durante la pausa della REC con OBS perso.** Usa la fine del blocco non ancora spostata dalla pausa.

**Persistenza**

- **Retry su Windows** per `rename` in caso di `EPERM`/`EBUSY`/`EACCES`, nello stile di graceful-fs.
- **Snapshot con `cursor` fuori range** e validazione completa di `LiveState` alla ripresa (schema zod). Oggi c'è solo la proiezione di prova.

**Sicurezza (DT-5)**

- **Scrittura atomica del token segreto.**

**Residui (revisione di fine Piano 3)**

- **`compareVersions` con parti non numeriche.** La funzione confronta solo le parti numeriche: decidere come trattare suffissi tipo `1.4.0-beta` (`server/src/obs/version.ts`).
- **Polling legacy: `DeckPlayback` deduplicato da `GetStatus`.** In modalità legacy il poll potrebbe riportare lo stato di riproduzione deduplicato, non solo gli item (`deck-adapter.ts`).
- **Re-read sovrapposti.** Due reload debounced possono sovrapporsi: serve un contatore di generazione per scartare il più vecchio (`obs-adapter.ts`, `deck-adapter.ts`).
- **`fetchItems` tronca quando manca `count`.** Se il vendor non riporta `count`, la lettura si ferma alla prima pagina.
- **`GetStatus` con `ok:false`.** Oggi non viene gestito: un `ok:false` va trattato come vendor non disponibile o errore.
- **Eventi persi durante la sincronizzazione iniziale.** I listener vengono agganciati dopo il sync: agganciarli prima e bufferizzare gli eventi.
- **Dispatch della deck prima di `SourceRestored`.** Alla riconnessione la deck può dispatchare prima che il runtime sappia che OBS è tornato.
- **Capability della deck letta come `absent` prima che `GetStatus` risponda.** Aggiungere uno stato `unknown` invece di assumere l'assenza.
- **Log solo dei cambi di stato del loop di retry** (`connection.ts`).
- **`icacls`:** usare un percorso assoluto, `USERDOMAIN\USERNAME` e un timeout.
- **Fedeltà del simulatore:** `Reidentify`, `RequestBatch`, `eventSubscriptions`, `rpcVersion` (`tools/obs-sim`).
- **`media_input_unverified` in Check OBS.** Quando `GetInputList` fallisce, segnalare che i media input non sono stati verificati invece di saltarli in silenzio (`api/obs.ts`).
- **Validazione host per IPv6.** L'allowlist confronta gli hostname: verificare il caso degli indirizzi IPv6.
- **Slot di stacco chiuso a fine blocco stimata.** Rifinire la chiusura dello slot quando la fine del blocco è solo stimata (`engine/reducer.ts`).
- **Skew dello snapshot sotto dispatch continuo.** L'accorpamento dei salvataggi può far divergere lo snapshot dallo stato più recente.

## Piano 4 — residui

Il Piano 4 ha chiuso backpressure, peer half-open, la guardia su `block`, le righe di studio `—`, la
logica degli `ack` e le guardie in `server/src/api/ws.ts`. Restano:

- **Tempi previsti per riga** nella vista estesa (SPEC §8 "previsti"): oggi mostra solo pianificato e reale.
- **Feed eventi dal journal del server** invece che dalla sessione del client (serve un endpoint di lettura del journal).
- **`PresenterView.delay` dopo FINE.** Continua a crescere nel motore; il client lo nasconde. Valutare di congelarlo nella proiezione.
- **Numerazione "BLOCCO n".** Conta anche i break (il secondo blocco di studio è "BLOCCO 3"): decisione di prodotto da confermare.
- **Fuso orario degli orari a parete.** Il client usa quello del browser: un tablet in LAN con fuso diverso mostrerebbe orari diversi.
- **`?screen=`.** Oggi è solo un'etichetta nel titolo; il Piano 6 ne definisce l'uso con il kiosk.
- **Etichette hotkey nel dock** ("F1 · STRINGI", DT-9). Oggi mostra solo il numero di slot; il tasto reale arriva dal plugin (Piano 6).
- **Percorso della web app dopo il bundle** (Piano 7): `OLC_WEB_ROOT` / `ServerOptions.webRoot`.
- **Licenza OFL del font Inter** da includere nei crediti e nell'installer (Piano 7).
- **Test Playwright in CI.** Il Task 16 non è stato eseguito, quindi oggi non esiste alcun test end-to-end in CI; da aggiungere, o da estendere se un domani lo si introduce.
- **Fuori scaletta con scena sconosciuta.** `START PROGRAM` senza OBS marca `offScript` con `scene: ''` (`engine/matcher.ts`) e il dock mostra "—" come nome della scena: valutare di non marcare il fuori scaletta quando la scena in Program non è nota.

## Piano 5 — editor

- **`list()` non verifica che il nome del file corrisponda a `doc.id`.** Se si copia un file a mano, l'id compare due volte nell'elenco.
- **`validateRundown`.** Se un id compare 3 o più volte, genera più issue `duplicate_id`: vanno deduplicate.
- **Id solo minuscoli.** L'editor deve generare slug minuscoli, senza nomi riservati di Windows.
- **Puntate con errori di validazione.** Decidere se `load` deve rifiutarle (SPEC: "errore nell'editor prima della live").
- **Errori 400 in `server/src/api/http.ts`.** Il corpo include le `issues` di zod, utili all'editor. Test mancanti: percorsi 500 e messaggi senza puntata.

## Piano 7 — packaging

- **Lock d'istanza: gare residue.** Rilevanti con l'avvio automatico al login.
  - **Tre o più avvii simultanei.** Possono risultare entrambi proprietari del lock: la `rename` di ripristino sovrascrive il lock creato da un terzo avvio, perché su Windows la `rename` sovrascrive.
  - **File di lock ancora vuoto.** Nell'istante tra `open('wx')` e la scrittura del pid, un secondo avvio vede il file vuoto e lo considera abbandonato. Rimedio: scrivere su un file temporaneo e poi creare un hard link al posto giusto.

- **Avvio con lock già acquisito.**
  - Gli errori di avvio dopo l'acquisizione del lock sono gestiti nel Piano 2.
  - Va verificata la chiusura della console su Windows (SIGHUP) e il flush dei log prima di `process.exit`.
- **`preClose` personalizzato di `@fastify/websocket`.** Non rimuove il listener `upgrade`. Valutare `this.websocketServer.close()`.

## Modello condiviso

- `shared/src/model/format.ts` usa l'alias deprecato `z.string().datetime({ offset: true })`. Va sostituito con `z.iso.datetime({ offset: true })`.

## Decisioni di prodotto da confermare

- **±tempo su un blocco.** Oggi viene recuperato sul blocco elastico successivo e non sposta la fine del programma (`plannedStartAt` ignora `adjustMs`).
- **Blocchi di studio consecutivi sulle stesse camere.** Si passa dall'uno all'altro a tempo, e il nuovo blocco è "planned". Uno sforamento voluto si vede quindi come accorciamento del blocco successivo.
- **Log della live su più sessioni della stessa puntata.** Prova del pomeriggio e diretta della sera finiscono nello stesso file. Valutare un marcatore di sessione o la rotazione del file.
