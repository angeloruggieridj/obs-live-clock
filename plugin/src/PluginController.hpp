// SPDX-License-Identifier: GPL-2.0-or-later
#pragma once
#include <QObject>
#include <memory>

#include "CurlHttp.hpp"
#include "Dispatcher.hpp"
#include "DockHost.hpp"
#include "HotkeyForwarder.hpp"
#include "HotkeyRegistrar.hpp"
#include "ScreenReporter.hpp"
#include "SettingsStore.hpp"
#include "Supervisor.hpp"
#include "TickLoop.hpp"

namespace olc {

/**
 * Owns everything the module runs and wires it together. All public methods run on OBS's UI thread. Threads:
 * the TickLoop (Supervisor.tick: health, launch, credentials, screens) and the hotkey Dispatcher; neither ever
 * touches Qt or libobs UI state: results come back through queued calls on the DockHost.
 */
class PluginController : public QObject {
    Q_OBJECT
public:
    explicit PluginController(QObject* parent = nullptr);
    ~PluginController() override;

    /** OBS_FRONTEND_EVENT_FINISHED_LOADING: a profile is active, the main window exists. */
    void onFinishedLoading();
    void onProfileChanged();
    /** OBS_FRONTEND_EVENT_EXIT: stop the threads while libobs is still alive. */
    void shutdown();

    DockHost* dock() { return dock_; }
    void openSettings();

private:
    void applyStatus(const Status& status);

    Lang lang_;
    SettingsStore store_;
    CurlHttp http_;
    DockHost* dock_ = nullptr;  // owned by OBS (the dock wraps it)
    std::unique_ptr<Supervisor> supervisor_;
    std::unique_ptr<Dispatcher> hotkeyWorker_;
    std::unique_ptr<HotkeyForwarder> forwarder_;
    std::unique_ptr<HotkeyRegistrar> hotkeys_;
    std::unique_ptr<ScreenReporter> screens_;
    std::unique_ptr<TickLoop> loop_;
    LaunchPhase lastPhase_ = LaunchPhase::Checking;
    std::string lastInstance_;
    bool shutDown_ = false;
};

}  // namespace olc
