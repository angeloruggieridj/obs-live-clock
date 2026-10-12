// SPDX-License-Identifier: GPL-2.0-or-later
#include "doctest/doctest.h"

#include <map>
#include <nlohmann/json.hpp>

#include "Supervisor.hpp"
#include "support/fakes.hpp"

using namespace olc;
using namespace olc::testing;

namespace {

const char* kPassword = "pw-must-never-leak-42";

struct Harness {
    FakeHttp http;
    int64_t now = 1'000;
    std::map<std::string, std::string> files;
    std::vector<std::string> logs;
    std::vector<LaunchSpec> launched;
    bool launchOk = true;
    bool appUp = false;
    int protocol = 1;
    std::string instance = "inst-1";
    int credentialsStatus = 204;
    int screensStatus = 204;
    std::optional<ObsWsConfig> obsWs;
    std::vector<Status> statuses;
    std::unique_ptr<Supervisor> sup;

    explicit Harness(PluginSettings settings = {}) {
        ObsWsConfig cfg;
        cfg.serverEnabled = true;
        cfg.port = 4455;
        cfg.password = Secret(kPassword);
        obsWs = cfg;
        files["/data/secret.token"] = "tok-123\n";
        files["/data/launch.json"] = R"({"command":"C:/app/obs-live-clock.exe","args":["--headless"]})";
        http.setHandler([this](const HttpRequest& r) {
            if (r.url.find("/api/health") != std::string::npos) {
                if (!appUp) return unreachable();
                return reply(200, nlohmann::json{{"version", "0.6.0"}, {"protocol", protocol}, {"instanceId", instance}}.dump());
            }
            if (r.url.find("/obs-credentials") != std::string::npos) return reply(credentialsStatus);
            if (r.url.find("/screens") != std::string::npos) return reply(screensStatus);
            return reply(404);
        });
        SupervisorDeps deps{http,
                            [this] { return now; },
                            [this](const std::string& p) -> std::optional<std::string> {
                                const auto it = files.find(p);
                                if (it == files.end()) return std::nullopt;
                                return it->second;
                            },
                            [this](const LaunchSpec& s) {
                                launched.push_back(s);
                                return launchOk;
                            },
                            [this] { return obsWs; },
                            [this](const std::string& l) { logs.push_back(l); },
                            "/data"};
        sup = std::make_unique<Supervisor>(std::move(deps), settings);
        sup->setOnStatus([this](const Status& s) { statuses.push_back(s); });
    }

    /** Ticks every 250 ms for `ms` of fake time. */
    void run(int64_t ms) {
        const auto end = now + ms;
        while (now < end) {
            sup->tick();
            now += 250;
        }
    }
    std::vector<HttpRequest> posts(const std::string& part) const { return http.requestsTo(part); }
    /** Every place a secret must not appear: logs, URLs, launch commands, and (optionally) headers. */
    std::string everything(bool withHeaders = true) const {
        std::string all;
        for (const auto& l : logs) all += l + "\n";
        for (const auto& r : http.requests()) {
            all += r.url + "\n";
            if (withHeaders)
                for (const auto& h : r.headers) all += h.first + h.second + "\n";
        }
        for (const auto& s : launched) {
            all += s.command + s.workingDir;
            for (const auto& a : s.args) all += a;
        }
        return all;
    }
};

}  // namespace

