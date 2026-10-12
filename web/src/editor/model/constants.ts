// SPDX-License-Identifier: GPL-2.0-or-later

/** Block durations snap to this step while resizing (SPEC F3). */
export const SNAP_MS = 5_000;
/** Shortest block the editor lets the director make. The schema's own minimum is 1 s. */
export const MIN_BLOCK_MS = 5_000;
/** Undo steps kept. */
export const UNDO_LIMIT = 100;
/** Edits with the same key closer together than this merge into one undo step. */
export const COALESCE_MS = 600;
/** Quiet time after the last edit before the document is saved. */
export const AUTOSAVE_DEBOUNCE_MS = 800;
