// SPDX-License-Identifier: GPL-2.0-or-later
import type { ObsClient, ObsData } from './client';

export interface SceneItem {
  sourceName: string;
  enabled: boolean;
  kind: 'scene' | 'group' | 'input';
}

export interface SceneGraphData {
  scenes: Map<string, SceneItem[]>;
  groups: Map<string, SceneItem[]>;
}

function toItems(raw: unknown): SceneItem[] {
  if (!Array.isArray(raw)) return [];
  const items: SceneItem[] = [];
  for (const r of raw as ObsData[]) {
    if (typeof r?.sourceName !== 'string') continue;
    const kind = r.isGroup === true ? 'group' : r.sourceType === 'OBS_SOURCE_TYPE_SCENE' ? 'scene' : 'input';
    items.push({ sourceName: r.sourceName, enabled: r.sceneItemEnabled === true, kind });
  }
  return items;
}

/** Reads every scene and group of the current scene collection. */
export async function loadSceneGraph(client: ObsClient): Promise<SceneGraphData> {
  const list = await client.call('GetSceneList');
  const names = Array.isArray(list.scenes)
    ? (list.scenes as ObsData[]).map((s) => s?.sceneName).filter((n): n is string => typeof n === 'string')
    : [];
  const scenes = new Map<string, SceneItem[]>();
  const groups = new Map<string, SceneItem[]>();
  for (const name of names) {
    const items = toItems((await client.call('GetSceneItemList', { sceneName: name })).sceneItems);
    scenes.set(name, items);
    for (const it of items) {
      if (it.kind === 'group' && !groups.has(it.sourceName)) {
        groups.set(it.sourceName, toItems((await client.call('GetGroupSceneItemList', { sceneName: it.sourceName })).sceneItems));
      }
    }
  }
  return { scenes, groups };
}

export function sceneNames(graph: SceneGraphData): string[] {
  return [...graph.scenes.keys()];
}

/** Every enabled input reachable from `scene` through enabled nested scenes and groups. */
export function visibleInputs(graph: SceneGraphData, scene: string): Set<string> {
  const out = new Set<string>();
  const seen = new Set<string>();
  const walk = (items: SceneItem[] | undefined) => {
    for (const it of items ?? []) {
      if (!it.enabled) continue;
      if (it.kind === 'input') out.add(it.sourceName);
      else if (!seen.has(`${it.kind}:${it.sourceName}`)) {
        seen.add(`${it.kind}:${it.sourceName}`);
        walk(it.kind === 'scene' ? graph.scenes.get(it.sourceName) : graph.groups.get(it.sourceName));
      }
    }
  };
  seen.add(`scene:${scene}`);
  walk(graph.scenes.get(scene));
  return out;
}
