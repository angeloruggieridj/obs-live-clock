// SPDX-License-Identifier: GPL-2.0-or-later
import { ControlView, PresenterView, type ClientRole } from '@olc/shared';

export type { Anchor, ControlDecision, ControlView, PresenterView, RundownRow, Source } from '@olc/shared';

export type ViewFor<R extends ClientRole> = R extends 'presenter' ? PresenterView : ControlView;

/** Validates a `view` payload for a role (DT-7: schemas validated on both sides). null = no episode loaded. */
export function parseView<R extends ClientRole>(
  role: R,
  raw: unknown,
): { ok: true; view: ViewFor<R> | null } | { ok: false; error: string } {
  if (raw === null) return { ok: true, view: null };
  const result = role === 'presenter' ? PresenterView.safeParse(raw) : ControlView.safeParse(raw);
  return result.success ? { ok: true, view: result.data as ViewFor<R> } : { ok: false, error: result.error.message };
}
