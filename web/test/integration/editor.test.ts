// SPDX-License-Identifier: GPL-2.0-or-later
// @vitest-environment node
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { Episode, Format, parsePlaylistFile, validateRundown } from '@olc/shared';
import { startObsSim } from '@olc/obs-sim';
import { buildServer } from '@olc/server/app/server';
import { ApiError } from '../../src/core/http';
import { httpEditorApi } from '../../src/editor/api/editor-api';
import { importEdit, planPlacement, withOccurrences, type Candidate } from '../../src/editor/import/place';
import { blankFormat } from '../../src/editor/library/blank';
import { uniqueSlug } from '../../src/editor/model/ids';
import { addBlock, moveBlock, patchBreak, patchMedia, renameDoc, resizeBlock } from '../../src/editor/model/ops';
import { EditorSession, browserTimers, stableStringify } from '../../src/editor/session/session';

const SCENES = {
  'CAM 1': [],
  'CAM 2': [],
  'CAM 3': [],
  PLAYOUT: [{ sourceName: 'Deck Media', kind: 'input' as const }],
  BREAK: [{ sourceName: 'Tappo', kind: 'input' as const }],
};
const DECK = {
  version: '1.4.0',
  sourceName: 'Deck Media',
  items: [
    { title: 'Servizio 1', path: 'D:/media/servizio1.mp4', durationMs: 185_000 },
    { title: 'Servizio 2', path: 'D:/media/servizio2.mp4', durationMs: 120_000 },
  ],
};

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()!();
});

const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Bounded polling (25 ms steps) for an async probe. */
async function until<T>(label: string, probe: () => Promise<T | null | undefined | false> | T | null | undefined | false, timeoutMs = 8_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await probe();
    if (value) return value;
    if (Date.now() >= deadline) throw new Error(`Timed out after ${timeoutMs} ms waiting for ${label}`);
    await delay(25);
  }
}

