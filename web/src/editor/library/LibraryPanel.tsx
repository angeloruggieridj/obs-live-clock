// SPDX-License-Identifier: GPL-2.0-or-later
import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import type { Episode, Format } from '@olc/shared';
import { ApiError } from '../../core/http';
import type { DocRef, EditorDoc, NewEpisodeBody } from '../api/editor-api';
import { uniqueSlug } from '../model/ids';
import { renameDoc } from '../model/ops';
import { localDate, toIsoWithOffset } from '../model/time';
import { useEditorT, useSaveState, useSession, useSessionSnapshot } from '../session/context';
import { blankFormat } from './blank';
import './library.css';

const isSame = (a: DocRef | null, b: DocRef): boolean => a !== null && a.kind === b.kind && a.id === b.id;
const codeOf = (err: unknown): string => (err instanceof ApiError ? err.code : 'network');
const busyKey = (op: string, ref: DocRef): string => `${op}:${ref.kind}:${ref.id}`;

interface EpisodeInput {
  date: string;
  time: string;
  playlist: string;
}

/** The "New episode" dialog: the fields the server needs, with the planned start optional. */
function NewEpisodeDialog(props: { format: Format; now: () => Date; onClose: () => void; onCreate: (input: EpisodeInput) => void }) {
  const t = useEditorT();
  const [date, setDate] = useState(() => localDate(props.now()));
  const [time, setTime] = useState('');
  const [playlist, setPlaylist] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <div role="dialog" aria-label={t('library.newEpisode')} className="ed-lib-dialog">
      <h3>{t('library.newEpisode')}</h3>
      <label className="ed-lib-field">
        <span>{t('library.episodeDate')}</span>
        <input type="date" aria-label={t('library.episodeDate')} value={date} onChange={(e) => setDate(e.target.value)} />
      </label>
      <label className="ed-lib-field">
        <span>{t('library.episodeStart')}</span>
        <input type="time" aria-label={t('library.episodeStart')} value={time} onChange={(e) => setTime(e.target.value)} />
      </label>
      <label className="ed-lib-field">
        <span>{t('library.episodePlaylist')}</span>
        <input type="text" aria-label={t('library.episodePlaylist')} value={playlist} onChange={(e) => setPlaylist(e.target.value)} />
      </label>
      <div className="ed-lib-dialog-actions">
        <button
          type="button"
          className="ed-btn"
          disabled={busy || date === ''}
          onClick={() => {
            setBusy(true);
            props.onCreate({ date, time, playlist });
          }}
        >
          {t('library.create')}
        </button>
        <button type="button" className="ed-btn" onClick={props.onClose}>
          {t('library.cancel')}
        </button>
      </div>
    </div>
  );
}

