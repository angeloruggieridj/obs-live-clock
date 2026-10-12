// SPDX-License-Identifier: GPL-2.0-or-later
// olc-cli: drives the plugin's core against a real app, with no OBS. Used by server/test/contract.
//
//   olc-cli supervise --data-dir D --ws-config FILE [--screens FILE] [--seconds N] [--no-launch]
//       runs the Supervisor (health, credentials, screens) for N seconds and prints the final Status as JSON.
//   olc-cli hotkey --data-dir D --slot ID [--presses N] [--gap-ms M] [--session S]
//       sends N presses of one slot M milliseconds apart through HotkeyForwarder and prints one line per press.
#include <chrono>
#include <cstdio>
#include <cstdlib>
#include <fstream>
#include <iostream>
#include <map>
#include <nlohmann/json.hpp>
#include <sstream>
#include <thread>

#include "ApiClient.hpp"
#include "CurlHttp.hpp"
#include "Dispatcher.hpp"
#include "HotkeyForwarder.hpp"
#include "ObsWsConfig.hpp"
#include "Paths.hpp"
#include "ScreenInfo.hpp"
#include "Supervisor.hpp"

using namespace olc;

namespace {
std::optional<std::string> readFile(const std::string& path) {
    std::ifstream in(path, std::ios::binary);
    if (!in) return std::nullopt;
    std::ostringstream ss;
    ss << in.rdbuf();
    return ss.str();
}

int64_t nowMs() {
    using namespace std::chrono;
    return duration_cast<milliseconds>(steady_clock::now().time_since_epoch()).count();
}

std::map<std::string, std::string> parseArgs(int argc, char** argv) {
    std::map<std::string, std::string> out;
    for (int i = 2; i < argc; ++i) {
        const std::string a = argv[i];
        if (a.rfind("--", 0) != 0) continue;
        const std::string key = a.substr(2);
        if (i + 1 < argc && std::string(argv[i + 1]).rfind("--", 0) != 0) out[key] = argv[++i];
        else out[key] = "1";
    }
    return out;
}

const char* phaseName(LaunchPhase p) {
    switch (p) {
    case LaunchPhase::Checking: return "checking";
    case LaunchPhase::Launching: return "launching";
    case LaunchPhase::Running: return "running";
    case LaunchPhase::Incompatible: return "incompatible";
    case LaunchPhase::Unavailable: return "unavailable";
    case LaunchPhase::Failed: return "failed";
    }
    return "?";
}
const char* credName(CredentialState c) {
    switch (c) {
    case CredentialState::NotApplicable: return "not_applicable";
    case CredentialState::Delivered: return "delivered";
    case CredentialState::Failing: return "failing";
    case CredentialState::ServerDisabled: return "server_disabled";
    case CredentialState::ConfigUnreadable: return "config_unreadable";
    }
    return "?";
}

int supervise(const std::map<std::string, std::string>& args) {
    const std::string dataDir = args.at("data-dir");
    const std::string wsConfig = args.at("ws-config");
    std::vector<ScreenInfo> screens;
    if (const auto it = args.find("screens"); it != args.end()) {
        const auto doc = nlohmann::json::parse(readFile(it->second).value_or("[]"), nullptr, false);
        if (doc.is_array())
            for (const auto& s : doc)
                screens.push_back({s.value("name", ""), s.value("x", 0), s.value("y", 0), s.value("width", 0), s.value("height", 0),
                                   s.value("devicePixelRatio", 1.0), s.value("primary", false)});
    }
    CurlHttp http;
    SupervisorDeps deps{http, &nowMs, &readFile, [](const LaunchSpec&) { return false; },
                        [wsConfig] { return loadObsWsConfig(&readFile, wsConfig, std::nullopt, {}); },
                        [](const std::string& line) { std::cerr << "[log] " << line << "\n"; }, dataDir};
    PluginSettings settings;
    settings.autoStart = args.count("no-launch") == 0;
    Supervisor sup(std::move(deps), settings);
    sup.setScreens(screens);
    const int seconds = args.count("seconds") ? std::atoi(args.at("seconds").c_str()) : 3;
    const auto end = std::chrono::steady_clock::now() + std::chrono::seconds(seconds);
    while (std::chrono::steady_clock::now() < end) {
        sup.tick();
        std::this_thread::sleep_for(std::chrono::milliseconds(100));
    }
    const Status st = sup.status();
    std::cout << nlohmann::json{{"phase", phaseName(st.phase)}, {"credentials", credName(st.credentials)}, {"instanceId", st.instanceId},
                                {"port", st.port}, {"dockUrl", st.dockUrl}, {"version", st.appVersion}}.dump()
              << std::endl;
    return 0;
}

int hotkey(const std::map<std::string, std::string>& args) {
    const std::string dataDir = args.at("data-dir");
    const auto paths = dataPaths(dataDir);
    const int port = resolvePort(parseRuntimeJson(readFile(paths.runtime).value_or("")), parseSettingsPort(readFile(paths.settings).value_or("")));
    CurlHttp http;
    ApiClient api(http, "http://127.0.0.1:" + std::to_string(port), [paths] { return readFile(paths.secret).value_or(""); });
    const int presses = args.count("presses") ? std::atoi(args.at("presses").c_str()) : 1;
    const int gap = args.count("gap-ms") ? std::atoi(args.at("gap-ms").c_str()) : 300;
    const std::string session = args.count("session") ? args.at("session") : randomSessionId();
    uint64_t seq = 0;
    for (int i = 0; i < presses; ++i) {
        const auto r = api.postHotkey(args.at("slot"), session, ++seq);
        std::cout << nlohmann::json{{"status", r.status}, {"body", r.body}, {"error", r.error}}.dump() << std::endl;
        if (i + 1 < presses) std::this_thread::sleep_for(std::chrono::milliseconds(gap));
    }
    return 0;
}
}  // namespace

int main(int argc, char** argv) {
    if (argc < 2) {
        std::cerr << "usage: olc-cli supervise|hotkey ...\n";
        return 2;
    }
    try {
        const std::string cmd = argv[1];
        const auto args = parseArgs(argc, argv);
        if (cmd == "supervise") return supervise(args);
        if (cmd == "hotkey") return hotkey(args);
    } catch (const std::exception& e) {
        std::cerr << "error: " << e.what() << "\n";
        return 1;
    }
    std::cerr << "unknown command\n";
    return 2;
}
