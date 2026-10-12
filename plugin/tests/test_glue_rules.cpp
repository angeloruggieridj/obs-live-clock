// SPDX-License-Identifier: GPL-2.0-or-later
// Source-inspection tests for the OBS glue in src/, which cannot run without OBS. Each one pins a rule that keeps
// OBS's UI thread free and the secrets out of sight; the real behaviour is covered by the manual checklist in
// docs/TEST-PLAN.md. They read the sources as text, so keep the pinned fragments in step with the code.
#include "doctest/doctest.h"

#include <filesystem>
#include <fstream>
#include <iterator>
#include <string>

namespace {
std::string readSource(const std::string& relative) {
    std::ifstream input(std::string(OLC_SOURCE_DIR) + "/" + relative, std::ios::binary);
    return {std::istreambuf_iterator<char>(input), std::istreambuf_iterator<char>()};
}

/** Text of the function whose signature starts with `signature`, from its first '{' to the matching '}'. */
std::string bodyOf(const std::string& source, const std::string& signature) {
    const auto start = source.find(signature);
    if (start == std::string::npos) return {};
    const auto open = source.find('{', start);
    if (open == std::string::npos) return {};
    int depth = 0;
    for (auto i = open; i < source.size(); ++i) {
        if (source[i] == '{') ++depth;
        else if (source[i] == '}' && --depth == 0) return source.substr(open, i - open + 1);
    }
    return {};
}

bool has(const std::string& text, const std::string& fragment) { return text.find(fragment) != std::string::npos; }

std::vector<std::string> sourceFiles(const std::string& dir) {
    std::vector<std::string> out;
    for (const auto& entry : std::filesystem::directory_iterator(std::string(OLC_SOURCE_DIR) + "/" + dir)) {
        const auto ext = entry.path().extension().string();
        if (ext == ".cpp" || ext == ".hpp") out.push_back(dir + "/" + entry.path().filename().string());
    }
    return out;
}
}  // namespace

TEST_CASE("the OBS hotkey callback only numbers the press and queues it: no network, no waiting") {
    const auto body = bodyOf(readSource("src/HotkeyRegistrar.cpp"), "void HotkeyRegistrar::onHotkey(");
    REQUIRE_FALSE(body.empty());
    CHECK(has(body, "forwarder_.onPress("));
    for (const char* forbidden : {"perform(", "curl", "postHotkey", "sleep", "wait(", "exec(", "QProcess", ".join("}) CHECK_FALSE_MESSAGE(has(body, forbidden), forbidden);
    CHECK(has(body, "if (!pressed) return;"));  // the release callback is not a press
}

TEST_CASE("only the worker side calls the network: no glue file performs an HTTP request except through core jobs") {
    for (const auto& file : sourceFiles("src")) {
        if (file == "src/plugin-main.cpp") continue;
        const auto text = readSource(file);
        CHECK_MESSAGE(!has(text, ".perform("), file);
        CHECK_MESSAGE(!has(text, "curl_easy"), file);
    }
}

TEST_CASE("the app's status reaches the GUI thread through a queued call") {
    const auto controller = readSource("src/PluginController.cpp");
    const auto init = bodyOf(controller, "void PluginController::onFinishedLoading()");
    REQUIRE_FALSE(init.empty());
    CHECK(has(init, "QMetaObject::invokeMethod(this"));
    CHECK(has(init, "Qt::QueuedConnection"));
}

TEST_CASE("the dock is registered while modules load, never on FINISHED_LOADING (it would lose its saved place)") {
    const auto main = readSource("src/plugin-main.cpp");
    const auto post = bodyOf(main, "void obs_module_post_load(void)");
    REQUIRE_FALSE(post.empty());
    CHECK(has(post, "obs_frontend_add_dock_by_id"));
    const auto onEvent = bodyOf(main, "static void on_frontend_event(");
    REQUIRE_FALSE(onEvent.empty());
    CHECK_FALSE(has(onEvent, "obs_frontend_add_dock_by_id"));
    CHECK_FALSE(has(onEvent, "new olc::"));
}

TEST_CASE("everything stops before libobs goes away: the EXIT event shuts the controller down") {
    const auto onEvent = bodyOf(readSource("src/plugin-main.cpp"), "static void on_frontend_event(");
    CHECK(has(onEvent, "OBS_FRONTEND_EVENT_EXIT"));
    CHECK(has(onEvent, "shutdown()"));
}

TEST_CASE("a secret is read out of its wrapper in exactly one place") {
    // Secret::reveal() may appear in the wrapper itself, in the one function that builds the credentials body,
    // and in tests. Never in a log call, never in glue.
    for (const auto& file : sourceFiles("core")) {
        const auto text = readSource(file);
        if (file == "core/Secret.hpp" || file == "core/ObsWsConfig.cpp") continue;
        CHECK_MESSAGE(!has(text, "reveal()"), file);
    }
    for (const auto& file : sourceFiles("src")) CHECK_MESSAGE(!has(readSource(file), "reveal()"), file);
    for (const auto& file : sourceFiles("net")) CHECK_MESSAGE(!has(readSource(file), "reveal()"), file);
}

TEST_CASE("the app is launched with an argument list, never through a shell, and with no secret on the command line") {
    const auto adapters = readSource("src/SystemAdapters.cpp");
    const auto launch = bodyOf(adapters, "bool launchDetached(");
    REQUIRE_FALSE(launch.empty());
    CHECK(has(launch, "startDetached"));
    for (const char* forbidden : {"cmd.exe", "/c ", "system(", "sh -c", "password", "Secret"}) CHECK_FALSE_MESSAGE(has(launch, forbidden), forbidden);
}

TEST_CASE("log lines never carry request bodies or headers") {
    for (const auto& file : sourceFiles("core")) {
        const auto text = readSource(file);
        CHECK_MESSAGE(!has(text, "log(request.body"), file);
        CHECK_MESSAGE(!has(text, "log(\"Authorization"), file);
    }
    const auto curl = readSource("net/CurlHttp.cpp");
    CHECK_FALSE(has(curl, "blog("));
}
