// SPDX-License-Identifier: GPL-2.0-or-later
#pragma once
#include <chrono>
#include <condition_variable>
#include <functional>
#include <mutex>
#include <thread>

namespace olc {

/**
 * Calls `tick` on its own thread every `period` (measured start to start, so a slow tick does not stack up).
 * stop() wakes the thread at once and joins it; a tick that is running is waited for, so keep ticks short
 * (HTTP calls carry timeouts of 1.5 to 2 s). An exception in `tick` is swallowed: the loop must outlive it.
 */
class TickLoop {
public:
    TickLoop(std::function<void()> tick, std::chrono::milliseconds period);
    ~TickLoop();
    TickLoop(const TickLoop&) = delete;
    TickLoop& operator=(const TickLoop&) = delete;

    void stop();

private:
    void run();

    std::function<void()> tick_;
    std::chrono::milliseconds period_;
    std::mutex mutex_;
    std::condition_variable wake_;
    bool stopping_ = false;
    std::thread thread_;
};

} // namespace olc
