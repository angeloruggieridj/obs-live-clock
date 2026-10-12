// SPDX-License-Identifier: GPL-2.0-or-later
#include <curl/curl.h>
#include <obs-module.h>

#ifndef OLC_VERSION
#define OLC_VERSION "0.0.0"
#endif

OBS_DECLARE_MODULE()

MODULE_EXPORT const char* obs_module_description(void) {
    return "OBS Live Clock - presenter clock dock, app launcher and hotkeys";
}
MODULE_EXPORT const char* obs_module_name(void) { return "OBS Live Clock"; }
MODULE_EXPORT const char* obs_module_author(void) { return "OBS Live Clock contributors"; }

bool obs_module_load(void) {
    blog(LOG_INFO, "[obs-live-clock] loaded (v%s)", OLC_VERSION);
    curl_global_init(CURL_GLOBAL_DEFAULT);
    return true;
}

void obs_module_unload(void) { curl_global_cleanup(); }
