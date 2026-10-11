// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import type { PresenterView } from '../../src/core/views';
import {
  baseMode,
  mainAnchor,
  mainTally,
  preshowAnchor,
  returnTicks,
  screenMode,
  showSide,
  type ScreenMode,
} from '../../src/presenter/presenter-model';
import { WALL, breakView, endedView, mediaView, preshowView, studioView } from '../support/views';

describe('baseMode', () => {
  const cases: Array<[string, PresenterView | null, boolean, ScreenMode]> = [
    ['not ready', studioView(), false, 'waiting'],
    ['not ready, no episode', null, false, 'waiting'],
    ['no episode', null, true, 'noepisode'],
    ['preshow', preshowView(), true, 'preshow'],
    ['studio', studioView(), true, 'studio'],
    ['media', mediaView(), true, 'media'],
    ['break', breakView(), true, 'break'],
    ['overrun', studioView({ rundownFinished: true }), true, 'overrun'],
    ['ended', endedView(), true, 'ended'],
    ['live without a segment', studioView({ segment: null }), true, 'studio'],
  ];
  it.each(cases)('%s', (_label, view, ready, mode) => expect(baseMode(view, ready)).toBe(mode));
});

describe('mainAnchor', () => {
  it('uses the block only in studio and overrun', () => {
    expect(mainAnchor(studioView(), 'studio')).toEqual(studioView().block!.anchor);
    expect(mainAnchor(studioView({ rundownFinished: true }), 'overrun')).toEqual(studioView().block!.anchor);
    expect(mainAnchor(studioView({ block: null }), 'studio')).toEqual({ kind: 'unknown' });
  });

  it('uses the return countdown in media and break, never the block (BACKLOG gate)', () => {
    const media = mediaView();
    expect(mainAnchor(media, 'media')).toEqual(media.returnTo!.anchor);
    expect(mainAnchor(media, 'media')).not.toEqual(media.block!.anchor);
    expect(mainAnchor(breakView(), 'imminent')).toEqual(breakView().returnTo!.anchor);
    expect(mainAnchor(breakView({ returnTo: null }), 'break')).toEqual(breakView().onAir!.anchor);
  });

  it('counts to the planned start in preshow, and shows no counter without a show', () => {
    expect(mainAnchor(preshowView(), 'preshow')).toEqual({ kind: 'countdown', endsAt: WALL + 600_000, source: 'planned' });
    expect(preshowAnchor(preshowView({ preshow: { plannedStart: null, totalDurationMs: 1, upcoming: [] } }))).toEqual({ kind: 'unknown' });
    expect(mainAnchor(null, 'noepisode')).toBeNull();
    expect(mainAnchor(endedView(), 'ended')).toBeNull();
  });
});

describe('screenMode (RIENTRO IMMINENTE)', () => {
  const at = (endsAt: number, over: Partial<PresenterView> = {}) =>
    breakView({ returnTo: { blockName: 'Secondo blocco', anchor: { kind: 'countdown', endsAt, source: 'measured' } }, ...over });
  const mode = (view: PresenterView, prev: number | null = null) => screenMode(view, true, returnTicks(view, WALL, prev));

  it('goes full screen in the last returnImminentMs, while the counter is above zero', () => {
    expect(mode(at(WALL + 10_001))).toBe('break'); // 0:11
    expect(mode(at(WALL + 10_000))).toBe('imminent'); // 0:10
    expect(mode(at(WALL + 500))).toBe('imminent'); // 0:01
    expect(mode(at(WALL))).toBe('break'); // +0:00: the filler ended, back to red overrun
    expect(mode(at(WALL + 500, { segment: 'media' }))).toBe('imminent');
  });

  it('imminent keeps its hysteresis', () => {
    expect(mode(at(WALL + 10_100), 10)).toBe('imminent'); // held at 0:10 within 250 ms
    expect(mode(at(WALL + 10_300), 10)).toBe('break');
  });

  it('needs a running return countdown and a positive threshold', () => {
    const frozen = breakView({ returnTo: { blockName: 'Secondo blocco', anchor: { kind: 'frozen', valueMs: 5_000, source: 'measured' } } });
    expect(mode(frozen)).toBe('break');
    expect(mode(breakView({ returnTo: null }))).toBe('break');
    expect(mode(at(WALL + 5_000, { thresholds: { warnMs: 60_000, returnImminentMs: 0 } }))).toBe('break');
    expect(screenMode(studioView(), true, returnTicks(studioView(), WALL, null))).toBe('studio');
    expect(screenMode(at(WALL + 5_000), false, 5)).toBe('waiting');
  });
});

describe('mainTally', () => {
  const v = studioView();
  it.each([
    ['studio, plenty of time', 'studio', 61, 'none'],
    ['studio, 1:00 is amber', 'studio', 60, 'warn'],
    ['studio, last second', 'studio', 1, 'warn'],
    ['studio, overrun', 'studio', 0, 'over'],
    ['media running', 'media', 30, 'none'],
    ['break past the filler', 'break', -3, 'over'],
    ['preshow on time', 'preshow', 600, 'none'],
    ['preshow late', 'preshow', 0, 'warn'],
    ['imminent', 'imminent', 5, 'imminent'],
    ['overrun', 'overrun', -72, 'over'],
    ['unknown value', 'studio', null, 'none'],
  ] as Array<[string, ScreenMode, number | null, string]>)('%s', (_label, mode, ticks, tally) => {
    expect(mainTally(v, mode, ticks)).toBe(tally);
  });

  it('shows the side tiles only while there is a show to follow', () => {
    expect((['preshow', 'studio', 'media', 'break', 'overrun'] as ScreenMode[]).every(showSide)).toBe(true);
    expect((['waiting', 'noepisode', 'imminent', 'ended'] as ScreenMode[]).some(showSide)).toBe(false);
  });
});
