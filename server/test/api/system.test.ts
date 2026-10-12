// SPDX-License-Identifier: GPL-2.0-or-later
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { soloFutsalFormat } from '@olc/shared/testing';
import { FakeTime } from '../../src/clock/clock';
import { Settings } from '../../src/app/settings';
import type { ExitInfo, KioskProcess } from '../../src/kiosk/controller';
import { buildTestServer } from '../support/server';
import { tempDir } from '../support/tmp';

const apps: Array<{ close(): Promise<unknown> }> = [];
afterEach(async () => {
  while (apps.length > 0) await apps.pop()!.close();
});

class FakeBrowser implements KioskProcess {
  readonly pid = 4242;
  killed = false;
  kill(): void {
    this.killed = true;
  }
  onExit(_cb: (e: ExitInfo) => void): void {}
}

async function boot(opts: { settings?: Settings; dataDir?: string } = {}) {
  const dataDir = opts.dataDir ?? (await tempDir());
  const spawned: { command: string; args: string[]; proc: FakeBrowser }[] = [];
  const time = new FakeTime();
  const server = await buildTestServer({
    dataDir,
    clock: time,
    scheduler: time,
    settings: opts.settings,
    kioskDeps: {
      detect: async (override) => ({ kind: 'chrome', path: override ?? 'C:/chrome.exe' }),
      spawn: (command, args) => {
        const proc = new FakeBrowser();
        spawned.push({ command, args, proc });
        return proc;
      },
    },
  });
  apps.push(server.app);
  return { ...server, dataDir, spawned, time };
}

describe('GET /api/settings', () => {
  it('returns the settings without the OBS password', async () => {
    const settings = Settings.parse({ obs: { host: '10.0.0.5', port: 4455, password: 'hunter2' } });
    const { app } = await boot({ settings });
    const res = await app.inject({ method: 'GET', url: '/api/settings' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ port: 4460, lanAccess: false, obs: { host: '10.0.0.5', port: 4455, hasPassword: true } });
    expect(res.body).not.toContain('hunter2');
  });
});

