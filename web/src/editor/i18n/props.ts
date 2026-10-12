// SPDX-License-Identifier: GPL-2.0-or-later
// Keys are namespaced "props.*". Filled by Task 11.
export const IT_PROPS: Record<string, string> = {};
export const EN_PROPS: Record<keyof typeof IT_PROPS, string> = {};
