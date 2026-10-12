// SPDX-License-Identifier: GPL-2.0-or-later
import { EDITOR_MODULES, type EditorKey, type EditorT } from '../i18n';

export interface DisplayIssue {
  severity: 'error' | 'warning';
  code: string;
  blockId: string | null;
  /** English text from the validator or the server: shown as a detail, never as the main text. */
  message: string;
  source: 'rundown' | 'obs';
}

export interface IssueGroup {
  blockId: string | null;
  blockName: string | null;
  issues: DisplayIssue[];
}

/** The same problem reported many times (a repeated id gives one `duplicate_id` per occurrence) is shown once. */
export function dedupeIssues<T extends { severity: string; code: string; blockId: string | null; message: string }>(issues: readonly T[]): T[] {
  const seen = new Set<string>();
  return issues.filter((i) => {
    const key = `${i.severity}|${i.code}|${i.blockId ?? ''}|${i.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Whole-rundown issues first, then one group per block in rundown order; errors before warnings inside a group. */
export function groupByBlock(issues: readonly DisplayIssue[], blocks: ReadonlyArray<{ id: string; name: string }>): IssueGroup[] {
  const names = new Map(blocks.map((b) => [b.id, b.name]));
  const bySeverity = (list: DisplayIssue[]) => [...list.filter((i) => i.severity === 'error'), ...list.filter((i) => i.severity === 'warning')];
  const groups: IssueGroup[] = [];
  const global = issues.filter((i) => i.blockId === null || !names.has(i.blockId));
  if (global.length > 0) groups.push({ blockId: null, blockName: null, issues: bySeverity(global) });
  for (const b of blocks) {
    const mine = issues.filter((i) => i.blockId === b.id);
    if (mine.length > 0) groups.push({ blockId: b.id, blockName: b.name, issues: bySeverity(mine) });
  }
  return groups;
}

export function countBySeverity(issues: readonly { severity: string }[]): { errors: number; warnings: number } {
  return { errors: issues.filter((i) => i.severity === 'error').length, warnings: issues.filter((i) => i.severity === 'warning').length };
}

export const hasErrors = (issues: readonly { severity: string }[]): boolean => issues.some((i) => i.severity === 'error');

/** Translated text for a known code; the server's own message for a code this build does not know. */
export function issueText(t: EditorT, issue: Pick<DisplayIssue, 'code' | 'message'>): string {
  const key = `validation.code.${issue.code}`;
  return key in EDITOR_MODULES.validation.it ? t(key as EditorKey) : issue.message;
}