/** Formats and episodes, with the actions the director performs on them. */
export function LibraryPanel(props: { now?: () => Date }) {
  const t = useEditorT();
  const session = useSession();
  const api = session.api;
  const snap = useSessionSnapshot();
  const saveState = useSaveState();
  const now = props.now ?? (() => new Date());

  const [formats, setFormats] = useState<Format[]>([]);
  const [episodes, setEpisodes] = useState<Episode[]>([]);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState<ReadonlySet<string>>(() => new Set<string>());
  /** `null` = the new-format form is closed. */
  const [newName, setNewName] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<{ ref: DocRef; value: string } | null>(null);
  const [confirming, setConfirming] = useState<DocRef | null>(null);
  const [episodeFor, setEpisodeFor] = useState<Format | null>(null);

  const confirmTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const firstList = useRef(true);

  const refresh = useCallback(async () => {
    try {
      const [fs, eps] = await Promise.all([api.listFormats(), api.listEpisodes()]);
      setFormats(fs);
      setEpisodes([...eps].sort((a, b) => b.date.localeCompare(a.date) || a.name.localeCompare(b.name)));
    } catch (err) {
      setStatus(t('library.error', { code: codeOf(err) }));
    }
  }, [api, t]);

  // List on mount and again whenever the open document returns to `clean` (a save renamed or re-dated it).
  useEffect(() => {
    if (saveState.kind !== 'clean') return;
    let cancelled = false;
    void (async () => {
      await refresh();
      if (cancelled || !firstList.current) return;
      firstList.current = false;
      await session.refreshLive();
    })();
    return () => {
      cancelled = true;
    };
  }, [saveState.kind, refresh, session]);

  useEffect(
    () => () => {
      if (confirmTimer.current !== null) clearTimeout(confirmTimer.current);
    },
    [],
  );

  const run = useCallback(async (key: string, fn: () => Promise<void>) => {
    setBusy((b) => new Set(b).add(key));
    try {
      await fn();
    } finally {
      setBusy((b) => {
        const next = new Set(b);
        next.delete(key);
        return next;
      });
    }
  }, []);

  const open = (ref: DocRef) => {
    // A refusal means "unsaved changes on the open document": the shell shows the banner, nothing else happens here.
    void session.open(ref);
  };

  const submitNewFormat = () => {
    const name = (newName ?? '').trim();
    if (name === '' || busy.has('new')) return;
    void run('new', async () => {
      const id = uniqueSlug(name, new Set(formats.map((f) => f.id)));
      try {
        await api.createFormat(blankFormat(name, id));
        setNewName(null);
        await refresh();
        await session.open({ kind: 'format', id });
      } catch (err) {
        if (err instanceof ApiError && err.status === 409 && err.code === 'exists') setStatus(t('library.exists'));
        else setStatus(t('library.error', { code: codeOf(err) }));
      }
    });
  };

  const commitRename = () => {
    const r = renaming;
    if (r === null) return;
    setRenaming(null);
    const name = r.value.trim();
    if (name === '') return;
    void run(busyKey('rename', r.ref), async () => {
      if (isSame(snap.ref, r.ref)) {
        session.apply(renameDoc(name));
        return;
      }
      try {
        const doc = await api.getDoc(r.ref);
        await api.putDoc({ ...doc, name } as EditorDoc, r.ref.kind);
        await refresh();
      } catch (err) {
        setStatus(t('library.error', { code: codeOf(err) }));
      }
    });
  };

  const duplicate = (ref: DocRef, name: string) => {
    void run(busyKey('dup', ref), async () => {
      try {
        const doc = await api.getDoc(ref);
        const copyName = t('library.copySuffix', { name });
        const taken = new Set((ref.kind === 'format' ? formats : episodes).map((d) => d.id));
        const id = uniqueSlug(copyName, taken);
        const copy = { ...doc, id, name: copyName } as EditorDoc;
        if (ref.kind === 'format') await api.createFormat(copy as Format);
        else await api.putDoc(copy as Episode, 'episode');
        await refresh();
        await session.open({ kind: ref.kind, id });
      } catch (err) {
        setStatus(t('library.error', { code: codeOf(err) }));
      }
    });
  };

  const askDelete = (ref: DocRef) => {
    setConfirming(ref);
    if (confirmTimer.current !== null) clearTimeout(confirmTimer.current);
    confirmTimer.current = setTimeout(() => {
      setConfirming(null);
      confirmTimer.current = null;
    }, 4000);
  };

  const doDelete = (ref: DocRef) => {
    if (confirmTimer.current !== null) {
      clearTimeout(confirmTimer.current);
      confirmTimer.current = null;
    }
    setConfirming(null);
    void run(busyKey('del', ref), async () => {
      try {
        await api.deleteDoc(ref);
        if (isSame(snap.ref, ref)) session.forget();
        await refresh();
      } catch (err) {
        if (err instanceof ApiError && err.status === 409 && err.code === 'episode_loaded') setStatus(t('library.deleteLoaded'));
        else setStatus(t('library.error', { code: codeOf(err) }));
      }
    });
  };

  const load = (episode: Episode) => {
    void run(`load:${episode.id}`, async () => {
      const res = await session.loadForLive(episode.id);
      if (res.ok) {
        setStatus(t('library.loadedOk'));
        await refresh();
        await session.refreshLive();
      } else if (res.reason === 'invalid') setStatus(t('library.loadInvalid'));
      else if (res.reason === 'live_running') setStatus(t('library.loadLiveRunning'));
      else if (res.reason === 'unsaved') setStatus(t('library.loadUnsaved'));
      else setStatus(t('library.loadFailed', { code: res.reason }));
    });
  };

  const createEpisode = (format: Format, input: EpisodeInput) => {
    const id = uniqueSlug(`${format.name} ${input.date}`, new Set(episodes.map((e) => e.id)));
    const body: NewEpisodeBody = {
      id,
      date: input.date,
      plannedStart: input.time === '' ? null : toIsoWithOffset(input.date, input.time),
      playlistName: input.playlist.trim() === '' ? null : input.playlist.trim(),
    };
    void run('newEpisode', async () => {
      try {
        await api.createEpisode(format.id, body);
        setEpisodeFor(null);
        await refresh();
        await session.open({ kind: 'episode', id });
      } catch (err) {
        setStatus(t('library.error', { code: codeOf(err) }));
      }
    });
  };

  const tag = (episode: Episode): string | null => {
    const live = snap.live;
    if (live === null || live.episodeId !== episode.id) return null;
    return live.phase === 'live' ? t('library.onAir') : t('library.loaded');
  };

  const renameInput = (ref: DocRef, onKey: (e: KeyboardEvent<HTMLInputElement>) => void) => (
    <input
      className="ed-lib-rename"
      aria-label={t('library.nameLabel')}
      value={renaming?.value ?? ''}
      autoFocus
      onChange={(e) => setRenaming({ ref, value: e.target.value })}
      onKeyDown={onKey}
    />
  );

  const deleteButton = (ref: DocRef, name: string) => {
    const isConfirming = isSame(confirming, ref);
    return (
      <button
        type="button"
        className="ed-btn ed-btn-danger"
        disabled={busy.has(busyKey('del', ref))}
        onBlur={() => {
          if (isConfirming) setConfirming(null);
        }}
        onClick={() => (isConfirming ? doDelete(ref) : askDelete(ref))}
      >
        {isConfirming ? `${t('library.confirmDelete')} ${name}` : `${t('library.delete')} ${name}`}
      </button>
    );
  };

  return (
    <div className="ed-lib-panel">
      <h2>{t('library.title')}</h2>
      <nav aria-label={t('library.open')} className="ed-lib-nav">
        <a href="/dock" target="_blank" rel="noopener">
          {t('library.linkDock')}
        </a>
        <a href="/control" target="_blank" rel="noopener">
          {t('library.linkControl')}
        </a>
        <a href="/presenter" target="_blank" rel="noopener">
          {t('library.linkPresenter')}
        </a>
      </nav>

      <section className="ed-lib-section">
        <h3>{t('library.formats')}</h3>
        {newName === null ? (
          <button type="button" className="ed-btn" onClick={() => setNewName('')}>
            {t('library.newFormat')}
          </button>
        ) : (
          <div className="ed-lib-new">
            <input
              aria-label={t('library.nameLabel')}
              value={newName}
              autoFocus
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  submitNewFormat();
                } else if (e.key === 'Escape') {
                  setNewName(null);
                }
              }}
            />
            <button type="button" className="ed-btn" disabled={newName.trim() === '' || busy.has('new')} onClick={submitNewFormat}>
              {t('library.create')}
            </button>
            <button type="button" className="ed-btn" onClick={() => setNewName(null)}>
              {t('library.cancel')}
            </button>
          </div>
        )}
        <ul aria-label={t('library.formats')}>
          {formats.length === 0 ? (
            <li className="ed-lib-empty">{t('library.empty')}</li>
          ) : (
            formats.map((f) => {
              const ref: DocRef = { kind: 'format', id: f.id };
              return (
                <li key={f.id} data-testid={`fmt-${f.id}`} className="ed-lib-row">
                  {renaming !== null && isSame(renaming.ref, ref) ? (
                    renameInput(ref, (e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        commitRename();
                      } else if (e.key === 'Escape') {
                        setRenaming(null);
                      }
                    })
                  ) : (
                    <button type="button" className="ed-lib-name" aria-current={isSame(snap.ref, ref) ? 'true' : undefined} onClick={() => open(ref)}>
                      {f.name}
                    </button>
                  )}
                  <div className="ed-lib-actions">
                    <button type="button" className="ed-btn" onClick={() => setEpisodeFor(f)}>
                      {`${t('library.newEpisode')} ${f.name}`}
                    </button>
                    <button type="button" className="ed-btn" onClick={() => setRenaming({ ref, value: f.name })}>
                      {`${t('library.rename')} ${f.name}`}
                    </button>
                    <button type="button" className="ed-btn" disabled={busy.has(busyKey('dup', ref))} onClick={() => duplicate(ref, f.name)}>
                      {`${t('library.duplicate')} ${f.name}`}
                    </button>
                    {deleteButton(ref, f.name)}
                  </div>
                </li>
              );
            })
          )}
        </ul>
      </section>

      <section className="ed-lib-section">
        <h3>{t('library.episodes')}</h3>
        <ul aria-label={t('library.episodes')}>
          {episodes.length === 0 ? (
            <li className="ed-lib-empty">{t('library.empty')}</li>
          ) : (
            episodes.map((ep) => {
              const ref: DocRef = { kind: 'episode', id: ep.id };
              const current = tag(ep);
              return (
                <li key={ep.id} data-testid={`ep-${ep.id}`} className="ed-lib-row">
                  {renaming !== null && isSame(renaming.ref, ref) ? (
                    renameInput(ref, (e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        commitRename();
                      } else if (e.key === 'Escape') {
                        setRenaming(null);
                      }
                    })
                  ) : (
                    <button type="button" className="ed-lib-name" aria-current={isSame(snap.ref, ref) ? 'true' : undefined} onClick={() => open(ref)}>
                      {ep.name}
                    </button>
                  )}
                  {current !== null && <span className="ed-lib-tag">{current}</span>}
                  <div className="ed-lib-actions">
                    <button type="button" className="ed-btn" disabled={busy.has(`load:${ep.id}`)} onClick={() => load(ep)}>
                      {`${t('library.loadForLive')} ${ep.name}`}
                    </button>
                    <button type="button" className="ed-btn" onClick={() => setRenaming({ ref, value: ep.name })}>
                      {`${t('library.rename')} ${ep.name}`}
                    </button>
                    <button type="button" className="ed-btn" disabled={busy.has(busyKey('dup', ref))} onClick={() => duplicate(ref, ep.name)}>
                      {`${t('library.duplicate')} ${ep.name}`}
                    </button>
                    {deleteButton(ref, ep.name)}
                  </div>
                </li>
              );
            })
          )}
        </ul>
      </section>

      <p role="status" data-testid="lib-status">
        {status ?? ''}
      </p>

      {episodeFor !== null && (
        <NewEpisodeDialog format={episodeFor} now={now} onClose={() => setEpisodeFor(null)} onCreate={(input) => createEpisode(episodeFor, input)} />
      )}
    </div>
  );
}
