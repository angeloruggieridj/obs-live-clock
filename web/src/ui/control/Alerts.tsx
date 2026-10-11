// SPDX-License-Identifier: GPL-2.0-or-later
import { DECISION_CHOICES, type ClientCommand } from '@olc/shared';
import type { ObsStatusLite } from '../../core/http';
import type { MessageKey } from '../../core/i18n';
import { wallText } from '../../core/time-format';
import type { ControlDecision, ControlView } from '../../core/views';
import { useLive } from '../live-context';
import { ConfirmButton } from './ConfirmButton';

type Run = (command: ClientCommand) => Promise<boolean>;

/** SPEC §8 warnings, then the open non-blocking decisions (default already applied, changeable afterwards). */
export function Alerts({ view, obs, run, disabled = false }: { view: ControlView; obs: ObsStatusLite | null; run: Run; disabled?: boolean }) {
  const { t, timeZone } = useLive();
  const items: Array<{ key: string; text: string }> = [];
  if (obs?.connection === 'auth_failed') items.push({ key: 'auth', text: t('obsAuthFailed') });
  if (view.obs === 'lost') items.push({ key: 'obs', text: t('obsLost') });
  if (obs?.connection === 'connected' && obs.deck?.capability === 'absent') items.push({ key: 'deck', text: t('deckAbsent') });
  if (obs?.connection === 'connected' && obs.deck?.capability === 'legacy') items.push({ key: 'deck', text: t('deckLegacy') });
  if (view.offScript !== null) {
    const scene = view.offScript.scene === '' ? '—' : view.offScript.scene; // the engine may not know the scene (BACKLOG)
    items.push({ key: 'off', text: t('offScript', { scene, time: wallText(view.offScript.sinceWall, timeZone) }) });
  }
  if (view.ambiguous) items.push({ key: 'amb', text: t('ambiguous') });
  const open = view.decisions.filter((d) => !d.confirmed);
  if (items.length === 0 && open.length === 0) return null;
  return (
    <section className="panel alerts">
      {items.map((item) => (
        <div key={item.key} className="alert" role="alert">
          {item.text}
        </div>
      ))}
      {open.map((d) => (
        <Decision key={d.id} decision={d} run={run} disabled={disabled} />
      ))}
    </section>
  );
}

function Decision({ decision, run, disabled }: { decision: ControlDecision; run: Run; disabled: boolean }) {
  const { t, timeZone } = useLive();
  const time = wallText(decision.atWall, timeZone);
  return (
    <div className="decision">
      <div className="decision-text">{t(decision.kind === 'output_restart' ? 'decisionOutputRestart' : 'decisionAllStopped', { time })}</div>
      <div className="decision-choices">
        {DECISION_CHOICES[decision.kind].map((choice) => {
          const label = t(`choice_${choice}` as MessageKey);
          const pressed = decision.choice === choice;
          const send = () => void run({ name: 'resolve_decision', id: decision.id, choice });
          return choice === 'end' ? (
            <ConfirmButton key={choice} label={label} onConfirm={send} disabled={disabled} danger pressed={pressed} />
          ) : (
            <button key={choice} type="button" aria-pressed={pressed} disabled={disabled} onClick={send}>
              {label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
