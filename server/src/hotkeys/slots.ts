// SPDX-License-Identifier: GPL-2.0-or-later
import { z } from 'zod';

/** The fixed OBS hotkey slots (DT-9). Order and ids are a contract with plugin/core/HotkeySlots.cpp. */
export const HOTKEY_SLOT_IDS = [
  'message-1', 'message-2', 'message-3', 'message-4', 'message-5', 'message-6',
  'message-7', 'message-8', 'message-9', 'message-10', 'message-11', 'message-12',
  'clear', 'next', 'prev', 'time-plus', 'time-minus', 'control-toggle',
] as const;
export type HotkeySlotId = (typeof HOTKEY_SLOT_IDS)[number];

/** DT-9: these need a second press of the SAME slot within CONFIRM_WINDOW_MS. */
export const EMERGENCY_SLOTS: ReadonlySet<HotkeySlotId> = new Set<HotkeySlotId>([
  'next', 'prev', 'time-plus', 'time-minus', 'control-toggle',
]);

export const CONFIRM_WINDOW_MS = 1_000;
/** A second press closer than this to the first is key bounce or a duplicate delivery, not a confirmation. */
export const MIN_CONFIRM_GAP_MS = 120;

/** Body of POST /api/internal/hotkey. */
export const HotkeyBody = z.object({
  slot: z.enum(HOTKEY_SLOT_IDS),
  session: z.string().min(1).max(64).optional(),
  seq: z.number().int().nonnegative().optional(),
});
export type HotkeyBody = z.infer<typeof HotkeyBody>;
