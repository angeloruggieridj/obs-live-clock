// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it, vi } from 'vitest';
import { ApiError, httpApi } from '../../src/core/http';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

describe('httpApi: hotkeys, screens, kiosk', () => {
  it('hotkeyPending returns the pending confirmation or null', async () => {
    const fetchFn = vi.fn(async () => json({ pending: { slot: 'next', remainingMs: 640 } }));
    expect(await httpApi(fetchFn).hotkeyPending()).toEqual({ slot: 'next', remainingMs: 640 });
    expect(fetchFn).toHaveBeenCalledWith('/api/hotkeys/pending');
    expect(await httpApi(async () => json({ pending: null })).hotkeyPending()).toBeNull();
  });

  it('kioskAction POSTs to the right path and parses the status', async () => {
    const fetchFn = vi.fn(async () => json({ state: 'running', enabled: true, pid: 7, restarts: 0, browser: 'chrome.exe', screen: 'DISPLAY2' }));
    const status = await httpApi(fetchFn).kioskAction('restart');
    expect(status.state).toBe('running');
    expect(fetchFn).toHaveBeenCalledWith('/api/kiosk/restart', { method: 'POST' });
  });

  it('screens parses the plugin list', async () => {
    const api = httpApi(async () => json({ live: true, screens: [{ name: 'D1', x: 0, y: 0, width: 1920, height: 1080, devicePixelRatio: 1, primary: true }] }));
    expect(await api.screens()).toEqual({ live: true, screens: [{ name: 'D1', width: 1920, height: 1080, primary: true }] });
  });

  it('kioskConfig reads only the kiosk block and never touches the OBS settings', async () => {
    const api = httpApi(async () => json({ port: 4460, lanAccess: false, obs: { host: 'x', port: 1, hasPassword: true }, kiosk: { enabled: true, screen: { kind: 'primary' }, restart: true } }));
    expect(await api.kioskConfig()).toEqual({ enabled: true, screen: { kind: 'primary' }, restart: true });
  });

  it('saveKioskConfig PUTs {kiosk} as JSON', async () => {
    const fetchFn = vi.fn(async () => json({ kiosk: { enabled: false, screen: { kind: 'name', name: 'D2' }, restart: true } }));
    await httpApi(fetchFn).saveKioskConfig({ enabled: false, screen: { kind: 'name', name: 'D2' }, restart: true });
    expect(fetchFn).toHaveBeenCalledWith('/api/settings', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ kiosk: { enabled: false, screen: { kind: 'name', name: 'D2' }, restart: true } }),
    });
  });

  it('an error answer becomes an ApiError with the server code', async () => {
    const api = httpApi(async () => json({ error: 'settings_file_invalid' }, 409));
    await expect(api.saveKioskConfig({ enabled: true, screen: { kind: 'primary' }, restart: true })).rejects.toMatchObject({
      status: 409,
      code: 'settings_file_invalid',
    });
    await expect(api.saveKioskConfig({ enabled: true, screen: { kind: 'primary' }, restart: true })).rejects.toBeInstanceOf(ApiError);
  });
});
