// SPDX-License-Identifier: GPL-2.0-or-later
#pragma once
#include <QString>

#include "PluginSettings.hpp"

namespace olc {

/** settings.json in OBS's per-module config folder: <OBS config>/plugin_config/obs-live-clock/settings.json. */
class SettingsStore {
public:
    QString path() const;
    PluginSettings load() const;  // defaults when the file is missing or unreadable
    bool save(const PluginSettings& settings) const;  // atomic (QSaveFile)
};

}  // namespace olc
