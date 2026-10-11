// SPDX-License-Identifier: GPL-2.0-or-later
import { useEffect } from 'react';
import { useLive, useSnapshot } from './live-context';

/**
 * Connection states the screen must not hide (SPEC §15: "RICONNESSIONE…", never old data shown as current).
 * An incompatible server means this page is older than the server: reload it (kiosk pages run unattended).
 */
export function ConnectionOverlay({ reload = () => location.reload(), reloadAfterMs = 10_000 }: { reload?: () => void; reloadAfterMs?: number }) {
  const { t } = useLive();
  const snap = useSnapshot();
  const incompatible = snap.connection === 'incompatible';

  useEffect(() => {
    if (!incompatible) return undefined;
    const handle = setTimeout(reload, reloadAfterMs);
    return () => clearTimeout(handle);
  }, [incompatible, reload, reloadAfterMs]);

  if (incompatible) {
    return (
      <div className="overlay overlay-full" role="alert">
        {t('incompatible')}
      </div>
    );
  }
  if (!snap.hasView || !snap.synced) {
    return (
      <div className="overlay overlay-full" role="status" aria-live="polite">
        {t('connecting')}
      </div>
    );
  }
  if (snap.stale) {
    return (
      <div className="overlay overlay-stale" role="alert">
        {t('reconnecting')}
      </div>
    );
  }
  return null;
}
