// SPDX-License-Identifier: GPL-2.0-or-later
import { createServer, type Server } from 'node:net';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseArgs, run, runLine } from '../src/cli';
import type { ObsSim } from '../src/index';

const servers: Server[] = [];

afterEach(async () => {
  while (servers.length > 0) {
    const server = servers.pop()!;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  vi.restoreAllMocks();
});

async function occupyPort(): Promise<number> {
  const server = createServer();
  servers.push(server);
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  return (server.address() as AddressInfo).port;
}

describe('obs-sim cli', () => {
  it('defaults to loopback and port 4455 and parses overrides', () => {
    expect(parseArgs([])).toEqual({ host: '127.0.0.1', port: 4455 });
    expect(parseArgs(['--host', '0.0.0.0', '--port', '1234'])).toEqual({ host: '0.0.0.0', port: 1234 });
  });

  it('prints a one-line error and exits 1 when the port is in use', async () => {
    const port = await occupyPort();
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const code = await run(['--host', '127.0.0.1', '--port', String(port)]);
    expect(code).toBe(1);
    expect(error).toHaveBeenCalledTimes(1);
    expect(String(error.mock.calls[0]?.[0])).toMatch(/^obs-sim: cannot listen on 127\.0\.0\.1:\d+/);
  });

  it('joins scene and input names containing spaces', () => {
    const calls: unknown[] = [];
    const sim = {
      setProgram: (scene: string) => calls.push(['program', scene]),
      setMedia: (input: string, media: unknown) => calls.push(['media', input, media]),
    } as unknown as ObsSim;

    runLine(sim, 'program CAM 1');
    runLine(sim, 'media Deck Media playing 1000 5000');

    expect(calls).toEqual([
      ['program', 'CAM 1'],
      ['media', 'Deck Media', { state: 'playing', cursor: 1000, duration: 5000 }],
    ]);
  });
});
