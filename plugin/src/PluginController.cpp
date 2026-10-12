// SPDX-License-Identifier: GPL-2.0-or-later
#include "PluginController.hpp"

#include <obs-frontend-api.h>
#include <obs-module.h>

#include <QMainWindow>
#include <QMetaObject>
#include <chrono>

#include "SettingsDialog.hpp"
#include "SystemAdapters.hpp"

namespace olc {

namespace {
void logLine(const std::string& line) { blog(LOG_INFO, "[obs-live-clock] %s", line.c_str()); }
}  // namespace

PluginController::PluginController(QObject* parent) : QObject(parent) {
    lang_ = langFromLocale(obs_get_locale() ? obs_get_locale() : "");
    dock_ = new DockHost(lang_);
}

PluginController::~PluginController() { shutdown(); }

void PluginController::onFinishedLoading() {
    if (supervisor_ || shutDown_) return;
    const PluginSettings settings = store_.load();

    // Everything the tick thread needs from OBS is captured here, on the UI thread, once.
    const std::string wsConfigPath = obsWebsocketConfigPath();
    const auto legacy = readLegacyObsWsValues();
    const auto args = commandLineArguments();

    SupervisorDeps deps{http_,
                        &monotonicMs,
                        &readTextFile,
                        &launchDetached,
                        [wsConfigPath, legacy, args] { return loadObsWsConfig(&readTextFile, wsConfigPath, legacy, args); },
                        &logLine,
                        resolveDataDir()};
    supervisor_ = std::make_unique<Supervisor>(std::move(deps), settings);
    supervisor_->setOnStatus([this](const Status& s) {
        // Tick thread -> GUI thread. A queued call to a destroyed context object is dropped by Qt.
        QMetaObject::invokeMethod(this, [this, s] { applyStatus(s); }, Qt::QueuedConnection);
    });

    hotkeyWorker_ = std::make_unique<Dispatcher>(32);
    forwarder_ = std::make_unique<HotkeyForwarder>(supervisor_->api(), *hotkeyWorker_, &logLine);
    hotkeys_ = std::make_unique<HotkeyRegistrar>(*forwarder_);
    hotkeys_->registerAll();

    screens_ = std::make_unique<ScreenReporter>([this](std::vector<ScreenInfo> list) { supervisor_->setScreens(std::move(list)); });
    screens_->start();

    obs_frontend_add_tools_menu_item(
        text(lang_, Msg::MenuEntry).c_str(), [](void* self) { static_cast<PluginController*>(self)->openSettings(); }, this);

    loop_ = std::make_unique<TickLoop>([this] { supervisor_->tick(); }, std::chrono::milliseconds(250));
    logLine("started");
}

void PluginController::onProfileChanged() {
    if (hotkeys_) hotkeys_->reloadBindings();
}

void PluginController::applyStatus(const Status& status) {
    if (shutDown_) return;
    dock_->present(QString::fromStdString(status.dockUrl), QString::fromStdString(describeStatus(lang_, status)));
    const bool cameUp = status.phase == LaunchPhase::Running && (lastPhase_ != LaunchPhase::Running || status.instanceId != lastInstance_);
    if (cameUp) dock_->reloadBrowser();  // the page may be showing a connection error from before the app was up
    lastPhase_ = status.phase;
    lastInstance_ = status.instanceId;
}

void PluginController::openSettings() {
    if (!supervisor_) return;
    const PluginSettings current = store_.load();
    auto* parent = static_cast<QMainWindow*>(obs_frontend_get_main_window());
    SettingsDialog dialog(lang_, current, QString::fromStdString(describeStatus(lang_, supervisor_->status())), parent);
    if (dialog.exec() != QDialog::Accepted || !dialog.result()) return;
    store_.save(*dialog.result());
    supervisor_->applySettings(*dialog.result());
}

void PluginController::shutdown() {
    if (shutDown_) return;
    shutDown_ = true;
    if (loop_) loop_->stop();            // joins: no tick runs after this line
    if (hotkeys_) hotkeys_->unregisterAll();
    if (hotkeyWorker_) hotkeyWorker_->stop();
    forwarder_.reset();
    hotkeys_.reset();
    hotkeyWorker_.reset();
    screens_.reset();
    loop_.reset();
    supervisor_.reset();
}

}  // namespace olc
