// SPDX-License-Identifier: GPL-2.0-or-later
import { clearAmbiguity, closeSlot, correctTo, moveTo } from './cursor';
import { match, slotMatches } from './matcher';
import { currentBlockIndex, firstSlotOfBlock, lastBlockIndex, resolveDeckIndex } from './rundown';
import { blockEndsAt } from './timing';
import type { Command, DecisionKind, DomainEvent, EngineInput, LiveState, MonoMs } from './types';

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
    case 'Tick':
      return applyTick(s, input.at);
    default:
      return applyCommand(s, input);
  }
}

const canMatch = (s: LiveState) => s.phase === 'live' && s.control === 'auto';

/** Where the show is in the rundown: the interrupted slot during an out-of-order excursion. */
const position = (s: LiveState) => s.returnSlot ?? s.cursor;

/**
 * An operator move is a real observation: it becomes the non-provisional position while OBS is lost, and it
 * always resolves any outstanding ambiguity (a manual command counts as OBS showing something recognisable).
 */
function operatorMoved(s: LiveState): void {
  if (s.preLossCursor !== null) s.preLossCursor = position(s);
  clearAmbiguity(s);
}

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
      if (s.phase === 'live' && s.preLossCursor === null) s.preLossCursor = position(s);
      return true;

    case 'SourceRestored':
      if (s.obs === 'ok') return false;
      s.obs = 'ok';
      if (s.preLossCursor !== null && position(s) > s.preLossCursor) s.resyncPending = true;
      else s.preLossCursor = null;
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
    // Found again: behind the show it is a skipped item (postponed), ahead of it still to come.
    else if (rt.status === 'dropped') rt.status = slot.index < position(s) ? 'postponed' : 'pending';
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

function applyCommand(s: LiveState, c: Command): boolean {
  switch (c.type) {
    case 'StartProgram':
      if (s.phase !== 'preshow') return false;
      startProgram(s, c.at);
      return true;

    case 'Next': {
      if (s.phase !== 'live') return false;
      let target = position(s) + 1;
      while (target < s.slots.length && s.slotRt[target]!.status === 'dropped') target++;
      if (target >= s.slots.length) return false;
      if (s.returnSlot !== null) {
        closeSlot(s, s.cursor, c.at);
        s.cursor = s.returnSlot;
        s.returnSlot = null;
      }
      moveTo(s, target, c.at);
      operatorMoved(s);
      return true;
    }

    case 'Prev':
      if (s.phase !== 'live' || s.cursor <= 0) return false;
      correctTo(s, s.cursor - 1, c.at);
      operatorMoved(s);
      return true;

    case 'Goto':
      if (s.phase !== 'live' || c.slot < 0 || c.slot >= s.slots.length || c.slot === s.cursor) return false;
      if (s.slotRt[c.slot]!.status === 'dropped') return false;
      if (c.slot > s.cursor) {
        s.returnSlot = null;
        moveTo(s, c.slot, c.at);
      } else {
        correctTo(s, c.slot, c.at);
      }
      operatorMoved(s);
      return true;

    case 'Adjust': {
      const bi = currentBlockIndex(s);
      if (s.phase !== 'live' || bi < 0 || c.deltaMs === 0) return false;
      const rt = s.blockRt[bi]!;
      rt.adjustMs += c.deltaMs;
      if (rt.targetMs !== null) rt.targetMs += c.deltaMs;
      return true;
    }

    case 'SetControl':
      if (s.control === c.control) return false;
      s.control = c.control;
      if (c.control === 'auto' && s.phase === 'live') match(s, c.at);
      return true;

    case 'SendMessage':
      s.message = {
        text: c.text,
        shownAt: c.at,
        expiresAt: c.dismiss.kind === 'timeout' ? c.at + c.dismiss.ms : null,
      };
      return true;

    case 'ClearMessage':
      if (s.message === null) return false;
      s.message = null;
      return true;

    case 'ResolveDecision': {
      const d = s.decisions.find((x) => x.id === c.id);
      if (d === undefined) return false;
      d.choice = c.choice;
      d.confirmed = true;
      if (d.kind === 'all_outputs_stopped' && c.choice === 'end' && s.phase === 'live') endProgram(s, c.at);
      return true;
    }
  }
}

