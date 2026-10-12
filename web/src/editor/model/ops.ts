// SPDX-License-Identifier: GPL-2.0-or-later
import {
  presetForMode,
  type Block,
  type BreakBlock,
  type MediaElement,
  type MessagePreset,
  type Preset,
  type ProductionMode,
  type Rundown,
  type SceneGroup,
  type StudioBlock,
} from '@olc/shared';
import type { Edit } from '../store/document-store';
import { MIN_BLOCK_MS, SNAP_MS } from './constants';
import { nextId, uniqueSlug } from './ids';

export type RundownDoc = Rundown & { id: string; name: string };

const clampDuration = (ms: number) => Math.max(MIN_BLOCK_MS, Math.round(ms / SNAP_MS) * SNAP_MS);

export const OP_LABELS = [
  'move_block', 'resize_block', 'edit_block', 'convert_block', 'add_block', 'duplicate_block', 'delete_block',
  'split_block', 'add_element', 'remove_element', 'move_element', 'edit_media', 'rename_doc', 'edit_preset',
  'edit_scene_group', 'edit_message', 'import_media', 'edit_episode',
] as const;
export type OpLabel = (typeof OP_LABELS)[number];

export function moveItem<T>(arr: readonly T[], from: number, to: number): readonly T[] {
  if (from === to || from < 0 || from >= arr.length || to < 0 || to >= arr.length) return arr;
  const next = arr.slice();
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item!);
  return next;
}

function takenIds(doc: Rundown): Set<string> {
  const ids = new Set<string>();
  for (const b of doc.blocks) {
    ids.add(b.id);
    if (b.kind === 'studio') for (const e of b.elements) ids.add(e.id);
  }
  return ids;
}

const withBlocks = <D extends RundownDoc>(doc: D, blocks: Block[]): D => ({ ...doc, blocks });

function mapBlock<D extends RundownDoc>(doc: D, id: string, fn: (b: Block) => Block): D {
  const i = doc.blocks.findIndex((b) => b.id === id);
  if (i < 0) return doc;
  const next = fn(doc.blocks[i]!);
  if (next === doc.blocks[i]) return doc;
  const blocks = doc.blocks.slice();
  blocks[i] = next;
  return withBlocks(doc, blocks);
}

export function moveBlock<D extends RundownDoc>(from: number, to: number): Edit<D> {
  return {
    label: 'move_block',
    apply: (doc) => {
      const t = Math.max(0, Math.min(doc.blocks.length - 1, to));
      const blocks = moveItem(doc.blocks, from, t) as Block[];
      return blocks === doc.blocks ? doc : withBlocks(doc, blocks);
    },
  };
}

export function resizeBlock<D extends RundownDoc>(id: string, ms: number): Edit<D> {
  return {
    label: 'resize_block',
    coalesceKey: `resize:${id}`,
    apply: (doc) => mapBlock(doc, id, (b) => (b.durationMs === clampDuration(ms) ? b : { ...b, durationMs: clampDuration(ms) })),
  };
}

export type StudioPatch = Partial<Pick<StudioBlock, 'name' | 'durationMs' | 'elastic' | 'sceneGroupId'>>;
export type BreakPatch = Partial<Pick<BreakBlock, 'name' | 'durationMs' | 'scene' | 'mediaInput'>>;

function patchBlock<D extends RundownDoc>(id: string, kind: Block['kind'], patch: StudioPatch & BreakPatch): Edit<D> {
  const textFields = ['name', 'durationMs', 'scene', 'mediaInput'] as const;
  const field = textFields.find((f) => f in patch);
  return {
    label: 'edit_block',
    coalesceKey: field === undefined ? undefined : `patch:${id}:${field}`,
    apply: (doc) =>
      mapBlock(doc, id, (b) => {
        if (b.kind !== kind) return b;
        const next: Record<string, unknown> = { ...b };
        if (patch.name !== undefined) {
          const name = patch.name.trim();
          if (name.length < 1 || name.length > 120) return b;
          next.name = name;
        }
        if (patch.durationMs !== undefined) next.durationMs = clampDuration(patch.durationMs);
        if (b.kind === 'studio') {
          if (patch.elastic !== undefined) next.elastic = patch.elastic;
          if (patch.sceneGroupId !== undefined) next.sceneGroupId = patch.sceneGroupId;
        } else {
          if (patch.scene !== undefined) {
            if (patch.scene.trim() === '') return b;
            next.scene = patch.scene;
          }
          if (patch.mediaInput !== undefined) next.mediaInput = patch.mediaInput === '' ? null : patch.mediaInput;
        }
        const changed = Object.keys(next).some((k) => next[k] !== (b as Record<string, unknown>)[k]);
        return changed ? (next as unknown as Block) : b;
      }),
  };
}
export const patchStudio = <D extends RundownDoc>(id: string, patch: StudioPatch) => patchBlock<D>(id, 'studio', patch);
export const patchBreak = <D extends RundownDoc>(id: string, patch: BreakPatch) => patchBlock<D>(id, 'break', patch);

