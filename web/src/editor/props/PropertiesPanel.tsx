// SPDX-License-Identifier: GPL-2.0-or-later
import { useEffect, useState } from 'react';
import { plannedStudioTimeMs, type StudioBlock } from '@olc/shared';
import { durationText } from '../../core/time-format';
import { convertBlock, patchBreak, patchStudio } from '../model/ops';
import { useDoc, useEditorT, useSelection, useSession, useSessionSnapshot, useStore } from '../session/context';
import { ElementsList, TextField } from './ElementsList';
import { parseDuration } from './duration-input';

/** `Tempo studio: {d}`, flagged when the studio time is under the threshold or the media exceed the block. */
function StudioTime({ block, warnMs }: { block: StudioBlock; warnMs: number }) {
  const t = useEditorT();
  const studioMs = plannedStudioTimeMs(block);
  const state = studioMs < 0 ? 'is-error' : studioMs < warnMs ? 'is-warn' : undefined;
  const suffix =
    studioMs < 0
      ? ` · ${t('props.mediaExceeds', { d: durationText(-studioMs) })}`
      : studioMs < warnMs
        ? ` · ${t('props.belowThreshold', { d: durationText(warnMs) })}`
        : '';
  return (
    <p data-testid="studio-time" className={state}>
      {t('props.studioTime', { d: durationText(studioMs) })}
      {suffix}
    </p>
  );
}

/** The properties of the selected block: its fields, studio time and (for a studio block) its elements. */
export function PropertiesPanel() {
  const t = useEditorT();
  const session = useSession();
  const selection = useSelection();
  const doc = useDoc();
  const store = useStore();
  const snap = useSessionSnapshot();
  const [scenes, setScenes] = useState<string[]>([]);

  // Loaded once on mount: the break scene datalist. Empty when OBS is offline (`obsScenes()` answers null).
  useEffect(() => {
    let alive = true;
    session.api
      .obsScenes()
      .then((list) => {
        if (alive) setScenes(list ?? []);
      })
      .catch(() => {
        if (alive) setScenes([]);
      });
    return () => {
      alive = false;
    };
  }, [session]);

  const disabled = snap.phase === 'loading' || snap.lock !== null || store.readOnly;
  const block = doc === null ? null : doc.blocks.find((b) => b.id === selection.blockId) ?? null;

  if (block === null || doc === null) {
    return (
      <section className="ed-props" aria-label={t('props.title')}>
        <h2 className="ed-panel-title">{t('props.title')}</h2>
        <p className="ed-muted">{t('props.none')}</p>
      </section>
    );
  }

  return (
    <section className="ed-props" aria-label={t('props.title')}>
      <h2 className="ed-panel-title">{t('props.title')}</h2>
      {/* Every field is reset from the document when the block id changes (through TextField's effect), so switching
          block never leaves the previous block's text on screen, even when the two blocks share the same canonical
          value; TextField also re-synchronises from the document on every value change. */}
      <div className="ed-props-form">
        <TextField
          resetKey={block.id}
          label={t('props.name')}
          value={block.name}
          disabled={disabled}
          onCommit={(raw) => session.apply(block.kind === 'studio' ? patchStudio(block.id, { name: raw }) : patchBreak(block.id, { name: raw }))}
        />
        <TextField
          resetKey={block.id}
          label={t('props.duration')}
          value={durationText(block.durationMs)}
          disabled={disabled}
          validate={(raw) => parseDuration(raw) !== null}
          invalidMessage={t('props.durationInvalid')}
          onCommit={(raw) => {
            const ms = parseDuration(raw);
            if (ms === null) return false;
            return session.apply(block.kind === 'studio' ? patchStudio(block.id, { durationMs: ms }) : patchBreak(block.id, { durationMs: ms }));
          }}
        />
        <label className="ed-field">
          <span className="ed-field-label">{t('props.type')}</span>
          <select
            className="ed-input"
            aria-label={t('props.type')}
            value={block.kind}
            disabled={disabled}
            onChange={(e) => session.apply(convertBlock(block.id, e.target.value as 'studio' | 'break'))}
          >
            <option value="studio">{t('props.typeStudio')}</option>
            <option value="break">{t('props.typeBreak')}</option>
          </select>
        </label>
        {block.kind === 'studio' ? (
          <>
            <label className="ed-field ed-field-inline">
              <input
                type="checkbox"
                checked={block.elastic}
                disabled={disabled}
                onChange={(e) => session.apply(patchStudio(block.id, { elastic: e.target.checked }))}
              />
              <span>{t('props.elastic')}</span>
            </label>
            <label className="ed-field">
              <span className="ed-field-label">{t('props.sceneGroup')}</span>
              <select
                className="ed-input"
                aria-label={t('props.sceneGroup')}
                value={block.sceneGroupId}
                disabled={disabled}
                onChange={(e) => session.apply(patchStudio(block.id, { sceneGroupId: e.target.value }))}
              >
                {doc.sceneGroups.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </select>
            </label>
            <StudioTime block={block} warnMs={doc.preset.warnMs} />
            <ElementsList block={block} />
          </>
        ) : (
          <>
            <TextField
              resetKey={block.id}
              label={t('props.scene')}
              value={block.scene}
              disabled={disabled}
              list="ed-obs-scenes"
              onCommit={(raw) => session.apply(patchBreak(block.id, { scene: raw }))}
            />
            <datalist id="ed-obs-scenes">
              {scenes.map((s) => (
                <option key={s} value={s} />
              ))}
            </datalist>
            <TextField
              resetKey={block.id}
              label={t('props.mediaInput')}
              value={block.mediaInput ?? ''}
              disabled={disabled}
              onCommit={(raw) => session.apply(patchBreak(block.id, { mediaInput: raw }))}
            />
          </>
        )}
      </div>
    </section>
  );
}
