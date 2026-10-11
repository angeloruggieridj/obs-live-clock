// SPDX-License-Identifier: GPL-2.0-or-later
import type { ClientCommand } from '@olc/shared';
import { MINUS, durationText } from '../../core/time-format';
import type { ControlView } from '../../core/views';
import { useLive } from '../live-context';
import { ConfirmButton } from './ConfirmButton';

/** F16 emergency controls, closed by default; every action needs a confirmation. */
export function EmergencyPanel({ view, run, disabled = false }: { view: ControlView | null; run: (command: ClientCommand) => Promise<boolean>; disabled?: boolean }) {
  const { t } = useLive();
  const phase = view?.presenter.phase ?? null;
  const live = phase === 'live';
  const stepMs = view?.presets.adjustStepMs ?? null;
  // No episode means no step to show: an em dash, never an invented 0:30 (NF1).
  const step = stepMs === null ? '—' : durationText(stepMs);
  const blocked = disabled || view === null;
  const manual = view?.control === 'manual';
  const send = (command: ClientCommand) => () => void run(command);
  return (
    <details className="panel emergency">
      <summary className="panel-title">{t('emergency')}</summary>
      <div className="emergency-grid">
        <ConfirmButton label={t('startProgram')} disabled={blocked || phase !== 'preshow'} onConfirm={send({ name: 'start_program' })} />
        <ConfirmButton label={t('prevCmd')} disabled={blocked || !live} onConfirm={send({ name: 'prev' })} />
        <ConfirmButton label={t('nextCmd')} disabled={blocked || !live} onConfirm={send({ name: 'next' })} />
        <ConfirmButton label={`${MINUS}${step}`} disabled={blocked || !live} onConfirm={send({ name: 'adjust', deltaMs: -(stepMs ?? 0) })} />
        <ConfirmButton label={`+${step}`} disabled={blocked || !live} onConfirm={send({ name: 'adjust', deltaMs: stepMs ?? 0 })} />
        <ConfirmButton
          label={manual ? t('setAuto') : t('setManual')}
          disabled={blocked}
          onConfirm={send({ name: 'set_control', control: manual ? 'auto' : 'manual' })}
        />
        <ConfirmButton label={t('endProgram')} disabled={blocked || !live} danger onConfirm={send({ name: 'end_program' })} />
      </div>
    </details>
  );
}