export function convertBlock<D extends RundownDoc>(id: string, kind: Block['kind']): Edit<D> {
  return {
    label: 'convert_block',
    apply: (doc) =>
      mapBlock(doc, id, (b) => {
        if (b.kind === kind) return b;
        if (kind === 'break') return { id: b.id, kind: 'break', name: b.name, durationMs: b.durationMs, scene: 'BREAK', mediaInput: null };
        const ids = takenIds(doc);
        return {
          id: b.id, kind: 'studio', name: b.name, durationMs: b.durationMs, elastic: true,
          sceneGroupId: doc.sceneGroups[0]?.id ?? '',
          elements: [{ id: nextId('el', ids), kind: 'studio' }],
        };
      }),
  };
}

function freshBlock(doc: Rundown, kind: Block['kind'], name: string): Block {
  const ids = takenIds(doc);
  const id = nextId('blk', ids);
  ids.add(id);
  if (kind === 'break') return { id, kind: 'break', name, durationMs: 180_000, scene: 'BREAK', mediaInput: null };
  return {
    id, kind: 'studio', name, durationMs: 300_000, elastic: true,
    sceneGroupId: doc.sceneGroups[0]?.id ?? '',
    elements: [{ id: nextId('el', ids), kind: 'studio' }],
  };
}

export function addBlock<D extends RundownDoc>(kind: Block['kind'], atIndex: number, name: string): Edit<D> {
  return {
    label: 'add_block',
    apply: (doc) => {
      const at = Math.max(0, Math.min(doc.blocks.length, atIndex));
      const blocks = doc.blocks.slice();
      blocks.splice(at, 0, freshBlock(doc, kind, name));
      return withBlocks(doc, blocks);
    },
  };
}

export function duplicateBlock<D extends RundownDoc>(id: string, name: string): Edit<D> {
  return {
    label: 'duplicate_block',
    apply: (doc) => {
      const i = doc.blocks.findIndex((b) => b.id === id);
      if (i < 0) return doc;
      const src = doc.blocks[i]!;
      const ids = takenIds(doc);
      const newId = nextId('blk', ids);
      ids.add(newId);
      let copy: Block;
      if (src.kind === 'break') copy = { ...src, id: newId, name };
      else {
        const elements = src.elements
          .filter((e) => e.kind === 'studio')
          .map((e) => {
            const eid = nextId('el', ids);
            ids.add(eid);
            return { ...e, id: eid };
          });
        copy = { ...src, id: newId, name, elements: elements.length > 0 ? elements : [{ id: nextId('el', ids), kind: 'studio' }] };
      }
      const blocks = doc.blocks.slice();
      blocks.splice(i + 1, 0, copy);
      return withBlocks(doc, blocks);
    },
  };
}

export function deleteBlock<D extends RundownDoc>(id: string): Edit<D> {
  return {
    label: 'delete_block',
    apply: (doc) => (doc.blocks.some((b) => b.id === id) ? withBlocks(doc, doc.blocks.filter((b) => b.id !== id)) : doc),
  };
}

export function splitBlock<D extends RundownDoc>(id: string, atMs: number, secondName: string): Edit<D> {
  return {
    label: 'split_block',
    apply: (doc) => {
      const i = doc.blocks.findIndex((b) => b.id === id);
      const src = doc.blocks[i];
      if (src === undefined || src.kind !== 'studio') return doc;
      const first = Math.round(atMs / SNAP_MS) * SNAP_MS;
      const rest = src.durationMs - first;
      if (first < MIN_BLOCK_MS || rest < MIN_BLOCK_MS) return doc;
      const ids = takenIds(doc);
      const newId = nextId('blk', ids);
      ids.add(newId);
      const second: StudioBlock = {
        id: newId, kind: 'studio', name: secondName, durationMs: rest, elastic: src.elastic,
        sceneGroupId: src.sceneGroupId, elements: [{ id: nextId('el', ids), kind: 'studio' }],
      };
      const blocks = doc.blocks.slice();
      blocks.splice(i, 1, { ...src, durationMs: first }, second);
      return withBlocks(doc, blocks);
    },
  };
}

