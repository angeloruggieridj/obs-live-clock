#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-2.0-or-later
"""Unit tests for check_browser_panel_abi.py, on the shapes the real header and our shim have."""
from __future__ import annotations

import os
import unittest
from unittest import mock

import check_browser_panel_abi as abi

UPSTREAM = """
struct QCefCookieManager { virtual ~QCefCookieManager() {} virtual bool DeleteCookies(const std::string &url) = 0; };
class QCefWidget : public QWidget {
	Q_OBJECT
protected:
	inline QCefWidget(QWidget *parent) : QWidget(parent) {}
public:
	virtual void setURL(const std::string &url) = 0;
	virtual void setStartupScript(const std::string &script) = 0;
	virtual void allowAllPopups(bool allow) = 0;
	virtual void closeBrowser() = 0;
	virtual void reloadPage() = 0;
	virtual bool zoomPage(int direction) = 0;
	virtual void executeJavaScript(const std::string &script) = 0;
signals:
	void titleChanged(const QString &title);
};
struct QCef {
	virtual ~QCef() {}
	virtual bool init_browser(void) = 0;
	virtual bool initialized(void) = 0;
	virtual bool wait_for_browser_init(void) = 0;
	virtual QCefWidget *create_widget(QWidget *parent, const std::string &url,
					  QCefCookieManager *cookie_manager = nullptr) = 0;
	virtual QCefCookieManager *create_cookie_manager(const std::string &storage_path,
							 bool persist_session_cookies = false) = 0;
	virtual BPtr<char> get_cookie_path(const std::string &storage_path) = 0;
	virtual void add_popup_whitelist_url(const std::string &url, QObject *obj) = 0;
	virtual void add_force_popup_url(const std::string &url, QObject *obj) = 0;
};
"""

OURS = """
class QCefWidget : public QWidget {
public:
    virtual void setURL(const std::string& url) = 0;
    virtual void setStartupScript(const std::string& script) = 0;
    virtual void allowAllPopups(bool allow) = 0;
    virtual void closeBrowser() = 0;
    virtual void reloadPage() = 0;
    virtual bool zoomPage(int direction) = 0;
    virtual void executeJavaScript(const std::string& script) = 0;
};
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
"""


class VirtualMethods(unittest.TestCase):
    def test_reads_names_in_order_and_ignores_signals_and_comments(self):
        self.assertEqual(abi.virtual_methods(UPSTREAM, "QCefWidget"),
                         ["setURL", "setStartupScript", "allowAllPopups", "closeBrowser", "reloadPage",
                          "zoomPage", "executeJavaScript"])
        self.assertEqual(abi.virtual_methods(UPSTREAM, "QCef")[:4],
                         ["~QCef", "init_browser", "initialized", "wait_for_browser_init"])

    def test_handles_multi_line_declarations_and_return_types_with_templates(self):
        self.assertIn("get_cookie_path", abi.virtual_methods(UPSTREAM, "QCef"))
        self.assertIn("create_cookie_manager", abi.virtual_methods(UPSTREAM, "QCef"))

    def test_a_missing_class_is_an_error(self):
        with self.assertRaises(abi.AbiError):
            abi.virtual_methods("struct Other {};", "QCef")


class Compare(unittest.TestCase):
    def test_our_shim_matches_upstream(self):
        self.assertEqual(abi.compare(OURS, UPSTREAM), [])

    def test_a_reordered_function_is_reported(self):
        swapped = OURS.replace("virtual void closeBrowser() = 0;\n    virtual void reloadPage() = 0;",
                               "virtual void reloadPage() = 0;\n    virtual void closeBrowser() = 0;")
        self.assertEqual(len(abi.compare(swapped, UPSTREAM)), 1)

    def test_an_added_function_is_reported(self):
        added = OURS.replace("virtual bool initialized() = 0;", "virtual bool initialized() = 0;\n    virtual void extra() = 0;")
        self.assertEqual(len(abi.compare(added, UPSTREAM)), 1)

    def test_a_new_upstream_function_is_reported(self):
        newer = UPSTREAM.replace("virtual void executeJavaScript(const std::string &script) = 0;",
                                 "virtual void executeJavaScript(const std::string &script) = 0;\n\tvirtual void brandNew() = 0;")
        self.assertEqual(len(abi.compare(OURS, newer)), 1)


class _FakeResponse:
    """Enough of an http.client.HTTPResponse for _fetch's context manager."""

    def __enter__(self):
        return self

    def __exit__(self, *_exc):
        return False

    def read(self):
        return b"{}"


class Authorization(unittest.TestCase):
    def _request(self):
        with mock.patch.object(abi.urllib.request, "urlopen", return_value=_FakeResponse()) as urlopen:
            abi._fetch("https://example.test/x")
        return urlopen.call_args.args[0]

    def test_sends_the_token_only_when_the_environment_sets_it(self):
        with mock.patch.dict(os.environ, {}, clear=False):
            os.environ.pop("GITHUB_TOKEN", None)
            self.assertIsNone(self._request().get_header("Authorization"))
        with mock.patch.dict(os.environ, {"GITHUB_TOKEN": "s3cret"}):
            self.assertEqual(self._request().get_header("Authorization"), "Bearer s3cret")


if __name__ == "__main__":
    unittest.main()
