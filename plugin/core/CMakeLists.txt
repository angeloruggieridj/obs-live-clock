# SPDX-License-Identifier: GPL-2.0-or-later
# Every .cpp in this folder is part of the core. Later tasks only ADD files; nobody edits this list.
file(GLOB OLC_CORE_SOURCES CONFIGURE_DEPENDS "${CMAKE_CURRENT_SOURCE_DIR}/*.cpp")
add_library(olc-core STATIC ${OLC_CORE_SOURCES})
target_include_directories(olc-core PUBLIC "${CMAKE_CURRENT_SOURCE_DIR}" PUBLIC "${CMAKE_SOURCE_DIR}/third_party")
target_compile_features(olc-core PUBLIC cxx_std_17)
set_target_properties(olc-core PROPERTIES POSITION_INDEPENDENT_CODE ON)
find_package(Threads REQUIRED)
target_link_libraries(olc-core PUBLIC Threads::Threads)
