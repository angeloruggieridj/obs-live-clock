// SPDX-License-Identifier: GPL-2.0-or-later
import { z } from 'zod';
import { MessageDismiss } from '../model/format';

export const PROTOCOL_VERSION = 1;

export const ClientRole = z.enum(['presenter', 'control']);
export type ClientRole = z.infer<typeof ClientRole>;

export const ClientCommand = z.discriminatedUnion('name', [
  z.object({ name: z.literal('start_program') }),
  z.object({ name: z.literal('next') }),
  z.object({ name: z.literal('prev') }),
  z.object({ name: z.literal('goto'), slot: z.number().int().nonnegative() }),
  z.object({
    name: z.literal('adjust'),
    deltaMs: z.number().int().refine((v) => v !== 0, 'deltaMs must not be 0'),
  }),
  z.object({ name: z.literal('set_control'), control: z.enum(['auto', 'manual']) }),
  z.object({ name: z.literal('send_message'), text: z.string().min(1).max(200), dismiss: MessageDismiss }),
  z.object({ name: z.literal('clear_message') }),
  z.object({ name: z.literal('resolve_decision'), id: z.number().int().positive(), choice: z.string().min(1).max(40) }),
]);
export type ClientCommand = z.infer<typeof ClientCommand>;

export const ClientMessage = z.discriminatedUnion('type', [
  z.object({ type: z.literal('hello'), role: ClientRole, protocol: z.number().int() }),
  z.object({ type: z.literal('time.ping'), t0: z.number() }),
  z.object({ type: z.literal('command'), id: z.string().min(1).max(64), command: ClientCommand }),
]);
export type ClientMessage = z.infer<typeof ClientMessage>;

export type ErrorCode = 'invalid_message' | 'protocol_mismatch' | 'hello_required' | 'no_episode';

/** Messages the server sends. `view` is the engine projection for the client's role (typed in Plan 4). */
export type ServerMessage =
  | { type: 'welcome'; serverVersion: string; instanceId: string; protocol: number }
  | { type: 'view'; rev: number; role: ClientRole; view: unknown }
  | { type: 'heartbeat'; rev: number; serverWall: number }
  | { type: 'time.pong'; t0: number; serverWall: number }
  | { type: 'ack'; id: string }
  | { type: 'error'; id: string | null; code: ErrorCode; message: string };
