// SPDX-License-Identifier: GPL-2.0-or-later
#pragma once
#include <atomic>
#include <cstdint>
#include <functional>
#include <string>

#include "ApiClient.hpp"
#include "Dispatcher.hpp"

namespace olc {

/** 16 hex characters from std::random_device: tells the app which plugin run a press sequence belongs to. */
std::string randomSessionId();

/**
 * Turns an OBS hotkey press into POST /api/internal/hotkey on a worker. onPress() is called on OBS's hotkey
 * thread and must return immediately: it only numbers the press and queues a job. Presses are sent in order, once
 * each, never retried. The double-press confirmation of emergency slots is decided by the APP, not here.
 */
class HotkeyForwarder {
public:
    using Log = std::function<void(const std::string&)>;

    HotkeyForwarder(ApiClient& api, Dispatcher& worker, Log log, std::string session = randomSessionId());

    /** false = the press was dropped (unknown slot, or the worker queue is full). */
    bool onPress(const std::string& slotId);

    const std::string& session() const { return session_; }

private:
    ApiClient& api_;
    Dispatcher& worker_;
    Log log_;
    std::string session_;
    std::atomic<uint64_t> seq_{0};
};

} // namespace olc
