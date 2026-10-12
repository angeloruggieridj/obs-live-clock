// SPDX-License-Identifier: GPL-2.0-or-later
#include "doctest/doctest.h"

#include <atomic>
#include <chrono>
#include <future>
#include <nlohmann/json.hpp>
#include <set>
#include <thread>

#include "ApiClient.hpp"
#include "HotkeyForwarder.hpp"
#include "HotkeySlots.hpp"
#include "support/fakes.hpp"

using namespace olc;
using namespace olc::testing;
using namespace std::chrono_literals;

namespace {
template <class Pred>
bool waitFor(Pred pred, std::chrono::milliseconds limit = 2000ms) {
    const auto end = std::chrono::steady_clock::now() + limit;
    while (std::chrono::steady_clock::now() < end) {
        if (pred()) return true;
        std::this_thread::sleep_for(2ms);
    }
    return pred();
}
}  // namespace

TEST_CASE("there are exactly 18 fixed slots with unique ids and unique OBS names") {
    const auto& slots = hotkeySlots();
    REQUIRE(slots.size() == 18);
    std::set<std::string> ids, names;
    for (const auto& s : slots) {
        ids.insert(s.id);
        names.insert(s.obsName);
        CHECK(s.description.rfind("OBS Live Clock: ", 0) == 0);
        CHECK(s.obsName.rfind("obs-live-clock.", 0) == 0);
    }
    CHECK(ids.size() == 18);
    CHECK(names.size() == 18);
}

TEST_CASE("slot ids and OBS names are frozen (OBS stores key bindings by name)") {
    const auto& s = hotkeySlots();
    CHECK(s[0].id == "message-1");
    CHECK(s[0].obsName == "obs-live-clock.message.1");
    CHECK(s[0].description == "OBS Live Clock: Messaggio 1");
    CHECK(s[11].id == "message-12");
    CHECK(s[12].id == "clear");
    CHECK(s[13].id == "next");
    CHECK(s[14].id == "prev");
    CHECK(s[15].id == "time-plus");
    CHECK(s[16].id == "time-minus");
    CHECK(s[17].id == "control-toggle");
    CHECK(s[17].obsName == "obs-live-clock.control.toggle");
}

TEST_CASE("only messages and CLEAR are immediate; the five emergency slots need confirmation") {
    for (const auto& s : hotkeySlots()) {
        const bool immediate = s.id.rfind("message-", 0) == 0 || s.id == "clear";
        CHECK(s.emergency == !immediate);
    }
    CHECK(findSlot("next")->emergency);
    CHECK(findSlot("nope") == nullptr);
}

TEST_CASE("postHotkey sends slot, session and seq with the bearer token and a short timeout") {
    FakeHttp http;
    ApiClient api(http, "http://127.0.0.1:4460", [] { return std::string("tok\r\n"); });
    api.postHotkey("next", "abc123", 7);
    const auto requests = http.requests();
    REQUIRE(requests.size() == 1);
    const auto& r = requests[0];
    CHECK(r.method == "POST");
    CHECK(r.url == "http://127.0.0.1:4460/api/internal/hotkey");
    CHECK(r.timeoutMs <= 2000);
    const auto body = nlohmann::json::parse(r.body);
    CHECK(body["slot"] == "next");
    CHECK(body["session"] == "abc123");
    CHECK(body["seq"] == 7);
    bool bearer = false;
    for (const auto& h : r.headers)
        if (h.first == "Authorization") bearer = h.second == "Bearer tok";
    CHECK(bearer);
}

TEST_CASE("health() is a GET without credentials") {
    FakeHttp http;
    ApiClient api(http, "http://127.0.0.1:4460/", [] { return std::string("tok"); });
    api.setBaseUrl("http://127.0.0.1:4461/");
    api.health();
    const auto r = http.requests().at(0);
    CHECK(r.method == "GET");
    CHECK(r.url == "http://127.0.0.1:4461/api/health");
    CHECK(r.headers.empty());
}

TEST_CASE("onPress returns immediately while the app hangs, and presses are sent once each, in order") {
    FakeHttp http;
    std::promise<void> release;
    auto gate = release.get_future().share();
    std::atomic<int> inFlight{0};
    http.setHandler([&](const HttpRequest&) {
        ++inFlight;
        gate.wait();  // the app is hung: every request would block until released
        return reply(200);
    });
    ApiClient api(http, "http://127.0.0.1:4460", [] { return std::string("tok"); });
    Dispatcher worker;
    HotkeyForwarder fwd(api, worker, nullptr, "sess");

    const auto t0 = std::chrono::steady_clock::now();
    CHECK(fwd.onPress("next"));
    CHECK(fwd.onPress("next"));
    CHECK(fwd.onPress("clear"));
    CHECK(std::chrono::steady_clock::now() - t0 < 100ms);

    REQUIRE(waitFor([&] { return inFlight.load() == 1; }));
    release.set_value();
    REQUIRE(waitFor([&] { return http.requests().size() == 3; }));
    const auto reqs = http.requests();
    CHECK(nlohmann::json::parse(reqs[0].body)["seq"] == 1);
    CHECK(nlohmann::json::parse(reqs[1].body)["seq"] == 2);
    CHECK(nlohmann::json::parse(reqs[2].body)["seq"] == 3);
    CHECK(nlohmann::json::parse(reqs[2].body)["slot"] == "clear");
    worker.stop();
}

TEST_CASE("a failed hotkey request is logged but never retried") {
    FakeHttp http;
    http.setHandler([](const HttpRequest&) { return unreachable(); });
    ApiClient api(http, "http://127.0.0.1:4460", [] { return std::string("tok"); });
    Dispatcher worker;
    std::mutex m;
    std::vector<std::string> lines;
    HotkeyForwarder fwd(api, worker, [&](const std::string& l) {
        std::lock_guard<std::mutex> lock(m);
        lines.push_back(l);
    });
    fwd.onPress("next");
    REQUIRE(waitFor([&] {
        std::lock_guard<std::mutex> lock(m);
        return !lines.empty();
    }));
    std::this_thread::sleep_for(100ms);
    CHECK(http.requests().size() == 1);
    CHECK(lines[0].find("next") != std::string::npos);
    CHECK(lines[0].find("tok") == std::string::npos);
    worker.stop();
}

TEST_CASE("an unknown slot is refused locally and a full queue drops the press") {
    FakeHttp http;
    ApiClient api(http, "http://127.0.0.1:4460", [] { return std::string("tok"); });
    Dispatcher worker(1);
    HotkeyForwarder fwd(api, worker, nullptr);
    CHECK_FALSE(fwd.onPress("bogus"));
    worker.stop();
    CHECK_FALSE(fwd.onPress("next"));
}

TEST_CASE("session ids are 16 hex characters and differ between runs") {
    const auto a = randomSessionId();
    const auto b = randomSessionId();
    CHECK(a.size() == 16);
    CHECK(a.find_first_not_of("0123456789abcdef") == std::string::npos);
    CHECK(a != b);
}
