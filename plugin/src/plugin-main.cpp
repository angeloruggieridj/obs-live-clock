// SPDX-License-Identifier: GPL-2.0-or-later
#include <curl/curl.h>
#include <obs-frontend-api.h>
#include <obs-module.h>

#include <QMainWindow>

#include "PluginController.hpp"

#ifndef OLC_VERSION
#define OLC_VERSION "0.0.0"
#endif

OBS_DECLARE_MODULE()

MODULE_EXPORT const char* obs_module_description(void) {
    return "OBS Live Clock - presenter clock dock, app launcher and hotkeys";
}
MODULE_EXPORT const char* obs_module_name(void) { return "OBS Live Clock"; }
MODULE_EXPORT const char* obs_module_author(void) { return "OBS Live Clock contributors"; }

static olc::PluginController* g_controller = nullptr;
static constexpr const char* DOCK_ID = "obs-live-clock-dock";

static void on_frontend_event(enum obs_frontend_event event, void*) {
    if (!g_controller) return;
    switch (event) {
    case OBS_FRONTEND_EVENT_FINISHED_LOADING:
        g_controller->onFinishedLoading();
        break;
    case OBS_FRONTEND_EVENT_PROFILE_CHANGED:
        g_controller->onProfileChanged();
        break;
    case OBS_FRONTEND_EVENT_EXIT:
        g_controller->shutdown();
        break;
    default:
        break;
    }
}

bool obs_module_load(void) {
    blog(LOG_INFO, "[obs-live-clock] loaded (v%s)", OLC_VERSION);
    curl_global_init(CURL_GLOBAL_DEFAULT);
    return true;
}

// The dock is registered in post_load, not on FINISHED_LOADING: OBS restores the saved dock layout right after all
// modules are loaded and before that event, so a dock added later would lose its place (lesson from Playlist Deck).
// post_load rather than module_load because obs-browser must already be loaded to host the page.
MODULE_EXPORT void obs_module_post_load(void) {
    auto* controller = new olc::PluginController();
    if (!obs_frontend_add_dock_by_id(DOCK_ID, "OBS Live Clock", controller->dock())) {
        blog(LOG_ERROR, "[obs-live-clock] dock registration failed");
        delete controller->dock();
        delete controller;
        return;
    }
    g_controller = controller;
    blog(LOG_INFO, "[obs-live-clock] dock registered (%s)", controller->dock()->hasBrowser() ? "browser panel" : "fallback page");
    obs_frontend_add_event_callback(on_frontend_event, nullptr);
}

void obs_module_unload(void) {
    obs_frontend_remove_event_callback(on_frontend_event, nullptr);
    if (g_controller) g_controller->shutdown();
    // The controller object is left to process exit: OBS owns the dock widget and tears Qt down itself.
    g_controller = nullptr;
    curl_global_cleanup();
}
