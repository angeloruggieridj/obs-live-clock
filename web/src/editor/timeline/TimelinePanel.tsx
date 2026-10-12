// SPDX-License-Identifier: GPL-2.0-or-later
import type { Block } from '@olc/shared';
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { durationText, wallText } from '../../core/time-format';
import type { EditorDoc } from '../api/editor-api';
import type { EditorT } from '../i18n';
import { addBlock, deleteBlock, duplicateBlock, moveBlock, resizeBlock, splitBlock } from '../model/ops';
import { blockTimings, plannedEndMs, totalMs, type BlockTiming } from '../model/time';
import { useDoc, useEditorT, useSelection, useSession, useSessionSnapshot, useStore } from '../session/context';
import { BlockView } from './BlockView';
import {
  MAX_SCALE, MIN_SCALE, blockKeyIntent, dropIndex, fitScale, layout, resizeDuration, snapMs,
} from './geometry';

/** A block being reordered by pointer: `target` is null until the 4 px threshold is crossed. */
interface ReorderDrag {
  id: string;
  index: number;
  startX: number;
  target: number | null;
}

interface ResizeDrag {
  id: string;
  startX: number;
  startMs: number;
  /** Pixels per ms anchored on the block's drawn width, so a 56 px-minimum block does not jump on a small drag. */
  pxPerMs: number;
}

/** The smallest block `Dividi` may split (rule 8: not under 10 s). */
const MIN_SPLIT_MS = 10_000;

/** Pointer capture is optional: jsdom does not implement it and a drag still works from the element events. */
function capture(e: { currentTarget: EventTarget; pointerId: number }): void {
  const el = e.currentTarget as Element & { setPointerCapture?: (pointerId: number) => void };
  try {
    el.setPointerCapture?.(e.pointerId);
  } catch {
    // not implemented: events still reach the element in tests
  }
}

function release(e: { currentTarget: EventTarget; pointerId: number }): void {
  const el = e.currentTarget as Element & { releasePointerCapture?: (pointerId: number) => void };
  try {
    el.releasePointerCapture?.(e.pointerId);
  } catch {
    // not implemented
  }
}

export function TimelinePanel(props: { widthPx?: number; timeZone?: string }) {
  const doc = useDoc();
  const t = useEditorT();
  if (doc === null) return <div className="tl" data-testid="timeline" />;
  // The track owns the zoom, so a different document mounts a fresh one with its own fit.
  return <TimelineTrack key={doc.id} doc={doc} widthPx={props.widthPx} timeZone={props.timeZone} t={t} />;
}