function mapStudio<D extends RundownDoc>(doc: D, blockId: string, fn: (b: StudioBlock, ids: Set<string>) => StudioBlock): D {
  return mapBlock(doc, blockId, (b) => (b.kind === 'studio' ? fn(b, takenIds(doc)) : b));
}

export function addStudioPart<D extends RundownDoc>(blockId: string, index?: number): Edit<D> {
  return {
    label: 'add_element',
    apply: (doc) =>
      mapStudio(doc, blockId, (b, ids) => {
        const at = Math.max(0, Math.min(b.elements.length, index ?? b.elements.length));
        const elements = b.elements.slice();
        elements.splice(at, 0, { id: nextId('el', ids), kind: 'studio' });
        return { ...b, elements };
      }),
  };
}

export function addMedia<D extends RundownDoc>(blockId: string, media: Omit<MediaElement, 'id'>, index?: number): Edit<D> {
  return {
    label: 'add_element',
    apply: (doc) =>
      mapStudio(doc, blockId, (b, ids) => {
        const at = Math.max(0, Math.min(b.elements.length, index ?? b.elements.length));
        const elements = b.elements.slice();
        elements.splice(at, 0, { ...media, id: nextId('el', ids) });
        return { ...b, elements };
      }),
  };
}

export function removeElement<D extends RundownDoc>(blockId: string, elementId: string): Edit<D> {
  return {
    label: 'remove_element',
    apply: (doc) =>
      mapStudio(doc, blockId, (b) =>
        b.elements.length <= 1 || !b.elements.some((e) => e.id === elementId)
          ? b
          : { ...b, elements: b.elements.filter((e) => e.id !== elementId) },
      ),
  };
}

export function moveElement<D extends RundownDoc>(blockId: string, from: number, to: number): Edit<D> {
  return {
    label: 'move_element',
    apply: (doc) =>
      mapStudio(doc, blockId, (b) => {
        const elements = moveItem(b.elements, from, to) as StudioBlock['elements'];
        return elements === b.elements ? b : { ...b, elements };
      }),
  };
}

export type MediaPatch = Partial<Pick<MediaElement, 'title' | 'plannedDurationMs' | 'durationSource'>>;
export function patchMedia<D extends RundownDoc>(blockId: string, elementId: string, patch: MediaPatch): Edit<D> {
  return {
    label: 'edit_media',
    coalesceKey: `media:${elementId}`,
    apply: (doc) =>
      mapStudio(doc, blockId, (b) => {
        let changed = false;
        const elements = b.elements.map((e) => {
          if (e.id !== elementId || e.kind !== 'media') return e;
          const next: MediaElement = { ...e };
          if (patch.title !== undefined) next.title = patch.title.slice(0, 200);
          if (patch.plannedDurationMs !== undefined && Number.isInteger(patch.plannedDurationMs) && patch.plannedDurationMs >= 0) {
            next.plannedDurationMs = patch.plannedDurationMs;
            next.durationSource = patch.durationSource ?? 'manual';
          } else if (patch.durationSource !== undefined) next.durationSource = patch.durationSource;
          if (JSON.stringify(next) === JSON.stringify(e)) return e;
          changed = true;
          return next;
        });
        return changed ? { ...b, elements } : b;
      }),
  };
}

export function renameDoc<D extends RundownDoc>(name: string): Edit<D> {
  return {
    label: 'rename_doc',
    coalesceKey: 'doc-name',
    apply: (doc) => {
      const n = name.trim();
      return n.length < 1 || n.length > 120 || n === doc.name ? doc : { ...doc, name: n };
    },
  };
}

export function setPreset<D extends RundownDoc>(patch: Partial<Omit<Preset, 'mode'>>): Edit<D> {
  const field = Object.keys(patch)[0] ?? 'x';
  return {
    label: 'edit_preset',
    coalesceKey: `preset:${field}`,
    apply: (doc) => {
      if (patch.adjustStepMs !== undefined && !(Number.isInteger(patch.adjustStepMs) && patch.adjustStepMs >= 1000)) return doc;
      if (patch.warnMs !== undefined && !(Number.isInteger(patch.warnMs) && patch.warnMs >= 0)) return doc;
      if (patch.returnImminentMs !== undefined && !(Number.isInteger(patch.returnImminentMs) && patch.returnImminentMs >= 0)) return doc;
      const next = { ...doc.preset, ...patch };
      return JSON.stringify(next) === JSON.stringify(doc.preset) ? doc : { ...doc, preset: next };
    },
  };
}

export function applyMode<D extends RundownDoc>(mode: ProductionMode): Edit<D> {
  return { label: 'edit_preset', apply: (doc) => ({ ...doc, preset: presetForMode(mode) }) };
}

