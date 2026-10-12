# SPDX-License-Identifier: GPL-2.0-or-later
# The OBS module: the only place that sees libobs, obs-frontend-api, Qt and libcurl.
find_package(libobs QUIET)
if(NOT libobs_FOUND)
  find_package(LibObs REQUIRED)
endif()
find_package(obs-frontend-api REQUIRED)
find_package(Qt6 REQUIRED COMPONENTS Core Gui Widgets)
if(NOT TARGET olc-net)
  message(FATAL_ERROR "The plugin module needs libcurl (olc-net): pass CMAKE_PREFIX_PATH with the OBS deps")
endif()

# A Qt plugin loaded into OBS runs against the Qt that OBS itself ships. A major.minor mismatch does not fail to
# load, it crashes later somewhere unrelated. Pass -DOLC_EXPECTED_QT=6.11 (the Qt of the OBS being targeted) and the
# build refuses to produce a binary for another one. Empty = only a printed note.
set(OLC_EXPECTED_QT "" CACHE STRING "major.minor of the Qt that the target OBS ships")
message(STATUS "OBS Live Clock: building against Qt ${Qt6_VERSION}")
if(OLC_EXPECTED_QT)
  string(REGEX MATCH "^[0-9]+\\.[0-9]+" _olc_qt_found "${Qt6_VERSION}")
  if(NOT _olc_qt_found VERSION_EQUAL OLC_EXPECTED_QT)
    message(FATAL_ERROR "Qt ${Qt6_VERSION} found, but this build targets an OBS that ships Qt ${OLC_EXPECTED_QT}.")
  endif()
endif()

set(CMAKE_AUTOMOC ON)

# Every .cpp in this folder is part of the module. Later tasks only ADD files; nobody edits this list.
file(GLOB OLC_GLUE_SOURCES CONFIGURE_DEPENDS "${CMAKE_CURRENT_SOURCE_DIR}/*.cpp")
add_library(obs-live-clock MODULE ${OLC_GLUE_SOURCES})
target_link_libraries(obs-live-clock PRIVATE olc-core olc-net OBS::libobs OBS::obs-frontend-api Qt6::Core Qt6::Gui Qt6::Widgets)
target_compile_definitions(obs-live-clock PRIVATE OLC_VERSION="${PROJECT_VERSION}")
target_include_directories(obs-live-clock PRIVATE "${CMAKE_CURRENT_SOURCE_DIR}")

if(WIN32)
  # Relative to a plugins folder (C:\ProgramData\obs-studio\plugins). OBS 33 loads <name>\<name>.dll, OBS 32 and
  # earlier <name>\bin\64bit\<name>.dll: install both, OBS 33 skips the legacy duplicate.
  set(OLC_PLUGIN_DESTINATIONS "obs-live-clock" "obs-live-clock/bin/64bit")
elseif(APPLE)
  set(OLC_PLUGIN_DESTINATIONS "obs-plugins")
else()
  # OBS names a module after its file minus the extension: no "lib" prefix.
  set_target_properties(obs-live-clock PROPERTIES PREFIX "")
  # Per-user layout, relative to $HOME, searched by every OBS (same choice as Playlist Deck).
  set(OLC_PLUGIN_DESTINATIONS ".local/share/obs-studio/plugins/obs-live-clock" ".config/obs-studio/plugins/obs-live-clock/bin/64bit")
endif()
foreach(destination IN LISTS OLC_PLUGIN_DESTINATIONS)
  install(TARGETS obs-live-clock LIBRARY DESTINATION "${destination}")
endforeach()
