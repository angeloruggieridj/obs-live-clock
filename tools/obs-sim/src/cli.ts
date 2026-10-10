// SPDX-License-Identifier: GPL-2.0-or-later
import { createInterface } from 'node:readline';
import { startObsSim, type ObsSim, type ObsSimDeckItem, type ObsSimOutputState, type ObsSimSceneItem } from './index';

/** The Solo Futsal scene set Plan 4 develops against. */
const SCENES: Record<string, ObsSimSceneItem[]> = {
  'CAM 1': [],
  'CAM 2': [],
  'CAM 3': [],
  PLAYOUT: [{ sourceName: 'Deck Media', kind: 'input' }],
  BREAK: [{ sourceName: 'Tappo', kind: 'input' }],
};

const DECK_ITEMS: ObsSimDeckItem[] = [
  { title: 'Servizio 1', path: 'D:/media/servizio1.mp4', durationMs: 185_000 },
  { title: 'Servizio 2', path: 'D:/media/servizio2.mp4', durationMs: 120_000 },
];

const OUTPUT_STATES: readonly ObsSimOutputState[] = ['started', 'stopped', 'paused', 'resumed'];

function asOutput(value: string | undefined): ObsSimOutputState {
  if (value !== undefined && (OUTPUT_STATES as readonly string[]).includes(value)) return value as ObsSimOutputState;
  throw new Error(`state must be one of ${OUTPUT_STATES.join(', ')}`);
}

function asNumber(value: string | undefined, label: string): number {
  const n = Number(value);
  if (value === undefined || value === '' || Number.isNaN(n)) throw new Error(`${label} must be a number`);
  return n;
}

/** One stdin line, e.g. `program PLAYOUT`, `rec started`, `media Tappo playing 1000 5000` or `drop`. */
function runLine(sim: ObsSim, line: string): void {
  const [command, ...args] = line.split(/\s+/);
  switch (command) {
    case '':
      return;
    case 'program':
      if (args[0] === undefined) throw new Error('program <scene>');
      sim.setProgram(args[0]);
      return;
    case 'rec':
      sim.setRecord(asOutput(args[0]));
      return;
    case 'stream':
      sim.setStream(asOutput(args[0]));
      return;
    case 'play':
      sim.deckPlay(asNumber(args[0], 'index'));
      return;
    case 'media':
      if (args[0] === undefined || args[1] === undefined) throw new Error('media <input> <state> <cursor> <duration>');
      sim.setMedia(args[0], {
        state: args[1],
        cursor: asNumber(args[2], 'cursor'),
        duration: asNumber(args[3], 'duration'),
      });
      return;
    case 'drop':
      sim.dropConnections();
      return;
    default:
      throw new Error(`unknown command: ${command}`);
  }
}

async function main(): Promise<void> {
  const sim = await startObsSim({
    port: 4455,
    scenes: SCENES,
    inputs: ['Deck Media', 'Tappo'],
    program: 'CAM 1',
    deck: { version: '1.4.0', sourceName: 'Deck Media', items: DECK_ITEMS },
  });

  console.log(`obs-sim listening on ws://127.0.0.1:${sim.port} (no password)`);
  console.log('program <scene> | rec <state> | stream <state> | play <index> | media <input> <state> <cursor> <duration> | drop');

  const rl = createInterface({ input: process.stdin });
  rl.on('line', (line) => {
    try {
      runLine(sim, line.trim());
      console.log(`ok: ${line.trim()}`);
    } catch (err) {
      console.error(`error: ${(err as Error).message}`);
    }
  });

  const shutdown = (): void => {
    void sim.close().then(() => process.exit(0));
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  rl.on('close', shutdown);
}

void main();
