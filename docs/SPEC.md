# OBS Live Clock — Product Specification v1.0

Stato: **approvata** (2026-09-28).
Etichette: **[R]** requisito confermato · **[D]** decisione presa · **[I]** ipotesi da verificare · **[?]** domanda aperta · **[F]** funzione futura.

---

## 1. Vision

Un **Production & Presenter Clock** per regie basate su OBS Studio. Il conduttore vede su un monitor dedicato **quanto manca, cosa va in onda, quando rientra, cosa viene dopo e quanto manca alla fine**, senza chiedere nulla alla regia.

Il sistema **osserva** OBS e non lo comanda. Durante la live lavora **da solo**. Quando non sa qualcosa, **lo dichiara**.

## 2. Utenti

| Utente | Ruolo | Vincolo principale |
|---|---|---|
| **Regista/operatore** | Prepara format e puntate, gestisce OBS in diretta | Durante la live non ha attenzione disponibile |
| **Conduttore** | Legge il monitor | Deve capire tutto in un colpo d'occhio da alcuni metri |
| **Montatore** (indiretto) | Usa il log e i marker della puntata | Nel live-to-tape ha bisogno di timecode affidabili e legati al file giusto |

## 3. Casi d'uso

1. **Creare un format** (es. *Solo Futsal*): blocchi, durate, gruppi di scene, soglie, messaggi predefiniti.
2. **Creare una puntata** (*Solo Futsal · 12/10/2026*) dal format, importando i servizi dalla playlist di Playlist Deck.
3. **Verificare la puntata** con "Check OBS" prima della live.
4. **Andare in onda.** L'avvio di REC o streaming fa partire il programma. Il rundown avanza da solo seguendo OBS.
5. **Il conduttore segue la live:** blocco, servizio, break, rientro, sforamenti.
6. **La regia manda un messaggio**, predefinito con un tasto oppure a testo libero.
7. **La regia corregge in emergenza:** ±tempo, NEXT/PREV, MANUALE.
8. **Chiudere la puntata** e consultare il log. In v1.x anche l'export dei marker.
9. **Riprendere dopo un guasto:** riavvio dell'app, del PC o di OBS, oppure REC interrotta.

## 4. Requisiti funzionali (MVP)

**Format e puntate**
- F1 **[D]** Creazione, modifica, duplicazione ed eliminazione dei format, con salvataggio automatico.
- F2 **[D]** Puntata creata da un format. Ogni puntata è una copia indipendente.
- F3 **[D]** Editor con timeline drag & drop. Sui blocchi: crea, estendi, duplica, elimina, riordina, imposta la durata.
- F4 **[D]** Undo/redo nell'editor.
- F5 **[D]** Import dei servizi dalla playlist di Playlist Deck, dal vivo via WebSocket. In alternativa dal file JSON, CSV o M3U.
- F6 **[D]** Validazione del rundown.
  - Errori (bloccanti): i media superano la durata del blocco; scena o elemento di playlist inesistente.
  - Avvisi: studio sotto soglia; stessa scena usata da più blocchi.
- F7 **[D]** "Check OBS" prima della live: connessione, scene, sorgenti, playlist, versione del plugin.

**Motore live**
- F8 **[R]** Il programma parte al primo avvio tra REC e streaming.
- F9 **[D]** Avanzamento automatico con **cursore sequenziale**. Vince la realtà di OBS. Ciò che non viene riconosciuto è segnalato "fuori scaletta", solo in regia.
- F10 **[D]** Stato degli elementi della playlist:
  - rimosso dalla playlist = eliminato;
  - presente ma superato = rimandato;
  - riordini e aggiunte vengono seguiti.
- F11 **[D]** Ritardo e anticipo rispetto al pianificato, orario di fine previsto, recupero sul prossimo blocco elastico.
- F12 **[D]** Log della puntata: tempi pianificati e reali, salti, interruzioni, decisioni (confermate o no).

