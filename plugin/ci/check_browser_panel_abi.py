#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-2.0-or-later
"""Fail when plugin/src/BrowserPanel.hpp no longer matches obs-browser's panel ABI.

The plugin hosts its dock page through obs-browser's QCef / QCefWidget virtual-function tables. The ABI is the
ORDER of those functions, so our own declarations (written, not copied: upstream is GPL-2.0-only) must list the same
names in the same order. This script reads upstream's panel/browser-panel.hpp and compares.

Usage: python3 check_browser_panel_abi.py --local plugin/src/BrowserPanel.hpp [--upstream-file FILE | --obs-tag 32.2.2]
With --obs-tag it resolves the obs-browser commit that OBS tag pins (a submodule) and downloads that header.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
import urllib.request

UPSTREAM_RAW = "https://raw.githubusercontent.com/obsproject/obs-browser/{sha}/panel/browser-panel.hpp"
SUBMODULE_API = "https://api.github.com/repos/obsproject/obs-studio/contents/plugins/obs-browser?ref={tag}"


class AbiError(Exception):
    pass


def class_body(text: str, name: str) -> str:
    """Text between the braces of `class NAME ... {` or `struct NAME ... {` (first definition)."""
    match = re.search(r"\b(?:class|struct)\s+" + re.escape(name) + r"\b[^;{]*\{", text)
    if not match:
        raise AbiError(f"no definition of {name} found")
    depth, i = 1, match.end()
    while i < len(text) and depth:
        depth += {"{": 1, "}": -1}.get(text[i], 0)
        i += 1
    if depth:
        raise AbiError(f"unbalanced braces in {name}")
    return text[match.end():i - 1]


def virtual_methods(text: str, name: str) -> list[str]:
    """Names of the virtual functions of `name`, in declaration order. Comments are ignored."""
    body = class_body(re.sub(r"//[^\n]*|/\*.*?\*/", "", text, flags=re.S), name)
    names = []
    for match in re.finditer(r"\bvirtual\b([^;{]*?)(~?\w+)\s*\(", body, flags=re.S):
        names.append(match.group(2))
    return [n.removesuffix("_never_called") for n in names]


def compare(local: str, upstream: str) -> list[str]:
    problems = []
    for cls in ("QCefWidget", "QCef"):
        ours, theirs = virtual_methods(local, cls), virtual_methods(upstream, cls)
        if ours != theirs:
            problems.append(f"{cls}: ours {ours} != upstream {theirs}")
    return problems


def _fetch(url: str) -> str:
    headers = {"User-Agent": "obs-live-clock-ci"}
    # GitHub's API rate-limits anonymous requests to 60/hour per IP, which shared runners exhaust. The token is
    # only ever sent as a header; it is never printed or logged.
    token = os.environ.get("GITHUB_TOKEN")
    if token:
        headers["Authorization"] = f"Bearer {token}"
    request = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(request, timeout=30) as response:
        return response.read().decode("utf-8")


def upstream_for_tag(tag: str) -> str:
    sha = json.loads(_fetch(SUBMODULE_API.format(tag=tag)))["sha"]
    return _fetch(UPSTREAM_RAW.format(sha=sha))


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--local", required=True)
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--upstream-file")
    group.add_argument("--obs-tag")
    args = parser.parse_args()
    try:
        with open(args.local, encoding="utf-8") as handle:
            local = handle.read()
        if args.upstream_file:
            with open(args.upstream_file, encoding="utf-8") as handle:
                upstream = handle.read()
        else:
            upstream = upstream_for_tag(args.obs_tag)
        problems = compare(local, upstream)
    except (AbiError, OSError, ValueError, KeyError) as error:
        print(f"::error::browser-panel ABI check could not run: {error}", file=sys.stderr)
        return 1
    for problem in problems:
        print(f"::error::{problem}", file=sys.stderr)
    return 1 if problems else 0


if __name__ == "__main__":
    raise SystemExit(main())
