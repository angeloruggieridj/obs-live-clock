// SPDX-License-Identifier: GPL-2.0-or-later
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import type { FastifyInstance, FastifyReply } from 'fastify';

export const WEB_PAGES = ['presenter', 'dock', 'control', 'editor'] as const;

const ASSET_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]*$/;
/** Windows reserved device names: a valid asset name on paper, but not a real file on the build host. */
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\.|$)/i;
const NOT_BUILT = 'OBS Live Clock web app is not built. Run: pnpm --filter @olc/web build';
const MIME: Record<string, string> = {
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
};

function isNotFound(err: unknown): boolean {
  const code = (err as { code?: unknown }).code;
  return code === 'ENOENT' || code === 'ENOTDIR' || code === 'EISDIR';
}

/**
 * Serves the Vite build (TECH-DESIGN §8): one HTML entry per page, hashed assets under /assets. Hand-written
 * because @fastify/static pulls a BlueOak-licensed dependency. Registered after the host guard.
 */
export function registerStatic(app: FastifyInstance, opts: { root: string | null }): void {
  const notBuilt = (reply: FastifyReply) => reply.code(503).type('text/plain; charset=utf-8').send(NOT_BUILT);
  const notFound = (reply: FastifyReply) => reply.code(404).send({ error: 'not_found' });

  app.get('/', (_req, reply) => reply.redirect('/control', 302));

  for (const page of WEB_PAGES) {
    const handler = async (_req: unknown, reply: FastifyReply) => {
      if (opts.root === null) return notBuilt(reply);
      try {
        const html = await readFile(join(opts.root, page, 'index.html'));
        return reply
          .type('text/html; charset=utf-8')
          .header('cache-control', 'no-cache')
          .header('x-content-type-options', 'nosniff')
          .send(html);
      } catch (err) {
        if (isNotFound(err)) return notBuilt(reply);
        throw err;
      }
    };
    app.get(`/${page}`, handler);
    app.get(`/${page}/`, handler);
  }

  app.get<{ Params: { '*': string } }>('/assets/*', async (req, reply) => {
    const name = req.params['*'];
    if (opts.root === null || !ASSET_NAME.test(name) || WINDOWS_RESERVED.test(name)) return notFound(reply);
    try {
      const body = await readFile(join(opts.root, 'assets', name));
      return reply
        .type(MIME[extname(name).toLowerCase()] ?? 'application/octet-stream')
        .header('cache-control', 'public, max-age=31536000, immutable')
        .header('x-content-type-options', 'nosniff')
        .send(body);
    } catch (err) {
      if (isNotFound(err)) return notFound(reply);
      throw err;
    }
  });
}
