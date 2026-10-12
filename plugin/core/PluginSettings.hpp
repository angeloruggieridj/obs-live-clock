// SPDX-License-Identifier: GPL-2.0-or-later
#pragma once
#include <optional>
#include <string>
#include <string_view>
#include <vector>

namespace olc {

enum class ServerMode { Local, Remote };

/** What the operator can set in OBS (Tools > OBS Live Clock). Stored as JSON in the plugin's OBS config folder. */
struct PluginSettings {
    ServerMode mode = ServerMode::Local;
    std::string remoteUrl;   // normalised; only meaningful when mode == Remote
    std::string appCommand;  // optional path of the app executable; empty = use launch.json
    bool autoStart = true;   // launch the app when OBS finishes loading and it does not answer

    bool operator==(const PluginSettings& o) const {
        return mode == o.mode && remoteUrl == o.remoteUrl && appCommand == o.appCommand && autoStart == o.autoStart;
    }
    bool operator!=(const PluginSettings& o) const { return !(*this == o); }
    /** Remote never falls back to local: with an invalid URL there is simply nothing to show or call. */
    bool isRemote() const { return mode == ServerMode::Remote; }
};

/** http(s)://host[:port][/prefix], no credentials, query or fragment; trailing slashes removed. */
std::optional<std::string> normalizeRemoteUrl(std::string_view text);

/** Tolerant: unreadable text gives the defaults; an invalid remote URL is dropped (mode stays Remote, URL empty). */
PluginSettings parsePluginSettings(std::string_view jsonText);
std::string serializePluginSettings(const PluginSettings& settings);

/** Base URL of the app's API: http://127.0.0.1:<port> locally, the remote URL otherwise ("" if the remote URL is invalid). */
std::string apiBaseUrl(const PluginSettings& settings, int localPort);
/** apiBaseUrl + "/dock"; "" when there is nothing valid to show. */
std::string dockUrl(const PluginSettings& settings, int localPort);

struct LaunchSpec {
    std::string command;
    std::vector<std::string> args;
    std::string workingDir;
};
/** launch.json: {"command":"C:/.../obs-live-clock.exe","args":["--x"],"cwd":"C:/..."} (written by the installer, Plan 7). */
std::optional<LaunchSpec> parseLaunchJson(std::string_view jsonText);
/** The settings' appCommand wins; else launch.json; else nullopt. */
std::optional<LaunchSpec> resolveLaunch(const PluginSettings& settings, const std::optional<LaunchSpec>& fromFile);

} // namespace olc
