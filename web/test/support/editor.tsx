// SPDX-License-Identifier: GPL-2.0-or-later
import { act, render, type RenderResult } from '@testing-library/react';
import { Episode, Format, createEpisode, validateRundown } from '@olc/shared';
import { soloFutsalEpisode, soloFutsalFormat } from '@olc/shared/testing';
import userEvent from '@testing-library/user-event';
import type { ReactElement } from 'react';
import type { Lang } from '../../src/core/i18n';
import { ApiError } from '../../src/core/http';
import {
  RundownInvalidError, type DeckResult, type DocKind, type DocRef, type EditorApi, type EditorDoc, type LiveStatus,
  type NewEpisodeBody, type ObsCheckResult,
} from '../../src/editor/api/editor-api';
import { EditorProvider } from '../../src/editor/session/context';
import { EditorSession } from '../../src/editor/session/session';
import { fakeTimers } from './fake-timers';

export const sampleFormat = (): Format => soloFutsalFormat();
export const sampleEpisode = (): Episode => soloFutsalEpisode();

/** In-memory EditorApi that behaves like the server: PUT upserts and parses, live episodes answer 409. */
export class FakeEditorApi implements EditorApi {
  formats = new Map<string, Format>();
  episodes = new Map<string, Episode>();
  live: LiveStatus = { episodeId: null, phase: null };
  scenes: string[] | null = ['CAM 1', 'CAM 2', 'CAM 3', 'BREAK', 'PLAYOUT'];
  deck: DeckResult = { state: 'unavailable', reason: 'obs_not_connected' };
  check: ObsCheckResult = { connected: true, obsWebSocketVersion: '5.5.0', deck: { capability: 'events' }, issues: [] };
  calls: string[] = [];
  private failures = new Map<string, Error[]>();
  private gates = new Map<string, Promise<void>>();

  /** The next call of `method` throws `err`. */
  failNext(method: keyof EditorApi, err: Error): void {
    this.failures.set(method, [...(this.failures.get(method) ?? []), err]);
  }
  /** The next call of `method` waits until the returned function is called. */
  hold(method: keyof EditorApi): () => void {
    let release!: () => void;
    this.gates.set(method, new Promise<void>((r) => (release = r)));
    return release;
  }
  count(method: keyof EditorApi): number {
    return this.calls.filter((c) => c === method).length;
  }
  private async enter(method: keyof EditorApi): Promise<void> {
    this.calls.push(method);
    const gate = this.gates.get(method);
    if (gate !== undefined) {
      this.gates.delete(method);
      await gate;
    }
    const f = this.failures.get(method)?.shift();
    if (f !== undefined) throw f;
  }

  async listFormats() {
    await this.enter('listFormats');
    return structuredClone([...this.formats.values()]);
  }
  async listEpisodes() {
    await this.enter('listEpisodes');
    return structuredClone([...this.episodes.values()]);
  }
  async getDoc(ref: DocRef) {
    await this.enter('getDoc');
    const doc = (ref.kind === 'format' ? this.formats : this.episodes).get(ref.id);
    if (doc === undefined) throw new ApiError(404, 'not_found');
    return structuredClone(doc);
  }
  async createFormat(format: Format) {
    await this.enter('createFormat');
    if (this.formats.has(format.id)) throw new ApiError(409, 'exists');
    this.formats.set(format.id, Format.parse(structuredClone(format)));
    return structuredClone(this.formats.get(format.id)!);
  }
  async putDoc(doc: EditorDoc, kind: DocKind) {
    await this.enter('putDoc');
    if (kind === 'episode' && this.live.episodeId === doc.id && this.live.phase === 'live') throw new ApiError(409, 'episode_live');
    const parsed = kind === 'format' ? Format.parse(structuredClone(doc)) : Episode.parse(structuredClone(doc));
    (kind === 'format' ? this.formats : this.episodes).set(doc.id, parsed as never);
    return structuredClone(parsed);
  }
  async deleteDoc(ref: DocRef) {
    await this.enter('deleteDoc');
    if (ref.kind === 'episode' && this.live.episodeId === ref.id) throw new ApiError(409, 'episode_loaded');
    if (!(ref.kind === 'format' ? this.formats : this.episodes).delete(ref.id)) throw new ApiError(404, 'not_found');
  }
  async createEpisode(formatId: string, body: NewEpisodeBody) {
    await this.enter('createEpisode');
    const format = this.formats.get(formatId);
    if (format === undefined) throw new ApiError(404, 'not_found');
    if (this.episodes.has(body.id)) throw new ApiError(409, 'exists');
    const ep = createEpisode(format, body);
    this.episodes.set(ep.id, ep);
    return structuredClone(ep);
  }
  async liveStatus() {
    await this.enter('liveStatus');
    return { ...this.live };
  }
  async loadLive(episodeId: string) {
    await this.enter('loadLive');
    const ep = this.episodes.get(episodeId);
    if (ep === undefined) throw new ApiError(404, 'not_found');
    const errors = validateRundown(ep).filter((i) => i.severity === 'error');
    if (errors.length > 0) throw new RundownInvalidError(errors);
    this.live = { episodeId, phase: 'preshow' };
  }
  async obsScenes() {
    await this.enter('obsScenes');
    return this.scenes === null ? null : [...this.scenes];
  }
  async deckItems() {
    await this.enter('deckItems');
    return structuredClone(this.deck);
  }
  async checkObs() {
    await this.enter('checkObs');
    return structuredClone(this.check);
  }
}

export interface RenderOptions {
  /** Document to open before rendering. */
  open?: DocRef;
  api?: FakeEditorApi;
  lang?: Lang;
}

/** Renders `ui` inside an EditorProvider whose session uses deterministic timers, after opening `opts.open`. */
export async function renderWithSession(ui: ReactElement, opts: RenderOptions = {}) {
  const api = opts.api ?? new FakeEditorApi();
  if (api.formats.size === 0 && api.episodes.size === 0) {
    api.formats.set('solo-futsal', sampleFormat());
    api.episodes.set('ep-2026-10-12', sampleEpisode());
  }
  const time = fakeTimers();
  const session = new EditorSession(api, time.timers);
  if (opts.open !== undefined) await act(async () => void (await session.open(opts.open!)));
  const utils: RenderResult = render(
    <EditorProvider session={session} lang={opts.lang ?? 'it'}>
      {ui}
    </EditorProvider>,
  );
  return {
    ...utils,
    api,
    session,
    user: userEvent.setup(),
    /** Moves the session's timers forward (autosave debounce, retries). */
    advance: (ms: number) => act(async () => time.advance(ms)),
  };
}
