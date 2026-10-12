# SPDX-License-Identifier: GPL-2.0-or-later
# olc-cli: the plugin's core with a real HTTP client and no OBS, used by the contract test (server/test/contract).
if(TARGET olc-net AND EXISTS "${CMAKE_CURRENT_SOURCE_DIR}/cli.cpp")
  add_executable(olc-cli cli.cpp)
  target_link_libraries(olc-cli PRIVATE olc-net)
endif()
