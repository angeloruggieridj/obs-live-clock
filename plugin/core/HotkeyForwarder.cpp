// SPDX-License-Identifier: GPL-2.0-or-later
#include "HotkeyForwarder.hpp"

#include <cstdio>
#include <random>
#include <utility>

#include "HotkeySlots.hpp"

namespace olc {

std::string randomSessionId() {
    std::random_device rd;
    const uint64_t value = (static_cast<uint64_t>(rd()) << 32) ^ static_cast<uint64_t>(rd());
    char buf[17];
    std::snprintf(buf, sizeof buf, "%016llx", static_cast<unsigned long long>(value));
    return buf;
}

HotkeyForwarder::HotkeyForwarder(ApiClient& api, Dispatcher& worker, Log log, std::string session)
    : api_(api), worker_(worker), log_(std::move(log)), session_(std::move(session)) {}

bool HotkeyForwarder::onPress(const std::string& slotId) {
    if (findSlot(slotId) == nullptr) return false;
    const uint64_t seq = ++seq_;
    const bool queued = worker_.post([this, slotId, seq] {
        const HttpResponse response = api_.postHotkey(slotId, session_, seq);
        if (!response.answered()) {
            if (log_) log_("hotkey " + slotId + ": app not reachable (" + response.error + ")");
        } else if (response.status >= 300) {
            if (log_) log_("hotkey " + slotId + ": app answered HTTP " + std::to_string(response.status));
        }
    });
    if (!queued && log_) log_("hotkey " + slotId + ": dropped, the worker queue is full");
    return queued;
}

}  // namespace olc
