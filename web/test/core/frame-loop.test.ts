// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import { browserFrameLoop } from '../../src/core/frame-loop';

describe('browserFrameLoop', () => {
  it('runs one animation frame for all subscribers and stops when nobody listens', () => {
    const queue: Array<() => void> = [];
    const cancelled: number[] = [];
    const errors: unknown[] = [];
    const loop = browserFrameLoop((cb) => queue.push(cb), (h) => cancelled.push(h), (e) => errors.push(e));
    const seen: string[] = [];
    const offA = loop.subscribe(() => seen.push('a'));
    loop.subscribe(() => {
      throw new Error('bad subscriber');
    });
    const offC = loop.subscribe(() => seen.push('c'));
    expect(queue).toHaveLength(1);
    queue.shift()!();
    expect(seen).toEqual(['a', 'c']);
    expect(errors).toHaveLength(1);
    expect(queue).toHaveLength(1);
    offA();
    offC();
    expect(cancelled).toHaveLength(0); // the throwing subscriber is still there
  });

  it('cancels the pending frame when the last subscriber leaves', () => {
    const cancelled: number[] = [];
    const loop = browserFrameLoop(() => 7, (h) => cancelled.push(h));
    const off = loop.subscribe(() => {});
    off();
    expect(cancelled).toEqual([7]);
  });

  it('keeps a single pending frame when a subscriber subscribes during a tick', () => {
    const queue: Array<() => void> = [];
    const loop = browserFrameLoop((cb) => {
      queue.push(cb);
      return queue.length;
    });
    const runs: string[] = [];
    let subscribed = false;
    loop.subscribe(() => {
      runs.push('a');
      if (!subscribed) {
        subscribed = true;
        loop.subscribe(() => runs.push('b'));
      }
    });
    expect(queue).toHaveLength(1);
    queue.shift()!(); // frame 1: the 'a' subscriber subscribes 'b' from inside the tick
    expect(queue).toHaveLength(1); // no second raf: the handle scheduled during the tick is the only one
    queue.shift()!(); // frame 2: each subscriber runs once
    expect(runs).toEqual(['a', 'a', 'b']);
    expect(queue).toHaveLength(1);
  });
});
