// SPDX-License-Identifier: GPL-2.0-or-later
#pragma once
#include <QObject>
#include <QTimer>
#include <functional>
#include <vector>

#include "ScreenInfo.hpp"

class QScreen;

namespace olc {

/** Watches the monitors Qt knows about and reports the list (once at start, then after every change, debounced). */
class ScreenReporter : public QObject {
    Q_OBJECT
public:
    using Sink = std::function<void(std::vector<ScreenInfo>)>;
    explicit ScreenReporter(Sink sink, QObject* parent = nullptr);

    void start();
    static std::vector<ScreenInfo> snapshot();

private slots:
    void watch(QScreen* screen);
    void changed();
    void publish();

private:
    Sink sink_;
    QTimer debounce_;
};

}  // namespace olc
