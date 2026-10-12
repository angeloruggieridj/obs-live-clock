// SPDX-License-Identifier: GPL-2.0-or-later
#include "LaunchPolicy.hpp"

#include <algorithm>
#include <utility>

namespace olc {

LaunchPolicy::LaunchPolicy(LaunchPolicyConfig config) : config_(std::move(config)) {
    if (config_.retryDelaysMs.empty()) config_.retryDelaysMs = {1000};
}

void LaunchPolicy::reset() {
    if (phase_ == LaunchPhase::Launching) {
        // A settings save during the boot window must not forget the launch that is already in
        // flight: keep the phase, the attempt and the launch clock, and never refund the count.
        // Otherwise the next probe would launch a second process, and repeated resets would
        // bypass the cooldown and the launch cap.
        launches_ = std::max(launches_, 1);
        return;
    }
    phase_ = LaunchPhase::Checking;
    launches_ = 0;
    attempt_ = 0;
    unreachable_ = 0;
    lastLaunchAt_ = 0;
}

int LaunchPolicy::retryDelay(int attempt) const {
    const auto last = static_cast<int>(config_.retryDelaysMs.size()) - 1;
    return config_.retryDelaysMs[static_cast<size_t>(std::min(attempt, last))];
}

PolicyDecision LaunchPolicy::tryLaunch(int64_t nowMs) {
    const bool cooled = launches_ == 0 || nowMs - lastLaunchAt_ >= config_.relaunchCooldownMs;
    if (!config_.allowLaunch || launches_ >= config_.maxLaunches || !cooled) {
        phase_ = LaunchPhase::Unavailable;
        unreachable_ = 0;
        return {false, config_.steadyIntervalMs, phase_};
    }
    ++launches_;
    lastLaunchAt_ = nowMs;
    attempt_ = 1;  // the first delay is returned right now
    unreachable_ = 0;
    phase_ = LaunchPhase::Launching;
    return {true, retryDelay(0), phase_};
}

PolicyDecision LaunchPolicy::onHealth(int64_t nowMs, HealthObservation observed) {
    if (observed == HealthObservation::Ok) {
        phase_ = LaunchPhase::Running;
        unreachable_ = 0;
        attempt_ = 0;
        return {false, config_.steadyIntervalMs, phase_};
    }
    if (observed == HealthObservation::Incompatible) {
        phase_ = LaunchPhase::Incompatible;
        unreachable_ = 0;
        return {false, config_.steadyIntervalMs, phase_};
    }
    // Unreachable.
    switch (phase_) {
    case LaunchPhase::Launching:
        if (nowMs - lastLaunchAt_ >= config_.startupBudgetMs) {
            phase_ = LaunchPhase::Failed;
            return {false, config_.steadyIntervalMs, phase_};
        }
        return {false, retryDelay(attempt_++), phase_};
    case LaunchPhase::Failed:
        return {false, config_.steadyIntervalMs, phase_};
    case LaunchPhase::Running:
    case LaunchPhase::Incompatible:
        // An app we knew went away. One missed probe is not a death: wait for several in a row.
        if (++unreachable_ < config_.unreachableBeforeRelaunch) return {false, config_.confirmIntervalMs, phase_};
        return tryLaunch(nowMs);
    case LaunchPhase::Checking:
    case LaunchPhase::Unavailable:
        return tryLaunch(nowMs);
    }
    return {false, config_.steadyIntervalMs, phase_};
}

} // namespace olc
