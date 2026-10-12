#!/usr/bin/env bash
# SPDX-License-Identifier: GPL-2.0-or-later
# Builds the OBS development tree the plugin module needs (libobs + obs-frontend-api headers and import libraries,
# OBS's own prebuilt dependencies and Qt) into $OLC_DEPS_DIR (default plugin/.deps, git-ignored). Same recipe as CI: it mirrors
# the Windows job of Playlist Deck's build_project.yml. Takes 5 to 10 minutes the first time (downloads about 400 MB), nothing afterwards.
#
# VERIFIED on Windows 11 with OBS 32.2.2 (Git Bash, Visual Studio 18 Build Tools, paths with spaces included).
# NOT verified on macOS or Linux: CI builds there (see .github/workflows/ci.yml); do not use this script on them.
set -euo pipefail
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
olc_is_windows || { echo "setup-obs-dev.sh supports Windows only; macOS and Linux are built by CI." >&2; exit 2; }

OBS_VERSION="${OBS_VERSION:-32.2.2}"   # keep equal to OBS_VERSION in .github/workflows/ci.yml
deps_root="$OLC_DEPS_DIR"
mkdir -p "$deps_root/dl"
py="$(command -v python3 || command -v python)"

# 1. Which obs-deps / Qt does this OBS use? (from OBS's own CMakePresets.json)
eval "$("$py" "$OLC_ROOT/ci/obs_deps.py" --obs-version "$OBS_VERSION" --platform windows | sed -E 's/^([A-Z0-9_]+)=(.*)$/\1="\2"/')"
echo "OBS $OBS_VERSION: obs-deps $OBS_DEPS_VERSION, Qt deps $OBS_QT6_DEPS_VERSION, Qt ABI $OBS_QT_ABI"

stamp="$deps_root/stamp-$OBS_VERSION-$OBS_DEPS_VERSION"
if [ -f "$stamp" ]; then echo "already set up ($stamp)"; exit 0; fi
rm -rf "$deps_root/deps" "$deps_root/qt" "$deps_root/obs-src" "$deps_root/obs-build" "$deps_root/obs-dev"
mkdir -p "$deps_root/deps" "$deps_root/qt" "$deps_root/obs-src"

# 2. Download (OBS's own release assets) and unpack.
dl="$deps_root/dl"
curl -fsSL -o "$dl/deps.zip" "https://github.com/obsproject/obs-deps/releases/download/$OBS_DEPS_VERSION/windows-deps-$OBS_DEPS_VERSION-x64.zip"
curl -fsSL -o "$dl/qt.zip" "https://github.com/obsproject/obs-deps/releases/download/$OBS_QT6_DEPS_VERSION/windows-deps-qt6-$OBS_QT6_DEPS_VERSION-x64.zip"
curl -fsSL -o "$dl/obs.zip" "https://github.com/obsproject/obs-studio/archive/refs/tags/$OBS_VERSION.zip"
unzip_to() { powershell.exe -NoProfile -Command "Expand-Archive -LiteralPath '$(olc_native_path "$1")' -DestinationPath '$(olc_native_path "$2")' -Force"; }
unzip_to "$dl/deps.zip" "$deps_root/deps"
unzip_to "$dl/qt.zip" "$deps_root/qt"
unzip_to "$dl/obs.zip" "$deps_root/obs-src"

# 3. Configure OBS with nothing enabled, build only obs-frontend-api (libobs comes with it), install the dev files.
olc_pick_generator
D="$(olc_native_path "$deps_root/deps")"; Q="$(olc_native_path "$deps_root/qt")"
S="$(olc_native_path "$deps_root/obs-src/obs-studio-$OBS_VERSION")"; B="$(olc_native_path "$deps_root/obs-build")"
cmake -B "$B" -S "$S" "${GEN_ARGS[@]}" \
  -DENABLE_PLUGINS=OFF -DENABLE_CORE_MODULES=OFF -DENABLE_SCRIPTING=OFF -DENABLE_BROWSER=OFF -DENABLE_UPDATER=OFF \
  -DCMAKE_SYSTEM_VERSION=10.0 "-DDepsPath=$D" "-DFFMPEG_PATH=$D" "-DQTDIR=$Q" "-DCMAKE_PREFIX_PATH=$D;$Q" >"$deps_root/obs-configure.log" 2>&1 \
  || { tail -30 "$deps_root/obs-configure.log"; exit 1; }
cmake --build "$B" --target obs-frontend-api --config Release --parallel >"$deps_root/obs-build.log" 2>&1 \
  || { tail -30 "$deps_root/obs-build.log"; exit 1; }
cmake --install "$B" --config Release --component Development --prefix "$(olc_native_path "$deps_root/obs-dev")" >"$deps_root/obs-install.log" 2>&1 \
  || { tail -30 "$deps_root/obs-install.log"; exit 1; }

printf 'OBS_QT_ABI=%s\nOBS_VERSION=%s\n' "$OBS_QT_ABI" "$OBS_VERSION" >"$deps_root/env.sh"
touch "$stamp"
echo "done: $deps_root/obs-dev"
