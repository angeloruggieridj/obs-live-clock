// SPDX-License-Identifier: GPL-2.0-or-later
#include "CredentialTracker.hpp"

#include <algorithm>

namespace olc {

DeliveryOutcome classifyDelivery(const HttpResponse& response) {
    if (!response.answered()) return DeliveryOutcome::TransportError;
    if (response.status == 204 || response.status == 200) return DeliveryOutcome::Delivered;
    if (response.status == 401) return DeliveryOutcome::TokenRejected;
    if (response.status >= 500) return DeliveryOutcome::TransportError;
    return DeliveryOutcome::Refused;
}

namespace {
int64_t backoffMs(DeliveryOutcome outcome, int failures) {
    const int step = std::min(failures, 5);
    switch (outcome) {
    case DeliveryOutcome::TransportError: {
        static const int64_t kSchedule[] = {2'000, 4'000, 8'000, 16'000, 30'000};
        return kSchedule[step - 1];
    }
    case DeliveryOutcome::TokenRejected: {
        static const int64_t kSchedule[] = {1'000, 2'000, 5'000, 30'000, 30'000};
        return kSchedule[step - 1];
    }
    case DeliveryOutcome::Refused:
        return 30'000;
    case DeliveryOutcome::Delivered:
        return 0;
    }
    return 30'000;
}
}  // namespace

bool CredentialTracker::due(int64_t nowMs, const ObsWsConfig& config, const std::string& instanceId) const {
    // New data (a changed obs-websocket config or a new app instance) is delivered at once: the backoff
    // only delays retrying the same data that just failed, never first delivery of something new.
    if (config != attemptedConfig_ || instanceId != attemptedInstance_) return true;
    if (nowMs < retryAt_) return false;
    if (!delivered_) return true;
    if (instanceId != deliveredInstance_) return true;
    return config != deliveredConfig_;
}

void CredentialTracker::record(int64_t nowMs, DeliveryOutcome outcome, const ObsWsConfig& config,
                               const std::string& instanceId) {
    attemptedConfig_ = config;
    attemptedInstance_ = instanceId;
    if (outcome == DeliveryOutcome::Delivered) {
        delivered_ = true;
        deliveredConfig_ = config;
        deliveredInstance_ = instanceId;
        failures_ = 0;
        retryAt_ = 0;
        return;
    }
    ++failures_;
    retryAt_ = nowMs + backoffMs(outcome, failures_);
}

void CredentialTracker::forget() {
    delivered_ = false;
    deliveredConfig_ = ObsWsConfig{};
    deliveredInstance_.clear();
    attemptedConfig_ = ObsWsConfig{};
    attemptedInstance_.clear();
    failures_ = 0;
    retryAt_ = 0;
}

}  // namespace olc
