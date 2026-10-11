// SPDX-License-Identifier: GPL-2.0-or-later
import { LANGS, type Lang } from './i18n';

export interface PageParams {
  lang: Lang;
  /** Opaque screen label for the kiosk (Plan 6); only shown in the document title. */
  screen: string | null;
}

export function parseParams(search: string): PageParams {
  const q = new URLSearchParams(search);
  const lang = q.get('lang');
  const screen = q.get('screen');
  return {
    lang: (LANGS as readonly string[]).includes(lang ?? '') ? (lang as Lang) : 'it',
    screen: screen !== null && /^[A-Za-z0-9_-]{1,32}$/.test(screen) ? screen : null,
  };
}
