// SPDX-License-Identifier: GPL-2.0-or-later
import type { ApiClient } from '../../src/core/http';

export function fakeApi(over: Partial<ApiClient> = {}): ApiClient {
  return {
    listEpisodes: async () => [],
    loadEpisode: async () => {},
    obsStatus: async () => ({ connection: 'connected', deck: { capability: 'events' } }),
    ...over,
  };
}
