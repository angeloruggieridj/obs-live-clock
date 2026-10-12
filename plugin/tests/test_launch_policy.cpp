// SPDX-License-Identifier: GPL-2.0-or-later
#include "doctest/doctest.h"

#include "LaunchPolicy.hpp"

using namespace olc;

namespace {
constexpr auto U = HealthObservation::Unreachable;
constexpr auto OK = HealthObservation::Ok;
}  // namespace

TEST_CASE("the first unreachable probe launches the app once and schedules a quick re-check") {
    LaunchPolicy p;
    const auto d = p.onHealth(0, U);
    CHECK(d.launch);
    CHECK(d.phase == LaunchPhase::Launching);
    CHECK(d.nextCheckInMs == 250);
    CHECK(p.launches() == 1);
}

TEST_CASE("a slow start never produces a second launch (double launch is the failure to avoid)") {
    LaunchPolicy p;
    int launches = p.onHealth(0, U).launch ? 1 : 0;
    std::vector<int> delays;
    int64_t t = 0;
    while (t + 250 < 10'000) {
        t += 250;
        const auto d = p.onHealth(t, U);
        if (d.launch) ++launches;
        delays.push_back(d.nextCheckInMs);
        CHECK(d.phase == LaunchPhase::Launching);
    }
    CHECK(launches == 1);
    // The delay schedule is 500, 1000, 1500, 2000, 2000, ... (the first 250 was returned with the launch).
    REQUIRE(delays.size() > 6);
    CHECK(delays[0] == 500);
    CHECK(delays[1] == 1000);
    CHECK(delays[2] == 1500);
    CHECK(delays[3] == 2000);
    CHECK(delays[4] == 2000);
    CHECK(delays[5] == 2000);
}

TEST_CASE("after the 10 s budget the policy gives up without launching again") {
    LaunchPolicy p;
    p.onHealth(0, U);
    const auto d = p.onHealth(10'000, U);
    CHECK_FALSE(d.launch);
    CHECK(d.phase == LaunchPhase::Failed);
    CHECK(d.nextCheckInMs == 5'000);
    CHECK_FALSE(p.onHealth(40'000, U).launch);
    CHECK(p.launches() == 1);
}

TEST_CASE("an answer after the launch means Running, with one launch on the books") {
    LaunchPolicy p;
    p.onHealth(0, U);
    p.onHealth(250, U);
    const auto d = p.onHealth(900, OK);
    CHECK(d.phase == LaunchPhase::Running);
    CHECK_FALSE(d.launch);
    CHECK(d.nextCheckInMs == 5'000);
    CHECK(p.launches() == 1);
}

TEST_CASE("an app that is already running is never launched") {
    LaunchPolicy p;
    CHECK_FALSE(p.onHealth(0, OK).launch);
    CHECK(p.launches() == 0);
}

TEST_CASE("a running app that disappears is relaunched only after four misses in a row") {
    LaunchPolicy p;
    p.onHealth(0, OK);
    CHECK_FALSE(p.onHealth(100'000, U).launch);
    CHECK_FALSE(p.onHealth(102'000, U).launch);
    CHECK_FALSE(p.onHealth(104'000, U).launch);
    const auto d = p.onHealth(106'000, U);
    CHECK(d.launch);
    CHECK(p.launches() == 1);
}

TEST_CASE("one answer in between resets the miss counter (a hiccup is not a death)") {
    LaunchPolicy p;
    p.onHealth(0, OK);
    p.onHealth(5'000, U);
    p.onHealth(7'000, U);
    p.onHealth(9'000, U);
    p.onHealth(11'000, OK);
    CHECK_FALSE(p.onHealth(16'000, U).launch);
    CHECK_FALSE(p.onHealth(18'000, U).launch);
    CHECK_FALSE(p.onHealth(20'000, U).launch);
}

TEST_CASE("the cooldown stops a crash loop from relaunching faster than every 30 s") {
    LaunchPolicy p;
    CHECK(p.onHealth(0, U).launch);   // launch #1 at t=0
    p.onHealth(1'000, OK);            // it came up
    p.onHealth(5'000, U);
    p.onHealth(7'000, U);
    p.onHealth(9'000, U);
    const auto early = p.onHealth(11'000, U);  // dead again, but only 11 s after the last launch
    CHECK_FALSE(early.launch);
    CHECK(early.phase == LaunchPhase::Unavailable);
    CHECK_FALSE(p.onHealth(20'000, U).launch);
    CHECK(p.onHealth(30'000, U).launch);  // the cooldown has passed: now it may
    CHECK(p.launches() == 2);
}

TEST_CASE("a plugin session launches the app at most three times") {
    LaunchPolicy p;
    int64_t t = 0;
    int launches = 0;
    for (int round = 0; round < 6; ++round) {
        if (p.onHealth(t, U).launch) ++launches;
        t += 1'000;
        p.onHealth(t, OK);  // each launch comes up, then dies
        for (int miss = 0; miss < 4; ++miss) {
            t += 35'000;
            if (p.onHealth(t, U).launch) ++launches;
        }
    }
    CHECK(launches == 3);
    CHECK(p.launches() == 3);
}

TEST_CASE("remote mode (launch not allowed) never launches and says Unavailable") {
    LaunchPolicyConfig cfg;
    cfg.allowLaunch = false;
    LaunchPolicy p(cfg);
    for (int i = 0; i < 10; ++i) {
        const auto d = p.onHealth(i * 5'000, U);
        CHECK_FALSE(d.launch);
        CHECK(d.phase == LaunchPhase::Unavailable);
    }
    CHECK(p.launches() == 0);
}

TEST_CASE("an incompatible app is never launched over and never counts as running") {
    LaunchPolicy p;
    const auto d = p.onHealth(0, HealthObservation::Incompatible);
    CHECK(d.phase == LaunchPhase::Incompatible);
    CHECK_FALSE(d.launch);
    CHECK(p.onHealth(5'000, OK).phase == LaunchPhase::Running);
}

TEST_CASE("reset forgets the launch count so a settings change can start over") {
    LaunchPolicy p;
    p.onHealth(0, U);
    p.onHealth(10'000, U);  // Failed
    p.reset();
    CHECK(p.phase() == LaunchPhase::Checking);
    CHECK(p.launches() == 0);
    CHECK(p.onHealth(20'000, U).launch);
}

TEST_CASE("reset during Launching never launches a second time") {
    LaunchPolicy p;
    CHECK(p.onHealth(0, U).launch);  // launch #1: the app is now booting
    p.reset();                       // the operator saves settings during the boot window
    CHECK(p.phase() == LaunchPhase::Launching);
    CHECK(p.launches() >= 1);
    CHECK_FALSE(p.onHealth(1'000, U).launch);  // the first process is still booting: no second one
    CHECK(p.launches() == 1);
}

TEST_CASE("repeated reset cannot bypass the launch cap") {
    LaunchPolicy p;
    int launches = 0;
    int64_t t = 0;
    // A settings save during every boot window tries to refund the launch count. The window keeps
    // it, so the resets cannot buy more processes than the cap of three allows.
    for (int i = 0; i < 30; ++i) {
        if (i > 0) p.reset();
        if (p.onHealth(t, U).launch) ++launches;
        t += 1'000;
    }
    CHECK(launches <= 3);
    CHECK(launches >= 1);
}
