// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import { ClientCommand, ClientMessage, PROTOCOL_VERSION } from '../src/index';

describe('ClientMessage', () => {
  it('accepts hello, time.ping and command', () => {
    expect(ClientMessage.safeParse({ type: 'hello', role: 'presenter', protocol: PROTOCOL_VERSION }).success).toBe(true);
    expect(ClientMessage.safeParse({ type: 'time.ping', t0: 123.5 }).success).toBe(true);
    expect(
      ClientMessage.safeParse({ type: 'command', id: 'c1', command: { name: 'goto', slot: 3 } }).success,
    ).toBe(true);
  });

  it('rejects unknown roles, types and empty command ids', () => {
    expect(ClientMessage.safeParse({ type: 'hello', role: 'admin', protocol: 1 }).success).toBe(false);
    expect(ClientMessage.safeParse({ type: 'shout' }).success).toBe(false);
    expect(ClientMessage.safeParse({ type: 'command', id: '', command: { name: 'next' } }).success).toBe(false);
  });
});

describe('ClientCommand', () => {
  it('validates arguments', () => {
    expect(ClientCommand.safeParse({ name: 'goto', slot: -1 }).success).toBe(false);
    expect(ClientCommand.safeParse({ name: 'adjust', deltaMs: 0 }).success).toBe(false);
    expect(ClientCommand.safeParse({ name: 'adjust', deltaMs: -30_000 }).success).toBe(true);
    expect(
      ClientCommand.safeParse({ name: 'send_message', text: 'STRINGI', dismiss: { kind: 'timeout', ms: 10_000 } }).success,
    ).toBe(true);
    expect(
      ClientCommand.safeParse({ name: 'send_message', text: 'STRINGI', dismiss: { kind: 'timeout', ms: 10 } }).success,
    ).toBe(false);
    expect(ClientCommand.safeParse({ name: 'resolve_decision', id: 1, choice: 'end' }).success).toBe(true);
  });
});
