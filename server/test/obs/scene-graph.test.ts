// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import { loadSceneGraph, sceneNames, visibleInputs } from '../../src/obs/scene-graph';
import { FakeObsClient } from '../support/fake-obs';

const item = (sourceName: string, extra: Record<string, unknown> = {}) => ({
  sourceName, sceneItemEnabled: true, sourceType: 'OBS_SOURCE_TYPE_INPUT', isGroup: false, ...extra,
});

function obsWithScenes(): FakeObsClient {
  const obs = new FakeObsClient();
  obs.respond('GetSceneList', () => ({ scenes: [{ sceneName: 'CAM 1' }, { sceneName: 'PLAYOUT' }, { sceneName: 'LOWER' }, { sceneName: 'BREAK' }] }));
  const lists: Record<string, unknown[]> = {
    'CAM 1': [item('Camera 1'), item('LOWER', { sourceType: 'OBS_SOURCE_TYPE_SCENE' })],
    PLAYOUT: [item('Deck Media'), item('Bug', { sceneItemEnabled: false })],
    LOWER: [item('Lower Third'), item('PLAYOUT', { sourceType: 'OBS_SOURCE_TYPE_SCENE', sceneItemEnabled: false })],
    BREAK: [item('Grp', { isGroup: true, sourceType: 'OBS_SOURCE_TYPE_SCENE' }), { sceneItemEnabled: true }],
  };
  obs.respond('GetSceneItemList', (d) => ({ sceneItems: lists[String(d?.sceneName)] ?? [] }));
  obs.respond('GetGroupSceneItemList', (d) => ({ sceneItems: d?.sceneName === 'Grp' ? [item('Tappo'), item('Hidden', { sceneItemEnabled: false })] : [] }));
  return obs;
}

describe('scene graph', () => {
  it('loads scenes, nested scenes and groups', async () => {
    const g = await loadSceneGraph(obsWithScenes());
    expect(sceneNames(g)).toEqual(['CAM 1', 'PLAYOUT', 'LOWER', 'BREAK']);
    expect(g.groups.get('Grp')?.map((i) => i.sourceName)).toEqual(['Tappo', 'Hidden']);
    expect(g.scenes.get('BREAK')).toEqual([{ sourceName: 'Grp', enabled: true, kind: 'group' }]);
  });

  it('collects enabled inputs through enabled nested scenes and groups only', async () => {
    const g = await loadSceneGraph(obsWithScenes());
    expect([...visibleInputs(g, 'CAM 1')].sort()).toEqual(['Camera 1', 'Lower Third']);
    expect([...visibleInputs(g, 'PLAYOUT')]).toEqual(['Deck Media']);
    expect([...visibleInputs(g, 'BREAK')]).toEqual(['Tappo']);
    expect(visibleInputs(g, 'NOPE').size).toBe(0);
  });

  it('survives cycles between nested scenes', () => {
    const g = {
      scenes: new Map([
        ['A', [{ sourceName: 'B', enabled: true, kind: 'scene' as const }, { sourceName: 'In A', enabled: true, kind: 'input' as const }]],
        ['B', [{ sourceName: 'A', enabled: true, kind: 'scene' as const }]],
      ]),
      groups: new Map(),
    };
    expect([...visibleInputs(g, 'A')]).toEqual(['In A']);
  });
});
