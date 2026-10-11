// SPDX-License-Identifier: GPL-2.0-or-later
import { useEffect, useRef, useState } from 'react';
import { useLive } from '../live-context';

export const CONFIRM_WINDOW_MS = 1_500;
export const LONG_PRESS_MS = 800;

interface Props {
  label: string;
  onConfirm: () => void;
  disabled?: boolean;
  danger?: boolean;
  pressed?: boolean;
}

/** F16: an emergency action needs a second click within CONFIRM_WINDOW_MS, or a press held for LONG_PRESS_MS. */
export function ConfirmButton({ label, onConfirm, disabled = false, danger = false, pressed }: Props) {
  const { t } = useLive();
  const [armed, setArmed] = useState(false);
  const disarmTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const firedByPress = useRef(false);

  const clearTimers = () => {
    if (disarmTimer.current !== null) clearTimeout(disarmTimer.current);
    if (pressTimer.current !== null) clearTimeout(pressTimer.current);
    disarmTimer.current = null;
    pressTimer.current = null;
  };
  useEffect(() => clearTimers, []);
  useEffect(() => {
    if (disabled) {
      clearTimers();
      setArmed(false);
    }
  }, [disabled]);

  const fire = () => {
    clearTimers();
    setArmed(false);
    onConfirm();
  };
  const onClick = () => {
    if (firedByPress.current) {
      firedByPress.current = false;
      return;
    }
    if (armed) {
      fire();
      return;
    }
    setArmed(true);
    disarmTimer.current = setTimeout(() => setArmed(false), CONFIRM_WINDOW_MS);
  };
  const onPointerDown = () => {
    firedByPress.current = false;
    if (pressTimer.current !== null) clearTimeout(pressTimer.current);
    pressTimer.current = setTimeout(() => {
      pressTimer.current = null;
      firedByPress.current = true;
      fire();
    }, LONG_PRESS_MS);
  };
  const cancelPress = () => {
    if (pressTimer.current !== null) clearTimeout(pressTimer.current);
    pressTimer.current = null;
  };

  return (
    <button
      type="button"
      className="confirm-button"
      aria-label={label}
      aria-pressed={pressed}
      data-armed={String(armed)}
      data-danger={String(danger)}
      disabled={disabled}
      onClick={onClick}
      onPointerDown={onPointerDown}
      onPointerUp={cancelPress}
      onPointerLeave={cancelPress}
      onPointerCancel={cancelPress}
    >
      {armed ? t('confirmAgain') : label}
    </button>
  );
}
