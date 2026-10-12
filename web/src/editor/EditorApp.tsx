// SPDX-License-Identifier: GPL-2.0-or-later
import { useEffect, useRef, useState } from 'react';
import type { Lang } from '../core/i18n';
import { httpEditorApi, type EditorApi } from './api/editor-api';
import type { EditorKey } from './i18n';
import { ImportPanel } from './import/ImportPanel';
import { LibraryPanel } from './library/LibraryPanel';
import { PropertiesPanel } from './props/PropertiesPanel';
import { SettingsPanel } from './settings/SettingsPanel';
import { EditorProvider, useDoc, useEditorT, useSaveState, useSession, useSessionSnapshot, useStore } from './session/context';
import { EditorSession } from './session/session';
import { TimelinePanel } from './timeline/TimelinePanel';
import { ValidationPanel } from './validation/ValidationPanel';

export interface EditorAppProps {
  lang: Lang;
  // Provided by a parent (tests) or built here once and disposed on unmount.
  session?: EditorSession;
  api?: EditorApi;
  pollLiveMs?: number;
  pollExternalMs?: number;
}

const DEFAULT_POLL_LIVE_MS = 3_000;
const DEFAULT_POLL_EXTERNAL_MS = 10_000;

/** The editor shell: opens/replaces the session, then renders the header and the five regions. */
export function EditorApp(props: EditorAppProps) {
  const [session] = useState<EditorSession>(() => props.session ?? new EditorSession(props.api ?? httpEditorApi()));
  useEffect(() => {
    if (props.session !== undefined) return; // not ours to dispose
    return () => session.dispose();
  }, [props.session, session]);
  return (
    <EditorProvider session={session} lang={props.lang}>
      <EditorShell lang={props.lang} pollLiveMs={props.pollLiveMs} pollExternalMs={props.pollExternalMs} />
    </EditorProvider>
  );
}

/** True when the event target is a text field whose own undo/redo must stay in charge. */
function isTextField(target: EventTarget | null): boolean {
  const el = target as (HTMLElement & { tagName?: string }) | null;
  if (el === null || el.tagName === undefined) return false;
  const tag = el.tagName.toLowerCase();
  return tag === 'input' || tag === 'textarea' || tag === 'select' || el.isContentEditable === true;
}

