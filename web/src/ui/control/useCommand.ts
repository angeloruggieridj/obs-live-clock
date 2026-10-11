// SPDX-License-Identifier: GPL-2.0-or-later
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ClientCommand } from '@olc/shared';
import { CommandError } from '../../core/ws-client';
import { useLive } from '../live-context';

export const FEEDBACK_MS = 3_000;

export type Feedback = { kind: 'idle' } | { kind: 'noEffect' } | { kind: 'error'; code: string };

/** Sends a command and turns `ack.changed === false` and errors into visible feedback (BACKLOG Plan 4). */
export function useCommand(): { run: (command: ClientCommand) => Promise<boolean>; feedback: Feedback } {
  const { store } = useLive();
  const [feedback, setFeedback] = useState<Feedback>({ kind: 'idle' });
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current);
    },
    [],
  );
  const show = useCallback((next: Feedback) => {
    setFeedback(next);
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = setTimeout(() => setFeedback({ kind: 'idle' }), FEEDBACK_MS);
  }, []);
  const clear = useCallback(() => {
    if (timer.current !== null) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    setFeedback({ kind: 'idle' });
  }, []);
  const run = useCallback(
    async (command: ClientCommand): Promise<boolean> => {
      clear(); // a new command removes the previous feedback, so no stale "Nessun effetto" sits next to it
      try {
        const { changed } = await store.sendCommand(command);
        if (!changed) show({ kind: 'noEffect' });
        return changed;
      } catch (err) {
        show({ kind: 'error', code: err instanceof CommandError ? err.code : 'internal' });
        return false;
      }
    },
    [store, show, clear],
  );
  return { run, feedback };
}
