// SPDX-License-Identifier: GPL-2.0-or-later
#pragma once
#include <string>
#include <utility>
#include <vector>

namespace olc {

struct HttpRequest {
    std::string method;                                        // "GET" | "POST"
    std::string url;                                           // absolute, http(s)
    std::vector<std::pair<std::string, std::string>> headers;  // includes Authorization: never logged
    std::string body;                                          // may hold a password: never logged
    int timeoutMs = 1500;                                      // whole request, connect included
};

struct HttpResponse {
    int status = 0;     // 0 = no HTTP answer (see error)
    std::string body;
    std::string error;  // transport failure, short, free of request data
    bool answered() const { return status > 0 && error.empty(); }
};

/** The only door to the network. The real one (libcurl) lives in src/; tests use fakes. Blocking by contract. */
class IHttpClient {
public:
    virtual ~IHttpClient() = default;
    virtual HttpResponse perform(const HttpRequest& request) = 0;
};

} // namespace olc
