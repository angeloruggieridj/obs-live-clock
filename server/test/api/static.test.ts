// SPDX-License-Identifier: GPL-2.0-or-later
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import Fastify from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { registerStatic } from '../../src/api/static';
import { buildTestServer } from '../support/server';
import { tempDir } from '../support/tmp';

const closers: Array<() => Promise<unknown>> = [];
afterEach(async () => {
  while (closers.length > 0) await closers.pop()!();
});

async function webRoot(pages: string[] = ['presenter', 'dock', 'control']): Promise<string> {
  const root = await tempDir();
  for (const page of pages) {
    await mkdir(join(root, page), { recursive: true });
    await writeFile(join(root, page, 'index.html'), `<html>${page}</html>`);
  }
  await mkdir(join(root, 'assets'), { recursive: true });
  await writeFile(join(root, 'assets', 'presenter-abc123.js'), 'console.log(1)');
  await writeFile(join(root, 'assets', '_helper-abc.js'), 'console.log(2)');
  await writeFile(join(root, 'assets', 'inter-latin-700-normal-x1.woff2'), Buffer.from([0x77, 0x4f, 0x46, 0x32]));
  await writeFile(join(root, 'secret.txt'), 'nope');
  return root;
}

async function app(root: string | null) {
  const a = Fastify();
  registerStatic(a, { root });
  closers.push(() => a.close());
  return a;
}

describe('static web app', () => {
  it('serves each page with and without the trailing slash, uncached', async () => {
    const a = await app(await webRoot());
    for (const page of ['presenter', 'dock', 'control']) {
      for (const url of [`/${page}`, `/${page}/`, `/${page}?lang=en&screen=tv-1`]) {
        const res = await a.inject({ method: 'GET', url });
        expect(res.statusCode, url).toBe(200);
        expect(res.headers['content-type']).toBe('text/html; charset=utf-8');
        expect(res.headers['cache-control']).toBe('no-cache');
        expect(res.headers['x-content-type-options']).toBe('nosniff');
        expect(res.body).toBe(`<html>${page}</html>`);
      }
    }
  });

  it('redirects the root to the control view', async () => {
    const res = await (await app(await webRoot())).inject({ method: 'GET', url: '/' });
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe('/control');
  });

  it('serves hashed assets as immutable with the right type', async () => {
    const a = await app(await webRoot());
    const js = await a.inject({ method: 'GET', url: '/assets/presenter-abc123.js' });
    expect(js.statusCode).toBe(200);
    expect(js.headers['content-type']).toBe('text/javascript; charset=utf-8');
    expect(js.headers['cache-control']).toBe('public, max-age=31536000, immutable');
    expect(js.body).toBe('console.log(1)');
    const helper = await a.inject({ method: 'GET', url: '/assets/_helper-abc.js' });
    expect(helper.statusCode).toBe(200);
    expect(helper.body).toBe('console.log(2)');
    const font = await a.inject({ method: 'GET', url: '/assets/inter-latin-700-normal-x1.woff2' });
    expect(font.headers['content-type']).toBe('font/woff2');
    const head = await a.inject({ method: 'HEAD', url: '/presenter' });
    expect(head.statusCode).toBe(200);
    expect(head.body).toBe('');
  });

  it('refuses traversal, sub-paths, Windows device names and unknown assets with 404', async () => {
    const a = await app(await webRoot());
    for (const url of [
      '/assets/missing.js',
      '/assets/..%2Fsecret.txt',
      '/assets/%2e%2e%2fsecret.txt',
      '/assets/a/b.js',
      '/assets/.hidden',
      '/assets/..%5Csecret.txt',
      '/assets/a%5Cb',
      '/assets/con.js',
      '/assets/NUL.txt',
    ]) {
      const res = await a.inject({ method: 'GET', url });
      expect(res.statusCode, url).toBe(404);
      expect(res.json(), url).toEqual({ error: 'not_found' });
    }
    // Fastify normalises this one to /x before routing; it is still refused with a 404.
    expect((await a.inject({ method: 'GET', url: '/assets/../x' })).statusCode).toBe(404);
  });

  it('answers 503 with build instructions when the app is not built', async () => {
    const a = await app(null);
    const res = await a.inject({ method: 'GET', url: '/presenter' });
    expect(res.statusCode).toBe(503);
    expect(res.headers['content-type']).toBe('text/plain; charset=utf-8');
    expect(res.body).toContain('pnpm --filter @olc/web build');
    expect((await a.inject({ method: 'GET', url: '/assets/x.js' })).statusCode).toBe(404);
    const partial = await app(await webRoot(['presenter']));
    expect((await partial.inject({ method: 'GET', url: '/control' })).statusCode).toBe(503);
  });

  it('stays behind the host guard inside the real server', async () => {
    const root = await webRoot();
    const { app: server } = await buildTestServer({ dataDir: await tempDir(), webRoot: root });
    closers.push(() => server.close());
    expect((await server.inject({ method: 'GET', url: '/presenter', headers: { host: '127.0.0.1:4460' } })).statusCode).toBe(200);
    expect((await server.inject({ method: 'GET', url: '/presenter', headers: { host: 'evil.example' } })).statusCode).toBe(403);
    expect((await server.inject({ method: 'GET', url: '/api/health', headers: { host: '127.0.0.1:4460' } })).statusCode).toBe(200);
  });
});
