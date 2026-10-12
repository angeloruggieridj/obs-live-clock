// SPDX-License-Identifier: GPL-2.0-or-later
// Keys are namespaced "timeline.*". Filled by Task 10.
export const IT_TIMELINE: Record<string, string> = {};
export const EN_TIMELINE: Record<keyof typeof IT_TIMELINE, string> = {};
