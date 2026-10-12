// SPDX-License-Identifier: GPL-2.0-or-later
import type { ClientCommand } from '@olc/shared';
import { describe, expect, it } from 'vitest';
import { FakeTime } from '../../src/clock/clock';
import { HotkeyService, type HotkeyRuntime } from '../../src/hotkeys/hotkey-service';
import { CONFIRM_WINDOW_MS, EMERGENCY_SLOTS, HOTKEY_SLOT_IDS, MIN_CONFIRM_GAP_MS } from '../../src/hotkeys/slots';

function setup(opts: { episode?: boolean; messages?: number; control?: 'auto' | 'manual' } = {}) {
  const time = new FakeTime();
  const commands: ClientCommand[] = [];
  const messages = Array.from({ length: opts.messages ?? 3 }, (_, i) => ({
    text: `MSG ${i + 1}`,
    dismiss: { kind: 'timeout' as const, ms: 5_000 },
  }));
  const state =
    opts.episode === false
      ? null
      : { control: opts.control ?? ('auto' as const), episode: { messages, preset: { adjustStepMs: 30_000 } } };
  const runtime: HotkeyRuntime = {
    getState: () => state,
    command: (c) => {
      commands.push(c);
      return true;
    },
  };
  const service = new HotkeyService({ runtime, clock: time });
  return { time, commands, service };
}

