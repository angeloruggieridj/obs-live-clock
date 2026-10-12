// SPDX-License-Identifier: GPL-2.0-or-later
#pragma once
#include <deque>
#include <functional>
#include <map>
#include <mutex>
#include <string>
#include <vector>

#include "Http.hpp"

namespace olc::testing {

/** Records every request; answers from a script, or with the default response. Thread-safe. */
class FakeHttp : public IHttpClient {
public:
    HttpResponse perform(const HttpRequest& request) override {
        std::lock_guard<std::mutex> lock(mutex_);
        requests_.push_back(request);
        if (handler_) return handler_(request);
        if (!script_.empty()) {
            auto r = script_.front();
            if (script_.size() > 1) script_.pop_front();
            return r;
        }
        HttpResponse ok;
        ok.status = 204;
        return ok;
    }

    void setHandler(std::function<HttpResponse(const HttpRequest&)> handler) {
        std::lock_guard<std::mutex> lock(mutex_);
        handler_ = std::move(handler);
    }
    void script(std::vector<HttpResponse> responses) {
        std::lock_guard<std::mutex> lock(mutex_);
        script_.assign(responses.begin(), responses.end());
    }
    std::vector<HttpRequest> requests() const {
        std::lock_guard<std::mutex> lock(mutex_);
        return requests_;
    }
    std::vector<HttpRequest> requestsTo(const std::string& pathPart) const {
        std::vector<HttpRequest> out;
        for (const auto& r : requests())
            if (r.url.find(pathPart) != std::string::npos) out.push_back(r);
        return out;
    }

private:
    mutable std::mutex mutex_;
    std::vector<HttpRequest> requests_;
    std::deque<HttpResponse> script_;
    std::function<HttpResponse(const HttpRequest&)> handler_;
};

inline HttpResponse reply(int status, std::string body = {}) {
    HttpResponse r;
    r.status = status;
    r.body = std::move(body);
    return r;
}
inline HttpResponse unreachable() {
    HttpResponse r;
    r.error = "connection refused";
    return r;
}

}  // namespace olc::testing