async function boot() {
  const sim = await startObsSim({ port: 0, scenes: SCENES, inputs: ['Deck Media', 'Tappo'], program: 'CAM 1', deck: DECK });
  cleanups.push(() => sim.close());
  const dir = await mkdtemp(join(tmpdir(), 'olc-editor-'));
  cleanups.push(() => rm(dir, { recursive: true, force: true, maxRetries: 5 }));
  const { app } = await buildServer({ dataDir: dir, restrictAcl: async () => {}, obsCredentials: { host: '127.0.0.1', port: sim.port } });
  cleanups.push(() => app.close());
  await app.listen({ port: 0, host: '127.0.0.1' });
  const port = (app.server.address() as AddressInfo).port;

  const net = { down: false, puts: 0 };
  const api = httpEditorApi(async (input, init) => {
    if (net.down) throw new TypeError('fetch failed');
    if (init?.method === 'PUT') net.puts++;
    return fetch(`http://127.0.0.1:${port}${String(input)}`, init);
  });
  const newSession = () => {
    const s = new EditorSession(api, browserTimers, { debounceMs: 30, maxWaitMs: 200, retryBaseMs: 40, retryMaxMs: 80 });
    cleanups.push(() => s.dispose());
    return s;
  };
  const onDisk = async (kind: 'formats' | 'episodes', id: string) => JSON.parse(await readFile(join(dir, kind, `${id}.json`), 'utf8')) as Record<string, any>;
  const settled = (s: EditorSession) => until('autosave clean', () => s.autosave.getState().kind === 'clean');
  const post = (path: string, body: unknown) =>
    fetch(`http://127.0.0.1:${port}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return { api, net, newSession, onDisk, settled, post, dir };
}

const doc = (s: EditorSession) => s.store.getSnapshot().doc!;

describe('the editor against the real server and the OBS simulator', () => {
  it('create a format, edit, undo/redo, autosave, make an episode, import, validate, load for live, get locked', async () => {
    const { api, net, newSession, onDisk, settled, post } = await boot();
    const session = newSession();

    // 1. A new format is persisted with a lowercase slug id.
    const taken = new Set((await api.listFormats()).map((f) => f.id));
    const id = uniqueSlug('Notte Basket', taken);
    expect(id).toBe('notte-basket');
    await api.createFormat(blankFormat('Notte Basket', id));
    expect(await onDisk('formats', id)).toMatchObject({ id: 'notte-basket', name: 'Notte Basket' });

    // 2. A burst of edits is saved by ONE write, and the file equals the screen.
    await session.open({ kind: 'format', id });
    session.apply(renameDoc('Notte Basket 2'));
    session.apply(addBlock('break', 1, 'Pausa'));
    session.apply(addBlock('studio', 2, 'Secondo'));
    for (const ms of [310_000, 320_000, 330_000]) session.apply(resizeBlock('blk-1', ms));
    await settled(session);
    expect(net.puts).toBe(1);
    expect(stableStringify(Format.parse(await onDisk('formats', id)))).toBe(stableStringify(doc(session)));
    expect(doc(session).blocks.map((b) => b.id)).toEqual(['blk-1', 'blk-2', 'blk-3']);

    // 3. Undo reverts the whole resize drag in one step; redo restores it; the file follows each time.
    session.undo();
    await settled(session);
    expect((await onDisk('formats', id)).blocks[0].durationMs).toBe(300_000);
    session.redo();
    await settled(session);
    expect((await onDisk('formats', id)).blocks[0].durationMs).toBe(330_000);
    session.apply(moveBlock(0, 1));
    await settled(session);
    expect((await onDisk('formats', id)).blocks.map((b: { id: string }) => b.id)).toEqual(['blk-2', 'blk-1', 'blk-3']);
    session.undo();
    await settled(session);

    // 4. An episode is an independent copy of the format.
    const epId = uniqueSlug('Notte Basket 2 2026-10-20', new Set((await api.listEpisodes()).map((e) => e.id)));
    const created = await api.createEpisode(id, { id: epId, date: '2026-10-20', plannedStart: '2026-10-20T19:00:00+02:00', playlistName: 'Notte' });
    expect(created.blocks).toEqual((await onDisk('formats', id)).blocks);
    await session.open({ kind: 'episode', id: epId });
    session.apply(resizeBlock('blk-3', 600_000));
    await settled(session);
    expect((await onDisk('episodes', epId)).blocks[2].durationMs).toBe(600_000);
    expect((await onDisk('formats', id)).blocks[2].durationMs).toBe(300_000); // the format did not change

    // 5. Import from the live deck: media with their origin; a second import adds nothing.
    const deck = await until('deck items', async () => {
      const r = await api.deckItems();
      return r.state === 'ok' ? r.items : null;
    });
    const candidates: Candidate[] = deck.map((d) => ({ title: d.title, path: d.path, occurrence: d.occurrence, durationMs: d.durationMs, origin: 'deck' }));
    session.apply(importEdit(planPlacement(doc(session), candidates, { kind: 'append', blockId: 'blk-3' })));
    await settled(session);
    const media = (await onDisk('episodes', epId)).blocks[2].elements.filter((e: { kind: string }) => e.kind === 'media');
    expect(media.map((m: { path: string; durationSource: string }) => [m.path, m.durationSource])).toEqual([
      ['D:/media/servizio1.mp4', 'deck'],
      ['D:/media/servizio2.mp4', 'deck'],
    ]);
    const putsBefore = net.puts;
    const again = planPlacement(doc(session), candidates, { kind: 'append', blockId: 'blk-3' });
    expect(again).toMatchObject({ adds: [], skippedExisting: 2 });
    expect(session.apply(importEdit(again))).toBe(false);
    await delay(150);
    expect(net.puts).toBe(putsBefore);

    // 6. Import from a file with an unknown duration: it stays unknown on disk, never 0:00.
    const parsed = parsePlaylistFile(JSON.stringify({ items: [{ path: 'D:/media/senza-durata.mp4', title: 'Senza durata', duration: -1 }] }), 'p.json');
    if (!parsed.ok) throw new Error('parse failed');
    const fileItems: Candidate[] = withOccurrences(parsed.playlist.items).map((i) => ({ title: i.title, path: i.path, occurrence: i.occurrence, durationMs: i.durationMs, origin: i.durationOrigin }));
    session.apply(importEdit(planPlacement(doc(session), fileItems, { kind: 'append', blockId: 'blk-3' })));
    await settled(session);
    const last = (await onDisk('episodes', epId)).blocks[2].elements.at(-1);
    expect(last).toMatchObject({ title: 'Senza durata', plannedDurationMs: 0, durationSource: 'unknown' });
    expect(validateRundown(doc(session) as Episode).some((i) => i.code === 'media_duration_unknown')).toBe(true);

    // 7. Validation: an error is refused by the server on load; fixing it (undo) lets it through.
    const firstMedia = (doc(session).blocks[2] as { elements: Array<{ id: string; kind: string }> }).elements.find((e) => e.kind === 'media')!;
    session.apply(patchMedia('blk-3', firstMedia.id, { plannedDurationMs: 9_999_000 }));
    expect(validateRundown(doc(session) as Episode).some((i) => i.severity === 'error')).toBe(true);
    const refused = await session.loadForLive(epId);
    expect(refused).toMatchObject({ ok: false, reason: 'invalid' });
    expect(refused.ok === false && refused.issues?.some((i) => i.code === 'media_exceeds_block' && i.blockId === 'blk-3')).toBe(true);
    session.undo();
    expect(await session.loadForLive(epId)).toEqual({ ok: true });
    expect(await api.liveStatus()).toEqual({ episodeId: epId, phase: 'preshow' });

    // 8. Check OBS names a scene OBS does not have, on the right block.
    session.apply(patchBreak('blk-2', { scene: 'NON ESISTE' }));
    await settled(session);
    const check = await until('Check OBS connected', async () => {
      const r = await api.checkObs(epId);
      return r.connected ? r : null;
    });
    expect(check.issues.some((i) => i.code === 'scene_missing' && i.blockId === 'blk-2')).toBe(true);

    // 9. Once the show is on air, the editor locks and the server refuses writes.
    expect((await post('/api/live/command', { name: 'start_program' })).status).toBe(200);
    await session.refreshLive();
    expect(session.getSnapshot().lock).toBe('live');
    expect(session.apply(renameDoc('Troppo tardi'))).toBe(false);
    const err = await api.putDoc(doc(session), 'episode').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 409, code: 'episode_live' });
  }, 60_000);

  it('an outage is shown, never hides the unsaved edit, and the file ends equal to the screen after undo', async () => {
    const { api, net, newSession, onDisk, settled } = await boot();
    await api.createFormat(blankFormat('Serata', 'serata'));
    const session = newSession();
    await session.open({ kind: 'format', id: 'serata' });
    session.apply(renameDoc('A'));
    await settled(session);
    expect((await onDisk('formats', 'serata')).name).toBe('A');

    net.down = true;
    session.apply(renameDoc('B'));
    await until('error state', () => session.autosave.getState().kind === 'error');
    expect(session.autosave.getState().kind).not.toBe('clean');
    expect((await onDisk('formats', 'serata')).name).toBe('A'); // nothing reached the file

    // Review Focus 2: undo while the server is away, then it comes back.
    session.undo();
    expect(doc(session).name).toBe('A');
    net.down = false;
    await settled(session);
    expect((await onDisk('formats', 'serata')).name).toBe('A');
    expect(doc(session).name).toBe('A');
  }, 30_000);

  it('does not switch documents over an unsaved edit', async () => {
    const { api, net, newSession } = await boot();
    await api.createFormat(blankFormat('Uno', 'uno'));
    await api.createFormat(blankFormat('Due', 'due'));
    const session = newSession();
    await session.open({ kind: 'format', id: 'uno' });
    net.down = true;
    session.apply(renameDoc('Uno modificato'));
    expect(await session.open({ kind: 'format', id: 'due' })).toBe(false);
    expect(session.getSnapshot()).toMatchObject({ blocked: true, ref: { kind: 'format', id: 'uno' } });
    expect(doc(session).name).toBe('Uno modificato');
  }, 30_000);

  it('a second session sees the first one\'s save, and a dirty one is asked', async () => {
    const { api, newSession, settled } = await boot();
    await api.createFormat(blankFormat('Condiviso', 'condiviso'));
    const a = newSession();
    const b = newSession();
    await a.open({ kind: 'format', id: 'condiviso' });
    await b.open({ kind: 'format', id: 'condiviso' });

    a.apply(renameDoc('Da A'));
    await settled(a);
    await b.checkExternal();
    expect(doc(b).name).toBe('Da A'); // clean copy: refreshed silently
    expect(b.getSnapshot().refreshed).toBe(1);

    a.apply(renameDoc('Da A bis'));
    await settled(a);
    b.apply(renameDoc('Da B'));
    await b.checkExternal();
    // B has unsaved edits: it must be asked which copy to keep. B's own autosave debounce (30 ms) can fire while
    // the external-change fetch is in flight; checkExternal() then yields to the save-time pre-write check, which
    // raises the same conflict. Wait for the conflict itself instead of racing that network round trip.
    await until('session B is asked about the foreign change', () => b.getSnapshot().conflict?.name === 'Da A bis', 5_000);
    expect(b.getSnapshot().conflict?.name).toBe('Da A bis'); // B has unsaved edits: it must choose
    expect(doc(b).name).toBe('Da B');
  }, 30_000);
});
