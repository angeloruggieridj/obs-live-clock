// SPDX-License-Identifier: GPL-2.0-or-later
// Dev only: create the Solo Futsal format and a rehearsal episode on a running server, and load it.
import { soloFutsalFormat } from '@olc/shared/testing';

const BASE = process.env.OLC_URL ?? 'http://127.0.0.1:4460';

function post(path: string, body: unknown): Promise<Response> {
  return fetch(`${BASE}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
}

async function main(): Promise<void> {
  const format = await post('/api/formats', soloFutsalFormat());
  if (format.status !== 201 && format.status !== 409) throw new Error(`format: HTTP ${format.status}`);
  const id = 'ep-dev';
  const plannedStart = new Date(Date.now() + 5 * 60_000).toISOString();
  const episode = await post('/api/formats/solo-futsal/episodes', { id, date: plannedStart.slice(0, 10), plannedStart, playlistName: null });
  if (episode.status !== 201 && episode.status !== 409) throw new Error(`episode: HTTP ${episode.status}`);
  const load = await post('/api/live/load', { episodeId: id });
  if (load.status === 409) {
    console.log('seed: a live show is running; ep-dev not loaded');
    return;
  }
  if (!load.ok) throw new Error(`load: HTTP ${load.status}`);
  console.log(`seed: loaded ${id}${episode.status === 201 ? ` (planned start ${plannedStart})` : ' (existing episode; delete .dev-data to reset)'}`);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
