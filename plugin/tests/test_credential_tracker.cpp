// SPDX-License-Identifier: GPL-2.0-or-later
#include "doctest/doctest.h"

#include "CredentialTracker.hpp"

using namespace olc;

namespace {
ObsWsConfig config(const char* pw = "pw", int port = 4455) {
    ObsWsConfig c;
    c.serverEnabled = true;
    c.port = port;
    c.password = Secret(pw);
    return c;
}
HttpResponse answered(int status) {
    HttpResponse r;
    r.status = status;
    return r;
}
HttpResponse failed() {
    HttpResponse r;
    r.error = "timeout";
    return r;
}
}  // namespace

TEST_CASE("classifyDelivery maps HTTP answers to what the tracker needs") {
    CHECK(classifyDelivery(answered(204)) == DeliveryOutcome::Delivered);
    CHECK(classifyDelivery(answered(401)) == DeliveryOutcome::TokenRejected);
    CHECK(classifyDelivery(answered(403)) == DeliveryOutcome::Refused);
    CHECK(classifyDelivery(answered(400)) == DeliveryOutcome::Refused);
    CHECK(classifyDelivery(answered(404)) == DeliveryOutcome::Refused);
    CHECK(classifyDelivery(answered(503)) == DeliveryOutcome::TransportError);
    CHECK(classifyDelivery(failed()) == DeliveryOutcome::TransportError);
}

TEST_CASE("the first healthy probe is due, and once delivered nothing is due") {
    CredentialTracker t;
    CHECK(t.due(0, config(), "i1"));
    t.record(0, DeliveryOutcome::Delivered, config(), "i1");
    CHECK_FALSE(t.due(1'000, config(), "i1"));
    CHECK_FALSE(t.due(600'000, config(), "i1"));
}

TEST_CASE("a new instanceId (the app restarted) makes the delivery due again") {
    CredentialTracker t;
    t.record(0, DeliveryOutcome::Delivered, config(), "i1");
    CHECK(t.due(10, config(), "i2"));
}

TEST_CASE("a changed password or port in obs-websocket makes the delivery due again") {
    CredentialTracker t;
    t.record(0, DeliveryOutcome::Delivered, config("old"), "i1");
    CHECK(t.due(10, config("new"), "i1"));
    CHECK(t.due(10, config("old", 4466), "i1"));
}

TEST_CASE("a changed config or instanceId bypasses the retry backoff, the same data does not") {
    CredentialTracker t;
    t.record(1'000, DeliveryOutcome::TransportError, config(), "i1");  // backoff until 3'000 ms
    CHECK_FALSE(t.due(1'500, config(), "i1"));       // retrying the same data still waits
    CHECK(t.due(1'500, config("new"), "i1"));        // a changed password is delivered at once
    CHECK(t.due(1'500, config("pw", 4466), "i1"));   // a changed port is delivered at once
    CHECK(t.due(1'500, config(), "i2"));             // a new app instance is delivered at once
}

TEST_CASE("failures back off, then a delivery resets everything") {
    CredentialTracker t;
    t.record(1'000, DeliveryOutcome::TransportError, config(), "i1");
    CHECK_FALSE(t.due(2'999, config(), "i1"));
    CHECK(t.due(3'000, config(), "i1"));  // 2 s
    t.record(3'000, DeliveryOutcome::TransportError, config(), "i1");
    CHECK_FALSE(t.due(6'999, config(), "i1"));
    CHECK(t.due(7'000, config(), "i1"));  // 4 s
    CHECK(t.consecutiveFailures() == 2);
    t.record(7'000, DeliveryOutcome::Delivered, config(), "i1");
    CHECK(t.consecutiveFailures() == 0);
    CHECK_FALSE(t.due(7'001, config(), "i1"));
}

TEST_CASE("a rejected token is retried quickly, a refusal slowly") {
    CredentialTracker t;
    t.record(0, DeliveryOutcome::TokenRejected, config(), "i1");
    CHECK(t.due(1'000, config(), "i1"));
    CredentialTracker r;
    r.record(0, DeliveryOutcome::Refused, config(), "i1");
    CHECK_FALSE(r.due(29'999, config(), "i1"));
    CHECK(r.due(30'000, config(), "i1"));
}

TEST_CASE("the backoff is capped at 30 s however long the outage lasts") {
    CredentialTracker t;
    int64_t now = 0;
    for (int i = 0; i < 20; ++i) {
        t.record(now, DeliveryOutcome::TransportError, config(), "i1");
        now = t.retryAt();
    }
    t.record(now, DeliveryOutcome::TransportError, config(), "i1");
    CHECK(t.retryAt() - now == 30'000);
}

TEST_CASE("forget() makes the next healthy probe deliver again") {
    CredentialTracker t;
    t.record(0, DeliveryOutcome::Delivered, config(), "i1");
    t.forget();
    CHECK(t.due(1, config(), "i1"));
}
