// SPDX-License-Identifier: GPL-2.0-or-later
#pragma once
#include <optional>
#include <string>
#include <string_view>

namespace olc {

enum class Platform { Windows, MacOS, Linux };
Platform currentPlatform();

/** The environment variables that decide where the app keeps its data. Empty = not set. */
struct EnvVars {
    std::string olcDataDir;     // OLC_DATA_DIR
    std::string appData;        // APPDATA (Windows)
    std::string xdgConfigHome;  // XDG_CONFIG_HOME (Linux)
    std::string home;           // user home directory
};

/** Mirror of server/src/app/paths.ts defaultDataDir(); a contract test pins both to the same vectors. */
std::string defaultDataDir(Platform platform, const EnvVars& env);

struct DataPaths {
    std::string root;
    std::string settings;  // settings.json (port)
    std::string runtime;   // runtime.json  (port, pid, instanceId; written once the app listens)
    std::string secret;    // secret.token  (bearer for /api/internal/*)
    std::string launch;    // launch.json   (written by the installer: how to start the app)
};
DataPaths dataPaths(const std::string& root);

inline constexpr int kDefaultPort = 4460;

struct RuntimeInfo {
    int port = 0;
    std::string instanceId;
};
/** runtime.json is a hint, never the truth: the port must be 1..65535, the rest may be missing. */
std::optional<RuntimeInfo> parseRuntimeJson(std::string_view jsonText);
std::optional<int> parseSettingsPort(std::string_view jsonText);
/** runtime.json port, else settings.json port, else 4460. */
int resolvePort(const std::optional<RuntimeInfo>& runtime, std::optional<int> settingsPort);

} // namespace olc
