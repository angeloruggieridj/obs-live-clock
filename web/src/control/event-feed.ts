// SPDX-License-Identifier: GPL-2.0-or-later
import type { MessageKey } from '../core/i18n';
import type { ControlView, PresenterView } from '../core/views';

export interface FeedEvent {
  key: MessageKey;
  params: Record<string, string>;
}

export interface FeedEntry extends FeedEvent {
  id: number;
  /** Server wall time at which the change arrived; null before the clock was synced. */
  atWall: number | null;
}

export const FEED_LIMIT = 200;

const PHASE_KEY = { preshow: 'evPhasePreshow', live: 'evPhaseLive', overrun: 'evPhaseOverrun', ended: 'evPhaseEnded' } as const;
const SLOT_KEY = { pending: 'evSlotPending', onair: 'evSlotOnair', done: 'evSlotDone', postponed: 'evSlotPostponed', dropped: 'evSlotDropped' } as const;
const CHOICE_KEY: Record<string, MessageKey> = {
  continue: 'evChoseContinue',
  new_session: 'evChoseNewSession',
  interruption: 'evChoseInterruption',
  end: 'evChoseEnd',
};

function phaseOf(p: PresenterView): keyof typeof PHASE_KEY {
  return p.phase === 'live' && p.rundownFinished ? 'overrun' : p.phase;
}

/**
 * Journal-like events between two control views (SPEC §8 "log in tempo reale"). Derived only from the views this
 * client received: a session feed, not the server journal.
 */
export function diffViews(prev: ControlView | null, next: ControlView | null): FeedEvent[] {
  if (next === null) return prev === null ? [] : [{ key: 'evUnloaded', params: {} }];
  if (prev === null || prev.episode.id !== next.episode.id) return [{ key: 'evLoaded', params: { name: next.episode.name } }];
  const out: FeedEvent[] = [];
  const add = (key: MessageKey, params: Record<string, string> = {}) => {
    out.push({ key, params });
  };
  const p = prev.presenter;
  const n = next.presenter;
  if (phaseOf(p) !== phaseOf(n)) add(PHASE_KEY[phaseOf(n)]);
  next.rows.forEach((row, i) => {
    const before = prev.rows[i];
    if (before === undefined) return;
    if (before.status !== row.status) add(SLOT_KEY[row.status], { title: row.title });
    if (!before.provisional && row.provisional) add('evSlotProvisional', { title: row.title });
  });
  const pm = p.message?.text ?? null;
  const nm = n.message?.text ?? null;
  if (nm !== null && nm !== pm) add('evMessage', { text: nm });
  else if (nm === null && pm !== null) add('evMessageCleared');
  if (prev.obs !== next.obs) add(next.obs === 'lost' ? 'evObsLost' : 'evObsOk');
  if (p.status.rec !== n.status.rec) add(n.status.rec ? 'evRecStarted' : 'evRecStopped');
  if (!p.status.recPaused && n.status.recPaused) add('evRecPaused');
  if (p.status.stream !== n.status.stream) add(n.status.stream ? 'evStreamStarted' : 'evStreamStopped');
  if (prev.control !== next.control) add(next.control === 'manual' ? 'evControlManual' : 'evControlAuto');
  for (const d of next.decisions) {
    const before = prev.decisions.find((x) => x.id === d.id);
    if (before === undefined) add(d.kind === 'output_restart' ? 'evDecisionOutputRestart' : 'evDecisionAllStopped');
    else if (!before.confirmed && d.confirmed) {
      const key = CHOICE_KEY[d.choice];
      if (key !== undefined) add(key);
    }
  }
  const po = prev.offScript?.scene ?? null;
  const no = next.offScript?.scene ?? null;
  if (no !== null && no !== po) add('evOffScript', { scene: no });
  else if (no === null && po !== null) add('evOffScriptEnd');
  if (!prev.ambiguous && next.ambiguous) add('evAmbiguous');
  return out;
}

/** Prepends `events` (the last derived on top) and keeps at most FEED_LIMIT entries. */
export function appendFeed(
  feed: FeedEntry[],
  events: FeedEvent[],
  atWall: number | null,
  nextId: number,
): { feed: FeedEntry[]; nextId: number } {
  const fresh = events.map((e, i) => ({ id: nextId + i, atWall, key: e.key, params: e.params }));
  return { feed: [...fresh.reverse(), ...feed].slice(0, FEED_LIMIT), nextId: nextId + events.length };
}
