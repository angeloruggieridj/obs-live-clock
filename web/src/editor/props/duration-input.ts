// SPDX-License-Identifier: GPL-2.0-or-later

/** "12:30" → 750000, "1:02:03", "90" (plain number = seconds), "0:05". Anything else, including negatives and decimals: null. */
export function parseDuration(text: string): number | null {
  const s = text.trim();
  if (s === '') return null;
  const parts = s.split(':');
  if (parts.length > 3 || parts.some((p) => !/^\d+$/.test(p))) return null;
  const n = parts.map(Number);
  let seconds: number;
  if (n.length === 1) seconds = n[0]!;
  else if (n.length === 2) {
    if (n[1]! > 59) return null;
    seconds = n[0]! * 60 + n[1]!;
  } else {
    if (n[1]! > 59 || n[2]! > 59) return null;
    seconds = n[0]! * 3600 + n[1]! * 60 + n[2]!;
  }
  return seconds * 1000;
}
