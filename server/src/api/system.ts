// SPDX-License-Identifier: GPL-2.0-or-later
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { SettingsFileInvalidError, publicSettings, type SettingsHolder } from '../app/settings';
import type { HotkeyService } from '../hotkeys/hotkey-service';
import type { KioskController } from '../kiosk/controller';
import type { ScreenRegistry } from '../kiosk/screens';
import { KioskSettings } from '../kiosk/settings';

export interface SystemContext {
  settings: Pick<SettingsHolder, 'get' | 'setKiosk'>;
  hotkeys: Pick<HotkeyService, 'pending'>;
  screens: Pick<ScreenRegistry, 'get'>;
  kiosk: Pick<KioskController, 'status' | 'start' | 'stop' | 'restart' | 'applySettings'>;
}

/** Only the kiosk block can be changed from the app; port and LAN access need a restart and live in the file. */
const PutSettingsBody = z.strictObject({ kiosk: KioskSettings });

/**
 * The operator-facing side of the plugin/kiosk work (public like the other /api routes: localhost by default).
 * Nothing here returns the OBS password or the bearer token.
 */
export function registerSystem(app: FastifyInstance, ctx: SystemContext): void {
  // The dock polls this to show "press again to confirm" after a first press of an emergency hotkey (DT-9).
  app.get('/api/hotkeys/pending', async () => ({ pending: ctx.hotkeys.pending() }));

  app.get('/api/screens', async () => ctx.screens.get());

  app.get('/api/settings', async () => publicSettings(ctx.settings.get()));

  app.put('/api/settings', async (req, reply) => {
    const parsed = PutSettingsBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_body' });
    try {
      const next = await ctx.settings.setKiosk(parsed.data.kiosk);
      await ctx.kiosk.applySettings(next.kiosk);
      return publicSettings(next);
    } catch (err) {
      if (err instanceof SettingsFileInvalidError) return reply.code(409).send({ error: 'settings_file_invalid' });
      throw err;
    }
  });

  app.get('/api/kiosk', async () => ctx.kiosk.status());
  app.post('/api/kiosk/start', async () => {
    await ctx.kiosk.start();
    return ctx.kiosk.status();
  });
  app.post('/api/kiosk/stop', async () => {
    ctx.kiosk.stop();
    return ctx.kiosk.status();
  });
  app.post('/api/kiosk/restart', async () => {
    await ctx.kiosk.restart();
    return ctx.kiosk.status();
  });
}
