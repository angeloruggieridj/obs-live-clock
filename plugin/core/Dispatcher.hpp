// SPDX-License-Identifier: GPL-2.0-or-later
#pragma once
#include <atomic>
#include <condition_variable>
#include <cstddef>
#include <deque>
#include <functional>
#include <mutex>
#include <thread>

namespace olc {

/**
 * One worker thread with a bounded FIFO queue. Everything that can block (HTTP, process start, file reads) runs
 * here, never on OBS's UI or hotkey thread (Review Focus 1). post() takes a mutex for a few instructions and
 * returns at once: false when the queue is full or the dispatcher stopped (the job is dropped, never waited for).
 */
class Dispatcher {
public:
    explicit Dispatcher(std::size_t maxQueue = 32);
    ~Dispatcher();
    Dispatcher(const Dispatcher&) = delete;
    Dispatcher& operator=(const Dispatcher&) = delete;

    bool post(std::function<void()> job);
    /** Stops the worker: waits for the job that is running, drops the ones still queued. Idempotent. */
    void stop();

    std::size_t dropped() const { return dropped_.load(); }
    std::size_t queued() const;

private:
    void run();

    const std::size_t maxQueue_;
    mutable std::mutex mutex_;
    std::condition_variable wake_;
    std::deque<std::function<void()>> queue_;
    bool stopping_ = false;
    std::atomic<std::size_t> dropped_{0};
    std::thread thread_;
};

} // namespace olc
