// SPDX-License-Identifier: GPL-2.0-or-later
#include "doctest/doctest.h"

#include <atomic>
#include <chrono>
#include <future>
#include <mutex>
#include <string>
#include <vector>

#include "Dispatcher.hpp"

using namespace olc;
using namespace std::chrono_literals;

namespace {
template <class Pred>
bool waitFor(Pred pred, std::chrono::milliseconds limit = 2000ms) {
    const auto end = std::chrono::steady_clock::now() + limit;
    while (std::chrono::steady_clock::now() < end) {
        if (pred()) return true;
        std::this_thread::sleep_for(2ms);
    }
    return pred();
}
}  // namespace

TEST_CASE("jobs run on another thread, in the order they were posted") {
    Dispatcher d;
    std::mutex m;
    std::vector<int> seen;
    std::atomic<bool> otherThread{false};
    const auto caller = std::this_thread::get_id();
    for (int i = 0; i < 10; ++i) {
        CHECK(d.post([&, i] {
            if (std::this_thread::get_id() != caller) otherThread = true;
            std::lock_guard<std::mutex> lock(m);
            seen.push_back(i);
        }));
    }
    CHECK(waitFor([&] {
        std::lock_guard<std::mutex> lock(m);
        return seen.size() == 10;
    }));
    CHECK(otherThread.load());
    for (int i = 0; i < 10; ++i) CHECK(seen[static_cast<size_t>(i)] == i);
}

TEST_CASE("post() returns at once even while a job blocks (the OBS thread must never wait)") {
    Dispatcher d;
    std::promise<void> release;
    auto gate = release.get_future().share();
    std::atomic<bool> started{false};
    d.post([&] {
        started = true;
        gate.wait();  // a hung HTTP call
    });
    REQUIRE(waitFor([&] { return started.load(); }));
    const auto t0 = std::chrono::steady_clock::now();
    for (int i = 0; i < 5; ++i) d.post([] {});
    const auto spent = std::chrono::steady_clock::now() - t0;
    CHECK(spent < 100ms);
    release.set_value();
}

TEST_CASE("a full queue drops new jobs and counts them instead of growing without bound") {
    Dispatcher d(2);
    std::promise<void> release;
    auto gate = release.get_future().share();
    std::atomic<bool> started{false};
    d.post([&] {
        started = true;
        gate.wait();
    });
    REQUIRE(waitFor([&] { return started.load(); }));
    CHECK(d.post([] {}));
    CHECK(d.post([] {}));
    CHECK_FALSE(d.post([] {}));
    CHECK(d.dropped() == 1);
    release.set_value();
}

TEST_CASE("a throwing job does not kill the worker") {
    Dispatcher d;
    d.post([] { throw 42; });
    std::atomic<bool> ran{false};
    d.post([&] { ran = true; });
    CHECK(waitFor([&] { return ran.load(); }));
}

TEST_CASE("jobs still queued when stop() is called are counted as dropped") {
    Dispatcher d;
    std::atomic<bool> started{false};
    d.post([&] {
        started = true;
        std::this_thread::sleep_for(200ms);
    });
    REQUIRE(waitFor([&] { return started.load(); }));
    CHECK(d.post([] {}));
    CHECK(d.post([] {}));
    CHECK(d.dropped() == 0);
    d.stop();
    CHECK(d.dropped() == 2);
}

TEST_CASE("stop() called from inside a job does not join the current thread") {
    Dispatcher d;
    std::atomic<bool> stopped{false};
    d.post([&] {
        d.stop();  // on the worker thread: must never join itself, nor terminate later
        stopped = true;
    });
    REQUIRE(waitFor([&] { return stopped.load(); }));
    std::this_thread::sleep_for(50ms);  // let the detached worker leave run() before d is destroyed
    d.stop();                           // idempotent, and the destructor must still be safe
}

TEST_CASE("stop() logs how many queued jobs it discarded") {
    std::mutex m;
    std::vector<std::string> lines;
    Dispatcher d(32, [&](const std::string& l) {
        std::lock_guard<std::mutex> lock(m);
        lines.push_back(l);
    });
    std::atomic<bool> started{false};
    d.post([&] {
        started = true;
        std::this_thread::sleep_for(200ms);
    });
    REQUIRE(waitFor([&] { return started.load(); }));
    CHECK(d.post([] {}));
    CHECK(d.post([] {}));
    d.stop();
    CHECK(d.dropped() == 2);
    std::lock_guard<std::mutex> lock(m);
    REQUIRE(lines.size() == 1);
    CHECK(lines[0].find("dropped") != std::string::npos);
    CHECK(lines[0].find('2') != std::string::npos);
}

TEST_CASE("stop() waits for the running job, drops the queue, and later posts are refused") {
    Dispatcher d;
    std::atomic<bool> started{false};
    std::atomic<bool> finished{false};
    std::atomic<int> queuedRan{0};
    d.post([&] {
        started = true;
        std::this_thread::sleep_for(100ms);
        finished = true;
    });
    REQUIRE(waitFor([&] { return started.load(); }));
    d.post([&] { ++queuedRan; });
    d.stop();
    CHECK(finished.load());
    CHECK(queuedRan.load() == 0);
    CHECK_FALSE(d.post([] {}));
    d.stop();  // idempotent
}