**Regia**
- F13 **[D]** Dock minimale dentro OBS: stato, ritardo, avvisi, pulsanti messaggi, sezione emergenza nascosta.
- F14 **[D]** Vista regia estesa, in una pagina separata aperta dal dock.
- F15 **[D]** Messaggi.
  - Predefiniti: lista globale più aggiunte per format.
  - Testo libero.
  - Chiusura dopo un timeout o con CLEAR, configurabile per messaggio.
  - Un nuovo messaggio sostituisce il precedente.
- F16 **[D]** Controlli di emergenza: `START PROGRAM`, `NEXT`/`PREV`, `±tempo`, `MANUALE/AUTO`. Protetti da doppio clic o pressione prolungata.
- F17 **[D]** Endpoint HTTP e hotkey per inviare i messaggi da Stream Deck. Il plugin Stream Deck dedicato arriva in v1.x.

**Conduttore**
- F18 **[D]** Monitor in stile Multiview con tutti gli stati della §12.

## 5. Requisiti non funzionali

- NF1 **[R]** **Non inventa informazioni.** Ogni valore è di uno di tre tipi, e la differenza è mostrata:
  - *misurato*, da OBS;
  - *pianificato*, dal rundown;
  - *stimato*, in fallback.
- NF2 **[D]** Funziona **completamente in locale e offline**, senza dipendenze da internet.
- NF3 **[D]** Gira sulla macchina di OBS (default) o su un'altra macchina in LAN. Di default ascolta solo su `localhost`. L'accesso da LAN va attivato esplicitamente.
- NF4 **[D]** Il server è l'**unica fonte dell'ora**. I client compensano il proprio scarto.
- NF5 **[D]** Lo stato della live è salvato su disco. La ripresa dopo un riavvio è automatica.
- NF6 **[I]** Leggibile a circa 4 m. Latenza tra evento OBS e monitor inferiore a 500 ms. Contatori fluidi grazie all'interpolazione locale.
- NF7 **[I]** Carico su OBS trascurabile: niente screenshot, interrogazioni periodiche limitate.
- NF8 **[D]** Nessun login nell'MVP.
- NF9 **[R]** Multipiattaforma: Windows, macOS e Linux.

## 6. Requisiti di integrazione con OBS

**Da OBS WebSocket v5**

| Informazione | Fonte | Disponibilità |
|---|---|---|
| Scena in Program | `CurrentProgramSceneChanged`, `GetCurrentProgramScene` | ✅ Automatica |
| Stato di REC e streaming, pausa della REC | `RecordStateChanged`, `StreamStateChanged`, `GetRecordStatus`, `GetStreamStatus` | ✅ Automatica |
| Nuovo file di registrazione (split) | `RecordFileChanged` | ✅ Automatica (OBS 30+) |
| Media standard: stato, durata, posizione | `GetMediaInputStatus` (interrogazione periodica), `MediaInputPlaybackStarted/Ended` | ⚠️ Solo per media caricati o in riproduzione. La posizione va interrogata periodicamente |
| Pausa e seek su media standard | `MediaInputActionTriggered` + interrogazione | ⚠️ Condizionata **[I]**: verificare quali azioni generano l'evento |
| Sorgente visibile nella scena in Program | `GetSceneItemList`, `SceneItemEnableStateChanged` | ✅ Serve logica aggiuntiva per le scene annidate |
| OBS in chiusura | `ExitStarted`, chiusura della connessione | ✅ Automatica |
| Capitoli nel file Hybrid MP4 | `CreateRecordChapter` | **[F]** Unica scrittura verso OBS, opzionale |

**Da Playlist Deck** (vendor `obs-playlist-deck`, versione minima **1.4.0**)

