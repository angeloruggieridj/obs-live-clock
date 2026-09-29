// SPDX-License-Identifier: GPL-2.0-or-later
import { z } from 'zod';

export const SCHEMA_VERSION = 1 as const;

const Id = z.string().min(1);
const Name = z.string().min(1).max(120);

export const DurationMs = z.number().int().nonnegative();
export type DurationMs = z.infer<typeof DurationMs>;

export const ProductionMode = z.enum(['streaming', 'tv', 'live_to_tape']);
export type ProductionMode = z.infer<typeof ProductionMode>;

export const Preset = z.object({
  mode: ProductionMode,
  warnMs: DurationMs,
  returnImminentMs: DurationMs,
  adjustStepMs: z.number().int().min(1000),
  recPauseFreezesProgram: z.boolean(),
});
export type Preset = z.infer<typeof Preset>;

export function presetForMode(mode: ProductionMode): Preset {
  return {
    mode,
    warnMs: 60_000,
    returnImminentMs: 10_000,
    adjustStepMs: 30_000,
    recPauseFreezesProgram: mode === 'live_to_tape',
  };
}

export const SceneGroup = z.object({
  id: Id,
  name: Name,
  scenes: z.array(z.string().min(1)).min(1),
});
export type SceneGroup = z.infer<typeof SceneGroup>;

export const MessageDismiss = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('timeout'), ms: z.number().int().min(1000) }),
  z.object({ kind: z.literal('manual') }),
]);
export type MessageDismiss = z.infer<typeof MessageDismiss>;

export const MessagePreset = z.object({
  id: Id,
  text: z.string().min(1).max(80),
  dismiss: MessageDismiss,
});
export type MessagePreset = z.infer<typeof MessagePreset>;

export const StudioElement = z.object({ id: Id, kind: z.literal('studio') });
export type StudioElement = z.infer<typeof StudioElement>;

export const MediaElement = z.object({
  id: Id,
  kind: z.literal('media'),
  title: z.string().max(200),
  path: z.string().min(1),
  occurrence: z.number().int().nonnegative(),
  plannedDurationMs: DurationMs,
});
export type MediaElement = z.infer<typeof MediaElement>;

export const RundownElement = z.discriminatedUnion('kind', [StudioElement, MediaElement]);
export type RundownElement = z.infer<typeof RundownElement>;

export const StudioBlock = z.object({
  id: Id,
  kind: z.literal('studio'),
  name: Name,
  durationMs: z.number().int().min(1000),
  elastic: z.boolean(),
  sceneGroupId: Id,
  elements: z.array(RundownElement).min(1),
});
export type StudioBlock = z.infer<typeof StudioBlock>;

export const BreakBlock = z.object({
  id: Id,
  kind: z.literal('break'),
  name: Name,
  durationMs: z.number().int().min(1000),
  scene: z.string().min(1),
  mediaInput: z.string().min(1).nullable(),
});
export type BreakBlock = z.infer<typeof BreakBlock>;

export const Block = z.discriminatedUnion('kind', [StudioBlock, BreakBlock]);
export type Block = z.infer<typeof Block>;

const rundownShape = {
  preset: Preset,
  sceneGroups: z.array(SceneGroup),
  messages: z.array(MessagePreset),
  blocks: z.array(Block),
};

export const Rundown = z.object(rundownShape);
export type Rundown = z.infer<typeof Rundown>;

export const Format = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  id: Id,
  name: Name,
  ...rundownShape,
});
export type Format = z.infer<typeof Format>;

export const Episode = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  id: Id,
  formatId: Id,
  name: z.string().min(1).max(160),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  plannedStart: z.string().datetime({ offset: true }).nullable(),
  playlistName: z.string().nullable(),
  ...rundownShape,
});
export type Episode = z.infer<typeof Episode>;
