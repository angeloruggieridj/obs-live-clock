// SPDX-License-Identifier: GPL-2.0-or-later
import type { Block } from '@olc/shared';
import type { KeyboardEvent, PointerEvent } from 'react';
import { durationText } from '../../core/time-format';
import type { EditorT } from '../i18n';
import type { BlockTiming } from '../model/time';
import type { Slot } from './geometry';

export interface BlockViewProps {
  block: Block;
  index: number;
  slot: Slot;
  timing: BlockTiming;
  selected: boolean;
  warnMs: number;
  t: EditorT;
  registerRef: (id: string, el: HTMLLIElement | null) => void;
  onPointerDown: (e: PointerEvent<HTMLLIElement>, block: Block, index: number) => void;
  onPointerMove: (e: PointerEvent<HTMLLIElement>) => void;
  onPointerUp: (e: PointerEvent<HTMLLIElement>, block: Block, index: number) => void;
  onPointerCancel: (e: PointerEvent<HTMLLIElement>) => void;
  onKeyDown: (e: KeyboardEvent<HTMLLIElement>, block: Block, index: number) => void;
  onKeyUp: (e: KeyboardEvent<HTMLLIElement>) => void;
  onResizePointerDown: (e: PointerEvent<HTMLDivElement>, block: Block) => void;
  onResizePointerMove: (e: PointerEvent<HTMLDivElement>) => void;
  onResizePointerUp: (e: PointerEvent<HTMLDivElement>) => void;
}

/** One timeline block: type tag, name, duration, studio/media badges, and the resize handle at its right edge. */
export function BlockView(props: BlockViewProps) {
  const { block, index, slot, timing, selected, warnMs, t } = props;
  const mediaCount = block.kind === 'studio' ? block.elements.filter((e) => e.kind === 'media').length : 0;
  const studioMs = block.kind === 'studio' ? timing.studioMs : null;
  return (
    <li
      ref={(el) => props.registerRef(block.id, el)}
      className={`tl-block tl-${block.kind}${selected ? ' is-selected' : ''}`}
      data-testid={`block-${block.id}`}
      tabIndex={0}
      aria-label={t('timeline.blockLabel', { n: index + 1, name: block.name, d: durationText(block.durationMs) })}
      aria-current={selected ? 'true' : undefined}
      style={{ width: `${slot.w}px`, minWidth: 0 }}
      onPointerDown={(e) => props.onPointerDown(e, block, index)}
      onPointerMove={props.onPointerMove}
      onPointerUp={(e) => props.onPointerUp(e, block, index)}
      onPointerCancel={props.onPointerCancel}
      onKeyDown={(e) => props.onKeyDown(e, block, index)}
      onKeyUp={props.onKeyUp}
    >
      <span className="tl-type">{block.kind === 'break' ? t('timeline.typeBreak') : t('timeline.typeStudio')}</span>
      <span className="tl-name">{block.name}</span>
      <span className="tl-duration">{durationText(block.durationMs)}</span>
      {studioMs !== null ? <span className="tl-studio">{t('timeline.studioTime', { d: durationText(studioMs) })}</span> : null}
      {studioMs !== null && studioMs < 0 ? <span className="is-error">{t('timeline.mediaExceeds')}</span> : null}
      {studioMs !== null && studioMs >= 0 && studioMs < warnMs ? (
        <span className="is-warn">{` · ${t('timeline.belowThreshold')}`}</span>
      ) : null}
      {mediaCount > 0 ? <span className="tl-media">{t('timeline.mediaCount', { n: mediaCount })}</span> : null}
      {timing.unknownMedia > 0 ? <span className="is-warn">{t('timeline.unknownMedia', { n: timing.unknownMedia })}</span> : null}
      {block.kind === 'studio' ? (
        <span className="tl-elastic">{block.elastic ? t('timeline.elastic') : t('timeline.fixed')}</span>
      ) : block.scene !== t('timeline.typeBreak') ? (
        // The scene is shown for a break; when it repeats the type tag ("BREAK") it adds nothing.
        <span className="tl-scene">{block.scene}</span>
      ) : null}
      <div
        className="tl-handle"
        data-testid={`resize-${block.id}`}
        role="separator"
        aria-orientation="vertical"
        aria-label={t('timeline.resizeHandle', { name: block.name })}
        onPointerDown={(e) => props.onResizePointerDown(e, block)}
        onPointerMove={props.onResizePointerMove}
        onPointerUp={props.onResizePointerUp}
        onPointerCancel={props.onResizePointerUp}
      />
    </li>
  );
}
