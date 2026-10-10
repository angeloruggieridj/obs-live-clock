// SPDX-License-Identifier: GPL-2.0-or-later
import { createHash, randomBytes } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { WebSocketServer, type WebSocket } from 'ws';

/** One item of a simulated scene (or group), mirroring the fields `GetSceneItemList` returns. */
export interface ObsSimSceneItem {
  sourceName: string;
  /** Defaults to `true`: a scene item that is not explicitly disabled is visible on Program. */
  enabled?: boolean;
  kind?: 'input' | 'scene' | 'group';
}

/** One deck playlist entry, as the Playlist Deck vendor reports it (the index is positional). */
export interface ObsSimDeckItem {
  title: string;
  path: string;
  durationMs: number;
}

export interface ObsSimDeck {
  version: string;
  sourceName: string;
  items: ObsSimDeckItem[];
}

export interface ObsSimOptions {
  /** `0` asks the OS for a free port; the bound port is exposed on the returned `ObsSim`. */
  port: number;
  /** Interface to bind. Defaults to `127.0.0.1`: the sim is a dev tool and must not listen on the LAN. */
  host?: string;
  /** When set, the Hello carries an auth challenge and Identify must answer it. */
  password?: string;
  scenes: Record<string, ObsSimSceneItem[]>;
  /** Group source name -> its items, for `GetGroupSceneItemList`. */
  groups?: Record<string, ObsSimSceneItem[]>;
  /** Input names for `GetInputList`. */
  inputs?: string[];
  program: string;
  /** `null` (or omitted) simulates a missing Playlist Deck vendor. */
  deck?: ObsSimDeck | null;
}

export type ObsSimOutputState = 'started' | 'stopped' | 'paused' | 'resumed';

export interface ObsSimMediaState {
  /** Either an `OBS_MEDIA_STATE_*` value or the friendly `playing` / `paused` / `ended` / `stopped`. */
  state: string;
  cursor: number;
  duration: number;
}

/** The obs-websocket v5 state machine and API a dev tool (or a test) drives. */
export interface ObsSim {
  readonly port: number;
  /** Number of client connections accepted so far; lets a test prove the server did not retry. */
  readonly connections: number;
  close(): Promise<void>;
  setProgram(scene: string): void;
  setRecord(state: ObsSimOutputState): void;
  setStream(state: ObsSimOutputState): void;
  setMedia(input: string, state: ObsSimMediaState): void;
  /** Emits the vendor `item-started` event and marks the item as playing. */
  deckPlay(index: number): void;
  /** Emits the vendor `playback-state` event for the current index. */
  deckPlayback(positionMs: number, playing: boolean): void;
  /** Replaces the playlist and emits the vendor `playlist-changed` event. */
  deckSetItems(items: ObsSimDeckItem[]): void;
  /** Terminates every client socket, simulating OBS crashing. */
  dropConnections(): void;
}

const OS_VERSION = '5.5.0';
const RPC_VERSION = 1;
const VENDOR = 'obs-playlist-deck';
const DEFAULT_PLAYLIST = 'Sim Playlist';

const OP_HELLO = 0;
const OP_IDENTIFY = 1;
const OP_IDENTIFIED = 2;
const OP_EVENT = 5;
const OP_REQUEST = 6;
const OP_REQUEST_RESPONSE = 7;

const CODE_SUCCESS = 100;
const CODE_UNKNOWN_REQUEST = 204;
const CODE_RESOURCE_NOT_FOUND = 600;

const OUTPUT_STATE: Record<ObsSimOutputState, string> = {
  started: 'OBS_WEBSOCKET_OUTPUT_STARTED',
  stopped: 'OBS_WEBSOCKET_OUTPUT_STOPPED',
  paused: 'OBS_WEBSOCKET_OUTPUT_PAUSED',
  resumed: 'OBS_WEBSOCKET_OUTPUT_RESUMED',
};

const MEDIA_STATE_ALIAS: Record<string, string> = {
  playing: 'OBS_MEDIA_STATE_PLAYING',
  paused: 'OBS_MEDIA_STATE_PAUSED',
  ended: 'OBS_MEDIA_STATE_ENDED',
  stopped: 'OBS_MEDIA_STATE_STOPPED',
};

interface OutputState {
  active: boolean;
  paused: boolean;
}

interface DeckState {
  version: string;
  sourceName: string;
  playlistName: string;
  items: Array<{ title: string; path: string; durationMs: number }>;
  currentIndex: number;
  positionMs: number;
  durationMs: number;
  playing: boolean;
}

