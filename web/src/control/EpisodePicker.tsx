// SPDX-License-Identifier: GPL-2.0-or-later
import { useCallback, useEffect, useState } from 'react';
import { ApiError, type ApiClient, type EpisodeSummary } from '../core/http';
import { useLive } from '../ui/live-context';

/** Minimal rehearsal loader (the editor is Plan 5): list the saved episodes and load one for the live. */
export function EpisodePicker({ api, loadedId }: { api: ApiClient; loadedId: string | null }) {
  const { t } = useLive();
  const [episodes, setEpisodes] = useState<EpisodeSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const codeOf = (err: unknown) => (err instanceof ApiError ? err.code : 'network');

  const refresh = useCallback(() => {
    api.listEpisodes().then(
      (list) => {
        setEpisodes(list);
        setError(null);
      },
      (err: unknown) => setError(t('loadFailed', { code: codeOf(err) })),
    );
  }, [api, t]);
  useEffect(() => {
    refresh();
  }, [refresh]);

  const load = async (id: string) => {
    try {
      await api.loadEpisode(id);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError && err.code === 'live_running' ? t('liveRunning') : t('loadFailed', { code: codeOf(err) }));
    }
  };

  return (
    <section className="panel episodes">
      <h2 className="panel-title">{t('episodes')}</h2>
      <button type="button" className="refresh" onClick={refresh}>
        {t('refresh')}
      </button>
      {error !== null ? (
        <div className="alert" role="alert">
          {error}
        </div>
      ) : null}
      {episodes !== null && episodes.length === 0 ? <div className="empty">{t('noEpisodes')}</div> : null}
      <ul className="episode-list">
        {(episodes ?? []).map((ep) => (
          <li key={ep.id} data-loaded={String(ep.id === loadedId)}>
            <span className="label-text">{ep.name}</span>
            <span className="episode-date">{ep.date}</span>
            <button type="button" disabled={ep.id === loadedId} onClick={() => void load(ep.id)}>
              {t('load')}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
