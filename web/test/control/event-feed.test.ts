// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import { FEED_LIMIT, appendFeed, diffViews, type FeedEntry } from '../../src/control/event-feed';
import type { ControlView } from '../../src/core/views';
import { WALL, controlView, preshowView, studioView } from '../support/views';

const keys = (prev: ControlView | null, next: ControlView | null) => diffViews(prev, next).map((e) => e.key);

describe('diffViews', () => {
  it('reports loading and unloading an episode', () => {
    expect(diffViews(null, null)).toEqual([]);
    expect(diffViews(null, controlView())).toEqual([{ key: 'evLoaded', params: { name: 'Solo Futsal · 12/10/2026' } }]);
    expect(keys(controlView(), null)).toEqual(['evUnloaded']);
    expect(keys(controlView(), controlView({ episode: { id: 'other', name: 'Altra' } }))).toEqual(['evLoaded']);
    expect(diffViews(controlView(), controlView())).toEqual([]);
  });

  it('reports the phase, with OLTRE SCALETTA as its own phase', () => {
    expect(keys(controlView({ presenter: preshowView() }), controlView())).toEqual(['evPhaseLive', 'evRecStarted']); // REC start makes it live
    expect(keys(controlView(), controlView({ presenter: studioView({ rundownFinished: true }) }))).toEqual(['evPhaseOverrun']);
  });

  it('reports slot status and provisional changes with the slot title', () => {
    const before = controlView();
    const rows = before.rows.map((r) => ({ ...r }));
    rows[4] = { ...rows[4]!, status: 'done' };
    rows[5] = { ...rows[5]!, status: 'onair', provisional: true };
    expect(diffViews(before, controlView({ rows }))).toEqual([
      { key: 'evSlotDone', params: { title: 'Secondo blocco' } },
      { key: 'evSlotOnair', params: { title: 'Servizio 2' } },
      { key: 'evSlotProvisional', params: { title: 'Servizio 2' } },
    ]);
  });

  it('reports messages, OBS, outputs and control mode in a fixed order', () => {
    const quiet = controlView();
    const busy = controlView({
      obs: 'lost',
      control: 'manual',
      presenter: studioView({
        message: { text: 'STRINGI' },
        status: { rec: false, stream: true, recPaused: false, obs: 'lost', control: 'manual' },
      }),
    });
    expect(diffViews(quiet, busy)).toEqual([
      { key: 'evMessage', params: { text: 'STRINGI' } },
      { key: 'evObsLost', params: {} },
      { key: 'evRecStopped', params: {} },
      { key: 'evStreamStarted', params: {} },
      { key: 'evControlManual', params: {} },
    ]);
    expect(keys(busy, quiet)).toEqual(['evMessageCleared', 'evObsOk', 'evRecStarted', 'evStreamStopped', 'evControlAuto']);
    const paused = controlView({ presenter: studioView({ status: { rec: true, stream: false, recPaused: true, obs: 'ok', control: 'auto' } }) });
    expect(keys(quiet, paused)).toEqual(['evRecPaused']);
  });

  it('reports decisions, off-script and ambiguity', () => {
    const decision = { id: 1, kind: 'all_outputs_stopped' as const, atWall: WALL, defaultChoice: 'interruption', choice: 'interruption', confirmed: false };
    const a = controlView();
    const b = controlView({ decisions: [decision], offScript: { scene: 'CAMERA OSPITE', sinceWall: WALL }, ambiguous: true });
    expect(diffViews(a, b)).toEqual([
      { key: 'evDecisionAllStopped', params: {} },
      { key: 'evOffScript', params: { scene: 'CAMERA OSPITE' } },
      { key: 'evAmbiguous', params: {} },
    ]);
    const c = controlView({ decisions: [{ ...decision, choice: 'end', confirmed: true }] });
    expect(keys(b, c)).toEqual(['evChoseEnd', 'evOffScriptEnd']);
  });
});

describe('appendFeed', () => {
  it('puts the newest first, numbers entries and keeps at most FEED_LIMIT', () => {
    const old: FeedEntry[] = Array.from({ length: FEED_LIMIT - 1 }, (_, i) => ({ id: i + 1, atWall: WALL, key: 'evObsOk', params: {} }));
    const { feed, nextId } = appendFeed(old, [{ key: 'evObsLost', params: {} }, { key: 'evRecStopped', params: {} }], WALL + 1, FEED_LIMIT);
    expect(feed).toHaveLength(FEED_LIMIT);
    expect(feed.slice(0, 2)).toEqual([
      { id: FEED_LIMIT + 1, atWall: WALL + 1, key: 'evRecStopped', params: {} },
      { id: FEED_LIMIT, atWall: WALL + 1, key: 'evObsLost', params: {} },
    ]);
    expect(nextId).toBe(FEED_LIMIT + 2);
  });
});