| Informazione | Fonte | Disponibilità |
|---|---|---|
| Elemento corrente, durata, posizione, play/pausa | `item-started`, `playback-state` (circa 1 Hz), `GetStatus` | ✅ Automatica |
| Prossimo elemento | `upNextIndex` / `upNextTitle` | ✅ Automatica |
| Durate di tutti gli elementi | `GetItems.durationMs` (`-1` se non nota), `GetStatus.totalDurationMs` / `unknownDurationCount` | ✅ Automatica (dalla 1.4.0) |
| Modifiche alla playlist | evento `playlist-changed` (`reason`, `playlistName`, `count`) | ✅ Automatica (dalla 1.4.0). Per versioni precedenti: interrogazione periodica di `GetItems`, con avviso |
| Fine della playlist | `playlist-completed` | ✅ Automatica |

**[I]** Gli eventi `playlist-changed` che arrivano ravvicinati (es. una raffica di `durations-updated`) vengono raggruppati lato client prima di rileggere `GetItems`.

**Solo manuali o pianificati:**
- durate dei blocchi;
- durata di un break senza media (tappo realizzato come scena nera);
- allungamenti voluti di un blocco;
- orario di inizio pianificato.

**Richiedono logica aggiuntiva:**
- "in onda" = sorgente in Program **e** media in riproduzione;
- gruppi di scene trattati come "Studio";
- cursore sequenziale;
- calcolo di ritardo, recupero e fine prevista.

## 7. UX del monitor del conduttore

**Principi [D]**
- Sfondo **nero**, layout a riquadri in stile **Multiview ATEM**.
- Colori usati come **tally**, su bordi ed etichette.
- **Nessun video.**
- Gira in un browser in **modalità kiosk** sul secondo HDMI, indipendente da OBS.

**In studio**

```
┌──────────────────────────────────────────┬──────────────────┐
│ BLOCCO 2 · Secondo blocco                │ NEXT             │
│                                          │ SERVIZIO 2       │
│              08:42                       │ Intervista sind. │
│        (tempo rimanente blocco)          │ 03:04            │
│                                          ├──────────────────┤
│                                          │ FINE PROGRAMMA   │
│                                          │ 41:18 · 19:58:40 │
├──────────────────────────────────────────┴──────────────────┤
│ [MESSAGGIO REGIA: STRINGI]                   (se presente)  │
├─────────────────────────────────────────────────────────────┤
│ 19:17:22   ● REC  ● ON AIR   +0:42   OBS ✓                  │
└─────────────────────────────────────────────────────────────┘
```

**Durante un servizio o un break**
- Riquadro principale: **RIENTRO TRA 1:42**.
- Sotto: contenuto in onda, con progress bar.
- Indicazione del rientro: **"RIENTRO: BLOCCO 3 · Ospite in studio"**.
- Negli ultimi N secondi (default 10): countdown **verde a tutto schermo**.

**Soglie [D].** Configurabili per format. Default: ambra sotto 1:00; rosso allo sforamento, con il contatore che passa in positivo.

**Valori stimati [D].** Stile distinto ed etichetta "STIMATO". Se OBS non risponde: "⚠ OBS non connesso".

**Prima e dopo [D]**
- *PRE-SHOW*: countdown all'inizio pianificato (va in positivo in caso di ritardo) più anteprima del rundown.
- *OLTRE SCALETTA*: "SCALETTA TERMINATA +1:12".
- *FINE*: durata totale e scarto finale.

## 8. UX della regia

- **Editor** (pagina web): libreria dei format, puntate, timeline drag & drop, collegamento a scene e playlist, validazione, Check OBS, impostazioni del preset.
- **Dock OBS** (almeno 300 px di larghezza):
  - stato, blocco corrente, ritardo, fine prevista;
  - avvisi (fuori scaletta, REC riavviata, OBS o plugin non raggiungibili);
  - pulsanti dei messaggi e testo libero;
  - sezione "Emergenza" chiusa di default;
  - pulsante "Apri vista estesa".
- **Vista estesa**:
  - rundown completo, con lo stato di ogni elemento (andato, in onda, rimandato, eliminato, fuori scaletta);
  - tempi pianificati, previsti e reali;
  - log in tempo reale.
