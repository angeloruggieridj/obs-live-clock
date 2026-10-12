// SPDX-License-Identifier: GPL-2.0-or-later
// Keys are namespaced "validation.*". Filled by Task 14.
export const IT_VALIDATION: Record<string, string> = {};
export const EN_VALIDATION: Record<keyof typeof IT_VALIDATION, string> = {};
