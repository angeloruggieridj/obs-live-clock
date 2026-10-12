// SPDX-License-Identifier: GPL-2.0-or-later
#include "ScreenReporter.hpp"

#include <QGuiApplication>
#include <QScreen>
#include <utility>

namespace olc {

ScreenReporter::ScreenReporter(Sink sink, QObject* parent) : QObject(parent), sink_(std::move(sink)) {
    debounce_.setSingleShot(true);
    debounce_.setInterval(500);  // a monitor change fires several signals in a row
    connect(&debounce_, &QTimer::timeout, this, &ScreenReporter::publish);
}

std::vector<ScreenInfo> ScreenReporter::snapshot() {
    std::vector<ScreenInfo> out;
    const QScreen* primary = QGuiApplication::primaryScreen();
    for (QScreen* screen : QGuiApplication::screens()) {
        const QRect g = screen->geometry();
        ScreenInfo info;
        info.name = screen->name().toStdString();
        info.x = g.x();
        info.y = g.y();
        info.width = g.width();
        info.height = g.height();
        info.devicePixelRatio = screen->devicePixelRatio();
        info.primary = screen == primary;
        out.push_back(std::move(info));
    }
    return out;
}

void ScreenReporter::start() {
    for (QScreen* screen : QGuiApplication::screens()) watch(screen);
    connect(qGuiApp, &QGuiApplication::screenAdded, this, [this](QScreen* s) {
        watch(s);
        changed();
    });
    connect(qGuiApp, &QGuiApplication::screenRemoved, this, &ScreenReporter::changed);
    connect(qGuiApp, &QGuiApplication::primaryScreenChanged, this, &ScreenReporter::changed);
    publish();
}

void ScreenReporter::watch(QScreen* screen) {
    connect(screen, &QScreen::geometryChanged, this, &ScreenReporter::changed);
    connect(screen, &QScreen::physicalDotsPerInchChanged, this, &ScreenReporter::changed);
}

void ScreenReporter::changed() { debounce_.start(); }

void ScreenReporter::publish() {
    if (sink_) sink_(snapshot());
}

}  // namespace olc
