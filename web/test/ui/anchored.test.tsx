// SPDX-License-Identifier: GPL-2.0-or-later
import { Profiler, useRef } from 'react';
import { act, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { Anchor } from '../../src/core/views';
import { AnchoredProgress } from '../../src/ui/AnchoredProgress';
import { AnchoredTime } from '../../src/ui/AnchoredTime';
import { AnchoredWall } from '../../src/ui/AnchoredWall';
import { SourceBadge } from '../../src/ui/SourceBadge';
import { useFrameValue, useLive } from '../../src/ui/live-context';
import { renderLive } from '../support/render';
import { StaticStore, snapshotOf } from '../support/store';
import { WALL, studioView } from '../support/views';

const cd = (endsAt: number, source: 'measured' | 'planned' | 'estimated' = 'measured'): Anchor => ({ kind: 'countdown', endsAt, source });
const store = () => new StaticStore(snapshotOf<'presenter'>(studioView()));
const scaleOf = (el: HTMLElement) => Number(/scaleX\(([\d.]+)\)/.exec(el.style.transform)![1]);

describe('<AnchoredTime>', () => {
  it('renders the right value on the very first paint, then repaints the same text node without re-rendering', () => {
    let commits = 0;
    const s = store();
    const { container, advance } = renderLive(
      <Profiler id="counter" onRender={() => { commits += 1; }}>
        <AnchoredTime anchor={cd(WALL + 61_000)} className="counter" />
      </Profiler>,
      s,
    );
    const el = container.querySelector<HTMLElement>('.counter')!;
    expect(el.textContent).toBe('1:01');
    const node = el.firstChild;
    for (let i = 0; i < 120; i++) advance(500);
    expect(el.textContent).toBe('0:01');
    expect(el.firstChild).toBe(node);
    expect(commits).toBe(1);
  });

  it('writes length, source, paused and stale attributes', () => {
    const { container } = renderLive(
      <>
        <AnchoredTime anchor={cd(WALL + 61_000, 'estimated')} className="a" />
        <AnchoredTime anchor={{ kind: 'frozen', valueMs: 600_000, source: 'measured' }} className="b" />
      </>,
      store(),
    );
    const a = container.querySelector<HTMLElement>('.a')!;
    const b = container.querySelector<HTMLElement>('.b')!;
    expect(a.dataset).toMatchObject({ len: '4', source: 'estimated', paused: 'false', stale: 'false' });
    expect(b.textContent).toBe('10:00');
    expect(b.dataset).toMatchObject({ len: '5', source: 'measured', paused: 'true' });
  });

  it('shows "—" before the clock is synced and for unknown anchors', () => {
    const s = store();
    s.now = null;
    const { container } = renderLive(
      <>
        <AnchoredTime anchor={cd(WALL + 61_000)} className="a" />
        <AnchoredTime anchor={{ kind: 'unknown' }} className="b" />
      </>,
      s,
    );
    expect(container.querySelector('.a')!.textContent).toBe('—');
    expect(container.querySelector('.b')!.textContent).toBe('—');
  });

  it('freezes when the data goes stale and blanks after 10 s', () => {
    const { container, advance, update } = renderLive(<AnchoredTime anchor={cd(WALL + 61_000)} className="c" />, store());
    const el = container.querySelector<HTMLElement>('.c')!;
    update({ stale: true, staleSince: WALL });
    advance(3_000);
    expect(el.textContent).toBe('1:01');
    expect(el.dataset.stale).toBe('true');
    advance(8_000);
    expect(el.textContent).toBe('—');
    update({ stale: false, staleSince: null });
    expect(el.textContent).toBe('0:50');
    expect(el.dataset.stale).toBe('false');
  });

  it('writes the tally onto the target element on every frame', () => {
    function Tile() {
      const ref = useRef<HTMLDivElement>(null);
      return (
        <div ref={ref} data-testid="tile">
          <AnchoredTime anchor={cd(WALL + 61_000)} tally={(f) => (f.ticks !== null && f.ticks <= 60 ? 'warn' : 'none')} tallyRef={ref} />
        </div>
      );
    }
    const { advance } = renderLive(<Tile />, store());
    advance(0);
    expect(screen.getByTestId('tile').dataset.tally).toBe('none');
    advance(1_000);
    expect(screen.getByTestId('tile').dataset.tally).toBe('warn');
  });

  it('keeps the second-boundary hysteresis across a re-anchor', () => {
    const { container, rerender } = renderLive(<AnchoredTime anchor={cd(WALL + 41_000)} className="c" />, store());
    const el = container.querySelector('.c')!;
    expect(el.textContent).toBe('0:41');
    rerender(<AnchoredTime anchor={cd(WALL + 41_100)} className="c" />);
    expect(el.textContent).toBe('0:41');
    rerender(<AnchoredTime anchor={cd(WALL + 41_300)} className="c" />);
    expect(el.textContent).toBe('0:42');
  });
});

describe('<AnchoredProgress>, <AnchoredWall>, <SourceBadge>, useFrameValue', () => {
  it('fills the progress bar from the anchor and the duration', () => {
    const { container, advance } = renderLive(
      <>
        <AnchoredProgress anchor={cd(WALL + 50_000)} durationMs={100_000} />
        <AnchoredProgress anchor={cd(WALL + 50_000)} durationMs={null} />
      </>,
      store(),
    );
    const [known, unknown] = [...container.querySelectorAll<HTMLElement>('.progress-fill')];
    expect(scaleOf(known!)).toBeCloseTo(0.5, 3);
    expect(known!.dataset.known).toBe('true');
    advance(25_000);
    expect(scaleOf(known!)).toBeCloseTo(0.75, 3);
    advance(60_000);
    expect(scaleOf(known!)).toBe(1);
    expect(unknown!.dataset.known).toBe('false');
  });

  it('freezes the progress bar while stale, then blanks it after 10 s', () => {
    const { container, advance, update } = renderLive(<AnchoredProgress anchor={cd(WALL + 50_000)} durationMs={100_000} />, store());
    const bar = container.querySelector<HTMLElement>('.progress-fill')!;
    expect(scaleOf(bar)).toBeCloseTo(0.5, 3);
    expect(bar.dataset.stale).toBe('false');
    update({ stale: true, staleSince: WALL });
    advance(3_000);
    expect(bar.dataset.stale).toBe('true');
    expect(bar.dataset.known).toBe('true');
    expect(scaleOf(bar)).toBeCloseTo(0.5, 3);
    advance(7_001);
    expect(bar.dataset.known).toBe('false');
    expect(scaleOf(bar)).toBe(0);
  });

  it('shows the server wall clock, and "—" before the first sample', () => {
    const s = store();
    const { container, advance, frames } = renderLive(<AnchoredWall className="w" />, s);
    expect(container.querySelector('.w')!.textContent).toBe('14:13:20');
    advance(1_000);
    expect(container.querySelector('.w')!.textContent).toBe('14:13:21');
    s.now = null;
    act(() => frames.frame());
    expect(container.querySelector('.w')!.textContent).toBe('—');
  });

  it('badges estimated, planned (on request) and paused values', () => {
    const { container } = renderLive(
      <>
        <span className="e"><SourceBadge anchor={cd(WALL, 'estimated')} /></span>
        <span className="p"><SourceBadge source="planned" showPlanned /></span>
        <span className="q"><SourceBadge source="planned" /></span>
        <span className="f"><SourceBadge anchor={{ kind: 'frozen', valueMs: 1, source: 'measured' }} /></span>
        <span className="m"><SourceBadge source="measured" /></span>
      </>,
      store(),
    );
    expect(container.querySelector('.e')!.textContent).toBe('STIMATO');
    expect(container.querySelector('.p')!.textContent).toBe('PIAN.');
    expect(container.querySelector('.q')!.textContent).toBe('');
    expect(container.querySelector('.f')!.textContent).toBe('PAUSA');
    expect(container.querySelector('.m')!.textContent).toBe('');
  });

  it('useFrameValue re-renders only when the derived value changes', () => {
    let commits = 0;
    function Phase() {
      const { store: s } = useLive();
      const v = useFrameValue(() => ((s.serverNow() ?? 0) >= WALL + 5_000 ? 'late' : 'early'));
      return <span className="v">{v}</span>;
    }
    const { container, advance } = renderLive(
      <Profiler id="v" onRender={() => { commits += 1; }}>
        <Phase />
      </Profiler>,
      store(),
    );
    for (let i = 0; i < 100; i++) advance(100);
    expect(container.querySelector('.v')!.textContent).toBe('late');
    expect(commits).toBe(2);
  });
});
