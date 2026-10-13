// SPDX-License-Identifier: GPL-2.0-or-later
// libc++ (Apple Clang) turns a condition_variable deadline into an absolute system-clock time. A deadline
// near the clock's maximum overflows that conversion and the wait throws std::system_error(EINVAL), which
// aborted the whole test binary on macOS. Every wait must therefore be capped.
#include "doctest/doctest.h"

#include <chrono>
#include <condition_variable>
#include <mutex>
#include <thread>

#include "Waits.hpp"

using namespace olc;
using namespace std::chrono_literals;

TEST_CASE("a deadline further out than 24 h is capped, a nearer one is left alone") {
    using clock = std::chrono::steady_clock;
    const auto now = clock::now();
    CHECK(cappedDeadline(now + 5s) == now + 5s);
    const auto far = cappedDeadline(clock::time_point::max());
    CHECK(far <= clock::now() + maxWait);
    CHECK(far >= clock::now() + maxWait - 1s);
}

TEST_CASE("a wait with a very large duration does not throw") {
    std::condition_variable cv;
    std::mutex m;
    bool waiting = false;
    std::thread waiter([&] {
        std::unique_lock<std::mutex> lock(m);
        waiting = true;
        cv.notify_all();
        // The same near-maximum deadline libc++ chokes on; cappedDeadline makes it a legal 24 h wait.
        cv.wait_until(lock, cappedDeadline(std::chrono::steady_clock::time_point::max()));
    });
    {
        std::unique_lock<std::mutex> lock(m);
        while (!waiting) cv.wait_for(lock, 10ms, [&] { return waiting; });
    }
    cv.notify_all();
    waiter.join();
}
