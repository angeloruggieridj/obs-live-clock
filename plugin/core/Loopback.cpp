// SPDX-License-Identifier: GPL-2.0-or-later
#include "Loopback.hpp"

namespace olc {
namespace {
// The literal host part of each accepted loopback URL, in the order they are tried.
constexpr const char* kLoopbackHosts[] = {"127.0.0.1", "localhost", "[::1]"};

// True when the part of the URL after the scheme starts with `host` and the host is followed by end-of-string, a port
// (':') or a path ('/') - so "127.0.0.1.evil.com" is not the host "127.0.0.1".
bool hostIs(const std::string& afterScheme, const char* host) {
    const std::string literal(host);
    if (afterScheme.rfind(literal, 0) != 0) return false;
    if (afterScheme.size() == literal.size()) return true;
    const char next = afterScheme[literal.size()];
    return next == ':' || next == '/';
}
}  // namespace

bool isLoopbackUrl(const std::string& url) {
    const std::string scheme = "http://";
    if (url.rfind(scheme, 0) != 0) return false;
    const std::string afterScheme = url.substr(scheme.size());
    for (const char* host : kLoopbackHosts) {
        if (hostIs(afterScheme, host)) return true;
    }
    return false;
}

}  // namespace olc
