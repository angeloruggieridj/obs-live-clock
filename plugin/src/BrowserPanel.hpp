// SPDX-License-Identifier: GPL-2.0-or-later
#pragma once
/*
 * How a plugin shows a web page in a dock (verified against obs-browser at the commits of OBS 30.0.0, 31.0.0,
 * 32.0.0, 32.2.2 and 33.0.0-rc1: panel/browser-panel.hpp changed only in formatting between them).
 *
 * obs-browser exports two C symbols from its module: obs_browser_create_qcef() returns a QCef*, a table of virtual
 * functions, and obs_browser_qcef_version_export() returns its version (3 in every OBS from 30.0 to 33.0-rc1).
 * obs-browser's header is not part of the OBS SDK, and it is GPL-2.0-only, so it is not copied: the declarations
 * below are written from the observable virtual-function ORDER, which is the whole ABI. The checker
 * plugin/ci/check_browser_panel_abi.py compares this order with upstream's header so a future change cannot slip
 * through.
 *
 * NEVER reorder, insert or remove a virtual function here.
 */
#include <QWidget>
#include <string>

namespace olc::panel {

class QCefWidget : public QWidget {
protected:
    explicit QCefWidget(QWidget* parent) : QWidget(parent) {}

public:
    virtual void setURL(const std::string& url) = 0;
    virtual void setStartupScript(const std::string& script) = 0;
    virtual void allowAllPopups(bool allow) = 0;
    virtual void closeBrowser() = 0;
    virtual void reloadPage() = 0;
    virtual bool zoomPage(int direction) = 0;
    virtual void executeJavaScript(const std::string& script) = 0;
};

struct QCefCookieManager;  // never used here; only its pointer type appears in QCef

struct QCef {
    virtual ~QCef() {}
    virtual bool init_browser() = 0;
    virtual bool initialized() = 0;
    virtual bool wait_for_browser_init() = 0;
    virtual QCefWidget* create_widget(QWidget* parent, const std::string& url, QCefCookieManager* cookieManager = nullptr) = 0;
    virtual QCefCookieManager* create_cookie_manager(const std::string& storagePath, bool persistSessionCookies = false) = 0;
    virtual void* get_cookie_path_never_called(const std::string& storagePath) = 0;  // BPtr<char> upstream
    virtual void add_popup_whitelist_url(const std::string& url, QObject* obj) = 0;
    virtual void add_force_popup_url(const std::string& url, QObject* obj) = 0;
};

/** nullptr when obs-browser is absent, too old, disabled, or OBS runs on Wayland (obs-browser panels are off there). */
QCef* createQCef();

/** A live browser widget showing `url`, or nullptr (see createQCef). Parent owns it. */
QCefWidget* createBrowserWidget(QWidget* parent, const std::string& url);

}  // namespace olc::panel
