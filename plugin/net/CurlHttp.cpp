// SPDX-License-Identifier: GPL-2.0-or-later
#include "CurlHttp.hpp"

#include <curl/curl.h>

#include <algorithm>
#include <memory>

namespace olc {

namespace {
constexpr size_t kMaxBody = 1 << 20;  // 1 MiB: the app answers with a few hundred bytes

size_t onBody(char* data, size_t size, size_t count, void* user) {
    auto* out = static_cast<std::string*>(user);
    const size_t bytes = size * count;
    if (out->size() + bytes > kMaxBody) return 0;  // abort the transfer
    out->append(data, bytes);
    return bytes;
}

struct HandleDeleter {
    void operator()(CURL* h) const { curl_easy_cleanup(h); }
};
struct ListDeleter {
    void operator()(curl_slist* l) const { curl_slist_free_all(l); }
};

bool isLoopback(const std::string& url) {
    return url.rfind("http://127.0.0.1", 0) == 0 || url.rfind("http://localhost", 0) == 0 || url.rfind("http://[::1]", 0) == 0;
}
}  // namespace

HttpResponse CurlHttp::perform(const HttpRequest& request) {
    HttpResponse response;
    std::unique_ptr<CURL, HandleDeleter> easy(curl_easy_init());
    if (!easy) {
        response.error = "curl_easy_init failed";
        return response;
    }
    std::unique_ptr<curl_slist, ListDeleter> headers;
    for (const auto& h : request.headers) {
        curl_slist* next = curl_slist_append(headers.get(), (h.first + ": " + h.second).c_str());
        if (!next) {
            response.error = "out of memory";
            return response;
        }
        headers.release();
        headers.reset(next);
    }
    const long timeout = (std::max)(100, request.timeoutMs);
    curl_easy_setopt(easy.get(), CURLOPT_URL, request.url.c_str());
    curl_easy_setopt(easy.get(), CURLOPT_NOSIGNAL, 1L);  // required when curl is used from non-main threads
    curl_easy_setopt(easy.get(), CURLOPT_TIMEOUT_MS, timeout);
    curl_easy_setopt(easy.get(), CURLOPT_CONNECTTIMEOUT_MS, (std::min<long>)(timeout, 1000L));
    curl_easy_setopt(easy.get(), CURLOPT_FOLLOWLOCATION, 0L);
    curl_easy_setopt(easy.get(), CURLOPT_HTTPHEADER, headers.get());
    curl_easy_setopt(easy.get(), CURLOPT_WRITEFUNCTION, onBody);
    curl_easy_setopt(easy.get(), CURLOPT_WRITEDATA, &response.body);
    if (isLoopback(request.url)) curl_easy_setopt(easy.get(), CURLOPT_NOPROXY, "*");
    if (request.method == "POST") {
        curl_easy_setopt(easy.get(), CURLOPT_POST, 1L);
        curl_easy_setopt(easy.get(), CURLOPT_POSTFIELDS, request.body.c_str());
        curl_easy_setopt(easy.get(), CURLOPT_POSTFIELDSIZE, static_cast<long>(request.body.size()));
    }
    const CURLcode code = curl_easy_perform(easy.get());
    if (code != CURLE_OK) {
        response.body.clear();
        response.error = curl_easy_strerror(code);  // fixed text per code: carries nothing from the request
        return response;
    }
    long status = 0;
    curl_easy_getinfo(easy.get(), CURLINFO_RESPONSE_CODE, &status);
    response.status = static_cast<int>(status);
    return response;
}

}  // namespace olc