export function addSceneGroup<D extends RundownDoc>(name: string, placeholderScene: string): Edit<D> {
  return {
    label: 'edit_scene_group',
    apply: (doc) => {
      const n = name.trim();
      if (n === '' || n.length > 120) return doc;
      const id = uniqueSlug(n, new Set(doc.sceneGroups.map((g) => g.id)));
      return { ...doc, sceneGroups: [...doc.sceneGroups, { id, name: n, scenes: [placeholderScene] }] };
    },
  };
}

export function patchSceneGroup<D extends RundownDoc>(id: string, patch: Partial<Pick<SceneGroup, 'name' | 'scenes'>>): Edit<D> {
  return {
    label: 'edit_scene_group',
    coalesceKey: `group:${id}`,
    apply: (doc) => {
      if (patch.name !== undefined && (patch.name.trim() === '' || patch.name.length > 120)) return doc;
      if (patch.scenes !== undefined && (patch.scenes.length < 1 || patch.scenes.some((s) => s.trim() === ''))) return doc;
      let changed = false;
      const sceneGroups = doc.sceneGroups.map((g) => {
        if (g.id !== id) return g;
        const next = { ...g, ...patch };
        if (JSON.stringify(next) === JSON.stringify(g)) return g;
        changed = true;
        return next;
      });
      return changed ? { ...doc, sceneGroups } : doc;
    },
  };
}

export function removeSceneGroup<D extends RundownDoc>(id: string): Edit<D> {
  return {
    label: 'edit_scene_group',
    apply: (doc) =>
      doc.blocks.some((b) => b.kind === 'studio' && b.sceneGroupId === id) || !doc.sceneGroups.some((g) => g.id === id)
        ? doc
        : { ...doc, sceneGroups: doc.sceneGroups.filter((g) => g.id !== id) },
  };
}

export function addMessage<D extends RundownDoc>(text: string): Edit<D> {
  return {
    label: 'edit_message',
    apply: (doc) => {
      const t = text.trim();
      if (t === '' || t.length > 80) return doc;
      const id = uniqueSlug(t, new Set(doc.messages.map((m) => m.id)));
      return { ...doc, messages: [...doc.messages, { id, text: t, dismiss: { kind: 'timeout', ms: 10_000 } }] };
    },
  };
}

export function patchMessage<D extends RundownDoc>(id: string, patch: Partial<Pick<MessagePreset, 'text' | 'dismiss'>>): Edit<D> {
  return {
    label: 'edit_message',
    coalesceKey: `message:${id}`,
    apply: (doc) => {
      if (patch.text !== undefined && (patch.text.trim() === '' || patch.text.length > 80)) return doc;
      if (patch.dismiss?.kind === 'timeout' && !(Number.isInteger(patch.dismiss.ms) && patch.dismiss.ms >= 1000)) return doc;
      let changed = false;
      const messages = doc.messages.map((m) => {
        if (m.id !== id) return m;
        const next = { ...m, ...patch };
        if (JSON.stringify(next) === JSON.stringify(m)) return m;
        changed = true;
        return next;
      });
      return changed ? { ...doc, messages } : doc;
    },
  };
}

const ISO_WITH_OFFSET = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

export function patchEpisodeMeta<D extends RundownDoc>(patch: {
  date?: string;
  plannedStart?: string | null;
  playlistName?: string | null;
}): Edit<D> {
  return {
    label: 'edit_episode',
    coalesceKey: `episode:${Object.keys(patch)[0] ?? 'x'}`,
    apply: (doc) => {
      if (!('formatId' in doc)) return doc;
      if (patch.date !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(patch.date)) return doc;
      if (patch.plannedStart != null && !(ISO_WITH_OFFSET.test(patch.plannedStart) && !Number.isNaN(Date.parse(patch.plannedStart)))) return doc;
      const next: Record<string, unknown> = { ...doc };
      if (patch.date !== undefined) next.date = patch.date;
      if (patch.plannedStart !== undefined) next.plannedStart = patch.plannedStart;
      if (patch.playlistName !== undefined) next.playlistName = patch.playlistName === null || patch.playlistName.trim() === '' ? null : patch.playlistName;
      return JSON.stringify(next) === JSON.stringify(doc) ? doc : (next as unknown as D);
    },
  };
}

export function removeMessage<D extends RundownDoc>(id: string): Edit<D> {
  return {
    label: 'edit_message',
    apply: (doc) => (doc.messages.some((m) => m.id === id) ? { ...doc, messages: doc.messages.filter((m) => m.id !== id) } : doc),
  };
}
