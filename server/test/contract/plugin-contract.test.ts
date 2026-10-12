// SPDX-License-Identifier: GPL-2.0-or-later
// The server side of the plugin <-> app contract. plugin/tests/test_contract.cpp reads the same file.
// Part 2 drives the REAL C++ core (olc-cli) against a REAL server; it runs only when OLC_CLI points at the binary
// (built by `plugin/scripts/test.sh` style builds that have libcurl; CI runs it on Ubuntu).
import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { delimiter, join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import { PROTOCOL_VERSION } from '@olc/shared';
import { soloFutsalFormat } from '@olc/shared/testing';
import { defaultDataDir } from '../../src/app/paths';
import { writeRuntimeFile } from '../../src/app/runtime-file';
import { HOTKEY_SLOT_IDS, EMERGENCY_SLOTS } from '../../src/hotkeys/slots';
import { buildTestServer } from '../support/server';
import { FakeObsClient } from '../support/fake-obs';
import { tempDir } from '../support/tmp';

interface Contract {
  protocol: number;
  health: Record<string, unknown>;
  runtimeJson: Record<string, unknown>;
  dataDirVectors: { platform: NodeJS.Platform; env: Record<string, string>; home: string; expected: string }[];
  slots: { id: string; obsName: string; description: string; emergency: boolean }[];
}
const contract = JSON.parse(readFileSync(new URL('../../../plugin/contract/plugin-contract.json', import.meta.url), 'utf8')) as Contract;
const run = promisify(execFile);

const apps: Array<{ close(): Promise<unknown> }> = [];
afterEach(async () => {
  while (apps.length > 0) await apps.pop()!.close();
});

describe('plugin contract (server side)', () => {
  it('speaks the protocol version the plugin was written for', () => {
    expect(contract.protocol).toBe(PROTOCOL_VERSION);
  });

  it('GET /api/health has exactly the fields the plugin parses', async () => {
    const server = await buildTestServer({ dataDir: await tempDir() });
    apps.push(server.app);
    const body = (await server.app.inject({ method: 'GET', url: '/api/health' })).json() as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(Object.keys(contract.health).sort());
    expect(body.protocol).toBe(contract.protocol);
    expect(typeof body.version).toBe('string');
    expect(typeof body.instanceId).toBe('string');
  });

  it('runtime.json carries the keys the plugin reads', async () => {
    const path = join(await tempDir(), 'runtime.json');
    await writeRuntimeFile(path, { port: 4460, pid: 1234, instanceId: 'x', version: '0.1.0', protocol: PROTOCOL_VERSION });
    const written = JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>;
    for (const key of Object.keys(contract.runtimeJson)) expect(written).toHaveProperty(key);
  });

  it('defaultDataDir gives the folder the plugin computes, for every vector', () => {
    for (const v of contract.dataDirVectors) {
      expect(defaultDataDir(v.env, v.platform, v.home).replaceAll('\\', '/')).toBe(v.expected);
    }
  });

  it('the hotkey slot ids, their order and which ones are emergency match the plugin table', () => {
    expect(contract.slots.map((s) => s.id)).toEqual([...HOTKEY_SLOT_IDS]);
    expect(contract.slots.filter((s) => s.emergency).map((s) => s.id).sort()).toEqual([...EMERGENCY_SLOTS].sort());
    for (const s of contract.slots) {
      expect(s.obsName.startsWith('obs-live-clock.')).toBe(true);
      expect(s.description.startsWith('OBS Live Clock: ')).toBe(true);
    }
  });
});

const cli = process.env.OLC_CLI;

class SpyObs extends FakeObsClient {
  readonly connects: { url: string; password: string | undefined }[] = [];
  override async connect(url: string, password: string | undefined) {
    this.connects.push({ url, password });
    return super.connect(url, password);
  }
}

describe.skipIf(cli === undefined)('the real C++ core (olc-cli) against the real server', () => {
  async function boot() {
    const dataDir = await tempDir();
    const spy = new SpyObs();
    const server = await buildTestServer({ dataDir, obsClientFactory: () => spy });
    apps.push(server.app);
    await server.app.listen({ port: 0, host: '127.0.0.1' });
    const port = (server.app.server.address() as { port: number }).port;
    await writeRuntimeFile(join(dataDir, 'runtime.json'), { port, pid: process.pid, instanceId: server.instanceId, version: '0.1.0', protocol: PROTOCOL_VERSION });
    const env = { ...process.env, PATH: [process.env.OLC_CLI_DLL_DIR, process.env.PATH].filter(Boolean).join(delimiter) };
    const exec = (args: string[]) => run(cli!, args, { env, timeout: 20_000 });
    return { ...server, dataDir, spy, exec };
  }

  it('hands over the obs-websocket credentials and the screen list with zero configuration', async () => {
    const { dataDir, spy, exec, app } = await boot();
    const wsConfig = join(dataDir, 'ws.json');
    await writeFile(wsConfig, JSON.stringify({ server_enabled: true, server_port: 4466, auth_required: true, server_password: 'cli-pw-123' }));
    const screens = join(dataDir, 'screens-in.json');
    await writeFile(screens, JSON.stringify([{ name: 'DISPLAY2', x: 1920, y: 0, width: 1920, height: 1080, devicePixelRatio: 1, primary: false }]));
    const { stdout, stderr } = await exec(['supervise', '--data-dir', dataDir, '--ws-config', wsConfig, '--screens', screens, '--seconds', '3', '--no-launch']);
    const status = JSON.parse(stdout.trim().split('\n').at(-1)!) as { phase: string; credentials: string };
    expect(status).toMatchObject({ phase: 'running', credentials: 'delivered' });
    expect(spy.connects[0]).toEqual({ url: 'ws://127.0.0.1:4466', password: 'cli-pw-123' });
    expect(stderr).not.toContain('cli-pw-123');
    expect(((await app.inject({ method: 'GET', url: '/api/screens' })).json() as { live: boolean }).live).toBe(true);
  });

  it('delivers presses in order: a message executes, an emergency slot needs the second press', async () => {
    const { dataDir, exec, app } = await boot();
    await app.inject({ method: 'POST', url: '/api/formats', payload: soloFutsalFormat() });
    await app.inject({ method: 'POST', url: '/api/formats/solo-futsal/episodes', payload: { id: 'ep-1', date: '2026-10-12', plannedStart: null, playlistName: null } });
    await app.inject({ method: 'POST', url: '/api/live/load', payload: { episodeId: 'ep-1' } });
    const lines = (out: string) => out.trim().split('\n').map((l) => JSON.parse(l) as { status: number; body: string });
    const message = lines((await exec(['hotkey', '--data-dir', dataDir, '--slot', 'message-1'])).stdout);
    expect(message[0]!.status).toBe(200);
    expect(JSON.parse(message[0]!.body)).toMatchObject({ result: 'executed' });
    const twice = lines((await exec(['hotkey', '--data-dir', dataDir, '--slot', 'control-toggle', '--presses', '2', '--gap-ms', '300'])).stdout);
    expect(twice.map((l) => (JSON.parse(l.body) as { result: string }).result)).toEqual(['pending', 'executed']);
  });

  it('a rejected token is reported, not hidden (wrong secret.token)', async () => {
    const { dataDir, exec } = await boot();
    await writeFile(join(dataDir, 'secret.token'), 'not-the-token');
    const out = (await exec(['hotkey', '--data-dir', dataDir, '--slot', 'clear'])).stdout;
    expect((JSON.parse(out.trim()) as { status: number }).status).toBe(401);
  });
});
