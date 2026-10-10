// SPDX-License-Identifier: GPL-2.0-or-later
import type { FastifyInstance } from 'fastify';

/** Hostname without brackets and without the port, lower-cased. `null` when it cannot be parsed. */
export function normalizeHostname(value: string): string | null {
  let h = value.trim().toLowerCase();
  if (h === '') return null;
  if (h.startsWith('[')) {
    const end = h.indexOf(']');
    if (end === -1) return null;
    h = h.slice(1, end);
  } else {
    const colon = h.lastIndexOf(':');
    if (colon !== -1) h = h.slice(0, colon);
  }
  return h === '' ? null : h;
}

function hostOfHeader(host: string | undefined): string | null {
  return host === undefined ? null : normalizeHostname(host);
}

function hostOfOrigin(origin: string | undefined): string | null {
  if (origin === undefined) return null;
  try {
    return normalizeHostname(new URL(origin).hostname);
  } catch {
    return null;
  }
}

/**
 * TECH-DESIGN §10: a closed CORS policy. Every request (HTTP and WebSocket upgrade) must carry an
 * allow-listed Host, and, when it carries an Origin, that origin must be allow-listed too. DNS-rebinding
 * is blocked by the Host check; a cross-site page cannot ride the browser's connection because its Origin
 * is refused. Scripts, the Companion and the OBS dock send no Origin and stay allowed.
 */
export function registerHostGuard(app: FastifyInstance, allowed: Set<string>): void {
  app.addHook('onRequest', async (req, reply) => {
    const host = hostOfHeader(req.headers.host);
    if (host === null || !allowed.has(host)) {
      return reply.code(403).send({ error: 'forbidden_host' });
    }
    if (req.headers.origin !== undefined) {
      const origin = hostOfOrigin(req.headers.origin);
      if (origin === null || !allowed.has(origin)) {
        return reply.code(403).send({ error: 'forbidden_origin' });
      }
    }
  });
}
