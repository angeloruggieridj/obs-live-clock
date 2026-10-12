// SPDX-License-Identifier: GPL-2.0-or-later
import { useEffect, useState } from 'react';
import type { DurationSource, MediaElement, StudioBlock } from '@olc/shared';
import { durationText } from '../../core/time-format';
import type { EditorT } from '../i18n';
import { addMedia, addStudioPart, moveElement, patchMedia, removeElement } from '../model/ops';
import { useDoc, useEditorT, useSession, useSessionSnapshot, useStore } from '../session/context';
import { parseDuration } from './duration-input';

/**
 * A text field committed on blur/Enter. The local text is re-synchronised from `value` whenever the canonical value
 * changes, so switching block (or a rejected edit) never leaves the previous text on screen. `validate` failures keep
 * the typed text visible and flag the field instead of editing.
 */
export function TextField(props: {
  label: string;
  value: string;
  /**
   * Identity of the field's source (e.g. the block id). When it changes the local text is re-synchronised from
   * `value` even if `value` itself did not change, so switching block never leaves the previous block's text on
   * screen when the two blocks share the same canonical value.
   */
  resetKey?: string;
  /** Returns true when the store accepted the edit; false reverts the field to `value`. */
  onCommit: (raw: string) => boolean;
  validate?: (raw: string) => boolean;
  invalidMessage?: string;
  disabled?: boolean;
  placeholder?: string;
  list?: string;
}) {
  const [text, setText] = useState(props.value);
  const [invalid, setInvalid] = useState(false);
  useEffect(() => {
    setText(props.value);
    setInvalid(false);
  }, [props.value, props.resetKey]);
  const commit = () => {
    if (props.validate !== undefined && !props.validate(text)) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    if (!props.onCommit(text)) setText(props.value);
  };
  return (
    <div className="ed-field">
      <span className="ed-field-label">{props.label}</span>
      <input
        className="ed-input"
        type="text"
        aria-label={props.label}
        value={text}
        placeholder={props.placeholder}
        list={props.list}
        role={props.list !== undefined ? 'textbox' : undefined}
        disabled={props.disabled}
        aria-invalid={invalid ? 'true' : undefined}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            commit();
          }
        }}
      />
      {invalid && props.invalidMessage !== undefined ? <span className="ed-error">{props.invalidMessage}</span> : null}
    </div>
  );
}

function FormInput(props: {
  label: string;
  value: string;
  disabled?: boolean;
  invalid?: boolean;
  invalidMessage?: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="ed-field">
      <span className="ed-field-label">{props.label}</span>
      <input
        className="ed-input"
        type="text"
        aria-label={props.label}
        value={props.value}
        disabled={props.disabled}
        aria-invalid={props.invalid === true ? 'true' : undefined}
        onChange={(e) => props.onChange(e.target.value)}
      />
      {props.invalid === true && props.invalidMessage !== undefined ? <span className="ed-error">{props.invalidMessage}</span> : null}
    </div>
  );
}

function originText(source: DurationSource | undefined, t: EditorT): string | null {
  switch (source) {
    case 'deck':
      return t('props.originDeck');
    case 'file':
      return t('props.originFile');
    case 'file_rounded':
      return t('props.originFileRounded');
    case 'manual':
      return t('props.originManual');
    case 'unknown':
      return t('props.originUnknown');
    default:
      return null;
  }
}

