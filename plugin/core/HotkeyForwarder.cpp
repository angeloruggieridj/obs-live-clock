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

int64_t steadyNowMs() {
    return std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::steady_clock::now().time_since_epoch())
        .count();
}

HotkeyForwarder::HotkeyForwarder(ApiClient& api, Dispatcher& worker, Log log, std::string session, NowMs now)
    : api_(api), worker_(worker), log_(std::move(log)), session_(std::move(session)), now_(std::move(now)) {}

bool HotkeyForwarder::onPress(const std::string& slotId) {
    if (findSlot(slotId) == nullptr) return false;
    const uint64_t seq = ++seq_;
    const int64_t enqueuedAt = now_ ? now_() : 0;
    const bool queued = worker_.post([this, slotId, seq, enqueuedAt] {
        const int64_t waited = (now_ ? now_() : enqueuedAt) - enqueuedAt;
        if (waited > kStalePressMs) {
            ++stale_;
            if (log_) log_("hotkey " + slotId + ": dropped, queued " + std::to_string(waited) + " ms behind a hung request");
            return;
        }
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
