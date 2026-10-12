# SPDX-License-Identifier: GPL-2.0-or-later
# Shared helpers for the plugin scripts. Source it: . "$(dirname "$0")/lib.sh"
# Works in Git Bash on Windows, and in bash on macOS and Linux.

OLC_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# Where the OBS development tree lives. Set OLC_DEPS_DIR to share one tree between git worktrees (about 1 GB).
OLC_DEPS_DIR="${OLC_DEPS_DIR:-$OLC_ROOT/.deps}"
export OLC_ROOT OLC_DEPS_DIR

olc_is_windows() { case "$(uname -s)" in MINGW*|MSYS*|CYGWIN*) return 0 ;; *) return 1 ;; esac; }

# Native path with forward slashes ("C:/Users/..."), which CMake accepts everywhere. A no-op off Windows.
olc_native_path() { if olc_is_windows && command -v cygpath >/dev/null 2>&1; then cygpath -m "$1"; else printf '%s' "$1"; fi; }

# Fills GEN_ARGS with the CMake generator arguments.
#   OLC_CMAKE_GENERATOR overrides the choice (for example "Ninja").
#   Windows: the newest Visual Studio that has the C++ tools, found with vswhere. This machine has Visual Studio 2022
#   and "18" (2026) Build Tools but only "18" carries the C++ tools, so "Visual Studio 17 2022" would fail with
#   "could not find any instance of Visual Studio". No `cl` or `ninja` on PATH is needed.
#   Elsewhere: Ninja when it is installed, else CMake's default.
olc_pick_generator() {
  GEN_ARGS=()
  if [ -n "${OLC_CMAKE_GENERATOR:-}" ]; then
    GEN_ARGS=(-G "$OLC_CMAKE_GENERATOR")
  elif olc_is_windows; then
    local vswhere="/c/Program Files (x86)/Microsoft Visual Studio/Installer/vswhere.exe" version name
    if [ ! -x "$vswhere" ]; then echo "vswhere.exe not found: install Visual Studio Build Tools with the C++ workload" >&2; return 1; fi
    version="$("$vswhere" -latest -products '*' -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationVersion | tr -d '\r')"
    case "${version%%.*}" in
      18) name="Visual Studio 18 2026" ;;
      17) name="Visual Studio 17 2022" ;;
      16) name="Visual Studio 16 2019" ;;
      *) echo "no Visual Studio with the C++ tools found (vswhere said '$version')" >&2; return 1 ;;
    esac
    GEN_ARGS=(-G "$name" -A x64)
  elif command -v ninja >/dev/null 2>&1; then
    GEN_ARGS=(-G Ninja)
  fi
}