- **Scelte non bloccanti** (es. REC riavviata): il sistema applica subito un default. La regia lo conferma o lo cambia dopo, e la scelta vale anche retroattivamente.

## 9. Modello del rundown

```
Format (scheletro)
 └─ Puntata (istanza datata)
     └─ Blocco [tipo: studio | break] · durata fissa · fisso|elastico
         └─ Elemento
             ├─ Studio  → gruppo di scene (CAM 1, CAM 2, CAM 3)
             └─ Media   → elemento di Playlist Deck (servizio)
```

- **[R]** Spot e break sono blocchi. Il blocco è collegato a una scena che può contenere:
  - una Media Source (tappo misurato);
  - nessun media (tappo pianificato).
- **[R]** Durata del format = Σ durate dei blocchi.
- **[D]** La durata del blocco è un contenitore fisso. Tempo di studio = durata del blocco − Σ media.
- **[I]** Default: blocchi di studio **elastici**, break **fissi**.

## 10. Modello del timing

- **Tre tempi per ogni blocco o elemento:**
  - *pianificato*: da T0 più le durate;
  - *previsto*: pianificato + ritardo accumulato + recupero;
  - *reale*: dall'evento OBS.
- **T0** = primo avvio tra REC e streaming, oppure `START PROGRAM` in emergenza. Gli orari assoluti si calcolano da T0.
- **Ritardo** = inizio reale − inizio pianificato del blocco corrente, più lo sforamento in corso.
- **Fine prevista** = fine pianificata + ritardo, corretta con il recupero ancora possibile sui blocchi elastici.
- **Recupero [D]**: `next_elastic` (default) | `proportional` | `designated_absorbers`.
- **Anticipo [D]**: `keep` (default) | `redistribute`.
- **±tempo** dalla regia: modifica la durata del blocco corrente e fa ripartire il ricalcolo.
- **Contatori dei media**: interpolati localmente e riallineati a ogni aggiornamento.

## 11. Modello del break

- **Break = blocco** con una scena dedicata.
  - **Misurato**: la scena contiene una Media Source (es. un tappo `.mp4`). Il countdown al rientro viene da OBS.
  - **Pianificato**: la scena è nera, senza media. Il countdown è calcolato ed etichettato **STIMATO**.
- **Rientro** = OBS passa a una scena del gruppo Studio.
- **Tappo finito ma non ancora rientrati**: il contatore passa in positivo, in rosso.
- **[F]** Dettaglio dei singoli spot (PUB 1/2/3), per quando gli spot vanno in onda dal vivo.

## 12. Macchina a stati

**Stato del programma**

```
IDLE ──carica puntata──► PRE-SHOW ──REC/STREAM start──► LIVE ──ultimo blocco finito──► OLTRE SCALETTA
                                                          │                                  │
                                                          └────────REC/STREAM stop───────────┴──► FINE
```

**Sotto-stati di LIVE (fase):** `STUDIO` · `SERVIZIO` · `BREAK`.

**Modificatori**
- Tally: `AVVISO` (ambra) · `SFORAMENTO` (rosso) · `RIENTRO IMMINENTE` (verde, a tutto schermo).
- `FUORI SCALETTA`: visibile solo in regia.

**Stati ortogonali**
- *Fonte dei dati*: `MISURATO` · `STIMATO` (OBS o plugin assenti) · `SCONOSCIUTO`.
- *Controllo*: `AUTO` · `MANUALE`.
- *Uscite*: `REC` · `ON AIR` · `REC+ON AIR` · `REC ⚠ interrotta`.

## 13. Proposta di architettura

Proposta logica. Lo stack si decide nella progettazione tecnica.

