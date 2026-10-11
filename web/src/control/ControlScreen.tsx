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
import { EpisodePicker } from './EpisodePicker';
import { EventFeed, useEventFeed } from './EventFeed';
import { RundownTable } from './RundownTable';

const defaultApi = httpApi();

/** SPEC §8 / F14: the extended control view, opened from the dock. Role `control`. */
export function ControlScreen({ api = defaultApi }: { api?: ApiClient }) {
  const { t } = useLive();
  const snap = useSnapshot<'control'>();
  const { run, feedback } = useCommand();
  const obs = useObsStatus(api);
  const feed = useEventFeed(snap.view, snap.synced);
  const view = snap.view;
  const ready = snap.hasView && snap.synced;
  // Carry-over of the dock ruling: while the snapshot is stale (or not ready) the director sees a frozen state he
  // cannot trust, so every command button — the `VAI` rows included — is disabled.
  const commandsDisabled = snap.stale || !ready;
  return (
    <div className="control">
      <header className="c-header">
        <h1 className="label-text">{view === null ? t('noEpisode') : view.episode.name}</h1>
      </header>
      <main className="c-main">
        <div className="c-rundown">{ready && view !== null ? <RundownTable view={view} run={run} disabled={commandsDisabled} /> : null}</div>
        <div className="c-side">
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
          <EventFeed entries={feed} />
          <EpisodePicker api={api} loadedId={view?.episode.id ?? null} />
        </div>
      </main>
      <ConnectionOverlay />
    </div>
  );
}
