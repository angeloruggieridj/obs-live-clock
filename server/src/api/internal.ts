// SPDX-License-Identifier: GPL-2.0-or-later
import { timingSafeEqual } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { ObsService } from '../obs/obs-service';

export interface InternalContext {
  token: string;
  obs: Pick<ObsService, 'setCredentials'>;
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

/**
 * DT-5 credential hand-off. The plugin POSTs the obs-websocket host/port/password to us; the endpoint is
 * loopback-only and bearer-protected, and the password is never echoed in a response, a log line or an
 * error message (the zod issues are deliberately dropped).
 */
export function registerInternal(app: FastifyInstance, ctx: InternalContext): void {
  app.post('/api/internal/obs-credentials', async (req, reply) => {
    if (!isLoopback(req.socket.remoteAddress)) return reply.code(403).send({ error: 'forbidden' });
    if (!tokenMatches(req.headers.authorization, ctx.token)) return reply.code(401).send({ error: 'unauthorized' });
    const parsed = CredentialsBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_body' });
    ctx.obs.setCredentials(parsed.data);
    return reply.code(204).send();
  });
}
