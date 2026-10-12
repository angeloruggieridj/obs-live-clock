// SPDX-License-Identifier: GPL-2.0-or-later
#pragma once
#include <functional>
#include <optional>
#include <ostream>
#include <string>
#include <string_view>
#include <vector>

#include "Secret.hpp"

namespace olc {

/**
 * What obs-websocket 5.x stores. File: <OBS config>/plugin_config/obs-websocket/config.json, keys
 * server_enabled (bool), server_port (unsigned), auth_required (bool), server_password (string).
 * Defaults are obs-websocket's own (Config.h): ServerEnabled=false, port 4455, AuthRequired=true.
 */
struct ObsWsConfig {
    bool serverEnabled = false;
    int port = 4455;
    bool authRequired = true;
    Secret password;

    bool operator==(const ObsWsConfig& o) const {
        return serverEnabled == o.serverEnabled && port == o.port && authRequired == o.authRequired &&
               password == o.password;
    }
    bool operator!=(const ObsWsConfig& o) const { return !(*this == o); }
};

/** nullopt = the text is not a JSON object (a corrupt or half-written file). Wrongly typed keys keep the default. */
std::optional<ObsWsConfig> parseObsWsConfig(std::string_view jsonText);

/** Pre-5.1 location: [OBSWebSocket] in OBS's global.ini. The glue reads the four values, this fills the struct. */
struct LegacyObsWsValues {
    std::optional<bool> serverEnabled;   // ServerEnabled
    std::optional<int> port;             // ServerPort
    std::optional<bool> authRequired;    // AuthRequired
    std::optional<std::string> password; // ServerPassword
};
ObsWsConfig fromLegacyValues(const LegacyObsWsValues& values);

/**
 * obs-websocket lets the OBS command line win over the file: --websocket_port N (only when 1..65535) and
 * --websocket_password P (which also turns authentication on). Accepts "--name value", "--name=value" and the
 * single-dash spelling, like QCommandLineParser does.
 */
ObsWsConfig applyCommandLineOverrides(ObsWsConfig config, const std::vector<std::string>& args);

/**
 * The whole read: config.json first, else the legacy values (when the glue found any), then the command line.
 * nullopt = nothing readable (the file is missing or corrupt and there are no legacy values).
 */
std::optional<ObsWsConfig> loadObsWsConfig(const std::function<std::optional<std::string>(const std::string&)>& readFile,
                                           const std::string& configPath, const std::optional<LegacyObsWsValues>& legacy,
                                           const std::vector<std::string>& args);

/** One log-safe line: enabled/port/auth and the Secret marker, never the password. */
std::string describe(const ObsWsConfig& config);
inline std::ostream& operator<<(std::ostream& os, const ObsWsConfig& config) { return os << describe(config); }

/** JSON body for POST /api/internal/obs-credentials. The password is left out when authentication is off. */
std::string buildCredentialsBody(const ObsWsConfig& config);

} // namespace olc
