// SPDX-License-Identifier: GPL-2.0-or-later
// Keys are namespaced "shell.*". Filled by Task 15.
export const IT_SHELL: Record<string, string> = {};
export const EN_SHELL: Record<keyof typeof IT_SHELL, string> = {};
