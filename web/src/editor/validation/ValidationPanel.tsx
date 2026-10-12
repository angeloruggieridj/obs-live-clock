// SPDX-License-Identifier: GPL-2.0-or-later
import { useMemo, useState } from 'react';
import { validateRundown } from '@olc/shared';
import { ApiError } from '../../core/http';
import type { ObsCheckResult } from '../api/editor-api';
import { useDoc, useEditorT, useSession, useSessionSnapshot, useStore } from '../session/context';
import { countBySeverity, dedupeIssues, groupByBlock, hasErrors, issueText, type DisplayIssue, type IssueGroup } from './issues';

const deckText = (deck: ObsCheckResult['deck'], t: ReturnType<typeof useEditorT>): string => {
  if (deck === null || deck.capability === 'absent') return t('validation.deckAbsent');
  return deck.capability === 'legacy' ? t('validation.deckLegacy') : t('validation.deckEvents');
};

const testId = (issue: DisplayIssue): string => `issue-${issue.code}-${issue.blockId ?? 'global'}`;

/** The validation region: local problems, Layer-2 Check OBS and the guarded "Load for live". */
export function ValidationPanel() {
  const session = useSession();
  const t = useEditorT();
  const doc = useDoc();
  const store = useStore();
  const snap = useSessionSnapshot();

  const [checking, setChecking] = useState(false);
  const [check, setCheck] = useState<{ result: ObsCheckResult; rev: number } | null>(null);
  const [checkError, setCheckError] = useState<string | null>(null);
  const [confirmLoad, setConfirmLoad] = useState(false);
  const [loadMessage, setLoadMessage] = useState<string | null>(null);
  const [loadIssues, setLoadIssues] = useState<DisplayIssue[]>([]);

  const isEpisode = snap.ref?.kind === 'episode';
  const episodeId = snap.ref !== null && snap.ref.kind === 'episode' ? snap.ref.id : null;
  // While a document is loading the session is not editable: no action may start against a half-loaded copy.
  const busy = snap.phase === 'loading';

  const local = useMemo<DisplayIssue[]>(
    () => (doc === null ? [] : dedupeIssues(validateRundown(doc)).map((i) => ({ ...i, source: 'rundown' as const }))),
    [doc],
  );
  const blocks = useMemo(() => (doc === null ? [] : doc.blocks.map((b) => ({ id: b.id, name: b.name }))), [doc]);
  const counts = countBySeverity(local);
  const blocked = hasErrors(local);
  const stale = check !== null && check.rev !== store.rev;
  const obs = useMemo<DisplayIssue[]>(
    () => (check === null ? [] : check.result.issues.map((i) => ({ ...i, source: 'obs' as const }))),
    [check],
  );
  const obsHasErrors = check !== null && !stale && hasErrors(check.result.issues);

  async function onCheck(): Promise<void> {
    if (episodeId === null || checking) return;
    setChecking(true);
    setCheckError(null);
    try {
      await session.autosave.flush(); // the server checks the saved copy
      if (session.autosave.getState().kind !== 'clean') {
        setCheckError(t('validation.checkUnsaved'));
        return;
      }
      const rev = session.store.getSnapshot().rev;
      const result = await session.api.checkObs(episodeId);
      setCheck({ result, rev });
    } catch (err) {
      setCheckError(t('validation.checkFailed', { code: err instanceof ApiError ? err.code : 'network' }));
    } finally {
      setChecking(false);
    }
  }

  async function onLoad(): Promise<void> {
    if (episodeId === null) return;
    if (obsHasErrors && !confirmLoad) {
      setConfirmLoad(true);
      setLoadMessage(null);
      return;
    }
    setConfirmLoad(false);
    setLoadMessage(null);
    setLoadIssues([]);
    const result = await session.loadForLive(episodeId);
    if (result.ok) {
      setLoadMessage(t('validation.loadOk'));
    } else if (result.reason === 'invalid') {
      setLoadMessage(t('validation.loadInvalid'));
      setLoadIssues((result.issues ?? []).map((i) => ({ ...i, source: 'obs' as const })));
    } else if (result.reason === 'live_running') {
      setLoadMessage(t('validation.loadLiveRunning'));
    } else if (result.reason === 'unsaved') {
      setLoadMessage(t('validation.loadUnsaved'));
    } else {
      setLoadMessage(t('validation.loadFailed', { code: result.reason }));
    }
  }

  const renderGroups = (groups: IssueGroup[]) =>
    groups.map((g) => (
      <div key={g.blockId ?? 'global'}>
        <h4>{g.blockName ?? t('validation.global')}</h4>
        <ul>
          {g.issues.map((issue, i) => (
            <li key={`${testId(issue)}-${i}`}>
              <button
                type="button"
                className="ed-issue"
                data-testid={testId(issue)}
                onClick={() => issue.blockId !== null && session.selection.select(issue.blockId, { reveal: true })}
              >
                <span className={issue.severity === 'error' ? 'ed-error' : 'ed-warn'}>
                  {issue.severity === 'error' ? t('validation.error') : t('validation.warning')}
                </span>{' '}
                {issueText(t, issue)}
                {issue.source === 'obs' ? <small> {issue.message}</small> : null}
              </button>
            </li>
          ))}
        </ul>
      </div>
    ));

  return (
    <div className="ed-validation-panel">
      <p role="status" data-testid="val-summary">
        {counts.errors + counts.warnings === 0 ? t('validation.none') : t('validation.summary', { e: counts.errors, w: counts.warnings })}
      </p>

      {renderGroups(groupByBlock(local, blocks))}

      <div className="ed-validation-obs">
        <button
          type="button"
          className="ed-btn"
          onClick={() => void onCheck()}
          disabled={!isEpisode || checking || busy}
          title={isEpisode ? undefined : t('validation.checkNeedsEpisode')}
        >
          {checking ? t('validation.checking') : t('validation.checkObs')}
        </button>

        {check !== null && !stale ? (
          <p className="ed-validation-connection">
            {!check.result.connected ? t('validation.obsOffline') : t('validation.obsInfo', { version: check.result.obsWebSocketVersion ?? '?', deck: deckText(check.result.deck, t) })}
          </p>
        ) : null}

        {check !== null && check.result.issues.length === 0 ? <p>{t('validation.obsClean')}</p> : null}
        {renderGroups(groupByBlock(obs, blocks))}

        {stale ? <p className="ed-warn">{t('validation.checkStale')}</p> : null}
        {checkError !== null ? <p className="ed-warn">{checkError}</p> : null}
        {check !== null || checkError !== null ? <p className="ed-validation-caveat">{t('validation.caveat')}</p> : null}
      </div>

      {isEpisode ? (
        <div className="ed-validation-load">
          <button type="button" className="ed-btn" onClick={() => void onLoad()} disabled={blocked || busy}>
            {t('validation.loadForLive')}
          </button>
          {blocked ? <p className="ed-error">{t('validation.loadBlocked')}</p> : null}
          {confirmLoad ? <p className="ed-warn">{t('validation.loadConfirm')}</p> : null}
          {loadMessage !== null ? <p role="status">{loadMessage}</p> : null}
          {renderGroups(groupByBlock(loadIssues, blocks))}
        </div>
      ) : null}
    </div>
  );
}
