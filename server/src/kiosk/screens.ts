// SPDX-License-Identifier: GPL-2.0-or-later
import { z } from 'zod';

/** One monitor as the OBS plugin reports it (Qt QScreen). Mirrors plugin/core/ScreenInfo.hpp. */
export const ScreenInfo = z.object({
  name: z.string().min(1).max(200),
  x: z.number().int(),
  y: z.number().int(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  devicePixelRatio: z.number().positive().max(10).default(1),
  primary: z.boolean(),
});
export type ScreenInfo = z.infer<typeof ScreenInfo>;

/** Body of POST /api/internal/screens. */
export const ScreensBody = z.object({ screens: z.array(ScreenInfo).max(16) });
export type ScreensBody = z.infer<typeof ScreensBody>;

export interface ScreenStore {
  load(): Promise<ScreenInfo[]>;
  save(screens: ScreenInfo[]): Promise<void>;
}

export interface ScreenSnapshot {
  screens: ScreenInfo[];
  /** true = reported by the plugin since this app started; false = the list remembered from an earlier run. */
  live: boolean;
}

const same = (a: ScreenInfo[], b: ScreenInfo[]): boolean => JSON.stringify(a) === JSON.stringify(b);

/** The monitor list the plugin reports, kept in memory and remembered on disk for the next start. */
export class ScreenRegistry {
  private screens: ScreenInfo[] = [];
  private live = false;
  private readonly listeners = new Set<() => void>();

  constructor(
    private readonly store: ScreenStore,
    private readonly report: (err: unknown) => void = () => {},
  ) {}

  /** Loads the remembered list (marked not live). A missing or unreadable file means an empty list. */
  async init(): Promise<void> {
    try {
      this.screens = await this.store.load();
    } catch (err) {
      this.report(err);
      this.screens = [];
    }
  }

  get(): ScreenSnapshot {
    return { screens: this.screens.map((s) => ({ ...s })), live: this.live };
  }

  /** The plugin's list. Listeners hear about it only when it differs from what they already know. */
  set(screens: ScreenInfo[]): void {
    const changed = !this.live || !same(this.screens, screens);
    this.live = true;
    if (!changed) return;
    const listChanged = !same(this.screens, screens);
    this.screens = screens.map((s) => ({ ...s }));
    if (listChanged) this.store.save(this.screens).catch((err: unknown) => this.report(err));
    for (const listener of this.listeners) listener();
  }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}
