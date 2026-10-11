// SPDX-License-Identifier: GPL-2.0-or-later
import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { ClientSnapshot } from '../../src/core/ws-client';
import type { Anchor, PresenterView } from '../../src/core/views';
import { PresenterScreen } from '../../src/presenter/PresenterScreen';
import { renderLive } from '../support/render';
import { StaticStore, snapshotOf } from '../support/store';
import { WALL, breakView, controlView, endedView, mediaView, preshowView, studioView } from '../support/views';

const cd = (endsAt: number, source: 'measured' | 'estimated' = 'measured'): Anchor => ({ kind: 'countdown', endsAt, source });

function show(view: PresenterView | null, over: Partial<ClientSnapshot<'presenter'>> = {}, lang: 'it' | 'en' = 'it') {
  const store = new StaticStore(snapshotOf<'presenter'>(view, over));
  const utils = renderLive(<PresenterScreen />, store, lang);
  const q = (sel: string) => utils.container.querySelector<HTMLElement>(sel);
  const text = (sel: string) => q(sel)?.textContent?.trim() ?? null;
  const mode = () => q('.p-root')?.dataset.mode;
  return { ...utils, store, q, text, mode };
}

describe('<PresenterScreen>', () => {
  it('waiting: only CONNESSIONE… and no number before the first view', () => {
    const p = show(null, { hasView: false, synced: false, stale: true });
    expect(p.mode()).toBe('waiting');
    expect(screen.getByRole('status').textContent).toBe('CONNESSIONE…');
    expect(p.container.textContent).not.toMatch(/\d:\d\d/);
  });

  it('waiting: a view without a clock sample shows no number either', () => {
    const p = show(studioView(), { synced: false });
    expect(p.mode()).toBe('waiting');
    expect(p.container.textContent).not.toMatch(/\d:\d\d/);
  });

  it('no episode loaded', () => {
    const p = show(null);
    expect(p.mode()).toBe('noepisode');
    expect(p.text('.p-main .label-text')).toBe('NESSUNA PUNTATA CARICATA');
    expect(p.text('.p-wall')).toBe('14:13:20');
    expect(p.q('.p-next-title')).toBeNull();
  });

  it('PRE-SHOW: countdown to the planned start and the rundown preview', () => {
    const p = show(preshowView());
    expect(p.mode()).toBe('preshow');
    expect(p.text('.p-main .label-text')).toBe('INIZIO PROGRAMMA');
    expect(p.text('.p-main-counter')).toBe('10:00');
    expect(p.text('.p-main .caption')).toBe('ORE 14:23:20');
    expect([...p.container.querySelectorAll('.p-upcoming li')].map((li) => li.textContent)).toEqual([
      'Primo blocco', 'Servizio 1', 'Break 1', 'Secondo blocco',
    ]);
    expect(p.text('.p-side .caption')).toBe('DURATA TOTALE 27:00');
    expect(p.q('.p-delay')).toBeNull();
  });

  it('STUDIO: block countdown, next, program end and status strip', () => {
    const p = show(studioView());
    p.advance(0);
    expect(p.mode()).toBe('studio');
    expect(p.text('.p-main .label-text')).toBe('BLOCCO 3 · Secondo blocco');
    expect(p.text('.p-main-counter')).toBe('8:42');
    expect(p.q('.p-main')!.dataset.tally).toBe('none');
    expect(p.text('.p-main .caption')).toBe('TEMPO RIMANENTE BLOCCO');
    expect(p.text('.p-next-title')).toBe('Servizio 2');
    expect(p.text('.p-next-dur')).toBe('2:00');
    expect(p.text('.p-side-counter')).toBe('41:18');
    expect(p.text('.p-end-wall')).toBe('14:54:38');
    expect(p.text('.p-wall')).toBe('14:13:20');
    expect(p.text('.p-delay')).toBe('RITARDO +0:42');
    expect(p.text('.p-obs')).toBe('OBS ✓');
    const outs = [...p.container.querySelectorAll<HTMLElement>('.p-out')];
    expect(outs.map((o) => [o.textContent, o.dataset.on])).toEqual([['REC', 'true'], ['ON AIR', 'false']]);
  });

  it('AVVISO then SFORAMENTO: amber from 1:00, red and counting up past zero', () => {
    const p = show(studioView({ block: { index: 2, name: 'Secondo blocco', anchor: cd(WALL + 61_000) } }));
    p.advance(0);
    expect(p.text('.p-main-counter')).toBe('1:01');
    expect(p.q('.p-main')!.dataset.tally).toBe('none');
    p.advance(1_000);
    expect(p.text('.p-main-counter')).toBe('1:00');
    expect(p.q('.p-main')!.dataset.tally).toBe('warn');
    p.advance(60_000);
    expect(p.text('.p-main-counter')).toBe('+0:00');
    expect(p.q('.p-main')!.dataset.tally).toBe('over');
    p.advance(72_000);
    expect(p.text('.p-main-counter')).toBe('+1:12');
  });

  it('SERVIZIO: return countdown, what is on air with progress, the block is not shown', () => {
    const p = show(mediaView());
    expect(p.mode()).toBe('media');
    expect(p.text('.p-main .label-text')).toBe('RIENTRO TRA');
    expect(p.text('.p-main-counter')).toBe('1:42');
    expect(p.text('.p-onair-head .label-text')).toBe('SERVIZIO · Servizio 1');
    expect(p.text('.p-onair-counter')).toBe('1:42');
    expect(p.text('.p-return')).toBe('RIENTRO: Primo blocco');
    expect(p.container.textContent).not.toContain('BLOCCO 1');
    const fill = p.q('.progress-fill')!;
    expect(Number(/scaleX\(([\d.]+)\)/.exec(fill.style.transform)![1])).toBeCloseTo(83 / 185, 3);
    expect(p.text('.p-next-title')).toBe('Break 1');
  });

  it('BREAK: filler on air and the block to return to', () => {
    const p = show(breakView());
    expect(p.mode()).toBe('break');
    expect(p.text('.p-main-counter')).toBe('2:00');
    expect(p.text('.p-onair-head .label-text')).toBe('BREAK · Break 1');
    expect(p.text('.p-return')).toBe('RIENTRO: Secondo blocco');
  });

  it('RIENTRO IMMINENTE: full-screen green countdown, then red overrun after zero', () => {
    const p = show(breakView({ returnTo: { blockName: 'Secondo blocco', anchor: cd(WALL + 9_500) }, onAir: { title: 'Break 1', anchor: cd(WALL + 9_500), startedAtWall: WALL - 170_000, durationMs: 180_000 } }));
    expect(p.mode()).toBe('imminent');
    expect(p.text('.p-imminent-counter')).toBe('0:10');
    expect(p.q('.p-imminent')!.dataset.tally).toBe('imminent');
    expect(p.text('.p-imminent .p-return')).toBe('RIENTRO: Secondo blocco');
    expect(p.q('.p-next-title')).toBeNull();
    p.advance(9_600);
    expect(p.mode()).toBe('break');
    expect(p.text('.p-main-counter')).toBe('+0:00');
    p.advance(0);
    expect(p.q('.p-main')!.dataset.tally).toBe('over');
  });

  it('imminent boundary does not flicker on a re-anchor', () => {
    const at = (endsAt: number) => breakView({ returnTo: { blockName: 'Secondo blocco', anchor: cd(endsAt) } });
    const p = show(at(WALL + 10_100));
    expect(p.mode()).toBe('break');
    expect(p.text('.p-main-counter')).toBe('0:11');
    p.advance(200);
    expect(p.mode()).toBe('imminent');
    p.update({ view: at(WALL + 10_250) }); // the deck re-anchors 150 ms later: raw 10.05 s, still within the hysteresis
    expect(p.mode()).toBe('imminent');
    expect(p.text('.p-imminent-counter')).toBe('0:10');
  });

  it('OLTRE SCALETTA: rundown finished, positive red counter', () => {
    const p = show(studioView({ rundownFinished: true, block: { index: 3, name: 'Chiusura', anchor: cd(WALL - 72_000) } }));
    p.advance(0);
    expect(p.mode()).toBe('overrun');
    expect(p.text('.p-main .label-text')).toBe('SCALETTA TERMINATA');
    expect(p.text('.p-main-counter')).toBe('+1:12');
    expect(p.q('.p-main')!.dataset.tally).toBe('over');
  });

  it('FINE: total duration and final offset, no live delay', () => {
    const p = show(endedView());
    expect(p.mode()).toBe('ended');
    expect(p.text('.p-main .label-text')).toBe('FINE');
    expect(p.text('.p-ended-total')).toBe('27:12');
    expect(p.text('.p-main .caption')).toBe('SCARTO +0:12');
    expect(p.q('.p-delay')).toBeNull();
    expect(p.q('.p-next-title')).toBeNull();
  });

  it('OBS lost: warning in the strip and STIMATO on estimated values', () => {
    const p = show(
      studioView({
        block: { index: 2, name: 'Secondo blocco', anchor: cd(WALL + 522_000, 'estimated') },
        delay: { ms: 42_000, source: 'estimated' },
        status: { rec: true, stream: false, recPaused: false, obs: 'lost', control: 'auto' },
      }),
    );
    expect(p.text('.p-obs')).toBe('⚠ OBS NON CONNESSO');
    expect(p.q('.p-obs')!.dataset.ok).toBe('false');
    expect(p.text('.p-main .badge-estimated')).toBe('STIMATO');
    expect(p.q('.p-main-counter')!.dataset.source).toBe('estimated');
    expect(p.text('.p-delay')).toBe('RITARDO +0:42STIMATO');
  });

  it('paused: a frozen counter with PAUSA, and REC paused in the strip', () => {
    const p = show(
      studioView({
        block: { index: 2, name: 'Secondo blocco', anchor: { kind: 'frozen', valueMs: 300_000, source: 'measured' } },
        status: { rec: true, stream: false, recPaused: true, obs: 'ok', control: 'auto' },
      }),
    );
    expect(p.text('.p-main-counter')).toBe('5:00');
    expect(p.text('.p-main .badge-paused')).toBe('PAUSA');
    p.advance(5_000);
    expect(p.text('.p-main-counter')).toBe('5:00');
    expect(p.text('.p-out')).toBe('REC PAUSA');
  });

  it('unknown values show "—"', () => {
    const p = show(studioView({ next: null, programEnd: null, delay: null }));
    expect(p.text('.p-next-title')).toBe('—');
    expect(p.text('.p-side-counter')).toBe('—');
    expect(p.text('.p-delay')).toBe('RITARDO —');
  });

  it('shows the director message in its own row', () => {
    show(studioView({ message: { text: 'STRINGI' } }));
    expect(screen.getByRole('status').textContent).toBe('STRINGI');
  });

  it('stale: RICONNESSIONE…, counters frozen, then "—" after 10 s', () => {
    const p = show(studioView(), { stale: true, staleSince: WALL });
    expect(screen.getByRole('alert').textContent).toBe('RICONNESSIONE…');
    expect(p.text('.p-main-counter')).toBe('8:42');
    p.advance(3_000);
    expect(p.text('.p-main-counter')).toBe('8:42');
    expect(p.q('.p-main-counter')!.dataset.stale).toBe('true');
    p.advance(8_000);
    expect(p.text('.p-main-counter')).toBe('—');
  });

  it('stale 10 s while imminent shows media/break with —', () => {
    const p = show(
      breakView({ returnTo: { blockName: 'Secondo blocco', anchor: cd(WALL + 9_500) } }),
      { stale: true, staleSince: WALL },
    );
    expect(p.mode()).toBe('imminent');
    expect(p.text('.p-imminent-counter')).toBe('0:10');
    p.advance(3_000);
    expect(p.mode()).toBe('imminent');
    expect(p.text('.p-imminent-counter')).toBe('0:10');
    p.advance(8_000);
    expect(p.mode()).toBe('break');
    expect(p.text('.p-main-counter')).toBe('—');
  });

  it('never shows FUORI SCALETTA to the presenter', () => {
    const control = controlView({ offScript: { scene: 'CAMERA OSPITE', sinceWall: WALL } });
    const p = show(control.presenter);
    expect(p.container.textContent).not.toContain('FUORI SCALETTA');
    expect(p.container.textContent).not.toContain('CAMERA OSPITE');
  });

  it('speaks English with ?lang=en', () => {
    const p = show(studioView(), {}, 'en');
    expect(p.text('.p-main .label-text')).toBe('BLOCK 3 · Secondo blocco');
    expect(p.text('.p-main .caption')).toBe('BLOCK TIME LEFT');
    expect(p.text('.p-delay')).toBe('DELAY +0:42');
  });
});
