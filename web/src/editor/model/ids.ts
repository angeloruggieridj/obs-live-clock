// SPDX-License-Identifier: GPL-2.0-or-later

const RESERVED = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\.|$)/;

/** Lowercase slug that satisfies the server's id rule (`^[a-z0-9][a-z0-9._-]{0,99}$`, no Windows reserved names). */
export function slugify(name: string): string {
  let s = name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  s = s.slice(0, 80).replace(/-+$/, '');
  if (s === '') s = 'senza-nome';
  if (RESERVED.test(s)) s = `${s}-1`;
  return s;
}

/** `slugify(name)`, or `slug-2`, `slug-3`… when the slug is taken. */
export function uniqueSlug(name: string, taken: ReadonlySet<string>): string {
  const base = slugify(name);
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) {
    const candidate = `${base}-${n}`;
    if (!taken.has(candidate)) return candidate;
  }
}

/** `prefix-1`, `prefix-2`… the first one not taken. Deterministic: no randomness in documents. */
export function nextId(prefix: string, taken: ReadonlySet<string>): string {
  for (let n = 1; ; n++) {
    const id = `${prefix}-${n}`;
    if (!taken.has(id)) return id;
  }
}
