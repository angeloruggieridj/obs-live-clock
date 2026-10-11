// SPDX-License-Identifier: GPL-2.0-or-later
import { z } from 'zod';
import { MessagePreset } from '../model/format';

/** NF1: where a value comes from. */
export const Source = z.enum(['measured', 'planned', 'estimated']);
export type Source = z.infer<typeof Source>;

/**
 * DT-7 anchor: a fact with a reference instant, never a running value. A countdown past its end is shown as a
 * positive overrun by the client; a frozen value is paused (media pause or REC pause); unknown is shown as "—".
 */
export const Anchor = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('countdown'), endsAt: z.number(), source: Source }),
  z.object({ kind: z.literal('frozen'), valueMs: z.number(), source: Source }),
  z.object({ kind: z.literal('unknown') }),
]);
export type Anchor = z.infer<typeof Anchor>;

export const SlotKind = z.enum(['studio', 'media', 'break']);
export type SlotKind = z.infer<typeof SlotKind>;
export const SlotStatus = z.enum(['pending', 'onair', 'done', 'postponed', 'dropped']);
export type SlotStatus = z.infer<typeof SlotStatus>;
export const DecisionKind = z.enum(['output_restart', 'all_outputs_stopped']);
export type DecisionKind = z.infer<typeof DecisionKind>;

/** The choices `resolve_decision` accepts for each decision kind (the engine's defaults are listed first). */
export const DECISION_CHOICES = {
  output_restart: ['continue', 'new_session'],
  all_outputs_stopped: ['interruption', 'end'],
} as const satisfies Record<DecisionKind, readonly string[]>;

const Wall = z.number();

export const PresenterView = z.object({
  phase: z.enum(['preshow', 'live', 'ended']),
  segment: SlotKind.nullable(),
  rundownFinished: z.boolean(),
  block: z.object({ index: z.number().int().nonnegative(), name: z.string(), anchor: Anchor }).nullable(),
  onAir: z
    .object({ title: z.string(), anchor: Anchor, startedAtWall: Wall.nullable(), durationMs: z.number().nullable() })
    .nullable(),
  returnTo: z.object({ blockName: z.string(), anchor: Anchor }).nullable(),
  next: z.object({ title: z.string(), durationMs: z.number(), source: Source }).nullable(),
  programEnd: z.object({ anchor: Anchor, endsAtWall: Wall.nullable() }).nullable(),
  delay: z.object({ ms: z.number(), source: Source }).nullable(),
  thresholds: z.object({ warnMs: z.number().nonnegative(), returnImminentMs: z.number().nonnegative() }),
  message: z.object({ text: z.string() }).nullable(),
  status: z.object({
    rec: z.boolean(),
    stream: z.boolean(),
    recPaused: z.boolean(),
    obs: z.enum(['ok', 'lost']),
    control: z.enum(['auto', 'manual']),
  }),
  preshow: z
    .object({ plannedStart: z.string().nullable(), totalDurationMs: z.number(), upcoming: z.array(z.string()) })
    .nullable(),
  /** FINE (SPEC §7): program time from T0 to the end, and the end minus the planned end. Null until ended. */
  ended: z.object({ totalMs: z.number(), finalOffsetMs: z.number(), source: Source }).nullable(),
});
export type PresenterView = z.infer<typeof PresenterView>;

export const RundownRow = z.object({
  slot: z.number().int().nonnegative(),
  blockIndex: z.number().int().nonnegative(),
  blockName: z.string(),
  kind: SlotKind,
  title: z.string(),
  status: SlotStatus,
  provisional: z.boolean(),
  /** null for studio rows: their duration is elastic (shown as "—"). */
  durationMs: z.number().nullable(),
  durationSource: Source,
  /** Planned start of the row's block (T0 + preceding block durations); null before T0. */
  plannedStartAtWall: Wall.nullable(),
  startedAtWall: Wall.nullable(),
  endedAtWall: Wall.nullable(),
});
export type RundownRow = z.infer<typeof RundownRow>;

export const ControlDecision = z.object({
  id: z.number().int().positive(),
  kind: DecisionKind,
  atWall: Wall,
  defaultChoice: z.string(),
  choice: z.string(),
  confirmed: z.boolean(),
});
export type ControlDecision = z.infer<typeof ControlDecision>;

export const ControlView = z.object({
  episode: z.object({ id: z.string(), name: z.string() }),
  presenter: PresenterView,
  control: z.enum(['auto', 'manual']),
  obs: z.enum(['ok', 'lost']),
  ambiguous: z.boolean(),
  cursor: z.number().int(),
  returnSlot: z.number().int().nullable(),
  offScript: z.object({ scene: z.string(), sinceWall: Wall }).nullable(),
  decisions: z.array(ControlDecision),
  rows: z.array(RundownRow),
  /** What the dock needs from the loaded episode: preset messages (hotkey slot = index + 1, DT-9) and the ±time step. */
  presets: z.object({ messages: z.array(MessagePreset), adjustStepMs: z.number().int().positive() }),
});
export type ControlView = z.infer<typeof ControlView>;
