// SPDX-License-Identifier: GPL-2.0-or-later
#include "SettingsDialog.hpp"

#include <QCheckBox>
#include <QDialogButtonBox>
#include <QFileDialog>
#include <QHBoxLayout>
#include <QLabel>
#include <QLineEdit>
#include <QPushButton>
#include <QRadioButton>
#include <QVBoxLayout>

namespace olc {

namespace {
QString tr8(Lang lang, Msg msg) { return QString::fromStdString(text(lang, msg)); }
}  // namespace

SettingsDialog::SettingsDialog(Lang lang, const PluginSettings& current, const QString& statusLine, QWidget* parent)
    : QDialog(parent), lang_(lang) {
    setWindowTitle(tr8(lang_, Msg::SettingsTitle));
    auto* root = new QVBoxLayout(this);

    if (!statusLine.isEmpty()) {
        auto* status = new QLabel(statusLine, this);
        status->setWordWrap(true);
        root->addWidget(status);
    }

    local_ = new QRadioButton(tr8(lang_, Msg::ModeLocal), this);
    remote_ = new QRadioButton(tr8(lang_, Msg::ModeRemote), this);
    (current.isRemote() ? remote_ : local_)->setChecked(true);
    root->addWidget(local_);
    root->addWidget(remote_);

    root->addWidget(new QLabel(tr8(lang_, Msg::RemoteUrlLabel), this));
    remoteUrl_ = new QLineEdit(QString::fromStdString(current.remoteUrl), this);
    remoteUrl_->setPlaceholderText("http://studio-pc:4460");
    root->addWidget(remoteUrl_);

    root->addWidget(new QLabel(tr8(lang_, Msg::AppCommandLabel), this));
    auto* row = new QHBoxLayout();
    command_ = new QLineEdit(QString::fromStdString(current.appCommand), this);
    command_->setPlaceholderText(tr8(lang_, Msg::AppCommandHint));
    auto* browse = new QPushButton(tr8(lang_, Msg::Browse), this);
    row->addWidget(command_, 1);
    row->addWidget(browse);
    root->addLayout(row);

    autoStart_ = new QCheckBox(tr8(lang_, Msg::AutoStart), this);
    autoStart_->setChecked(current.autoStart);
    root->addWidget(autoStart_);

    error_ = new QLabel(this);
    error_->setStyleSheet("color:#b00020;");
    error_->setWordWrap(true);
    error_->hide();
    root->addWidget(error_);

    auto* buttons = new QDialogButtonBox(QDialogButtonBox::Ok | QDialogButtonBox::Cancel, this);
    root->addWidget(buttons);

    connect(buttons, &QDialogButtonBox::accepted, this, &SettingsDialog::accept);
    connect(buttons, &QDialogButtonBox::rejected, this, &QDialog::reject);
    connect(browse, &QPushButton::clicked, this, &SettingsDialog::browse);
    connect(local_, &QRadioButton::toggled, this, &SettingsDialog::updateEnabled);
    updateEnabled();
}

void SettingsDialog::updateEnabled() {
    const bool isRemote = remote_->isChecked();
    remoteUrl_->setEnabled(isRemote);
    command_->setEnabled(!isRemote);
    autoStart_->setEnabled(!isRemote);
}

void SettingsDialog::browse() {
    const QString file = QFileDialog::getOpenFileName(this, tr8(lang_, Msg::AppCommandLabel));
    if (!file.isEmpty()) command_->setText(file);
}

void SettingsDialog::accept() {
    PluginSettings settings;
    settings.mode = remote_->isChecked() ? ServerMode::Remote : ServerMode::Local;
    settings.appCommand = command_->text().trimmed().toStdString();
    settings.autoStart = autoStart_->isChecked();
    const auto url = normalizeRemoteUrl(remoteUrl_->text().toStdString());
    if (settings.isRemote() && !url) {
        error_->setText(tr8(lang_, Msg::RemoteUrlInvalid));
        error_->show();
        return;  // stay open
    }
    settings.remoteUrl = url.value_or(std::string());  // kept in local mode too, so switching back needs no retyping
    result_ = settings;
    QDialog::accept();
}

}  // namespace olc