```
          OBS Studio ── obs-websocket v5 ──┐
     Playlist Deck (vendor) ───────────────┤
                                           ▼
┌─────────────────────── OBS Live Clock Server (locale) ───────────────────────┐
│ OBS Adapter ─► Event Normalizer ─► Live Engine (cursore, timing, stati) ─┐   │
│ Playlist Deck Adapter ─┘                     │                           │   │
│ Persistenza (format, puntate, checkpoint, stato live, log) ◄─────────────┘   │
│ Clock Service (fonte unica dell'ora)   HTTP API + WebSocket push             │
└──────────────────────────────────────────────────────────────────────────────┘
      ▲               ▲                 ▲                   ▲
   Editor        Dock OBS          Vista estesa      Monitor conduttore (kiosk)
                                                     Stream Deck / hotkey → HTTP
```

- Il server è l'**unica fonte di verità**. I client sono viste che ricevono lo stato via WebSocket.
- Il server gira come un unico eseguibile locale.
- Persistenza su file locale: format, puntate, log e snapshot dello stato live.
- Un launcher avvia il server e il browser kiosk sul monitor configurato.

## 14. Modello dati (logico)

- **Format**: id, nome, preset (modalità, soglie, recupero, anticipo, N secondi di rientro), gruppi di scene, messaggi predefiniti, blocchi modello.
- **Puntata**: id, format_id, data, orario di inizio pianificato, playlist collegata, blocchi, stato (bozza · pronta · live · chiusa).
- **Blocco**: id, ordine, nome, tipo (studio | break), durata, fisso/elastico, assorbitore, collegamento a scena o gruppo di scene.
- **Elemento**: id, tipo (studio | media), collegamento (gruppo di scene, oppure elemento di playlist: percorso + occorrenza, con titolo e indice come riserva), durata pianificata, durata reale, stato.
- **PresetMessaggio**: testo, modalità di chiusura (timeout | manuale), durata, hotkey.
- **Checkpoint**: snapshot della puntata o del format, nome, tipo (automatico | manuale), data e ora.
- **LogLive**: sequenza di eventi con data e ora: cambio scena, media, REC/stream, ±tempo, NEXT, interruzioni, decisioni.
- **Marker** [v1.x]: timecode relativo al file, file di registrazione, etichetta.

## 15. Scenari di guasto

| Scenario | Comportamento |
|---|---|
| OBS disconnesso o bloccato | Si continua sul pianificato con "STIMATO" e "OBS non connesso". Riconnessione automatica con attese crescenti, poi risincronizzazione |
| OBS riavviato | Alla riconnessione rilegge scena, REC/stream e playlist, e si riallinea |
| Plugin assente o versione precedente alla 1.4.0 | Funzionamento ridotto: interrogazione periodica, oppure nessun "prossimo servizio" e nessuna durata. Avviso nel Check OBS e nel dock |
| App o PC riavviati durante la live | Riprende dallo snapshot, dall'ora corrente e dallo stato di OBS. Il monitor si riapre da solo |
| Monitor chiuso o scollegato | Riconnessione automatica con "RICONNESSIONE…". Mai dati vecchi mostrati come attuali |
| Cambio scena non previsto | Se riconosciuto: il rundown si riallinea. Se non riconosciuto: il blocco prosegue e in regia compare "fuori scaletta" |
| Media in pausa, seek, restart | Si segue la posizione reale. In pausa il contatore si ferma con l'etichetta "PAUSA" |
| Tappo finito ma non ancora rientrati | Contatore in positivo, in rosso |
| REC o streaming interrotti | Si applica il default della modalità, con scelta non bloccante nel dock valida anche retroattivamente |
| Dati incoerenti | Errore nell'editor prima della live. In diretta, avviso in regia |
| Orologio del server fuori sincrono | Avviso in regia se lo scarto dall'ora NTP supera la soglia (solo quando c'è rete) |
| Riconoscimento sbagliato | `NEXT`/`PREV` o `MANUALE` dalla sezione emergenza |

## 16. MVP

Tutti i requisiti della §4, undo/redo compreso, e i requisiti non funzionali della §5.

## 17. Funzioni future

