// SPDX-License-Identifier: GPL-2.0-or-later
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Episode } from '@olc/shared';
import type { Clock, Scheduler } from '../clock/clock';
import type { DeckItem } from '../engine/index';
import type { ObsData } from '../obs/client';
import type { ObsService, ObsStatus } from '../obs/obs-service';
import type { DocumentRepository } from '../persistence/repository';

/** One problem found by Check OBS (SPEC F7). `blockId` is the offending block, or `null` for whole-OBS issues. */
export interface Issue {
  severity: 'error' | 'warning';
  code: string;
  blockId: string | null;
  message: string;
}

export interface ObsRoutesContext {
  obs: Pick<ObsService, 'status' | 'sceneNames' | 'deckItems' | 'client'>;
  episodes: DocumentRepository<Episode>;
  clock: Clock;
  scheduler: Scheduler;
}

const CheckBody = z.object({ episodeId: z.string().min(1) });

/** An OBS request that never settles must not hang Check OBS: the input read is raced against this. */
const INPUT_READ_TIMEOUT_MS = 4_000;

const NOT_CONNECTED: Issue = {
  severity: 'error',
  code: 'obs_not_connected',
  blockId: null,
  message: 'OBS is not connected',
};

export function registerObsRoutes(app: FastifyInstance, ctx: ObsRoutesContext): void {
  app.get('/api/obs/status', async () => ctx.obs.status());

  app.get('/api/obs/scenes', async (_req, reply) => {
    const scenes = ctx.obs.sceneNames();
    if (scenes === null) return reply.code(409).send({ error: 'obs_not_connected' });
    return { scenes };
  });

  app.get('/api/deck/items', async (_req, reply) => {
    const status = ctx.obs.status();
    if (status.connection !== 'connected') return reply.code(409).send({ error: 'obs_not_connected' });
    // Only the vendor genuinely being missing is a 404: a deck that is present but has not completed its first
    // read yet is a "come back later", not an absent plugin.
    if (status.deck?.capability === 'absent') return reply.code(404).send({ error: 'deck_absent' });
    const items = ctx.obs.deckItems();
    if (items === null) return reply.code(409).send({ error: 'deck_not_ready' });
    return { items: withOccurrences(items) };
  });

  app.post('/api/obs/check', async (req, reply) => {
    const parsed = CheckBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_body' });
    const episode = await ctx.episodes.get(parsed.data.episodeId);
    if (episode === undefined) return reply.code(404).send({ error: 'not_found' });
    const before = ctx.obs.status();
    if (before.connection !== 'connected') return notConnectedResponse(before);
    const issues = await checkIssues(ctx, episode);
    // The reads inside `checkIssues` (the input list above all) can outlive the connection: never answer with
    // issues from one snapshot labelled as a connected OBS that has since dropped.
    const after = ctx.obs.status();
    if (after.connection !== 'connected') return notConnectedResponse(after);
    return {
      connected: true,
      obsWebSocketVersion: before.obsWebSocketVersion,
      deck: before.deck,
      issues,
    };
  });
}

function notConnectedResponse(status: ObsStatus): {
  connected: false;
  obsWebSocketVersion: string | null;
  deck: ObsStatus['deck'];
  issues: Issue[];
} {
  return {
    connected: false,
    obsWebSocketVersion: status.obsWebSocketVersion,
    deck: status.deck,
    issues: [NOT_CONNECTED],
  };
}

/** Adds the 0-based count of earlier items sharing the same path, used by the editor to create media elements. */
function withOccurrences(items: DeckItem[]): Array<DeckItem & { occurrence: number }> {
  const seen = new Map<string, number>();
  return items.map((item) => {
    const occurrence = seen.get(item.path) ?? 0;
    seen.set(item.path, occurrence + 1);
    return { ...item, occurrence };
  });
}