function EditorShell(props: { lang: Lang; pollLiveMs?: number; pollExternalMs?: number }) {
  const session = useSession();
  const t = useEditorT();
  const snap = useSessionSnapshot();
  const store = useStore();
  const save = useSaveState();
  const doc = store.doc;

  // A status toast for 4 s after a silent refresh from another session.
  const [toast, setToast] = useState(false);
  const refreshedAt = useRef(snap.refreshed);
  useEffect(() => {
    if (snap.refreshed === refreshedAt.current) return;
    refreshedAt.current = snap.refreshed;
    setToast(true);
    const id = window.setTimeout(() => setToast(false), 4_000);
    return () => window.clearTimeout(id);
  }, [snap.refreshed]);

  // Poll the live status and the external copy; the same on window focus. 0 disables a poll.
  useEffect(() => {
    const onFocus = (): void => {
      void session.refreshLive();
      void session.checkExternal();
    };
    window.addEventListener('focus', onFocus);
    const liveMs = props.pollLiveMs ?? DEFAULT_POLL_LIVE_MS;
    const externalMs = props.pollExternalMs ?? DEFAULT_POLL_EXTERNAL_MS;
    const ids: number[] = [];
    if (liveMs > 0) ids.push(window.setInterval(() => void session.refreshLive(), liveMs));
    if (externalMs > 0) ids.push(window.setInterval(() => void session.checkExternal(), externalMs));
    return () => {
      window.removeEventListener('focus', onFocus);
      for (const id of ids) window.clearInterval(id);
    };
  }, [session, props.pollLiveMs, props.pollExternalMs]);

  // Ctrl/Cmd+Z undoes, Ctrl/Cmd+Shift+Z and Ctrl+Y redo — never inside a text field.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (!(e.ctrlKey || e.metaKey) || isTextField(e.target)) return;
      const key = e.key.toLowerCase();
      if (key === 'z' && !e.shiftKey) {
        e.preventDefault();
        session.undo();
      } else if ((key === 'z' && e.shiftKey) || key === 'y') {
        e.preventDefault();
        session.redo();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [session]);

  // Warn before leaving while there is anything unsaved (the autosave may still be retrying).
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent): void => {
      const kind = session.autosave.getState().kind;
      // A pending conflict means the local copy is not what the director confirmed: warn even if the autosave looks clean.
      if (kind === 'dirty' || kind === 'saving' || kind === 'error' || kind === 'invalid' || session.getSnapshot().conflict !== null) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [session]);

  const opLabel = (label: string | null): string | null => (label === null ? null : t(`shell.op.${label}` as EditorKey));
  const undoOp = opLabel(store.undoLabel);
  const redoOp = opLabel(store.redoLabel);

  const ref = snap.ref;
  const live = snap.live;
  const isEpisode = doc !== null && 'formatId' in doc;
  const showLoaded =
    ref !== null && ref.kind === 'episode' && live !== null && live.episodeId === ref.id && live.phase === 'preshow';

  const placeholder =
    snap.phase === 'loading'
      ? t('shell.loading')
      : snap.phase === 'error'
        ? t('shell.loadError', { code: snap.error ?? 'network' })
        : t('shell.openPrompt');

  return (
    <div className="ed-root" lang={props.lang}>
      <header className="ed-bar">
        <h1 className="ed-title">{t('shell.title')}</h1>
        <span className="ed-doc" data-testid="doc-title">
          {doc === null ? '' : `${isEpisode ? t('shell.kindEpisode') : t('shell.kindFormat')}: ${doc.name}`}
        </span>
        <button
          type="button"
          className="ed-btn"
          disabled={!store.canUndo}
          title={undoOp === null ? t('shell.undo') : t('shell.undoTip', { op: undoOp })}
          onClick={() => session.undo()}
        >
          {t('shell.undo')}
        </button>
        <button
          type="button"
          className="ed-btn"
          disabled={!store.canRedo}
          title={redoOp === null ? t('shell.redo') : t('shell.redoTip', { op: redoOp })}
          onClick={() => session.redo()}
        >
          {t('shell.redo')}
        </button>

        {doc !== null && (
          <div
            className={save.kind === 'error' || save.kind === 'invalid' ? 'ed-save ed-error' : 'ed-save'}
            data-testid="save-state"
            data-state={save.kind}
            role={save.kind === 'error' || save.kind === 'invalid' ? 'alert' : undefined}
          >
            <span className="ed-save-dot" data-state={save.kind} aria-hidden="true" />
            <span>
              {save.kind === 'clean' && t('shell.save.clean')}
              {save.kind === 'dirty' && t('shell.save.dirty')}
              {save.kind === 'saving' && t('shell.save.saving')}
              {save.kind === 'error' && t('shell.save.error', { code: save.code })}
              {save.kind === 'invalid' && t('shell.save.invalid', { code: save.code })}
              {save.kind === 'locked' && t('shell.save.locked')}
            </span>
            {save.kind === 'error' && (
              <button type="button" className="ed-btn" onClick={() => void session.autosave.retryNow()}>
                {t('shell.retry')}
              </button>
            )}
          </div>
        )}

        {snap.lock === 'live' && (
          <div className="ed-banner ed-banner-live" role="alert">
            {t('shell.liveBanner')}
          </div>
        )}

        {snap.conflict !== null && (
          <div className="ed-banner ed-banner-warn" role="alert">
            <span>{t('shell.conflictBanner')}</span>
            <button type="button" className="ed-btn" onClick={() => session.takeTheirs()}>
              {t('shell.takeTheirs')}
            </button>
            <button type="button" className="ed-btn" onClick={() => session.keepMine()}>
              {t('shell.keepMine')}
            </button>
          </div>
        )}

        {snap.blocked && (
          <div className="ed-banner ed-banner-warn" role="alert">
            <span>{t('shell.blockedBanner')}</span>
            <button type="button" className="ed-btn" onClick={() => void session.autosave.retryNow()}>
              {t('shell.retry')}
            </button>
            <button type="button" className="ed-btn" onClick={() => session.forget()}>
              {t('shell.discard')}
            </button>
          </div>
        )}

        {showLoaded && (
          <div className="ed-banner ed-banner-info" role="status">
            {t('shell.loadedBanner')}
          </div>
        )}

        {toast && (
          <div className="ed-toast" role="status">
            {t('shell.refreshed')}
          </div>
        )}
      </header>

      <section className="ed-region ed-library" data-testid="region-library">
        <LibraryPanel />
      </section>
      <section className="ed-region ed-timeline" data-testid="region-timeline">
        {doc === null ? <p className="ed-placeholder">{placeholder}</p> : <TimelinePanel />}
      </section>
      <section className="ed-region ed-properties" data-testid="region-properties">
        {doc !== null && (
          <>
            <PropertiesPanel />
            <ImportPanel />
          </>
        )}
      </section>
      <section className="ed-region ed-settings" data-testid="region-settings">
        {doc !== null && <SettingsPanel />}
      </section>
      <section className="ed-region ed-validation" data-testid="region-validation">
        {doc !== null && <ValidationPanel />}
      </section>
    </div>
  );
}
