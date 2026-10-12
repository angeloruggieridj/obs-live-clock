// SPDX-License-Identifier: GPL-2.0-or-later
// Keys are namespaced "settings.*". Filled by Task 12.
export const IT_SETTINGS: Record<string, string> = {};
export const EN_SETTINGS: Record<keyof typeof IT_SETTINGS, string> = {};
