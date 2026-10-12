// SPDX-License-Identifier: GPL-2.0-or-later
#pragma once
#include <QShowEvent>
#include <QString>
#include <QWidget>

#include "Texts.hpp"

class QLabel;
class QLineEdit;
class QPushButton;
class QStackedLayout;
namespace olc::panel {
class QCefWidget;
}

namespace olc {

/**
 * The content of the "OBS Live Clock" dock. With obs-browser's panel API available it holds a browser widget on
 * /dock; otherwise (Wayland, obs-browser missing or too old) a small page with the address to paste into
 * Docks > Custom Browser Docks and an "open in browser" button. A banner above shows the one thing that is wrong.
 * All methods run on the GUI thread.
 */
class DockHost : public QWidget {
    Q_OBJECT
public:
    explicit DockHost(Lang lang, QWidget* parent = nullptr);

    bool hasBrowser() const { return browser_ != nullptr; }
    QString url() const { return url_; }

    /** Points the dock at `url` ("" = nothing valid to show) and shows `problem` in the banner ("" = hide it). */
    void present(const QString& url, const QString& problem);
    /** The app just became reachable (or restarted): reload the page, it may be showing a connection error. */
    void reloadBrowser();

protected:
    void showEvent(QShowEvent* event) override;

private slots:
    void openInBrowser();
    void copyUrl();

private:
    Lang lang_;
    QString url_;
    QLabel* banner_ = nullptr;
    QStackedLayout* stack_ = nullptr;
    panel::QCefWidget* browser_ = nullptr;
    QLabel* fallbackBody_ = nullptr;
    QLineEdit* urlEdit_ = nullptr;
    QPushButton* openButton_ = nullptr;
    QPushButton* copyButton_ = nullptr;
};

}  // namespace olc
