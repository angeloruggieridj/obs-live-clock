// SPDX-License-Identifier: GPL-2.0-or-later
import { timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { HotkeyService } from '../hotkeys/hotkey-service';
import { HotkeyBody } from '../hotkeys/slots';
import { ScreensBody, type ScreenRegistry } from '../kiosk/screens';
import type { ObsService } from '../obs/obs-service';

export interface InternalContext {
  token: string;
  obs: Pick<ObsService, 'setCredentials'>;
  hotkeys: Pick<HotkeyService, 'press'>;
  screens: Pick<ScreenRegistry, 'set'>;
}

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

/** The plugin only ever talks to us over loopback (DT-5); anything else is refused before auth. */
function isLoopback(address: string | undefined): boolean {
  return address !== undefined && LOOPBACK.has(address);
}

const CredentialsBody = z.object({
  host: z.string().min(1).default('127.0.0.1'),
  port: z.number().int().min(1).max(65_535),
  password: z.string().optional(),
});

/** Constant-time bearer check; a length mismatch rejects before `timingSafeEqual` (which requires equal lengths). */
function tokenMatches(header: string | undefined, token: string): boolean {
  const prefix = 'Bearer ';
  if (header === undefined || !header.startsWith(prefix)) return false;
  const provided = Buffer.from(header.slice(prefix.length), 'utf8');
  const expected = Buffer.from(token, 'utf8');
  if (provided.length !== expected.length) return false;
  return timingSafeEqual(provided, expected);
}

/** Loopback first (403), then the bearer token (401). Sends the error itself; true = go on. */
function authorize(req: FastifyRequest, reply: FastifyReply, token: string): boolean {
  if (!isLoopback(req.socket.remoteAddress)) {
    void reply.code(403).send({ error: 'forbidden' });
    return false;
  }
  if (!tokenMatches(req.headers.authorization, token)) {
    void reply.code(401).send({ error: 'unauthorized' });
    return false;
  }
  return true;
}

/**
 * The plugin's door (DT-3, DT-5, DT-9). Every route is loopback-only and bearer-protected, and none of them ever
 * echoes a request body in a response or an error (the zod issues are deliberately dropped: the credentials body
 * carries the OBS password).
 *   POST /api/internal/obs-credentials  host/port/password of obs-websocket          -> 204
 *   POST /api/internal/hotkey           { slot, session?, seq? }                      -> 200 HotkeyResult
 *   POST /api/internal/screens          { screens: [...] }                            -> 204
 */
export function registerInternal(app: FastifyInstance, ctx: InternalContext): void {
  app.post('/api/internal/obs-credentials', async (req, reply) => {
    if (!authorize(req, reply, ctx.token)) return reply;
    const parsed = CredentialsBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_body' });
    ctx.obs.setCredentials(parsed.data);
    return reply.code(204).send();
  });

  app.post('/api/internal/hotkey', async (req, reply) => {
    if (!authorize(req, reply, ctx.token)) return reply;
    const parsed = HotkeyBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_body' });
    const { slot, session, seq } = parsed.data;
    return reply.code(200).send(ctx.hotkeys.press(slot, { session, seq }));
  });

  app.post('/api/internal/screens', async (req, reply) => {
    if (!authorize(req, reply, ctx.token)) return reply;
    const parsed = ScreensBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_body' });
    ctx.screens.set(parsed.data.screens);
    return reply.code(204).send();
  });
}
