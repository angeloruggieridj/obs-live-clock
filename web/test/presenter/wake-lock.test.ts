// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it, vi } from 'vitest';
import { keepScreenAwake } from '../../src/presenter/wake-lock';

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function fakeDoc(visibilityState: DocumentVisibilityState = 'visible') {
  const target = new EventTarget();
  return {
    visibilityState,
    addEventListener: target.addEventListener.bind(target),
    removeEventListener: target.removeEventListener.bind(target),
    fire: () => target.dispatchEvent(new Event('visibilitychange')),
  };
}

function fakeNav(fail = false) {
  const sentinels: Array<{ released: boolean; release: () => Promise<void> }> = [];
  const request = vi.fn(async (_type: 'screen') => {
    if (fail) throw new Error('NotAllowedError');
    const s = { released: false, release: async () => { s.released = true; } };
    sentinels.push(s);
    return s;
  });
  return { nav: { wakeLock: { request } }, request, sentinels };
}

describe('keepScreenAwake', () => {
  it('holds a screen wake lock and takes it again when the page becomes visible', async () => {
    const doc = fakeDoc();
    const { nav, request, sentinels } = fakeNav();
    const stop = keepScreenAwake(nav, doc, () => {});
    await flush();
    expect(request).toHaveBeenCalledWith('screen');
    sentinels[0]!.released = true; // the browser drops it while the page is hidden
    doc.fire();
    await flush();
    expect(request).toHaveBeenCalledTimes(2);
    doc.fire();
    await flush();
    expect(request).toHaveBeenCalledTimes(2); // still held: no new request
    stop();
    expect(sentinels[1]!.released).toBe(true);
  });

  it('stop() removes the visibilitychange listener', async () => {
    const doc = fakeDoc();
    const { nav, sentinels } = fakeNav();
    const remove = vi.spyOn(doc, 'removeEventListener');
    const stop = keepScreenAwake(nav, doc, () => {});
    await flush();
    stop();
    expect(remove).toHaveBeenCalledWith('visibilitychange', expect.any(Function));
    expect(sentinels[0]!.released).toBe(true);
  });

  it('waits for the page to be visible', async () => {
    const { nav, request } = fakeNav();
    keepScreenAwake(nav, fakeDoc('hidden'), () => {});
    await flush();
    expect(request).not.toHaveBeenCalled();
  });

  it('does nothing without the API and reports a refused request', async () => {
    expect(() => keepScreenAwake({}, fakeDoc(), () => {})()).not.toThrow();
    const reports: unknown[] = [];
    keepScreenAwake(fakeNav(true).nav, fakeDoc(), (e) => reports.push(e));
    await flush();
    expect(reports).toHaveLength(1);
  });
});
