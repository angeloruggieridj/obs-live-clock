// SPDX-License-Identifier: GPL-2.0-or-later
import { useLayoutEffect, useRef } from 'react';
import { STALE_BLANK_MS, type AnchorFrame } from '../core/anchor';
import type { Translate } from '../core/i18n';
import { durationText, signedText, wallText } from '../core/time-format';
import type { PresenterView } from '../core/views';
import { AnchoredProgress } from '../ui/AnchoredProgress';
import { AnchoredTime } from '../ui/AnchoredTime';
import { AnchoredWall } from '../ui/AnchoredWall';
import { ConnectionOverlay } from '../ui/ConnectionOverlay';
import { SourceBadge } from '../ui/SourceBadge';
import { useFrameValue, useLive, useSnapshot } from '../ui/live-context';
import { mainAnchor, mainTally, returnTicks, screenMode, showSide, type ScreenMode } from './presenter-model';

/** SPEC §7 presenter monitor. Structure re-renders only on view/snapshot/mode changes; counters repaint per frame. */
export function PresenterScreen() {
  const { store } = useLive();
  const snap = useSnapshot<'presenter'>();
  const view = snap.view;
  const ready = snap.hasView && snap.synced;
  const staleAt = snap.stale && snap.staleSince !== null ? snap.staleSince : null;
  const prevReturn = useRef<number | null>(null);
  const mode = useFrameValue<ScreenMode>(() => {
    const now = store.serverNow();
    // Past STALE_BLANK_MS the data is dead: the return ticks become null, so a full-screen RIENTRO IMMINENTE
    // never stays up on data that no longer moves (the counters blank at the same instant, via anchorFrame).
    const blank = snap.stale && (staleAt === null || now === null || now - staleAt > STALE_BLANK_MS);
    const ticks = now === null || blank ? null : returnTicks(view, staleAt ?? now, prevReturn.current);
    prevReturn.current = ticks;
    return screenMode(view, ready, ticks);
  });

  if (mode === 'waiting') {
    return (
      <div className="p-root" data-mode="waiting">
        <ConnectionOverlay />
      </div>
    );
  }
  return (
    <div className="p-root" data-mode={mode}>
      {mode === 'imminent' && view !== null ? (
        <ImminentTile view={view} seedTicks={prevReturn.current} />
      ) : (
        <>
          <MainTile view={view} mode={mode} />
          {showSide(mode) && view !== null ? <SideTiles view={view} mode={mode} /> : null}
        </>
      )}
      {view?.message ? (
        <div className="p-msg" role="status" aria-live="polite">
          {view.message.text}
        </div>
      ) : null}
      <StatusStrip view={view} />
      <ConnectionOverlay />
    </div>
  );
}

function mainLabel(view: PresenterView | null, mode: ScreenMode, t: Translate): string {
  switch (mode) {
    case 'preshow':
      return t('programStart');
    case 'studio':
      return view?.block ? t('block', { n: view.block.index + 1, name: view.block.name }) : t('blockRemaining');
    case 'media':
    case 'break':
      return t('returnIn');
    case 'overrun':
      return t('rundownFinished');
    case 'ended':
      return t('ended');
    default:
      return t('noEpisode');
  }
}

function MainTile({ view, mode }: { view: PresenterView | null; mode: ScreenMode }) {
  const { t, timeZone } = useLive();
  const tileRef = useRef<HTMLElement>(null);
  const anchor = mainAnchor(view, mode);
  const tally = (frame: AnchorFrame) => mainTally(view, mode, frame.ticks);
  const plannedStart = view?.preshow?.plannedStart ?? null;
  // React owns data-tally: the frame loop writes it imperatively (AnchoredTime), so a mode without a writer
  // (ended / noepisode / any screen with no main anchor) must reset what the loop left behind on the way in.
  useLayoutEffect(() => {
    const el = tileRef.current;
    if (el !== null && anchor === null) el.dataset.tally = 'none';
  }, [mode, anchor]);
  return (
    <section className="tile p-main" ref={tileRef} data-tally="none">
      <div className="label">
        <span className="label-text">{mainLabel(view, mode, t)}</span>
        {anchor !== null ? <SourceBadge anchor={anchor} /> : null}
      </div>
      {anchor !== null ? <AnchoredTime anchor={anchor} className="counter p-main-counter" tally={tally} tallyRef={tileRef} /> : null}
      {mode === 'studio' && view?.block ? <div className="caption">{t('blockRemaining')}</div> : null}
      {mode === 'preshow' && plannedStart !== null ? (
        <div className="caption">{t('plannedAt', { time: wallText(Date.parse(plannedStart), timeZone) })}</div>
      ) : null}
      {(mode === 'media' || mode === 'break') && view?.onAir ? <OnAirRow view={view} mode={mode} /> : null}
      {mode === 'ended' ? <EndedSummary view={view} /> : null}
    </section>
  );
}

