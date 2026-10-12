// SPDX-License-Identifier: GPL-2.0-or-later
// Keys are namespaced "library.*". Filled by Task 9.
export const IT_LIBRARY: Record<string, string> = {};
export const EN_LIBRARY: Record<keyof typeof IT_LIBRARY, string> = {};
