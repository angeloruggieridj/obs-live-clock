// SPDX-License-Identifier: GPL-2.0-or-later
#include "BrowserPanel.hpp"

#include <obs-module.h>
#include <util/platform.h>
#if defined(__linux__)
#include <obs-nix-platform.h>
#endif

namespace olc::panel {

namespace {
constexpr int kMinPanelVersion = 3;  // what OBS 30.0 .. 33.0-rc1 export; allowAllPopups() needs >= 1

void* browserLib() {
#if defined(__linux__)
    if (obs_get_nix_platform() == OBS_NIX_PLATFORM_WAYLAND) return nullptr;  // same rule as OBS itself
#endif
    obs_module_t* module = obs_get_module("obs-browser");
    return module ? obs_get_module_lib(module) : nullptr;
}
}  // namespace

QCef* createQCef() {
    static QCef* cached = nullptr;
    static bool tried = false;
    if (tried) return cached;
    tried = true;
    void* lib = browserLib();
    if (!lib) return nullptr;
    using VersionFn = int (*)();
    using CreateFn = QCef* (*)();
    const auto version = reinterpret_cast<VersionFn>(os_dlsym(lib, "obs_browser_qcef_version_export"));
    if (!version || version() < kMinPanelVersion) return nullptr;
    const auto create = reinterpret_cast<CreateFn>(os_dlsym(lib, "obs_browser_create_qcef"));
    cached = create ? create() : nullptr;
    return cached;
}

QCefWidget* createBrowserWidget(QWidget* parent, const std::string& url) {
    QCef* cef = createQCef();
    if (!cef) return nullptr;
    QCefWidget* widget = cef->create_widget(parent, url, nullptr);
    if (widget) widget->allowAllPopups(true);  // same as OBS's own custom browser docks
    return widget;
}

}  // namespace olc::panel
