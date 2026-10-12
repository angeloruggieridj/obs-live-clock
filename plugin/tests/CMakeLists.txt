# SPDX-License-Identifier: GPL-2.0-or-later
# Every test_*.cpp in this folder is a test. Later tasks only ADD files; nobody edits this list.
file(GLOB OLC_TEST_SOURCES CONFIGURE_DEPENDS "${CMAKE_CURRENT_SOURCE_DIR}/test_*.cpp")
add_executable(olc-tests main.cpp ${OLC_TEST_SOURCES})
target_link_libraries(olc-tests PRIVATE olc-core)
target_compile_definitions(olc-tests PRIVATE OLC_SOURCE_DIR="${CMAKE_SOURCE_DIR}")
add_test(NAME core COMMAND olc-tests)
