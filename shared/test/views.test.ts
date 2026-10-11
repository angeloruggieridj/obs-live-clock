// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import { Anchor, DECISION_CHOICES, ServerMessageSchema } from '../src/index';

describe('view schemas', () => {
  it('accepts the three anchor kinds and nothing else', () => {
    expect(Anchor.parse({ kind: 'countdown', endsAt: 1, source: 'measured' })).toEqual({ kind: 'countdown', endsAt: 1, source: 'measured' });
    expect(Anchor.parse({ kind: 'frozen', valueMs: 5, source: 'estimated' })).toEqual({ kind: 'frozen', valueMs: 5, source: 'estimated' });
    expect(Anchor.parse({ kind: 'unknown' })).toEqual({ kind: 'unknown' });
    expect(Anchor.safeParse({ kind: 'countup', since: 1, source: 'measured' }).success).toBe(false);
    expect(Anchor.safeParse({ kind: 'countdown', endsAt: 1 }).success).toBe(false);
  });

  it('lists the choices the engine offers for each decision kind', () => {
    expect(DECISION_CHOICES).toEqual({
      output_restart: ['continue', 'new_session'],
      all_outputs_stopped: ['interruption', 'end'],
    });
  });
});

describe('ServerMessageSchema', () => {
  it('parses every server message', () => {
    const msgs = [
      { type: 'welcome', serverVersion: '0.1.0', instanceId: 'i-1', protocol: 1 },
      { type: 'view', rev: 3, role: 'presenter', view: null },
      { type: 'heartbeat', rev: 3, serverWall: 1_790_000_000_000 },
      { type: 'time.pong', t0: 12.5, serverWall: 1_790_000_000_000 },
      { type: 'ack', id: 'c1', changed: false },
      { type: 'error', id: null, code: 'no_episode', message: 'No episode is loaded' },
    ];
    for (const m of msgs) expect(ServerMessageSchema.parse(m)).toEqual(m);
  });

  it('rejects malformed messages', () => {
    expect(ServerMessageSchema.safeParse({ type: 'view', role: 'presenter', view: null }).success).toBe(false);
    expect(ServerMessageSchema.safeParse({ type: 'error', id: null, code: 'teapot', message: '' }).success).toBe(false);
    expect(ServerMessageSchema.safeParse({ type: 'nope' }).success).toBe(false);
  });
});
