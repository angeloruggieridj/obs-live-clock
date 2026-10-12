// SPDX-License-Identifier: GPL-2.0-or-later
import { createContext, useContext, useMemo, useSyncExternalStore, type ReactNode } from 'react';
import type { Lang } from '../../core/i18n';
import type { EditorDoc } from '../api/editor-api';
import { createEditorT, type EditorT } from '../i18n';
import type { SaveState } from '../store/autosave';
import type { StoreSnapshot } from '../store/document-store';
import type { EditorSession, SessionSnapshot } from './session';
import type { SelectionSnapshot } from './selection';

interface Value {
  session: EditorSession;
  t: EditorT;
}
const Ctx = createContext<Value | null>(null);

export function EditorProvider(props: { session: EditorSession; lang: Lang; children: ReactNode }) {
  const t = useMemo(() => createEditorT(props.lang), [props.lang]);
  const value = useMemo(() => ({ session: props.session, t }), [props.session, t]);
  return <Ctx.Provider value={value}>{props.children}</Ctx.Provider>;
}

function useValue(): Value {
  const v = useContext(Ctx);
  if (v === null) throw new Error('EditorProvider is missing');
  return v;
}

export const useSession = (): EditorSession => useValue().session;
export const useEditorT = (): EditorT => useValue().t;

export function useStore(): StoreSnapshot<EditorDoc | null> {
  const { store } = useValue().session;
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}
export const useDoc = (): EditorDoc | null => useStore().doc;

export function useSaveState(): SaveState {
  const { autosave } = useValue().session;
  return useSyncExternalStore(autosave.subscribe, autosave.getState, autosave.getState);
}
export function useSessionSnapshot(): SessionSnapshot {
  const s = useValue().session;
  return useSyncExternalStore(s.subscribe, s.getSnapshot, s.getSnapshot);
}
export function useSelection(): SelectionSnapshot {
  const { selection } = useValue().session;
  return useSyncExternalStore(selection.subscribe, selection.getSnapshot, selection.getSnapshot);
}
