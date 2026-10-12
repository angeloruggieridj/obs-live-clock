// SPDX-License-Identifier: GPL-2.0-or-later
#pragma once
#include <string>

namespace olc {

/**
 * True when `url` is an http URL whose host is exactly 127.0.0.1, localhost or [::1]: the host must be followed by
 * end-of-string, a port (':') or a path ('/'). A name that merely starts with a loopback host (127.0.0.1.evil.com,
 * localhost.evil.com) is not loopback. Used to bypass any proxy for the local app's own requests.
 */
bool isLoopbackUrl(const std::string& url);

}  // namespace olc
