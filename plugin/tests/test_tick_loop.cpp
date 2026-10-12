// SPDX-License-Identifier: GPL-2.0-or-later
#include "doctest/doctest.h"

#include <atomic>
#include <chrono>
#include <thread>

#include "TickLoop.hpp"

using namespace olc;
using namespace std::chrono_literals;

TEST_CASE("the loop ticks repeatedly on its own thread") {
    std::atomic<int> ticks{0};
    std::atomic<bool> otherThread{false};
    const auto caller = std::this_thread::get_id();
    TickLoop loop(
        [&] {
            ++ticks;
            if (std::this_thread::get_id() != caller) otherThread = true;
        },
        10ms);
    const auto end = std::chrono::steady_clock::now() + 2s;
    while (ticks.load() < 5 && std::chrono::steady_clock::now() < end) std::this_thread::sleep_for(5ms);
    CHECK(ticks.load() >= 5);
    CHECK(otherThread.load());
}

TEST_CASE("stop() returns promptly even with a long period, and no tick runs afterwards") {
    std::atomic<int> ticks{0};
    TickLoop loop([&] { ++ticks; }, 60s);
    std::this_thread::sleep_for(50ms);
    const auto t0 = std::chrono::steady_clock::now();
    loop.stop();
    CHECK(std::chrono::steady_clock::now() - t0 < 500ms);
    const int after = ticks.load();
    std::this_thread::sleep_for(50ms);
    CHECK(ticks.load() == after);
    loop.stop();  // idempotent
}

TEST_CASE("a throwing tick does not end the loop") {
    std::atomic<int> ticks{0};
    TickLoop loop(
        [&] {
            if (++ticks == 1) throw 7;
        },
        10ms);
    const auto end = std::chrono::steady_clock::now() + 2s;
    while (ticks.load() < 3 && std::chrono::steady_clock::now() < end) std::this_thread::sleep_for(5ms);
    CHECK(ticks.load() >= 3);
}