describe('HotkeyService', () => {
  it('has the 18 fixed slots, five of them emergency', () => {
    expect(HOTKEY_SLOT_IDS).toHaveLength(18);
    expect([...EMERGENCY_SLOTS].sort()).toEqual(['control-toggle', 'next', 'prev', 'time-minus', 'time-plus']);
  });

  it('message slots send the preset at that position, immediately', () => {
    const { service, commands } = setup();
    expect(service.press('message-2')).toEqual({ result: 'executed', slot: 'message-2', changed: true });
    expect(commands).toEqual([{ name: 'send_message', text: 'MSG 2', dismiss: { kind: 'timeout', ms: 5_000 } }]);
  });

  it('a message slot with no preset behind it is ignored, not an error', () => {
    const { service, commands } = setup({ messages: 3 });
    expect(service.press('message-12')).toEqual({ result: 'ignored', slot: 'message-12', reason: 'no_preset' });
    expect(commands).toEqual([]);
  });

  it('CLEAR is immediate', () => {
    const { service, commands } = setup();
    service.press('clear');
    expect(commands).toEqual([{ name: 'clear_message' }]);
  });

  it('nothing runs without an episode', () => {
    const { service, commands } = setup({ episode: false });
    expect(service.press('message-1')).toMatchObject({ result: 'ignored', reason: 'no_episode' });
    expect(service.press('next')).toMatchObject({ result: 'ignored', reason: 'no_episode' });
    expect(commands).toEqual([]);
  });

  it('an emergency slot needs a second press of the same slot within 1 s', () => {
    const { service, commands, time } = setup();
    expect(service.press('next')).toEqual({ result: 'pending', slot: 'next', remainingMs: CONFIRM_WINDOW_MS });
    expect(commands).toEqual([]);
    time.mono += 300;
    expect(service.press('next')).toEqual({ result: 'executed', slot: 'next', changed: true });
    expect(commands).toEqual([{ name: 'next' }]);
  });

  it('a second press after the window starts a new confirmation instead of executing', () => {
    const { service, commands, time } = setup();
    service.press('prev');
    time.mono += CONFIRM_WINDOW_MS + 1;
    expect(service.press('prev')).toMatchObject({ result: 'pending' });
    expect(commands).toEqual([]);
  });

  it('the last millisecond of the window still confirms', () => {
    const { service, commands, time } = setup();
    service.press('prev');
    time.mono += CONFIRM_WINDOW_MS;
    expect(service.press('prev')).toMatchObject({ result: 'executed' });
    expect(commands).toEqual([{ name: 'prev' }]);
  });

  it('a different slot never confirms another one', () => {
    const { service, commands, time } = setup();
    service.press('next');
    time.mono += 300;
    expect(service.press('prev')).toMatchObject({ result: 'pending', slot: 'prev' });
    time.mono += 300;
    expect(service.press('next')).toMatchObject({ result: 'pending', slot: 'next' });
    expect(commands).toEqual([]);
  });

  it('pressing a message or CLEAR between two presses cancels the confirmation', () => {
    const { service, commands, time } = setup();
    service.press('next');
    time.mono += 200;
    service.press('message-1');
    time.mono += 200;
    expect(service.press('next')).toMatchObject({ result: 'pending' });
    expect(commands.map((c) => c.name)).toEqual(['send_message']);
  });

  it('key bounce (a second press within 120 ms) neither confirms nor resets the window', () => {
    const { service, commands, time } = setup();
    service.press('next');
    time.mono += MIN_CONFIRM_GAP_MS - 1;
    expect(service.press('next')).toEqual({ result: 'ignored', slot: 'next', reason: 'bounce' });
    expect(commands).toEqual([]);
    time.mono += 500;
    expect(service.press('next')).toMatchObject({ result: 'executed' });
  });

  it('a triple tap executes once and then starts a new confirmation', () => {
    const { service, commands, time } = setup();
    service.press('next');
    time.mono += 300;
    service.press('next');
    time.mono += 300;
    expect(service.press('next')).toMatchObject({ result: 'pending' });
    expect(commands).toEqual([{ name: 'next' }]);
  });

  it('a duplicate delivery (same session and seq) is ignored and never confirms', () => {
    const { service, commands, time } = setup();
    expect(service.press('next', { session: 's1', seq: 1 })).toMatchObject({ result: 'pending' });
    time.mono += 300;
    expect(service.press('next', { session: 's1', seq: 1 })).toMatchObject({ result: 'ignored', reason: 'duplicate' });
    expect(commands).toEqual([]);
    expect(service.press('next', { session: 's1', seq: 2 })).toMatchObject({ result: 'executed' });
  });

  it('a restarted plugin (new session, seq back at 1) is not mistaken for a duplicate', () => {
    const { service } = setup();
    service.press('message-1', { session: 'old', seq: 40 });
    expect(service.press('message-1', { session: 'new', seq: 1 })).toMatchObject({ result: 'executed' });
  });

  it('time-plus and time-minus adjust by the episode step, control-toggle flips the mode', () => {
    const a = setup();
    a.service.press('time-plus');
    a.time.mono += 300;
    a.service.press('time-plus');
    a.service.press('time-minus');
    a.time.mono += 300;
    a.service.press('time-minus');
    expect(a.commands).toEqual([
      { name: 'adjust', deltaMs: 30_000 },
      { name: 'adjust', deltaMs: -30_000 },
    ]);
    const auto = setup({ control: 'auto' });
    auto.service.press('control-toggle');
    auto.time.mono += 300;
    auto.service.press('control-toggle');
    expect(auto.commands).toEqual([{ name: 'set_control', control: 'manual' }]);
    const manual = setup({ control: 'manual' });
    manual.service.press('control-toggle');
    manual.time.mono += 300;
    manual.service.press('control-toggle');
    expect(manual.commands).toEqual([{ name: 'set_control', control: 'auto' }]);
  });

  it('pending() reports the live confirmation for the dock and expires with the window', () => {
    const { service, time } = setup();
    expect(service.pending()).toBeNull();
    service.press('next');
    time.mono += 400;
    expect(service.pending()).toEqual({ slot: 'next', remainingMs: 600 });
    time.mono += 700;
    expect(service.pending()).toBeNull();
  });

  it('forgets old sessions beyond eight', () => {
    const { service } = setup();
    for (let i = 0; i < 12; i++) service.press('message-1', { session: `s${i}`, seq: 5 });
    expect(service.press('message-1', { session: 's0', seq: 5 })).toMatchObject({ result: 'executed' });
  });
});
