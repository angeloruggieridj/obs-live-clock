// SPDX-License-Identifier: GPL-2.0-or-later
#pragma once
#include <atomic>
#include <chrono>
#include <cstddef>
#include <cstdint>
#include <functional>
#include <string>

#include "ApiClient.hpp"
#include "Dispatcher.hpp"

namespace olc {

/** 16 hex characters from std::random_device: tells the app which plugin run a press sequence belongs to. */
std::string randomSessionId();

/** Milliseconds from the monotonic clock. Injected into HotkeyForwarder so tests can drive the clock. */
int64_t steadyNowMs();

/**
 * Turns an OBS hotkey press into POST /api/internal/hotkey on a worker. onPress() is called on OBS's hotkey
 * thread and must return immediately: it only numbers the press and queues a job. Presses are sent in order, once
 * each, never retried. The double-press confirmation of emergency slots is decided by the APP, not here.
 *
 * A press whose job waited longer than kStalePressMs behind a hung request is dropped (logged and counted), never
 * sent: a press the operator made seconds ago must not confirm an emergency action late.
 */
class HotkeyForwarder {
public:
    using Log = std::function<void(const std::string&)>;
    using NowMs = std::function<int64_t()>;

    /** Presses queued longer than this behind a hung request are dropped when their job finally runs. */
    static constexpr int64_t kStalePressMs = 2000;

    HotkeyForwarder(ApiClient& api, Dispatcher& worker, Log log, std::string session = randomSessionId(),
                    NowMs now = steadyNowMs);

    /** false = the press was dropped (unknown slot, or the worker queue is full). */
    bool onPress(const std::string& slotId);

    const std::string& session() const { return session_; }

    /** Presses dropped because their queued job ran too late (older than kStalePressMs). */
    std::size_t staleDropped() const { return stale_.load(); }

private:
    ApiClient& api_;
    Dispatcher& worker_;
    Log log_;
    std::string session_;
    NowMs now_;
    std::atomic<uint64_t> seq_{0};
    std::atomic<std::size_t> stale_{0};
};

} // namespace olc
