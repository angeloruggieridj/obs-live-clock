// SPDX-License-Identifier: GPL-2.0-or-later
import { useEffect, useState } from 'react';
import type { ApiClient, HotkeyPending } from '../../core/http';
import type { MessageKey } from '../../core/i18n';
import { useLive } from '../live-context';

export const HOTKEY_POLL_MS = 300;

const SLOT_KEY: Record<string, MessageKey> = {
  next: 'hotkeySlotNext',
  prev: 'hotkeySlotPrev',
  'time-plus': 'hotkeySlotTimePlus',
  'time-minus': 'hotkeySlotTimeMinus',
  'control-toggle': 'hotkeySlotControl',
};

/** Polls GET /api/hotkeys/pending. null while unknown or on error: no hint is better than a wrong one. */
export function useHotkeyPending(api: ApiClient, intervalMs = HOTKEY_POLL_MS): HotkeyPending | null {
  const [pending, setPending] = useState<HotkeyPending | null>(null);
  useEffect(() => {
    let alive = true;
    const poll = () => {
      api.hotkeyPending().then(
        (p) => {
          if (alive) setPending(p);
        },
        () => {
          if (alive) setPending(null);
        },
      );
    };
    poll();
    const handle = setInterval(poll, intervalMs);
    return () => {
      alive = false;
      clearInterval(handle);
    };
  }, [api, intervalMs]);
  return pending;
}

/** DT-9: after the first press of an emergency hotkey the dock says "press again to confirm". */
export function HotkeyHint({ api }: { api: ApiClient }) {
  const { t } = useLive();
  const pending = useHotkeyPending(api);
  if (pending === null) return null;
  const key = SLOT_KEY[pending.slot];
  return (
    <div className="hotkey-hint" role="alert">
      {t('hotkeyConfirm', { slot: key === undefined ? pending.slot : t(key) })}
    </div>
  );
}
