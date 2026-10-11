// SPDX-License-Identifier: GPL-2.0-or-later
import { stableTicks } from '../core/stable-ticks';
import type { Anchor, PresenterView } from '../core/views';

export type ScreenMode = 'waiting' | 'noepisode' | 'preshow' | 'studio' | 'media' | 'break' | 'imminent' | 'overrun' | 'ended';
export type Tally = 'none' | 'warn' | 'over' | 'imminent';

const UNKNOWN: Anchor = { kind: 'unknown' };

/** The mode from the view alone (SPEC §12). `ready`: a view has arrived and the server clock is synced. */
export function baseMode(view: PresenterView | null, ready: boolean): ScreenMode {
  if (!ready) return 'waiting';
  if (view === null) return 'noepisode';
  if (view.phase === 'preshow') return 'preshow';
  if (view.phase === 'ended') return 'ended';
  if (view.rundownFinished) return 'overrun';
  if (view.segment === 'media') return 'media';
  if (view.segment === 'break') return 'break';
  return 'studio';
}

/** PRE-SHOW: countdown to the planned start, counting up past it; "—" without a planned start. */
export function preshowAnchor(view: PresenterView): Anchor {
  const iso = view.preshow?.plannedStart ?? null;
  const at = iso === null ? Number.NaN : Date.parse(iso);
  return Number.isFinite(at) ? { kind: 'countdown', endsAt: at, source: 'planned' } : UNKNOWN;
}

/** The anchor the main counter shows in each mode; null when the mode has no main counter. */
export function mainAnchor(view: PresenterView | null, mode: ScreenMode): Anchor | null {
  if (view === null) return null;
  switch (mode) {
    case 'preshow':
      return preshowAnchor(view);
    case 'studio':
    case 'overrun':
      return view.block?.anchor ?? UNKNOWN;
    case 'media':
    case 'break':
    case 'imminent':
      return view.returnTo?.anchor ?? view.onAir?.anchor ?? UNKNOWN;
    default:
      return null;
  }
}

/** Displayed ticks of the return countdown at server time `at`; only a running countdown can become imminent. */
export function returnTicks(view: PresenterView | null, at: number, prev: number | null): number | null {
  const anchor = view?.returnTo?.anchor;
  if (anchor === undefined || anchor.kind !== 'countdown') return null;
  return stableTicks(prev, anchor.endsAt - at);
}

/** RIENTRO IMMINENTE: a media/break segment whose displayed return countdown is 1 … returnImminentMs/1000 s. */
export function screenMode(view: PresenterView | null, ready: boolean, retTicks: number | null): ScreenMode {
  const mode = baseMode(view, ready);
  if (
    (mode === 'media' || mode === 'break') &&
    view !== null &&
    retTicks !== null &&
    retTicks >= 1 &&
    retTicks * 1000 <= view.thresholds.returnImminentMs
  ) {
    return 'imminent';
  }
  return mode;
}

/** Tally of the main counter from its displayed ticks, so colour and digits always agree. */
export function mainTally(view: PresenterView | null, mode: ScreenMode, ticks: number | null): Tally {
  if (mode === 'imminent') return 'imminent';
  if (mode === 'overrun') return 'over';
  if (view === null || ticks === null) return 'none';
  switch (mode) {
    case 'studio':
      if (ticks <= 0) return 'over';
      return ticks * 1000 <= view.thresholds.warnMs ? 'warn' : 'none';
    case 'media':
    case 'break':
      return ticks <= 0 ? 'over' : 'none';
    case 'preshow':
      return ticks <= 0 ? 'warn' : 'none';
    default:
      return 'none';
  }
}

/** NEXT and FINE PROGRAMMA (or the PRE-SHOW rundown) are shown while there is a show to follow. */
export function showSide(mode: ScreenMode): boolean {
  return mode === 'preshow' || mode === 'studio' || mode === 'media' || mode === 'break' || mode === 'overrun';
}
