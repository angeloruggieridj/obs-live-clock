// SPDX-License-Identifier: GPL-2.0-or-later
import type { Lang } from '../../core/i18n';
import { EN_IMPORT, IT_IMPORT } from './import';
import { EN_LIBRARY, IT_LIBRARY } from './library';
import { EN_PROPS, IT_PROPS } from './props';
import { EN_SETTINGS, IT_SETTINGS } from './settings';
import { EN_SHELL, IT_SHELL } from './shell';
import { EN_TIMELINE, IT_TIMELINE } from './timeline';
import { EN_VALIDATION, IT_VALIDATION } from './validation';

/** One dictionary module per feature, so parallel tasks never edit the same file. */
export const EDITOR_MODULES = {
  shell: { it: IT_SHELL, en: EN_SHELL },
  library: { it: IT_LIBRARY, en: EN_LIBRARY },
  timeline: { it: IT_TIMELINE, en: EN_TIMELINE },
  props: { it: IT_PROPS, en: EN_PROPS },
  settings: { it: IT_SETTINGS, en: EN_SETTINGS },
  import: { it: IT_IMPORT, en: EN_IMPORT },
  validation: { it: IT_VALIDATION, en: EN_VALIDATION },
} as const;

const IT = { ...IT_SHELL, ...IT_LIBRARY, ...IT_TIMELINE, ...IT_PROPS, ...IT_SETTINGS, ...IT_IMPORT, ...IT_VALIDATION } as const;
export type EditorKey = keyof typeof IT;
const EN: Record<EditorKey, string> = { ...EN_SHELL, ...EN_LIBRARY, ...EN_TIMELINE, ...EN_PROPS, ...EN_SETTINGS, ...EN_IMPORT, ...EN_VALIDATION };

export type EditorT = (key: EditorKey, params?: Record<string, string | number>) => string;

/** `{name}` placeholders take `params.name`; a missing parameter stays visible so a bug cannot hide. */
export function createEditorT(lang: Lang): EditorT {
  const dict: Record<string, string> = lang === 'en' ? EN : IT;
  return (key, params = {}) =>
    (dict[key] ?? key).replace(/\{(\w+)\}/g, (whole, name: string) => (name in params ? String(params[name]) : whole));
}
