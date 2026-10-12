// SPDX-License-Identifier: GPL-2.0-or-later
#pragma once
#include <cstdint>
#include <optional>
#include <string>
#include <vector>

#include "ObsWsConfig.hpp"
#include "PluginSettings.hpp"

namespace olc {

/** Whole-file read as UTF-8 bytes; nullopt when missing or unreadable. Safe from any thread. */
std::optional<std::string> readTextFile(const std::string& path);

/** Starts the app detached from OBS (it must survive OBS closing or crashing, SPEC §15). false = the OS refused. */
bool launchDetached(const LaunchSpec& spec);

/** Milliseconds on a monotonic clock. */
int64_t monotonicMs();

/** Path of obs-websocket's config.json inside OBS's config folder, "" when obs-websocket is not loaded. UI thread. */
std::string obsWebsocketConfigPath();

/** The pre-5.1 [OBSWebSocket] values from OBS's global.ini, when any are there. UI thread. */
std::optional<LegacyObsWsValues> readLegacyObsWsValues();

/** The OBS process' own command line (for --websocket_port / --websocket_password). UI thread. */
std::vector<std::string> commandLineArguments();

/** Where the app keeps its data (defaultDataDir with the real environment). */
std::string resolveDataDir();

}  // namespace olc
