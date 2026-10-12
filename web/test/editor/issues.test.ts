// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import { createEditorT } from '../../src/editor/i18n';
import { countBySeverity, dedupeIssues, groupByBlock, hasErrors, issueText, type DisplayIssue } from '../../src/editor/validation/issues';

const issue = (over: Partial<DisplayIssue>): DisplayIssue => ({ severity: 'error', code: 'duplicate_id', blockId: 'b1', message: 'm', source: 'rundown', ...over });
const blocks = [{ id: 'b1', name: 'Uno' }, { id: 'b2', name: 'Due' }];

describe('issues', () => {
  it('dedupes the same problem reported several times', () => {
    const list = [issue({}), issue({}), issue({}), issue({ blockId: 'b2' })];
    expect(dedupeIssues(list)).toHaveLength(2);
  });

  it('groups whole-rundown issues first, then blocks in order, errors before warnings', () => {
    const g = groupByBlock(
      [issue({ blockId: 'b2' }), issue({ blockId: 'b1', severity: 'warning', code: 'a' }), issue({ blockId: 'b1', code: 'b' }), issue({ blockId: null, code: 'g' }), issue({ blockId: 'gone', code: 'h' })],
      blocks,
    );
    expect(g.map((x) => x.blockId)).toEqual([null, 'b1', 'b2']);
    expect(g[0]!.issues.map((i) => i.code)).toEqual(['g', 'h']); // a block that no longer exists is a general issue
    expect(g[1]!.issues.map((i) => i.code)).toEqual(['b', 'a']);
  });

  it('counts and detects errors', () => {
    const list = [issue({}), issue({ severity: 'warning' }), issue({ severity: 'warning' })];
    expect(countBySeverity(list)).toEqual({ errors: 1, warnings: 2 });
    expect(hasErrors(list)).toBe(true);
    expect(hasErrors([issue({ severity: 'warning' })])).toBe(false);
  });

  it('translates known codes and falls back to the server message for unknown ones', () => {
    expect(issueText(createEditorT('it'), { code: 'scene_missing', message: 'x' })).toBe('Scena assente in OBS');
    expect(issueText(createEditorT('en'), { code: 'scene_missing', message: 'x' })).toBe('Scene not in OBS');
    expect(issueText(createEditorT('it'), { code: 'brand_new_code', message: 'English text' })).toBe('English text');
  });
});
