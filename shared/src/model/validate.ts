// SPDX-License-Identifier: GPL-2.0-or-later
import type { Rundown, StudioBlock } from './format';

export type IssueSeverity = 'error' | 'warning';
export type IssueCode =
  | 'empty_rundown'
  | 'duplicate_id'
  | 'scene_group_missing'
  | 'media_exceeds_block'
  | 'studio_below_threshold'
  | 'scene_group_shared';

export interface Issue {
  severity: IssueSeverity;
  code: IssueCode;
  blockId: string | null;
  /** English, for logs. The UI translates by `code`. */
  message: string;
}

export function plannedStudioTimeMs(block: StudioBlock): number {
  const media = block.elements.reduce((t, e) => (e.kind === 'media' ? t + e.plannedDurationMs : t), 0);
  return block.durationMs - media;
}

export function validateRundown(r: Rundown): Issue[] {
  const issues: Issue[] = [];
  if (r.blocks.length === 0) {
    issues.push({ severity: 'error', code: 'empty_rundown', blockId: null, message: 'The rundown has no blocks' });
    return issues;
  }

  const seen = new Set<string>();
  const checkId = (id: string, blockId: string) => {
    if (seen.has(id)) {
      issues.push({ severity: 'error', code: 'duplicate_id', blockId, message: `Duplicate id "${id}"` });
    }
    seen.add(id);
  };

  const groupUse = new Map<string, string[]>();
  for (const b of r.blocks) {
    checkId(b.id, b.id);
    if (b.kind !== 'studio') continue;
    for (const e of b.elements) checkId(e.id, b.id);

    if (!r.sceneGroups.some((g) => g.id === b.sceneGroupId)) {
      issues.push({
        severity: 'error',
        code: 'scene_group_missing',
        blockId: b.id,
        message: `Block "${b.name}" uses unknown scene group "${b.sceneGroupId}"`,
      });
    }
    groupUse.set(b.sceneGroupId, [...(groupUse.get(b.sceneGroupId) ?? []), b.id]);

    const studio = plannedStudioTimeMs(b);
    if (studio < 0) {
      issues.push({
        severity: 'error',
        code: 'media_exceeds_block',
        blockId: b.id,
        message: `Media exceed block "${b.name}" by ${-studio} ms`,
      });
    } else if (studio < r.preset.warnMs) {
      issues.push({
        severity: 'warning',
        code: 'studio_below_threshold',
        blockId: b.id,
        message: `Block "${b.name}" leaves only ${studio} ms of studio time`,
      });
    }
  }

  for (const [groupId, blockIds] of groupUse) {
    if (blockIds.length > 1) {
      issues.push({
        severity: 'warning',
        code: 'scene_group_shared',
        blockId: null,
        message: `Blocks ${blockIds.join(', ')} share scene group "${groupId}" and are told apart by order`,
      });
    }
  }
  return issues;
}
