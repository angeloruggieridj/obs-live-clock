// SPDX-License-Identifier: GPL-2.0-or-later

export interface SelectionSnapshot {
  blockId: string | null;
  /** Increments each time something asks to bring the selection into view (validation click-to-focus). */
  revealTick: number;
}

export class SelectionStore {
  private snap: SelectionSnapshot = { blockId: null, revealTick: 0 };
  private readonly listeners = new Set<() => void>();

  getSnapshot = (): SelectionSnapshot => this.snap;

  subscribe = (l: () => void): (() => void) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };

  select(blockId: string | null, opts: { reveal?: boolean } = {}): void {
    const revealTick = opts.reveal === true ? this.snap.revealTick + 1 : this.snap.revealTick;
    if (blockId === this.snap.blockId && revealTick === this.snap.revealTick) return;
    this.snap = { blockId, revealTick };
    for (const l of [...this.listeners]) l();
  }
}
