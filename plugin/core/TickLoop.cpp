// SPDX-License-Identifier: GPL-2.0-or-later
#include "TickLoop.hpp"

#include <utility>

#include "Waits.hpp"

namespace olc {

TickLoop::TickLoop(std::function<void()> tick, std::chrono::milliseconds period)
    : tick_(std::move(tick)), period_(period), thread_([this] { run(); }) {}

TickLoop::~TickLoop() { stop(); }

void TickLoop::stop() {
    {
        std::lock_guard<std::mutex> lock(mutex_);
        stopping_ = true;
    }
    wake_.notify_all();
    if (thread_.joinable() && thread_.get_id() != std::this_thread::get_id()) thread_.join();
}

void TickLoop::run() {
    auto next = std::chrono::steady_clock::now();
    for (;;) {
        {
            std::lock_guard<std::mutex> lock(mutex_);
            if (stopping_) return;
        }
        try {
            tick_();
        } catch (...) {
            // keep going
        }
        next += period_;
        const auto now = std::chrono::steady_clock::now();
        if (next < now) next = now;  // we fell behind: do not burst to catch up
        std::unique_lock<std::mutex> lock(mutex_);
        // Capped so a very long period can never hand libc++ a deadline it converts to a huge system time.
        if (wake_.wait_until(lock, cappedDeadline(next), [this] { return stopping_; })) return;
    }
}

}  // namespace olc
