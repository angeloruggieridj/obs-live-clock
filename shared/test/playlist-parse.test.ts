// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import { fileStem, isAbsolutePath, parseCsvRows, parsePlaylistFile, type ParsedPlaylist } from '../src/index';

function ok(text: string, name?: string): ParsedPlaylist {
  const r = parsePlaylistFile(text, name);
  if (!r.ok) throw new Error(`not ok: ${r.reason}`);
  return r.playlist;
}

describe('helpers', () => {
  it('fileStem', () => {
    expect(fileStem('D:\\media\\Servizio 1.mp4')).toBe('Servizio 1');
    expect(fileStem('/a/b/c.tar.gz')).toBe('c.tar');
    expect(fileStem('.hidden')).toBe('.hidden');
    expect(fileStem('noext')).toBe('noext');
  });
  it('isAbsolutePath', () => {
    for (const p of ['D:\\a.mp4', 'c:/a.mp4', '/mnt/a.mp4', '\\\\nas\\share\\a.mp4', 'http://x/a.mp4']) expect(isAbsolutePath(p), p).toBe(true);
    for (const p of ['a.mp4', 'media/a.mp4', '..\\a.mp4', './a.mp4']) expect(isAbsolutePath(p), p).toBe(false);
  });
});

describe('JSON (as Playlist Deck exports it)', () => {
  const exported = JSON.stringify({
    version: 1,
    name: 'Puntata del 12/10',
    items: [
      { path: 'D:/media/servizio1.mp4', title: 'Servizio 1', duration: 185000 },
      { path: 'D:/media/servizio2.mp4', title: '', duration: -1 },
      { path: 'D:/media/servizio3.mp4', title: 'Float', duration: 61234.6 },
    ],
  });
  it('reads name, titles and millisecond durations; -1 stays unknown', () => {
    const p = ok(exported);
    expect(p.format).toBe('json');
    expect(p.name).toBe('Puntata del 12/10');
    expect(p.items.map((i) => [i.title, i.durationMs, i.durationOrigin])).toEqual([
      ['Servizio 1', 185000, 'file'],
      ['servizio2', -1, 'unknown'],
      ['Float', 61235, 'file'],
    ]);
    expect(p.skipped).toBe(0);
  });
  it('skips an entry without a path and keeps the rest', () => {
    const p = ok(JSON.stringify({ items: [{ title: 'x' }, { path: '' }, 7, { path: 'a.mp4' }] }));
    expect(p.items.map((i) => i.path)).toEqual(['a.mp4']);
    expect(p.skipped).toBe(3);
  });
  it('flags relative paths and accepts a top-level array and a BOM', () => {
    const p = ok('\uFEFF' + JSON.stringify([{ path: 'media/a.mp4', duration: 1000 }, { path: 'D:/b.mp4' }]));
    expect(p.items.map((i) => i.pathIsRelative)).toEqual([true, false]);
    expect(p.items[1]!.durationMs).toBe(-1);
  });
  it('is unrecognised when it is JSON without items', () => {
    expect(parsePlaylistFile('{"a":1}')).toEqual({ ok: false, reason: 'unrecognised' });
    expect(parsePlaylistFile('{broken')).toEqual({ ok: false, reason: 'unrecognised' });
  });
});

describe('M3U (as Playlist Deck exports it)', () => {
  const m3u = '#EXTM3U\r\n#EXTINF:185,Servizio 1\r\nD:\\media\\servizio1.mp4\r\n#EXTINF:-1,Senza durata\r\nD:\\media\\x.mp4\r\nD:\\media\\bare.mp4\r\n# a comment\r\n';
  it('reads whole-second durations as file_rounded, -1 as unknown, and titles from EXTINF or the file name', () => {
    const p = ok(m3u);
    expect(p.format).toBe('m3u');
    expect(p.items.map((i) => [i.title, i.durationMs, i.durationOrigin])).toEqual([
      ['Servizio 1', 185000, 'file_rounded'],
      ['Senza durata', -1, 'unknown'],
      ['bare', -1, 'unknown'],
    ]);
  });
  it('detects M3U by file name even without the header line', () => {
    expect(ok('D:\\a.mp4\nD:\\b.mp4\n', 'list.m3u8').items).toHaveLength(2);
  });
  it('an EXTINF applies to the next path only', () => {
    const p = ok('#EXTM3U\n#EXTINF:10,A\na.mp4\nb.mp4\n');
    expect(p.items.map((i) => [i.title, i.durationMs])).toEqual([['A', 10000], ['b', -1]]);
  });
});

describe('CSV (title,path,duration_ms)', () => {
  const csv = '"title","path","duration_ms"\n"Servizio ""uno"", il ritorno","D:/media/s1.mp4",185000\n"Due","D:/media/s2.mp4",-1\n';
  it('reads quoted fields with commas and doubled quotes', () => {
    const p = ok(csv);
    expect(p.format).toBe('csv');
    expect(p.items.map((i) => [i.title, i.path, i.durationMs])).toEqual([
      ['Servizio "uno", il ritorno', 'D:/media/s1.mp4', 185000],
      ['Due', 'D:/media/s2.mp4', -1],
    ]);
    expect(p.items[1]!.durationOrigin).toBe('unknown');
  });
  it('handles a line break inside a quoted title', () => {
    expect(ok('title,path,duration_ms\n"A\nB","x.mp4",1000\n').items[0]!.title).toBe('A\nB');
  });
  it('accepts a semicolon delimiter and reordered, differently named columns', () => {
    const p = ok('File;Duration;Name\nD:/a.mp4;5000;Alfa\n');
    expect(p.items[0]).toMatchObject({ title: 'Alfa', path: 'D:/a.mp4', durationMs: 5000 });
  });
  it('works without a header when there are at least two columns', () => {
    const p = ok('Alfa,D:/a.mp4,7000\nBeta,D:/b.mp4\n');
    expect(p.items.map((i) => [i.title, i.durationMs])).toEqual([['Alfa', 7000], ['Beta', -1]]);
  });
  it('does not guess a single headerless column; a header with only paths works', () => {
    expect(parsePlaylistFile('hello\nworld')).toEqual({ ok: false, reason: 'unrecognised' });
    expect(ok('path\nD:/a.mp4\n').items[0]).toMatchObject({ title: 'a', durationMs: -1 });
  });
  it('counts rows without a path as skipped', () => {
    const p = ok('title,path,duration_ms\nA,,1000\nB,b.mp4,2000\n');
    expect(p.skipped).toBe(1);
    expect(p.items).toHaveLength(1);
  });
  it('parseCsvRows drops blank lines and handles CRLF', () => {
    expect(parseCsvRows('a,b\r\n\r\nc,"d,e"\r\n', ',')).toEqual([['a', 'b'], ['c', 'd,e']]);
  });
});

describe('failure cases', () => {
  it('reports empty and no_items', () => {
    expect(parsePlaylistFile('  \n ')).toEqual({ ok: false, reason: 'empty' });
    expect(parsePlaylistFile('{"items":[]}')).toEqual({ ok: false, reason: 'no_items' });
    expect(parsePlaylistFile('#EXTM3U\n')).toEqual({ ok: false, reason: 'no_items' });
  });
  it('never turns an unknown duration into zero', () => {
    for (const text of ['{"items":[{"path":"a"}]}', '#EXTM3U\na', 'path\na']) {
      expect(ok(text).items[0]).toMatchObject({ durationMs: -1, durationOrigin: 'unknown' });
    }
  });
});
