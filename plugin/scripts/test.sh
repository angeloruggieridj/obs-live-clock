#!/usr/bin/env bash
# SPDX-License-Identifier: GPL-2.0-or-later
# Build the plugin's pure core and run its C++ unit tests. Needs only CMake and a C++17 compiler: no OBS, no Qt.
# Usage: plugin/scripts/test.sh            (from anywhere)
#        OLC_CMAKE_GENERATOR=Ninja plugin/scripts/test.sh
set -euo pipefail
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
olc_pick_generator
build="$OLC_ROOT/build"
cmake -S "$OLC_ROOT" -B "$build" "${GEN_ARGS[@]}" -DBUILD_PLUGIN=OFF -DBUILD_TESTS=ON
cmake --build "$build" --config Release --parallel
ctest --test-dir "$build" -C Release --output-on-failure
