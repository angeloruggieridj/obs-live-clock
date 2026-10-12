// SPDX-License-Identifier: GPL-2.0-or-later
// Development launcher: obs-sim + server + Vite. Type obs-sim commands in this terminal (e.g. "rec started").
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = join(root, '.dev-data');
const settingsFile = join(dataDir, 'settings.json');
const isWindows = process.platform === 'win32';

mkdirSync(dataDir, { recursive: true });
if (!existsSync(settingsFile)) {
  writeFileSync(settingsFile, `${JSON.stringify({ obs: { host: '127.0.0.1', port: 4455 } }, null, 2)}\n`);
}

const children = [];
let stopping = false;

function prefix(name, stream, out) {
  let buffer = '';
  stream.setEncoding('utf8');
  stream.on('data', (chunk) => {
    buffer += chunk;
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? '';
    for (const line of lines) out.write(`[${name}] ${line}\n`);
  });
}

function run(name, args, { stdin = 'ignore', env = {} } = {}) {
  const child = spawn('pnpm', args, { cwd: root, shell: isWindows, stdio: [stdin, 'pipe', 'pipe'], env: { ...process.env, ...env } });
  prefix(name, child.stdout, process.stdout);
  prefix(name, child.stderr, process.stderr);
  child.on('exit', (code) => {
    console.log(`[${name}] exited (${code})`);
    shutdown();
  });
  children.push(child);
  return child;
}

function shutdown() {
  if (stopping) return;
  stopping = true;
  for (const child of children) {
    if (child.exitCode !== null || child.pid === undefined) continue;
    if (isWindows) spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    else child.kill('SIGTERM');
  }
  setTimeout(() => process.exit(0), 500);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

const sim = run('sim', ['--filter', '@olc/obs-sim', 'start'], { stdin: 'pipe' });
process.stdin.pipe(sim.stdin);
run('server', ['--filter', '@olc/server', 'dev'], { env: { OLC_DATA_DIR: dataDir } });
run('web', ['--filter', '@olc/web', 'dev']);

async function seedWhenReady() {
  const deadline = Date.now() + 30_000;
  while (!stopping && Date.now() < deadline) {
    try {
      if ((await fetch('http://127.0.0.1:4460/api/health')).ok) break;
    } catch {
      // not listening yet
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  if (stopping) return;
  const seed = spawn('pnpm', ['--filter', '@olc/server', 'seed:dev'], { cwd: root, shell: isWindows, stdio: 'inherit' });
  seed.on('exit', (code) => {
    if (code !== 0) console.log(`[dev] seed failed (${code})`);
    console.log('[dev] presenter http://localhost:5173/presenter · dock http://localhost:5173/dock · control http://localhost:5173/control · editor http://localhost:5173/editor');
  });
}
void seedWhenReady();
