// SPDX-License-Identifier: GPL-2.0-or-later
import type { ClientCommand, MessageDismiss } from '@olc/shared';
import type { Clock } from '../clock/clock';
import { CONFIRM_WINDOW_MS, EMERGENCY_SLOTS, MIN_CONFIRM_GAP_MS, type HotkeySlotId } from './slots';

/** What the service needs from the live runtime (LiveRuntime satisfies it). */
export interface HotkeyRuntime {
  getState(): {
    control: 'auto' | 'manual';
    episode: { messages: { text: string; dismiss: MessageDismiss }[]; preset: { adjustStepMs: number } };
  } | null;
  command(command: ClientCommand): boolean;
}

export type HotkeyResult =
  | { result: 'executed'; slot: HotkeySlotId; changed: boolean }
  | { result: 'pending'; slot: HotkeySlotId; remainingMs: number }
  | { result: 'ignored'; slot: HotkeySlotId; reason: 'duplicate' | 'bounce' | 'no_episode' | 'no_preset' };

export interface PressSource {
  /** Random id of one plugin run, with a per-run counter: a repeated (session, seq) is a duplicate delivery. */
  session?: string;
  seq?: number;
}

const MAX_SESSIONS = 8;

export class HotkeyService {
  private pendingSlot: HotkeySlotId | null = null;
  private firstPressAt = 0;
  private readonly lastSeq = new Map<string, number>();

  constructor(private readonly deps: { runtime: HotkeyRuntime; clock: Clock }) {}

  /** The confirmation the dock should announce ("press again to confirm"), or null. */
  pending(): { slot: HotkeySlotId; remainingMs: number } | null {
    if (this.pendingSlot === null) return null;
    const remainingMs = this.firstPressAt + CONFIRM_WINDOW_MS - this.deps.clock.now();
    if (remainingMs < 0) {
      this.pendingSlot = null;
      return null;
    }
    return { slot: this.pendingSlot, remainingMs };
  }

  press(slot: HotkeySlotId, source: PressSource = {}): HotkeyResult {
    if (this.isDuplicate(source)) return { result: 'ignored', slot, reason: 'duplicate' };
    const state = this.deps.runtime.getState();
    if (state === null) {
      this.pendingSlot = null;
      return { result: 'ignored', slot, reason: 'no_episode' };
    }
    if (!EMERGENCY_SLOTS.has(slot)) {
      this.pendingSlot = null; // pressing anything else cancels a pending confirmation
      return this.immediate(slot, state);
    }
    const now = this.deps.clock.now();
    const pending = this.pending();
    if (pending !== null && pending.slot === slot) {
      if (now - this.firstPressAt < MIN_CONFIRM_GAP_MS) return { result: 'ignored', slot, reason: 'bounce' };
      this.pendingSlot = null;
      const changed = this.deps.runtime.command(this.emergencyCommand(slot, state));
      return { result: 'executed', slot, changed };
    }
    this.pendingSlot = slot;
    this.firstPressAt = now;
    return { result: 'pending', slot, remainingMs: CONFIRM_WINDOW_MS };
  }

  private isDuplicate(source: PressSource): boolean {
    if (source.session === undefined || source.seq === undefined) return false;
    const last = this.lastSeq.get(source.session);
    if (last !== undefined && source.seq <= last) return true;
    this.lastSeq.delete(source.session);
    this.lastSeq.set(source.session, source.seq);
    if (this.lastSeq.size > MAX_SESSIONS) {
      const oldest = this.lastSeq.keys().next().value;
      if (oldest !== undefined) this.lastSeq.delete(oldest);
    }
    return false;
  }

  private immediate(slot: HotkeySlotId, state: NonNullable<ReturnType<HotkeyRuntime['getState']>>): HotkeyResult {
    if (slot === 'clear') {
      return { result: 'executed', slot, changed: this.deps.runtime.command({ name: 'clear_message' }) };
    }
    const index = Number(slot.slice('message-'.length)) - 1;
    const preset = state.episode.messages[index];
    if (preset === undefined) return { result: 'ignored', slot, reason: 'no_preset' };
    const changed = this.deps.runtime.command({ name: 'send_message', text: preset.text, dismiss: preset.dismiss });
    return { result: 'executed', slot, changed };
  }

  private emergencyCommand(slot: HotkeySlotId, state: NonNullable<ReturnType<HotkeyRuntime['getState']>>): ClientCommand {
    const step = state.episode.preset.adjustStepMs;
    switch (slot) {
      case 'next':
        return { name: 'next' };
      case 'prev':
        return { name: 'prev' };
      case 'time-plus':
        return { name: 'adjust', deltaMs: step };
      case 'time-minus':
        return { name: 'adjust', deltaMs: -step };
      default:
        return { name: 'set_control', control: state.control === 'auto' ? 'manual' : 'auto' };
    }
  }
}
