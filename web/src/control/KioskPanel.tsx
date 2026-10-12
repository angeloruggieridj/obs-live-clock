// SPDX-License-Identifier: GPL-2.0-or-later
import { useCallback, useEffect, useState } from 'react';
import type { ApiClient, KioskConfig, KioskScreenChoice, KioskStatusLite, ScreenLite } from '../core/http';
import type { MessageKey } from '../core/i18n';
import { useLive } from '../ui/live-context';

export const KIOSK_POLL_MS = 5_000;

const STATE_KEY: Record<string, MessageKey> = {
  disabled: 'kioskStateDisabled',
  stopped: 'kioskStateStopped',
  running: 'kioskStateRunning',
  restarting: 'kioskStateRestarting',
  waiting_for_screens: 'kioskStateWaiting',
  screen_missing: 'kioskStateScreenMissing',
  browser_not_found: 'kioskStateBrowserMissing',
  spawn_failed: 'kioskStateSpawnFailed',
  suspended: 'kioskStateSuspended',
  handed_off: 'kioskStateHandedOff',
};

const PRIMARY = 'primary';
const FIXED = 'fixed';
const nameValue = (name: string) => `name:${name}`;
const choiceValue = (c: KioskScreenChoice) => (c.kind === 'primary' ? PRIMARY : c.kind === 'name' ? nameValue(c.name) : FIXED);

/** TECH-DESIGN §9 / SPEC §7: choose the monitor of the presenter and open or close it. Lives in the extended view. */
export function KioskPanel({ api }: { api: ApiClient }) {
  const { t } = useLive();
  const [config, setConfig] = useState<KioskConfig | null>(null);
  const [draft, setDraft] = useState<KioskConfig | null>(null);
  const [screens, setScreens] = useState<ScreenLite[]>([]);
  const [status, setStatus] = useState<KioskStatusLite | null>(null);
  const [failed, setFailed] = useState(false);

  const refresh = useCallback(() => {
    api.kioskStatus().then(setStatus, () => setStatus(null));
    api.screens().then((s) => setScreens(s.screens), () => setScreens([]));
  }, [api]);

  useEffect(() => {
    let alive = true;
    api.kioskConfig().then(
      (c) => {
        if (!alive) return;
        setConfig(c);
        setDraft(c);
      },
      () => {},
    );
    refresh();
    const handle = setInterval(refresh, KIOSK_POLL_MS);
    return () => {
      alive = false;
      clearInterval(handle);
    };
  }, [api, refresh]);

  if (draft === null) return null;
  const dirty = JSON.stringify(draft) !== JSON.stringify(config);
  const current = choiceValue(draft.screen);
  const known = new Set(screens.map((s) => s.name));
  const missing = draft.screen.kind === 'name' && !known.has(draft.screen.name) ? draft.screen.name : null;

  const choose = (value: string) => {
    if (value === PRIMARY) setDraft({ ...draft, screen: { kind: 'primary' } });
    else if (value.startsWith('name:')) setDraft({ ...draft, screen: { kind: 'name', name: value.slice(5) } });
  };
  const save = () => {
    setFailed(false);
    api.saveKioskConfig(draft).then(
      (saved) => {
        setConfig(saved);
        setDraft(saved);
        refresh();
      },
      () => setFailed(true),
    );
  };
  const act = (action: 'start' | 'stop' | 'restart') => () => void api.kioskAction(action).then(setStatus, () => {});

  return (
    <section className="panel kiosk">
      <h2 className="panel-title">{t('kioskTitle')}</h2>
      <label className="kiosk-row">
        <input type="checkbox" checked={draft.enabled} onChange={(e) => setDraft({ ...draft, enabled: e.target.checked })} />
        {t('kioskEnabled')}
      </label>
      <label className="kiosk-row">
        <input type="checkbox" checked={draft.restart} onChange={(e) => setDraft({ ...draft, restart: e.target.checked })} />
        {t('kioskReopen')}
      </label>
      <label className="kiosk-row">
        {t('kioskScreen')}
        <select value={current} onChange={(e) => choose(e.target.value)}>
          <option value={PRIMARY}>{t('kioskScreenPrimary')}</option>
          {screens.map((s) => (
            <option key={s.name} value={nameValue(s.name)}>
              {t('kioskScreenNamed', { name: s.name, w: s.width, h: s.height })}
            </option>
          ))}
          {missing !== null ? <option value={nameValue(missing)}>{t('kioskScreenMissing', { name: missing })}</option> : null}
          {draft.screen.kind === 'position' ? (
            <option value={FIXED}>{t('kioskScreenFixed', { x: draft.screen.x, y: draft.screen.y })}</option>
          ) : null}
        </select>
      </label>
      {status !== null ? (
        <div className="kiosk-status" data-state={status.state}>
          {t('kioskStatus', { state: STATE_KEY[status.state] === undefined ? status.state : t(STATE_KEY[status.state]!) })}
        </div>
      ) : null}
      {failed ? <div className="alert">{t('kioskSaveFailed')}</div> : null}
      <div className="kiosk-actions">
        <button type="button" disabled={!dirty} onClick={save}>
          {t('kioskSave')}
        </button>
        <button type="button" onClick={act('start')}>
          {t('kioskStart')}
        </button>
        <button type="button" onClick={act('restart')}>
          {t('kioskRestartNow')}
        </button>
        <button type="button" onClick={act('stop')}>
          {t('kioskStop')}
        </button>
      </div>
    </section>
  );
}
