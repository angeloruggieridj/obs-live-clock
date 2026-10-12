// SPDX-License-Identifier: GPL-2.0-or-later
#include "ScreenInfo.hpp"

#include <nlohmann/json.hpp>

namespace olc {

std::string screensToJson(const std::vector<ScreenInfo>& screens) {
    nlohmann::json list = nlohmann::json::array();
    for (const auto& s : screens) {
        list.push_back({{"name", s.name},
                        {"x", s.x},
                        {"y", s.y},
                        {"width", s.width},
                        {"height", s.height},
                        {"devicePixelRatio", s.devicePixelRatio},
                        {"primary", s.primary}});
    }
    return nlohmann::json{{"screens", list}}.dump();
}

}  // namespace olc
