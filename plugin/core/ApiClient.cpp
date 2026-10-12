// SPDX-License-Identifier: GPL-2.0-or-later
#include "ApiClient.hpp"

#include <nlohmann/json.hpp>
#include <utility>

namespace olc {

std::string trimToken(const std::string& raw) {
    const auto first = raw.find_first_not_of(" \t\r\n");
    if (first == std::string::npos) return {};
    const auto last = raw.find_last_not_of(" \t\r\n");
    return raw.substr(first, last - first + 1);
}

ApiClient::ApiClient(IHttpClient& http, std::string baseUrl, TokenProvider token)
    : http_(http), token_(std::move(token)), baseUrl_(std::move(baseUrl)) {}

void ApiClient::setBaseUrl(std::string baseUrl) {
    while (!baseUrl.empty() && baseUrl.back() == '/') baseUrl.pop_back();
    std::lock_guard<std::mutex> lock(mutex_);
    baseUrl_ = std::move(baseUrl);
}

std::string ApiClient::baseUrl() const {
    std::lock_guard<std::mutex> lock(mutex_);
    return baseUrl_;
}

HttpResponse ApiClient::health() {
    HttpRequest request;
    request.method = "GET";
    request.url = baseUrl() + "/api/health";
    request.timeoutMs = 1500;
    return http_.perform(request);
}

HttpResponse ApiClient::postJson(const std::string& path, std::string body, int timeoutMs) {
    HttpRequest request;
    request.method = "POST";
    request.url = baseUrl() + path;
    request.timeoutMs = timeoutMs;
    request.headers.emplace_back("Content-Type", "application/json");
    const std::string token = trimToken(token_ ? token_() : std::string());
    if (!token.empty()) request.headers.emplace_back("Authorization", "Bearer " + token);
    request.body = std::move(body);
    return http_.perform(request);
}

HttpResponse ApiClient::postCredentials(const std::string& body) {
    return postJson("/api/internal/obs-credentials", body, 2000);
}

HttpResponse ApiClient::postScreens(const std::string& body) { return postJson("/api/internal/screens", body, 2000); }

HttpResponse ApiClient::postHotkey(const std::string& slotId, const std::string& session, uint64_t seq) {
    const nlohmann::json body = {{"slot", slotId}, {"session", session}, {"seq", seq}};
    return postJson("/api/internal/hotkey", body.dump(), 1500);
}

}  // namespace olc
