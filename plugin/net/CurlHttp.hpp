// SPDX-License-Identifier: GPL-2.0-or-later
#pragma once
#include "Http.hpp"

namespace olc {

/**
 * libcurl behind IHttpClient. One easy handle per call, so any thread may call it. libcurl is the same library OBS
 * ships on all three platforms and, unlike Qt Network inside OBS, it carries its own TLS (needed for https remotes).
 * Nothing about the request (URL with a token, body, headers) is ever put in the returned error text.
 */
class CurlHttp : public IHttpClient {
public:
    HttpResponse perform(const HttpRequest& request) override;
};

}  // namespace olc
