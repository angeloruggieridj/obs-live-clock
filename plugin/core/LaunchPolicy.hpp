// SPDX-License-Identifier: GPL-2.0-or-later
#pragma once
#include <cstdint>
#include <vector>

namespace olc {

/** What one health probe saw. */
enum class HealthObservation { Ok, Incompatible, Unreachable };

enum class LaunchPhase {
    Checking,      // nothing observed yet
    Launching,     // we started the app and are waiting for it to answer
    Running,       // the app answered and is compatible
    Incompatible,  // the app answered but speaks another protocol: never launch, never deliver
    Unavailable,   // unreachable and we may not (or not yet) launch it: remote mode, cooldown, limit
    Failed,        // we launched it and it never answered within the budget
};

struct LaunchPolicyConfig {
    bool allowLaunch = true;                                     // false in remote mode or when auto start is off
    int64_t startupBudgetMs = 10'000;                            // TECH-DESIGN §3: retry up to 10 s
    std::vector<int> retryDelaysMs{250, 500, 1000, 1500, 2000};  // checks while Launching; the last one repeats
    int steadyIntervalMs = 5'000;                                // checks once Running, Unavailable or Failed
    int confirmIntervalMs = 2'000;                               // checks while a running app might have died
    int unreachableBeforeRelaunch = 4;                           // consecutive misses before "dead" (about 8 s)
    int64_t relaunchCooldownMs = 30'000;                         // never two launches closer than this
    int maxLaunches = 3;                                         // per plugin session
};

struct PolicyDecision {
    bool launch = false;    // start the app now (exactly once per true)
    int nextCheckInMs = 0;  // when to probe again
    LaunchPhase phase = LaunchPhase::Checking;
};

/**
 * Pure state machine behind the AppLauncher. It never starts anything itself: it says "launch" at most once
 * per launch window, so a slow start can never produce two processes (Review Focus 2).
 */
class LaunchPolicy {
public:
    explicit LaunchPolicy(LaunchPolicyConfig config = {});

    PolicyDecision onHealth(int64_t nowMs, HealthObservation observed);

    LaunchPhase phase() const { return phase_; }
    int launches() const { return launches_; }

    void setAllowLaunch(bool allow) { config_.allowLaunch = allow; }
    /** Settings changed: forget the past (launch count included) and start observing again. */
    void reset();

private:
    PolicyDecision tryLaunch(int64_t nowMs);
    int retryDelay(int attempt) const;

    LaunchPolicyConfig config_;
    LaunchPhase phase_ = LaunchPhase::Checking;
    int launches_ = 0;
    int attempt_ = 0;
    int unreachable_ = 0;
    int64_t lastLaunchAt_ = 0;
};

} // namespace olc
