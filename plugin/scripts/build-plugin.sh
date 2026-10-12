#!/usr/bin/env bash
# SPDX-License-Identifier: GPL-2.0-or-later
# Builds the real OBS module (obs-live-clock.dll / .so) plus olc-cli, against plugin/.deps made by setup-obs-dev.sh.
# Prints the path of the built module. The OBS glue has no unit tests: compiling and linking IS its automatic check.
set -euo pipefail
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
olc_is_windows || { echo "build-plugin.sh supports Windows only; macOS and Linux are built by CI." >&2; exit 2; }
deps_root="$OLC_DEPS_DIR"
[ -f "$deps_root/env.sh" ] || { echo "run plugin/scripts/setup-obs-dev.sh first" >&2; exit 1; }
# shellcheck disable=SC1091
. "$deps_root/env.sh"
olc_pick_generator
prefix="$(olc_native_path "$deps_root/obs-dev");$(olc_native_path "$deps_root/qt");$(olc_native_path "$deps_root/deps")"
cmake -S "$OLC_ROOT" -B "$OLC_ROOT/build-plugin" "${GEN_ARGS[@]}" -DBUILD_TESTS=ON -DBUILD_PLUGIN=ON \
  "-DOLC_EXPECTED_QT=$OBS_QT_ABI" "-DCMAKE_PREFIX_PATH=$prefix"
cmake --build "$OLC_ROOT/build-plugin" --config Release --parallel
ls "$OLC_ROOT/build-plugin/src/Release/obs-live-clock.dll"
