// SPDX-License-Identifier: GPL-2.0-or-later
import type { Lang } from '../core/i18n';

const REGIONS = ['library', 'timeline', 'properties', 'settings', 'validation'] as const;

export function EditorApp(props: { lang: Lang }) {
  return (
    <div className="ed-root" lang={props.lang}>
      {REGIONS.map((r) => (
        <section key={r} className={`ed-region ed-${r}`} data-testid={`region-${r}`} />
      ))}
    </div>
  );
}
