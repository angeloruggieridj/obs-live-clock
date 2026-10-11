// SPDX-License-Identifier: GPL-2.0-or-later
import type { ControlView, PresenterView, RundownRow } from '@olc/shared';

/** Server wall time used by every web test: 2026-09-21 14:13:20 UTC (tests render with timeZone 'UTC'). */
export const WALL = 1_790_000_000_000;
/** Program start of the control fixture: 13:56:40 UTC. */
const T0W = WALL - 1_000_000;

/** Live in studio, block 3 "Secondo blocco" with 8:42 left, program end in 41:18 at 14:54:38 (SPEC §7 wireframe). */
export function studioView(over: Partial<PresenterView> = {}): PresenterView {
  return {
    phase: 'live',
    segment: 'studio',
    rundownFinished: false,
    block: { index: 2, name: 'Secondo blocco', anchor: { kind: 'countdown', endsAt: WALL + 522_000, source: 'measured' } },
    onAir: null,
    returnTo: null,
    next: { title: 'Servizio 2', durationMs: 120_000, source: 'measured' },
    programEnd: { anchor: { kind: 'countdown', endsAt: WALL + 2_478_000, source: 'planned' }, endsAtWall: WALL + 2_478_000 },
    delay: { ms: 42_000, source: 'measured' },
    thresholds: { warnMs: 60_000, returnImminentMs: 10_000 },
    message: null,
    status: { rec: true, stream: false, recPaused: false, obs: 'ok', control: 'auto' },
    preshow: null,
    ended: null,
    ...over,
  };
}

/** PRE-SHOW, planned start in 10:00 (14:23:20 UTC). */
export function preshowView(over: Partial<PresenterView> = {}): PresenterView {
  return studioView({
    phase: 'preshow',
    segment: null,
    block: null,
    next: { title: 'Servizio 1', durationMs: 180_000, source: 'planned' },
    programEnd: null,
    delay: null,
    status: { rec: false, stream: false, recPaused: false, obs: 'ok', control: 'auto' },
    preshow: {
      plannedStart: new Date(WALL + 600_000).toISOString(),
      totalDurationMs: 1_620_000,
      upcoming: ['Primo blocco', 'Servizio 1', 'Break 1', 'Secondo blocco'],
    },
    ...over,
  });
}

/** Servizio 1 on air, back to "Primo blocco" in 1:42. `block` stays set, as the server sends it (BACKLOG). */
export function mediaView(over: Partial<PresenterView> = {}): PresenterView {
  return studioView({
    segment: 'media',
    block: { index: 0, name: 'Primo blocco', anchor: { kind: 'countdown', endsAt: WALL + 400_000, source: 'measured' } },
    onAir: {
      title: 'Servizio 1',
      anchor: { kind: 'countdown', endsAt: WALL + 102_000, source: 'measured' },
      startedAtWall: WALL - 83_000,
      durationMs: 185_000,
    },
    returnTo: { blockName: 'Primo blocco', anchor: { kind: 'countdown', endsAt: WALL + 102_000, source: 'measured' } },
    next: { title: 'Break 1', durationMs: 180_000, source: 'planned' },
    ...over,
  });
}

/** Break 1 on air (filler playing), back to "Secondo blocco" in 2:00. */
export function breakView(over: Partial<PresenterView> = {}): PresenterView {
  return studioView({
    segment: 'break',
    block: { index: 1, name: 'Break 1', anchor: { kind: 'countdown', endsAt: WALL + 120_000, source: 'measured' } },
    onAir: {
      title: 'Break 1',
      anchor: { kind: 'countdown', endsAt: WALL + 120_000, source: 'measured' },
      startedAtWall: WALL - 60_000,
      durationMs: 180_000,
    },
    returnTo: { blockName: 'Secondo blocco', anchor: { kind: 'countdown', endsAt: WALL + 120_000, source: 'measured' } },
    next: { title: 'Servizio 2', durationMs: 120_000, source: 'measured' },
    ...over,
  });
}

/** FINE: 27:12 of program, 12 s over the plan. */
export function endedView(over: Partial<PresenterView> = {}): PresenterView {
  return studioView({
    phase: 'ended',
    delay: { ms: 12_000, source: 'measured' },
    status: { rec: false, stream: false, recPaused: false, obs: 'ok', control: 'auto' },
    ended: { totalMs: 1_632_000, finalOffsetMs: 12_000, source: 'measured' },
    ...over,
  });
}

function row(over: Partial<RundownRow> & Pick<RundownRow, 'slot' | 'blockIndex' | 'blockName' | 'kind' | 'title'>): RundownRow {
  return {
    status: 'pending',
    provisional: false,
    durationMs: null,
    durationSource: 'planned',
    plannedStartAtWall: null,
    startedAtWall: null,
    endedAtWall: null,
    ...over,
  };
}

/** The Solo Futsal rundown (8 slots), live in "Secondo blocco" (slot 4). */
export function controlView(over: Partial<ControlView> = {}): ControlView {
  return {
    episode: { id: 'ep-2026-10-12', name: 'Solo Futsal · 12/10/2026' },
    presenter: studioView(),
    control: 'auto',
    obs: 'ok',
    ambiguous: false,
    cursor: 4,
    returnSlot: null,
    offScript: null,
    decisions: [],
    rows: [
      row({ slot: 0, blockIndex: 0, blockName: 'Primo blocco', kind: 'studio', title: 'Primo blocco', status: 'done', plannedStartAtWall: T0W, startedAtWall: T0W, endedAtWall: T0W + 60_000 }),
      row({ slot: 1, blockIndex: 0, blockName: 'Primo blocco', kind: 'media', title: 'Servizio 1', status: 'done', durationMs: 185_000, durationSource: 'measured', plannedStartAtWall: T0W, startedAtWall: T0W + 60_000, endedAtWall: T0W + 245_000 }),
      row({ slot: 2, blockIndex: 0, blockName: 'Primo blocco', kind: 'studio', title: 'Primo blocco', status: 'done', plannedStartAtWall: T0W, startedAtWall: T0W + 245_000, endedAtWall: T0W + 700_000 }),
      row({ slot: 3, blockIndex: 1, blockName: 'Break 1', kind: 'break', title: 'Break 1', status: 'done', durationMs: 180_000, plannedStartAtWall: T0W + 720_000, startedAtWall: T0W + 700_000, endedAtWall: T0W + 880_000 }),
      row({ slot: 4, blockIndex: 2, blockName: 'Secondo blocco', kind: 'studio', title: 'Secondo blocco', status: 'onair', plannedStartAtWall: T0W + 900_000, startedAtWall: T0W + 880_000 }),
      row({ slot: 5, blockIndex: 2, blockName: 'Secondo blocco', kind: 'media', title: 'Servizio 2', durationMs: 120_000, durationSource: 'measured', plannedStartAtWall: T0W + 900_000 }),
      row({ slot: 6, blockIndex: 2, blockName: 'Secondo blocco', kind: 'studio', title: 'Secondo blocco', plannedStartAtWall: T0W + 900_000 }),
      row({ slot: 7, blockIndex: 3, blockName: 'Chiusura', kind: 'studio', title: 'Chiusura', plannedStartAtWall: T0W + 1_500_000 }),
    ],
    presets: {
      messages: [
        { id: 'stringi', text: 'STRINGI', dismiss: { kind: 'timeout', ms: 10_000 } },
        { id: 'cam2', text: 'GUARDA CAM 2', dismiss: { kind: 'manual' } },
      ],
      adjustStepMs: 30_000,
    },
    ...over,
  };
}
