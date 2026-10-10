// SPDX-License-Identifier: GPL-2.0-or-later
import type { FastifyInstance, FastifyReply } from 'fastify';
import { z, ZodError } from 'zod';
import {
  ClientCommand,
  ClientRole,
  Episode,
  Format,
  MessageDismiss,
  PROTOCOL_VERSION,
  createEpisode,
  validateRundown,
} from '@olc/shared';
import { InvalidIdError, type DocumentRepository } from '../persistence/repository';
import { LiveRunningError, NoEpisodeError, type LiveRuntime } from '../runtime/live-runtime';

export interface HttpContext {
  formats: DocumentRepository<Format>;
  episodes: DocumentRepository<Episode>;
  runtime: LiveRuntime;
  version: string;
  instanceId: string;
}

const NewEpisodeBody = z.object({
  id: z.string().min(1),
  date: z.string(),
  plannedStart: z.string().nullable(),
  playlistName: z.string().nullable(),
});
const LoadBody = z.object({ episodeId: z.string().min(1) });
const SendMessageBody = z.union([
  z.object({ presetId: z.string().min(1) }),
  z.object({ text: z.string().min(1).max(200), dismiss: MessageDismiss }),
]);

type IdParams = { Params: { id: string } };

const notFound = (reply: FastifyReply) => reply.code(404).send({ error: 'not_found' });

export function registerHttp(app: FastifyInstance, ctx: HttpContext): void {
  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof InvalidIdError) return reply.code(400).send({ error: 'invalid_id' });
    if (err instanceof ZodError) return reply.code(400).send({ error: 'invalid_body', issues: err.issues });
    if (err instanceof NoEpisodeError) return reply.code(409).send({ error: 'no_episode' });
    if (err instanceof LiveRunningError) return reply.code(409).send({ error: 'live_running' });
    const status = (err as { statusCode?: unknown }).statusCode;
    if (typeof status === 'number' && status >= 400 && status < 500) {
      return reply.code(status).send({ error: 'bad_request' }); // e.g. malformed JSON body
    }
    reply.log.error(err);
    return reply.code(500).send({ error: 'internal' });
  });

  app.get('/api/health', async () => ({ version: ctx.version, protocol: PROTOCOL_VERSION, instanceId: ctx.instanceId }));

  // Formats
  app.get('/api/formats', async () => ctx.formats.list());
  app.get<IdParams>('/api/formats/:id', async (req, reply) => (await ctx.formats.get(req.params.id)) ?? notFound(reply));
  app.post('/api/formats', async (req, reply) => {
    const format = Format.parse(req.body);
    if ((await ctx.formats.get(format.id)) !== undefined) return reply.code(409).send({ error: 'exists' });
    return reply.code(201).send(await ctx.formats.put(format));
  });
  app.put<IdParams>('/api/formats/:id', async (req, reply) => {
    const format = Format.parse(req.body);
    if (format.id !== req.params.id) return reply.code(400).send({ error: 'id_mismatch' });
    return ctx.formats.put(format);
  });
  app.delete<IdParams>('/api/formats/:id', async (req, reply) =>
    (await ctx.formats.delete(req.params.id)) ? reply.code(204).send() : notFound(reply),
  );
  app.post<IdParams>('/api/formats/:id/episodes', async (req, reply) => {
    const body = NewEpisodeBody.parse(req.body);
    const format = await ctx.formats.get(req.params.id);
    if (format === undefined) return notFound(reply);
    if ((await ctx.episodes.get(body.id)) !== undefined) return reply.code(409).send({ error: 'exists' });
    return reply.code(201).send(await ctx.episodes.put(createEpisode(format, body)));
  });

  // Episodes
  app.get('/api/episodes', async () => ctx.episodes.list());
  app.get<IdParams>('/api/episodes/:id', async (req, reply) => (await ctx.episodes.get(req.params.id)) ?? notFound(reply));
  app.put<IdParams>('/api/episodes/:id', async (req, reply) => {
    const episode = Episode.parse(req.body);
    if (episode.id !== req.params.id) return reply.code(400).send({ error: 'id_mismatch' });
    if (ctx.runtime.isLive(episode.id)) return reply.code(409).send({ error: 'episode_live' });
    const saved = await ctx.episodes.put(episode);
    // The loaded episode is not live: reload it so the runtime and its snapshot use the new rundown.
    if (ctx.runtime.episodeId === episode.id) await ctx.runtime.load(episode);
    return saved;
  });
  app.delete<IdParams>('/api/episodes/:id', async (req, reply) => {
    if (ctx.runtime.episodeId === req.params.id) return reply.code(409).send({ error: 'episode_loaded' });
    return (await ctx.episodes.delete(req.params.id)) ? reply.code(204).send() : notFound(reply);
  });
  app.post<IdParams>('/api/episodes/:id/validate', async (req, reply) => {
    const episode = await ctx.episodes.get(req.params.id);
    return episode === undefined ? notFound(reply) : { issues: validateRundown(episode) };
  });

  // Live
  app.post('/api/live/load', async (req, reply) => {
    const { episodeId } = LoadBody.parse(req.body);
    const episode = await ctx.episodes.get(episodeId);
    if (episode === undefined) return notFound(reply);
    await ctx.runtime.load(episode);
    return { episodeId };
  });
  app.post('/api/live/unload', async (_req, reply) => {
    await ctx.runtime.unload();
    return reply.code(204).send();
  });
  app.get<{ Querystring: { role?: string } }>('/api/live/view', async (req, reply) => {
    const role = ClientRole.safeParse(req.query.role ?? 'presenter');
    if (!role.success) return reply.code(400).send({ error: 'invalid_role' });
    const view = role.data === 'presenter' ? ctx.runtime.presenterView() : ctx.runtime.controlView();
    return view ?? reply.code(404).send({ error: 'no_episode' });
  });
  app.post('/api/live/command', async (req) => ({ changed: ctx.runtime.command(ClientCommand.parse(req.body)) }));

  // Public message endpoints (Stream Deck, Companion, scripts — F17)
  app.post('/api/messages/send', async (req, reply) => {
    const body = SendMessageBody.parse(req.body);
    if ('presetId' in body) {
      const preset = ctx.runtime.getState()?.episode.messages.find((m) => m.id === body.presetId);
      if (preset === undefined) {
        if (ctx.runtime.episodeId === null) throw new NoEpisodeError();
        return reply.code(404).send({ error: 'unknown_preset' });
      }
      return { changed: ctx.runtime.command({ name: 'send_message', text: preset.text, dismiss: preset.dismiss }) };
    }
    return { changed: ctx.runtime.command({ name: 'send_message', text: body.text, dismiss: body.dismiss }) };
  });
  app.post('/api/messages/clear', async () => ({ changed: ctx.runtime.command({ name: 'clear_message' }) }));
}
