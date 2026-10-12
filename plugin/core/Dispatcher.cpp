// SPDX-License-Identifier: GPL-2.0-or-later
#include "Dispatcher.hpp"

#include <utility>

namespace olc {

Dispatcher::Dispatcher(std::size_t maxQueue) : maxQueue_(maxQueue), thread_([this] { run(); }) {}

Dispatcher::~Dispatcher() { stop(); }

bool Dispatcher::post(std::function<void()> job) {
    {
        std::lock_guard<std::mutex> lock(mutex_);
        if (stopping_ || queue_.size() >= maxQueue_) {
            ++dropped_;
            return false;
        }
        queue_.push_back(std::move(job));
    }
    wake_.notify_one();
    return true;
}

std::size_t Dispatcher::queued() const {
    std::lock_guard<std::mutex> lock(mutex_);
    return queue_.size();
}

void Dispatcher::stop() {
    {
        std::lock_guard<std::mutex> lock(mutex_);
        stopping_ = true;
        queue_.clear();
    }
    wake_.notify_all();
    if (thread_.joinable() && thread_.get_id() != std::this_thread::get_id()) thread_.join();
}

void Dispatcher::run() {
    for (;;) {
        std::function<void()> job;
        {
            std::unique_lock<std::mutex> lock(mutex_);
            wake_.wait(lock, [this] { return stopping_ || !queue_.empty(); });
            if (stopping_) return;
            job = std::move(queue_.front());
            queue_.pop_front();
        }
        try {
            job();
        } catch (...) {
            // A failing job must never take the worker (and with it the hotkeys) down.
        }
    }
}

} // namespace olc
