// SPDX-License-Identifier: GPL-2.0-or-later
import type { ClientCommand } from '@olc/shared';
import { MINUS, durationText } from '../../core/time-format';
import type { ControlView } from '../../core/views';
import { useLive } from '../live-context';
import { ConfirmButton } from './ConfirmButton';

/** F16 emergency controls, closed by default; every action needs a confirmation. */
export function EmergencyPanel({ view, run }: { view: ControlView | null; run: (command: ClientCommand) => Promise<boolean> }) {
  const { t } = useLive();
  const phase = view?.presenter.phase ?? null;
  const live = phase === 'live';
  const step = view?.presets.adjustStepMs ?? 30_000;
  const manual = view?.control === 'manual';
  const send = (command: ClientCommand) => () => void run(command);
  return (
    <details className="panel emergency">
      <summary className="panel-title">{t('emergency')}</summary>
      <div className="emergency-grid">
        <ConfirmButton label={t('startProgram')} disabled={phase !== 'preshow'} onConfirm={send({ name: 'start_program' })} />
        <ConfirmButton label={t('prevCmd')} disabled={!live} onConfirm={send({ name: 'prev' })} />
        <ConfirmButton label={t('nextCmd')} disabled={!live} onConfirm={send({ name: 'next' })} />
        <ConfirmButton label={`${MINUS}${durationText(step)}`} disabled={!live} onConfirm={send({ name: 'adjust', deltaMs: -step })} />
        <ConfirmButton label={`+${durationText(step)}`} disabled={!live} onConfirm={send({ name: 'adjust', deltaMs: step })} />
        <ConfirmButton
          label={manual ? t('setAuto') : t('setManual')}
          disabled={view === null}
          onConfirm={send({ name: 'set_control', control: manual ? 'auto' : 'manual' })}
        />
        <ConfirmButton label={t('endProgram')} disabled={!live} danger onConfirm={send({ name: 'end_program' })} />
      </div>
    </details>
  );
}
