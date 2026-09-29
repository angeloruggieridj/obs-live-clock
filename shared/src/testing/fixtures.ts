// SPDX-License-Identifier: GPL-2.0-or-later
import { createEpisode } from '../model/episode';
import { presetForMode, type Episode, type Format, type ProductionMode } from '../model/format';

export function soloFutsalFormat(mode: ProductionMode = 'live_to_tape'): Format {
  return {
    schemaVersion: 1,
    id: 'solo-futsal',
    name: 'Solo Futsal',
    preset: presetForMode(mode),
    sceneGroups: [{ id: 'studio', name: 'Studio', scenes: ['CAM 1', 'CAM 2', 'CAM 3'] }],
    messages: [
      { id: 'stringi', text: 'STRINGI', dismiss: { kind: 'timeout', ms: 10_000 } },
      { id: 'cam2', text: 'GUARDA CAM 2', dismiss: { kind: 'manual' } },
    ],
    blocks: [
      {
        id: 'b1',
        kind: 'studio',
        name: 'Primo blocco',
        durationMs: 720_000,
        elastic: true,
        sceneGroupId: 'studio',
        elements: [
          { id: 'b1-s1', kind: 'studio' },
          {
            id: 'b1-m1',
            kind: 'media',
            title: 'Servizio 1',
            path: 'D:/media/servizio1.mp4',
            occurrence: 0,
            plannedDurationMs: 180_000,
          },
          { id: 'b1-s2', kind: 'studio' },
        ],
      },
      { id: 'br1', kind: 'break', name: 'Break 1', durationMs: 180_000, scene: 'BREAK', mediaInput: 'Tappo' },
      {
        id: 'b2',
        kind: 'studio',
        name: 'Secondo blocco',
        durationMs: 600_000,
        elastic: true,
        sceneGroupId: 'studio',
        elements: [
          { id: 'b2-s1', kind: 'studio' },
          {
            id: 'b2-m1',
            kind: 'media',
            title: 'Servizio 2',
            path: 'D:/media/servizio2.mp4',
            occurrence: 0,
            plannedDurationMs: 120_000,
          },
          { id: 'b2-s2', kind: 'studio' },
        ],
      },
      {
        id: 'b3',
        kind: 'studio',
        name: 'Chiusura',
        durationMs: 120_000,
        elastic: true,
        sceneGroupId: 'studio',
        elements: [{ id: 'b3-s1', kind: 'studio' }],
      },
    ],
  };
}

export function soloFutsalEpisode(mode: ProductionMode = 'live_to_tape'): Episode {
  return createEpisode(soloFutsalFormat(mode), {
    id: 'ep-2026-10-12',
    date: '2026-10-12',
    plannedStart: '2026-10-12T19:00:00+02:00',
    playlistName: 'Puntata del 12/10/2026',
  });
}

/** Playlist Deck `GetItems` result for the Solo Futsal episode. */
export const SOLO_FUTSAL_DECK = [
  { index: 0, path: 'D:/media/servizio1.mp4', title: 'Servizio 1', durationMs: 185_000 },
  { index: 1, path: 'D:/media/servizio2.mp4', title: 'Servizio 2', durationMs: 120_000 },
] as const;
