// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it, vi } from 'vitest';
import { ScreenRegistry, ScreensBody, type ScreenInfo, type ScreenStore } from '../../src/kiosk/screens';

const a: ScreenInfo = { name: 'DISPLAY1', x: 0, y: 0, width: 1920, height: 1080, devicePixelRatio: 1, primary: true };
const b: ScreenInfo = { name: 'DISPLAY2', x: 1920, y: 0, width: 1920, height: 1080, devicePixelRatio: 1, primary: false };

function store(initial: ScreenInfo[] = []): ScreenStore & { saved: ScreenInfo[][] } {
  const saved: ScreenInfo[][] = [];
  return { saved, load: async () => initial, save: async (s) => void saved.push(s) };
}

describe('ScreensBody', () => {
  it('accepts what the plugin sends and defaults the pixel ratio', () => {
    const parsed = ScreensBody.parse({ screens: [{ name: 'D', x: -1920, y: 0, width: 1920, height: 1080, primary: false }] });
    expect(parsed.screens[0]!.devicePixelRatio).toBe(1);
  });
  it('rejects empty names, zero sizes, fractional positions and more than 16 screens', () => {
    expect(ScreensBody.safeParse({ screens: [{ ...a, name: '' }] }).success).toBe(false);
    expect(ScreensBody.safeParse({ screens: [{ ...a, width: 0 }] }).success).toBe(false);
    expect(ScreensBody.safeParse({ screens: [{ ...a, x: 0.5 }] }).success).toBe(false);
    expect(ScreensBody.safeParse({ screens: Array.from({ length: 17 }, () => a) }).success).toBe(false);
  });
});

describe('ScreenRegistry', () => {
  it('starts with the remembered list marked as not live', async () => {
    const r = new ScreenRegistry(store([a, b]));
    await r.init();
    expect(r.get()).toEqual({ screens: [a, b], live: false });
  });

  it('a corrupt memory file means an empty list, reported, not a crash', async () => {
    const report = vi.fn();
    const r = new ScreenRegistry({ load: async () => Promise.reject(new Error('bad json')), save: async () => {} }, report);
    await r.init();
    expect(r.get()).toEqual({ screens: [], live: false });
    expect(report).toHaveBeenCalled();
  });

  it('set() makes the list live, remembers it and tells listeners', async () => {
    const s = store();
    const r = new ScreenRegistry(s);
    await r.init();
    const heard = vi.fn();
    r.onChange(heard);
    r.set([a, b]);
    expect(r.get()).toEqual({ screens: [a, b], live: true });
    expect(heard).toHaveBeenCalledTimes(1);
    expect(s.saved).toEqual([[a, b]]);
  });

  it('the plugin repeating the same list does not rewrite the file or wake anyone again', async () => {
    const s = store();
    const r = new ScreenRegistry(s);
    await r.init();
    r.set([a, b]);
    const heard = vi.fn();
    r.onChange(heard);
    r.set([a, b]);
    expect(heard).not.toHaveBeenCalled();
    expect(s.saved).toHaveLength(1);
  });

  it('the first live list after a restart wakes listeners even when it equals the remembered one, but writes nothing', async () => {
    const s = store([a, b]);
    const r = new ScreenRegistry(s);
    await r.init();
    const heard = vi.fn();
    r.onChange(heard);
    r.set([a, b]);
    expect(heard).toHaveBeenCalledTimes(1);
    expect(s.saved).toHaveLength(0);
    expect(r.get().live).toBe(true);
  });

  it('a failing save is reported and does not break the registry', async () => {
    const report = vi.fn();
    const r = new ScreenRegistry({ load: async () => [], save: async () => Promise.reject(new Error('disk full')) }, report);
    await r.init();
    r.set([a]);
    await new Promise((res) => setTimeout(res, 0));
    expect(report).toHaveBeenCalled();
    expect(r.get().screens).toEqual([a]);
  });

  it('get() returns copies', async () => {
    const r = new ScreenRegistry(store());
    await r.init();
    r.set([a]);
    r.get().screens[0]!.name = 'hacked';
    expect(r.get().screens[0]!.name).toBe('DISPLAY1');
  });
});