function TimelineTrack(props: { doc: EditorDoc; widthPx?: number; timeZone?: string; t: EditorT }) {
  const { doc, widthPx, timeZone, t } = props;
  const session = useSession();
  const selection = useSelection();
  const store = useStore();
  const snapshot = useSessionSnapshot();
  const readOnly = store.readOnly || snapshot.phase === 'loading';

  const blocks = doc.blocks;
  const total = totalMs(blocks);
  const warnMs = doc.preset.warnMs;
  const timings = useMemo(() => blockTimings(blocks), [blocks]);
  const timingById = useMemo(() => new Map<string, BlockTiming>(timings.map((x) => [x.id, x])), [timings]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [measured, setMeasured] = useState<number | null>(null);
  const width = widthPx ?? measured ?? 1000;
  const [scale, setScale] = useState(() => fitScale(total, width));
  const slotsLive = layout(blocks, scale);

  const [drag, setDrag] = useState<ReorderDrag | null>(null);
  const [resize, setResize] = useState<ResizeDrag | null>(null);
  const refs = useRef(new Map<string, HTMLLIElement>());

  // Measure the scroll area only when no explicit width was given (tests pass `widthPx`).
  useEffect(() => {
    if (widthPx !== undefined) return;
    const el = scrollRef.current;
    if (el === null) return;
    const w = el.clientWidth;
    if (w > 0) setMeasured(w);
  }, [widthPx]);

  // A reveal request (validation click-to-focus, an arrow landing on a neighbour) brings the block into view.
  const lastReveal = useRef(selection.revealTick);
  useEffect(() => {
    if (selection.revealTick === lastReveal.current) return;
    lastReveal.current = selection.revealTick;
    const el = selection.blockId === null ? undefined : refs.current.get(selection.blockId);
    el?.scrollIntoView?.({ block: 'nearest', inline: 'center' });
    el?.focus?.();
  }, [selection.revealTick, selection.blockId]);

  const registerRef = (id: string, el: HTMLLIElement | null): void => {
    if (el === null) refs.current.delete(id);
    else refs.current.set(id, el);
  };

  const indexOf = (id: string): number => blocks.findIndex((b) => b.id === id);
  const selectedIndex = selection.blockId === null ? -1 : indexOf(selection.blockId);
  const selectedBlock = selectedIndex < 0 ? null : blocks[selectedIndex]!;
  const canSplit = selectedBlock !== null && selectedBlock.kind === 'studio' && selectedBlock.durationMs >= MIN_SPLIT_MS;

  const applyMove = (from: number, to: number): void => void session.apply(moveBlock<EditorDoc>(from, to));

  const add = (kind: Block['kind']): void => {
    const at = selectedIndex >= 0 ? selectedIndex + 1 : blocks.length;
    const name = t(kind === 'break' ? 'timeline.newBreak' : 'timeline.newStudio', { n: blocks.length + 1 });
    session.apply(addBlock<EditorDoc>(kind, at, name));
    const created = session.store.getSnapshot().doc?.blocks[at];
    if (created !== undefined) session.selection.select(created.id);
  };

  const duplicateSelected = (): void => {
    if (selectedIndex < 0) return;
    session.apply(duplicateBlock<EditorDoc>(selection.blockId!, t('timeline.copyOf', { name: selectedBlock!.name })));
    const copy = session.store.getSnapshot().doc?.blocks[selectedIndex + 1];
    if (copy !== undefined) session.selection.select(copy.id);
  };

  const deleteSelected = (): void => {
    if (selectedIndex < 0) return;
    session.apply(deleteBlock<EditorDoc>(selection.blockId!));
    const next = blocks[selectedIndex + 1] ?? blocks[selectedIndex - 1] ?? null;
    session.selection.select(next?.id ?? null);
  };

  const splitSelected = (): void => {
    if (selectedBlock === null || selectedBlock.kind !== 'studio') return;
    const second = t('timeline.secondPart', { name: selectedBlock.name });
    session.apply(splitBlock<EditorDoc>(selectedBlock.id, snapMs(selectedBlock.durationMs / 2), second));
    const part = session.store.getSnapshot().doc?.blocks[selectedIndex + 1];
    if (part !== undefined) session.selection.select(part.id);
  };

  const zoomIn = (): void => setScale((s) => Math.min(MAX_SCALE, s * 1.5));
  const zoomOut = (): void => setScale((s) => Math.max(MIN_SCALE, s / 1.5));
  const fit = (): void => setScale(fitScale(total, width));

  const onBlockPointerDown = (e: PointerEvent<HTMLLIElement>, block: Block, index: number): void => {
    if (readOnly || e.button !== 0) return;
    setDrag({ id: block.id, index, startX: e.clientX, target: null });
    capture(e);
  };

  const onBlockPointerMove = (e: PointerEvent<HTMLLIElement>): void => {
    if (drag === null) return;
    const dx = e.clientX - drag.startX;
    if (drag.target === null && Math.abs(dx) <= 4) return;
    setDrag({ ...drag, target: dropIndex(slotsLive, drag.id, dx) });
  };

  const onBlockPointerUp = (e: PointerEvent<HTMLLIElement>): void => {
    if (drag === null) return;
    const done = drag;
    setDrag(null);
    release(e);
    if (done.target === null) {
      session.selection.select(done.id); // a click: select only
      return;
    }
    if (done.target !== done.index) applyMove(done.index, done.target);
    session.seal();
  };

  const abortDrag = (): void => setDrag(null);

  const onResizePointerDown = (e: PointerEvent<HTMLDivElement>, block: Block): void => {
    e.stopPropagation();
    if (readOnly || e.button !== 0) return;
    const slot = slotsLive[indexOf(block.id)];
    const pxPerMs = slot !== undefined && block.durationMs > 0 ? slot.w / block.durationMs : scale;
    setResize({ id: block.id, startX: e.clientX, startMs: block.durationMs, pxPerMs });
    capture(e);
  };

  const onResizePointerMove = (e: PointerEvent<HTMLDivElement>): void => {
    e.stopPropagation();
    if (resize === null) return;
    session.apply(resizeBlock<EditorDoc>(resize.id, resizeDuration(resize.startMs, e.clientX - resize.startX, resize.pxPerMs)));
  };

  const onResizePointerUp = (e: PointerEvent<HTMLDivElement>): void => {
    e.stopPropagation();
    if (resize === null) return;
    setResize(null);
    release(e);
    session.seal();
  };

  const onBlockKeyDown = (e: KeyboardEvent<HTMLLIElement>, block: Block, index: number): void => {
    if (drag !== null) {
      if (e.key === 'Escape') {
        e.preventDefault();
        abortDrag();
      }
      return;
    }
    const intent = blockKeyIntent(e);
    if (intent === null) return;
    e.preventDefault(); // Alt+Arrow is browser-back on Windows: never let the default through
    switch (intent.type) {
      case 'select': {
        const neighbour = blocks[index + intent.delta];
        if (neighbour !== undefined) session.selection.select(neighbour.id, { reveal: true });
        break;
      }
      case 'move':
        applyMove(index, index + intent.delta);
        break;
      case 'resize':
        session.apply(resizeBlock<EditorDoc>(block.id, block.durationMs + intent.deltaMs));
        break;
      case 'delete': {
        session.apply(deleteBlock<EditorDoc>(block.id));
        const neighbour = blocks[index + 1] ?? blocks[index - 1] ?? null;
        session.selection.select(neighbour?.id ?? null);
        break;
      }
      case 'duplicate': {
        session.apply(duplicateBlock<EditorDoc>(block.id, t('timeline.copyOf', { name: block.name })));
        const copy = session.store.getSnapshot().doc?.blocks[index + 1];
        if (copy !== undefined) session.selection.select(copy.id);
        break;
      }
    }
  };

  const onBlockKeyUp = (e: KeyboardEvent<HTMLLIElement>): void => {
    // Each keyboard resize is its own undo step: end the coalescing run when the key is released.
    if (blockKeyIntent(e)?.type === 'resize') session.seal();
  };

  const boundaryPx = (target: number): number => {
    if (slotsLive.length === 0) return 0;
    const last = slotsLive[slotsLive.length - 1]!;
    if (target >= slotsLive.length) return last.x + last.w;
    return slotsLive[target]!.x;
  };

  const end = 'plannedStart' in doc ? plannedEndMs(doc.plannedStart, total) : null;

  return (
    <div className="tl" data-testid="timeline">
      <div className="tl-toolbar" role="toolbar" aria-label={t('timeline.title')}>
        <button type="button" disabled={readOnly} onClick={() => add('studio')}>
          {t('timeline.addStudio')}
        </button>
        <button type="button" disabled={readOnly} onClick={() => add('break')}>
          {t('timeline.addBreak')}
        </button>
        <button type="button" disabled={readOnly || selectedIndex < 0} onClick={duplicateSelected}>
          {t('timeline.duplicate')}
        </button>
        <button type="button" disabled={readOnly || !canSplit} onClick={splitSelected}>
          {t('timeline.split')}
        </button>
        <button type="button" disabled={readOnly || selectedIndex < 0} onClick={deleteSelected}>
          {t('timeline.delete')}
        </button>
        <button type="button" disabled={readOnly} onClick={zoomOut}>
          {t('timeline.zoomOut')}
        </button>
        <button type="button" disabled={readOnly} onClick={zoomIn}>
          {t('timeline.zoomIn')}
        </button>
        <button type="button" disabled={readOnly} onClick={fit}>
          {t('timeline.fit')}
        </button>
      </div>
      <div className="tl-summary">
        <span className="tl-total">{t('timeline.total', { d: durationText(total) })}</span>
        {end !== null ? <span className="tl-planned-end">{t('timeline.plannedEnd', { time: wallText(end, timeZone) })}</span> : null}
        {readOnly ? <span className="tl-readonly">{t('timeline.readOnly')}</span> : null}
      </div>
      <div className="tl-scroll" ref={scrollRef}>
        {blocks.length === 0 ? (
          <p className="tl-empty">{t('timeline.empty')}</p>
        ) : (
          <div className="tl-track-wrap">
            <ul className="tl-track" aria-label={t('timeline.title')}>
              {blocks.map((block, index) => (
                <BlockView
                  key={block.id}
                  block={block}
                  index={index}
                  slot={slotsLive[index]!}
                  timing={timingById.get(block.id)!}
                  selected={selection.blockId === block.id}
                  warnMs={warnMs}
                  t={t}
                  registerRef={registerRef}
                  onPointerDown={onBlockPointerDown}
                  onPointerMove={onBlockPointerMove}
                  onPointerUp={onBlockPointerUp}
                  onPointerCancel={abortDrag}
                  onKeyDown={onBlockKeyDown}
                  onKeyUp={onBlockKeyUp}
                  onResizePointerDown={onResizePointerDown}
                  onResizePointerMove={onResizePointerMove}
                  onResizePointerUp={onResizePointerUp}
                />
              ))}
            </ul>
            {drag !== null && drag.target !== null ? (
              <div className="tl-drop" data-testid="drop-marker" data-index={drag.target} style={{ left: `${boundaryPx(drag.target)}px` }} />
            ) : null}
          </div>
        )}
        <div className="tl-keys">{t('timeline.keysHelp')}</div>
      </div>
    </div>
  );
}
