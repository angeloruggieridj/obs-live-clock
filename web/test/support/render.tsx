// SPDX-License-Identifier: GPL-2.0-or-later
import { act, render } from '@testing-library/react';
import type { ReactElement } from 'react';
import type { ClientRole } from '@olc/shared';
import type { Lang } from '../../src/core/i18n';
import type { ClientSnapshot, LiveStore } from '../../src/core/ws-client';
import { LiveProvider } from '../../src/ui/live-context';
import { ManualFrameLoop } from './frames';
import type { StaticStore } from './store';

/** Renders `ui` inside a LiveProvider (Italian, UTC wall times) driven by a manual frame loop. */
export function renderLive<R extends ClientRole>(ui: ReactElement, store: StaticStore<R>, lang: Lang = 'it') {
  const frames = new ManualFrameLoop();
  const wrap = (node: ReactElement) => (
    <LiveProvider store={store as unknown as LiveStore<ClientRole>} frames={frames} lang={lang} timeZone="UTC">
      {node}
    </LiveProvider>
  );
  const utils = render(wrap(ui));
  return {
    ...utils,
    frames,
    rerender: (next: ReactElement) => utils.rerender(wrap(next)),
    /** Moves server time forward and runs one animation frame. */
    advance(ms: number) {
      act(() => {
        store.now = (store.now ?? 0) + ms;
        frames.frame();
      });
    },
    /** Publishes a new client snapshot. */
    update(patch: Partial<ClientSnapshot<R>>) {
      act(() => store.set(patch));
    },
  };
}
