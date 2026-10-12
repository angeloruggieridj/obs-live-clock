// SPDX-License-Identifier: GPL-2.0-or-later
import { chmod, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ExitInfo } from '../../src/kiosk/controller';
import { detectBrowser } from '../../src/kiosk/detect';
import { nodeDetectDeps, nodeSpawn, parseRegQuery } from '../../src/kiosk/node-kiosk';
import { tempDir } from '../support/tmp';

function exitOf(command: string, args: string[]): Promise<ExitInfo> {
  return new Promise((resolve) => nodeSpawn(command, args).onExit(resolve));
}

describe('nodeSpawn', () => {
  it('reports the exit code of a process that ends', async () => {
    expect(await exitOf(process.execPath, ['-e', 'process.exit(3)'])).toEqual({ code: 3 });
  });

  it('reports a command that cannot be started as an error, not as a crash', async () => {
    const info = await exitOf(join(await tempDir(), 'no-such-browser'), []);
    expect(info.code).toBeNull();
    expect(info.error).toMatch(/ENOENT|EACCES|spawn/);
  });

  it('kill() ends a running process', async () => {
    const proc = nodeSpawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)']);
    const ended = new Promise<ExitInfo>((resolve) => proc.onExit(resolve));
    expect(proc.pid).toBeGreaterThan(0);
    proc.kill();
    const info = await ended;
    expect(info.error).toBeUndefined();
  });

  it('delivers an exit that happened before onExit was registered', async () => {
    const proc = nodeSpawn(process.execPath, ['-e', 'process.exit(0)']);
    await new Promise((r) => setTimeout(r, 600));
    expect(await new Promise<ExitInfo>((resolve) => proc.onExit(resolve))).toEqual({ code: 0 });
  });
});

describe('parseRegQuery', () => {
  it('reads the default value whatever the language of the label', () => {
    const en = '\r\nHKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\chrome.exe\r\n    (Default)    REG_SZ    C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe\r\n\r\n';
    const it = '\r\nHKEY_LOCAL_MACHINE\\SOFTWARE\\...\\msedge.exe\r\n    (Predefinito)    REG_SZ    C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe\r\n';
    expect(parseRegQuery(en)).toBe('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe');
    expect(parseRegQuery(it)).toBe('C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe');
  });

  it('accepts REG_EXPAND_SZ and answers null when there is no value', () => {
    expect(parseRegQuery('    (Default)    REG_EXPAND_SZ    %ProgramFiles%\\x.exe')).toBe('%ProgramFiles%\\x.exe');
    expect(parseRegQuery('ERROR: The system was unable to find the specified registry key or value.')).toBeNull();
    expect(parseRegQuery('')).toBeNull();
  });
});

describe('nodeDetectDeps', () => {
  it('which() finds an executable on PATH and ignores a missing one', async () => {
    const dir = await tempDir();
    const exe = join(dir, process.platform === 'win32' ? 'fake-browser.exe' : 'fake-browser');
    await writeFile(exe, '#!/bin/sh\n');
    await chmod(exe, 0o755);
    const deps = nodeDetectDeps(process.platform, { ...process.env, PATH: dir });
    expect(await deps.which(process.platform === 'win32' ? 'fake-browser.exe' : 'fake-browser')).toBe(exe);
    expect(await deps.which('definitely-not-here')).toBeNull();
  });

  it('exists() is true for files only', async () => {
    const dir = await tempDir();
    const file = join(dir, 'a.txt');
    await writeFile(file, 'x');
    const deps = nodeDetectDeps();
    expect(await deps.exists(file)).toBe(true);
    expect(await deps.exists(dir)).toBe(false);
    expect(await deps.exists(join(dir, 'missing'))).toBe(false);
  });

  it('a configured browserPath that does not exist is not replaced by a detected one', async () => {
    expect(await detectBrowser(nodeDetectDeps(), join(await tempDir(), 'typo.exe'))).toBeNull();
  });
});