describe('PUT /api/settings', () => {
  it('saves the kiosk block, keeps the rest of the file, and applies it at once', async () => {
    const dataDir = await tempDir();
    await writeFile(join(dataDir, 'settings.json'), JSON.stringify({ obs: { port: 4455, password: 'hunter2' } }));
    const settings = Settings.parse(JSON.parse(await readFile(join(dataDir, 'settings.json'), 'utf8')));
    const { app, spawned } = await boot({ dataDir, settings });
    const res = await app.inject({
      method: 'PUT',
      url: '/api/settings',
      payload: { kiosk: { enabled: true, screen: { kind: 'position', x: 1920, y: 0 } } },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().kiosk).toEqual({ enabled: true, screen: { kind: 'position', x: 1920, y: 0 }, restart: true });
    expect(res.body).not.toContain('hunter2');
    const onDisk = JSON.parse(await readFile(join(dataDir, 'settings.json'), 'utf8')) as { obs: { password: string }; kiosk: { enabled: boolean } };
    expect(onDisk.obs.password).toBe('hunter2');
    expect(onDisk.kiosk.enabled).toBe(true);
    expect(spawned).toHaveLength(1);
    expect(spawned[0]!.args).toContain('--window-position=1920,0');
  });

  it.each([
    ['unknown fields (port needs a restart and is edited in the file)', { kiosk: {}, port: 4999 }],
    ['an unknown screen kind', { kiosk: { screen: { kind: 'tv' } } }],
    ['no kiosk block', {}],
  ])('rejects %s with 400', async (_label, payload) => {
    const { app } = await boot();
    const res = await app.inject({ method: 'PUT', url: '/api/settings', payload });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'invalid_body' });
  });

  it('refuses with 409 when settings.json cannot be parsed, and leaves it alone', async () => {
    const dataDir = await tempDir();
    await writeFile(join(dataDir, 'settings.json'), '{ broken');
    const { app } = await boot({ dataDir });
    const res = await app.inject({ method: 'PUT', url: '/api/settings', payload: { kiosk: { enabled: true } } });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ error: 'settings_file_invalid' });
    expect(await readFile(join(dataDir, 'settings.json'), 'utf8')).toBe('{ broken');
  });

  it('refuses a browserPath change from a non-loopback request with 403 and echoes nothing', async () => {
    const { app, dataDir } = await boot();
    const res = await app.inject({
      method: 'PUT',
      url: '/api/settings',
      remoteAddress: '192.168.1.20',
      payload: { kiosk: { browserPath: 'C:/evil-browser.exe' } },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ error: 'forbidden' });
    expect(res.body).not.toContain('evil-browser');
    // Nothing was saved.
    await expect(readFile(join(dataDir, 'settings.json'), 'utf8')).rejects.toThrow();
  });

  it('lets a non-loopback request change the other kiosk fields', async () => {
    const { app } = await boot();
    const res = await app.inject({
      method: 'PUT',
      url: '/api/settings',
      remoteAddress: '192.168.1.20',
      payload: { kiosk: { enabled: true, screen: { kind: 'position', x: 100, y: 0 } } },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().kiosk).toMatchObject({ enabled: true, screen: { kind: 'position', x: 100, y: 0 } });
  });

  it('lets a loopback request set browserPath', async () => {
    const { app } = await boot();
    const res = await app.inject({
      method: 'PUT',
      url: '/api/settings',
      payload: { kiosk: { browserPath: 'C:/other-chrome.exe' } },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().kiosk.browserPath).toBe('C:/other-chrome.exe');
  });

  it('answers 200 with the saved settings when the kiosk cannot be applied afterwards', async () => {
    const dataDir = await tempDir();
    const time = new FakeTime();
    const server = await buildTestServer({
      dataDir,
      clock: time,
      scheduler: time,
      kioskDeps: {
        detect: async () => {
          throw new Error('detect failed');
        },
        spawn: () => new FakeBrowser(),
      },
    });
    apps.push(server.app);
    const res = await server.app.inject({ method: 'PUT', url: '/api/settings', payload: { kiosk: { enabled: true } } });
    expect(res.statusCode).toBe(200);
    expect(res.json().kiosk).toMatchObject({ enabled: true });
    const onDisk = JSON.parse(await readFile(join(dataDir, 'settings.json'), 'utf8')) as { kiosk: { enabled: boolean } };
    expect(onDisk.kiosk.enabled).toBe(true);
  });
});

describe('kiosk routes', () => {
  it('reports the status and starts and stops the browser on request', async () => {
    const settings = Settings.parse({ kiosk: { enabled: true } });
    const { app, spawned } = await boot({ settings });
    expect((await app.inject({ method: 'GET', url: '/api/kiosk' })).json()).toMatchObject({ enabled: true, state: 'stopped' });
    const started = await app.inject({ method: 'POST', url: '/api/kiosk/start' });
    expect(started.json()).toMatchObject({ state: 'running', pid: 4242 });
    expect(spawned).toHaveLength(1);
    const stopped = await app.inject({ method: 'POST', url: '/api/kiosk/stop' });
    expect(stopped.json()).toMatchObject({ state: 'stopped' });
    expect(spawned[0]!.proc.killed).toBe(true);
    const restarted = await app.inject({ method: 'POST', url: '/api/kiosk/restart' });
    expect(restarted.json()).toMatchObject({ state: 'running' });
    expect(spawned).toHaveLength(2);
  });

  it('closes the browser when the application shuts down', async () => {
    const settings = Settings.parse({ kiosk: { enabled: true } });
    const { app, spawned } = await boot({ settings });
    await app.inject({ method: 'POST', url: '/api/kiosk/start' });
    await app.close();
    expect(spawned[0]!.proc.killed).toBe(true);
  });
});

