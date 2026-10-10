# OBS Live Clock — Backlog tecnico

Punti noti e rimandati, emersi dalle revisioni. Per ogni voce: dove intervenire e in quale piano.

## Piano 3 — integrazione OBS (con test su OBS reale)

**Motore live**

- **Disconnessione che inizia durante un servizio fuori ordine.**
  - *Dove:* `server/src/engine/reducer.ts`, nel ciclo di stima.
  - *Cosa succede:* il ciclo marca come provvisori anche lo slot di ritorno e gli slot già osservati, e lo slot di studio interrotto può restare `onair`. Il monitor mostra "STIMATO" fino al servizio o break successivo.
  - *Correzione proposta:* partire da `position(s)` invece che da `s.cursor`.
- **Slot provvisorio rimosso dalla playlist.** Conserva il flag `provisional` (`reconcileDropped`).
- **Stacco breve durante un servizio** con OBS reale: verificare la ripresa del clip.
- **Pausa della REC nel live-to-tape.** Congela anche il conto alla rovescia di un servizio che in realtà sta andando (`snapshot.ts`).
- **Tick durante la pausa della REC con OBS perso.** Usa la fine del blocco non ancora spostata dalla pausa.

**Persistenza**

Da sistemare prima degli eventi `DeckPlayback` a circa 1 Hz.

- **Debounce dello snapshot.** Raggruppare i salvataggi ravvicinati, come previsto da TECH-DESIGN §5.7.
- **Log JSONL.** Ogni append rilegge l'intero file. Tenere in memoria se il file termina con un ritorno a capo.
- **Retry su Windows** per `rename` in caso di `EPERM`/`EBUSY`/`EACCES`, nello stile di graceful-fs.
- **Snapshot con `cursor` fuori range** e validazione completa di `LiveState` alla ripresa (schema zod). Oggi c'è solo la proiezione di prova.

**Sicurezza (DT-5)**

- **Token segreto su Windows.** Restringere l'ACL all'utente corrente.
- **Scrittura atomica del token segreto.**
- **Endpoint credenziali interno.**

## Piano 4 — client web (monitor, dock, vista estesa)

- **WebSocket, backpressure.** Chiudere il socket quando `bufferedAmount` supera un limite.
- **WebSocket, peer morti.** Usare ping/pong per eliminare i peer half-open, per esempio un tablet che perde il Wi-Fi.
- **`PresenterView.block` durante media e break.** Resta valorizzato anche in quei segmenti, quindi il client lo mostra solo quando `segment === 'studio'`.
- **Righe di studio nella vista di regia.** Hanno `durationMs: null` (durata elastica): mostrarle come "—".
- **Logica degli `ack`.** `ack.changed === false` significa che il comando non ha avuto effetto, e la UI deve dirlo.
- **Guardie minori in `server/src/api/ws.ts`.**
  - L'invio dentro il `catch` non è protetto a sua volta.
  - Il ciclo per-client dell'heartbeat è protetto solo dal `try` esterno.
  - Il test sul `rev` dell'heartbeat dipende dai tempi.

## Piano 5 — editor

- **`list()` non verifica che il nome del file corrisponda a `doc.id`.** Se si copia un file a mano, l'id compare due volte nell'elenco.
- **`validateRundown`.** Se un id compare 3 o più volte, genera più issue `duplicate_id`: vanno deduplicate.
- **Id solo minuscoli.** L'editor deve generare slug minuscoli, senza nomi riservati di Windows.
- **Puntate con errori di validazione.** Decidere se `load` deve rifiutarle (SPEC: "errore nell'editor prima della live").
- **Errori 400 in `server/src/api/http.ts`.** Il corpo include le `issues` di zod, utili all'editor. Test mancanti: percorsi 500 e messaggi senza puntata.

## Piano 7 — packaging

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
