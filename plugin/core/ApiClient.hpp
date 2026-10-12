// SPDX-License-Identifier: GPL-2.0-or-later
#pragma once
#include <cstdint>
#include <functional>
#include <mutex>
#include <string>

#include "Http.hpp"

namespace olc {

/**
 * Builds the app's HTTP requests. Blocking: call it from a Dispatcher job, never from OBS's UI thread.
 * The bearer token is asked for on every call (the file may have been rewritten), trimmed, and only ever put in
 * the Authorization header. Request bodies are not logged by anything in this class.
 * The base URL is http on a loopback host only (127.0.0.1, localhost or [::1]): the constructor leaves it empty
 * and setBaseUrl keeps the previous URL when given anything else, so the token and the credentials body can never
 * be sent off-box. A refused client answers no request (answered() == false).
 */
class ApiClient {
public:
    using TokenProvider = std::function<std::string()>;

    ApiClient(IHttpClient& http, std::string baseUrl, TokenProvider token);

    /** "http://127.0.0.1:4460", trailing slashes stripped; a non-loopback URL is ignored (the previous is kept). */
    void setBaseUrl(std::string baseUrl);
    std::string baseUrl() const;

    HttpResponse health();                                    // GET  /api/health                      (no auth)
    HttpResponse postCredentials(const std::string& body);    // POST /api/internal/obs-credentials
    HttpResponse postScreens(const std::string& body);        // POST /api/internal/screens
    /** POST /api/internal/hotkey {"slot","session","seq"}. Never retried: a repeated press could confirm an emergency. */
    HttpResponse postHotkey(const std::string& slotId, const std::string& session, uint64_t seq);

private:
    HttpResponse postJson(const std::string& path, std::string body, int timeoutMs);

    IHttpClient& http_;
    TokenProvider token_;
    mutable std::mutex mutex_;
    std::string baseUrl_;
};

std::string trimToken(const std::string& raw);

} // namespace olc
