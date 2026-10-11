// SPDX-License-Identifier: GPL-2.0-or-later
import { httpApi, type ApiClient } from '../core/http';
import { ConnectionOverlay } from '../ui/ConnectionOverlay';
import { Alerts } from '../ui/control/Alerts';
import { CommandFeedback } from '../ui/control/CommandFeedback';
import { EmergencyPanel } from '../ui/control/EmergencyPanel';
import { MessagePanel } from '../ui/control/MessagePanel';
import { StatusPanel } from '../ui/control/StatusPanel';
import { useCommand } from '../ui/control/useCommand';
import { useObsStatus } from '../ui/control/useObsStatus';
import { useLive, useSnapshot } from '../ui/live-context';

const defaultApi = httpApi();

/** SPEC §8 / F13: the OBS Custom Browser Dock, from 300 px wide. Role `control`. */
export function DockScreen({ api = defaultApi, search = typeof window === 'undefined' ? '' : window.location.search }: { api?: ApiClient; search?: string }) {
  const { t } = useLive();
  const snap = useSnapshot<'control'>();
  const { run, feedback } = useCommand();
  const obs = useObsStatus(api);
  const view = snap.view;
  const ready = snap.hasView && snap.synced;
  // Commands are only safe on fresh data: while the snapshot is stale (or not ready) every button is disabled.
  const commandsDisabled = snap.stale || !ready;
  return (
    <div className="dock">
      {ready && view === null ? (
        <section className="panel">
          <div className="no-episode">{t('noEpisode')}</div>
        </section>
      ) : null}
      {ready && view !== null ? (
        <>
          <StatusPanel view={view} />
          <Alerts view={view} obs={obs} run={run} disabled={commandsDisabled} />
        </>
      ) : null}
      {ready ? (
        <>
          <MessagePanel view={view} run={run} disabled={commandsDisabled} />
          <EmergencyPanel view={view} run={run} disabled={commandsDisabled} />
        </>
      ) : null}
      <CommandFeedback feedback={feedback} />
      <a className="open-extended" href={`/control${search}`} target="_blank" rel="noopener">
        {t('openExtended')}
      </a>
      <ConnectionOverlay />
    </div>
  );
}
