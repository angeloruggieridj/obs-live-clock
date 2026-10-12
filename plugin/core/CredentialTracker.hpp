// SPDX-License-Identifier: GPL-2.0-or-later
#pragma once
#include <cstdint>
#include <string>

#include "Http.hpp"
#include "ObsWsConfig.hpp"

namespace olc {

enum class DeliveryOutcome {
    Delivered,       // 204
    TokenRejected,  // 401: the secret.token we read is not the app's current one (re-read it and retry soon)
    Refused,         // 400/403/404/...: the app understood and said no; retrying fast will not help
    TransportError,  // no HTTP answer, or 5xx
};

DeliveryOutcome classifyDelivery(const HttpResponse& response);

/**
 * Decides WHEN the credentials (DT-5) must be POSTed: on the first healthy probe, whenever the app's instanceId
 * changes, whenever obs-websocket's own settings change, and again after a failure with a backoff. It holds the
 * last delivered config in memory (a Secret), never on disk, and never prints it.
 */
class CredentialTracker {
public:
    bool due(int64_t nowMs, const ObsWsConfig& config, const std::string& instanceId) const;
    void record(int64_t nowMs, DeliveryOutcome outcome, const ObsWsConfig& config, const std::string& instanceId);
    /** Settings changed, or the app vanished: deliver again next time regardless of what was delivered. */
    void forget();

    int consecutiveFailures() const { return failures_; }
    int64_t retryAt() const { return retryAt_; }

private:
    bool delivered_ = false;
    ObsWsConfig deliveredConfig_;
    std::string deliveredInstance_;
    // What the last attempt (delivered or failed) was for. The backoff only delays retrying THIS data:
    // a changed config or a new instanceId is always due at once (DT-5).
    ObsWsConfig attemptedConfig_;
    std::string attemptedInstance_;
    int failures_ = 0;
    int64_t retryAt_ = 0;
};

} // namespace olc