/** The elements of a studio block, with per-row move/remove and the "add studio part" / "add item" actions. */
export function ElementsList(props: { block: StudioBlock }) {
  const t = useEditorT();
  const session = useSession();
  const doc = useDoc();
  const store = useStore();
  const snap = useSessionSnapshot();
  const block = props.block;
  const disabled = snap.phase === 'loading' || snap.lock !== null || store.readOnly;
  const [formOpen, setFormOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [path, setPath] = useState('');
  const [duration, setDuration] = useState('');
  const [durationInvalid, setDurationInvalid] = useState(false);

  // The add-item form must not carry one block's typing onto another: reset it when the selected block changes.
  useEffect(() => {
    setFormOpen(false);
    setTitle('');
    setPath('');
    setDuration('');
    setDurationInvalid(false);
  }, [block.id]);

  const add = () => {
    const trimmed = path.trim();
    if (trimmed === '') return;
    const ms = parseDuration(duration);
    // A non-empty duration that does not parse is a typo: flag it instead of silently recording an unknown item.
    if (duration.trim() !== '' && ms === null) {
      setDurationInvalid(true);
      return;
    }
    setDurationInvalid(false);
    const occurrence = (doc?.blocks ?? []).reduce(
      (n, b) => (b.kind === 'studio' ? n + b.elements.filter((e) => e.kind === 'media' && e.path === trimmed).length : n),
      0,
    );
    const media: Omit<MediaElement, 'id'> =
      ms === null
        ? { kind: 'media', title: title.slice(0, 200), path: trimmed, occurrence, plannedDurationMs: 0, durationSource: 'unknown' }
        : { kind: 'media', title: title.slice(0, 200), path: trimmed, occurrence, plannedDurationMs: ms, durationSource: 'manual' };
    session.apply(addMedia(block.id, media));
    setFormOpen(false);
    setTitle('');
    setPath('');
    setDuration('');
    setDurationInvalid(false);
  };

  return (
    <section className="ed-elements">
      <ol aria-label={t('props.elements')}>
        {block.elements.map((el, i) => {
          const n = i + 1;
          const origin = el.kind === 'media' ? originText(el.durationSource, t) : null;
          return (
            <li key={i} data-testid={`el-${el.id}`} className="ed-el">
              {el.kind === 'studio' ? (
                <span className="ed-el-studio">{t('props.studioPart')}</span>
              ) : (
                <>
                  <TextField
                    resetKey={el.id}
                    label={`${t('props.titleN')} ${n}`}
                    value={el.title}
                    disabled={disabled}
                    onCommit={(raw) => session.apply(patchMedia(block.id, el.id, { title: raw }))}
                  />
                  <span className="ed-path" title={el.path}>
                    {el.path}
                  </span>
                  <TextField
                    resetKey={el.id}
                    label={`${t('props.durationN')} ${n}`}
                    value={el.durationSource === 'unknown' ? '' : durationText(el.plannedDurationMs)}
                    placeholder={t('props.unknownDash')}
                    disabled={disabled}
                    validate={(raw) => raw.trim() === '' || parseDuration(raw) !== null}
                    invalidMessage={t('props.durationInvalid')}
                    onCommit={(raw) => {
                      const ms = parseDuration(raw);
                      return ms === null ? false : session.apply(patchMedia(block.id, el.id, { plannedDurationMs: ms }));
                    }}
                  />
                  {origin !== null ? (
                    <span data-testid={`origin-${el.id}`} className={el.durationSource === 'unknown' ? 'is-warn' : undefined}>
                      {origin}
                    </span>
                  ) : null}
                </>
              )}
              <span className="ed-el-actions">
                <button
                  type="button"
                  className="ed-btn"
                  aria-label={`${t('props.moveUp')} ${n}`}
                  disabled={disabled || i === 0}
                  onClick={() => session.apply(moveElement(block.id, i, i - 1))}
                >
                  {t('props.moveUp')}
                </button>
                <button
                  type="button"
                  className="ed-btn"
                  aria-label={`${t('props.moveDown')} ${n}`}
                  disabled={disabled || i === block.elements.length - 1}
                  onClick={() => session.apply(moveElement(block.id, i, i + 1))}
                >
                  {t('props.moveDown')}
                </button>
                <button
                  type="button"
                  className="ed-btn"
                  aria-label={`${t('props.remove')} ${n}`}
                  title={block.elements.length <= 1 ? t('props.lastElement') : undefined}
                  disabled={disabled || block.elements.length <= 1}
                  onClick={() => session.apply(removeElement(block.id, el.id))}
                >
                  {t('props.remove')}
                </button>
              </span>
            </li>
          );
        })}
      </ol>
      <div className="ed-elements-actions">
        <button type="button" className="ed-btn" disabled={disabled} onClick={() => session.apply(addStudioPart(block.id))}>
          {t('props.addStudioPart')}
        </button>
        <button
          type="button"
          className="ed-btn"
          disabled={disabled}
          onClick={() => {
            setFormOpen((v) => !v);
            setDurationInvalid(false);
          }}
        >
          {t('props.addMedia')}
        </button>
      </div>
      {formOpen ? (
        <form
          className="ed-add-media"
          onSubmit={(e) => {
            e.preventDefault();
            add();
          }}
        >
          <FormInput label={t('props.mediaTitle')} value={title} disabled={disabled} onChange={setTitle} />
          <FormInput label={t('props.mediaPath')} value={path} disabled={disabled} onChange={setPath} />
          <FormInput
            label={t('props.mediaDuration')}
            value={duration}
            disabled={disabled}
            invalid={durationInvalid}
            invalidMessage={t('props.durationInvalid')}
            onChange={(v) => {
              setDuration(v);
              setDurationInvalid(false);
            }}
          />
          <button type="button" className="ed-btn" disabled={disabled || path.trim() === ''} onClick={add}>
            {t('props.add')}
          </button>
        </form>
      ) : null}
    </section>
  );
}
