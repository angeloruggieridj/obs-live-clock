// SPDX-License-Identifier: GPL-2.0-or-later
import type { Anchor, Source } from '../core/views';
import { useLive } from './live-context';

/** NF1 badges: STIMATO for estimated values, PIAN. for planned ones (only where asked), PAUSA for frozen anchors. */
export function SourceBadge({ anchor, source, showPlanned = false }: { anchor?: Anchor | null; source?: Source | null; showPlanned?: boolean }) {
  const { t } = useLive();
  const src = source ?? (anchor !== undefined && anchor !== null && anchor.kind !== 'unknown' ? anchor.source : null);
  const paused = anchor?.kind === 'frozen';
  return (
    <>
      {src === 'estimated' ? <span className="badge badge-estimated">{t('estimated')}</span> : null}
      {src === 'planned' && showPlanned ? <span className="badge badge-planned">{t('planned')}</span> : null}
      {paused ? <span className="badge badge-paused">{t('paused')}</span> : null}
    </>
  );
}
