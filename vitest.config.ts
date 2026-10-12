// SPDX-License-Identifier: GPL-2.0-or-later
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Slow CI runners must not flake; server tests have timed out at 5 s under load.
    testTimeout: 15_000,
    projects: [
      {
        test: {
          name: 'node',
          environment: 'node',
          testTimeout: 15_000,
          include: ['shared/test/**/*.test.ts', 'server/test/**/*.test.ts', 'tools/**/test/**/*.test.ts'],
        },
      },
      {
        // React 19 automatic JSX runtime; components and hooks run under jsdom. A test file can opt out with
        // `// @vitest-environment node` on its second line (the integration test does: jsdom breaks real sockets).
        esbuild: { jsx: 'automatic' },
        test: {
          name: 'web',
          environment: 'jsdom',
          testTimeout: 15_000,
          include: ['web/test/**/*.test.{ts,tsx}'],
          setupFiles: ['web/test/setup.ts'],
        },
      },
    ],
  },
});
