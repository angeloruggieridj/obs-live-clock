// SPDX-License-Identifier: GPL-2.0-or-later
// The C++ side of the plugin <-> server contract. server/test/contract/plugin-contract.test.ts reads the same file.
#include "doctest/doctest.h"

#include <fstream>
#include <nlohmann/json.hpp>
#include <sstream>

#include "Health.hpp"
#include "HotkeySlots.hpp"
#include "Paths.hpp"

using namespace olc;

namespace {
nlohmann::json contract() {
    std::ifstream in(std::string(OLC_SOURCE_DIR) + "/contract/plugin-contract.json");
    REQUIRE_MESSAGE(in.good(), "plugin/contract/plugin-contract.json is missing");
    std::ostringstream ss;
    ss << in.rdbuf();
    return nlohmann::json::parse(ss.str());
}
Platform platformOf(const std::string& name) {
    if (name == "win32") return Platform::Windows;
    if (name == "darwin") return Platform::MacOS;
    return Platform::Linux;
}
}  // namespace

TEST_CASE("contract: the protocol version is the one the server speaks") {
    CHECK(contract()["protocol"].get<int>() == kProtocolVersion);
}

TEST_CASE("contract: the sample /api/health body parses and is compatible") {
    const auto c = contract();
    const auto health = parseHealth(c["health"].dump());
    REQUIRE(health.has_value());
    CHECK(checkProtocol(health->protocol) == Compat::Ok);
}

TEST_CASE("contract: the sample runtime.json parses") {
    const auto runtime = parseRuntimeJson(contract()["runtimeJson"].dump());
    REQUIRE(runtime.has_value());
    CHECK(runtime->port == 4460);
    CHECK(runtime->instanceId == "00000000-0000-4000-8000-000000000000");
}

TEST_CASE("contract: defaultDataDir gives the same folder as the server for every vector") {
    for (const auto& v : contract()["dataDirVectors"]) {
        EnvVars env;
        env.home = v["home"].get<std::string>();
        const auto& e = v["env"];
        if (e.contains("APPDATA")) env.appData = e["APPDATA"].get<std::string>();
        if (e.contains("XDG_CONFIG_HOME")) env.xdgConfigHome = e["XDG_CONFIG_HOME"].get<std::string>();
        if (e.contains("OLC_DATA_DIR")) env.olcDataDir = e["OLC_DATA_DIR"].get<std::string>();
        CHECK(defaultDataDir(platformOf(v["platform"].get<std::string>()), env) == v["expected"].get<std::string>());
    }
}

TEST_CASE("contract: the hotkey slot table is identical to the server's") {
    const auto c = contract();
    const auto& slots = hotkeySlots();
    REQUIRE(c["slots"].size() == slots.size());
    for (size_t i = 0; i < slots.size(); ++i) {
        const auto& j = c["slots"][i];
        CHECK(slots[i].id == j["id"].get<std::string>());
        CHECK(slots[i].obsName == j["obsName"].get<std::string>());
        CHECK(slots[i].description == j["description"].get<std::string>());
        CHECK(slots[i].emergency == j["emergency"].get<bool>());
    }
}
