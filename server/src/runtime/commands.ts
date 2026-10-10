// SPDX-License-Identifier: GPL-2.0-or-later
import type { ClientCommand } from '@olc/shared';
import type { Command } from '../engine/index';

/** An engine input before the runtime stamps its time. */
export type WithoutAt<T> = T extends unknown ? Omit<T, 'at'> : never;

export function commandToInput(c: ClientCommand): WithoutAt<Command> {
  switch (c.name) {
    case 'start_program':
      return { type: 'StartProgram' };
    case 'next':
      return { type: 'Next' };
    case 'prev':
      return { type: 'Prev' };
    case 'goto':
      return { type: 'Goto', slot: c.slot };
    case 'adjust':
      return { type: 'Adjust', deltaMs: c.deltaMs };
    case 'set_control':
      return { type: 'SetControl', control: c.control };
    case 'send_message':
      return { type: 'SendMessage', text: c.text, dismiss: c.dismiss };
    case 'clear_message':
      return { type: 'ClearMessage' };
    case 'resolve_decision':
      return { type: 'ResolveDecision', id: c.id, choice: c.choice };
  }
}