**v1.x**
- Checkpoint con nome.
- Export e import di un progetto.
- Export dei marker per la post-produzione (CSV, EDL).
- Politiche di recupero e di anticipo avanzate.
- Plugin Stream Deck dedicato.
- Supporto a Media Source e VLC standard senza Playlist Deck.

**Futuro**
- Login e ruoli.
- Capitoli nel file Hybrid MP4 e compatibilità con Final Cut Pro.
- Tempo netto di studio e indicazione "lancia tra…".
- Promemoria automatici nel rundown.
- Viste per ospiti, floor e inviati.
- Aggiornare una puntata dallo scheletro del format.
- Durata minima dei blocchi elastici.
- Dettaglio dei singoli spot nel break.

## 18. Domande aperte → risolte (2026-09-28)

1. **[D] Collegamento tra servizio ed elemento della playlist.** Si usa il percorso del file più l'ordine di occorrenza. Titolo e indice servono solo come ripiego se il file è stato spostato.
2. **[D] Pausa della REC in OBS.**
   - *Live-to-tape*: il tempo di programma si ferma.
   - *Streaming e TV*: il tempo continua.
   - Il comportamento si può cambiare nel preset.
3. **[D] Scene annidate e gruppi.** Sono supportate: una sorgente è considerata in onda se è visibile, anche in modo annidato, dentro la scena in Program.
4. **[D] Rientro da un tappo senza media.** Si rileva solo dal cambio di scena verso il gruppo Studio.
5. **[D] Export dei marker (v1.x).** Prima in CSV, poi in EDL CMX3600.
6. **[D] Lingua.** Italiano e inglese già nell'MVP, con un sistema i18n estendibile. Il monitor può avere una lingua diversa da quella dell'editor.
7. **[D] Rundown durante la live.** Durante la live la struttura della puntata è bloccata. Restano consentiti:
   - ±tempo;
   - le modifiche alla playlist fatte in OBS;
   - lo sblocco d'emergenza, con conferma.
8. **[D] Soglie e passi.**
   - Avviso se l'orologio si discosta di più di 2 s dall'ora NTP.
   - Passo del ±tempo: 30 s, configurabile per format.

## 19. Criteri di accettazione (MVP)

- AC1 Un format con 5 blocchi, da cui si crea una puntata con 3 servizi importati da Playlist Deck. Durata totale = Σ blocchi.
- AC2 All'avvio della REC in OBS, il monitor passa da PRE-SHOW a LIVE entro 500 ms.
- AC3 Il passaggio tra CAM 1, CAM 2 e CAM 3 non fa avanzare il blocco. Il passaggio alla scena del break entra nel blocco break.
- AC4 Durante un servizio, il countdown al rientro resta entro ±0,5 s dal tempo residuo di Playlist Deck.
- AC5 Se un servizio viene rimosso dalla playlist durante la live, fine prevista e tempo di studio si aggiornano subito tramite `playlist-changed`.
- AC6 Se OBS viene spento durante la live, entro 2 s compare "STIMATO" e il conteggio continua. Alla riaccensione, lo stato torna MISURATO e i tempi si riallineano.
- AC7 Se il server si riavvia a metà puntata, riprende sul blocco giusto con i tempi corretti.
- AC8 Blocco in sforamento: ambra sotto 1:00; rosso con contatore positivo oltre lo zero; il recupero compare sul prossimo blocco elastico.
- AC9 Un messaggio inviato via hotkey o HTTP appare entro 500 ms e sparisce secondo la sua regola.
- AC10 Il contatore principale è leggibile a 4 m su una TV da 32" (cifre alte almeno il 20% dello schermo).
- AC11 Nessun valore numerico senza fonte: ogni valore è pianificato o stimato, altrimenti si mostra "—".
- AC12 L'editor supporta undo/redo di tutte le modifiche strutturali.

---

**Dipendenza esterna chiusa:** [obs-playlist-deck #28](https://github.com/angeloruggieridj/obs-playlist-deck/issues/28), rilasciata in Playlist Deck 1.4.0 (PR #29).
