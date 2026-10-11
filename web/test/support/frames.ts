// SPDX-License-Identifier: GPL-2.0-or-later
import type { FrameLoop } from '../../src/core/frame-loop';

/** A frame loop driven by the test. */
export class ManualFrameLoop implements FrameLoop {
  private readonly subscribers = new Set<() => void>();

  subscribe(fn: () => void): () => void {
    this.subscribers.add(fn);
    return () => {
      this.subscribers.delete(fn);
    };
  }

  frame(): void {
    for (const fn of [...this.subscribers]) fn();
  }

  get size(): number {
    return this.subscribers.size;
  }
}
