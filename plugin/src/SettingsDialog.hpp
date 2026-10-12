// SPDX-License-Identifier: GPL-2.0-or-later
#pragma once
#include <QDialog>
#include <optional>

#include "PluginSettings.hpp"
#include "Texts.hpp"

class QCheckBox;
class QLabel;
class QLineEdit;
class QRadioButton;

namespace olc {

/** Tools > OBS Live Clock…: server mode, remote address, launch command, auto start. Modal, GUI thread. */
class SettingsDialog : public QDialog {
    Q_OBJECT
public:
    SettingsDialog(Lang lang, const PluginSettings& current, const QString& statusLine, QWidget* parent);

    /** The settings to apply, or nullopt while the form is invalid (the dialog then stays open). */
    std::optional<PluginSettings> result() const { return result_; }

public slots:
    void accept() override;

private slots:
    void browse();
    void updateEnabled();

private:
    Lang lang_;
    QRadioButton* local_ = nullptr;
    QRadioButton* remote_ = nullptr;
    QLineEdit* remoteUrl_ = nullptr;
    QLineEdit* command_ = nullptr;
    QCheckBox* autoStart_ = nullptr;
    QLabel* error_ = nullptr;
    std::optional<PluginSettings> result_;
};

}  // namespace olc
