// SPDX-License-Identifier: GPL-2.0-or-later
import { SCHEMA_VERSION, presetForMode, type Format } from '@olc/shared';

/** A new format: one studio block, one scene group with a placeholder scene the director renames. */
export function blankFormat(name: string, id: string): Format {
  return {
    schemaVersion: SCHEMA_VERSION,
    id,
    name,
    preset: presetForMode('streaming'),
    sceneGroups: [{ id: 'studio', name: 'Studio', scenes: ['SCENA 1'] }],
    messages: [],
    blocks: [
      {
        id: 'blk-1',
        kind: 'studio',
        name: 'Blocco 1',
        durationMs: 300_000,
        elastic: true,
        sceneGroupId: 'studio',
        elements: [{ id: 'el-1', kind: 'studio' }],
      },
    ],
  };
}
