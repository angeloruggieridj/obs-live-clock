// SPDX-License-Identifier: GPL-2.0-or-later
#pragma once
#include <optional>
#include <string>
#include <string_view>

namespace olc {

/** shared PROTOCOL_VERSION of the app this plugin was written for. A contract test pins it to the server. */
inline constexpr int kProtocolVersion = 1;

struct HealthInfo {
    std::string version;
    int protocol = 0;
    std::string instanceId;
};

/** Body of GET /api/health: {"version":"..","protocol":1,"instanceId":".."}. Anything else is not our app. */
std::optional<HealthInfo> parseHealth(std::string_view body);

enum class Compat { Ok, AppNewer, AppOlder };
Compat checkProtocol(int appProtocol, int expected = kProtocolVersion);

} // namespace olc