async function checkIssues(ctx: ObsRoutesContext, episode: Episode): Promise<Issue[]> {
  const issues: Issue[] = [];
  const scenes = new Set(ctx.obs.sceneNames() ?? []);
  const groups = new Map(episode.sceneGroups.map((group) => [group.id, group]));
  // `null` means `GetInputList` failed: media inputs cannot be verified, so they are skipped rather than
  // reported as missing.
  const inputs = await readInputs(ctx);

  for (const block of episode.blocks) {
    if (block.kind === 'break') {
      if (!scenes.has(block.scene)) {
        issues.push({
          severity: 'error',
          code: 'scene_missing',
          blockId: block.id,
          message: `Scene "${block.scene}" is not in OBS`,
        });
      }
      if (block.mediaInput !== null && inputs !== null && !inputs.has(block.mediaInput)) {
        issues.push({
          severity: 'error',
          code: 'media_input_missing',
          blockId: block.id,
          message: `Media input "${block.mediaInput}" is not in OBS`,
        });
      }
      continue;
    }
    for (const scene of groups.get(block.sceneGroupId)?.scenes ?? []) {
      if (!scenes.has(scene)) {
        issues.push({
          severity: 'error',
          code: 'scene_missing',
          blockId: block.id,
          message: `Scene "${scene}" is not in OBS`,
        });
      }
    }
  }

  issues.push(...deckIssues(ctx, episode));
  return issues;
}

async function readInputs(ctx: ObsRoutesContext): Promise<Set<string> | null> {
  const client = ctx.obs.client();
  if (client === null) return null;
  try {
    const res = await withTimeout(ctx, client.call('GetInputList'));
    const raw = Array.isArray(res.inputs) ? res.inputs : [];
    const names = new Set<string>();
    for (const entry of raw as ObsData[]) {
      if (entry !== null && typeof entry === 'object' && typeof entry.inputName === 'string') names.add(entry.inputName);
    }
    return names;
  } catch {
    return null;
  }
}

/**
 * Resolves with `promise`, or rejects after `INPUT_READ_TIMEOUT_MS` on the injected scheduler. An OBS request
 * that never settles must not hang Check OBS; a timeout is treated like any other failed read, and the losing
 * promise's late result is dropped.
 */
function withTimeout<T>(ctx: ObsRoutesContext, promise: Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const cancel = ctx.scheduler.setTimer(ctx.clock.now() + INPUT_READ_TIMEOUT_MS, () => {
      settled = true;
      reject(new Error('GetInputList timed out'));
    });
    promise.then(
      (value) => {
        if (settled) return;
        settled = true;
        cancel();
        resolve(value);
      },
      (err: unknown) => {
        if (settled) return;
        settled = true;
        cancel();
        reject(err);
      },
    );
  });
}

function deckIssues(ctx: ObsRoutesContext, episode: Episode): Issue[] {
  const issues: Issue[] = [];
  const elements: Array<{ blockId: string; path: string; occurrence: number }> = [];
  for (const block of episode.blocks) {
    if (block.kind !== 'studio') continue;
    for (const element of block.elements) {
      if (element.kind === 'media') elements.push({ blockId: block.id, path: element.path, occurrence: element.occurrence });
    }
  }
  if (elements.length === 0) return issues;

  const capability = ctx.obs.status().deck?.capability ?? 'absent';
  if (capability === 'absent') {
    issues.push({
      severity: 'error',
      code: 'deck_absent',
      blockId: null,
      message: 'The Playlist Deck plugin is not installed',
    });
    return issues;
  }
  if (capability === 'legacy') {
    issues.push({
      severity: 'warning',
      code: 'deck_legacy',
      blockId: null,
      message: 'The Playlist Deck plugin is older than 1.4.0',
    });
  }

  const items = ctx.obs.deckItems();
  if (items === null) return issues;
  const byPath = new Map<string, DeckItem[]>();
  for (const item of items) {
    const list = byPath.get(item.path);
    if (list === undefined) byPath.set(item.path, [item]);
    else list.push(item);
  }
  for (const element of elements) {
    const item = byPath.get(element.path)?.[element.occurrence];
    if (item === undefined) {
      issues.push({
        severity: 'error',
        code: 'deck_item_missing',
        blockId: element.blockId,
        message: `Playlist item "${element.path}" (occurrence ${element.occurrence}) is not in the deck`,
      });
      continue;
    }
    if (item.durationMs < 0) {
      issues.push({
        severity: 'warning',
        code: 'deck_duration_unknown',
        blockId: element.blockId,
        message: `Playlist item "${element.path}" has no known duration`,
      });
    }
  }
  return issues;
}
