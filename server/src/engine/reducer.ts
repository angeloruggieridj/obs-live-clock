// SPDX-License-Identifier: GPL-2.0-or-later
import { closeSlot, moveTo } from './cursor';
import { match } from './matcher';
import { currentBlockIndex, lastBlockIndex, resolveDeckIndex } from './rundown';
import type { DecisionKind, DomainEvent, EngineInput, LiveState, MonoMs } from './types';

export interface ReduceResult {
  state: LiveState;
  changed: boolean;
}

/** Pure: never mutates `prev`. Returns `prev` itself when nothing changed. */
export function reduce(prev: LiveState, input: EngineInput): ReduceResult {
  const s = structuredClone(prev);
  const changed = apply(s, input);
  return changed ? { state: s, changed: true } : { state: prev, changed: false };
}

function apply(s: LiveState, input: EngineInput): boolean {
  switch (input.type) {
    case 'ProgramSceneChanged':
    case 'OutputChanged':
    case 'DeckItemStarted':
    case 'DeckPlayback':
    case 'DeckPlaylistChanged':
    case 'MediaStatus':
    case 'SourceLost':
    case 'SourceRestored':
      return applyEvent(s, input);
    default:
      return false; // commands and ticks: Task 8
  }
}

const canMatch = (s: LiveState) => s.phase === 'live' && s.control === 'auto';

function applyEvent(s: LiveState, e: DomainEvent): boolean {
  switch (e.type) {
    case 'ProgramSceneChanged':
      s.program = { scene: e.scene, deckOnProgram: e.deckOnProgram };
      if (canMatch(s)) match(s, e.at);
      return true;

    case 'OutputChanged':
      return onOutput(s, e);

    case 'DeckItemStarted':
      s.deck.current = {
        index: e.index, path: e.path, title: e.title, positionMs: 0, durationMs: e.durationMs, playing: true, at: e.at,
      };
      if (canMatch(s) && s.program.deckOnProgram) match(s, e.at);
      return true;

    case 'DeckPlayback': {
      const prev = s.deck.current;
      const item = s.deck.items?.find((i) => i.index === e.index);
      const sameItem = prev !== null && prev.index === e.index;
      s.deck.current = {
        index: e.index,
        path: item?.path ?? (sameItem ? prev!.path : ''),
        title: item?.title ?? (sameItem ? prev!.title : ''),
        positionMs: e.positionMs,
        durationMs: e.durationMs,
        playing: e.playing,
        at: e.at,
      };
      if (!sameItem && canMatch(s) && s.program.deckOnProgram) match(s, e.at);
      return true;
    }

    case 'DeckPlaylistChanged':
      s.deck.items = e.items.map((i) => ({ ...i }));
      reconcileDropped(s);
      return true;

    case 'MediaStatus':
      s.media = { input: e.input, playing: e.playing, cursorMs: e.cursorMs, durationMs: e.durationMs, at: e.at };
      return true;

    case 'SourceLost':
      if (s.obs === 'lost') return false;
      s.obs = 'lost';
      return true;

    case 'SourceRestored':
      if (s.obs === 'ok') return false;
      s.obs = 'ok';
      return true;
  }
}

function reconcileDropped(s: LiveState): void {
  for (const slot of s.slots) {
    if (slot.kind !== 'media') continue;
    const rt = s.slotRt[slot.index]!;
    if (rt.status === 'onair' || rt.status === 'done') continue;
    const found = resolveDeckIndex(s.deck.items, slot) !== null;
    if (!found) rt.status = 'dropped';
    else if (rt.status === 'dropped') rt.status = 'pending';
  }
}

export function startProgram(s: LiveState, at: MonoMs): void {
  s.phase = 'live';
  s.t0 = at;
  moveTo(s, 0, at);
  if (s.control === 'auto') match(s, at);
}

export function endProgram(s: LiveState, at: MonoMs): void {
  closeSlot(s, s.cursor, at);
  if (s.returnSlot !== null) closeSlot(s, s.returnSlot, at);
  for (const rt of s.blockRt) {
    if (rt.startedAt !== null && rt.endedAt === null) rt.endedAt = at;
  }
  s.phase = 'ended';
}

function addDecision(s: LiveState, kind: DecisionKind, defaultChoice: string, at: MonoMs): void {
  s.decisions.push({ id: s.nextDecisionId++, kind, at, defaultChoice, choice: defaultChoice, confirmed: false });
}

function confirmPending(s: LiveState, kind: DecisionKind, choice: string): void {
  for (const d of s.decisions) {
    if (d.kind === kind && !d.confirmed) {
      d.choice = choice;
      d.confirmed = true;
    }
  }
}

function resumeFromPause(s: LiveState, at: MonoMs): void {
  if (s.recPausedAt === null) return;
  const d = at - s.recPausedAt;
  s.recPausedAt = null;
  if (s.t0 !== null) s.t0 += d;
  const bi = currentBlockIndex(s);
  const block = bi >= 0 ? s.blockRt[bi]! : null;
  if (block !== null && block.startedAt !== null) block.startedAt += d;
  const slot = s.cursor >= 0 ? s.slotRt[s.cursor]! : null;
  if (slot !== null && slot.startedAt !== null) slot.startedAt += d;
}

function onOutput(s: LiveState, e: Extract<DomainEvent, { type: 'OutputChanged' }>): boolean {
  const anyBefore = s.outputs.rec || s.outputs.stream;
  switch (e.state) {
    case 'started':
      s.outputs[e.output] = true;
      if (s.phase === 'preshow') startProgram(s, e.at);
      else if (s.phase === 'live' && !anyBefore) {
        confirmPending(s, 'all_outputs_stopped', 'interruption');
        addDecision(s, 'output_restart', s.episode.preset.mode === 'live_to_tape' ? 'new_session' : 'continue', e.at);
      }
      return true;

    case 'stopped':
      s.outputs[e.output] = false;
      if (e.output === 'rec') {
        s.outputs.recPaused = false;
        resumeFromPause(s, e.at);
      }
      if (s.phase === 'live' && !s.outputs.rec && !s.outputs.stream) {
        if (currentBlockIndex(s) === lastBlockIndex(s)) endProgram(s, e.at);
        else addDecision(s, 'all_outputs_stopped', 'interruption', e.at);
      }
      return true;

    case 'paused':
      s.outputs.recPaused = true;
      if (s.phase === 'live' && s.episode.preset.recPauseFreezesProgram) s.recPausedAt = e.at;
      return true;

    case 'resumed':
      s.outputs.recPaused = false;
      resumeFromPause(s, e.at);
      return true;
  }
}
