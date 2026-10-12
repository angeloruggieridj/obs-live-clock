// SPDX-License-Identifier: GPL-2.0-or-later
import { useEffect, useState } from 'react';
import { flushSync } from 'react-dom';
import type { Block, ProductionMode, SceneGroup } from '@olc/shared';
import {
  addMessage,
  addSceneGroup,
  applyMode,
  patchEpisodeMeta,
  patchMessage,
  patchSceneGroup,
  removeMessage,
  removeSceneGroup,
  renameDoc,
  setPreset,
} from '../model/ops';
import { timeOfDay, toIsoWithOffset } from '../model/time';
import { useDoc, useEditorT, useSession, useSessionSnapshot, useStore } from '../session/context';
import type { EditorSession } from '../session/session';
import type { EditorT } from '../i18n';
import './settings.css';

/** Commits on blur and on Enter; reverts to the document value when the commit is refused. */
function Field(props: {
  label: string;
  value: string;
  type?: 'text' | 'number' | 'date' | 'time';
  min?: number;
  maxLength?: number;
  disabled: boolean;
  commit: (raw: string) => boolean;
}) {
  const { label, value, type = 'text', min, maxLength, disabled, commit } = props;
  const [draft, setDraft] = useState(value);
  const [seen, setSeen] = useState(value);
  if (seen !== value) {
    // The document changed (edit applied, undo, load): follow it without an effect.
    setSeen(value);
    setDraft(value);
  }
  const doCommit = () => {
    if (!commit(draft)) setDraft(value);
  };
  return (
    <label className="ed-set-field">
      <span className="ed-set-label">{label}</span>
      <input
        type={type}
        value={draft}
        min={min}
        maxLength={maxLength}
        disabled={disabled}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={doCommit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            doCommit();
          }
        }}
      />
    </label>
  );
}

function SceneGroups(props: {
  sceneGroups: SceneGroup[];
  blocks: Block[];
  disabled: boolean;
  obsScenes: string[] | null;
  session: EditorSession;
  t: EditorT;
}) {
  const { sceneGroups, blocks, disabled, obsScenes, session, t } = props;
  const [newGroup, setNewGroup] = useState('');
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const used = (id: string) => blocks.some((b) => b.kind === 'studio' && b.sceneGroupId === id);
  return (
    <section className="ed-set-section" aria-label={t('settings.sceneGroups')}>
      <h3 className="ed-set-heading">{t('settings.sceneGroups')}</h3>
      {obsScenes === null ? <p className="ed-set-hint">{t('settings.obsOffline')}</p> : null}
      {sceneGroups.map((g) => {
        const draft = drafts[g.id] ?? '';
        const addScene = () => {
          const name = draft.trim();
          if (name === '' || g.scenes.includes(name)) return;
          session.apply(patchSceneGroup(g.id, { scenes: [...g.scenes, name] }));
          setDrafts((d) => ({ ...d, [g.id]: '' }));
        };
        return (
          <fieldset key={g.id} data-testid={`group-${g.id}`} className="ed-set-group">
            <legend className="ed-set-legend">{`${t('settings.groupNameN')} ${g.id}`}</legend>
            <Field
              label={`${t('settings.groupNameN')} ${g.id}`}
              value={g.name}
              disabled={disabled}
              commit={(raw) => session.apply(patchSceneGroup(g.id, { name: raw }))}
            />
            <ul className="ed-set-scenes">
              {g.scenes.map((scene) => {
                const missing = obsScenes !== null && !obsScenes.includes(scene);
                return (
                  <li key={scene} className="ed-set-scene">
                    <span className={missing ? 'ed-set-scene-name is-warn' : 'ed-set-scene-name'} title={missing ? t('settings.sceneNotInObs') : undefined}>
                      {scene}
                    </span>
                    <button
                      type="button"
                      className="ed-btn"
                      disabled={disabled || g.scenes.length <= 1}
                      title={t('settings.lastScene')}
                      onClick={() => session.apply(patchSceneGroup(g.id, { scenes: g.scenes.filter((s) => s !== scene) }))}
                    >
                      {`${t('settings.removeScene')} ${scene}`}
                    </button>
                  </li>
                );
              })}
            </ul>
            <div className="ed-set-add">
              <label className="ed-set-field">
                <span className="ed-set-label">{`${t('settings.sceneN')} ${g.id}`}</span>
                <input
                  type="text"
                  role="textbox"
                  value={draft}
                  disabled={disabled}
                  list={obsScenes !== null ? `obs-scenes-${g.id}` : undefined}
                  onChange={(e) => setDrafts((d) => ({ ...d, [g.id]: e.target.value }))}
                />
              </label>
              <button type="button" className="ed-btn" disabled={disabled} onClick={addScene}>
                {`${t('settings.addScene')} ${g.id}`}
              </button>
            </div>
            {obsScenes !== null ? (
              <datalist id={`obs-scenes-${g.id}`}>
                {obsScenes.map((s) => (
                  <option key={s} value={s} />
                ))}
              </datalist>
            ) : null}
            <button
              type="button"
              className="ed-btn ed-btn-danger"
              disabled={disabled || used(g.id)}
              title={t('settings.groupInUse')}
              onClick={() => session.apply(removeSceneGroup(g.id))}
            >
              {`${t('settings.removeGroup')} ${g.id}`}
            </button>
          </fieldset>
        );
      })}
      <div className="ed-set-add">
        <label className="ed-set-field">
          <span className="ed-set-label">{t('settings.newGroupName')}</span>
          <input type="text" value={newGroup} disabled={disabled} onChange={(e) => setNewGroup(e.target.value)} />
        </label>
        <button
          type="button"
          className="ed-btn"
          disabled={disabled}
          onClick={() => {
            session.apply(addSceneGroup(newGroup, 'SCENA 1'));
            setNewGroup('');
          }}
        >
          {t('settings.newGroup')}
        </button>
      </div>
    </section>
  );
}

