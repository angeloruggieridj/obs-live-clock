// SPDX-License-Identifier: GPL-2.0-or-later
#include "Health.hpp"

#include <nlohmann/json.hpp>

namespace olc {

std::optional<HealthInfo> parseHealth(std::string_view body) {
    const auto doc = nlohmann::json::parse(body.begin(), body.end(), nullptr, false);
    if (!doc.is_object()) return std::nullopt;
    const auto version = doc.find("version");
    const auto protocol = doc.find("protocol");
    const auto instance = doc.find("instanceId");
    if (version == doc.end() || !version->is_string()) return std::nullopt;
    if (protocol == doc.end() || !protocol->is_number_integer()) return std::nullopt;
    if (instance == doc.end() || !instance->is_string() || instance->get<std::string>().empty()) return std::nullopt;
    HealthInfo info;
    info.version = version->get<std::string>();
    info.protocol = protocol->get<int>();
    info.instanceId = instance->get<std::string>();
    return info;
}

Compat checkProtocol(int appProtocol, int expected) {
    if (appProtocol == expected) return Compat::Ok;
    return appProtocol > expected ? Compat::AppNewer : Compat::AppOlder;
}

} // namespace olc
