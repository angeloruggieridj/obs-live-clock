// SPDX-License-Identifier: GPL-2.0-or-later
#include "doctest/doctest.h"

#include "Paths.hpp"

using namespace olc;

TEST_CASE("defaultDataDir mirrors server/src/app/paths.ts") {
    EnvVars env;
    env.home = "/home/ann";
    SUBCASE("OLC_DATA_DIR wins everywhere") {
        env.olcDataDir = "/data/olc";
        CHECK(defaultDataDir(Platform::Windows, env) == "/data/olc");
        CHECK(defaultDataDir(Platform::MacOS, env) == "/data/olc");
        CHECK(defaultDataDir(Platform::Linux, env) == "/data/olc");
    }
    SUBCASE("Windows uses APPDATA, else <home>/AppData/Roaming") {
        env.appData = "C:\\Users\\ann\\AppData\\Roaming";
        CHECK(defaultDataDir(Platform::Windows, env) == "C:\\Users\\ann\\AppData\\Roaming/obs-live-clock");
        env.appData.clear();
        env.home = "C:/Users/ann";
        CHECK(defaultDataDir(Platform::Windows, env) == "C:/Users/ann/AppData/Roaming/obs-live-clock");
    }
    SUBCASE("macOS uses Application Support") {
        CHECK(defaultDataDir(Platform::MacOS, env) == "/home/ann/Library/Application Support/obs-live-clock");
    }
    SUBCASE("Linux uses XDG_CONFIG_HOME, else ~/.config") {
        CHECK(defaultDataDir(Platform::Linux, env) == "/home/ann/.config/obs-live-clock");
        env.xdgConfigHome = "/xdg";
        CHECK(defaultDataDir(Platform::Linux, env) == "/xdg/obs-live-clock");
    }
}

TEST_CASE("dataPaths names the four files the plugin reads") {
    const auto p = dataPaths("/d");
    CHECK(p.settings == "/d/settings.json");
    CHECK(p.runtime == "/d/runtime.json");
    CHECK(p.secret == "/d/secret.token");
    CHECK(p.launch == "/d/launch.json");
}

TEST_CASE("runtime.json: the port is required and validated, the rest is optional") {
    const auto ok = parseRuntimeJson(R"({"port":4461,"pid":99,"instanceId":"abc"})");
    REQUIRE(ok.has_value());
    CHECK(ok->port == 4461);
    CHECK(ok->instanceId == "abc");
    CHECK(parseRuntimeJson(R"({"port":4461})")->instanceId.empty());
    CHECK_FALSE(parseRuntimeJson(R"({"pid":1})").has_value());
    CHECK_FALSE(parseRuntimeJson(R"({"port":0})").has_value());
    CHECK_FALSE(parseRuntimeJson(R"({"port":70000})").has_value());
    CHECK_FALSE(parseRuntimeJson(R"({"port":"4461"})").has_value());
    CHECK_FALSE(parseRuntimeJson("not json").has_value());
    CHECK_FALSE(parseRuntimeJson("").has_value());
}

TEST_CASE("resolvePort: runtime.json, then settings.json, then 4460") {
    CHECK(resolvePort(RuntimeInfo{4461, "x"}, 4470) == 4461);
    CHECK(resolvePort(std::nullopt, 4470) == 4470);
    CHECK(resolvePort(std::nullopt, std::nullopt) == 4460);
    CHECK(parseSettingsPort(R"({"port":4470,"lanAccess":false})") == 4470);
    CHECK_FALSE(parseSettingsPort(R"({"lanAccess":false})").has_value());
}
