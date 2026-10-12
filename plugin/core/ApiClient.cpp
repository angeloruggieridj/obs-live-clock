// SPDX-License-Identifier: GPL-2.0-or-later
#include "ApiClient.hpp"

#include <algorithm>
#include <cctype>
#include <nlohmann/json.hpp>
#include <utility>

namespace olc {

namespace {

/**
 * Strips trailing slashes and keeps the URL only when it is http on a loopback host (127.0.0.1, localhost or
 * [::1]). Returns {} for anything else. The base URL decides where the bearer token and the credentials body go,
 * so a typo or a settings field must never point them off-box: no userinfo, no other host, no other scheme.
 */
std::string normalizeLoopbackBaseUrl(std::string url) {
    while (!url.empty() && url.back() == '/') url.pop_back();
    static const std::string scheme = "http://";
    if (url.size() <= scheme.size() || url.compare(0, scheme.size(), scheme) != 0) return {};
    const std::string rest = url.substr(scheme.size());
    const auto cut = rest.find_first_of("/?#");
    const std::string authority = rest.substr(0, cut);
    if (authority.empty()) return {};
    if (cut != std::string::npos && rest[cut] != '/') return {};  // no query or fragment in a base URL
    if (authority.find('@') != std::string::npos) return {};     // no userinfo: a host trick could move the token
    std::string host, port;
    if (authority.front() == '[') {
        const auto close = authority.find(']');
        if (close == std::string::npos) return {};
        host = authority.substr(0, close + 1);
        if (close + 1 < authority.size()) {
            if (authority[close + 1] != ':') return {};
            port = authority.substr(close + 2);
            if (port.empty()) return {};
        }
    } else {
        const auto colon = authority.rfind(':');
        if (colon == std::string::npos) {
            host = authority;
        } else {
            host = authority.substr(0, colon);
            port = authority.substr(colon + 1);
            if (port.empty()) return {};
        }
        std::transform(host.begin(), host.end(), host.begin(),
                       [](unsigned char c) { return static_cast<char>(std::tolower(c)); });
    }
    if (!port.empty() && !std::all_of(port.begin(), port.end(), [](unsigned char c) { return std::isdigit(c) != 0; }))
        return {};
    if (host != "127.0.0.1" && host != "localhost" && host != "[::1]") return {};
    return url;
}

}  // namespace

std::string trimToken(const std::string& raw) {
    const auto first = raw.find_first_not_of(" \t\r\n");
    if (first == std::string::npos) return {};
    const auto last = raw.find_last_not_of(" \t\r\n");
    return raw.substr(first, last - first + 1);
}

ApiClient::ApiClient(IHttpClient& http, std::string baseUrl, TokenProvider token)
    : http_(http), token_(std::move(token)), baseUrl_(normalizeLoopbackBaseUrl(std::move(baseUrl))) {}

void ApiClient::setBaseUrl(std::string baseUrl) {
    std::string normalized = normalizeLoopbackBaseUrl(std::move(baseUrl));
    if (normalized.empty()) return;  // rejected: keep the previous URL
    std::lock_guard<std::mutex> lock(mutex_);
    baseUrl_ = std::move(normalized);
}

std::string ApiClient::baseUrl() const {
    std::lock_guard<std::mutex> lock(mutex_);
    return baseUrl_;
}

HttpResponse ApiClient::health() {
    const std::string base = baseUrl();
    if (base.empty()) {
        HttpResponse refused;
        refused.error = "no loopback base url";
        return refused;
    }
    HttpRequest request;
    request.method = "GET";
    request.url = base + "/api/health";
    request.timeoutMs = 1500;
    return http_.perform(request);
}

HttpResponse ApiClient::postJson(const std::string& path, std::string body, int timeoutMs) {
    const std::string base = baseUrl();
    if (base.empty()) {
        HttpResponse refused;
        refused.error = "no loopback base url";
        return refused;
    }
    HttpRequest request;
    request.method = "POST";
    request.url = base + path;
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
