// SPDX-License-Identifier: GPL-2.0-or-later
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { SOLO_FUTSAL_DECK, soloFutsalEpisode } from '@olc/shared/testing';
import { FakeTime, systemClock, systemScheduler } from '../../src/clock/clock';
import { LiveJournal } from '../../src/persistence/journal';
import { SnapshotStore, type LiveSnapshot } from '../../src/persistence/snapshot-store';
import { commandToInput } from '../../src/runtime/commands';
import { LiveRunningError, LiveRuntime, NoEpisodeError } from '../../src/runtime/live-runtime';
import { makeRuntime } from '../support/runtime';
import { tempDir } from '../support/tmp';

async function liveHarness() {
  const h = makeRuntime(await tempDir());
  await h.runtime.load(soloFutsalEpisode());
  h.runtime.dispatch({ type: 'SourceRestored' });
  h.runtime.dispatch({ type: 'DeckPlaylistChanged', items: SOLO_FUTSAL_DECK.map((i) => ({ ...i })) });
  h.runtime.dispatch({ type: 'ProgramSceneChanged', scene: 'CAM 1', deckOnProgram: false });
  h.runtime.dispatch({ type: 'OutputChanged', output: 'rec', state: 'started' });
  await h.runtime.flush();
  return h;
}

describe('commandToInput', () => {
  it('maps every client command to an engine command', () => {
    expect(commandToInput({ name: 'goto', slot: 4 })).toEqual({ type: 'Goto', slot: 4 });
    expect(commandToInput({ name: 'adjust', deltaMs: 30_000 })).toEqual({ type: 'Adjust', deltaMs: 30_000 });
    expect(commandToInput({ name: 'set_control', control: 'manual' })).toEqual({ type: 'SetControl', control: 'manual' });
    expect(commandToInput({ name: 'resolve_decision', id: 2, choice: 'end' })).toEqual({ type: 'ResolveDecision', id: 2, choice: 'end' });
    expect(commandToInput({ name: 'start_program' })).toEqual({ type: 'StartProgram' });
    expect(commandToInput({ name: 'end_program' })).toEqual({ type: 'EndProgram' });
  });
});