function Messages(props: { messages: { id: string; text: string; dismiss: { kind: 'timeout'; ms: number } | { kind: 'manual' } }[]; disabled: boolean; session: EditorSession; t: EditorT }) {
  const { messages, disabled, session, t } = props;
  const [newMessage, setNewMessage] = useState('');
  return (
    <section className="ed-set-section" aria-label={t('settings.messages')}>
      <h3 className="ed-set-heading">{t('settings.messages')}</h3>
      <ul className="ed-set-messages">
        {messages.map((m) => {
          const currentMs = m.dismiss.kind === 'timeout' ? m.dismiss.ms : 10_000;
          return (
            <li key={m.id} data-testid={`msg-${m.id}`} className="ed-set-message">
              <Field
                label={`${t('settings.messageText')} ${m.id}`}
                value={m.text}
                maxLength={80}
                disabled={disabled}
                commit={(raw) => session.apply(patchMessage(m.id, { text: raw }))}
              />
              <label className="ed-set-field">
                <span className="ed-set-label">{`${t('settings.messageDismiss')} ${m.id}`}</span>
                <select
                  value={m.dismiss.kind}
                  disabled={disabled}
                  onChange={(e) => {
                    const kind = e.target.value;
                    session.apply(
                      patchMessage(m.id, { dismiss: kind === 'manual' ? { kind: 'manual' } : { kind: 'timeout', ms: currentMs } }),
                    );
                  }}
                >
                  <option value="timeout">{t('settings.dismissTimeout')}</option>
                  <option value="manual">{t('settings.dismissManual')}</option>
                </select>
              </label>
              {m.dismiss.kind === 'timeout' ? (
                <Field
                  label={`${t('settings.messageSeconds')} ${m.id}`}
                  type="number"
                  min={1}
                  value={String(m.dismiss.ms / 1000)}
                  disabled={disabled}
                  commit={(raw) => session.apply(patchMessage(m.id, { dismiss: { kind: 'timeout', ms: Math.round(Number(raw) * 1000) } }))}
                />
              ) : null}
              <button type="button" className="ed-btn ed-btn-danger" disabled={disabled} onClick={() => session.apply(removeMessage(m.id))}>
                {`${t('settings.removeMessage')} ${m.id}`}
              </button>
            </li>
          );
        })}
      </ul>
      <div className="ed-set-add">
        <label className="ed-set-field">
          <span className="ed-set-label">{t('settings.newMessageText')}</span>
          <input type="text" value={newMessage} disabled={disabled} onChange={(e) => setNewMessage(e.target.value)} />
        </label>
        <button
          type="button"
          className="ed-btn"
          disabled={disabled}
          onClick={() => {
            session.apply(addMessage(newMessage));
            setNewMessage('');
          }}
        >
          {t('settings.newMessage')}
        </button>
      </div>
    </section>
  );
}

