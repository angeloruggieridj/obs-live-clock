// SPDX-License-Identifier: GPL-2.0-or-later
#pragma once
#include <chrono>

namespace olc {

// No wait should ever be longer than this. libc++ (Apple Clang) converts a condition_variable deadline into
// an absolute system-clock time; a deadline near the clock's maximum overflows that conversion and the wait
// throws std::system_error(EINVAL, "condition_variable wait failed"), which aborted the whole test binary on
// macOS. Capping every wait at 24 h keeps the deadline representable. Real periods (250 ms in production) are
// far below the cap, so normal waits are unchanged.
inline constexpr std::chrono::hours maxWait{24};

/** `deadline` trimmed to at most 24 h from now, so a condition_variable can never see a huge time point. */
inline std::chrono::steady_clock::time_point cappedDeadline(std::chrono::steady_clock::time_point deadline) {
    const auto cap = std::chrono::steady_clock::now() + maxWait;
    return deadline < cap ? deadline : cap;
}

}  // namespace olc
