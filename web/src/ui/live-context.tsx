// SPDX-License-Identifier: GPL-2.0-or-later
import { createContext, useContext, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import type { ClientRole } from '@olc/shared';
import type { FrameLoop } from '../core/frame-loop';
import { createT, type Lang, type Translate } from '../core/i18n';
import type { ClientSnapshot, LiveStore } from '../core/ws-client';

export interface LiveContextValue {
  store: LiveStore<ClientRole>;
  frames: FrameLoop;
  lang: Lang;
  t: Translate;
  /** IANA zone for wall times; undefined means the browser's own (tests pass 'UTC'). */
  timeZone: string | undefined;
}

const LiveContext = createContext<LiveContextValue | null>(null);

export function LiveProvider(props: {
  store: LiveStore<ClientRole>;
  frames: FrameLoop;
  lang?: Lang;
  timeZone?: string;
  children: ReactNode;
}) {
  const { store, frames, lang = 'it', timeZone, children } = props;
  const value = useMemo(() => ({ store, frames, lang, t: createT(lang), timeZone }), [store, frames, lang, timeZone]);
  return <LiveContext.Provider value={value}>{children}</LiveContext.Provider>;
}

export function useLive(): LiveContextValue {
  const value = useContext(LiveContext);
  if (value === null) throw new Error('useLive() outside <LiveProvider>');
  return value;
}

/** The client snapshot; re-renders only when the client publishes a new one. Works in SSR (server snapshot). */
export function useSnapshot<R extends ClientRole = ClientRole>(): ClientSnapshot<R> {
  const { store } = useLive();
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot) as ClientSnapshot<R>;
}

/**
 * A discrete value derived from time (a screen mode, a tally): recomputed on every frame, but React re-renders
 * only when it changes. Each render recomputes it too, so a new view is reflected without waiting for a frame.
 */
export function useFrameValue<T extends string | number | boolean | null>(compute: () => T): T {
  const { frames } = useLive();
  const latest = useRef(compute);
  latest.current = compute;
  const current = compute();
  const shown = useRef(current);
  shown.current = current;
  const [, force] = useState(0);
  useLayoutEffect(
    () =>
      frames.subscribe(() => {
        const next = latest.current();
        if (!Object.is(next, shown.current)) {
          shown.current = next;
          force((n) => n + 1);
        }
      }),
    [frames],
  );
  return current;
}
