// SPDX-License-Identifier: GPL-2.0-or-later
#include "Supervisor.hpp"

#include <algorithm>
#include <utility>

namespace olc {

namespace {
LaunchPolicyConfig policyConfig(const PluginSettings& settings) {
    LaunchPolicyConfig cfg;
    cfg.allowLaunch = !settings.isRemote() && settings.autoStart;
    return cfg;
}

/** The authority with any userinfo (user:pass@) removed, so a remote URL can never leak a password into a log line. */
std::string stripUserInfo(const std::string& url) {
    const auto scheme = url.find("://");
    if (scheme == std::string::npos) return url;
    const auto authStart = scheme + 3;
    const auto at = url.find('@', authStart);
    if (at == std::string::npos) return url;
    const auto authorityEnd = url.find_first_of("/?#", authStart);
    if (authorityEnd != std::string::npos && at > authorityEnd) return url;  // the '@' is in the path, not the userinfo
    return url.substr(0, authStart) + url.substr(at + 1);
}
}  // namespace

Supervisor::Supervisor(SupervisorDeps deps, PluginSettings settings)
    : deps_(std::move(deps)),
      paths_(dataPaths(deps_.dataDir)),
      api_(
          deps_.http, "",
          [this] { return deps_.readFile(paths_.secret).value_or(std::string()); }),
      policy_(policyConfig(settings)),
      settings_(std::move(settings)) {}

ApiClient& Supervisor::api() { return api_; }

void Supervisor::applySettings(const PluginSettings& settings) {
    std::lock_guard<std::mutex> lock(mutex_);
    if (settings == settings_) return;
    settings_ = settings;
    settingsDirty_ = true;
}

void Supervisor::setScreens(std::vector<ScreenInfo> screens) {
    std::lock_guard<std::mutex> lock(mutex_);
    if (screens == screens_) return;
    screens_ = std::move(screens);
    screensDirty_ = true;
}

Status Supervisor::status() const {
    std::lock_guard<std::mutex> lock(mutex_);
    return status_;
}

void Supervisor::setOnStatus(std::function<void(const Status&)> callback) {
    std::lock_guard<std::mutex> lock(mutex_);
    onStatus_ = std::move(callback);
}

const char* phaseName(LaunchPhase phase) {
    switch (phase) {
    case LaunchPhase::Checking: return "checking";
    case LaunchPhase::Launching: return "launching";
    case LaunchPhase::Running: return "running";
    case LaunchPhase::Incompatible: return "incompatible";
    case LaunchPhase::Unavailable: return "unavailable";
    case LaunchPhase::Failed: return "failed";
    }
    return "?";
}

void Supervisor::publish(const Status& next) {
    std::function<void(const Status&)> callback;
    bool phaseChanged = false;
    {
        std::lock_guard<std::mutex> lock(mutex_);
        if (next == status_) return;
        phaseChanged = next.phase != status_.phase;
        status_ = next;
        callback = onStatus_;
    }
    if (phaseChanged) deps_.log(std::string("app ") + phaseName(next.phase) + (next.port != 0 ? " on port " + std::to_string(next.port) : std::string(" (remote)")));
    if (callback) callback(next);
}

void Supervisor::tick() {
    const int64_t now = deps_.nowMs();
    PluginSettings settings;
    bool settingsChanged = false;
    bool screensWanted = false;
    {
        std::lock_guard<std::mutex> lock(mutex_);
        settings = settings_;
        settingsChanged = settingsDirty_;
        settingsDirty_ = false;
        // Dirty screens may bring the next probe forward only while the app is actually healthy locally and there is
        // a list to deliver. A down/incompatible/failed/unavailable app, a remote app and an empty list must not
        // probe faster than the policy cadence (otherwise a Running app that goes away is counted dead in ~1 s).
        screensWanted = screensDirty_ && healthOk_ && !settings.isRemote() && !screens_.empty() && now >= screensRetryAt_;
    }
    if (settingsChanged) {
        policy_.setAllowLaunch(!settings.isRemote() && settings.autoStart);
        policy_.reset();
        creds_.forget();
        healthOk_ = false;
        lastInstance_.clear();
        screensSentOnce_ = false;
        screensRetryAt_ = 0;
        nextProbeAt_ = 0;
    }
    if (now < nextProbeAt_ && !screensWanted) return;
    probe(now, settings);
}

void Supervisor::probe(int64_t now, const PluginSettings& settings) {
    if (settings.isRemote()) {
        probeRemote(now, settings);
        return;
    }
    probeLocal(now, settings);
}

void Supervisor::probeLocal(int64_t now, const PluginSettings& settings) {
    Status st = status();
    st.remote = false;
    const auto runtime = parseRuntimeJson(deps_.readFile(paths_.runtime).value_or(std::string()));
    const auto settingsPort = parseSettingsPort(deps_.readFile(paths_.settings).value_or(std::string()));
    const int port = resolvePort(runtime, settingsPort);
    st.port = port;
    st.dockUrl = dockUrl(settings, port);
    const std::string base = apiBaseUrl(settings, port);
    api_.setBaseUrl(base);

    const HttpResponse response = api_.health();
    std::optional<HealthInfo> info;
    if (response.answered() && response.status == 200) info = parseHealth(response.body);
    if (response.answered() && !info && !notOurAppLogged_) {
        notOurAppLogged_ = true;
        deps_.log("something answers on " + stripUserInfo(base) + " but it is not OBS Live Clock");
    }
    HealthObservation observed = HealthObservation::Unreachable;
    Compat compat = Compat::Ok;
    if (info) {
        compat = checkProtocol(info->protocol);
        observed = compat == Compat::Ok ? HealthObservation::Ok : HealthObservation::Incompatible;
    }

    const PolicyDecision decision = policy_.onHealth(now, observed);
    st.phase = decision.phase;
    st.compat = compat;
    st.appVersion = info ? info->version : std::string();
    st.instanceId = info ? info->instanceId : std::string();
    nextProbeAt_ = now + decision.nextCheckInMs;

    if (decision.launch) {
        st.launchSpecMissing = false;
        st.launchFailed = false;
        const auto fileSpec = parseLaunchJson(deps_.readFile(paths_.launch).value_or(std::string()));
        const auto spec = resolveLaunch(settings, fileSpec);
        if (!spec) {
            st.launchSpecMissing = true;
            deps_.log("the app does not answer and no launch command is known (see Tools > OBS Live Clock)");
        } else if (deps_.launch(*spec)) {
            deps_.log("started the app: " + spec->command);
        } else {
            st.launchFailed = true;
            deps_.log("could not start the app: " + spec->command);
        }
    } else if (observed == HealthObservation::Ok) {
        st.launchSpecMissing = false;
        st.launchFailed = false;
    }
    st.launches = policy_.launches();

    if (observed == HealthObservation::Ok) {
        if (info->instanceId != lastInstance_) {  // first sight, or the app restarted
            if (!lastInstance_.empty()) deps_.log("the app restarted: delivering again");
            lastInstance_ = info->instanceId;
            creds_.forget();
            screensSentOnce_ = false;
            screensRetryAt_ = 0;
        }
        st.credentials = deliverCredentials(now, info->instanceId);
        if (creds_.consecutiveFailures() > 0) {
            nextProbeAt_ = std::min(nextProbeAt_, std::max(now + 250, creds_.retryAt()));
        }
        deliverScreens(now);
    } else {
        st.credentials = CredentialState::NotApplicable;
    }
    healthOk_ = observed == HealthObservation::Ok;
    publish(st);
}

void Supervisor::probeRemote(int64_t now, const PluginSettings& settings) {
    Status st = status();
    st.remote = true;
    st.port = 0;  // there is no local port to speak of in remote mode
    st.dockUrl = dockUrl(settings, 0);
    const std::string base = apiBaseUrl(settings, 0);  // the remote URL, "" when it is invalid
    if (base.empty()) {  // nothing to call and nothing to launch: just wait
        st.phase = LaunchPhase::Unavailable;
        st.credentials = CredentialState::NotApplicable;
        healthOk_ = false;
        nextProbeAt_ = now + policyIntervalMs();
        publish(st);
        return;
    }
    // Remote mode talks to the app's PUBLIC health route with deps_.http directly: no bearer token, no body and
    // never the local ApiClient (whose loopback URL, token and credentials body must never leave this machine).
    HttpRequest request;
    request.method = "GET";
    request.url = base + "/api/health";
    request.timeoutMs = 1500;
    const HttpResponse response = deps_.http.perform(request);
    std::optional<HealthInfo> info;
    if (response.answered() && response.status == 200) info = parseHealth(response.body);
    if (response.answered() && !info && !notOurAppLogged_) {
        notOurAppLogged_ = true;
        deps_.log("something answers on " + stripUserInfo(base) + " but it is not OBS Live Clock");
    }
    HealthObservation observed = HealthObservation::Unreachable;
    Compat compat = Compat::Ok;
    if (info) {
        compat = checkProtocol(info->protocol);
        observed = compat == Compat::Ok ? HealthObservation::Ok : HealthObservation::Incompatible;
    }

    const PolicyDecision decision = policy_.onHealth(now, observed);  // allowLaunch is false: it can never start anything
    st.phase = decision.phase;
    st.compat = compat;
    st.appVersion = info ? info->version : std::string();
    st.instanceId = info ? info->instanceId : std::string();
    st.launchSpecMissing = false;  // remote mode never launches: a stale local "cannot start" note must not stick
    st.launchFailed = false;
    st.credentials = CredentialState::NotApplicable;  // DT-3: remote mode hands over nothing
    nextProbeAt_ = now + decision.nextCheckInMs;
    healthOk_ = observed == HealthObservation::Ok;
    publish(st);
}


int Supervisor::policyIntervalMs() const { return 5'000; }

CredentialState Supervisor::deliverCredentials(int64_t now, const std::string& instanceId) {
    const auto config = deps_.readObsWs();
    if (!config) return CredentialState::ConfigUnreadable;
    if (!config->serverEnabled) return CredentialState::ServerDisabled;
    if (creds_.due(now, *config, instanceId)) {
        const HttpResponse response = api_.postCredentials(buildCredentialsBody(*config));
        const DeliveryOutcome outcome = classifyDelivery(response);
        creds_.record(now, outcome, *config, instanceId);
        deps_.log(outcome == DeliveryOutcome::Delivered ? "obs-websocket settings delivered to the app (" + describe(*config) + ")"
                                                        : "could not deliver the obs-websocket settings (HTTP " +
                                                              std::to_string(response.status) + ")");
        if (outcome != DeliveryOutcome::Delivered) return CredentialState::Failing;
    } else if (creds_.consecutiveFailures() > 0) {
        return CredentialState::Failing;
    }
    return CredentialState::Delivered;
}

void Supervisor::deliverScreens(int64_t now) {
    std::vector<ScreenInfo> screens;
    bool dirty = false;
    {
        std::lock_guard<std::mutex> lock(mutex_);
        screens = screens_;
        dirty = screensDirty_;
    }
    if (screens.empty() || (screensSentOnce_ && !dirty) || now < screensRetryAt_) return;
    const HttpResponse response = api_.postScreens(screensToJson(screens));
    if (response.answered() && (response.status == 204 || response.status == 200)) {
        screensSentOnce_ = true;
        screensRetryAt_ = 0;
        screensFailures_ = 0;
        lastScreensFailure_ = 0;
        std::lock_guard<std::mutex> lock(mutex_);
        if (screens_ == screens) screensDirty_ = false;
        return;
    }
    // Same backoff as the credentials: 2, 4, 8, 16, then every 30 s. An app without this route (older version)
    // answers 404 forever and must not be asked every 2 s, nor fill the log.
    static const int64_t kBackoffMs[] = {2'000, 4'000, 8'000, 16'000, 30'000};
    screensFailures_ = (std::min)(screensFailures_ + 1, 5);
    screensRetryAt_ = now + kBackoffMs[screensFailures_ - 1];
    if (response.status != lastScreensFailure_) {  // log a streak once, and again if the answer changes
        lastScreensFailure_ = response.status;
        deps_.log("could not deliver the screen list (HTTP " + std::to_string(response.status) + ")");
    }
}

}  // namespace olc
