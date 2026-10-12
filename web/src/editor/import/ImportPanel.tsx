// SPDX-License-Identifier: GPL-2.0-or-later
import { isAbsolutePath, parsePlaylistFile } from '@olc/shared';
import { useState } from 'react';
import { durationText } from '../../core/time-format';
import type { EditorDoc } from '../api/editor-api';
import { useDoc, useEditorT, useSelection, useSession, useSessionSnapshot, useStore } from '../session/context';
import { importEdit, planPlacement, withOccurrences, type Candidate, type PlacementMode } from './place';
import { readFileText } from './read-file';

/** A candidate plus the preview-only facts (relative path, skipped rows) the placement does not need. */
interface PreviewRow extends Candidate {
  relative: boolean;
}

const DECK_REASON = {
  obs_not_connected: 'import.deckObs',
  deck_absent: 'import.deckAbsent',
  deck_not_ready: 'import.deckNotReady',
} as const;

const PARSE_REASON = {
  empty: 'import.parseEmpty',
  unrecognised: 'import.parseUnrecognised',
  no_items: 'import.parseNoItems',
} as const;

const badgeKey = (origin: Candidate['origin']) =>
  origin === 'deck' ? 'import.originDeck' : origin === 'file' ? 'import.originFile' : origin === 'file_rounded' ? 'import.originFileRounded' : null;

/**
 * Playlist import (SPEC §13): fills a preview from Playlist Deck or from a playlist file, then adds the items to the
 * chosen studio block (or spreads them across the studio blocks) as ONE undo step. The plan is recomputed against the
 * document at click time, so importing the same items twice adds nothing (Review Focus 4).
 */
export function ImportPanel() {
  const session = useSession();
  const t = useEditorT();
  const doc = useDoc();
  const selection = useSelection();
  const sessionSnap = useSessionSnapshot();
  const { readOnly } = useStore();

  // Non-editable while the store is locked (live) and while the session is not ready (loading), so an edit can never
  // race the open() that is about to replace the document.
  const locked = readOnly || sessionSnap.phase !== 'ready';

  const [rows, setRows] = useState<PreviewRow[] | null>(null);
  const [status, setStatus] = useState('');
  const [skipped, setSkipped] = useState(0);
  const [result, setResult] = useState('');
  const [mode, setMode] = useState<'append' | 'sequence'>('append');
  const [chosenBlock, setChosenBlock] = useState<string | null>(null);

  const studios = doc === null ? [] : doc.blocks.filter((b) => b.kind === 'studio');
  const selectedStudio = selection.blockId !== null && studios.some((b) => b.id === selection.blockId) ? selection.blockId : null;
  const targetBlockId = chosenBlock ?? selectedStudio ?? studios[0]?.id ?? '';

  const readDeck = async () => {
    setResult('');
    try {
      const deck = await session.api.deckItems();
      if (deck.state === 'unavailable') {
        setRows(null);
        setSkipped(0);
        setStatus(t(DECK_REASON[deck.reason]));
        return;
      }
      setRows(deck.items.map((i) => ({
        title: i.title, path: i.path, occurrence: i.occurrence, durationMs: i.durationMs, origin: 'deck', relative: !isAbsolutePath(i.path),
      })));
      setSkipped(0);
      setStatus('');
    } catch {
      setRows(null);
      setSkipped(0);
      setStatus(t('import.readFailed'));
    }
  };

  const readChosenFile = async (file: File | undefined) => {
    if (file === undefined) return;
    setResult('');
    try {
      const parsed = parsePlaylistFile(await readFileText(file), file.name);
      if (!parsed.ok) {
        setRows(null);
        setSkipped(0);
        setStatus(t(PARSE_REASON[parsed.reason]));
        return;
      }
      const items = withOccurrences(parsed.playlist.items);
      setRows(items.map((i) => ({
        title: i.title, path: i.path, occurrence: i.occurrence, durationMs: i.durationMs, origin: i.durationOrigin, relative: i.pathIsRelative,
      })));
      setSkipped(parsed.playlist.skipped);
      setStatus('');
    } catch {
      setRows(null);
      setSkipped(0);
      setStatus(t('import.readFailed'));
    }
  };

  const importItems = () => {
    if (doc === null || rows === null || rows.length === 0) return;
    const placement: PlacementMode = mode === 'sequence' ? { kind: 'sequence' } : { kind: 'append', blockId: targetBlockId };
    const plan = planPlacement(doc, rows, placement);
    session.apply(importEdit<EditorDoc>(plan));
    setResult(plan.adds.length === 0
      ? t('import.nothingNew')
      : t('import.result', { added: plan.adds.length, existing: plan.skippedExisting, unknown: plan.unknownDuration }));
  };

  return (
    <section className="imp" aria-label={t('import.title')}>
      <h2 className="imp-title">{t('import.title')}</h2>
      <p role="status" className="imp-status">{status}</p>

      <div className="imp-source">
        <p>{t('import.fromDeck')}</p>
        <button type="button" className="ed-btn" onClick={readDeck} disabled={locked}>{t('import.readDeck')}</button>
        <p>{t('import.fromFile')}</p>
        <label className="imp-file">
          <input
            type="file"
            aria-label={t('import.chooseFile')}
            accept=".json,.csv,.m3u,.m3u8,.txt"
            disabled={locked}
            onChange={(e) => void readChosenFile(e.target.files?.[0])}
          />
        </label>
      </div>

      {rows !== null && rows.length > 0 && (
        <div className="imp-preview">
          <p>{t('import.found', { n: rows.length })}</p>
          <ul aria-label="Anteprima">
            {rows.map((row, i) => {
              const badge = badgeKey(row.origin);
              return (
                <li key={i} data-testid={`imp-row-${i}`} className="imp-row">
                  <span className="imp-item-title">{row.title}</span>
                  <span className="imp-path" title={row.path}>{row.path}</span>
                  {row.durationMs < 0 || row.origin === 'unknown' ? (
                    <>
                      <span className="is-warn">—</span>
                      <span className="is-warn">{t('import.unknownDuration')}</span>
                    </>
                  ) : (
                    <span className="imp-duration">{durationText(row.durationMs)}</span>
                  )}
                  {badge !== null && <span className="imp-origin">{t(badge)}</span>}
                  {row.relative && <span className="is-warn">{t('import.relativePath')}</span>}
                </li>
              );
            })}
          </ul>
          {skipped > 0 && <p>{t('import.skipped', { n: skipped })}</p>}
        </div>
      )}

      <div className="imp-where">
        <p>{t('import.where')}</p>
        <label className="imp-radio">
          <input type="radio" name="imp-mode" checked={mode === 'append'} disabled={locked} onChange={() => setMode('append')} />
          {t('import.placeAppend')}
        </label>
        <label className="imp-target">
          {t('import.targetBlock')}
          <select value={targetBlockId} disabled={locked} aria-label={t('import.targetBlock')} onChange={(e) => setChosenBlock(e.target.value)}>
            {studios.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </label>
        <label className="imp-radio">
          <input type="radio" name="imp-mode" checked={mode === 'sequence'} disabled={locked} onChange={() => setMode('sequence')} />
          {t('import.placeSequence')}
        </label>
      </div>

      {studios.length === 0 && <p className="is-warn">{t('import.noStudio')}</p>}

      {rows !== null && rows.length > 0 && (
        <button type="button" className="ed-btn" onClick={importItems} disabled={locked || studios.length === 0}>
          {t('import.importN', { n: rows.length })}
        </button>
      )}
      <p data-testid="imp-result">{result}</p>
    </section>
  );
}
