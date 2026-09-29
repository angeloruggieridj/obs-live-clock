// SPDX-License-Identifier: GPL-2.0-or-later
import type { Episode, MessageDismiss } from '@olc/shared';

/** Monotonic milliseconds on the server. Never wall-clock. */
export type MonoMs = number;
export type Source = 'measured' | 'planned' | 'estimated';
export type OutputKind = 'rec' | 'stream';

/** One item of Playlist Deck `GetItems`. `durationMs` is -1 while unknown. */
export interface DeckItem {
  index: number;
  path: string;
  title: string;
  durationMs: number;
}

export interface DeckCurrent {
  index: number;
  path: string;
  title: string;
  positionMs: number;
  durationMs: number;
  playing: boolean;
  at: MonoMs;
}

/** Status of a plain OBS media input (e.g. the break filler). */
export interface InputMedia {
  input: string;
  playing: boolean;
  cursorMs: number;
  durationMs: number;
  at: MonoMs;
}

export type DomainEvent =
  | { type: 'ProgramSceneChanged'; at: MonoMs; scene: string; deckOnProgram: boolean }
  | { type: 'OutputChanged'; at: MonoMs; output: OutputKind; state: 'started' | 'stopped' | 'paused' | 'resumed' }
  | { type: 'DeckItemStarted'; at: MonoMs; index: number; path: string; title: string; durationMs: number }
  | { type: 'DeckPlayback'; at: MonoMs; index: number; positionMs: number; durationMs: number; playing: boolean }
  | { type: 'DeckPlaylistChanged'; at: MonoMs; items: DeckItem[] }
  | { type: 'MediaStatus'; at: MonoMs; input: string; playing: boolean; cursorMs: number; durationMs: number }
  | { type: 'SourceLost'; at: MonoMs }
  | { type: 'SourceRestored'; at: MonoMs };

export type Command =
  | { type: 'StartProgram'; at: MonoMs }
  | { type: 'Next'; at: MonoMs }
  | { type: 'Prev'; at: MonoMs }
  | { type: 'Goto'; at: MonoMs; slot: number }
  | { type: 'Adjust'; at: MonoMs; deltaMs: number }
  | { type: 'SetControl'; at: MonoMs; control: 'auto' | 'manual' }
  | { type: 'SendMessage'; at: MonoMs; text: string; dismiss: MessageDismiss }
  | { type: 'ClearMessage'; at: MonoMs }
  | { type: 'ResolveDecision'; at: MonoMs; id: number; choice: string };

export type Tick = { type: 'Tick'; at: MonoMs };
export type EngineInput = DomainEvent | Command | Tick;

export type SlotKind = 'studio' | 'media' | 'break';

/** One position of the flattened rundown. */
export interface Slot {
  index: number;
  blockIndex: number;
  kind: SlotKind;
  elementId: string | null;
  /** Media title, or block name for studio and break slots. */
  title: string;
  path: string | null;
  occurrence: number;
  /** Planned duration: media planned duration, break block duration, 0 for studio. */
  plannedDurationMs: number;
}

export type SlotStatus = 'pending' | 'onair' | 'done' | 'postponed' | 'dropped';

export interface SlotRuntime {
  status: SlotStatus;
  startedAt: MonoMs | null;
  endedAt: MonoMs | null;
}

export interface BlockRuntime {
  startedAt: MonoMs | null;
  endedAt: MonoMs | null;
  /** Sum of ±time commands applied to this block. */
  adjustMs: number;
  /** Duration the presenter works to, fixed when the block starts (includes recovery and adjustments). */
  targetMs: number | null;
  /**
   * What started the block: an observed OBS event or an operator command ('obs'), or the clock alone
   * ('time': tick hand-over, estimated mode). null while not started. Only 'obs' starts are measured.
   */
  startedBy: BlockStart | null;
}

export type BlockStart = 'obs' | 'time';

export interface ActiveMessage {
  text: string;
  shownAt: MonoMs;
  expiresAt: MonoMs | null;
}

export type DecisionKind = 'output_restart' | 'all_outputs_stopped';

export interface Decision {
  id: number;
  kind: DecisionKind;
  at: MonoMs;
  defaultChoice: string;
  choice: string;
  confirmed: boolean;
}

export type Phase = 'preshow' | 'live' | 'ended';

export interface LiveState {
  episode: Episode;
  slots: Slot[];
  phase: Phase;
  /** Program start; shifted forward by frozen REC pauses. */
  t0: MonoMs | null;
  outputs: { rec: boolean; stream: boolean; recPaused: boolean };
  /** Set while a REC pause freezes program time (live-to-tape preset). */
  recPausedAt: MonoMs | null;
  control: 'auto' | 'manual';
  /** Whether OBS is reachable. Starts 'lost' until the adapter reports a connection. */
  obs: 'ok' | 'lost';
  /** Index into `slots`; -1 before the program starts. */
  cursor: number;
  /** Slot to resume after a postponed item that was aired out of order. */
  returnSlot: number | null;
  slotRt: SlotRuntime[];
  blockRt: BlockRuntime[];
  program: { scene: string | null; deckOnProgram: boolean };
  deck: { items: DeckItem[] | null; current: DeckCurrent | null };
  media: InputMedia | null;
  offScript: { scene: string; since: MonoMs } | null;
  message: ActiveMessage | null;
  decisions: Decision[];
  nextDecisionId: number;
}
