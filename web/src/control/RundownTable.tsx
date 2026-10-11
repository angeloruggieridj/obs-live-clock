// SPDX-License-Identifier: GPL-2.0-or-later
import type { ClientCommand } from '@olc/shared';
import { durationText, wallText } from '../core/time-format';
import type { ControlView } from '../core/views';
import { SourceBadge } from '../ui/SourceBadge';
import { ConfirmButton } from '../ui/control/ConfirmButton';
import { useLive } from '../ui/live-context';

const COLUMNS = ['colSlot', 'colBlock', 'colItem', 'colStatus', 'colPlanned', 'colStart', 'colEnd', 'colDuration'] as const;

/** SPEC §8 extended view: every rundown element with its status, planned and real times and duration source. */
export function RundownTable({ view, run, disabled = false }: { view: ControlView; run: (command: ClientCommand) => Promise<boolean>; disabled?: boolean }) {
  const { t, timeZone } = useLive();
  const live = view.presenter.phase === 'live';
  const wall = (ms: number | null) => (ms === null ? '—' : wallText(ms, timeZone));
  return (
    <table className="rundown">
      <thead>
        <tr>
          {COLUMNS.map((key) => (
            <th key={key} scope="col">
              {t(key)}
            </th>
          ))}
          <th scope="col" aria-label={t('goto')} />
        </tr>
      </thead>
      <tbody>
        {view.rows.map((row, i) => {
          const firstOfBlock = i === 0 || view.rows[i - 1]!.blockIndex !== row.blockIndex;
          const current = row.slot === view.cursor;
          return (
            <tr key={row.slot} data-status={row.status} data-provisional={String(row.provisional)} aria-current={current ? 'true' : undefined}>
              <td className="c-slot">{row.slot + 1}</td>
              <td className="c-block label-text">{firstOfBlock ? row.blockName : ''}</td>
              <td className="c-item label-text">{row.kind === 'media' ? `${t('kind_media')} · ${row.title}` : t(`kind_${row.kind}`)}</td>
              <td className="c-status">
                {t(`status_${row.status}`)}
                {row.provisional ? ` · ${t('provisional')}` : ''}
                {view.returnSlot === row.slot ? ' ↩' : ''}
              </td>
              <td className="c-planned">{firstOfBlock ? wall(row.plannedStartAtWall) : ''}</td>
              <td className="c-start">{wall(row.startedAtWall)}</td>
              <td className="c-end">{wall(row.endedAtWall)}</td>
              <td className="c-duration">
                {row.durationMs === null ? '—' : durationText(row.durationMs)}
                {row.durationMs !== null ? <SourceBadge source={row.durationSource} showPlanned /> : null}
              </td>
              <td className="c-goto">
                {current ? null : <ConfirmButton label={t('goto')} disabled={disabled || !live} onConfirm={() => void run({ name: 'goto', slot: row.slot })} />}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
