// SPDX-License-Identifier: GPL-2.0-or-later
#include "doctest/doctest.h"

#include "Texts.hpp"

using namespace olc;

TEST_CASE("every message exists in Italian and English and is not empty") {
    for (size_t i = 0; i < static_cast<size_t>(Msg::COUNT_); ++i) {
        CHECK_MESSAGE(!text(Lang::It, static_cast<Msg>(i)).empty(), "it #" << i);
        CHECK_MESSAGE(!text(Lang::En, static_cast<Msg>(i)).empty(), "en #" << i);
    }
}

TEST_CASE("langFromLocale follows OBS locale names") {
    CHECK(langFromLocale("it-IT") == Lang::It);
    CHECK(langFromLocale("it_IT") == Lang::It);
    CHECK(langFromLocale("it") == Lang::It);
    CHECK(langFromLocale("en-US") == Lang::En);
    CHECK(langFromLocale("de-DE") == Lang::En);
    CHECK(langFromLocale("") == Lang::En);
    CHECK(langFromLocale("ita") == Lang::En);
}

TEST_CASE("describeStatus names the most important problem, and is empty when all is well") {
    Status ok;
    ok.phase = LaunchPhase::Running;
    ok.credentials = CredentialState::Delivered;
    CHECK(describeStatus(Lang::En, ok).empty());

    Status newer = ok;
    newer.compat = Compat::AppNewer;
    CHECK(describeStatus(Lang::En, newer) == text(Lang::En, Msg::StatusIncompatibleAppNewer));

    Status noSpec = ok;
    noSpec.phase = LaunchPhase::Failed;
    noSpec.launchSpecMissing = true;
    CHECK(describeStatus(Lang::It, noSpec) == text(Lang::It, Msg::LaunchSpecMissing));

    Status off = ok;
    off.credentials = CredentialState::ServerDisabled;
    CHECK(describeStatus(Lang::En, off) == text(Lang::En, Msg::CredentialsServerDisabled));

    Status remoteDown;
    remoteDown.phase = LaunchPhase::Unavailable;
    remoteDown.remote = true;
    CHECK(describeStatus(Lang::En, remoteDown) == text(Lang::En, Msg::StatusUnavailableRemote));
}
