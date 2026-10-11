// SPDX-License-Identifier: GPL-2.0-or-later

interface SentinelLike {
  readonly released: boolean;
  release(): Promise<void>;
}

/** The part of `navigator` used here; `wakeLock` is missing outside secure contexts (e.g. plain http on a LAN IP). */
export interface WakeLockNavigator {
  wakeLock?: { request(type: 'screen'): Promise<SentinelLike> };
}

type VisibilityDoc = Pick<Document, 'visibilityState' | 'addEventListener' | 'removeEventListener'>;

/**
 * Keeps the kiosk screen on (TECH-DESIGN §8). The browser drops the lock whenever the page is hidden, so it is
 * taken again on every visibility change. Failures are reported and otherwise ignored. Returns a stop function.
 */
export function keepScreenAwake(
  nav: WakeLockNavigator = navigator as unknown as WakeLockNavigator,
  doc: VisibilityDoc = document,
  report: (err: unknown) => void = (err) => console.warn('Screen Wake Lock unavailable', err),
): () => void {
  const api = nav.wakeLock;
  if (api === undefined) return () => {};
  let sentinel: SentinelLike | null = null;
  let stopped = false;
  const acquire = () => {
    if (stopped || doc.visibilityState !== 'visible' || (sentinel !== null && !sentinel.released)) return;
    api.request('screen').then((s) => {
      if (stopped) void s.release();
      else sentinel = s;
    }, report);
  };
  doc.addEventListener('visibilitychange', acquire);
  acquire();
  return () => {
    stopped = true;
    doc.removeEventListener('visibilitychange', acquire);
    if (sentinel !== null) void sentinel.release().catch(report);
  };
}
