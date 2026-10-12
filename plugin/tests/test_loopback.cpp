// SPDX-License-Identifier: GPL-2.0-or-later
#include "doctest/doctest.h"

#include "Loopback.hpp"

using namespace olc;

TEST_CASE("isLoopbackUrl accepts only the loopback hosts, not names that start with one") {
    // Accepted: 127.0.0.1, localhost or [::1], each followed by end, a port (':') or a path ('/').
    CHECK(isLoopbackUrl("http://127.0.0.1"));
    CHECK(isLoopbackUrl("http://127.0.0.1:4460"));
    CHECK(isLoopbackUrl("http://127.0.0.1/health"));
    CHECK(isLoopbackUrl("http://localhost"));
    CHECK(isLoopbackUrl("http://localhost:4460"));
    CHECK(isLoopbackUrl("http://localhost/health"));
    CHECK(isLoopbackUrl("http://[::1]"));
    CHECK(isLoopbackUrl("http://[::1]:4460"));
    CHECK(isLoopbackUrl("http://[::1]/health"));

    // Rejected: a host that merely starts with a loopback host.
    CHECK_FALSE(isLoopbackUrl("http://127.0.0.1.evil.com"));
    CHECK_FALSE(isLoopbackUrl("http://127.0.0.1.evil.com:4460"));
    CHECK_FALSE(isLoopbackUrl("http://127.0.0.1.evil.com/health"));
    CHECK_FALSE(isLoopbackUrl("http://localhost.evil.com"));
    CHECK_FALSE(isLoopbackUrl("http://localhost.evil.com:4460"));
    CHECK_FALSE(isLoopbackUrl("http://localhost.evil.com/health"));

    // Rejected: any other scheme, host or a bare prefix.
    CHECK_FALSE(isLoopbackUrl("https://127.0.0.1"));
    CHECK_FALSE(isLoopbackUrl("http://127.0.0.2"));
    CHECK_FALSE(isLoopbackUrl("http://localhost.localdomain"));
    CHECK_FALSE(isLoopbackUrl("http://localhostx"));
    CHECK_FALSE(isLoopbackUrl("http://"));
}
