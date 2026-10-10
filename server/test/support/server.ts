// SPDX-License-Identifier: GPL-2.0-or-later
import { buildServer, type BuiltServer, type ServerOptions } from '../../src/app/server';

/**
 * Builds a server with a no-op Windows ACL runner by default, so no test ever spawns the real `icacls`.
 * Pass `restrictAcl` to override.
 */
export function buildTestServer(opts: ServerOptions): Promise<BuiltServer> {
  return buildServer({ restrictAcl: async () => {}, ...opts });
}
