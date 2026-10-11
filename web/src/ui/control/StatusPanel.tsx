// SPDX-License-Identifier: GPL-2.0-or-later
import { useLayoutEffect, useRef } from 'react';
import type { AnchorFrame } from '../../core/anchor';
import type { MessageKey, Translate } from '../../core/i18n';
import { durationText, signedText, wallText } from '../../core/time-format';
import type { ControlView, PresenterView } from '../../core/views';
import { baseMode, mainAnchor, mainTally, type ScreenMode } from '../../presenter/presenter-model';
import { AnchoredTime } from '../AnchoredTime';
import { SourceBadge } from '../SourceBadge';
import { useLive } from '../live-context';

export function phaseKey(p: PresenterView): MessageKey {
  if (p.phase === 'preshow') return 'phasePreshow';
  if (p.phase === 'ended') return 'phaseEnded';
  return p.rundownFinished ? 'phaseOverrun' : 'phaseLive';
}

const SEGMENT_KEY = { studio: 'segStudio', media: 'segMedia', break: 'segBreak' } as const;

function currentTitle(p: PresenterView, mode: ScreenMode, t: Translate): string {
  switch (mode) {
    case 'preshow':
      return t('programStart');
    case 'studio':
      return p.block ? t('block', { n: p.block.index + 1, name: p.block.name }) : '—';
    case 'media':
    case 'break':
      return p.onAir ? t('onAirNow', { title: p.onAir.title }) : t('returnIn');
    case 'overrun':
      return t('rundownFinished');
    case 'ended':
      return p.ended ? `${t('ended')} ${durationText(p.ended.totalMs)} · ${t('endedOffset', { d: signedText(p.ended.finalOffsetMs) })}` : t('ended');
    default:
      return '';
  }
}

/** Compact live status for the dock and the control view (SPEC §8). Same tally rule as the presenter. */
export function StatusPanel({ view }: { view: ControlView }) {
  const { t, timeZone } = useLive();
  const p = view.presenter;
  const panelRef = useRef<HTMLElement>(null);
  const mode = baseMode(p, true);
  const anchor = mainAnchor(p, mode);
  const tally = (frame: AnchorFrame) => mainTally(p, mode, frame.ticks);
  const live = p.phase === 'live';
  // React owns data-tally: the frame loop writes it imperatively through AnchoredTime, so a mode with no
  // main anchor (ended / noepisode) must reset what the loop left behind on the way in (same as the presenter).
  useLayoutEffect(() => {
    const el = panelRef.current;
    if (el !== null && anchor === null) el.dataset.tally = 'none';
  }, [mode, anchor]);
  return (
    <section className="panel status" ref={panelRef} data-tally="none">
      <div className="status-badges">
        <span className="badge-phase">{t(phaseKey(p))}</span>
        {live && p.segment !== null ? <span className="badge-segment">{t(SEGMENT_KEY[p.segment])}</span> : null}
        {view.control === 'manual' ? <span className="badge-manual">{t('manual')}</span> : null}
        <span className="status-obs" data-ok={String(view.obs === 'ok')}>
          {view.obs === 'ok' ? t('obsOk') : t('obsLost')}
        </span>
      </div>
      <div className="status-current">
        <span className="label-text status-title">{currentTitle(p, mode, t)}</span>
        {anchor !== null ? <SourceBadge anchor={anchor} /> : null}
        {anchor !== null ? <AnchoredTime anchor={anchor} className="counter status-counter" tally={tally} tallyRef={panelRef} /> : null}
      </div>
      {(mode === 'media' || mode === 'break') && p.returnTo ? (
        <div className="label-text status-return">{t('returnTo', { name: p.returnTo.blockName })}</div>
      ) : null}
      <div className="status-row">
        <span className="status-delay">
          {`${t('delay')} ${live && p.delay !== null ? signedText(p.delay.ms) : '—'}`}
          {live && p.delay !== null ? <SourceBadge source={p.delay.source} showPlanned /> : null}
        </span>
        <span className="status-end">
          {`${t('programEnd')} `}
          {p.programEnd !== null ? (
            <>
              <AnchoredTime anchor={p.programEnd.anchor} className="counter" />
              {` · ${p.programEnd.endsAtWall === null ? '—' : wallText(p.programEnd.endsAtWall, timeZone)}`}
            </>
          ) : (
            '—'
          )}
        </span>
      </div>
    </section>
  );
}