describe('LiveRuntime', () => {
  it('loads an episode in preshow and saves a snapshot', async () => {
    const h = makeRuntime(await tempDir());
    let notified = 0;
    h.runtime.subscribe(() => notified++);
    await h.runtime.load(soloFutsalEpisode());
    expect(h.runtime.episodeId).toBe('ep-2026-10-12');
    expect(h.runtime.phase).toBe('preshow');
    expect(h.runtime.presenterView()?.phase).toBe('preshow');
    expect(notified).toBe(1);
    const snap = JSON.parse(await readFile(join(h.dir, 'live', 'snapshot.json'), 'utf8'));
    expect(snap).toMatchObject({ schemaVersion: 1, episodeId: 'ep-2026-10-12' });
  });

  it('stamps inputs with the clock, journals them and keeps the snapshot current', async () => {
    const h = await liveHarness();
    expect(h.runtime.phase).toBe('live');
    expect(h.runtime.getState()?.t0).toBe(h.time.now());
    const entries = await new LiveJournal(join(h.dir, 'live', 'ep-2026-10-12.log.jsonl')).readAll();
    expect(entries.map((e) => e.input.type)).toEqual(['SourceRestored', 'DeckPlaylistChanged', 'ProgramSceneChanged', 'OutputChanged']);
    expect(entries[3]!.input.at).toBe(h.time.now());
    const snap = JSON.parse(await readFile(join(h.dir, 'live', 'snapshot.json'), 'utf8'));
    expect(snap.state.phase).toBe('live');
  });

  it('coalesces queued snapshot saves but journals every input, and flush writes the latest state', async () => {
    const dir = await tempDir();
    const time = new FakeTime();
    const snapshots = new SnapshotStore(join(dir, 'live', 'snapshot.json'));
    const save = vi.spyOn(snapshots, 'save');
    const runtime = new LiveRuntime({
      clock: time,
      scheduler: time,
      snapshots,
      journalFor: (id) => new LiveJournal(join(dir, 'live', `${id}.log.jsonl`)),
    });

    await runtime.load(soloFutsalEpisode());
    let changed = 0;
    for (let i = 0; i < 50; i++) {
      const scene = `CAM ${(i % 3) + 1}`;
      if (runtime.dispatch({ type: 'ProgramSceneChanged', scene, deckOnProgram: false })) changed++;
    }
    await runtime.flush();

    expect(changed).toBe(50);
    expect(save.mock.calls.length).toBeLessThanOrEqual(2);
    const snap = JSON.parse(await readFile(join(dir, 'live', 'snapshot.json'), 'utf8'));
    expect(snap.state).toEqual(runtime.getState());
    const entries = await new LiveJournal(join(dir, 'live', 'ep-2026-10-12.log.jsonl')).readAll();
    expect(entries).toHaveLength(50);
    runtime.dispose();
  });

  it('writes the snapshot only after the journal appends it reflects', async () => {
    const dir = await tempDir();
    const time = new FakeTime();
    const journalPath = join(dir, 'live', 'ep-2026-10-12.log.jsonl');

    /** A save hook that records how many journal entries are on disk when the snapshot is written. */
    class RecordingSnapshotStore extends SnapshotStore {
      readonly entriesAtSave: number[] = [];
      override async save(snap: LiveSnapshot): Promise<void> {
        this.entriesAtSave.push((await new LiveJournal(journalPath).readAll()).length);
        await super.save(snap);
      }
    }
    const snapshots = new RecordingSnapshotStore(join(dir, 'live', 'snapshot.json'));
    const runtime = new LiveRuntime({
      clock: time,
      scheduler: time,
      snapshots,
      journalFor: () => new LiveJournal(journalPath),
    });

    await runtime.load(soloFutsalEpisode());
    snapshots.entriesAtSave.length = 0;

    const n = 50;
    for (let i = 0; i < n; i++) {
      runtime.dispatch({ type: 'ProgramSceneChanged', scene: `CAM ${(i % 3) + 1}`, deckOnProgram: false });
    }
    await runtime.flush();

    expect(snapshots.entriesAtSave.length).toBeGreaterThan(0);
    expect(snapshots.entriesAtSave[0]).toBe(n);
    const snap = JSON.parse(await readFile(join(dir, 'live', 'snapshot.json'), 'utf8'));
    expect(snap.state).toEqual(runtime.getState());
    runtime.dispose();
  });

  it('a load after an unflushed unload queues its save after the clear', async () => {
    const dir = await tempDir();
    const time = new FakeTime();
    const journalFor = (id: string) => new LiveJournal(join(dir, 'live', `${id}.log.jsonl`));
    const snapshots = new SnapshotStore(join(dir, 'live', 'snapshot.json'));
    const runtime = new LiveRuntime({ clock: time, scheduler: time, snapshots, journalFor });

    await runtime.load(soloFutsalEpisode());
    // Queue changes but do not flush, so the coalesced snapshot save is not yet written.
    for (let i = 0; i < 5; i++) {
      runtime.dispatch({ type: 'ProgramSceneChanged', scene: `CAM ${i + 1}`, deckOnProgram: false });
    }

    const unloading = runtime.unload();
    const loading = runtime.load(soloFutsalEpisode());
    await Promise.all([unloading, loading]);
    await runtime.flush();

    const snap = JSON.parse(await readFile(join(dir, 'live', 'snapshot.json'), 'utf8'));
    expect(snap.episodeId).toBe('ep-2026-10-12');
    expect(snap.state).toEqual(runtime.getState());
    runtime.dispose();
  });

  it('returns false and neither journals nor notifies when nothing changed', async () => {
    const h = await liveHarness();
    let notified = 0;
    h.runtime.subscribe(() => notified++);
    expect(h.runtime.dispatch({ type: 'SourceRestored' })).toBe(false);
    await h.runtime.flush();
    expect(notified).toBe(0);
    const entries = await new LiveJournal(join(h.dir, 'live', 'ep-2026-10-12.log.jsonl')).readAll();
    expect(entries).toHaveLength(4);
  });

  it('refuses to load or unload while live', async () => {
    const h = await liveHarness();
    await expect(h.runtime.load(soloFutsalEpisode())).rejects.toBeInstanceOf(LiveRunningError);
    await expect(h.runtime.unload()).rejects.toBeInstanceOf(LiveRunningError);
    expect(h.runtime.isLive('ep-2026-10-12')).toBe(true);
  });

  it('fires scheduled ticks: a timeout message clears itself', async () => {
    const h = await liveHarness();
    h.runtime.command({ name: 'send_message', text: 'STRINGI', dismiss: { kind: 'timeout', ms: 10_000 } });
    expect(h.runtime.presenterView()?.message).toEqual({ text: 'STRINGI' });
    h.time.advance(9_999);
    expect(h.runtime.presenterView()?.message).toEqual({ text: 'STRINGI' });
    h.time.advance(1);
    expect(h.runtime.presenterView()?.message).toBeNull();
  });

  it('keeps counting on the plan when OBS is lost (estimated hand-over by tick)', async () => {
    const h = await liveHarness();
    h.runtime.dispatch({ type: 'SourceLost' });
    h.time.advance(720_000);
    expect(h.runtime.getState()?.cursor).toBe(3);
    expect(h.runtime.presenterView()?.segment).toBe('break');
  });

  it('command throws when no episode is loaded', async () => {
    const h = makeRuntime(await tempDir());
    expect(() => h.runtime.command({ name: 'next' })).toThrow(NoEpisodeError);
    expect(h.runtime.dispatch({ type: 'Tick' })).toBe(false);
  });

  it('resume: a restart mid-show continues live with OBS lost', async () => {
    const h = await liveHarness();
    h.time.advance(60_000);
    const restarted = h.restart();
    expect(await restarted.resume()).toBe(true);
    expect(restarted.phase).toBe('live');
    expect(restarted.getState()?.obs).toBe('lost');
    const block = restarted.presenterView()?.block;
    expect(block?.index).toBe(0);
    expect(block?.anchor).toMatchObject({ kind: 'countdown', source: 'estimated' });
  });

  it('toWall is integer and stable while the state is unchanged', async () => {
    const dir = await tempDir();
    const runtime = new LiveRuntime({
      clock: systemClock,
      scheduler: systemScheduler(systemClock),
      snapshots: new SnapshotStore(join(dir, 'live', 'snapshot.json')),
      journalFor: (id) => new LiveJournal(join(dir, 'live', `${id}.log.jsonl`)),
    });
    await runtime.load(soloFutsalEpisode());
    runtime.dispatch({ type: 'SourceRestored' });
    runtime.dispatch({ type: 'DeckPlaylistChanged', items: SOLO_FUTSAL_DECK.map((i) => ({ ...i })) });
    runtime.dispatch({ type: 'ProgramSceneChanged', scene: 'CAM 1', deckOnProgram: false });
    runtime.dispatch({ type: 'OutputChanged', output: 'rec', state: 'started' });

    const samples: string[] = [];
    for (let i = 0; i < 5; i++) {
      samples.push(JSON.stringify(runtime.presenterView()));
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    expect(new Set(samples).size).toBe(1);

    const view = runtime.presenterView()!;
    for (const anchor of [view.block?.anchor, view.onAir?.anchor, view.programEnd?.anchor]) {
      if (anchor?.kind === 'countdown') expect(Number.isInteger(anchor.endsAt)).toBe(true);
    }
    runtime.dispose();
  });

  it('resume skips a snapshot whose show has already ended', async () => {
    const h = await liveHarness();
    h.runtime.command({ name: 'end_program' });
    await h.runtime.flush();
    expect(h.runtime.phase).toBe('ended');
    const restarted = h.restart();
    expect(await restarted.resume()).toBe(false);
    expect(restarted.episodeId).toBeNull();
  });

  it('unload clears the snapshot, so a restart resumes nothing', async () => {
    const h = makeRuntime(await tempDir());
    await h.runtime.load(soloFutsalEpisode());
    await h.runtime.unload();
    expect(h.runtime.episodeId).toBeNull();
    expect(await h.restart().resume()).toBe(false);
  });

  it('corrupt snapshot does not block start: resume returns false and reports', async () => {
    const h = makeRuntime(await tempDir());
    await h.runtime.load(soloFutsalEpisode());
    await writeFile(join(h.dir, 'live', 'snapshot.json'), '{ broken');
    const restarted = h.restart();
    expect(await restarted.resume()).toBe(false);
    expect(h.errors).toHaveLength(1);
  });

  it('dispose cancels the pending tick', async () => {
    const h = await liveHarness();
    h.runtime.dispatch({ type: 'SourceLost' });
    expect(h.time.pending).toBe(1);
    h.runtime.dispose();
    expect(h.time.pending).toBe(0);
  });

  it('resume: a broken snapshot does not block start', async () => {
    const h = makeRuntime(await tempDir());
    await mkdir(join(h.dir, 'live'), { recursive: true });
    await writeFile(
      join(h.dir, 'live', 'snapshot.json'),
      '{"schemaVersion":1,"episodeId":"ep-x","wallAt":0,"state":{"phase":"live"}}',
    );
    const restarted = h.restart();
    expect(await restarted.resume()).toBe(false);
    expect(h.errors).toHaveLength(1);
    expect(restarted.episodeId).toBeNull();
    expect(restarted.presenterView()).toBeNull();
    await restarted.load(soloFutsalEpisode());
    expect(restarted.episodeId).toBe('ep-2026-10-12');
  });

  it('resume: a valid live snapshot notifies subscribers exactly once', async () => {
    const h = await liveHarness();
    const restarted = h.restart();
    let notified = 0;
    restarted.subscribe(() => notified++);
    expect(await restarted.resume()).toBe(true);
    expect(notified).toBe(1);
  });

  it('a failing journal append still keeps the snapshot current', async () => {
    const dir = await tempDir();
    const time = new FakeTime();
    const errors: unknown[] = [];
    const journalPath = join(dir, 'live', 'ep-2026-10-12.log.jsonl');
    await mkdir(journalPath, { recursive: true });
    const runtime = new LiveRuntime({
      clock: time,
      scheduler: time,
      snapshots: new SnapshotStore(join(dir, 'live', 'snapshot.json')),
      journalFor: () => new LiveJournal(journalPath),
      onError: (err) => errors.push(err),
    });
    await runtime.load(soloFutsalEpisode());
    runtime.dispatch({ type: 'SourceRestored' });
    runtime.dispatch({ type: 'DeckPlaylistChanged', items: SOLO_FUTSAL_DECK.map((i) => ({ ...i })) });
    runtime.dispatch({ type: 'ProgramSceneChanged', scene: 'CAM 1', deckOnProgram: false });
    runtime.dispatch({ type: 'OutputChanged', output: 'rec', state: 'started' });
    await runtime.flush();
    const snap = JSON.parse(await readFile(join(dir, 'live', 'snapshot.json'), 'utf8'));
    expect(snap.state.phase).toBe('live');
    expect(errors.length).toBeGreaterThanOrEqual(1);
  });

  it('a throwing subscriber does not escape dispatch or a tick', async () => {
    const h = await liveHarness();
    let counted = 0;
    h.runtime.subscribe(() => {
      throw new Error('subscriber boom');
    });
    h.runtime.subscribe(() => counted++);

    expect(h.runtime.dispatch({ type: 'SourceLost' })).toBe(true);
    expect(counted).toBe(1);
    expect(h.errors.length).toBeGreaterThanOrEqual(1);

    const before = counted;
    h.runtime.command({ name: 'send_message', text: 'STRINGI', dismiss: { kind: 'timeout', ms: 10_000 } });
    expect(h.runtime.presenterView()?.message).toEqual({ text: 'STRINGI' });
    h.time.advance(10_000);
    expect(h.runtime.presenterView()?.message).toBeNull();
    expect(counted).toBeGreaterThan(before);
  });

  it('a throw in the tick path is contained, reported and leaves the state unchanged', async () => {
    const h = await liveHarness();
    h.runtime.dispatch({ type: 'SourceLost' });
    const before = h.runtime.getState();
    const original = h.runtime.dispatch.bind(h.runtime);
    h.runtime.dispatch = (input) => {
      if (input.type === 'Tick') throw new Error('tick boom');
      return original(input);
    };
    expect(() => h.time.advance(720_000)).not.toThrow();
    expect(h.runtime.getState()).toBe(before);
    expect(h.errors.length).toBeGreaterThanOrEqual(1);
  });

  it('dispose marks the runtime disposed', async () => {
    const h = await liveHarness();
    h.runtime.dispose();
    expect(h.runtime.dispatch({ type: 'SourceLost' })).toBe(false);
    expect(h.time.pending).toBe(0);

    const fresh = makeRuntime(await tempDir());
    fresh.runtime.dispose();
    await expect(fresh.runtime.load(soloFutsalEpisode())).rejects.toThrow('Runtime disposed');
    await expect(fresh.runtime.resume()).rejects.toThrow('Runtime disposed');
  });

  it('resume returns false and touches nothing when an episode is already loaded', async () => {
    const h = await liveHarness();
    const before = h.runtime.getState();
    expect(await h.runtime.resume()).toBe(false);
    expect(h.runtime.getState()).toBe(before);
    expect(h.runtime.episodeId).toBe('ep-2026-10-12');
    expect(h.errors).toHaveLength(0);
  });

  it('resume: a shape-valid but unusable snapshot cannot brick the runtime', async () => {
    const h = makeRuntime(await tempDir());
    await mkdir(join(h.dir, 'live'), { recursive: true });
    await writeFile(
      join(h.dir, 'live', 'snapshot.json'),
      JSON.stringify({
        schemaVersion: 1,
        episodeId: 'x',
        wallAt: 0,
        state: { phase: 'live', obs: 'lost', message: null, blockRt: [], episode: { id: 'x', blocks: [] } },
      }),
    );
    const restarted = h.restart();
    expect(await restarted.resume()).toBe(false);
    expect(h.errors).toHaveLength(1);
    expect(restarted.episodeId).toBeNull();
    expect(restarted.presenterView()).toBeNull();
    await restarted.load(soloFutsalEpisode());
    expect(restarted.episodeId).toBe('ep-2026-10-12');
  });

  it('resume: a snapshot whose episodeId does not match the state is rejected', async () => {
    const h = makeRuntime(await tempDir());
    await h.runtime.load(soloFutsalEpisode());
    const path = join(h.dir, 'live', 'snapshot.json');
    const snap = JSON.parse(await readFile(path, 'utf8'));
    snap.episodeId = 'other';
    await writeFile(path, JSON.stringify(snap));
    const restarted = h.restart();
    expect(await restarted.resume()).toBe(false);
    expect(h.errors).toHaveLength(1);
  });

  it('resume: a load that lands during the snapshot read wins the race', async () => {
    const h = await liveHarness();
    const restarted = h.restart();
    const resumed = restarted.resume();
    await restarted.load(soloFutsalEpisode());
    expect(await resumed).toBe(false);
    expect(restarted.phase).toBe('preshow');
  });
});
