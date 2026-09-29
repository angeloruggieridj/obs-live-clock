// SPDX-License-Identifier: GPL-2.0-or-later
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export function tempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'olc-test-'));
}
