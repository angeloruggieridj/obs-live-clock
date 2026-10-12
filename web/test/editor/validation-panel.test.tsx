// SPDX-License-Identifier: GPL-2.0-or-later
import { act, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ValidationPanel } from '../../src/editor/validation/ValidationPanel';
import { resizeBlock, patchMedia } from '../../src/editor/model/ops';
import { FakeEditorApi, renderWithSession, sampleEpisode, sampleFormat } from '../support/editor';

const EPISODE = { kind: 'episode', id: 'ep-2026-10-12' } as const;
const FORMAT = { kind: 'format', id: 'solo-futsal' } as const;

async function setup(open = EPISODE as typeof EPISODE | typeof FORMAT, prepare?: (api: FakeEditorApi) => void) {
  const api = new FakeEditorApi();
  api.formats.set('solo-futsal', sampleFormat());
  api.episodes.set('ep-2026-10-12', sampleEpisode());
  prepare?.(api);
  return renderWithSession(<ValidationPanel />, { open, api });
}
const breakMedia = (api: FakeEditorApi) => {
  (api.episodes.get('ep-2026-10-12')!.blocks[0] as { elements: Array<{ plannedDurationMs?: number }> }).elements[1]!.plannedDurationMs = 9_999_999;
};

describe('local validation', () => {
  it('shows no problem for a rundown without any', async () => {
    await setup(FORMAT, (api) => {
      const f = api.formats.get('solo-futsal')!;
      f.blocks = [f.blocks[1]!]; // a single break
    });
    expect(screen.getByTestId('val-summary').textContent).toBe('Nessun problema');
  });

  it('the sample episode only has the shared-scene-group warning (three blocks use one group)', async () => {
    await setup();
    expect(screen.getByTestId('val-summary').textContent).toBe('0 errori · 1 avvisi');
    expect(screen.getByTestId('issue-scene_group_shared-global')).toBeTruthy();
  });

  it('lists errors per block with their text, and updates as the document changes', async () => {
    const { session } = await setup(EPISODE, breakMedia);
    expect(screen.getByTestId('val-summary').textContent).toBe('1 errori · 1 avvisi');
    expect(within(screen.getByTestId('issue-media_exceeds_block-b1')).getByText('I servizi superano la durata del blocco')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Primo blocco' })).toBeTruthy();
    session.apply(patchMedia('b1', 'b1-m1', { plannedDurationMs: 60_000 }));
    expect(await screen.findByText('0 errori · 1 avvisi')).toBeTruthy();
  });

  it('shows a warning for studio time under the threshold and for an unknown media duration', async () => {
    const { session } = await setup();
    session.apply(resizeBlock('b3', 30_000));
    session.apply(patchMedia('b1', 'b1-m1', { plannedDurationMs: 0, durationSource: 'unknown' }));
    expect(await screen.findByTestId('issue-studio_below_threshold-b3')).toBeTruthy();
    expect(screen.getByTestId('issue-media_duration_unknown-b1')).toBeTruthy();
    expect(screen.getByTestId('val-summary').textContent).toBe('0 errori · 3 avvisi');
  });

  it('click-to-focus selects the block and asks to reveal it', async () => {
    const { session, user } = await setup(EPISODE, breakMedia);
    session.selection.select('b3');
    await user.click(screen.getByTestId('issue-media_exceeds_block-b1'));
    expect(session.selection.getSnapshot()).toMatchObject({ blockId: 'b1', revealTick: 1 });
  });
});

describe('load for live', () => {
  it('is blocked while there are errors, and says why', async () => {
    const { api, user } = await setup(EPISODE, breakMedia);
    const button = screen.getByRole('button', { name: 'Carica per la live' }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(screen.getByText('Correggi gli errori prima di caricare')).toBeTruthy();
    await user.click(button);
    expect(api.count('loadLive')).toBe(0);
  });

  it('is not blocked by warnings', async () => {
    const { session, api, user } = await setup();
    session.apply(resizeBlock('b3', 30_000)); // studio time warning only
    const button = screen.getByRole('button', { name: 'Carica per la live' }) as HTMLButtonElement;
    expect(button.disabled).toBe(false);
    await user.click(button);
    expect(await screen.findByText('Puntata caricata per la live')).toBeTruthy();
    expect(api.live.episodeId).toBe('ep-2026-10-12');
  });

  it('saves pending edits first and loads nothing if they cannot be saved', async () => {
    const { session, api, user } = await setup();
    api.failNext('putDoc', new TypeError('down'));
    session.apply(resizeBlock('b3', 130_000));
    await user.click(screen.getByRole('button', { name: 'Carica per la live' }));
    expect(await screen.findByText('Salvataggio non riuscito: caricamento annullato')).toBeTruthy();
    expect(api.count('loadLive')).toBe(0);
  });

  it('shows the server refusal with its issues', async () => {
    const { api, user } = await setup();
    breakMedia(api); // the server copy has an error the local copy does not know about
    await user.click(screen.getByRole('button', { name: 'Carica per la live' }));
    expect(await screen.findByText('Il server rifiuta il rundown: correggi gli errori')).toBeTruthy();
  });

  it('is not offered for a format', async () => {
    await setup(FORMAT);
    expect(screen.queryByRole('button', { name: 'Carica per la live' })).toBeNull();
  });

  it('asks for a second click when the last Check OBS found errors', async () => {
    const { api, user } = await setup(EPISODE, (a) => {
      a.check = { connected: true, obsWebSocketVersion: '5.5.0', deck: { capability: 'events' }, issues: [{ severity: 'error', code: 'scene_missing', blockId: 'br1', message: 'Scene "BREAK" is not in OBS' }] };
    });
    await user.click(screen.getByRole('button', { name: 'Check OBS' }));
    await screen.findByTestId('issue-scene_missing-br1');
    await user.click(screen.getByRole('button', { name: 'Carica per la live' }));
    expect(screen.getByText('Il Check OBS ha trovato errori: premi di nuovo per caricare lo stesso')).toBeTruthy();
    expect(api.count('loadLive')).toBe(0);
    await user.click(screen.getByRole('button', { name: 'Carica per la live' }));
    expect(await screen.findByText('Puntata caricata per la live')).toBeTruthy();
  });
});

describe('Check OBS', () => {
  it('is disabled for a format', async () => {
    await setup(FORMAT);
    const button = screen.getByRole('button', { name: 'Check OBS' }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(button.getAttribute('title')).toBe('Il Check OBS si fa su una puntata');
  });

  it('saves first, then shows the connection, the plugin and the issues, with the caveat', async () => {
    const { session, api, user } = await setup(EPISODE, (a) => {
      a.check = {
        connected: true, obsWebSocketVersion: '5.5.0', deck: { capability: 'legacy' },
        issues: [
          { severity: 'error', code: 'scene_missing', blockId: 'br1', message: 'Scene "BREAK" is not in OBS' },
          { severity: 'warning', code: 'media_input_unverified', blockId: 'br1', message: 'Media input "Tappo" could not be verified' },
          { severity: 'warning', code: 'deck_legacy', blockId: null, message: 'x' },
        ],
      };
    });
    session.apply(resizeBlock('b3', 130_000));
    await user.click(screen.getByRole('button', { name: 'Check OBS' }));
    expect(await screen.findByText('OBS 5.5.0 · Playlist Deck: versione < 1.4.0')).toBeTruthy();
    expect(api.episodes.get('ep-2026-10-12')!.blocks[3]!.durationMs).toBe(130_000); // saved before the check
    expect(within(screen.getByTestId('issue-scene_missing-br1')).getByText('Scena assente in OBS')).toBeTruthy();
    expect(within(screen.getByTestId('issue-media_input_unverified-br1')).getByText('Sorgente media non verificabile')).toBeTruthy();
    expect(screen.getByTestId('issue-deck_legacy-global')).toBeTruthy();
    expect(screen.getByText(/nessuna segnalazione non è una garanzia/)).toBeTruthy();
  });

  it('says so when OBS is not connected', async () => {
    const { user } = await setup(EPISODE, (a) => {
      a.check = { connected: false, obsWebSocketVersion: null, deck: null, issues: [{ severity: 'error', code: 'obs_not_connected', blockId: null, message: 'OBS is not connected' }] };
    });
    await user.click(screen.getByRole('button', { name: 'Check OBS' }));
    expect((await screen.findAllByText('OBS non connesso')).length).toBeGreaterThan(0);
  });

  it('cancels when the pending edits cannot be saved', async () => {
    const { session, api, user } = await setup();
    api.failNext('putDoc', new TypeError('down'));
    session.apply(resizeBlock('b3', 130_000));
    await user.click(screen.getByRole('button', { name: 'Check OBS' }));
    expect(await screen.findByText('Salvataggio non riuscito: Check OBS annullato')).toBeTruthy();
    expect(api.count('checkObs')).toBe(0);
  });

  it('marks a result as out of date after the episode changes', async () => {
    const { session, user } = await setup();
    await user.click(screen.getByRole('button', { name: 'Check OBS' }));
    await screen.findByText('Il Check OBS non ha trovato problemi');
    session.apply(resizeBlock('b3', 130_000));
    expect(await screen.findByText(/Risultato non aggiornato/)).toBeTruthy();
  });

  it('reports a failing call', async () => {
    const { api, user } = await setup();
    api.failNext('checkObs', new Error('boom'));
    await user.click(screen.getByRole('button', { name: 'Check OBS' }));
    expect(await screen.findByText(/Check OBS non riuscito/)).toBeTruthy();
  });
});

describe('stale and switched state', () => {
  it('forgets the Check OBS result and the load message when another document is opened', async () => {
    const api = new FakeEditorApi();
    api.formats.set('solo-futsal', sampleFormat());
    api.episodes.set('ep-2026-10-12', sampleEpisode());
    api.episodes.set('ep-2026-10-13', { ...sampleEpisode(), id: 'ep-2026-10-13' });
    const { session, user } = await renderWithSession(<ValidationPanel />, { open: EPISODE, api });

    await user.click(screen.getByRole('button', { name: 'Check OBS' }));
    await screen.findByText('Il Check OBS non ha trovato problemi');
    await user.click(screen.getByRole('button', { name: 'Carica per la live' }));
    await screen.findByText('Puntata caricata per la live');

    await act(async () => {
      await session.open({ kind: 'episode', id: 'ep-2026-10-13' });
    });

    expect(screen.queryByText('Puntata caricata per la live')).toBeNull();
    expect(screen.queryByText('Il Check OBS non ha trovato problemi')).toBeNull();
  });

  it('drops the previous success when a re-check fails', async () => {
    const { api, user } = await setup();
    await user.click(screen.getByRole('button', { name: 'Check OBS' }));
    await screen.findByText('Il Check OBS non ha trovato problemi');

    api.failNext('checkObs', new Error('boom'));
    await user.click(screen.getByRole('button', { name: 'Check OBS' }));

    expect(await screen.findByText(/Check OBS non riuscito/)).toBeTruthy();
    expect(screen.queryByText('Il Check OBS non ha trovato problemi')).toBeNull();
  });

  it('hides the Check OBS issues once the result is out of date', async () => {
    const { session, user } = await setup(EPISODE, (a) => {
      a.check = { connected: true, obsWebSocketVersion: '5.5.0', deck: { capability: 'events' }, issues: [{ severity: 'error', code: 'scene_missing', blockId: 'br1', message: 'Scene "BREAK" is not in OBS' }] };
    });
    await user.click(screen.getByRole('button', { name: 'Check OBS' }));
    await screen.findByTestId('issue-scene_missing-br1');

    session.apply(resizeBlock('b3', 130_000));
    expect(await screen.findByText(/Risultato non aggiornato/)).toBeTruthy();
    expect(screen.queryByTestId('issue-scene_missing-br1')).toBeNull();
  });

  it('asks for a fresh confirmation after another Check OBS that still finds errors', async () => {
    const { api, user } = await setup(EPISODE, (a) => {
      a.check = { connected: true, obsWebSocketVersion: '5.5.0', deck: { capability: 'events' }, issues: [{ severity: 'error', code: 'scene_missing', blockId: 'br1', message: 'Scene "BREAK" is not in OBS' }] };
    });
    const loadButton = () => screen.getByRole('button', { name: 'Carica per la live' });

    await user.click(screen.getByRole('button', { name: 'Check OBS' }));
    await screen.findByTestId('issue-scene_missing-br1');
    await user.click(loadButton());
    expect(screen.getByText('Il Check OBS ha trovato errori: premi di nuovo per caricare lo stesso')).toBeTruthy();
    expect(api.count('loadLive')).toBe(0);

    await user.click(screen.getByRole('button', { name: 'Check OBS' }));
    await screen.findByTestId('issue-scene_missing-br1');
    await user.click(loadButton());

    expect(api.count('loadLive')).toBe(0);
    expect(screen.getByText('Il Check OBS ha trovato errori: premi di nuovo per caricare lo stesso')).toBeTruthy();
  });

  it('disables the load button while a load is in flight', async () => {
    const { api, user } = await setup();
    const release = api.hold('loadLive');
    const button = screen.getByRole('button', { name: 'Carica per la live' }) as HTMLButtonElement;

    await user.click(button);
    expect(button.disabled).toBe(true);

    release();
    expect(await screen.findByText('Puntata caricata per la live')).toBeTruthy();
    expect(button.disabled).toBe(false);
  });

  it('explains that the load waits while a document is being opened', async () => {
    const api = new FakeEditorApi();
    api.formats.set('solo-futsal', sampleFormat());
    api.episodes.set('ep-2026-10-12', sampleEpisode());
    api.episodes.set('ep-2026-10-13', { ...sampleEpisode(), id: 'ep-2026-10-13' });
    const { session } = await renderWithSession(<ValidationPanel />, { open: EPISODE, api });

    const release = api.hold('getDoc');
    let opening = Promise.resolve(true);
    await act(async () => {
      opening = session.open({ kind: 'episode', id: 'ep-2026-10-13' });
      await Promise.resolve();
    });

    const button = screen.getByRole('button', { name: 'Carica per la live' }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(screen.getByText('Attendere il caricamento della puntata')).toBeTruthy();

    await act(async () => {
      release();
      await opening;
    });
  });
});
