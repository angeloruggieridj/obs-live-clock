// SPDX-License-Identifier: GPL-2.0-or-later
#include "doctest/doctest.h"

#include <nlohmann/json.hpp>

#include "ObsWsConfig.hpp"

using namespace olc;

TEST_CASE("parseObsWsConfig reads the file exactly as obs-websocket 5.x writes it") {
    // Shape verified on a real OBS 32.2.2 install (password replaced).
    const auto cfg = parseObsWsConfig(
        R"({"alerts_enabled":false,"auth_required":true,"first_load":false,"server_enabled":true,"server_password":"s3cret-pw","server_port":4455})");
    REQUIRE(cfg.has_value());
    CHECK(cfg->serverEnabled);
    CHECK(cfg->authRequired);
    CHECK(cfg->port == 4455);
    CHECK(cfg->password.reveal() == "s3cret-pw");
}

TEST_CASE("missing keys keep obs-websocket's own defaults") {
    const auto cfg = parseObsWsConfig("{}");
    REQUIRE(cfg.has_value());
    CHECK_FALSE(cfg->serverEnabled);
    CHECK(cfg->authRequired);
    CHECK(cfg->port == 4455);
    CHECK(cfg->password.empty());
}

TEST_CASE("wrongly typed keys and out-of-range ports are ignored, not trusted") {
    const auto cfg = parseObsWsConfig(R"({"server_enabled":"yes","server_port":70000,"auth_required":1,"server_password":42})");
    REQUIRE(cfg.has_value());
    CHECK_FALSE(cfg->serverEnabled);
    CHECK(cfg->port == 4455);
    CHECK(cfg->authRequired);
    CHECK(cfg->password.empty());
}

TEST_CASE("a corrupt or non-object file is nullopt") {
    CHECK_FALSE(parseObsWsConfig("").has_value());
    CHECK_FALSE(parseObsWsConfig("{\"server_port\": 44").has_value());
    CHECK_FALSE(parseObsWsConfig("[1,2]").has_value());
}

TEST_CASE("legacy global.ini values fill the same struct") {
    LegacyObsWsValues v;
    v.serverEnabled = true;
    v.port = 4466;
    v.authRequired = true;
    v.password = "old-pw";
    const auto cfg = fromLegacyValues(v);
    CHECK(cfg.serverEnabled);
    CHECK(cfg.port == 4466);
    CHECK(cfg.password.reveal() == "old-pw");
    CHECK(fromLegacyValues({}).port == 4455);
}

TEST_CASE("command line overrides win, like in obs-websocket") {
    ObsWsConfig base;
    base.serverEnabled = true;
    base.authRequired = false;
    SUBCASE("port, spaced and with equals") {
        CHECK(applyCommandLineOverrides(base, {"obs64.exe", "--websocket_port", "4466"}).port == 4466);
        CHECK(applyCommandLineOverrides(base, {"--websocket_port=4477"}).port == 4477);
        CHECK(applyCommandLineOverrides(base, {"-websocket_port=4488"}).port == 4488);
    }
    SUBCASE("an invalid port is ignored") {
        CHECK(applyCommandLineOverrides(base, {"--websocket_port", "99999"}).port == 4455);
        CHECK(applyCommandLineOverrides(base, {"--websocket_port", "abc"}).port == 4455);
        CHECK(applyCommandLineOverrides(base, {"--websocket_port"}).port == 4455);
    }
    SUBCASE("a password override turns authentication on") {
        const auto cfg = applyCommandLineOverrides(base, {"--websocket_password", "cli-pw"});
        CHECK(cfg.authRequired);
        CHECK(cfg.password.reveal() == "cli-pw");
    }
    SUBCASE("no arguments changes nothing") { CHECK(applyCommandLineOverrides(base, {}) == base); }
}

TEST_CASE("the credentials body carries host, port and the password only when authentication is on") {
    ObsWsConfig cfg;
    cfg.serverEnabled = true;
    cfg.port = 4455;
    cfg.password = Secret("pw");
    auto body = nlohmann::json::parse(buildCredentialsBody(cfg));
    CHECK(body["host"] == "127.0.0.1");
    CHECK(body["port"] == 4455);
    CHECK(body["password"] == "pw");

    cfg.authRequired = false;  // password still stored in the file, but OBS does not ask for it
    body = nlohmann::json::parse(buildCredentialsBody(cfg));
    CHECK_FALSE(body.contains("password"));

    cfg.authRequired = true;
    cfg.password = Secret();
    body = nlohmann::json::parse(buildCredentialsBody(cfg));
    CHECK_FALSE(body.contains("password"));
}

TEST_CASE("describe(config) is log-safe") {
    ObsWsConfig cfg;
    cfg.password = Secret("do-not-print-me");
    const auto line = describe(cfg);
    CHECK(line.find("do-not-print-me") == std::string::npos);
    CHECK(line.find("port=4455") != std::string::npos);
    CHECK(line.find("<secret>") != std::string::npos);
}

TEST_CASE("loadObsWsConfig: file first, legacy second, command line last, nothing readable = nullopt") {
    const auto file = [](const char* text) {
        return [text](const std::string&) -> std::optional<std::string> { return std::string(text); };
    };
    const auto missing = [](const std::string&) -> std::optional<std::string> { return std::nullopt; };
    LegacyObsWsValues legacy;
    legacy.port = 4466;
    legacy.serverEnabled = true;

    const auto fromFile = loadObsWsConfig(file(R"({"server_enabled":true,"server_port":4477})"), "p", legacy, {});
    REQUIRE(fromFile.has_value());
    CHECK(fromFile->port == 4477);

    const auto fromLegacy = loadObsWsConfig(missing, "p", legacy, {});
    REQUIRE(fromLegacy.has_value());
    CHECK(fromLegacy->port == 4466);

    const auto corruptFallsBack = loadObsWsConfig(file("{broken"), "p", legacy, {});
    REQUIRE(corruptFallsBack.has_value());
    CHECK(corruptFallsBack->port == 4466);

    CHECK_FALSE(loadObsWsConfig(missing, "p", std::nullopt, {}).has_value());
    CHECK_FALSE(loadObsWsConfig(file("{broken"), "p", std::nullopt, {}).has_value());

    const auto overridden = loadObsWsConfig(file(R"({"server_enabled":true})"), "p", std::nullopt, {"--websocket_port=4488"});
    REQUIRE(overridden.has_value());
    CHECK(overridden->port == 4488);
}
