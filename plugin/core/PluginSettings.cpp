// SPDX-License-Identifier: GPL-2.0-or-later
#include "PluginSettings.hpp"

#include <algorithm>
#include <cctype>
#include <nlohmann/json.hpp>

namespace olc {

namespace {
std::string trim(std::string s) {
    const auto notSpace = [](unsigned char c) { return !std::isspace(c); };
    s.erase(s.begin(), std::find_if(s.begin(), s.end(), notSpace));
    s.erase(std::find_if(s.rbegin(), s.rend(), notSpace).base(), s.end());
    return s;
}
}  // namespace

std::optional<std::string> normalizeRemoteUrl(std::string_view text) {
    std::string url = trim(std::string(text));
    std::string rest;
    if (url.rfind("http://", 0) == 0) rest = url.substr(7);
    else if (url.rfind("https://", 0) == 0) rest = url.substr(8);
    else return std::nullopt;
    if (rest.find_first_of("?# \t\r\n") != std::string::npos) return std::nullopt;
    const auto slash = rest.find('/');
    const std::string authority = rest.substr(0, slash);
    if (authority.empty() || authority.find('@') != std::string::npos) return std::nullopt;
    // host[:port] with a numeric port, or [ipv6][:port]
    const auto colon = authority.rfind(':');
    const bool bracketed = authority.front() == '[';
    if (colon != std::string::npos && (!bracketed || authority.find(']') < colon)) {
        const std::string port = authority.substr(colon + 1);
        // Never std::stoi here: an all-digit port longer than INT_MAX would throw out_of_range and escape into OBS.
        // Digits only and at most 5 of them, then the 1..65535 range check, so a bad port is simply rejected.
        if (port.empty() || port.size() > 5 ||
            !std::all_of(port.begin(), port.end(), [](unsigned char c) { return std::isdigit(c); }))
            return std::nullopt;
        int value = 0;
        for (const char digit : port) value = value * 10 + (digit - '0');
        if (value < 1 || value > 65535) return std::nullopt;
        if (colon == 0) return std::nullopt;
    }
    while (!url.empty() && url.back() == '/') url.pop_back();
    return url;
}

PluginSettings parsePluginSettings(std::string_view jsonText) {
    PluginSettings s;
    const auto doc = nlohmann::json::parse(jsonText.begin(), jsonText.end(), nullptr, false);
    if (!doc.is_object()) return s;
    if (const auto it = doc.find("mode"); it != doc.end() && it->is_string()) {
        if (it->get<std::string>() == "remote") s.mode = ServerMode::Remote;
    }
    if (const auto it = doc.find("remoteUrl"); it != doc.end() && it->is_string()) {
        if (const auto url = normalizeRemoteUrl(it->get<std::string>())) s.remoteUrl = *url;
    }
    if (const auto it = doc.find("appCommand"); it != doc.end() && it->is_string()) s.appCommand = trim(it->get<std::string>());
    if (const auto it = doc.find("autoStart"); it != doc.end() && it->is_boolean()) s.autoStart = it->get<bool>();
    return s;
}

std::string serializePluginSettings(const PluginSettings& s) {
    const nlohmann::json doc = {{"mode", s.mode == ServerMode::Remote ? "remote" : "local"},
                                {"remoteUrl", s.remoteUrl},
                                {"appCommand", s.appCommand},
                                {"autoStart", s.autoStart}};
    return doc.dump(2);
}

std::string apiBaseUrl(const PluginSettings& settings, int localPort) {
    if (settings.isRemote()) return settings.remoteUrl;
    return "http://127.0.0.1:" + std::to_string(localPort);
}

std::string dockUrl(const PluginSettings& settings, int localPort) {
    const std::string base = apiBaseUrl(settings, localPort);
    return base.empty() ? std::string() : base + "/dock";
}

std::optional<LaunchSpec> parseLaunchJson(std::string_view jsonText) {
    const auto doc = nlohmann::json::parse(jsonText.begin(), jsonText.end(), nullptr, false);
    if (!doc.is_object()) return std::nullopt;
    const auto command = doc.find("command");
    if (command == doc.end() || !command->is_string() || trim(command->get<std::string>()).empty()) return std::nullopt;
    LaunchSpec spec;
    spec.command = trim(command->get<std::string>());
    if (const auto it = doc.find("args"); it != doc.end() && it->is_array()) {
        for (const auto& arg : *it)
            if (arg.is_string()) spec.args.push_back(arg.get<std::string>());
    }
    if (const auto it = doc.find("cwd"); it != doc.end() && it->is_string()) spec.workingDir = it->get<std::string>();
    return spec;
}

std::optional<LaunchSpec> resolveLaunch(const PluginSettings& settings, const std::optional<LaunchSpec>& fromFile) {
    if (!settings.appCommand.empty()) {
        LaunchSpec spec;
        spec.command = settings.appCommand;
        return spec;
    }
    return fromFile;
}

}  // namespace olc
