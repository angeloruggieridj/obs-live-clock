// SPDX-License-Identifier: GPL-2.0-or-later
import { useLive } from '../live-context';
import type { Feedback } from './useCommand';

export function CommandFeedback({ feedback }: { feedback: Feedback }) {
  const { t } = useLive();
  const text = feedback.kind === 'noEffect' ? t('noEffect') : feedback.kind === 'error' ? t('commandFailed', { code: feedback.code }) : '';
  return (
    <div className="cmd-feedback" role="status" aria-live="polite" data-kind={feedback.kind}>
      {text}
    </div>
  );
}
