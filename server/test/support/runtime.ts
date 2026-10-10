// SPDX-License-Identifier: GPL-2.0-or-later
import { join } from 'node:path';
import { FakeTime } from '../../src/clock/clock';
import { LiveJournal } from '../../src/persistence/journal';
import { SnapshotStore } from '../../src/persistence/snapshot-store';
import { LiveRuntime } from '../../src/runtime/live-runtime';

export interface RuntimeHarness {
  dir: string;
  time: FakeTime;
  errors: unknown[];
  runtime: LiveRuntime;
  /** A second runtime on the same data dir and clock: a restart. */
  restart(): LiveRuntime;
}

export function makeRuntime(dir: string, time = new FakeTime()): RuntimeHarness {
  const errors: unknown[] = [];
  const build = () =>
    new LiveRuntime({
      clock: time,
      scheduler: time,
      snapshots: new SnapshotStore(join(dir, 'live', 'snapshot.json')),
      journalFor: (id) => new LiveJournal(join(dir, 'live', `${id}.log.jsonl`)),
      onError: (err) => errors.push(err),
    });
  return { dir, time, errors, runtime: build(), restart: build };
}