function OnAirRow({ view, mode }: { view: PresenterView; mode: 'media' | 'break' }) {
  const { t } = useLive();
  const onAir = view.onAir!;
  return (
    <div className="p-onair">
      <div className="p-onair-head">
        <span className="label-text">{t(mode === 'media' ? 'onAirMedia' : 'onAirBreak', { title: onAir.title })}</span>
        <SourceBadge anchor={onAir.anchor} />
        <AnchoredTime anchor={onAir.anchor} className="counter p-onair-counter" />
      </div>
      <AnchoredProgress anchor={onAir.anchor} durationMs={onAir.durationMs} />
      {view.returnTo ? <div className="p-return label-text">{t('returnTo', { name: view.returnTo.blockName })}</div> : null}
    </div>
  );
}

function EndedSummary({ view }: { view: PresenterView | null }) {
  const { t } = useLive();
  const ended = view?.ended ?? null;
  const total = ended === null ? '—' : durationText(ended.totalMs);
  return (
    <>
      <div className="counter p-main-counter p-ended-total" data-len={total.length}>
        {total}
      </div>
      <div className="caption">
        {t('endedOffset', { d: ended === null ? '—' : signedText(ended.finalOffsetMs) })}
        {ended !== null ? <SourceBadge source={ended.source} /> : null}
      </div>
    </>
  );
}

function SideTiles({ view, mode }: { view: PresenterView; mode: ScreenMode }) {
  const { t, timeZone } = useLive();
  if (mode === 'preshow') {
    const preshow = view.preshow;
    return (
      <aside className="p-side p-side-single">
        <section className="tile">
          <div className="label">
            <span className="label-text">{t('rundown')}</span>
          </div>
          <ol className="p-upcoming">
            {(preshow?.upcoming ?? []).map((title, i) => (
              <li key={`${i}-${title}`} className="label-text">
                {title}
              </li>
            ))}
          </ol>
          <div className="caption">{t('totalDuration', { d: preshow === null ? '—' : durationText(preshow.totalDurationMs) })}</div>
        </section>
      </aside>
    );
  }
  const { next, programEnd } = view;
  return (
    <aside className="p-side">
      <section className="tile p-next">
        <div className="label">
          <span className="label-text">{t('next')}</span>
        </div>
        <div className="p-next-title">{next === null ? '—' : next.title}</div>
        {next !== null ? (
          <div className="p-next-dur">
            {durationText(next.durationMs)}
            <SourceBadge source={next.source} />
          </div>
        ) : null}
      </section>
      <section className="tile p-end">
        <div className="label">
          <span className="label-text">{t('programEnd')}</span>
          {programEnd !== null ? <SourceBadge anchor={programEnd.anchor} /> : null}
        </div>
        {programEnd !== null ? (
          <>
            <AnchoredTime anchor={programEnd.anchor} className="counter p-side-counter" />
            <div className="p-end-wall">{programEnd.endsAtWall === null ? '—' : wallText(programEnd.endsAtWall, timeZone)}</div>
          </>
        ) : (
          <div className="counter p-side-counter">—</div>
        )}
      </section>
    </aside>
  );
}

function ImminentTile({ view, seedTicks }: { view: PresenterView; seedTicks: number | null }) {
  const { t } = useLive();
  const ret = view.returnTo!;
  return (
    <section className="tile p-imminent" data-tally="imminent">
      <div className="label">
        <span className="label-text">{t('returnImminent')}</span>
        <SourceBadge anchor={ret.anchor} />
      </div>
      <AnchoredTime anchor={ret.anchor} className="counter p-imminent-counter" seedTicks={seedTicks} />
      <div className="p-return label-text">{t('returnTo', { name: ret.blockName })}</div>
    </section>
  );
}

function StatusStrip({ view }: { view: PresenterView | null }) {
  const { t } = useLive();
  return (
    <footer className="p-strip">
      <AnchoredWall className="p-wall" />
      {view !== null ? (
        <>
          <span className="p-out" data-on={String(view.status.rec)}>
            {view.status.recPaused ? `${t('rec')} ${t('paused')}` : t('rec')}
          </span>
          <span className="p-out" data-on={String(view.status.stream)}>
            {t('onAir')}
          </span>
          {view.phase === 'live' ? (
            <span className="p-delay">
              {`${t('delay')} ${view.delay === null ? '—' : signedText(view.delay.ms)}`}
              {view.delay !== null ? <SourceBadge source={view.delay.source} showPlanned /> : null}
            </span>
          ) : null}
          <span className="p-obs" data-ok={String(view.status.obs === 'ok')}>
            {view.status.obs === 'ok' ? t('obsOk') : t('obsLost')}
          </span>
        </>
      ) : null}
    </footer>
  );
}
