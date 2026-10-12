// SPDX-License-Identifier: GPL-2.0-or-later
import type { ApiClient } from '../../src/core/http';

export function fakeApi(over: Partial<ApiClient> = {}): ApiClient {
  return {
    listEpisodes: async () => [],
    loadEpisode: async () => {},
    obsStatus: async () => ({ connection: 'connected', deck: { capability: 'events' } }),
    hotkeyPending: async () => null,
    kioskStatus: async () => ({ state: 'disabled', enabled: false, pid: null, restarts: 0, browser: null, screen: null }),
    kioskAction: async () => ({ state: 'running', enabled: true, pid: 1, restarts: 0, browser: 'chrome.exe', screen: 'DISPLAY2' }),
    screens: async () => ({ screens: [], live: false }),
    kioskConfig: async () => ({ enabled: false, screen: { kind: 'primary' }, restart: true }),
    saveKioskConfig: async (kiosk) => kiosk,
    ...over,
  };
}
