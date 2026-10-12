# SPDX-License-Identifier: GPL-2.0-or-later
# libcurl behind IHttpClient. Built only when libcurl is found, so the unit-test-only builds need nothing extra.
# Every .cpp in this folder is part of olc-net. Later tasks only ADD files; nobody edits this list.
find_package(CURL)
file(GLOB OLC_NET_SOURCES CONFIGURE_DEPENDS "${CMAKE_CURRENT_SOURCE_DIR}/*.cpp")
if(CURL_FOUND AND OLC_NET_SOURCES)
  add_library(olc-net STATIC ${OLC_NET_SOURCES})
  target_include_directories(olc-net PUBLIC "${CMAKE_CURRENT_SOURCE_DIR}")
  target_link_libraries(olc-net PUBLIC olc-core CURL::libcurl)
  set_target_properties(olc-net PROPERTIES POSITION_INDEPENDENT_CODE ON)
else()
  message(STATUS "OBS Live Clock: libcurl not found (or no net sources yet) - olc-net and olc-cli are not built")
endif()