/** F12: format/episode settings — preset, scene groups, messages, episode data. Not rendered without an open document. */
export function SettingsPanel() {
  const t = useEditorT();
  const session = useSession();
  const doc = useDoc();
  const store = useStore();
  const snap = useSessionSnapshot();
  const api = session.api;
  const [obsScenes, setObsScenes] = useState<string[] | null>(null);

  useEffect(() => {
    let alive = true;
    void api.obsScenes().then(
      (scenes) => {
        // The scene list is read once on mount. Flush it eagerly so a datalist built from it is present as soon as the
        // panel is (the suggestions must not depend on a later, unrelated re-render).
        if (alive) flushSync(() => setObsScenes(scenes));
      },
      () => {
        if (alive) flushSync(() => setObsScenes(null));
      },
    );
    return () => {
      alive = false;
    };
  }, [api]);

  if (doc === null) return null;
  // The store holds the previous document while a new one loads: an edit made then would go to the wrong file.
  const disabled = store.readOnly || snap.phase === 'loading';
  const episode = 'formatId' in doc ? doc : null;

  return (
    <div className="ed-set-panel">
      <h2 className="ed-set-title">{t('settings.title')}</h2>
      <Field label={t('settings.docName')} value={doc.name} disabled={disabled} commit={(raw) => session.apply(renameDoc(raw))} />
      {episode !== null ? (
        <fieldset className="ed-set-section ed-set-episode">
          <legend className="ed-set-legend">{t('settings.episode')}</legend>
          <Field
            label={t('settings.date')}
            type="date"
            value={episode.date}
            disabled={disabled}
            commit={(raw) => session.apply(patchEpisodeMeta({ date: raw }))}
          />
          <Field
            label={t('settings.plannedStart')}
            type="time"
            value={timeOfDay(episode.plannedStart) ?? ''}
            disabled={disabled}
            commit={(raw) => session.apply(patchEpisodeMeta({ plannedStart: raw === '' ? null : toIsoWithOffset(episode.date, raw) }))}
          />
          <Field
            label={t('settings.playlist')}
            value={episode.playlistName ?? ''}
            disabled={disabled}
            commit={(raw) => session.apply(patchEpisodeMeta({ playlistName: raw }))}
          />
        </fieldset>
      ) : null}
      <div className="ed-set-mode">
        <label className="ed-set-field">
          <span className="ed-set-label">{t('settings.mode')}</span>
          <select value={doc.preset.mode} disabled={disabled} onChange={(e) => session.apply(applyMode(e.target.value as ProductionMode))}>
            <option value="streaming">{t('settings.modeStreaming')}</option>
            <option value="tv">{t('settings.modeTv')}</option>
            <option value="live_to_tape">{t('settings.modeLiveToTape')}</option>
          </select>
        </label>
        <span className="ed-set-hint">{t('settings.modeNote')}</span>
      </div>
      <Field
        label={t('settings.warnS')}
        type="number"
        min={0}
        value={String(doc.preset.warnMs / 1000)}
        disabled={disabled}
        commit={(raw) => session.apply(setPreset({ warnMs: Math.round(Number(raw) * 1000) }))}
      />
      <Field
        label={t('settings.returnS')}
        type="number"
        min={0}
        value={String(doc.preset.returnImminentMs / 1000)}
        disabled={disabled}
        commit={(raw) => session.apply(setPreset({ returnImminentMs: Math.round(Number(raw) * 1000) }))}
      />
      <Field
        label={t('settings.stepS')}
        type="number"
        min={1}
        value={String(doc.preset.adjustStepMs / 1000)}
        disabled={disabled}
        commit={(raw) => session.apply(setPreset({ adjustStepMs: Math.round(Number(raw) * 1000) }))}
      />
      <label className="ed-set-check">
        <input
          type="checkbox"
          checked={doc.preset.recPauseFreezesProgram}
          disabled={disabled}
          onChange={(e) => session.apply(setPreset({ recPauseFreezesProgram: e.target.checked }))}
        />
        <span>{t('settings.recPause')}</span>
      </label>
      <SceneGroups sceneGroups={doc.sceneGroups} blocks={doc.blocks} disabled={disabled} obsScenes={obsScenes} session={session} t={t} />
      <Messages messages={doc.messages} disabled={disabled} session={session} t={t} />
    </div>
  );
}