describe('screens from the plugin reach the kiosk', () => {
  it('a named monitor waits for the list, opens when the plugin reports it, and GET /api/screens shows it', async () => {
    const settings = Settings.parse({ kiosk: { enabled: true, screen: { kind: 'name', name: 'DISPLAY2' } } });
    const { app, spawned, dataDir, screens } = await boot({ settings });
    const token = (await readFile(join(dataDir, 'secret.token'), 'utf8')).trim();
    expect((await app.inject({ method: 'POST', url: '/api/kiosk/start' })).json()).toMatchObject({ state: 'waiting_for_screens' });
    const list = [
      { name: 'DISPLAY1', x: 0, y: 0, width: 1920, height: 1080, primary: true },
      { name: 'DISPLAY2', x: 1920, y: 0, width: 1920, height: 1080, primary: false },
    ];
    const post = await app.inject({ method: 'POST', url: '/api/internal/screens', headers: { authorization: `Bearer ${token}` }, payload: { screens: list } });
    expect(post.statusCode).toBe(204);
    await screens.flush();
    await vi.waitFor(() => expect(spawned).toHaveLength(1));
    expect(spawned[0]!.args).toContain('--window-position=1936,16');
    const shown = (await app.inject({ method: 'GET', url: '/api/screens' })).json() as { live: boolean; screens: unknown[] };
    expect(shown.live).toBe(true);
    expect(shown.screens).toHaveLength(2);
    expect(JSON.parse(await readFile(join(dataDir, 'screens.json'), 'utf8')).screens).toHaveLength(2);
  });

  it('the list is remembered across a restart (marked not live)', async () => {
    const dataDir = await tempDir();
    const first = await boot({ dataDir });
    const token = (await readFile(join(dataDir, 'secret.token'), 'utf8')).trim();
    await first.app.inject({
      method: 'POST',
      url: '/api/internal/screens',
      headers: { authorization: `Bearer ${token}` },
      payload: { screens: [{ name: 'DISPLAY1', x: 0, y: 0, width: 1920, height: 1080, primary: true }] },
    });
    await first.screens.flush();
    await first.app.close();
    apps.pop();
    const second = await boot({ dataDir });
    expect((await second.app.inject({ method: 'GET', url: '/api/screens' })).json()).toMatchObject({ live: false, screens: [{ name: 'DISPLAY1' }] });
  });
});

describe('hotkeys end to end through the internal route', () => {
  async function liveServer() {
    const boot1 = await boot();
    await boot1.app.inject({ method: 'POST', url: '/api/formats', payload: soloFutsalFormat() });
    await boot1.app.inject({
      method: 'POST',
      url: '/api/formats/solo-futsal/episodes',
      payload: { id: 'ep-1', date: '2026-10-12', plannedStart: null, playlistName: null },
    });
    await boot1.app.inject({ method: 'POST', url: '/api/live/load', payload: { episodeId: 'ep-1' } });
    const token = (await readFile(join(boot1.dataDir, 'secret.token'), 'utf8')).trim();
    const press = (slot: string, seq?: number) =>
      boot1.app.inject({
        method: 'POST',
        url: '/api/internal/hotkey',
        headers: { authorization: `Bearer ${token}` },
        payload: { slot, session: 'run-1', ...(seq === undefined ? {} : { seq }) },
      });
    return { ...boot1, press };
  }

  it('message slot 1 sends the first preset message of the loaded episode', async () => {
    const { press, runtime } = await liveServer();
    const first = runtime.getState()!.episode.messages[0]!;
    const res = await press('message-1');
    expect(res.json()).toMatchObject({ result: 'executed', slot: 'message-1' });
    expect(runtime.presenterView()!.message).toMatchObject({ text: first.text });
  });

  it('an emergency slot needs the second press, and the pending confirmation is visible to the dock', async () => {
    const { app, press, time } = await liveServer();
    expect((await press('control-toggle')).json()).toMatchObject({ result: 'pending' });
    expect((await app.inject({ method: 'GET', url: '/api/hotkeys/pending' })).json()).toMatchObject({ pending: { slot: 'control-toggle' } });
    time.mono += 300;
    expect((await press('control-toggle')).json()).toMatchObject({ result: 'executed', slot: 'control-toggle' });
    expect((await app.inject({ method: 'GET', url: '/api/hotkeys/pending' })).json()).toEqual({ pending: null });
  });

  it('a press with no episode loaded is ignored, not an error', async () => {
    const { app, dataDir } = await boot();
    const token = (await readFile(join(dataDir, 'secret.token'), 'utf8')).trim();
    const res = await app.inject({ method: 'POST', url: '/api/internal/hotkey', headers: { authorization: `Bearer ${token}` }, payload: { slot: 'next' } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ result: 'ignored', reason: 'no_episode' });
  });
});
