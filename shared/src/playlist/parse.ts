// SPDX-License-Identifier: GPL-2.0-or-later

export type DurationOrigin = 'file' | 'file_rounded' | 'unknown';
export type PlaylistFormat = 'json' | 'csv' | 'm3u';

export interface ImportedItem {
  title: string;
  path: string;
  /** Milliseconds; -1 when the file does not say. */
  durationMs: number;
  durationOrigin: DurationOrigin;
  /** Not an absolute path or URL. Playlist Deck matches absolute paths, so such an item may not match. */
  pathIsRelative: boolean;
}

export interface ParsedPlaylist {
  format: PlaylistFormat;
  name: string | null;
  items: ImportedItem[];
  /** Entries dropped because they had no usable path. */
  skipped: number;
}

export type ParseResult =
  | { ok: true; playlist: ParsedPlaylist }
  | { ok: false; reason: 'empty' | 'unrecognised' | 'no_items' };

export function fileStem(path: string): string {
  const last = path.split(/[\\/]/).pop() ?? path;
  const dot = last.lastIndexOf('.');
  return dot > 0 ? last.slice(0, dot) : last;
}

export function isAbsolutePath(p: string): boolean {
  return /^[a-zA-Z]:[\\/]/.test(p) || p.startsWith('/') || p.startsWith('\\\\') || /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(p);
}

function makeItem(title: string, path: string, durationMs: number, durationOrigin: DurationOrigin): ImportedItem {
  const t = title.trim();
  return {
    title: t === '' ? fileStem(path) : t,
    path,
    durationMs,
    durationOrigin: durationMs < 0 ? 'unknown' : durationOrigin,
    pathIsRelative: !isAbsolutePath(path),
  };
}

function msFrom(value: unknown): number {
  const n = typeof value === 'string' && /^\s*-?\d+(\.\d+)?\s*$/.test(value) ? Number(value) : value;
  return typeof n === 'number' && Number.isFinite(n) && n >= 0 ? Math.round(n) : -1;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

function parseJson(text: string): ParsedPlaylist | null {
  let root: unknown;
  try {
    root = JSON.parse(text);
  } catch {
    return null;
  }
  const raw = Array.isArray(root) ? root : isRecord(root) && Array.isArray(root.items) ? root.items : null;
  if (raw === null) return null;
  const name = isRecord(root) && typeof root.name === 'string' && root.name.trim() !== '' ? root.name.trim() : null;
  const items: ImportedItem[] = [];
  let skipped = 0;
  for (const e of raw) {
    if (!isRecord(e) || typeof e.path !== 'string' || e.path.trim() === '') {
      skipped++;
      continue;
    }
    const title = typeof e.title === 'string' ? e.title : '';
    items.push(makeItem(title, e.path, msFrom(e.duration ?? e.duration_ms ?? e.durationMs), 'file'));
  }
  return { format: 'json', name, items, skipped };
}

function parseM3u(text: string): ParsedPlaylist {
  const items: ImportedItem[] = [];
  let title = '';
  let ms = -1;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === '') continue;
    if (line.startsWith('#EXTINF:')) {
      const rest = line.slice('#EXTINF:'.length);
      const comma = rest.indexOf(',');
      const secs = Number.parseFloat(comma < 0 ? rest : rest.slice(0, comma));
      ms = Number.isFinite(secs) && secs >= 0 ? Math.round(secs * 1000) : -1;
      title = comma < 0 ? '' : rest.slice(comma + 1);
      continue;
    }
    if (line.startsWith('#')) continue;
    items.push(makeItem(title, line, ms, 'file_rounded'));
    title = '';
    ms = -1;
  }
  return { format: 'm3u', name: null, items, skipped: 0 };
}

/** RFC 4180 rows: quoted cells may hold the delimiter, doubled quotes and line breaks. Blank lines are dropped. */
export function parseCsvRows(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += c;
      continue;
    }
    if (c === '"' && cell === '') {
      quoted = true;
    } else if (c === delimiter) {
      row.push(cell);
      cell = '';
    } else if (c === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else if (c !== '\r') cell += c;
  }
  if (cell !== '' || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => !(r.length === 1 && r[0]!.trim() === ''));
}

const TITLE_COLS = ['title', 'name'];
const PATH_COLS = ['path', 'file', 'filename'];
const DURATION_COLS = ['duration_ms', 'durationms', 'duration'];

function parseCsv(text: string): ParsedPlaylist | null {
  const firstLine = text.split(/\r?\n/, 1)[0]!;
  const delimiter = firstLine.includes(';') && !firstLine.includes(',') ? ';' : ',';
  const rows = parseCsvRows(text, delimiter);
  if (rows.length === 0) return null;
  const head = rows[0]!.map((c) => c.trim().toLowerCase());
  const col = (names: string[]) => head.findIndex((h) => names.includes(h));
  const hasHeader = col(PATH_COLS) >= 0;
  let titleCol = 0;
  let pathCol = 1;
  let durCol = 2;
  let body = rows;
  if (hasHeader) {
    titleCol = col(TITLE_COLS);
    pathCol = col(PATH_COLS);
    durCol = col(DURATION_COLS);
    body = rows.slice(1);
  } else if (rows[0]!.length < 2) {
    return null; // a single headerless column is not recognisable as a playlist
  }
  const items: ImportedItem[] = [];
  let skipped = 0;
  for (const r of body) {
    const path = (r[pathCol] ?? '').trim();
    if (path === '') {
      skipped++;
      continue;
    }
    const title = titleCol >= 0 ? (r[titleCol] ?? '') : '';
    items.push(makeItem(title, path, durCol >= 0 ? msFrom(r[durCol]) : -1, 'file'));
  }
  return { format: 'csv', name: null, items, skipped };
}

export function parsePlaylistFile(input: string, fileName = ''): ParseResult {
  const text = input.replace(/^\uFEFF/, '').trim();
  if (text === '') return { ok: false, reason: 'empty' };
  let parsed: ParsedPlaylist | null;
  if (text.startsWith('{') || text.startsWith('[')) parsed = parseJson(text);
  else if (/^#EXT(M3U|INF)/i.test(text) || /\.m3u8?$/i.test(fileName)) parsed = parseM3u(text);
  else parsed = parseCsv(text);
  if (parsed === null) return { ok: false, reason: 'unrecognised' };
  if (parsed.items.length === 0) return { ok: false, reason: 'no_items' };
  return { ok: true, playlist: parsed };
}
