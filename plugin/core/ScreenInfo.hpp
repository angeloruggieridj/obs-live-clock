// SPDX-License-Identifier: GPL-2.0-or-later
#pragma once
#include <string>
#include <vector>

namespace olc {

/** One monitor as Qt reports it (QScreen). Sent to the app so the kiosk can open on the right one. */
struct ScreenInfo {
    std::string name;  // QScreen::name(), e.g. "\\\\.\\DISPLAY2"
    int x = 0;
    int y = 0;
    int width = 0;
    int height = 0;
    double devicePixelRatio = 1.0;
    bool primary = false;

    bool operator==(const ScreenInfo& o) const {
        return name == o.name && x == o.x && y == o.y && width == o.width && height == o.height &&
               devicePixelRatio == o.devicePixelRatio && primary == o.primary;
    }
};

/** Body of POST /api/internal/screens: {"screens":[{"name","x","y","width","height","devicePixelRatio","primary"}]}. */
std::string screensToJson(const std::vector<ScreenInfo>& screens);

} // namespace olc
