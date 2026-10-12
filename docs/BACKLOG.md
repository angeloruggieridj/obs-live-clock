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

**Chiusi in questo piano**

- **Id solo minuscoli.** ✅ L'editor genera slug minuscoli e senza nomi riservati di Windows (`web/src/editor/model/ids.ts`).
- **Puntate con errori di validazione.** ✅ `POST /api/live/load` risponde `409 rundown_invalid` e rifiuta la puntata; anche l'editor blocca il caricamento finché ci sono errori.

**Restano**

- **`list()` non verifica che il nome del file corrisponda a `doc.id`.** Se si copia un file a mano, l'id compare due volte nell'elenco.
- **`validateRundown`: deduplica di `duplicate_id`.** Se un id compare 3 o più volte, il server genera più issue `duplicate_id`: la deduplica resta **lato server** (l'editor deduplica già nella UI, `validation/issues.ts`).
- **Errori 400 in `server/src/api/http.ts`.** Il corpo include le `issues` di zod. L'editor **non** le usa (prende gli errori da `validateRundown`): restano utili ad altri client. Test mancanti: percorsi 500 e messaggi senza puntata.

**Residui del Piano 5**

- **Nessun ETag lato server.** I conflitti si rilevano **solo lato client** (rilettura su focus e ogni 10 s). L'unico blocco duro lato server è il `409 episode_live`.
- **La rinomina non cambia mai gli id.** Un documento rinominato conserva lo slug originale; il file su disco resta `<vecchio-id>.json`.
- **La duplicazione di un blocco perde i media.** `duplicateBlock` copia solo gli elementi `studio`: i servizi importati non vengono duplicati.
- **Smoke Playwright dell'editor non in CI.** Il Task 16 non è stato eseguito: l'editor non ha test end-to-end.
- **Il trascinamento touch non è coperto dai test automatici.** jsdom non ha layout reale: il percorso pointer/touch è verificato solo a mano (E2).
- **`Alt+frecce` può essere intercettato da alcuni browser.** Il default è prevenuto (`preventDefault`), ma dove non basta usare le alternative (Maiusc/Ctrl+freccia) o i pulsanti della toolbar.
- **Gli errori del Check OBS non bloccano il caricamento.** Basta il secondo clic su "Carica per la live": decisione di prodotto da confermare.

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

## Residui del Piano 4 (accettati, minori)

**Client web e server**

- `pushViews` in `server/src/api/ws.ts` registra `lastView`/`lastRev` prima che l'invio riesca. Una riconnessione azzera entrambi.
- Nel client, il campo `problem` dello snapshot non viene mai azzerato e nessuna UI lo mostra.
- Il ciclo di aggiornamento dei contatori scrive un `console.error` fino a 60 volte al secondo se un abbonato continua a lanciare.
- Manca un test con StrictMode.
- L'isteresi su un contatore in pausa può differire fino a 250 ms tra due schermi.
- I file del modello `mainAnchor` e `showSide` non hanno un controllo di esaustività.
- `defaultWebRoot` dipende dalla struttura dei sorgenti: un server impacchettato richiede `OLC_WEB_ROOT` (Piano 7).

**Dock**

- Il polling dello stato OBS non ha abort e sfarfalla a un singolo errore.
- Il messaggio libero può duplicarsi dopo un `ack` perso.
- Il tally del dock non ha lo stato "imminente".

**Test di integrazione**

- Il controllo negativo sul presenter al passo 4 può passare senza provare nulla.
- L'attesa dello stato non aggiornato al passo 8 consente 6 s, mentre il brief ne prevede circa 2,3.
- Il timeout dei test è stato portato a 15 s (era 5 s) perché quattro esecuzioni in parallelo mandavano in timeout tre test del server. Da riconsiderare se la CI diventa lenta.

**Verifiche visive non ancora fatte**

- Il Task 16 (Playwright) è stato saltato per scelta. Va eseguito prima del primo test su una TV vera.
- I controlli su TV e AC10 (cifre del contatore ≥ 20% dell'altezza) non sono stati fatti in un browser reale. Le misure del piano sono state prese su schermate a 1080p e 4:3.

## Residui del Piano 5 (accettati, minori)

**Editor e sessione**

- Se una `PUT` arriva al server ma la risposta si perde, il nuovo tentativo può rilevare un falso conflitto. Si risolve con "tieni la mia" o "prendi la loro". Rimedio economico: considerare nessun conflitto una copia remota uguale a quella locale.
- Con evento `playlist-changed` attivo (plugin ≥ 1.4.0), la consegna della playlist dopo il caricamento di una puntata si appoggia a `resync()` al caricamento. Il test dell'adapter copre solo la modalità a polling. Va verificato con OBS reale che `ObsService` chiami `resync()` al caricamento.
- `seal()` a ogni avvio di salvataggio divide in due passi di annullamento una raffica continua più lunga di `maxWait` (circa 1,5 s).
- Durante un conflitto in sospeso lo stato mostra `saving`. Il banner nella shell dipende da `snapshot.conflict`.
- Non sono testati: il rifiuto di "carica per la live" con un conflitto in sospeso e `open()` nello stesso caso.
- `Autosave.flush()` in stato di errore non riattiva il timer di backoff. Oggi la sessione protegge i punti di chiamata.

**Parser delle playlist**

- Una virgoletta non chiusa nel CSV inghiotte il resto del file.
- Un `#extinf` in minuscolo viene ignorato.
- Il chiamante deve limitare la dimensione del file.

**Verifiche non ancora fatte**

- Nessun controllo visivo in un browser reale: il CSS dell'editor è collegato in `main.tsx` ma non è mai stato guardato. L'interfaccia è coperta solo dai test jsdom e dal test di integrazione sul server.
- Il Task 18 (Playwright) è rimandato, come per il Piano 4.
