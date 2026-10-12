// SPDX-License-Identifier: GPL-2.0-or-later
#include "SettingsStore.hpp"

#include <obs-module.h>
#include <util/bmem.h>

#include <QDir>
#include <QFile>
#include <QFileInfo>
#include <QSaveFile>

namespace olc {

QString SettingsStore::path() const {
    char* raw = obs_module_config_path("settings.json");
    const QString result = raw ? QString::fromUtf8(raw) : QString();
    bfree(raw);
    return result;
}

PluginSettings SettingsStore::load() const {
    QFile file(path());
    if (!file.open(QIODevice::ReadOnly)) return {};
    const QByteArray bytes = file.readAll();
    return parsePluginSettings(std::string_view(bytes.constData(), static_cast<size_t>(bytes.size())));
}

bool SettingsStore::save(const PluginSettings& settings) const {
    const QString target = path();
    if (target.isEmpty()) return false;
    QDir().mkpath(QFileInfo(target).absolutePath());
    QSaveFile file(target);
    if (!file.open(QIODevice::WriteOnly)) return false;
    const std::string json = serializePluginSettings(settings);
    file.write(json.data(), static_cast<qint64>(json.size()));
    return file.commit();
}

}  // namespace olc
