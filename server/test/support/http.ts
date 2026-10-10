// SPDX-License-Identifier: GPL-2.0-or-later
import { join } from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import { Episode, Format } from '@olc/shared';
import { registerHttp } from '../../src/api/http';
import { DocumentRepository } from '../../src/persistence/repository';
import { makeRuntime, type RuntimeHarness } from './runtime';
import { tempDir } from './tmp';

export interface HttpHarness extends RuntimeHarness {
  app: FastifyInstance;
}

export async function makeHttp(): Promise<HttpHarness> {
  const dir = await tempDir();
  const h = makeRuntime(dir);
  const app = Fastify();
  registerHttp(app, {
    formats: new DocumentRepository(join(dir, 'formats'), Format),
    episodes: new DocumentRepository(join(dir, 'episodes'), Episode),
    runtime: h.runtime,
    version: '0.1.0-test',
    instanceId: 'instance-test',
  });
  await app.ready();
  return { ...h, app };
}