const estimating = (s: LiveState) => s.phase === 'live' && s.obs === 'lost' && s.control === 'auto';

function applyTick(s: LiveState, at: MonoMs): boolean {
  let changed = false;
  if (s.message !== null && s.message.expiresAt !== null && at >= s.message.expiresAt) {
    s.message = null;
    changed = true;
  }
  if (estimating(s)) {
    for (;;) {
      const bi = currentBlockIndex(s);
      const end = bi >= 0 ? blockEndsAt(s, bi) : null;
      if (end === null || at < end || bi >= lastBlockIndex(s)) break;
      const from = s.cursor;
      const target = firstSlotOfBlock(s, bi + 1);
      s.returnSlot = null;
      moveTo(s, target, end, 'time');
      // Nothing after `from` was actually observed: the clock alone decided it. Mark it provisional so a
      // later restore can tell a real observation from a guess (see matcher.ts resync()). `from` itself is
      // excluded: it was wherever OBS (or an operator) last really put the show, only its end is a guess.
      // A slot already `dropped` was never really part of the guess either (skipping it is an operator
      // decision, via the playlist) and must stay eligible for the ordinary out-of-order excursion path.
      for (let k = from + 1; k <= target; k++) {
        if (s.slotRt[k]!.status !== 'dropped') s.slotRt[k]!.provisional = true;
      }
      changed = true;
    }
  } else if (canMatch(s)) {
    for (;;) {
      const h = studioHandOver(s);
      if (h === null || at < h.at) break;
      moveTo(s, h.next, h.at, 'time');
      changed = true;
    }
  }
  return changed;
}

/**
 * Hand-over between adjacent studio blocks that share the scene group on Program: no OBS event will ever
 * mark the boundary, so the next block starts when the current block's target expires. Looks past every
 * slot that will never be observed once the current block has expired: a dropped slot, and a studio slot
 * of the current block (another camera angle within the same group) that follows one. A pending or
 * postponed media of the current block still to air BLOCKS the hand-over: skipping a service is the
 * operator's call (drop it from the playlist), not the clock's — an overrunning block with a service still
 * to air keeps counting in red instead. Returns the slot to enter and when, or null when the boundary is
 * observable (or the block is not started).
 */
function studioHandOver(s: LiveState): { next: number; at: MonoMs } | null {
  if (s.cursor < 0 || s.returnSlot !== null) return null;
  const cur = s.slots[s.cursor]!;
  if (cur.kind !== 'studio') return null;
  const end = blockEndsAt(s, cur.blockIndex);
  if (end === null) return null;

  let next = s.cursor + 1;
  for (;;) {
    const slot = s.slots[next];
    if (slot === undefined) break;
    if (s.slotRt[next]!.status === 'dropped') { next++; continue; }
    if (slot.blockIndex === cur.blockIndex && slot.kind === 'studio') { next++; continue; }
    break;
  }
  const slot = s.slots[next];
  if (slot === undefined || slot.kind !== 'studio' || slot.blockIndex <= cur.blockIndex) return null;
  const scene = s.program.scene;
  if (scene === null || !slotMatches(s, slot, { kind: 'studio', scene })) return null;
  // Never close the current slot before it was entered (it may have been entered after the block expired).
  return { next, at: Math.max(end, s.slotRt[s.cursor]!.startedAt ?? end) };
}

export function nextTickAt(s: LiveState): MonoMs | null {
  const candidates: MonoMs[] = [];
  if (s.message !== null && s.message.expiresAt !== null) candidates.push(s.message.expiresAt);
  if (estimating(s)) {
    const bi = currentBlockIndex(s);
    const end = bi >= 0 && bi < lastBlockIndex(s) ? blockEndsAt(s, bi) : null;
    if (end !== null) candidates.push(end);
  } else if (canMatch(s)) {
    const h = studioHandOver(s);
    if (h !== null) candidates.push(h.at);
  }
  return candidates.length === 0 ? null : Math.min(...candidates);
}
