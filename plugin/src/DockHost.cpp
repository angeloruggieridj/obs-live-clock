// SPDX-License-Identifier: GPL-2.0-or-later
#include "DockHost.hpp"

#include <QApplication>
#include <QClipboard>
#include <QDesktopServices>
#include <QHBoxLayout>
#include <QLabel>
#include <QLineEdit>
#include <QPushButton>
#include <QStackedLayout>
#include <QTimer>
#include <QUrl>
#include <QVBoxLayout>

#include "BrowserPanel.hpp"

namespace olc {

DockHost::DockHost(Lang lang, QWidget* parent) : QWidget(parent), lang_(lang) {
    auto* root = new QVBoxLayout(this);
    root->setContentsMargins(0, 0, 0, 0);
    root->setSpacing(0);

    banner_ = new QLabel(this);
    banner_->setWordWrap(true);
    banner_->setStyleSheet("background:#7a1f1f;color:#fff;padding:6px 8px;");
    banner_->hide();
    root->addWidget(banner_);

    auto* content = new QWidget(this);
    stack_ = new QStackedLayout(content);
    root->addWidget(content, 1);

    // The browser starts on about:blank: the real URL is known only once the plugin has resolved the app's port.
    browser_ = panel::createBrowserWidget(content, "about:blank");
    if (browser_) stack_->addWidget(browser_);

    auto* fallback = new QWidget(content);
    auto* fb = new QVBoxLayout(fallback);
    fallbackBody_ = new QLabel(QString::fromStdString(text(lang_, Msg::FallbackBody)), fallback);
    fallbackBody_->setWordWrap(true);
    fb->addWidget(fallbackBody_);
    fb->addWidget(new QLabel(QString::fromStdString(text(lang_, Msg::UrlLabel)), fallback));
    urlEdit_ = new QLineEdit(fallback);
    urlEdit_->setReadOnly(true);
    fb->addWidget(urlEdit_);
    auto* row = new QHBoxLayout();
    openButton_ = new QPushButton(QString::fromStdString(text(lang_, Msg::OpenInBrowser)), fallback);
    copyButton_ = new QPushButton(QString::fromStdString(text(lang_, Msg::CopyUrl)), fallback);
    row->addWidget(openButton_);
    row->addWidget(copyButton_);
    fb->addLayout(row);
    fb->addStretch(1);
    stack_->addWidget(fallback);
    connect(openButton_, &QPushButton::clicked, this, &DockHost::openInBrowser);
    connect(copyButton_, &QPushButton::clicked, this, &DockHost::copyUrl);

    stack_->setCurrentWidget(browser_ ? static_cast<QWidget*>(browser_) : fallback);
}

void DockHost::present(const QString& url, const QString& problem) {
    if (url != url_) {
        url_ = url;
        urlEdit_->setText(url);
        openButton_->setEnabled(!url.isEmpty());
        copyButton_->setEnabled(!url.isEmpty());
        if (browser_ && !url.isEmpty()) browser_->setURL(url.toStdString());
    }
    banner_->setText(problem);
    banner_->setVisible(!problem.isEmpty());
}

void DockHost::showEvent(QShowEvent* event) {
    QWidget::showEvent(event);
    // The browser creates its page when it is first shown. Navigate again once it had time to start: a page that
    // was created before the app answered, or on a fresh CEF profile, would otherwise stay on whatever it first showed.
    if (browser_ && !url_.isEmpty()) QTimer::singleShot(1500, this, [this] { if (browser_ && !url_.isEmpty() && isVisible()) browser_->setURL(url_.toStdString()); });
}

void DockHost::reloadBrowser() {
    if (browser_ && !url_.isEmpty()) browser_->reloadPage();
}

void DockHost::openInBrowser() {
    if (!url_.isEmpty()) QDesktopServices::openUrl(QUrl(url_));
}

void DockHost::copyUrl() {
    if (!url_.isEmpty()) QApplication::clipboard()->setText(url_);
}

}  // namespace olc
