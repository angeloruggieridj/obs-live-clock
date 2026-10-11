// SPDX-License-Identifier: GPL-2.0-or-later
import { useEffect, useState } from 'react';
import type { ApiClient, ObsStatusLite } from '../../core/http';

export const OBS_STATUS_POLL_MS = 5_000;

/** Polls GET /api/obs/status. null while unknown or on error: no alert is better than a guessed one. */
export function useObsStatus(api: ApiClient, intervalMs = OBS_STATUS_POLL_MS): ObsStatusLite | null {
  const [status, setStatus] = useState<ObsStatusLite | null>(null);
  useEffect(() => {
    let alive = true;
    const poll = () => {
      api.obsStatus().then(
        (s) => {
          if (alive) setStatus(s);
        },
        () => {
          if (alive) setStatus(null);
        },
      );
    };
    poll();
    const handle = setInterval(poll, intervalMs);
    return () => {
      alive = false;
      clearInterval(handle);
    };
  }, [api, intervalMs]);
  return status;
}
