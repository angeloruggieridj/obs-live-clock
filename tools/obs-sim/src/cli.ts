// SPDX-License-Identifier: GPL-2.0-or-later
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
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

export interface CliOptions {
  host: string;
  port: number;
}

const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_PORT = 4455;

function flagValue(argv: string[], flag: string): string | undefined {
  const index = argv.indexOf(flag);
  return index >= 0 ? argv[index + 1] : undefined;
}

/** Parses `--host` (default 127.0.0.1) and `--port` (default 4455). Throws on an unusable port. */
export function parseArgs(argv: string[]): CliOptions {
  const host = flagValue(argv, '--host') ?? DEFAULT_HOST;
  const rawPort = flagValue(argv, '--port');
  if (rawPort === undefined) return { host, port: DEFAULT_PORT };
  const port = Number(rawPort);
  if (!Number.isInteger(port) || port < 0 || port > 65_535) {
    throw new Error(`--port must be an integer between 0 and 65535 (got ${rawPort})`);
  }
  return { host, port };
}

/**
 * Runs the simulator CLI and resolves with the process exit code. A listen failure (e.g. the port is in use)
 * prints one clear line and returns 1 instead of surfacing a raw unhandled rejection.
 */
export async function run(argv: string[]): Promise<number> {
  let options: CliOptions;
  try {
    options = parseArgs(argv);
  } catch (err) {
    console.error(`obs-sim: ${(err as Error).message}`);
    return 1;
  }

  let sim: ObsSim;
  try {
    sim = await startObsSim({
      host: options.host,
      port: options.port,
      scenes: SCENES,
      inputs: ['Deck Media', 'Tappo'],
      program: 'CAM 1',
      deck: { version: '1.4.0', sourceName: 'Deck Media', items: DECK_ITEMS },
    });
  } catch (err) {
    console.error(`obs-sim: cannot listen on ${options.host}:${options.port} (${(err as Error).message})`);
    return 1;
  }

  console.log(`obs-sim listening on ws://${options.host}:${sim.port} (no password)`);
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

  await new Promise<void>((resolve) => {
    let closing = false;
    const shutdown = (): void => {
      if (closing) return;
      closing = true;
      void sim.close().then(() => resolve());
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
    rl.on('close', shutdown);
  });
  return 0;
}

async function main(): Promise<void> {
  process.exit(await run(process.argv.slice(2)));
}

/** `true` when this file is the process entry point (so the test can import `run` without starting a server). */
function invokedDirectly(): boolean {
  const argv1 = process.argv[1];
  if (argv1 === undefined) return false;
  const self = fileURLToPath(import.meta.url);
  return process.platform === 'win32' ? self.toLowerCase() === argv1.toLowerCase() : self === argv1;
}

if (invokedDirectly()) void main();
