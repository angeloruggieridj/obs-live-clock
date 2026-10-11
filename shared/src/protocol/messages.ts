// SPDX-License-Identifier: GPL-2.0-or-later
import { z } from 'zod';
import { MessageDismiss } from '../model/format';

export const PROTOCOL_VERSION = 1;

export const ClientRole = z.enum(['presenter', 'control']);
export type ClientRole = z.infer<typeof ClientRole>;

export const ClientCommand = z.discriminatedUnion('name', [
  z.object({ name: z.literal('start_program') }),
  z.object({ name: z.literal('end_program') }),
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

export const ErrorCodeSchema = z.enum(['invalid_message', 'protocol_mismatch', 'hello_required', 'no_episode', 'internal', 'forbidden']);
export type ErrorCode = z.infer<typeof ErrorCodeSchema>;

/** Messages the server sends. `view` is the engine projection for the client's role (typed in Plan 4). */
export type ServerMessage =
  | { type: 'welcome'; serverVersion: string; instanceId: string; protocol: number }
  | { type: 'view'; rev: number; role: ClientRole; view: unknown }
  | { type: 'heartbeat'; rev: number; serverWall: number }
  | { type: 'time.pong'; t0: number; serverWall: number }
  | { type: 'ack'; id: string; changed: boolean }
  | { type: 'error'; id: string | null; code: ErrorCode; message: string };

/** Client-side validation of what the server sends. `view` is validated per role by the client (shared view schemas). */
export const ServerMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('welcome'), serverVersion: z.string(), instanceId: z.string(), protocol: z.number().int() }),
  z.object({ type: z.literal('view'), rev: z.number().int().nonnegative(), role: ClientRole, view: z.unknown() }),
  z.object({ type: z.literal('heartbeat'), rev: z.number().int().nonnegative(), serverWall: z.number() }),
  z.object({ type: z.literal('time.pong'), t0: z.number(), serverWall: z.number() }),
  z.object({ type: z.literal('ack'), id: z.string(), changed: z.boolean() }),
  z.object({ type: z.literal('error'), id: z.string().nullable(), code: ErrorCodeSchema, message: z.string() }),
]);
