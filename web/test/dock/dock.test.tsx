// SPDX-License-Identifier: GPL-2.0-or-later
import { act, fireEvent, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ClientSnapshot } from '../../src/core/ws-client';
import { CommandError } from '../../src/core/ws-client';
import type { ApiClient } from '../../src/core/http';
import type { Anchor, ControlView } from '../../src/core/views';
import { DockScreen } from '../../src/dock/DockScreen';
import { fakeApi } from '../support/api';
import { renderLive } from '../support/render';
import { StaticStore, snapshotOf } from '../support/store';
import { WALL, controlView, endedView, mediaView, preshowView, studioView } from '../support/views';

const cd = (endsAt: number): Anchor => ({ kind: 'countdown', endsAt, source: 'measured' });

afterEach(() => {
  vi.useRealTimers();
});

async function dock(view: ControlView | null = controlView(), over: Partial<ClientSnapshot<'control'>> = {}, api: ApiClient = fakeApi()) {
  const store = new StaticStore(snapshotOf<'control'>(view, over));
  const utils = renderLive(<DockScreen api={api} search="" />, store);
  await act(async () => {}); // let the first OBS status poll settle
  const texts = (sel: string) => [...utils.container.querySelectorAll(sel)].map((el) => el.textContent?.trim());
  const text = (sel: string) => utils.container.querySelector(sel)?.textContent?.trim() ?? null;
  const button = (name: string) => screen.getByRole('button', { name }) as HTMLButtonElement;
  return { ...utils, store, texts, text, button };
}

