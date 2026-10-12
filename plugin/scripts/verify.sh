#!/usr/bin/env bash
# SPDX-License-Identifier: GPL-2.0-or-later
# One-line result for the orchestrator: C++ unit tests + the Python CI helper tests.
# Prints "PASS cpp=<n> test cases py=<n> tests" or "FAIL ..." followed by the last lines of the failing step.
set -u
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
log="$(mktemp)"
trap 'rm -f "$log"' EXIT
if ! bash "$OLC_ROOT/scripts/test.sh" >"$log" 2>&1; then
  echo "FAIL cpp"; tail -25 "$log"; exit 1
fi
cpp="$(grep -E '^\[doctest\] test cases:' "$log" | tail -1 | sed -E 's/.*test cases: *([0-9]+).*/\1/')"
if [ -z "$cpp" ]; then
  # ctest hides the doctest summary on success: run the binary once more for the count.
  exe="$(find "$OLC_ROOT/build" -name 'olc-tests*' -type f \( -name '*.exe' -o -perm -u+x \) | head -1)"
  cpp="$("$exe" 2>&1 | grep -E '^\[doctest\] test cases:' | sed -E 's/.*test cases: *([0-9]+).*/\1/')"
fi
py="$(command -v python3 || command -v python)"
if ! "$py" -I -m unittest discover -s "$OLC_ROOT/ci" -p 'test_*.py' >"$log" 2>&1; then
  echo "FAIL python"; tail -25 "$log"; exit 1
fi
pytests="$(grep -E '^Ran [0-9]+ tests' "$log" | sed -E 's/Ran ([0-9]+) tests.*/\1/')"
echo "PASS cpp=${cpp} test cases py=${pytests} tests"