interface RequestResult {
  result: boolean;
  code: number;
  comment?: string;
  responseData?: unknown;
}

interface ObsMessage {
  op: number;
  d?: unknown;
}

function sha256Base64(input: string): string {
  return createHash('sha256').update(input).digest('base64');
}

/** The obs-websocket v5 auth string: base64(sha256(base64(sha256(password + salt)) + challenge)). */
export function authenticationString(password: string, salt: string, challenge: string): string {
  return sha256Base64(sha256Base64(password + salt) + challenge);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function str(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * Starts an obs-websocket v5 JSON simulator on `opts.port` (0 = random) and resolves once it is listening.
 * The simulator never logs, and never inspects the password beyond the auth hash: it is a dev tool.
 */
export async function startObsSim(opts: ObsSimOptions): Promise<ObsSim> {
  const host = opts.host ?? '127.0.0.1';
  const scenes = opts.scenes;
  const groups = opts.groups ?? {};
  const inputNames = opts.inputs ?? [];
  const password = opts.password !== undefined && opts.password !== '' ? opts.password : null;

  const state = {
    program: opts.program,
    record: { active: false, paused: false } as OutputState,
    stream: { active: false, paused: false } as OutputState,
    media: new Map<string, { state: string; cursor: number; duration: number }>(),
    deck: (opts.deck ?? null) === null ? null : toDeckState(opts.deck!),
  };

  let connections = 0;
  const sockets = new Set<WebSocket>();
  const challenges = new Map<WebSocket, { challenge: string; salt: string }>();
  const identified = new Set<WebSocket>();

  const send = (socket: WebSocket, op: number, d: unknown): void => {
    if (socket.readyState === socket.OPEN) socket.send(JSON.stringify({ op, d }));
  };

  // Events only ever reach identified sockets: an unidentified client must see nothing.
  const broadcast = (eventType: string, eventData: unknown): void => {
    for (const socket of identified) send(socket, OP_EVENT, { eventType, eventIntent: 1, eventData });
  };

  const wss = new WebSocketServer({
    host,
    port: opts.port,
    handleProtocols: (protocols) => (protocols.has('obswebsocket.json') ? 'obswebsocket.json' : false),
  });

  wss.on('connection', (socket) => {
    connections += 1;
    sockets.add(socket);
    socket.on('close', () => {
      sockets.delete(socket);
      challenges.delete(socket);
      identified.delete(socket);
    });
    socket.on('error', () => {
      /* A client that vanished mid-frame must not crash the simulator. */
    });
    socket.on('message', (raw) => {
      try {
        onMessage(socket, JSON.parse(raw.toString()));
      } catch {
        /* Ignore malformed frames: a faithful server would close, but a dev tool stays up. */
      }
    });

    const hello: Record<string, unknown> = { obsWebSocketVersion: OS_VERSION, rpcVersion: RPC_VERSION };
    if (password !== null) {
      const challenge = randomBytes(16).toString('base64');
      const salt = randomBytes(16).toString('base64');
      challenges.set(socket, { challenge, salt });
      hello.authentication = { challenge, salt };
    }
    send(socket, OP_HELLO, hello);
  });

  function onMessage(socket: WebSocket, message: unknown): void {
    if (!isRecord(message)) return;
    const op = num(message.op);
    const d = isRecord(message.d) ? message.d : {};
    if (op === OP_IDENTIFY) {
      // A second Identify on an already-identified socket is a protocol error.
      if (identified.has(socket)) {
        socket.close(4008, 'AlreadyIdentified');
        return;
      }
      return onIdentify(socket, d);
    }
    // Anything but Identify before identification is refused, exactly like real OBS.
    if (!identified.has(socket)) {
      socket.close(4007, 'NotIdentified');
      return;
    }
    if (op === OP_REQUEST) return onRequest(socket, d);
  }

  function onIdentify(socket: WebSocket, d: Record<string, unknown>): void {
    if (password !== null) {
      const pending = challenges.get(socket);
      const provided = str(d.authentication);
      const expected = pending === undefined ? null : authenticationString(password, pending.salt, pending.challenge);
      if (provided === null || expected === null || provided !== expected) {
        socket.close(4009, 'Authentication failed.');
        return;
      }
    }
    identified.add(socket);
    send(socket, OP_IDENTIFIED, { negotiatedRpcVersion: RPC_VERSION });
  }

  function onRequest(socket: WebSocket, d: Record<string, unknown>): void {
    const requestType = str(d.requestType) ?? '';
    const requestId = d.requestId;
    const requestData = isRecord(d.requestData) ? d.requestData : {};
    const result = handleRequest(requestType, requestData);
    const requestStatus: Record<string, unknown> = { result: result.result, code: result.code };
    if (result.comment !== undefined) requestStatus.comment = result.comment;
    const response: Record<string, unknown> = { requestType, requestId, requestStatus };
    if (result.responseData !== undefined) response.responseData = result.responseData;
    send(socket, OP_REQUEST_RESPONSE, response);
  }

  function handleRequest(requestType: string, data: Record<string, unknown>): RequestResult {
    switch (requestType) {
      case 'GetVersion':
        return ok({ obsVersion: '31.0.0', obsWebSocketVersion: OS_VERSION });
      case 'GetSceneList':
        return ok({
          currentProgramSceneName: state.program,
          currentPreviewSceneName: state.program,
          scenes: Object.keys(scenes).map((sceneName, sceneIndex) => ({ sceneName, sceneIndex })),
        });
      case 'GetCurrentProgramScene':
        return ok({ sceneName: state.program, currentProgramSceneName: state.program });
      case 'GetSceneItemList': {
        const scene = str(data.sceneName) ?? '';
        if (!Object.prototype.hasOwnProperty.call(scenes, scene)) {
          return fail(CODE_RESOURCE_NOT_FOUND, `No scene: ${scene}`);
        }
        return ok({ sceneItems: sceneItems(scenes[scene]) });
      }
      case 'GetGroupSceneItemList': {
        const group = str(data.sceneName) ?? '';
        if (!Object.prototype.hasOwnProperty.call(groups, group)) {
          return fail(CODE_RESOURCE_NOT_FOUND, `No group: ${group}`);
        }
        return ok({ sceneItems: sceneItems(groups[group]) });
      }
      case 'GetRecordStatus':
        return ok({ outputActive: state.record.active, outputPaused: state.record.paused });
      case 'GetStreamStatus':
        return ok({ outputActive: state.stream.active, outputPaused: state.stream.paused });
      case 'GetInputList':
        return ok({ inputs: inputNames.map((inputName, index) => ({ inputName, inputUuid: `sim-input-${index}` })) });
      case 'GetMediaInputStatus': {
        const input = str(data.inputName) ?? '';
        if (!inputNames.includes(input)) {
          return fail(CODE_RESOURCE_NOT_FOUND, `No input: ${input}`);
        }
        const media = state.media.get(input);
        return ok({
          mediaState: media?.state ?? 'OBS_MEDIA_STATE_NONE',
          mediaCursor: media?.cursor ?? 0,
          mediaDuration: media?.duration ?? 0,
        });
      }
      case 'CallVendorRequest':
        return vendorRequest(data);
      default:
        return fail(CODE_UNKNOWN_REQUEST, `Unknown request: ${requestType}`);
    }
  }

  function vendorRequest(data: Record<string, unknown>): RequestResult {
    const vendorName = str(data.vendorName) ?? '';
    const requestType = str(data.requestType) ?? '';
    const deck = state.deck;
    if (deck === null || vendorName !== VENDOR) {
      return fail(CODE_RESOURCE_NOT_FOUND, `No vendor: ${vendorName}`);
    }
    let payload: Record<string, unknown> | null = null;
    if (requestType === 'GetStatus') {
      payload = {
        ok: true,
        pluginVersion: deck.version,
        sourceName: deck.sourceName,
        playlistName: deck.playlistName,
        currentIndex: deck.currentIndex,
        positionMs: deck.positionMs,
        durationMs: deck.durationMs,
        playing: deck.playing,
        count: deck.items.length,
      };
    } else if (requestType === 'GetItems') {
      const from = Math.max(0, num(data.from) ?? 0);
      const to = num(data.to) ?? deck.items.length - 1;
      payload = {
        ok: true,
        count: deck.items.length,
        items: deck.items
          .map((item, index) => ({ index, title: item.title, path: item.path, durationMs: item.durationMs }))
          .slice(from, to + 1),
      };
    }
    if (payload === null) return fail(CODE_UNKNOWN_REQUEST, `Unknown vendor request: ${requestType}`);
    return ok({ vendorName, requestType, responseData: payload });
  }

  await new Promise<void>((resolve, reject) => {
    wss.once('listening', () => resolve());
    wss.once('error', reject);
  });
  const { port } = wss.address() as AddressInfo;

  return {
    get connections() {
      return connections;
    },
    port,
    close: () =>
      new Promise<void>((resolve) => {
        for (const socket of sockets) socket.terminate();
        sockets.clear();
        identified.clear();
        challenges.clear();
        wss.close(() => resolve());
      }),
    setProgram(scene) {
      state.program = scene;
      broadcast('CurrentProgramSceneChanged', { sceneName: scene });
    },
    setRecord(outputState) {
      state.record = outputFor(outputState);
      broadcast('RecordStateChanged', { outputState: OUTPUT_STATE[outputState], outputActive: state.record.active, outputPaused: state.record.paused });
    },
    setStream(outputState) {
      state.stream = outputFor(outputState);
      broadcast('StreamStateChanged', { outputState: OUTPUT_STATE[outputState], outputActive: state.stream.active, outputPaused: state.stream.paused });
    },
    setMedia(input, media) {
      const previous = state.media.get(input);
      const normalized = MEDIA_STATE_ALIAS[media.state] ?? media.state;
      state.media.set(input, { state: normalized, cursor: media.cursor, duration: media.duration });
      if (normalized === 'OBS_MEDIA_STATE_PLAYING' && previous?.state !== 'OBS_MEDIA_STATE_PLAYING') {
        broadcast('MediaInputPlaybackStarted', { inputName: input });
      } else if (previous !== undefined && previous.state !== normalized && normalized !== 'OBS_MEDIA_STATE_PLAYING') {
        broadcast('MediaInputPlaybackEnded', { inputName: input });
      }
    },
    deckPlay(index) {
      const deck = state.deck;
      if (deck === null) return;
      const item = deck.items[index];
      if (item === undefined) return;
      const durationMs = item.durationMs >= 0 ? item.durationMs : -1;
      deck.currentIndex = index;
      deck.positionMs = 0;
      deck.durationMs = durationMs;
      deck.playing = true;
      broadcast('VendorEvent', {
        vendorName: VENDOR,
        eventType: 'item-started',
        eventData: { index, title: item.title, path: item.path, durationMs },
      });
    },
    deckPlayback(positionMs, playing) {
      const deck = state.deck;
      if (deck === null) return;
      deck.positionMs = positionMs;
      deck.playing = playing;
      broadcast('VendorEvent', {
        vendorName: VENDOR,
        eventType: 'playback-state',
        eventData: { index: deck.currentIndex, positionMs, durationMs: deck.durationMs, playing },
      });
    },
    deckSetItems(items) {
      const deck = state.deck;
      if (deck === null) return;
      deck.items = items.map((item) => ({ title: item.title, path: item.path, durationMs: item.durationMs }));
      if (deck.currentIndex >= deck.items.length) {
        deck.currentIndex = -1;
        deck.positionMs = -1;
        deck.durationMs = -1;
        deck.playing = false;
      }
      broadcast('VendorEvent', {
        vendorName: VENDOR,
        eventType: 'playlist-changed',
        eventData: { reason: 'replaced', playlistName: deck.playlistName, count: deck.items.length },
      });
    },
    dropConnections() {
      for (const socket of sockets) socket.terminate();
    },
  };
}

function ok(responseData: unknown): RequestResult {
  return { result: true, code: CODE_SUCCESS, responseData };
}

function fail(code: number, comment: string): RequestResult {
  return { result: false, code, comment };
}

function toDeckState(deck: ObsSimDeck): DeckState {
  return {
    version: deck.version,
    sourceName: deck.sourceName,
    playlistName: DEFAULT_PLAYLIST,
    items: deck.items.map((item) => ({ title: item.title, path: item.path, durationMs: item.durationMs })),
    currentIndex: -1,
    positionMs: -1,
    durationMs: -1,
    playing: false,
  };
}

function outputFor(state: ObsSimOutputState): OutputState {
  return { active: state !== 'stopped', paused: state === 'paused' };
}

function sceneItems(items: ObsSimSceneItem[]): Array<Record<string, unknown>> {
  return items.map((item, index) => {
    const isGroup = item.kind === 'group';
    const sourceType = item.kind === 'scene' ? 'OBS_SOURCE_TYPE_SCENE' : 'OBS_SOURCE_TYPE_INPUT';
    return {
      sceneItemId: index + 1,
      sourceName: item.sourceName,
      sceneItemEnabled: item.enabled !== false,
      isGroup,
      sourceType,
    };
  });
}
