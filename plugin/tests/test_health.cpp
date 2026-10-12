// SPDX-License-Identifier: GPL-2.0-or-later
#include "doctest/doctest.h"

#include <sstream>

#include "Health.hpp"
#include "Secret.hpp"

using namespace olc;

TEST_CASE("parseHealth reads the three fields of /api/health") {
    const auto h = parseHealth(R"({"version":"0.5.0","protocol":1,"instanceId":"2f1c"})");
    REQUIRE(h.has_value());
    CHECK(h->version == "0.5.0");
    CHECK(h->protocol == 1);
    CHECK(h->instanceId == "2f1c");
}

TEST_CASE("parseHealth rejects anything that is not our app") {
    CHECK_FALSE(parseHealth("").has_value());
    CHECK_FALSE(parseHealth("<html>nginx</html>").has_value());
    CHECK_FALSE(parseHealth("[]").has_value());
    CHECK_FALSE(parseHealth(R"({"version":"1","protocol":"1","instanceId":"x"})").has_value());
    CHECK_FALSE(parseHealth(R"({"version":"1","protocol":1})").has_value());
    CHECK_FALSE(parseHealth(R"({"version":"1","protocol":1,"instanceId":""})").has_value());
}

TEST_CASE("checkProtocol tells which side to update") {
    CHECK(checkProtocol(1, 1) == Compat::Ok);
    CHECK(checkProtocol(2, 1) == Compat::AppNewer);
    CHECK(checkProtocol(0, 1) == Compat::AppOlder);
    CHECK(kProtocolVersion == 1);
}

TEST_CASE("a Secret never shows its value when streamed or described") {
    const Secret s("hunter2-hunter2");
    CHECK(describe(s) == "<secret>");
    CHECK(describe(Secret()) == "<empty>");
    std::ostringstream os;
    os << s;
    CHECK(os.str().find("hunter2") == std::string::npos);
    CHECK(s.reveal() == "hunter2-hunter2");
    CHECK(s == Secret("hunter2-hunter2"));
}
