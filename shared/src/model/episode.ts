// SPDX-License-Identifier: GPL-2.0-or-later
import { Episode, SCHEMA_VERSION, type Block, type Format } from './format';

export interface NewEpisodeInput {
  id: string;
  date: string; // YYYY-MM-DD
  plannedStart: string | null; // ISO 8601 with offset
  playlistName: string | null;
}

export function formatDateIt(date: string): string {
  const [y, m, d] = date.split('-');
  return `${d}/${m}/${y}`;
}

export function rundownDurationMs(r: { blocks: Block[] }): number {
  return r.blocks.reduce((total, b) => total + b.durationMs, 0);
}

/** An episode is an independent deep copy of its format, stamped with a date. */
export function createEpisode(format: Format, input: NewEpisodeInput): Episode {
  const copy = structuredClone(format);
  return Episode.parse({
    schemaVersion: SCHEMA_VERSION,
    id: input.id,
    formatId: format.id,
    name: `${format.name} · ${formatDateIt(input.date)}`,
    date: input.date,
    plannedStart: input.plannedStart,
    playlistName: input.playlistName,
    preset: copy.preset,
    sceneGroups: copy.sceneGroups,
    messages: copy.messages,
    blocks: copy.blocks,
  });
}
