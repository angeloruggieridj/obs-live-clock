// SPDX-License-Identifier: GPL-2.0-or-later
#pragma once
#include <cstdint>
#include <functional>
#include <memory>
#include <mutex>
#include <optional>
#include <string>
#include <vector>

#include "ApiClient.hpp"
#include "CredentialTracker.hpp"
#include "Health.hpp"
#include "LaunchPolicy.hpp"
#include "ObsWsConfig.hpp"
#include "Paths.hpp"
#include "PluginSettings.hpp"
#include "ScreenInfo.hpp"

namespace olc {

enum class CredentialState {
    NotApplicable,    // remote mode, or the app is not up yet
    Delivered,        // the app has the current obs-websocket settings
    Failing,          // the last delivery failed; retrying with backoff
    ServerDisabled,   // obs-websocket's server is switched off in OBS: nothing to deliver
    ConfigUnreadable, // obs-websocket's config could not be read
};

/** Everything the dock fallback widget and the settings dialog may show. Plain data: safe to copy across threads. */
struct Status {
    LaunchPhase phase = LaunchPhase::Checking;
    Compat compat = Compat::Ok;
    bool remote = false;
    int port = 0;                      // local port in use (0 in remote mode)
    std::string dockUrl;               // "" when remote mode has no valid URL
    std::string appVersion;
    std::string instanceId;
    CredentialState credentials = CredentialState::NotApplicable;
    bool launchSpecMissing = false;    // we needed to start the app and had no command to start it with
    bool launchFailed = false;         // the OS refused to start the command
    int launches = 0;

    bool operator==(const Status& o) const {
        return phase == o.phase && compat == o.compat && remote == o.remote && port == o.port && dockUrl == o.dockUrl &&
               appVersion == o.appVersion && instanceId == o.instanceId && credentials == o.credentials &&
               launchSpecMissing == o.launchSpecMissing && launchFailed == o.launchFailed && launches == o.launches;
    }
    bool operator!=(const Status& o) const { return !(*this == o); }
};

struct SupervisorDeps {
    IHttpClient& http;
    std::function<int64_t()> nowMs;                                          // monotonic
    std::function<std::optional<std::string>(const std::string&)> readFile;  // nullopt = missing or unreadable
    std::function<bool(const LaunchSpec&)> launch;                           // start detached; false = failed to start
    std::function<std::optional<ObsWsConfig>()> readObsWs;                   // config.json (+legacy, +command line)
    std::function<void(const std::string&)> log;                             // one line; callers guarantee no secrets
    std::string dataDir;                                                     // defaultDataDir(...) resolved by the glue
};

/**
 * The plugin's brain, with no OBS and no Qt in it. tick() runs on ONE worker thread about every 250 ms and
 * does whatever is due: probe /api/health, launch the app (LaunchPolicy decides), deliver the credentials
 * (CredentialTracker decides) and the screen list. applySettings/setScreens/status are safe from any thread.
 */
class Supervisor {
public:
    Supervisor(SupervisorDeps deps, PluginSettings settings);

    void tick();
    /** The client the glue's HotkeyForwarder shares. Thread-safe; its base URL follows the settings. */
    ApiClient& api();
    void applySettings(const PluginSettings& settings);
    void setScreens(std::vector<ScreenInfo> screens);
    Status status() const;
    /** Called on the tick thread whenever status() changed. */
    void setOnStatus(std::function<void(const Status&)> callback);

private:
    void probe(int64_t now, const PluginSettings& settings);
    /** Local mode: health through the shared ApiClient (loopback only), then credentials and screens. */
    void probeLocal(int64_t now, const PluginSettings& settings);
    /** Remote mode: the public health route through deps_.http only; never the token, never a delivery, never a launch. */
    void probeRemote(int64_t now, const PluginSettings& settings);
    CredentialState deliverCredentials(int64_t now, const std::string& instanceId);
    void deliverScreens(int64_t now);
    int policyIntervalMs() const;
    void publish(const Status& status);

    SupervisorDeps deps_;
    DataPaths paths_;
    ApiClient api_;
    LaunchPolicy policy_;
    CredentialTracker creds_;

    mutable std::mutex mutex_;  // guards the members below
    PluginSettings settings_;
    bool settingsDirty_ = true;
    std::vector<ScreenInfo> screens_;
    bool screensDirty_ = false;
    Status status_;
    std::function<void(const Status&)> onStatus_;

    // tick-thread only
    int64_t nextProbeAt_ = 0;
    bool healthOk_ = false;  // the last probe answered Ok: only then may a dirty screen list make a tick due
    std::string lastInstance_;
    bool screensSentOnce_ = false;
    int64_t screensRetryAt_ = 0;
    int screensFailures_ = 0;
    int lastScreensFailure_ = 0;
    bool notOurAppLogged_ = false;
};

} // namespace olc