describe('<DockScreen> status and alerts', () => {
  it('shows phase, segment, current block, delay and program end', async () => {
    const d = await dock();
    expect(d.text('.badge-phase')).toBe('LIVE');
    expect(d.text('.badge-segment')).toBe('STUDIO');
    expect(d.text('.status-title')).toBe('BLOCCO 3 · Secondo blocco');
    expect(d.text('.status-counter')).toBe('8:42');
    expect(d.text('.status-delay')).toBe('RITARDO +0:42');
    expect(d.text('.status-end')).toBe('FINE PROGRAMMA 41:18 · 14:54:38');
    expect(d.text('.status-obs')).toBe('OBS ✓');
    expect(d.container.querySelector('.badge-manual')).toBeNull();
  });

  it('shows what is on air and the return during a service', async () => {
    const d = await dock(controlView({ presenter: mediaView() }));
    expect(d.text('.badge-segment')).toBe('SERVIZIO');
    expect(d.text('.status-title')).toBe('IN ONDA: Servizio 1');
    expect(d.text('.status-counter')).toBe('1:42');
    expect(d.text('.status-return')).toBe('RIENTRO: Primo blocco');
  });

  it('marks estimated values and manual control', async () => {
    const d = await dock(controlView({ control: 'manual', presenter: studioView({ delay: { ms: 42_000, source: 'estimated' } }) }));
    expect(d.text('.status-delay')).toBe('RITARDO +0:42STIMATO');
    expect(d.text('.badge-manual')).toBe('MANUALE');
  });

  it('lists the alerts the director must see', async () => {
    const d = await dock(controlView({ obs: 'lost', ambiguous: true, offScript: { scene: 'CAMERA OSPITE', sinceWall: WALL } }));
    expect(d.texts('.alert')).toEqual([
      '⚠ OBS NON CONNESSO',
      'FUORI SCALETTA: CAMERA OSPITE dalle 14:13:20',
      'POSIZIONE INCERTA: verificare il rundown',
    ]);
  });

  it('reports OBS authentication and Playlist Deck problems from the status endpoint', async () => {
    const auth = await dock(controlView(), {}, fakeApi({ obsStatus: async () => ({ connection: 'auth_failed', deck: null }) }));
    expect(auth.texts('.alert')).toEqual(['OBS: AUTENTICAZIONE FALLITA']);
    auth.unmount();
    const absent = await dock(controlView(), {}, fakeApi({ obsStatus: async () => ({ connection: 'connected', deck: { capability: 'absent' } }) }));
    expect(absent.texts('.alert')).toEqual(['PLAYLIST DECK ASSENTE: nessun servizio misurato']);
    absent.unmount();
    const legacy = await dock(controlView(), {}, fakeApi({ obsStatus: async () => ({ connection: 'connected', deck: { capability: 'legacy' } }) }));
    expect(legacy.texts('.alert')).toEqual(['PLAYLIST DECK < 1.4.0: modalità ridotta']);
  });

  it('offers the open decisions with the applied default pressed', async () => {
    const d = await dock(
      controlView({
        decisions: [
          { id: 1, kind: 'all_outputs_stopped', atWall: WALL, defaultChoice: 'interruption', choice: 'interruption', confirmed: false },
          { id: 2, kind: 'output_restart', atWall: WALL, defaultChoice: 'continue', choice: 'continue', confirmed: true },
        ],
      }),
    );
    expect(d.texts('.decision-text')).toEqual(['REC/STREAM FERMATI alle 14:13:20']);
    expect(d.button('Interruzione').getAttribute('aria-pressed')).toBe('true');
    expect(d.button('Fine programma').getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(d.button('Interruzione'));
    expect(d.store.commands).toEqual([{ name: 'resolve_decision', id: 1, choice: 'interruption' }]);
    fireEvent.click(d.button('Fine programma'));
    expect(d.store.commands).toHaveLength(1); // armed, not sent
    fireEvent.click(d.button('Fine programma'));
    expect(d.store.commands[1]).toEqual({ name: 'resolve_decision', id: 1, choice: 'end' });
  });

  it('resets the status tally to none when a warn/over studio becomes ended', async () => {
    const d = await dock(controlView({ presenter: studioView({ block: { index: 2, name: 'Secondo blocco', anchor: cd(WALL + 61_000) } }) }));
    const status = () => d.container.querySelector<HTMLElement>('.status')!;
    d.advance(0);
    expect(status().dataset.tally).toBe('none');
    d.advance(1_000);
    expect(status().dataset.tally).toBe('warn');
    d.advance(60_000);
    expect(status().dataset.tally).toBe('over');
    d.update({ view: controlView({ presenter: endedView() }) });
    expect(d.text('.badge-phase')).toBe('FINE');
    expect(status().dataset.tally).toBe('none');
  });

  it('stale: RICONNESSIONE…, the counter freezes and dims, then "—" after 10 s', async () => {
    const d = await dock(controlView(), { stale: true, staleSince: WALL });
    expect(screen.getByRole('alert').textContent).toBe('RICONNESSIONE…');
    const counter = () => d.container.querySelector<HTMLElement>('.status-counter')!;
    expect(counter().textContent).toBe('8:42');
    d.advance(3_000);
    expect(counter().textContent).toBe('8:42');
    expect(counter().dataset.stale).toBe('true');
    d.advance(8_000);
    expect(counter().textContent).toBe('—');
  });
});

describe('<DockScreen> messages', () => {
  it('sends preset messages labelled with their hotkey slot', async () => {
    const d = await dock();
    expect(d.texts('.preset-grid button')).toEqual(['1 · STRINGI', '2 · GUARDA CAM 2']);
    fireEvent.click(d.button('1 · STRINGI'));
    expect(d.store.commands).toEqual([{ name: 'send_message', text: 'STRINGI', dismiss: { kind: 'timeout', ms: 10_000 } }]);
  });

  it('sends free text with manual dismissal and clears the field after the change', async () => {
    const d = await dock();
    const input = screen.getByRole('textbox', { name: 'Testo libero' }) as HTMLInputElement;
    expect(input.maxLength).toBe(200);
    expect(d.button('INVIA').disabled).toBe(true);
    fireEvent.change(input, { target: { value: '  CHIUDI  ' } });
    expect(d.button('INVIA').disabled).toBe(false);
    await act(async () => {
      fireEvent.click(d.button('INVIA'));
    });
    expect(d.store.commands).toEqual([{ name: 'send_message', text: 'CHIUDI', dismiss: { kind: 'manual' } }]);
    expect(input.value).toBe('');
  });

  it('shows the message on air and clears it', async () => {
    const d = await dock(controlView({ presenter: studioView({ message: { text: 'STRINGI' } }) }));
    expect(d.text('.current-message')).toBe('In onda: STRINGI');
    fireEvent.click(d.button('CLEAR'));
    expect(d.store.commands).toEqual([{ name: 'clear_message' }]);
    d.unmount();
    const quiet = await dock();
    expect(quiet.button('CLEAR').disabled).toBe(true);
  });
});

describe('<DockScreen> emergency', () => {
  it('is collapsed by default and needs a second click within 1.5 s', async () => {
    vi.useFakeTimers();
    const d = await dock();
    expect((d.container.querySelector('details.emergency') as HTMLDetailsElement).open).toBe(false);
    const next = d.button('NEXT');
    fireEvent.click(next);
    expect(d.store.commands).toEqual([]);
    expect(next.textContent).toBe('Premi di nuovo per confermare');
    act(() => vi.advanceTimersByTime(1_600));
    expect(next.textContent).toBe('NEXT');
    fireEvent.click(next);
    expect(d.store.commands).toEqual([]);
    fireEvent.click(next);
    expect(d.store.commands).toEqual([{ name: 'next' }]);
  });

  it('fires on a long press and ignores the click that follows', async () => {
    vi.useFakeTimers();
    const d = await dock();
    const prev = d.button('PREV');
    fireEvent.pointerDown(prev);
    act(() => vi.advanceTimersByTime(799));
    expect(d.store.commands).toEqual([]);
    act(() => vi.advanceTimersByTime(1));
    expect(d.store.commands).toEqual([{ name: 'prev' }]);
    fireEvent.pointerUp(prev);
    fireEvent.click(prev);
    expect(d.store.commands).toEqual([{ name: 'prev' }]);
  });

  it('adjusts by the preset step and toggles manual control', async () => {
    const d = await dock();
    const twice = (name: string) => {
      fireEvent.click(d.button(name));
      fireEvent.click(d.button(name));
    };
    twice('−0:30');
    twice('+0:30');
    twice('MANUALE');
    expect(d.store.commands).toEqual([
      { name: 'adjust', deltaMs: -30_000 },
      { name: 'adjust', deltaMs: 30_000 },
      { name: 'set_control', control: 'manual' },
    ]);
    d.unmount();
    const manual = await dock(controlView({ control: 'manual' }));
    expect(manual.button('AUTO')).toBeTruthy();
  });

  it('enables only the commands that make sense in the phase', async () => {
    const pre = await dock(controlView({ presenter: preshowView() }));
    expect(pre.button('START PROGRAM').disabled).toBe(false);
    for (const name of ['PREV', 'NEXT', '−0:30', '+0:30', 'END PROGRAM']) expect(pre.button(name).disabled, name).toBe(true);
    pre.unmount();
    const live = await dock();
    expect(live.button('START PROGRAM').disabled).toBe(true);
    for (const name of ['PREV', 'NEXT', '−0:30', '+0:30', 'END PROGRAM', 'MANUALE']) expect(live.button(name).disabled, name).toBe(false);
  });

  it('says when a command had no effect or failed, for 3 s', async () => {
    vi.useFakeTimers();
    const d = await dock();
    d.store.reply = async () => ({ changed: false });
    fireEvent.click(d.button('NEXT')); // arm (a render must happen between the two clicks)
    await act(async () => {
      fireEvent.click(d.button('NEXT'));
    });
    expect(d.text('.cmd-feedback')).toBe('Nessun effetto');
    act(() => vi.advanceTimersByTime(3_000));
    expect(d.text('.cmd-feedback')).toBe('');
    d.store.reply = async () => {
      throw new CommandError('no_episode', 'No episode is loaded');
    };
    fireEvent.click(d.button('PREV'));
    await act(async () => {
      fireEvent.click(d.button('PREV'));
    });
    expect(d.text('.cmd-feedback')).toBe('Comando non riuscito: no_episode');
  });

  it('clears the previous feedback as soon as the next command succeeds', async () => {
    vi.useFakeTimers();
    const d = await dock();
    d.store.reply = async () => ({ changed: false });
    fireEvent.click(d.button('NEXT')); // arm (a render must happen between the two clicks)
    await act(async () => {
      fireEvent.click(d.button('NEXT'));
    });
    expect(d.text('.cmd-feedback')).toBe('Nessun effetto');
    d.store.reply = async () => ({ changed: true });
    fireEvent.click(d.button('PREV'));
    await act(async () => {
      fireEvent.click(d.button('PREV'));
    });
    expect(d.text('.cmd-feedback')).toBe('');
    expect(d.store.commands).toEqual([{ name: 'next' }, { name: 'prev' }]);
  });

  it('disables every command while the snapshot is stale, and re-enables them when fresh', async () => {
    const view = controlView({
      presenter: studioView({ message: { text: 'STRINGI' } }),
      decisions: [{ id: 1, kind: 'all_outputs_stopped', atWall: WALL, defaultChoice: 'interruption', choice: 'interruption', confirmed: false }],
    });
    const names = ['PREV', 'NEXT', '−0:30', '+0:30', 'END PROGRAM', 'MANUALE', 'CLEAR', '1 · STRINGI', '2 · GUARDA CAM 2', 'Interruzione', 'Fine programma'];
    const stale = await dock(view, { stale: true, staleSince: WALL });
    for (const name of names) expect(stale.button(name).disabled, name).toBe(true);
    stale.unmount();
    const fresh = await dock(view);
    for (const name of names) expect(fresh.button(name).disabled, name).toBe(false);
  });
});

describe('<DockScreen> without a show', () => {
  it('disables every command when no episode is loaded', async () => {
    const d = await dock(null);
    expect(d.text('.no-episode')).toBe('NESSUNA PUNTATA CARICATA');
    expect(d.texts('.preset-grid button')).toEqual([]);
    for (const name of ['START PROGRAM', 'PREV', 'NEXT', 'END PROGRAM', 'MANUALE', 'CLEAR']) expect(d.button(name).disabled, name).toBe(true);
  });

  it('shows an em dash instead of inventing a 0:30 step when no episode is loaded', async () => {
    const d = await dock(null);
    expect(d.texts('.emergency-grid button')).toEqual(['START PROGRAM', 'PREV', 'NEXT', '−—', '+—', 'MANUALE', 'END PROGRAM']);
    for (const name of ['−—', '+—']) expect(d.button(name).disabled, name).toBe(true);
  });

  it('shows only CONNESSIONE… before the first view', async () => {
    const d = await dock(null, { hasView: false, synced: false, stale: true });
    expect(screen.getAllByRole('status').map((s) => s.textContent)).toContain('CONNESSIONE…');
    expect(d.container.querySelector('.status')).toBeNull();
  });

  it('links to the extended view in a new tab', async () => {
    await dock();
    const link = screen.getByRole('link', { name: 'Apri vista estesa' });
    expect(link.getAttribute('href')).toBe('/control');
    expect(link.getAttribute('target')).toBe('_blank');
  });
});
