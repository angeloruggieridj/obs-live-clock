// SPDX-License-Identifier: GPL-2.0-or-later
#pragma once
#include <string>
#include <string_view>

#include "Supervisor.hpp"

namespace olc {

enum class Lang { It, En };

/** "it", "it-IT", "it_IT" -> It; everything else -> En (OBS's own default is en-US). */
Lang langFromLocale(std::string_view locale);

enum class Msg {
    DockTitle,
    FallbackBody,          // shown when OBS has no browser panel (CEF) to host the dock
    OpenInBrowser,
    CopyUrl,
    UrlLabel,
    StatusChecking,
    StatusLaunching,
    StatusRunning,
    StatusFailed,          // launched, never answered
    StatusUnavailableLocal,
    StatusUnavailableRemote,
    StatusIncompatibleAppNewer,
    StatusIncompatibleAppOlder,
    LaunchSpecMissing,
    LaunchFailed,
    CredentialsServerDisabled,
    CredentialsUnreadable,
    CredentialsFailing,
    SettingsTitle,
    ModeLocal,
    ModeRemote,
    RemoteUrlLabel,
    RemoteUrlInvalid,
    AppCommandLabel,
    AppCommandHint,
    AutoStart,
    Browse,
    MenuEntry,
    COUNT_,  // keep last
};

std::string text(Lang lang, Msg msg);

/** One line for the dock banner / settings dialog: the most important problem in the status, "" when all is well. */
std::string describeStatus(Lang lang, const Status& status);

} // namespace olc
