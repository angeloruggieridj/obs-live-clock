// SPDX-License-Identifier: GPL-2.0-or-later
#include "Paths.hpp"

#include <nlohmann/json.hpp>

namespace olc {

Platform currentPlatform() {
#if defined(_WIN32)
    return Platform::Windows;
#elif defined(__APPLE__)
    return Platform::MacOS;
#else
    return Platform::Linux;
#endif
}

std::string defaultDataDir(Platform platform, const EnvVars& env) {
    const std::string app = "obs-live-clock";
    if (!env.olcDataDir.empty()) return env.olcDataDir;
    switch (platform) {
    case Platform::Windows:
        return (env.appData.empty() ? env.home + "/AppData/Roaming" : env.appData) + "/" + app;
    case Platform::MacOS:
        return env.home + "/Library/Application Support/" + app;
    case Platform::Linux:
        return (env.xdgConfigHome.empty() ? env.home + "/.config" : env.xdgConfigHome) + "/" + app;
    }
    return env.home + "/" + app;
}

DataPaths dataPaths(const std::string& root) {
    return {root, root + "/settings.json", root + "/runtime.json", root + "/secret.token", root + "/launch.json"};
}

namespace {
std::optional<int> portOf(const nlohmann::json& doc) {
    if (!doc.is_object()) return std::nullopt;
    const auto it = doc.find("port");
    if (it == doc.end() || !it->is_number_integer()) return std::nullopt;
    const auto port = it->get<long long>();
    if (port < 1 || port > 65535) return std::nullopt;
    return static_cast<int>(port);
}
}  // namespace

std::optional<RuntimeInfo> parseRuntimeJson(std::string_view jsonText) {
    const auto doc = nlohmann::json::parse(jsonText.begin(), jsonText.end(), nullptr, false);
    const auto port = portOf(doc);
    if (!port) return std::nullopt;
    RuntimeInfo info;
    info.port = *port;
    if (const auto it = doc.find("instanceId"); it != doc.end() && it->is_string()) info.instanceId = it->get<std::string>();
    return info;
}

std::optional<int> parseSettingsPort(std::string_view jsonText) {
    return portOf(nlohmann::json::parse(jsonText.begin(), jsonText.end(), nullptr, false));
}

int resolvePort(const std::optional<RuntimeInfo>& runtime, std::optional<int> settingsPort) {
    if (runtime) return runtime->port;
    if (settingsPort) return *settingsPort;
    return kDefaultPort;
}

}  // namespace olc
