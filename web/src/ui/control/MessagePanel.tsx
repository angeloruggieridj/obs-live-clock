// SPDX-License-Identifier: GPL-2.0-or-later
import { useState, type FormEvent } from 'react';
import type { ClientCommand } from '@olc/shared';
import type { ControlView } from '../../core/views';
import { useLive } from '../live-context';

/** F15: preset buttons (hotkey slot = index + 1, DT-9), free text, CLEAR. */
export function MessagePanel({ view, run }: { view: ControlView | null; run: (command: ClientCommand) => Promise<boolean> }) {
  const { t } = useLive();
  const [draft, setDraft] = useState('');
  const disabled = view === null;
  const current = view?.presenter.message?.text ?? null;
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const text = draft.trim();
    if (text === '') return;
    if (await run({ name: 'send_message', text, dismiss: { kind: 'manual' } })) setDraft('');
  };
  return (
    <section className="panel messages">
      <h2 className="panel-title">{t('messages')}</h2>
      {current !== null ? <div className="current-message label-text">{t('currentMessage', { text: current })}</div> : null}
      <div className="preset-grid">
        {(view?.presets.messages ?? []).map((m, i) => (
          <button key={m.id} type="button" disabled={disabled} onClick={() => void run({ name: 'send_message', text: m.text, dismiss: m.dismiss })}>
            {`${i + 1} · ${m.text}`}
          </button>
        ))}
      </div>
      <form className="free-text" onSubmit={(e) => void submit(e)}>
        <input
          type="text"
          aria-label={t('freeText')}
          placeholder={t('freeText')}
          maxLength={200}
          value={draft}
          disabled={disabled}
          onChange={(e) => setDraft(e.target.value)}
        />
        <button type="submit" disabled={disabled || draft.trim() === ''}>
          {t('send')}
        </button>
      </form>
      <button type="button" className="clear" disabled={disabled || current === null} onClick={() => void run({ name: 'clear_message' })}>
        {t('clear')}
      </button>
    </section>
  );
}
