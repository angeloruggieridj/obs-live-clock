# OBS Live Clock — Backlog tecnico

Punti noti e rimandati, emersi dalle revisioni. Ogni voce indica dove intervenire e quando.

## Motore live (da rivedere nel Piano 2, con test su OBS reale)

- **Disconnessione che inizia durante un servizio fuori ordine.**
  - Dove: `server/src/engine/reducer.ts`, nel ciclo di stima quando OBS è perso.
  - Il problema: il ciclo marca come provvisori anche lo slot di ritorno e gli slot già osservati, e lo slot di studio interrotto può restare `onair`.
  - Effetto: sul monitor compare "STIMATO" fino al successivo servizio o break.
  - Correzione proposta: partire da `position(s)` invece che da `s.cursor`.
- **Uno slot provvisorio rimosso dalla playlist conserva il flag `provisional`.**
  - Dove: `reducer.ts`, funzione `reconcileDropped`.
  - Sequenza rara; si riprende insieme alla voce precedente.
- **`Prev` può tornare su uno slot rimosso dalla playlist.** È una correzione esplicita dell'operatore, quindi il caso è minore.
- **La pausa della REC nel live-to-tape congela anche il conto alla rovescia di un servizio in onda**, che invece sta andando davvero (`snapshot.ts`).
- **Tick durante una pausa della REC con OBS perso:** il passaggio di blocco usa la fine del blocco non spostata dalla pausa.
- **Eventi identici a quelli precedenti restituiscono comunque `changed = true`**, per esempio `ProgramSceneChanged` uguale al precedente o `ResolveDecision` ripetuta. La deduplica degli invii va fatta nel WebSocket hub (Piano 2).

## Modello condiviso

- `shared/src/model/format.ts` usa l'alias deprecato `z.string().datetime({ offset: true })`: sostituire con `z.iso.datetime({ offset: true })` al prossimo intervento.
- `validateRundown`: se un id compare 3 o più volte, genera più issue `duplicate_id`. Deduplicarle nell'editor (Piano 4).

## Note per il client (Piano 3)

- `PresenterView.block` resta valorizzato anche durante i segmenti media e break. Il client deve mostrarlo solo quando `segment === 'studio'`.

## Decisioni di prodotto da confermare

- **±tempo su un blocco:** oggi viene recuperato sul blocco elastico successivo, quindi non sposta la fine del programma (`plannedStartAt` ignora `adjustMs`).
- **Blocchi di studio consecutivi sulle stesse camere:** il passaggio dall'uno all'altro avviene a tempo, e il blocco appena iniziato è marcato "planned". Uno sforamento voluto nel primo blocco si vede quindi come accorciamento del successivo.
