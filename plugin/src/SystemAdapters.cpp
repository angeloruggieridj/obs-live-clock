// SPDX-License-Identifier: GPL-2.0-or-later
#include "SystemAdapters.hpp"

#include <obs-frontend-api.h>
#include <obs-module.h>
#include <util/bmem.h>
#include <util/config-file.h>

#include <QCoreApplication>
#include <QDir>
#include <QFile>
#include <QProcess>
#include <QStringList>
#include <chrono>

#include "Paths.hpp"

#ifdef Q_OS_WIN
#include <windows.h>
#endif

namespace olc {

std::optional<std::string> readTextFile(const std::string& path) {
    QFile file(QString::fromStdString(path));
    if (!file.open(QIODevice::ReadOnly)) return std::nullopt;
    const QByteArray bytes = file.readAll();
    return std::string(bytes.constData(), static_cast<size_t>(bytes.size()));
}

bool launchDetached(const LaunchSpec& spec) {
    QProcess process;
    process.setProgram(QString::fromStdString(spec.command));
    QStringList args;
    for (const auto& a : spec.args) args << QString::fromStdString(a);
    process.setArguments(args);
    if (!spec.workingDir.empty()) process.setWorkingDirectory(QString::fromStdString(spec.workingDir));
#ifdef Q_OS_WIN
    // A console program (node.exe) must not flash a console window in front of the show.
    process.setCreateProcessArgumentsModifier([](QProcess::CreateProcessArguments* a) {
        a->flags |= CREATE_NO_WINDOW | CREATE_NEW_PROCESS_GROUP;
        a->startupInfo->dwFlags |= STARTF_USESHOWWINDOW;
        a->startupInfo->wShowWindow = SW_HIDE;
    });
#endif
    qint64 pid = 0;
    return process.startDetached(&pid);
}

int64_t monotonicMs() {
    using namespace std::chrono;
    return duration_cast<milliseconds>(steady_clock::now().time_since_epoch()).count();
}

std::string obsWebsocketConfigPath() {
    obs_module_t* module = obs_get_module("obs-websocket");
    if (!module) return {};
    char* raw = obs_module_get_config_path(module, "config.json");
    std::string result = raw ? raw : "";
    bfree(raw);
    return result;
}

std::optional<LegacyObsWsValues> readLegacyObsWsValues() {
    config_t* config = obs_frontend_get_app_config();
    if (!config) return std::nullopt;
    LegacyObsWsValues values;
    bool any = false;
    if (config_has_user_value(config, "OBSWebSocket", "ServerEnabled")) {
        values.serverEnabled = config_get_bool(config, "OBSWebSocket", "ServerEnabled");
        any = true;
    }
    if (config_has_user_value(config, "OBSWebSocket", "ServerPort")) {
        values.port = static_cast<int>(config_get_uint(config, "OBSWebSocket", "ServerPort"));
        any = true;
    }
    if (config_has_user_value(config, "OBSWebSocket", "AuthRequired")) {
        values.authRequired = config_get_bool(config, "OBSWebSocket", "AuthRequired");
        any = true;
    }
    if (config_has_user_value(config, "OBSWebSocket", "ServerPassword")) {
        values.password = config_get_string(config, "OBSWebSocket", "ServerPassword");
        any = true;
    }
    if (!any) return std::nullopt;
    return values;
}

std::vector<std::string> commandLineArguments() {
    std::vector<std::string> out;
    for (const QString& a : QCoreApplication::arguments()) out.push_back(a.toStdString());
    return out;
}

std::string resolveDataDir() {
    const auto env = [](const char* name) { return qEnvironmentVariable(name).toStdString(); };
    EnvVars vars;
    vars.olcDataDir = env("OLC_DATA_DIR");
    vars.appData = env("APPDATA");
    vars.xdgConfigHome = env("XDG_CONFIG_HOME");
    vars.home = QDir::homePath().toStdString();
    return defaultDataDir(currentPlatform(), vars);
}

}  // namespace olc
