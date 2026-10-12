// SPDX-License-Identifier: GPL-2.0-or-later
#include "ObsWsConfig.hpp"

#include <charconv>
#include <nlohmann/json.hpp>

namespace olc {

namespace {
bool validPort(long long port) { return port >= 1 && port <= 65535; }

/** Value of option `name` in args, or nullopt. "--name v", "--name=v", "-name v" and "-name=v".
 *  Like QCommandLineParser, a repeated option keeps its LAST occurrence on the command line. */
std::optional<std::string> optionValue(const std::vector<std::string>& args, const std::string& name) {
    for (size_t i = args.size(); i-- > 0;) {
        for (const char* dashes : {"--", "-"}) {
            const std::string flag = std::string(dashes) + name;
            if (args[i] == flag) {
                if (i + 1 < args.size()) return args[i + 1];
                return std::nullopt;
            }
            if (args[i].rfind(flag + "=", 0) == 0) return args[i].substr(flag.size() + 1);
        }
    }
    return std::nullopt;
}
}  // namespace

std::optional<ObsWsConfig> parseObsWsConfig(std::string_view jsonText) {
    const auto doc = nlohmann::json::parse(jsonText.begin(), jsonText.end(), nullptr, false);
    if (!doc.is_object()) return std::nullopt;
    ObsWsConfig cfg;
    if (const auto it = doc.find("server_enabled"); it != doc.end() && it->is_boolean()) cfg.serverEnabled = it->get<bool>();
    if (const auto it = doc.find("server_port"); it != doc.end() && it->is_number_unsigned()) {
        const auto port = it->get<unsigned long long>();
        if (port >= 1 && port <= 65535) cfg.port = static_cast<int>(port);
    }
    if (const auto it = doc.find("auth_required"); it != doc.end() && it->is_boolean()) cfg.authRequired = it->get<bool>();
    if (const auto it = doc.find("server_password"); it != doc.end() && it->is_string()) {
        cfg.password = Secret(it->get<std::string>());
    }
    return cfg;
}

ObsWsConfig fromLegacyValues(const LegacyObsWsValues& values) {
    ObsWsConfig cfg;
    if (values.serverEnabled) cfg.serverEnabled = *values.serverEnabled;
    if (values.port && validPort(*values.port)) cfg.port = *values.port;
    if (values.authRequired) cfg.authRequired = *values.authRequired;
    if (values.password) cfg.password = Secret(*values.password);
    return cfg;
}

ObsWsConfig applyCommandLineOverrides(ObsWsConfig config, const std::vector<std::string>& args) {
    if (const auto port = optionValue(args, "websocket_port")) {
        long long parsed = 0;
        const auto* end = port->data() + port->size();
        const auto r = std::from_chars(port->data(), end, parsed);
        if (r.ec == std::errc() && r.ptr == end && validPort(parsed)) config.port = static_cast<int>(parsed);
    }
    if (const auto password = optionValue(args, "websocket_password"); password && !password->empty()) {
        config.authRequired = true;
        config.password = Secret(*password);
    }
    return config;
}

std::optional<ObsWsConfig> loadObsWsConfig(const std::function<std::optional<std::string>(const std::string&)>& readFile,
                                           const std::string& configPath, const std::optional<LegacyObsWsValues>& legacy,
                                           const std::vector<std::string>& args) {
    if (const auto text = readFile(configPath)) {
        if (const auto cfg = parseObsWsConfig(*text)) return applyCommandLineOverrides(*cfg, args);
    }
    if (legacy) return applyCommandLineOverrides(fromLegacyValues(*legacy), args);
    return std::nullopt;
}

std::string describe(const ObsWsConfig& config) {
    return std::string("obs-websocket{enabled=") + (config.serverEnabled ? "true" : "false") +
           ", port=" + std::to_string(config.port) + ", auth=" + (config.authRequired ? "true" : "false") +
           ", password=" + describe(config.password) + "}";
}

std::string buildCredentialsBody(const ObsWsConfig& config) {
    nlohmann::json body = {{"host", "127.0.0.1"}, {"port", config.port}};
    if (config.authRequired && !config.password.empty()) body["password"] = config.password.reveal();
    // The password can be Windows ANSI argv or a legacy global.ini value and so not valid UTF-8; replace the
    // bad bytes instead of throwing (nlohmann's strict handler would terminate the TickLoop/worker thread).
    return body.dump(-1, ' ', false, nlohmann::json::error_handler_t::replace);
}

}  // namespace olc