TEST_CASE("a healthy app gets the credentials once, with the bearer token and the password only in the body") {
    Harness h;
    h.appUp = true;
    h.run(3'000);
    const auto posts = h.posts("/obs-credentials");
    REQUIRE(posts.size() == 1);
    CHECK(posts[0].method == "POST");
    CHECK(posts[0].url == "http://127.0.0.1:4460/api/internal/obs-credentials");
    bool bearer = false;
    for (const auto& hd : posts[0].headers)
        if (hd.first == "Authorization") bearer = hd.second == "Bearer tok-123";
    CHECK(bearer);
    const auto body = nlohmann::json::parse(posts[0].body);
    CHECK(body["port"] == 4455);
    CHECK(body["password"] == kPassword);
    CHECK(h.launched.empty());
    CHECK(h.sup->status().credentials == CredentialState::Delivered);
    CHECK(h.sup->status().phase == LaunchPhase::Running);
    CHECK(h.sup->status().appVersion == "0.6.0");
}

TEST_CASE("the password never appears in a log line, a URL, a header or a launch command") {
    Harness h;
    h.run(2'000);        // app down: it is launched
    h.appUp = true;
    h.run(8'000);        // up: credentials delivered
    h.instance = "inst-2";
    h.run(8'000);        // restarted: delivered again
    h.credentialsStatus = 500;
    h.obsWs->password = Secret(std::string(kPassword) + "-changed");
    h.run(10'000);       // failing deliveries
    REQUIRE_FALSE(h.posts("/obs-credentials").empty());
    CHECK(h.everything().find("pw-must-never-leak") == std::string::npos);
    // The bearer token belongs in the Authorization header and nowhere else.
    CHECK(h.everything(false).find("tok-123") == std::string::npos);
}

TEST_CASE("when the app does not answer it is launched exactly once, then the credentials follow") {
    Harness h;
    h.run(4'000);
    REQUIRE(h.launched.size() == 1);
    CHECK(h.launched[0].command == "C:/app/obs-live-clock.exe");
    CHECK(h.launched[0].args == std::vector<std::string>{"--headless"});
    CHECK(h.posts("/obs-credentials").empty());
    CHECK(h.sup->status().phase == LaunchPhase::Launching);
    h.appUp = true;
    h.run(3'000);
    CHECK(h.launched.size() == 1);
    CHECK(h.posts("/obs-credentials").size() == 1);
    CHECK(h.sup->status().phase == LaunchPhase::Running);
}

TEST_CASE("an app that is slow to start (9 s) is still launched only once") {
    Harness h;
    h.run(9'000);
    h.appUp = true;
    h.run(2'000);
    CHECK(h.launched.size() == 1);
    CHECK(h.sup->status().phase == LaunchPhase::Running);
}

TEST_CASE("an app that never starts ends as Failed after about 10 s, without a second launch") {
    Harness h;
    h.run(30'000);
    CHECK(h.launched.size() == 1);
    CHECK(h.sup->status().phase == LaunchPhase::Failed);
}

TEST_CASE("the settings' app command wins over launch.json") {
    PluginSettings s;
    s.appCommand = "D:/custom/olc.exe";
    Harness h(s);
    h.run(500);
    REQUIRE(h.launched.size() == 1);
    CHECK(h.launched[0].command == "D:/custom/olc.exe");
    CHECK(h.launched[0].args.empty());
}

TEST_CASE("no launch command anywhere: nothing is started and the status says why") {
    Harness h;
    h.files.erase("/data/launch.json");
    h.run(1'000);
    CHECK(h.launched.empty());
    CHECK(h.sup->status().launchSpecMissing);
}

TEST_CASE("a command the OS refuses to start is reported") {
    Harness h;
    h.launchOk = false;
    h.run(500);
    CHECK(h.launched.size() == 1);
    CHECK(h.sup->status().launchFailed);
}

TEST_CASE("auto start off: the app is never launched") {
    PluginSettings s;
    s.autoStart = false;
    Harness h(s);
    h.run(20'000);
    CHECK(h.launched.empty());
    CHECK(h.sup->status().phase == LaunchPhase::Unavailable);
}

TEST_CASE("remote mode never launches and never hands over credentials or screens, and shows the remote dock") {
    PluginSettings s;
    s.mode = ServerMode::Remote;
    s.remoteUrl = "http://studio-pc.local:4460";
    Harness h(s);
    h.appUp = true;
    h.sup->setScreens({ScreenInfo{"DISPLAY1", 0, 0, 1920, 1080, 1.0, true}});
    h.run(8'000);
    CHECK(h.launched.empty());
    CHECK(h.posts("/obs-credentials").empty());
    CHECK(h.posts("/screens").empty());
    CHECK(h.sup->status().remote);
    CHECK(h.sup->status().dockUrl == "http://studio-pc.local:4460/dock");
    CHECK(h.sup->status().credentials == CredentialState::NotApplicable);
    for (const auto& r : h.http.requests()) CHECK(r.url.rfind("http://studio-pc.local:4460", 0) == 0);
}

TEST_CASE("remote mode with an unreachable app only waits (no launch, Unavailable)") {
    PluginSettings s;
    s.mode = ServerMode::Remote;
    s.remoteUrl = "https://clock.example.org";
    Harness h(s);
    h.run(20'000);
    CHECK(h.launched.empty());
    CHECK(h.sup->status().phase == LaunchPhase::Unavailable);
}

TEST_CASE("remote mode with an invalid URL calls nothing") {
    PluginSettings s;
    s.mode = ServerMode::Remote;
    s.remoteUrl = "";
    Harness h(s);
    h.run(5'000);
    CHECK(h.http.requests().empty());
    CHECK(h.sup->status().dockUrl.empty());
}

TEST_CASE("a new instanceId (the app restarted) delivers credentials and screens again") {
    Harness h;
    h.appUp = true;
    h.sup->setScreens({ScreenInfo{"DISPLAY1", 0, 0, 1920, 1080, 1.0, true}});
    h.run(6'000);
    CHECK(h.posts("/obs-credentials").size() == 1);
    CHECK(h.posts("/screens").size() == 1);
    h.instance = "inst-2";
    h.run(6'000);
    CHECK(h.posts("/obs-credentials").size() == 2);
    CHECK(h.posts("/screens").size() == 2);
}

TEST_CASE("a password changed in OBS while it runs is delivered again without any restart") {
    Harness h;
    h.appUp = true;
    h.run(6'000);
    h.obsWs->password = Secret("new-password");
    h.run(6'000);
    const auto posts = h.posts("/obs-credentials");
    REQUIRE(posts.size() == 2);
    CHECK(nlohmann::json::parse(posts[1].body)["password"] == "new-password");
}

TEST_CASE("obs-websocket server switched off: nothing is delivered and the status says so") {
    Harness h;
    h.appUp = true;
    h.obsWs->serverEnabled = false;
    h.run(6'000);
    CHECK(h.posts("/obs-credentials").empty());
    CHECK(h.sup->status().credentials == CredentialState::ServerDisabled);
}

TEST_CASE("an unreadable obs-websocket config is reported, not guessed") {
    Harness h;
    h.appUp = true;
    h.obsWs.reset();
    h.run(6'000);
    CHECK(h.posts("/obs-credentials").empty());
    CHECK(h.sup->status().credentials == CredentialState::ConfigUnreadable);
}

TEST_CASE("authentication switched off: the body has no password") {
    Harness h;
    h.appUp = true;
    h.obsWs->authRequired = false;
    h.run(3'000);
    const auto posts = h.posts("/obs-credentials");
    REQUIRE(posts.size() == 1);
    CHECK_FALSE(nlohmann::json::parse(posts[0].body).contains("password"));
}

TEST_CASE("a rejected token is retried within a couple of seconds, not after the 5 s health interval") {
    Harness h;
    h.appUp = true;
    h.credentialsStatus = 401;
    h.run(250);
    CHECK(h.posts("/obs-credentials").size() == 1);
    h.files["/data/secret.token"] = "tok-new";
    h.credentialsStatus = 204;
    h.run(2'000);
    const auto posts = h.posts("/obs-credentials");
    REQUIRE(posts.size() == 2);
    bool bearer = false;
    for (const auto& hd : posts[1].headers)
        if (hd.first == "Authorization") bearer = hd.second == "Bearer tok-new";
    CHECK(bearer);
    CHECK(h.sup->status().credentials == CredentialState::Delivered);
}

TEST_CASE("an incompatible protocol is reported and nothing is delivered or launched") {
    Harness h;
    h.appUp = true;
    h.protocol = 2;
    h.run(8'000);
    CHECK(h.sup->status().phase == LaunchPhase::Incompatible);
    CHECK(h.sup->status().compat == Compat::AppNewer);
    CHECK(h.posts("/obs-credentials").empty());
    CHECK(h.launched.empty());
}

TEST_CASE("something else on the port is not our app: it is treated as down, once-logged") {
    Harness h;
    h.http.setHandler([](const HttpRequest&) { return reply(200, "<html>hello</html>"); });
    h.run(1'000);
    CHECK(h.launched.size() == 1);
    int notOurs = 0;
    for (const auto& l : h.logs)
        if (l.find("not OBS Live Clock") != std::string::npos) ++notOurs;
    CHECK(notOurs == 1);
}

TEST_CASE("runtime.json decides the port, then settings.json, then 4460") {
    Harness h;
    h.appUp = true;
    h.files["/data/settings.json"] = R"({"port":4470})";
    h.run(250);
    CHECK(h.http.requestsTo("/api/health").back().url == "http://127.0.0.1:4470/api/health");
    h.files["/data/runtime.json"] = R"({"port":4480,"pid":1,"instanceId":"inst-1"})";
    h.run(5'000);
    CHECK(h.http.requestsTo("/api/health").back().url == "http://127.0.0.1:4480/api/health");
    CHECK(h.sup->status().dockUrl == "http://127.0.0.1:4480/dock");
}

TEST_CASE("screens are delivered when healthy, again when they change, and retried after a failure") {
    Harness h;
    h.appUp = true;
    h.run(3'000);
    CHECK(h.posts("/screens").empty());  // nothing to send yet
    h.sup->setScreens({ScreenInfo{"DISPLAY1", 0, 0, 1920, 1080, 1.0, true}});
    h.run(500);
    CHECK(h.posts("/screens").size() == 1);
    h.run(6'000);
    CHECK(h.posts("/screens").size() == 1);  // unchanged: not repeated
    h.sup->setScreens({ScreenInfo{"DISPLAY1", 0, 0, 1920, 1080, 1.0, true}, ScreenInfo{"DISPLAY2", 1920, 0, 1920, 1080, 1.0, false}});
    h.screensStatus = 500;
    h.run(500);
    CHECK(h.posts("/screens").size() == 2);
    h.screensStatus = 204;
    h.run(3'000);
    CHECK(h.posts("/screens").size() == 3);  // retried after the 2 s pause
    h.run(6'000);
    CHECK(h.posts("/screens").size() == 3);
    const auto body = nlohmann::json::parse(h.posts("/screens").back().body);
    CHECK(body["screens"].size() == 2);
    CHECK(body["screens"][1]["name"] == "DISPLAY2");
}

TEST_CASE("changing the settings starts over: remote to local launches again") {
    PluginSettings remote;
    remote.mode = ServerMode::Remote;
    remote.remoteUrl = "http://other:4460";
    Harness h(remote);
    h.run(2'000);
    CHECK(h.launched.empty());
    h.sup->applySettings(PluginSettings{});
    h.run(1'000);
    CHECK(h.launched.size() == 1);
}

TEST_CASE("the status callback fires on change only") {
    Harness h;
    h.appUp = true;
    h.run(20'000);
    const auto n = h.statuses.size();
    CHECK(n >= 1);
    h.run(20'000);
    CHECK(h.statuses.size() == n);
}

TEST_CASE("an app that dies while running is relaunched after about 8 s of misses, once") {
    Harness h;
    h.appUp = true;
    h.run(5'000);
    h.appUp = false;
    h.run(60'000);
    CHECK(h.launched.size() == 1);
}

TEST_CASE("an app without the screens route (404) is asked with a growing pause and logged once") {
    Harness h;
    h.appUp = true;
    h.screensStatus = 404;
    h.sup->setScreens({ScreenInfo{"DISPLAY1", 0, 0, 1920, 1080, 1.0, true}});
    h.run(60'000);
    CHECK(h.posts("/screens").size() <= 6);  // 2, 4, 8, 16, 30 s pauses: far fewer than one per 2 s
    int logged = 0;
    for (const auto& l : h.logs)
        if (l.find("screen list") != std::string::npos) ++logged;
    CHECK(logged == 1);
}

TEST_CASE("phase changes are logged once each, with the port") {
    Harness h;
    h.run(2'000);
    h.appUp = true;
    h.run(3'000);
    int launching = 0, running = 0;
    for (const auto& l : h.logs) {
        if (l == "app launching on port 4460") ++launching;
        if (l == "app running on port 4460") ++running;
    }
    CHECK(launching == 1);
    CHECK(running == 1);
}

TEST_CASE("dirty screens do not shorten the death window: a running app that stops answering is relaunched once, later") {
    Harness h;
    h.appUp = true;
    h.run(3'000);
    REQUIRE(h.sup->status().phase == LaunchPhase::Running);
    h.appUp = false;  // the app disappears while the screen list is still to be delivered
    h.sup->setScreens({ScreenInfo{"DISPLAY1", 0, 0, 1920, 1080, 1.0, true}});
    h.run(1'000);  // a per-tick probe would count the misses here and relaunch within about 1 s
    CHECK(h.launched.empty());
    h.run(30'000);
    CHECK(h.launched.size() == 1);
}

TEST_CASE("remote mode probes the remote app's public health route directly and becomes Running when it answers") {
    PluginSettings s;
    s.mode = ServerMode::Remote;
    s.remoteUrl = "http://studio-pc.local:4460";
    Harness h(s);
    h.http.setHandler([](const HttpRequest& r) {
        if (r.url == "http://studio-pc.local:4460/api/health")
            return reply(200, nlohmann::json{{"version", "0.6.0"}, {"protocol", 1}, {"instanceId", "remote-1"}}.dump());
        return unreachable();
    });
    h.run(1'000);
    CHECK(h.sup->status().phase == LaunchPhase::Running);
    CHECK(h.sup->status().appVersion == "0.6.0");
    CHECK(h.launched.empty());
    REQUIRE_FALSE(h.http.requestsTo("/api/health").empty());
    const auto probe = h.http.requestsTo("/api/health").back();
    CHECK(probe.method == "GET");
    CHECK(probe.url == "http://studio-pc.local:4460/api/health");
    CHECK(probe.timeoutMs == 1500);
    CHECK(probe.headers.empty());  // the public route: no bearer token, not even Content-Type
    CHECK(probe.body.empty());
    CHECK(h.posts("/obs-credentials").empty());
    CHECK(h.posts("/screens").empty());
}

TEST_CASE("a local to remote switch probes the remote URL and never the old local app") {
    Harness h;  // local, healthy on 127.0.0.1:4460
    h.appUp = true;
    h.run(2'000);
    REQUIRE(h.sup->status().phase == LaunchPhase::Running);
    const auto requestsBefore = h.http.requests().size();
    const auto credsBefore = h.posts("/obs-credentials").size();
    PluginSettings remote;
    remote.mode = ServerMode::Remote;
    remote.remoteUrl = "http://studio-pc.local:4460";
    h.http.setHandler([](const HttpRequest& r) {
        if (r.url == "http://studio-pc.local:4460/api/health")
            return reply(200, nlohmann::json{{"version", "0.7.0"}, {"protocol", 1}, {"instanceId", "remote-1"}}.dump());
        return unreachable();
    });
    h.sup->applySettings(remote);
    h.run(1'000);
    CHECK(h.sup->status().remote);
    CHECK(h.sup->status().phase == LaunchPhase::Running);
    CHECK(h.sup->status().appVersion == "0.7.0");
    const auto all = h.http.requests();
    for (size_t i = requestsBefore; i < all.size(); ++i) CHECK(all[i].url.rfind("http://127.0.0.1", 0) != 0);
    CHECK(h.posts("/obs-credentials").size() == credsBefore);  // remote mode hands over nothing
    CHECK(h.posts("/screens").empty());
    CHECK(h.launched.empty());
}

TEST_CASE("remote mode never launches and posts nothing even with dirty screens and a dead remote") {
    PluginSettings s;
    s.mode = ServerMode::Remote;
    s.remoteUrl = "http://studio-pc.local:4460";
    Harness h(s);
    h.sup->setScreens({ScreenInfo{"DISPLAY1", 0, 0, 1920, 1080, 1.0, true}});
    h.run(20'000);
    CHECK_FALSE(h.http.requestsTo("/api/health").empty());  // it did probe the remote
    CHECK(h.sup->status().phase == LaunchPhase::Unavailable);
    CHECK(h.launched.empty());
    CHECK(h.posts("/obs-credentials").empty());
    CHECK(h.posts("/screens").empty());
}

TEST_CASE("a remote URL carrying userinfo is stripped before it is logged") {
    PluginSettings s;
    s.mode = ServerMode::Remote;
    s.remoteUrl = "http://user:pw-must-never-leak-42@clock.example.org:4460";
    Harness h(s);
    h.http.setHandler([](const HttpRequest&) { return reply(200, "<html>not us</html>"); });
    h.run(2'000);
    int notOurs = 0;
    for (const auto& l : h.logs) {
        CHECK(l.find("pw-must-never-leak") == std::string::npos);
        if (l.find("not OBS Live Clock") != std::string::npos) {
            ++notOurs;
            CHECK(l.find("user:pw") == std::string::npos);
        }
    }
    CHECK(notOurs == 1);
}
