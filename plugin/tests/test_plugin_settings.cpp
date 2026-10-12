// SPDX-License-Identifier: GPL-2.0-or-later
#include "doctest/doctest.h"

#include <nlohmann/json.hpp>

#include "PluginSettings.hpp"
#include "ScreenInfo.hpp"

using namespace olc;

TEST_CASE("normalizeRemoteUrl accepts http(s) host[:port][/prefix] and strips trailing slashes") {
    CHECK(normalizeRemoteUrl("http://studio-pc:4460") == "http://studio-pc:4460");
    CHECK(normalizeRemoteUrl("  https://clock.example.org/  ") == "https://clock.example.org");
    CHECK(normalizeRemoteUrl("http://192.168.1.20:4460//") == "http://192.168.1.20:4460");
    CHECK(normalizeRemoteUrl("https://example.org/olc") == "https://example.org/olc");
    CHECK(normalizeRemoteUrl("http://[::1]:4460") == "http://[::1]:4460");
}

TEST_CASE("normalizeRemoteUrl rejects anything that could surprise") {
    for (const char* bad : {"", "studio-pc:4460", "ftp://x", "http://", "http:///dock", "http://user:pw@host", "http://host:99999",
                            "http://host:abc", "http://host:", "http://host/a b", "http://host?x=1", "http://host#frag",
                            "http://:4460", "javascript:alert(1)"}) {
        CHECK_MESSAGE(!normalizeRemoteUrl(bad).has_value(), bad);
    }
}

TEST_CASE("settings round-trip and tolerate garbage") {
    PluginSettings s;
    s.mode = ServerMode::Remote;
    s.remoteUrl = "http://studio-pc:4460";
    s.appCommand = "D:/olc/obs-live-clock.exe";
    s.autoStart = false;
    CHECK(parsePluginSettings(serializePluginSettings(s)) == s);

    CHECK(parsePluginSettings("") == PluginSettings{});
    CHECK(parsePluginSettings("[1]") == PluginSettings{});
    const auto odd = parsePluginSettings(R"({"mode":7,"remoteUrl":5,"appCommand":false,"autoStart":"no"})");
    CHECK(odd == PluginSettings{});
}

TEST_CASE("an invalid remote URL is dropped but Remote mode stays: it never silently becomes local") {
    const auto s = parsePluginSettings(R"({"mode":"remote","remoteUrl":"not a url"})");
    CHECK(s.isRemote());
    CHECK(s.remoteUrl.empty());
    CHECK(dockUrl(s, 4460).empty());
    CHECK(apiBaseUrl(s, 4460).empty());
}

TEST_CASE("dockUrl points at the local port or the remote URL") {
    PluginSettings local;
    CHECK(dockUrl(local, 4461) == "http://127.0.0.1:4461/dock");
    CHECK(apiBaseUrl(local, 4461) == "http://127.0.0.1:4461");
    PluginSettings remote;
    remote.mode = ServerMode::Remote;
    remote.remoteUrl = "https://clock.example.org";
    CHECK(dockUrl(remote, 4461) == "https://clock.example.org/dock");
}

TEST_CASE("launch.json: command required, args and cwd optional, the settings command wins") {
    const auto spec = parseLaunchJson(R"({"command":" C:/olc/app.exe ","args":["--a",5,"--b"],"cwd":"C:/olc"})");
    REQUIRE(spec.has_value());
    CHECK(spec->command == "C:/olc/app.exe");
    CHECK(spec->args == std::vector<std::string>{"--a", "--b"});
    CHECK(spec->workingDir == "C:/olc");
    CHECK_FALSE(parseLaunchJson(R"({"args":[]})").has_value());
    CHECK_FALSE(parseLaunchJson(R"({"command":"  "})").has_value());
    CHECK_FALSE(parseLaunchJson("nope").has_value());

    PluginSettings s;
    CHECK(resolveLaunch(s, spec)->command == "C:/olc/app.exe");
    s.appCommand = "D:/mine.exe";
    CHECK(resolveLaunch(s, spec)->command == "D:/mine.exe");
    CHECK(resolveLaunch(s, spec)->args.empty());
    CHECK_FALSE(resolveLaunch(PluginSettings{}, std::nullopt).has_value());
}

TEST_CASE("screensToJson is the body the app's /api/internal/screens expects") {
    const auto body = nlohmann::json::parse(
        screensToJson({ScreenInfo{"\\\\.\\DISPLAY1", 0, 0, 1920, 1080, 1.25, true}, ScreenInfo{"\\\\.\\DISPLAY2", 1920, -100, 2560, 1440, 1.0, false}}));
    REQUIRE(body["screens"].size() == 2);
    CHECK(body["screens"][0]["name"] == "\\\\.\\DISPLAY1");
    CHECK(body["screens"][0]["primary"] == true);
    CHECK(body["screens"][0]["devicePixelRatio"] == 1.25);
    CHECK(body["screens"][1]["x"] == 1920);
    CHECK(body["screens"][1]["y"] == -100);
    CHECK(body["screens"][1]["width"] == 2560);
}
