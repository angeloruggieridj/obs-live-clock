// SPDX-License-Identifier: GPL-2.0-or-later
#pragma once
#include <ostream>
#include <string>
#include <utility>

namespace olc {

/**
 * A value that must never reach a log line, a command line or a test message (DT-5).
 * There is deliberately no implicit conversion to std::string: the one way out is reveal(),
 * which is greppable. Streaming a Secret prints a fixed marker, never the value.
 */
class Secret {
public:
    Secret() = default;
    explicit Secret(std::string value) : value_(std::move(value)) {}
    const std::string& reveal() const { return value_; }
    bool empty() const { return value_.empty(); }
    bool operator==(const Secret& other) const { return value_ == other.value_; }
    bool operator!=(const Secret& other) const { return !(*this == other); }

private:
    std::string value_;
};

inline std::string describe(const Secret& secret) { return secret.empty() ? "<empty>" : "<secret>"; }
inline std::ostream& operator<<(std::ostream& os, const Secret& secret) { return os << describe(secret); }

} // namespace olc
