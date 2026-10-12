# SPDX-License-Identifier: GPL-2.0-or-later
cmake_minimum_required(VERSION 3.22)
project(obs-live-clock-plugin VERSION 0.1.0 LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

# MSVC reads a UTF-8 source file as the system ANSI code page unless told otherwise.
if(MSVC)
  add_compile_options(/utf-8 /W4)
else()
  add_compile_options(-Wall -Wextra)
endif()

option(BUILD_PLUGIN "Build the OBS plugin module (needs libobs, obs-frontend-api, Qt6, libcurl)" ON)
option(BUILD_TESTS "Build the unit tests (no OBS needed)" ON)

add_subdirectory(core)
add_subdirectory(net)
add_subdirectory(tools)

if(BUILD_TESTS)
  enable_testing()
  add_subdirectory(tests)
endif()

if(BUILD_PLUGIN AND EXISTS "${CMAKE_CURRENT_SOURCE_DIR}/src/CMakeLists.txt")
  add_subdirectory(src)
endif()
