// SPDX-License-Identifier: GPL-2.0-or-later
// Keys are namespaced "import.*". Filled by Task 13.
export const IT_IMPORT: Record<string, string> = {};
export const EN_IMPORT: Record<keyof typeof IT_IMPORT, string> = {};
